import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { CONTROL_KIND_LABELS, type ControlKind, type ControlLevel, type ControlReport } from "@fourmy/contracts";
import { zip } from "@fourmy/isoxml";
import { abStatuses, harvestStatus } from "@fourmy/domain";
import { controlReport, hveIaeList, hveIrrigatedParcels, loadCertificationContext } from "./certification-controls.js";
import { loadHveIrrigation } from "./certification-hve.js";
import { phytoRegister, phytoRegisterCsv } from "./registers.js";
import { fertilizationRecord, fertilizationRecordCsv } from "./fertilization-record.js";

/**
 * Exports des contrôles (lot CT6) : registre AB et liasse HVE, en zip (CSV et
 * synthèse imprimable). Chaque export est enregistré sur le calcul utilisé
 * (date, auteur, empreinte) : le tableau de bord signale ensuite les données
 * modifiées depuis.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** CSV « ; », guillemets, décimales françaises, BOM pour les tableurs. */
export function csv(header: string[], lines: unknown[][]): string {
  const q = (v: unknown) => `"${(typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "")).replace(/"/g, '""')}"`;
  return `\ufeff${[header.map(q).join(";"), ...lines.map((l) => l.map(q).join(";"))].join("\r\n")}\r\n`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LEVEL: Record<ControlLevel, string> = { ok: "Conforme", warning: "À vérifier", danger: "Non conforme", missing: "Données manquantes", na: "Sans objet" };
const fr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

/** Synthèse imprimable d'un rapport (page autonome, sans ressource externe). */
export function reportHtml(report: ControlReport, farm: string): string {
  const sections = report.sections
    .map(
      (s) => `<section><h2>${esc(s.label)}${s.points ? ` — ${s.points.got} / ${s.points.max} points (minimum ${s.points.min})` : ""} <span class="lvl ${s.level}">${LEVEL[s.level]}</span></h2>
<table><thead><tr><th>Règle</th><th>Feu</th><th>Constat</th><th>Source</th></tr></thead><tbody>
${s.findings
  .map(
    (f) =>
      `<tr><td>${esc(f.ruleId)}</td><td class="lvl ${f.level}">${LEVEL[f.level]}${f.points ? `<br>${f.points.got} / ${f.points.max} pt` : ""}</td><td>${esc(f.message)}${f.breach ? `<br><small>Manquement INAO n° ${esc(f.breach.inao)} : ${esc(f.breach.measure)}</small>` : ""}${f.missing?.length ? `<br><small>À compléter : ${esc(f.missing.map((m) => m.what).join(", "))}</small>` : ""}</td><td><small>${esc(f.source)}</small></td></tr>`,
  )
  .join("\n")}
</tbody></table></section>`,
    )
    .join("\n");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Contrôle ${report.kind === "hve" ? "HVE" : "AB"} ${report.campaign} — ${esc(farm)}</title>
<style>body{font:12px/1.4 system-ui,sans-serif;margin:24px;color:#222}h1{font-size:18px}h2{font-size:14px;margin-top:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px;vertical-align:top;text-align:left}.lvl.ok{color:#2b7a3d}.lvl.warning{color:#a8740a}.lvl.danger{color:#b3261e}.lvl.missing{color:#666}@media print{section{break-inside:avoid-page}}</style></head>
<body><h1>Contrôle ${esc(CONTROL_KIND_LABELS[report.kind])} — ${esc(farm)}</h1>
<p>Campagne ${report.campaign}, du ${fr(report.period.from)} au ${fr(report.period.to)}. Verdict : <strong class="lvl ${report.verdict}">${LEVEL[report.verdict]}</strong>.<br>
Calculé le ${new Date(report.computedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} par Fourmy, référentiels ${esc(report.refsVersion)}. Préparation de l'audit : ne remplace pas la décision de l'organisme certificateur.</p>
${sections}</body></html>`;
}

/** Enregistre l'export sur le dernier calcul de la campagne. */
async function markExported(db: Database, farmId: string, userId: string, kind: ControlKind, campaign: number, bytes: Uint8Array): Promise<string> {
  const sha = createHash("sha256").update(bytes).digest("hex");
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      UPDATE certification_runs SET exported_at = now(), exported_by = ${userId}, export_sha256 = ${sha}
      WHERE id = (SELECT id FROM certification_runs WHERE kind = ${kind} AND campaign = ${campaign} ORDER BY computed_at DESC LIMIT 1)`),
  );
  return sha;
}

async function farmName(db: Database, farmId: string): Promise<string> {
  return withFarm(db, farmId, async (tx) => (await rows<{ name: string }>(tx, sql`SELECT name FROM farms WHERE id = ${farmId}`))[0]?.name ?? "Exploitation");
}

/** Registre AB d'une campagne (lot CT6, §3 du rapport AB). */
export async function abRegisterZip(db: Database, farmId: string, userId: string, campaign: number): Promise<{ bytes: Uint8Array; sha256: string }> {
  const report = await controlReport(db, farmId, "ab", campaign);
  const farm = await farmName(db, farmId);
  const files = await withFarm(db, farmId, async (tx) => {
    const ctx = await loadCertificationContext(tx, "ab", campaign);
    const ab = ctx.ab!;
    const names = new Map(ab.parcels.map((p) => [p.id, p.name]));
    const statuses = abStatuses(ctx);
    const inPeriod = ab.applications.filter((a) => a.day >= ctx.period.from && a.day <= ctx.period.to);
    const harvests = ab.parcels.length
      ? await rows<{ day: string; parcel_id: string; product: string; quantity: string | null; unit: string | null }>(
          tx,
          sql`SELECT (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS day, t.ref_id AS parcel_id, a.name AS product, o.quantity::text, o.unit
              FROM interventions i
              JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
                AND t.ref_id IN (${sql.join(ab.parcels.map((p) => sql`${p.id}`), sql`, `)})
              JOIN intervention_parameters o ON o.intervention_id = i.id AND o.role = 'output' AND o.ref_type = 'article'
              JOIN articles a ON a.id = o.ref_id
              WHERE i.status = 'done' AND i.started_at >= ${ctx.period.from}::date AND i.started_at < ${ctx.period.to}::date + 1
              ORDER BY i.started_at`,
        )
      : [];
    const statusOf = new Map(statuses.map((s) => [s.parcelId, s]));
    const cleanings = (ab.equipment ?? []).filter((e) => e.kind === "cleaning" && e.at.slice(0, 10) >= ctx.period.from && e.at.slice(0, 10) <= ctx.period.to);
    return {
      "synthese.html": reportHtml(report, farm),
      "parcelles.csv": csv(
        ["Parcelle", "Surface (ha)", "Niveau déclaré", "Début de la conversion", "Redémarrage", "Produit à l'origine", "Statut"],
        statuses.map((s) => [s.name, Math.round(s.areaM2 / 100) / 100, s.declaredLevel ?? "", s.startedOn, s.resetBy ? s.conversionStart : "", s.resetBy?.product ?? "", s.status]),
      ),
      "cultures.csv": csv(
        ["Parcelle", "Culture", "Cycle", "Semis ou plantation", "Récolte", "Statut de la récolte"],
        statuses.flatMap((s) => s.productions.map((p) => [s.name, p.label, p.cycle, p.sownOn ?? "", p.harvestOn, p.status])),
      ),
      "intrants.csv": csv(
        ["Date", "Parcelle", "Produit", "Nature", "Utilisable en AB", "Justification", "Cuivre (kg/ha)", "Catégories annexe II", "Provenance", "Azote total (kg/ha)", "Statut de la semence", "Traitée", "Dérogation"],
        inPeriod.map((a) => [
          a.day,
          names.get(a.parcelId) ?? "",
          a.product,
          a.kind === "phyto" ? "Phytosanitaire" : a.kind === "fertilizer" ? "Fertilisant" : "Semence ou plant",
          a.kind === "phyto" ? (a.organicAllowed === true ? "oui" : a.organicAllowed === false ? "non" : "inconnu") : "",
          a.kind === "phyto" ? (a.justified ? "oui" : "non") : "",
          a.copperKgHa ?? "",
          a.categories?.join(" ") ?? "",
          a.effluentOrigin ?? "",
          a.nTotalKgHa ?? "",
          a.kind === "seed" ? (a.organicStatus ?? "inconnu") : "",
          a.kind === "seed" ? (a.seedTreated === null || a.seedTreated === undefined ? "inconnu" : a.seedTreated ? "oui" : "non") : "",
          a.derogation ? `${a.derogation.reference ?? ""} du ${a.derogation.grantedOn}` : "",
        ]),
      ),
      "recoltes.csv": csv(
        ["Date", "Parcelle", "Produit", "Quantité", "Unité", "Statut"],
        harvests.map((h) => {
          const s = statusOf.get(h.parcel_id);
          const prod = s?.productions[0];
          const status = s ? harvestStatus(s.conversionStart, prod?.cycle ?? "annual", prod?.sownOn ?? null, h.day) : "";
          return [h.day, names.get(h.parcel_id) ?? "", h.product, h.quantity === null ? "" : Number(h.quantity), h.unit ?? "", status];
        }),
      ),
      "nettoyages.csv": csv(["Date", "Matériel"], cleanings.map((e) => [e.at.slice(0, 10), e.equipment])),
    };
  });
  const bytes = zip(files);
  return { bytes, sha256: await markExported(db, farmId, userId, "ab", campaign, bytes) };
}

/** Liasse HVE d'une campagne (lot CT6). */
export async function hveBundleZip(db: Database, farmId: string, userId: string, campaign: number): Promise<{ bytes: Uint8Array; sha256: string }> {
  const report = await controlReport(db, farmId, "hve", campaign);
  const farm = await farmName(db, farmId);
  const iae = await hveIaeList(db, farmId, campaign);
  const irrigated = await hveIrrigatedParcels(db, farmId, campaign);
  const phyto = await phytoRegister(db, farmId, campaign);
  const fert = await fertilizationRecord(db, farmId, campaign);
  const extra = await withFarm(db, farmId, async (tx) => {
    const ctx = await loadCertificationContext(tx, "hve", campaign);
    const year = ctx.hve!.phyto.years[0];
    const parcelNames = new Map((year?.parcels ?? []).map((p) => [p.id, p.name]));
    const ift = await rows<{ id: string; day: string; ift: { lines?: { articleId: string; parcelId: string; ift: number | null; segment: string | null; segmentCode?: string | null; certifiedId?: string | null; signature?: string | null }[] } | null }>(
      tx,
      sql`SELECT i.id, (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS day, i.ift FROM interventions i
          WHERE i.status = 'done' AND i.ift IS NOT NULL AND i.started_at >= ${ctx.period.from}::date AND i.started_at < ${ctx.period.to}::date + 1 ORDER BY i.started_at`,
    );
    const products = new Map((await rows<{ id: string; name: string; amm: string | null }>(tx, sql`SELECT id, name, amm FROM articles WHERE kind = 'phyto'`)).map((a) => [a.id, a]));
    const irrigation = await loadHveIrrigation(tx, campaign, ctx.period);
    return {
      parcels: year?.parcels ?? [],
      iftCsv: csv(
        ["Date", "Parcelle", "Produit", "N° AMM", "Segment", "IFT", "Identifiant certifié", "Signature"],
        ift.flatMap((i) =>
          (i.ift?.lines ?? []).map((l) => [i.day, parcelNames.get(l.parcelId) ?? l.parcelId, products.get(l.articleId)?.name ?? "", products.get(l.articleId)?.amm ?? "", l.segment ?? "", l.ift ?? "", l.certifiedId ?? "", l.signature ?? ""]),
        ),
      ),
      irrigationCsv: csv(
        ["Date", "Parcelles", "Dose (mm)", "Surface (ha)", "Volume (m³)", "Matériel", "Mobile", "Origine de l'eau", "Facteur déclenchant", "Étiage"],
        irrigation.irrigations.map((r) => [
          r.day,
          r.parcelIds.length,
          r.depthMm ?? "",
          Math.round(r.areaM2 / 100) / 100,
          r.depthMm === null ? "" : Math.round((r.depthMm * r.areaM2) / 1000),
          r.method ?? "",
          r.mobile === null ? "" : r.mobile ? "oui" : "non",
          r.origin ?? "",
          r.trigger ?? "",
          ["06", "07", "08"].includes(r.day.slice(5, 7)) ? "oui" : "non",
        ]),
      ),
    };
  });
  const files = {
    "synthese.html": reportHtml(report, farm),
    "parcelles.csv": csv(
      ["Parcelle", "Surface (ha)", "Famille HVE", "Espèce", "Variété"],
      extra.parcels.map((p) => [p.name, Math.round(p.areaM2 / 100) / 100, p.family ?? "", p.species ?? "", p.variety ?? ""]),
    ),
    "ift.csv": extra.iftCsv,
    "registre-phyto.csv": phytoRegisterCsv(phyto),
    "cahier-fertilisation.csv": fertilizationRecordCsv(fert),
    "irrigation.csv": extra.irrigationCsv,
    "parcelles-irriguees.csv": csv(
      ["Parcelle", "Culture", "Semis", "Variété tolérante", "Pratiques économes", "Rendement enregistré"],
      irrigated.items.map((p) => [p.name, p.crop ?? "", p.sownOn ?? "", p.droughtTolerant === null ? "" : p.droughtTolerant ? "oui" : "non", p.waterSaving ?? "", p.harvested ? "oui" : "non"]),
    ),
    "iae.csv": csv(
      ["Élément", "Type TelePAC", "Type HVE", "Validée", "Mitoyen", "Quantité", "Unité", "Surface équivalente (m²)", "Terres arables"],
      iae.items.map((f) => [f.label, f.capType ?? "", f.type ?? "", f.validated ? "oui" : "non", f.shared ? "oui" : "non", f.quantity, f.unit ?? "", f.equivalentM2 ?? "", f.onArable ? "oui" : "non"]),
    ),
  };
  const bytes = zip(files);
  return { bytes, sha256: await markExported(db, farmId, userId, "hve", campaign, bytes) };
}
