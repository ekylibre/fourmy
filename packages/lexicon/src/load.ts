import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import type { Sql, TransactionSql } from "postgres";
import { fetchIndex, fetchManifest, fetchStructure, packageUrl, parseStructure, type PackageManifest } from "./packages.js";

/**
 * Copie des paquets Lexicon dans les tables de référence de Fourmy
 * (migrations 0009, 0011) : `phytosanitary` (produits, usages, ensembles de
 * cultures, cibles PFI), `taxonomy` (parenté des espèces), `productions`
 * (activités de référence, culture IFT) et `agricultural_pictures` (images). Une version
 * déjà chargée n'est pas retéléchargée ; une nouvelle version remplace
 * l'ancienne d'un bloc, dans une transaction (tout ou rien).
 */

/** Colonnes indispensables, par table Lexicon : sinon, structure inattendue → refus. */
const REQUIRED: Record<string, string[]> = {
  registered_phytosanitary_products: ["id", "name", "other_names", "natures", "active_compounds", "france_maaid", "in_field_reentry_delay", "state", "started_on", "stopped_on", "firm_name", "product_type", "is_derogation"],
  registered_phytosanitary_usages: ["id", "product_id", "ephy_usage_phrase", "crop_label_fra", "species", "target_name_label_fra", "treatment", "dose_quantity", "dose_unit", "dose_unit_name", "pre_harvest_delay", "applications_count", "applications_frequency", "untreated_buffer_aquatic", "untreated_buffer_arthropod", "untreated_buffer_plants", "usage_conditions", "decision_date", "state", "is_derogation", "derogation_started_on", "derogation_stopped_on"],
  registered_phytosanitary_cropsets: ["name", "label", "crop_names"],
  registered_phytosanitary_target_name_to_pfi_targets: ["ephy_name", "pfi_id", "pfi_name"],
  master_taxonomy: ["reference_name", "parent", "taxonomic_rank", "translation_id"],
  taxonomy__translations: ["id", "fra"],
  master_productions: ["reference_name", "activity_family", "specie", "usage", "life_duration", "support_unit", "color", "translation_id"],
  productions__translations: ["id", "fra", "eng"],
  master_crop_production_tfi_codes: ["tfi_code", "tfi_label", "production", "tfi_crop_group", "campaign"],
  master_agricultural_pictures: ["domain", "name", "extension", "picture"],
};

const PACKAGES: { name: string; tables: string[] }[] = [
  { name: "phytosanitary", tables: ["registered_phytosanitary_products", "registered_phytosanitary_usages", "registered_phytosanitary_cropsets", "registered_phytosanitary_target_name_to_pfi_targets"] },
  { name: "taxonomy", tables: ["master_taxonomy", "taxonomy__translations"] },
  { name: "productions", tables: ["master_productions", "productions__translations", "master_crop_production_tfi_codes"] },
  { name: "agricultural_pictures", tables: ["master_agricultural_pictures"] },
];

/** Passage des tables temporaires (texte) aux tables de Fourmy, typées. */
const TRANSFORMS: Record<string, string[]> = {
  phytosanitary: [
    `TRUNCATE phyto_products, phyto_usages, phyto_cropsets, phyto_target_pfi`,
    `INSERT INTO phyto_products (id, amm, name, other_names, natures, active_compounds, reentry_delay_hours,
                                 state, started_on, stopped_on, firm, product_type, is_derogation)
     SELECT id::int, france_maaid, name,
            coalesce(other_names::text[], '{}'), coalesce(natures::text[], '{}'), coalesce(active_compounds::text[], '{}'),
            round(extract(epoch FROM in_field_reentry_delay::interval) / 3600)::int,
            state, started_on::date, stopped_on::date, firm_name, product_type, coalesce(is_derogation::boolean, false)
     FROM lx_registered_phytosanitary_products`,
    `INSERT INTO phyto_usages (id, product_id, phrase, crop_label, species, target_label, treatment_label,
                               dose_quantity, dose_unit, dose_unit_label, pre_harvest_delay_days, applications_count,
                               applications_frequency_days, untreated_buffer_aquatic, untreated_buffer_arthropod,
                               untreated_buffer_plants, usage_conditions, decision_date, state, is_derogation,
                               derogation_started_on, derogation_stopped_on)
     SELECT id, product_id::int, ephy_usage_phrase, crop_label_fra, coalesce(species::text[], '{}'),
            target_name_label_fra, treatment::jsonb ->> 'fra',
            dose_quantity::numeric, dose_unit, dose_unit_name,
            ceil(extract(epoch FROM pre_harvest_delay::interval) / 86400)::int, applications_count::int,
            ceil(extract(epoch FROM applications_frequency::interval) / 86400)::int,
            untreated_buffer_aquatic::int, untreated_buffer_arthropod::int, untreated_buffer_plants::int,
            usage_conditions, decision_date::date, state, coalesce(is_derogation::boolean, false),
            derogation_started_on::date, derogation_stopped_on::date
     FROM lx_registered_phytosanitary_usages`,
    `INSERT INTO phyto_cropsets (name, label, crop_names)
     SELECT name, label::jsonb ->> 'fra', coalesce(crop_names::text[], '{}') FROM lx_registered_phytosanitary_cropsets`,
    `INSERT INTO phyto_target_pfi (ephy_name, pfi_id, pfi_name)
     SELECT ephy_name, pfi_id::int, pfi_name FROM lx_registered_phytosanitary_target_name_to_pfi_targets`,
  ],
  taxonomy: [
    `TRUNCATE taxonomy`,
    `INSERT INTO taxonomy (reference_name, parent, rank, label)
     SELECT t.reference_name, t.parent, t.taxonomic_rank, tr.fra
     FROM lx_master_taxonomy t LEFT JOIN lx_taxonomy__translations tr ON tr.id = t.translation_id`,
  ],
  // Productions de référence (activités) et leur culture IFT (migration 0011).
  productions: [
    `TRUNCATE lexicon_productions, lexicon_production_ift`,
    `INSERT INTO lexicon_productions (reference_name, family, specie, usage, label, label_en, color, life_years, support_unit)
     SELECT p.reference_name, p.activity_family, nullif(p.specie, ''), nullif(p.usage, ''),
            coalesce(tr.fra, p.reference_name), tr.eng, nullif(p.color, ''),
            round((extract(epoch FROM nullif(p.life_duration, '')::interval) / 31557600)::numeric, 1), p.support_unit
     FROM lx_master_productions p LEFT JOIN lx_productions__translations tr ON tr.id = p.translation_id`,
    `INSERT INTO lexicon_production_ift (production, ift_culture, ift_label, crop_group, campaign)
     SELECT production, tfi_code, tfi_label, tfi_crop_group, campaign::int
     FROM lx_master_crop_production_tfi_codes WHERE coalesce(production, '') <> ''`,
  ],
  // Images (familles d'activité, variétés) ; une seule par nom.
  agricultural_pictures: [
    `TRUNCATE lexicon_pictures`,
    `INSERT INTO lexicon_pictures (domain, name, extension, picture)
     SELECT DISTINCT ON (domain, name) domain, name, extension, decode(substr(picture, 3), 'hex')
     FROM lx_master_agricultural_pictures WHERE left(picture, 2) = '\\x'
     ORDER BY domain, name, (extension = 'png') DESC`,
  ],
};

