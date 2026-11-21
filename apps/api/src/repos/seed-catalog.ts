import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { tgwReference } from "@fourmy/certification-refs";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { SeedAttachProposal, SeedCatalogItem, SeedCreate, SeedDetail, SeedTgwReference } from "@fourmy/contracts";
import { looksLikeMixture, parseSeedUnit } from "@fourmy/domain";
import { BadRequest } from "../routes/helpers.js";
import { getSeedIn } from "./seeds.js";
import { legumeOf } from "./taxonomy.js";

/**
 * Catalogue des variétés et rattachement des semences (lot SE4,
 * claudedocs/conception_semences.md §4 et §7) : recherche au catalogue GNIS
 * (SEMAE via Lexicon), création d'une semence, propositions de rattachement
 * d'une semence importée ou ancienne à son espèce et à sa variété.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Clé de comparaison : minuscules, sans accents ni apostrophes, sans « de », « d' », « du »… */
export function labelKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’'`\-_/().,]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["de", "d", "du", "des", "la", "le", "les"].includes(w))
    .join(" ");
}

/** « KWS PURSANT » → « Kws Pursant » ; les codes (« LG31229 ») restent tels quels. */
export function displayVariety(name: string): string {
  if (/\d/.test(name)) return name;
  return name.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

/** « FETUQUE DES PRES » → « Fétuque des prés » n'est pas possible sans accents : « Fetuque des pres ». */
export function displayLabel(label: string): string {
  const l = label.toLowerCase();
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/** Semences vendues à la dose : grains par dose usuels, à confirmer sur l'étiquette. */
const DOSE_SPECIES: Record<string, number> = { zea_mays: 50_000, helianthus_annuus: 150_000 };

function referenceView(species: string): SeedTgwReference | null {
  const r = tgwReference(species);
  return r ? { label: r.label, typicalG: r.typicalG, minG: r.minG, maxG: r.maxG, typicalStated: r.typicalStated, org: r.source.org, url: r.source.url, note: r.note ?? null } : null;
}

/** Recherche au catalogue : variété ou espèce, 20 résultats, les débuts de nom d'abord. */
export async function searchCatalog(db: Database, farmId: string, q: string, species?: string): Promise<SeedCatalogItem[]> {
  const key = q
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[%_\\]/g, "");
  if (key.length < 2) return [];
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<{ gnis_code: string; variety_name: string; species: string; species_label: string | null; tax_label: string | null; registered_on: string | null; legume: boolean }>(
      tx,
      sql`SELECT v.gnis_code, v.variety_name, v.species, v.species_label, t.label AS tax_label, v.registered_on::text AS registered_on,
                 ${legumeOf(sql`v.species`)} AS legume
          FROM lexicon_seed_varieties v LEFT JOIN taxonomy t ON t.reference_name = v.species
          WHERE v.search LIKE ${`%${key}%`} ${species ? sql`AND v.species = ${species}` : sql``}
          ORDER BY (v.search LIKE ${`${key}%`}) DESC, v.variety_name
          LIMIT 20`,
    );
    return list.map((v) => ({
      gnisCode: v.gnis_code,
      varietyName: displayVariety(v.variety_name),
      species: v.species,
      speciesLabel: v.tax_label ?? (v.species_label ? displayLabel(v.species_label) : v.species),
      registeredOn: v.registered_on,
      legume: v.legume,
      reference: referenceView(v.species),
      proposedUnit: DOSE_SPECIES[v.species] ? "dose" : "kilogram",
      proposedGrainsPerDose: DOSE_SPECIES[v.species] ?? null,
    }));
  });
}

/** Crée une semence (article et fiche) : depuis le catalogue, ou saisie libre (FR-SE-10, 11). */
export async function createSeed(db: Database, farmId: string, userId: string, w: SeedCreate, at: string): Promise<SeedDetail> {
  if (!parseSeedUnit(w.unit, w.sheet.grainsPerDose)) throw new BadRequest(`Unité ${w.unit} non reconnue pour une semence.`);
  return withFarm(db, farmId, async (tx) => {
    const id = randomUUID();
    const s = w.sheet;
    await tx.execute(sql`INSERT INTO articles (id, farm_id, name, kind, unit, custom) VALUES (${id}, ${farmId}, ${w.name}, 'seed', ${w.unit}, ${JSON.stringify({ source: "seeds" })}::jsonb)`);
    await tx.execute(sql`
      INSERT INTO article_seeds (article_id, farm_id, species, variety_name, gnis_code, category, is_mixture, grains_per_dose, bag_kg, tgw_g, tgw_origin, tgw_on, updated_by)
      VALUES (${id}, ${farmId}, ${s.species}, ${s.varietyName}, ${s.gnisCode}, ${s.category}, ${s.isMixture}, ${s.grainsPerDose}, ${s.bagKg}, ${s.tgwG}, ${s.tgwOrigin}, ${s.tgwOn}, ${userId})`);
    return getSeedIn(tx, id, at);
  });
}

