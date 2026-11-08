/**
 * Lecture d'un dossier de la base matériel (format « base Arion » :
 * `machine.json`, `sources.json`, `fiche_technique.json`,
 * `entretien/plan_entretien.json`, `entretien/fluides.csv`,
 * `pieces/pieces_entretien.csv`). Fonction pure : textes → paquet normalisé,
 * avec les avertissements du rapport d'import (docs/materiels-entretien-design.md §7).
 */

export type OperationKind = "inspection" | "cleaning" | "greasing" | "replacement" | "oil_change" | "adjustment" | "bleeding" | "visit";

export interface BundlePart {
  reference: string;
  referenceNorm: string;
  designation: string;
  quantity: number;
  family: string | null;
}

export interface BundleOperation {
  code: string;
  manualNumber: string | null;
  label: string;
  kind: OperationKind;
  everyHours: number | null;
  everyMonths: number | null;
  firstHours: number | null;
  performer: "member" | "workshop";
  requiresOption: string | null;
  condition: string | null;
  source: { id: string; page: unknown } | null;
  parts: BundlePart[];
  position: number;
}

export interface BundleFluid {
  organ: string;
  fluid: string;
  standard: string | null;
  viscosity: string | null;
  capacity: string | null;
  capacityMaxL: number | null;
  note: string | null;
  source: { id: string; page: unknown } | null;
}

export interface BundleCatalogPart extends BundlePart {
  catalog: { group: string | null; subgroup: string | null; plate: string | null; item: string | null; drawing: string | null };
  operations: string[];
  note: string | null;
}

export interface EquipmentBundle {
  model: { slug: string; brand: string; model: string; manufacturerType: string | null; sources: unknown[]; warning: string | null };
  machine: { serialNumber: string | null; year: number | null; options: string[]; absentOptions: string[]; aggregates: { organ: string; designation?: string; serial?: string }[] };
  technical: unknown;
  operations: BundleOperation[];
  fluids: BundleFluid[];
  parts: BundleCatalogPart[];
  warnings: string[];
}

const KINDS: Record<string, OperationKind> = {
  controle: "inspection",
  nettoyage: "cleaning",
  graissage: "greasing",
  remplacement: "replacement",
  vidange: "oil_change",
  reglage: "adjustment",
  purge: "bleeding",
};

/** Options de la base (français) → codes Fourmy, et mots qui les désignent dans les libellés. */
export const OPTION_CODES: Record<string, { code: string; label: string; match: RegExp }> = {
  pdf_avant: { code: "front_pto", label: "Prise de force avant", match: /prise de force av/i },
  relevage_avant: { code: "front_linkage", label: "Relevage avant", match: /relevage avant/i },
  freinage_pneumatique_remorque: { code: "trailer_air_brake", label: "Freinage pneumatique de remorque", match: /freinage pneumatique/i },
};
export const optionCode = (raw: string) => OPTION_CODES[raw]?.code ?? raw.toLowerCase().replace(/[^a-z0-9]+/g, "_");
export const optionLabelByCode = (code: string) => Object.values(OPTION_CODES).find((o) => o.code === code)?.label ?? code.replace(/_/g, " ");
export const optionLabel = (raw: string) => OPTION_CODES[raw]?.label ?? raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const AGGREGATES: Record<string, string> = {
  moteur: "Moteur",
  boite: "Boîte",
  transmission: "Transmission",
  cabine: "Cabine",
  essieu_avant: "Essieu avant",
  essieu_arriere: "Essieu arrière",
};

