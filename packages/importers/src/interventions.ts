import { createHash } from "node:crypto";
import { getProcedure, isIrrigation, IRRIGATION_DEPTH_MAX_MM, type SowingTechnique, type TreatmentPurpose } from "@fourmy/contracts";
import { harvestProcedure, operationTarget } from "./aee.js";
import type { BundleArticle, BundleQuantity, BundleWorkUnit, ImportBundle } from "./model.js";

/**
 * Regroupement des unités de travail (couples intervention × parcelle) en
 * interventions Fourmy (claudedocs/conception_import_onboarding.md §5.3),
 * sur les clés source seulement : le rapprochement avec la ferme (parcelles,
 * articles, personnes) se fait ensuite dans l'API.
 *
 * - Geofolia : une action (`groupKey`) ; DAPLOS : même date de début et de
 *   fin, même opération, même statut.
 * - Puis scission par signature : Fourmy porte les doses au niveau de
 *   l'intervention, donc des parcelles aux doses différentes font des
 *   interventions différentes (aucune dose inventée).
 * - Récolte : une intervention par parcelle (le rendement de chacune compte).
 * - Irrigation : la dose d'eau en mm (arrondie au mm) fait la signature.
 */

export interface InterventionDraft {
  /** GUID des couples regroupés (clés `agri.crop_zone`). */
  guids: string[];
  procedure: string;
  status: "done" | "planned";
  /** Date (AAAA-MM-JJ) de début, et de fin si différente. */
  on: string;
  until: string | null;
  /** Parcelles (clé de culture) et surface travaillée de chacune. */
  targets: { parcelKey: string; workedAreaM2: number | null }[];
  /** Doses par hectare, dans l'unité de la source. */
  inputs: { articleKey: string; perHa: number; unit: string }[];
  outputs: { articleKey: string; total: number; unit: string }[];
  depthMm: number | null;
  sowing: SowingTechnique | null;
  purposes: TreatmentPurpose[];
  notes: string | null;
  doerKeys: string[];
  /** Libellé et code d'origine (rapport, note d'une procédure de repli). */
  source: { label: string; code: string | null };
  /** Raison de ne pas créer l'intervention (dose d'eau impossible…). */
  skip?: string;
}

/** Arrondi à 3 chiffres significatifs (comparaison des doses). */
export function sig3(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  return Number(v.toPrecision(3));
}