// --- Rattachement -------------------------------------------------------------------

type Candidate = {
  id: string;
  name: string;
  lexicon_ref: string | null;
  imported_species: string | null;
  imported_gnis: string | null;
  sheet_species: string | null;
  sheet_gnis: string | null;
  sheet_variety: string | null;
  is_mixture: boolean | null;
  has_tgw: boolean;
};

type SpeciesIndex = { byKey: Map<string, { species: string; label: string }>; byRef: Map<string, string>; labelOf: Map<string, string> };

/** Espèces de la taxonomie et du catalogue, par clé de libellé. */
async function speciesIndex(tx: Tx): Promise<SpeciesIndex> {
  const list = await rows<{ species: string; label: string; source: string }>(
    tx,
    sql`SELECT reference_name AS species, label, 'taxonomy' AS source FROM taxonomy WHERE rank = 'specie' AND label IS NOT NULL
        UNION ALL
        SELECT DISTINCT ON (species) species, species_label AS label, 'catalog' AS source FROM lexicon_seed_varieties WHERE species_label IS NOT NULL`,
  );
  const byKey = new Map<string, { species: string; label: string }>();
  const labelOf = new Map<string, string>();
  const byRef = new Map<string, string>();
  for (const s of list) {
    // Libellé lisible : celui de la taxonomie d'abord.
    if (s.source === "taxonomy" || !labelOf.has(s.species)) labelOf.set(s.species, s.source === "taxonomy" ? s.label : displayLabel(s.label));
    const key = labelKey(s.label);
    // Une clé partagée par deux espèces est ambiguë : écartée.
    const seen = byKey.get(key);
    if (seen && seen.species !== s.species) byKey.set(key, { species: "", label: "" });
    else byKey.set(key, { species: s.species, label: s.label });
    byRef.set(s.species, s.species);
  }
  return { byKey, byRef, labelOf };
}

/**
 * Libellé d'une espèce : celui de la taxonomie (accents) s'il désigne la même
 * chose que celui du catalogue ; sinon celui du catalogue (« FETUQUE ELEVEE »
 * sous le taxon `festuca`, qui regroupe toutes les fétuques).
 */
function speciesLabelOf(idx: SpeciesIndex, species: string, catalogLabel: string | null): string | null {
  const tax = idx.labelOf.get(species) ?? null;
  if (!catalogLabel) return tax;
  return tax && labelKey(tax) === labelKey(catalogLabel) ? tax : displayLabel(catalogLabel);
}

/** Espèce d'après un libellé (« Colza oléagineux » → colza, en retirant les derniers mots si besoin). */
function speciesFromLabel(idx: SpeciesIndex, label: string): { species: string; exact: boolean } | null {
  const words = labelKey(label).split(" ").filter(Boolean);
  if (!words.length) return null;
  for (let n = words.length; n >= 1; n--) {
    const hit = idx.byKey.get(words.slice(0, n).join(" "));
    if (hit?.species) return { species: hit.species, exact: n === words.length };
  }
  // Libellé contenu dans un seul autre (« Féverole » ⊂ « Fève ou féverole »).
  const found = new Set<string>();
  for (const [key, hit] of idx.byKey) {
    if (hit.species && words.every((w) => key.split(" ").includes(w))) found.add(hit.species);
  }
  return found.size === 1 ? { species: [...found][0]!, exact: false } : null;
}

/**
 * Nom d'une semence reprise d'Ekylibre : « Semence(s) de maïs - DKC5065 »,
 * « Semence d'avoine ». L'espèce, et la variété après le tiret.
 */