export interface PackageReport {
  name: string;
  version: string;
  status: "loaded" | "up-to-date";
  rows: number;
}

export interface SyncOptions {
  /** Adresse du serveur de paquets (ex. http://127.0.0.1:8889). */
  base: string;
  /** Recharger même si la version est déjà en base. */
  force?: boolean;
  fetchImpl?: typeof fetch;
}

/** Synchronise le référentiel dans une transaction (tout ou rien). */
export async function syncLexicon(sql: Sql, opts: SyncOptions): Promise<PackageReport[]> {
  return sql.begin((tx) => syncLexiconIn(tx, opts)) as Promise<PackageReport[]>;
}

/** Même chose, dans une transaction fournie (tests : annulée à la fin). */
export async function syncLexiconIn(tx: TransactionSql, { base, force = false, fetchImpl = fetch }: SyncOptions): Promise<PackageReport[]> {
  const index = await fetchIndex(base, fetchImpl);
  const reports: PackageReport[] = [];
  for (const pkg of PACKAGES) {
    const version = index.datasources[pkg.name]?.current;
    if (!version) throw new Error(`Lexicon : paquet « ${pkg.name} » absent de l'index`);
    const [loaded] = await tx<{ version: string; rows: number }[]>`SELECT version, rows FROM lexicon_packages WHERE name = ${pkg.name}`;
    if (!force && loaded?.version === version) {
      reports.push({ name: pkg.name, version, status: "up-to-date", rows: loaded.rows });
      continue;
    }
    const manifest = await fetchManifest(base, pkg.name, version, fetchImpl);
    const columns = parseStructure(await fetchStructure(base, pkg.name, version, fetchImpl));
    let rows = 0;
    for (const table of pkg.tables) rows += await stage(tx, base, manifest, table, columns.get(table), fetchImpl);
    for (const statement of TRANSFORMS[pkg.name]!) await tx.unsafe(statement);
    await tx`
      INSERT INTO lexicon_packages (name, version, source, rows, loaded_at)
      VALUES (${pkg.name}, ${version}, ${base}, ${rows}, now())
      ON CONFLICT (name) DO UPDATE SET version = excluded.version, source = excluded.source, rows = excluded.rows, loaded_at = now()`;
    reports.push({ name: pkg.name, version, status: "loaded", rows });
  }
  return reports;
}

/** Table temporaire (colonnes texte) remplie par COPY depuis les CSV gzip du paquet. */
async function stage(
  tx: TransactionSql,
  base: string,
  manifest: PackageManifest,
  table: string,
  columns: string[] | undefined,
  fetchImpl: typeof fetch,
): Promise<number> {
  const required = REQUIRED[table]!;
  const missing = required.filter((c) => !columns?.includes(c));
  if (!columns || missing.length) throw new Error(`Lexicon : structure inattendue pour ${table} (colonnes manquantes : ${missing.join(", ") || "table absente"})`);
  const entry = manifest.tables.find((t) => t.name === table);
  if (!entry) throw new Error(`Lexicon : ${table} absente du manifeste ${manifest.name} ${manifest.version}`);
  const staging = `lx_${table}`;
  await tx.unsafe(`CREATE TEMP TABLE ${staging} (${columns.map((c) => `"${c}" text`).join(", ")}) ON COMMIT DROP`);
  for (const file of entry.files) {
    const res = await fetchImpl(packageUrl(base, manifest.name, manifest.version, file.path), { signal: AbortSignal.timeout(300_000) });
    if (!res.ok || !res.body) throw new Error(`Lexicon : ${file.path} → HTTP ${res.status}`);
    const writable = await tx.unsafe(`COPY ${staging} FROM STDIN WITH (FORMAT csv)`).writable();
    await pipeline(Readable.fromWeb(res.body as never), createGunzip(), writable);
  }
  const [{ n }] = (await tx.unsafe(`SELECT count(*)::int AS n FROM ${staging}`)) as unknown as [{ n: number }];
  if (n !== entry.rows) throw new Error(`Lexicon : ${table} — ${n} lignes lues pour ${entry.rows} annoncées`);
  return n;
}