/** Identifiant stable (UUID v5 maison, RFC 4122) d'après une ferme et une clé source. */
export function stableId(farmId: string, namespace: string, key: string): string {
  const hash = createHash("sha1").update(`fourmy-import:${farmId}:${namespace}:${key}`).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function procedureFor(unit: BundleWorkUnit, articles: Map<string, BundleArticle>, usage: string | null): { procedure: string; sowing: SowingTechnique | null } {
  const target = operationTarget(unit.operation.aeeCode, unit.operation.category);
  let procedure = target.procedure;
  // Fertilisation : organique dès qu'un intrant est un effluent ou un sous-produit organique.
  if (target.dependsOnInputs && unit.inputs.some((i) => articles.get(i.articleKey)?.organic)) procedure = "organic_fertilizing";
  if (procedure === "harvesting") procedure = harvestProcedure(usage);
  return { procedure, sowing: target.sowing ?? null };
}

const signatureOf = (procedure: string, u: BundleWorkUnit): string => {
  if (getProcedure(procedure).shape === "harvest") return `harvest:${u.guid}`;
  if (isIrrigation(procedure)) return `water:${u.waterL && u.workedAreaM2 ? Math.round(u.waterL / u.workedAreaM2) : "?"}`;
  return u.inputs
    .map((i) => `${i.articleKey}=${i.perHa === null ? "?" : sig3(i.perHa)}${i.unit}`)
    .sort()
    .join("|");
};

/** Note d'une intervention : opération d'origine (procédure de repli), commentaire, motif. */
function noteOf(procedure: string, u: BundleWorkUnit): string | null {
  const parts: string[] = [];
  if (getProcedure(procedure).legacy) parts.push(`${u.operation.label}${u.operation.aeeCode ? ` (${u.operation.aeeCode})` : ""}`);
  if (u.notes) parts.push(u.notes);
  if (u.purpose) parts.push(`Motif : ${u.purpose}`);
  return parts.length ? parts.join(" — ").slice(0, 2000) : null;
}

/**
 * Interventions à créer, d'après les unités de travail du fichier. `skipGuids` :
 * couples déjà importés (liens `agri.crop_zone`), laissés de côté.
 */
export function draftInterventions(bundle: ImportBundle, skipGuids: ReadonlySet<string> = new Set()): InterventionDraft[] {
  const articles = new Map(bundle.articles.map((a) => [a.key, a]));
  const usage = new Map(bundle.parcels.map((p) => [p.key, p.crop.aeeUsage]));
  const groups = new Map<string, { unit: BundleWorkUnit; procedure: string; sowing: SowingTechnique | null }[]>();
  for (const u of bundle.workUnits) {
    if (skipGuids.has(u.guid)) continue;
    const { procedure, sowing } = procedureFor(u, articles, usage.get(u.parcelKey) ?? null);
    const group = u.groupKey ?? `${u.on}|${u.until ?? ""}|${u.operation.aeeCode ?? u.operation.label}|${u.status}`;
    const key = `${group}#${procedure}#${signatureOf(procedure, u)}`;
    groups.set(key, [...(groups.get(key) ?? []), { unit: u, procedure, sowing }]);
  }

  const drafts: InterventionDraft[] = [];
  for (const members of groups.values()) {
    const { unit: first, procedure, sowing } = members[0]!;
    const units = members.map((m) => m.unit);
    const inputs = first.inputs
      .filter((i): i is BundleQuantity & { perHa: number } => i.perHa !== null && i.perHa > 0)
      .map((i) => ({ articleKey: i.articleKey, perHa: i.perHa, unit: i.unit }));
    const outputs = units
      .flatMap((u) => u.outputs)
      .filter((o): o is BundleQuantity & { total: number } => o.total !== null && o.total > 0)
      .map((o) => ({ articleKey: o.articleKey, total: o.total, unit: o.unit }));
    const purposes = [...new Set(first.inputs.map((i) => articles.get(i.articleKey)?.purpose).filter((p): p is TreatmentPurpose => !!p))];
    const draft: InterventionDraft = {
      guids: units.map((u) => u.guid).sort(),
      procedure,
      status: first.status,
      on: first.on,
      until: first.until,
      targets: units.map((u) => ({ parcelKey: u.parcelKey, workedAreaM2: u.workedAreaM2 })),
      inputs,
      outputs,
      depthMm: null,
      sowing,
      purposes: getProcedure(procedure).shape === "treatment" ? purposes : [],
      notes: noteOf(procedure, first),
      doerKeys: [...new Set(units.flatMap((u) => u.doerKeys))],
      source: { label: first.operation.label, code: first.operation.aeeCode },
    };
    if (isIrrigation(procedure)) {
      const depth = first.waterL && first.workedAreaM2 ? first.waterL / first.workedAreaM2 : null;
      if (depth === null || depth <= 0) draft.skip = "dose d'eau inconnue";
      else if (depth > IRRIGATION_DEPTH_MAX_MM) draft.skip = `dose d'eau de ${Math.round(depth)} mm (au plus ${IRRIGATION_DEPTH_MAX_MM})`;
      else draft.depthMm = Math.round(depth * 10) / 10;
    }
    drafts.push(draft);
  }
  return drafts.sort((a, b) => a.on.localeCompare(b.on) || a.guids[0]!.localeCompare(b.guids[0]!));
}

/**
 * Bornes d'une journée à l'heure de Paris, en UTC : du début du jour `on` au
 * début du lendemain de `until` (ou de `on`).
 */
export function parisDayBounds(on: string, until: string | null = null): { startedAt: string; stoppedAt: string } {
  const start = parisMidnight(on);
  const end = parisMidnight(nextDay(until ?? on));
  return { startedAt: start, stoppedAt: end };
}

function nextDay(d: string): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Minuit à Paris (CET ou CEST) en ISO UTC : l'instant UTC dont l'heure de Paris est 00:00 ce jour-là. */
function parisMidnight(d: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "2-digit" });
  for (const hours of [1, 2, 0]) {
    const candidate = new Date(`${d}T00:00:00Z`);
    candidate.setUTCHours(candidate.getUTCHours() - hours);
    const parts = Object.fromEntries(fmt.formatToParts(candidate).map((p) => [p.type, p.value]));
    if (parts.hour === "00" && parts.minute === "00" && parts.day === d.slice(8, 10)) return candidate.toISOString();
  }
  return new Date(`${d}T00:00:00Z`).toISOString();
}