export function nameParts(name: string): { species: string; variety: string | null } | null {
  const m = /^semences?\s+(?:de\s+|d['’]\s*)(.+?)(?:\s+-\s+(.+))?$/i.exec(name.replace(/\s+/g, " ").trim());
  if (!m) return null;
  return { species: m[1]!.trim(), variety: m[2]?.trim() || null };
}

/** Propositions de rattachement, pour les semences sans espèce ni mélange (ou pour celles demandées). */
async function proposalsIn(tx: Tx, articleIds?: string[]): Promise<SeedAttachProposal[]> {
  const candidates = await rows<Candidate>(
    tx,
    sql`SELECT a.id, a.name, a.lexicon_ref, nullif(a.custom->>'species', '') AS imported_species, nullif(a.custom->>'gnis', '') AS imported_gnis,
               s.species AS sheet_species, s.gnis_code AS sheet_gnis, s.variety_name AS sheet_variety, s.is_mixture, s.tgw_g IS NOT NULL AS has_tgw
        FROM articles a LEFT JOIN article_seeds s ON s.article_id = a.id
        WHERE a.kind = 'seed' AND s.species IS NULL AND NOT coalesce(s.is_mixture, false)
          ${articleIds ? sql`AND a.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(articleIds)}::jsonb)::uuid)` : sql``}
        ORDER BY a.name`,
  );
  if (!candidates.length) return [];
  const idx = await speciesIndex(tx);
  const codes = [...new Set(candidates.map((c) => c.sheet_gnis ?? c.imported_gnis).filter((v): v is string => !!v))];
  const catalog = new Map(
    (
      await rows<{ gnis_code: string; species: string; variety_name: string; species_label: string | null }>(
        tx,
        sql`SELECT gnis_code, species, variety_name, species_label FROM lexicon_seed_varieties WHERE gnis_code IN (SELECT jsonb_array_elements_text(${JSON.stringify(codes)}::jsonb))`,
      )
    ).map((v) => [v.gnis_code, v]),
  );
  // Variété d'après le nom de l'article : seulement si le nom n'appartient qu'à une variété du catalogue.
  const plain = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  const names = [...new Set(candidates.flatMap((c) => [plain(c.name), ...(nameParts(c.name)?.variety ? [plain(nameParts(c.name)!.variety!)] : [])]))];
  const byName = new Map<string, { gnis_code: string; species: string; variety_name: string }[]>();
  for (const v of await rows<{ gnis_code: string; species: string; variety_name: string; key: string }>(
    tx,
    sql`SELECT gnis_code, species, variety_name, lower(translate(variety_name, 'ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'AAAEEEEIIOOUUUC')) AS key
        FROM lexicon_seed_varieties
        WHERE lower(translate(variety_name, 'ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'AAAEEEEIIOOUUUC')) IN (SELECT jsonb_array_elements_text(${JSON.stringify(names)}::jsonb))`,
  )) {
    byName.set(v.key, [...(byName.get(v.key) ?? []), v]);
  }

  const out: SeedAttachProposal[] = [];
  for (const c of candidates) {
    const base = { articleId: c.id, name: c.name };
    const code = c.sheet_gnis ?? c.imported_gnis;
    const hit = code ? catalog.get(code) : undefined;
    if (hit) {
      // Le fichier nomme une autre espèce que le catalogue : à vérifier.
      const imported = c.imported_species ? speciesFromLabel(idx, c.imported_species) : null;
      // Espèce importée non reconnue : comparer les libellés (« Fétuque élevée » / « FETUQUE DES PRES »).
      const a = c.imported_species ? labelKey(c.imported_species) : "";
      const b = labelKey(hit.species_label ?? idx.labelOf.get(hit.species) ?? "");
      // Le catalogue range parfois plusieurs espèces sous un taxon (toutes les fétuques sous `festuca`) : les libellés comptent aussi.
      const disagree = (!!imported && imported.species !== hit.species) || (!!a && !!b && !a.includes(b) && !b.includes(a));
      out.push({
        ...base,
        species: hit.species,
        speciesLabel: speciesLabelOf(idx, hit.species, hit.species_label),
        varietyName: c.sheet_variety ?? displayVariety(hit.variety_name),
        gnisCode: hit.gnis_code,
        isMixture: false,
        reason: disagree
          ? `code GNIS ${hit.gnis_code} au catalogue officiel, mais le fichier indique « ${c.imported_species} »`
          : `code GNIS ${hit.gnis_code} au catalogue officiel`,
        sure: !disagree,
        approximate: disagree,
      });
      continue;
    }
    if (looksLikeMixture(c.name, c.imported_species)) {
      if (!c.has_tgw) {
        const declared = !!c.imported_species && /m[ée]lange/i.test(c.imported_species);
        out.push({ ...base, species: null, speciesLabel: null, varietyName: null, gnisCode: code, isMixture: true, reason: declared ? `espèce importée « ${c.imported_species} »` : "nom d'un mélange", sure: false, approximate: !declared });
      }
      continue;
    }
    const fromImport = c.imported_species ? speciesFromLabel(idx, c.imported_species) : null;
    const refBase = c.lexicon_ref?.replace(/_seeds?$/, "") ?? null;
    const fromRef = refBase ? (idx.byRef.has(refBase) ? { species: refBase, exact: true } : speciesFromLabel(idx, refBase.replace(/_/g, " "))) : null;
    const variety = byName.get(plain(c.name));
    const fromVariety = variety && variety.length === 1 ? variety[0]! : null;
    // Nom repris d'Ekylibre : « Semence de maïs - DKC5065 » donne l'espèce, et la variété si le catalogue la connaît pour cette espèce.
    const parts = nameParts(c.name);
    const fromName = parts ? speciesFromLabel(idx, parts.species) : null;
    const species = fromImport ?? fromRef ?? (fromVariety ? { species: fromVariety.species, exact: true } : null) ?? fromName;
    if (!species) continue;
    const named = parts?.variety ? (byName.get(plain(parts.variety)) ?? []).filter((v) => v.species === species.species) : [];
    const varietyMatch = fromVariety && fromVariety.species === species.species ? fromVariety : named.length === 1 ? named[0]! : null;
    out.push({
      ...base,
      species: species.species,
      speciesLabel: idx.labelOf.get(species.species) ?? null,
      varietyName: c.sheet_variety ?? (varietyMatch ? displayVariety(varietyMatch.variety_name) : species === fromName ? (parts?.variety ?? null) : null),
      gnisCode: code ?? varietyMatch?.gnis_code ?? null,
      isMixture: false,
      reason: fromImport
        ? `espèce importée « ${c.imported_species} »${fromImport.exact ? "" : " (libellé proche)"}`
        : fromRef
          ? `référence Lexicon ${c.lexicon_ref}`
          : fromVariety
            ? `variété ${displayVariety(fromVariety.variety_name)} au catalogue`
            : `nom « ${c.name} »${varietyMatch ? ", variété au catalogue" : ""}`,
      sure: false,
      approximate: !species.exact || (!fromImport && !fromRef && species !== fromName),
    });
  }
  return out;
}