export const normReference = (s: string) => s.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const frNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** CSV simple (virgule, guillemets doubles), première ligne = en-têtes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** Capacité de la notice → litres à prévoir (borne haute ; « 2 x 0,6 » = 1,2). Null si autre unité. */
export function capacityLiters(text: string | null): number | null {
  if (!text) return null;
  if (/kg|g\b/i.test(text)) return null;
  const mult = text.match(/^\s*(\d+)\s*[x×]\s*([\d,.]+)/i);
  if (mult) return Math.round(Number(mult[1]) * Number(mult[2]!.replace(",", ".")) * 100) / 100;
  const nums = [...text.matchAll(/\d+(?:[,.]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  return nums.length ? Math.max(...nums) : null;
}

function parseJson(files: Record<string, string>, path: string, warnings: string[], required = false): Record<string, unknown> | null {
  const text = files[path];
  if (text === undefined) {
    if (required) throw new Error(`Fichier ${path} manquant.`);
    warnings.push(`Fichier ${path} absent.`);
    return null;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Fichier ${path} : JSON invalide.`);
  }
}

const sourceOf = (s: unknown) => {
  const o = s as { id?: unknown; page?: unknown } | null;
  return o && typeof o.id === "string" ? { id: o.id, page: o.page ?? null } : null;
};

export function parseEquipmentBundle(files: Record<string, string>): EquipmentBundle {
  const warnings: string[] = [];
  const machine = parseJson(files, "machine.json", warnings, true)!;
  const brand = str(machine.marque);
  const model = str(machine.modele);
  if (!brand || !model) throw new Error("machine.json : marque et modèle requis.");
  const sources = (parseJson(files, "sources.json", warnings) as unknown as unknown[] | null) ?? [];
  const technical = parseJson(files, "fiche_technique.json", warnings);
  const plan = parseJson(files, "entretien/plan_entretien.json", warnings);

  const absentOptions = Array.isArray(machine.options_absentes_usine) ? (machine.options_absentes_usine as string[]) : [];
  const options = Array.isArray(machine.options) ? (machine.options as string[]) : [];
  const optionOf = (label: string) => Object.entries(OPTION_CODES).find(([, o]) => o.match.test(label))?.[0] ?? null;

  const operations: BundleOperation[] = [];
  const rawOps = Array.isArray(plan?.operations) ? (plan!.operations as Record<string, unknown>[]) : [];
  rawOps.forEach((o, i) => {
    const code = str(o.id) ?? `OP${i + 1}`;
    const label = str(o.libelle) ?? code;
    const type = str(o.type) ?? "";
    const kind = KINDS[type];
    if (!kind) warnings.push(`${code} : type « ${type} » inconnu, classé en contrôle.`);
    const per = (o.periodicite ?? {}) as Record<string, unknown>;
    const source = sourceOf(o.source);
    if (!source) warnings.push(`${code} : opération sans source.`);
    const opt = optionOf(label);
    const parts = Array.isArray(o.pieces)
      ? (o.pieces as Record<string, unknown>[]).flatMap((p) => {
          const reference = str(p.reference);
          if (!reference) return [];
          return [{ reference, referenceNorm: normReference(reference), designation: str(p.designation) ?? reference, quantity: frNumber(p.quantite) ?? 1, family: str(p.famille) }];
        })
      : [];
    operations.push({
      code,
      manualNumber: o.num_notice === null || o.num_notice === undefined ? null : String(o.num_notice),
      label,
      kind: kind ?? "inspection",
      everyHours: frNumber(per.heures),
      everyMonths: frNumber(per.mois),
      firstHours: null,
      performer: o.realise_par === "atelier_agree" ? "workshop" : "member",
      requiresOption: opt ? optionCode(opt) : null,
      condition: str(o.note),
      source,
      parts,
      position: i,
    });
  });
  // Visites initiales : une opération ponctuelle par visite.
  const visits = Array.isArray(plan?.visites_initiales) ? (plan!.visites_initiales as Record<string, unknown>[]) : [];
  visits.forEach((v, i) => {
    const hours = frNumber(v.heures);
    if (!hours) return;
    const included = Array.isArray(v.operations) ? (v.operations as string[]) : [];
    const labels = included.map((c) => operations.find((o) => o.code === c)?.label ?? c);
    operations.push({
      code: `V${hours}`,
      manualNumber: null,
      label: `Visite des ${hours.toLocaleString("fr-FR")} premières heures`,
      kind: "visit",
      everyHours: null,
      everyMonths: null,
      firstHours: hours,
      performer: v.realise_par === "atelier_agree" ? "workshop" : "member",
      requiresOption: null,
      condition: [str(v.note), labels.length ? `Comprend : ${labels.join(" ; ")}.` : null].filter(Boolean).join(" ") || null,
      source: sourceOf(v.source),
      parts: [],
      position: rawOps.length + i,
    });
  });

  const fluids: BundleFluid[] = [];
  if (files["entretien/fluides.csv"] !== undefined) {
    for (const r of parseCsv(files["entretien/fluides.csv"])) {
      if (!r.organe || !r.fluide) continue;
      const capacity = r.capacite_l || null;
      fluids.push({
        organ: r.organe,
        fluid: r.fluide,
        standard: r.norme || null,
        viscosity: r.viscosite || null,
        capacity,
        capacityMaxL: capacityLiters(capacity),
        note: r.note || null,
        source: r.source_id ? { id: r.source_id, page: r.page || null } : null,
      });
    }
  } else warnings.push("Fichier entretien/fluides.csv absent.");

  const parts: BundleCatalogPart[] = [];
  if (files["pieces/pieces_entretien.csv"] !== undefined) {
    const seen = new Set<string>();
    for (const r of parseCsv(files["pieces/pieces_entretien.csv"])) {
      if (!r.reference) continue;
      const referenceNorm = r.reference_norm || normReference(r.reference);
      const key = `${referenceNorm}|${r.famille ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push({
        reference: r.reference,
        referenceNorm,
        designation: r.designation || r.reference,
        quantity: frNumber(r.quantite) ?? 1,
        family: r.famille || null,
        catalog: { group: r.groupe || null, subgroup: r.sous_groupe || null, plate: r.planche || null, item: r.rep || null, drawing: r.dessin || null },
        operations: (r.operations ?? "").split(/[;,\s]+/).filter(Boolean),
        note: [r.complement, r.note].filter(Boolean).join(" ; ") || null,
      });
    }
  } else warnings.push("Fichier pieces/pieces_entretien.csv absent.");

  const warning = str(plan?.avertissement) ?? str((technical as Record<string, unknown> | null)?.avertissement);
  const aggregates = Object.entries((machine.agregats ?? {}) as Record<string, unknown>).flatMap(([k, v]) => {
    const s = str(v);
    if (!s) return [];
    const [designation, ...rest] = s.split(/\s+/);
    return [{ organ: AGGREGATES[k] ?? k, designation, serial: rest.join(" ") || undefined }];
  });
  return {
    model: {
      slug: slugify(`${brand} ${model} ${str(machine.type_constructeur) ?? ""}`),
      brand,
      model,
      manufacturerType: str(machine.type_constructeur),
      sources: Array.isArray(sources) ? sources : [],
      warning,
    },
    machine: { serialNumber: str(machine.numero_serie), year: frNumber(machine.annee), options, absentOptions, aggregates },
    technical,
    operations,
    fluids,
    parts,
    warnings,
  };
}