export async function seedAttachProposals(db: Database, farmId: string): Promise<SeedAttachProposal[]> {
  return withFarm(db, farmId, (tx) => proposalsIn(tx));
}

/**
 * Applique les propositions des semences choisies : espèce, variété et code
 * GNIS (sans écraser ce qui est déjà saisi), ou mélange. Le PMG n'est pas
 * touché. `keep` : les propositions retenues (toutes par défaut).
 */
export async function attachSeedsIn(
  tx: Tx,
  farmId: string,
  userId: string | null,
  articleIds: string[] | undefined,
  keep: (p: SeedAttachProposal) => boolean = () => true,
): Promise<SeedAttachProposal[]> {
  const proposals = (await proposalsIn(tx, articleIds)).filter(keep);
  for (const p of proposals) {
    await tx.execute(sql`
      INSERT INTO article_seeds (article_id, farm_id, species, variety_name, gnis_code, is_mixture, updated_by)
      VALUES (${p.articleId}, ${farmId}, ${p.species}, ${p.varietyName}, ${p.gnisCode}, ${p.isMixture}, ${userId})
      ON CONFLICT (article_id) DO UPDATE SET
        species = EXCLUDED.species,
        variety_name = coalesce(article_seeds.variety_name, EXCLUDED.variety_name),
        gnis_code = coalesce(article_seeds.gnis_code, EXCLUDED.gnis_code),
        is_mixture = EXCLUDED.is_mixture,
        updated_by = EXCLUDED.updated_by, updated_at = now()`);
    await tx.execute(sql`UPDATE articles SET updated_at = now() WHERE id = ${p.articleId}`);
  }
  return proposals;
}

export async function attachSeeds(db: Database, farmId: string, userId: string, articleIds: string[]): Promise<SeedAttachProposal[]> {
  return withFarm(db, farmId, (tx) => attachSeedsIn(tx, farmId, userId, articleIds));
}

/** Import d'un fichier : propositions sûres ou exactes seulement (rien d'approché). */
export const importAttachable = (p: SeedAttachProposal) => p.sure || !p.approximate;

