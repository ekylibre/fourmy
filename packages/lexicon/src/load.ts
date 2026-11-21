import { createHash } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import type { Sql, TransactionSql } from "postgres";
import { fetchIndex, fetchManifest, fetchStructure, packageUrl, parseStructure, withApiKey, type PackageManifest } from "./packages.js";

/**
 * Copie des paquets Lexicon dans les tables de référence de Fourmy
 * (migrations 0009, 0011) : `phytosanitary` (produits, usages, ensembles de
 * cultures, cibles PFI), `taxonomy` (parenté des espèces), `productions`
 * (activités de référence, culture IFT) et `agricultural_pictures` (images) ;
 * `agroedi` (dictionnaire AgroEDI, réservé aux adhérents : seulement avec une
 * clé, ignoré s'il manque à l'index) ; `protected_water_zones` et
 * `protected_natural_zones` (aires de captage, Natura 2000 : assolement,
 * ignorés s'ils manquent à l'index) ; `seed_varieties` (catalogue des
 * variétés SEMAE : semences, ignoré s'il manque à l'index) ; rendements Agreste
 * et prix des productions (tables facultatives de `productions`) et
 * `eu_market_prices` (relevés français ; temps 3 de l'assolement). Une version déjà chargée n'est pas
 * retéléchargée ; une nouvelle version remplace l'ancienne d'un bloc, dans
 * une transaction (tout ou rien). Chaque fichier est vérifié par son sha256
 * quand le manifeste le donne.
 */

/** Colonnes indispensables, par table Lexicon : sinon, structure inattendue → refus. */
const REQUIRED: Record<string, string[]> = {
  registered_phytosanitary_products: ["id", "name", "other_names", "natures", "active_compounds", "france_maaid", "in_field_reentry_delay", "state", "started_on", "stopped_on", "firm_name", "product_type", "is_derogation", "mix_category_codes", "allowed_mentions", "restricted_mentions", "operator_protection_mentions"],
  registered_phytosanitary_usages: ["id", "product_id", "ephy_usage_phrase", "crop_label_fra", "species", "target_name_label_fra", "treatment", "dose_quantity", "dose_unit", "dose_unit_name", "pre_harvest_delay", "applications_count", "applications_frequency", "untreated_buffer_aquatic", "untreated_buffer_arthropod", "untreated_buffer_plants", "usage_conditions", "decision_date", "state", "is_derogation", "derogation_started_on", "derogation_stopped_on"],
  registered_phytosanitary_cropsets: ["name", "label", "crop_names"],
  registered_phytosanitary_target_name_to_pfi_targets: ["ephy_name", "pfi_id", "pfi_name", "default_pfi_treatment_type_id"],
  registered_phytosanitary_risks: ["product_id", "risk_code", "risk_phrase"],
  registered_phytosanitary_symbols: ["id", "symbol_name"],
  master_taxonomy: ["reference_name", "parent", "taxonomic_rank", "translation_id"],
  taxonomy__translations: ["id", "fra"],
  master_productions: ["reference_name", "activity_family", "specie", "usage", "life_duration", "support_unit", "color", "translation_id", "agroedi_crop_code", "season", "started_on", "stopped_on"],
  productions__translations: ["id", "fra", "eng"],
  master_crop_production_tfi_codes: ["tfi_code", "tfi_label", "production", "tfi_crop_group", "campaign"],
  master_agricultural_pictures: ["domain", "name", "extension", "picture"],
  master_crop_production_cap_codes: ["cap_code", "cap_label", "production", "is_seed", "year"],
  registered_agroedi_codes: ["repository_id", "reference_id", "reference_code", "reference_label", "ekylibre_scope", "ekylibre_value"],
  registered_agroedi_crops: ["agroedi_code", "agroedi_name", "production"],
  registered_protected_water_zones: ["id", "administrative_zone", "name", "updated_on", "shape"],
  registered_natural_zones: ["id", "name", "nature", "shape"],
  registered_seed_varieties: ["id", "id_specie", "specie_name_fra", "variety_name", "registration_date"],
  master_production_yields: ["department_zone", "specie", "production", "yield_value", "yield_unit", "campaign"],
  master_production_prices: ["department_zone", "started_on", "nature", "specie", "waiting_price", "final_price", "price_unit", "product_output_specie", "production_reference_name", "campaign", "organic", "label"],
  registered_eu_market_prices: ["id", "specie", "product_code", "product_label", "product_description", "unit_name", "country", "price", "start_date", "end_date"],
};

/**
 * `optional` : jeu réservé aux adhérents, chargé seulement avec une clé (sinon « absent »).
 * `ifPublished` : jeu ouvert chargé s'il figure à l'index (zonages de l'assolement), « absent » sinon.
 */
/**
 * `optionalTables` : tables chargées si la version les publie (sinon, leurs
 * tables Fourmy sont laissées telles quelles), avec leurs propres transformations
 * (`TABLE_TRANSFORMS`).
 */
const PACKAGES: { name: string; tables: string[]; optionalTables?: string[]; optional?: true; ifPublished?: true }[] = [
  { name: "phytosanitary", tables: ["registered_phytosanitary_products", "registered_phytosanitary_usages", "registered_phytosanitary_cropsets", "registered_phytosanitary_target_name_to_pfi_targets", "registered_phytosanitary_risks", "registered_phytosanitary_symbols"] },
  { name: "taxonomy", tables: ["master_taxonomy", "taxonomy__translations"] },
  {
    name: "productions",
    tables: ["master_productions", "productions__translations", "master_crop_production_tfi_codes", "master_crop_production_cap_codes"],
    optionalTables: ["master_production_yields", "master_production_prices"],
  },
  { name: "agricultural_pictures", tables: ["master_agricultural_pictures"] },
  { name: "agroedi", tables: ["registered_agroedi_codes", "registered_agroedi_crops"], optional: true },
  { name: "protected_water_zones", tables: ["registered_protected_water_zones"], ifPublished: true },
  { name: "protected_natural_zones", tables: ["registered_natural_zones"], ifPublished: true },
  { name: "seed_varieties", tables: ["registered_seed_varieties"], ifPublished: true },
  { name: "eu_market_prices", tables: ["registered_eu_market_prices"], ifPublished: true },
];

/** Passage des tables temporaires (texte) aux tables de Fourmy, typées. */
const TRANSFORMS: Record<string, string[]> = {
  phytosanitary: [
    `TRUNCATE phyto_products, phyto_usages, phyto_cropsets, phyto_target_pfi, phyto_risks, phyto_hazard_symbols`,
    `INSERT INTO phyto_products (id, amm, name, other_names, natures, active_compounds, reentry_delay_hours,
                                 state, started_on, stopped_on, firm, product_type, is_derogation,
                                 mix_codes, organic, biocontrol, operator_protection, restricted_mentions)
     SELECT id::int, france_maaid, name,
            coalesce(other_names::text[], '{}'), coalesce(natures::text[], '{}'), coalesce(active_compounds::text[], '{}'),
            round(extract(epoch FROM in_field_reentry_delay::interval) / 3600)::int,
            state, started_on::date, stopped_on::date, firm_name, product_type, coalesce(is_derogation::boolean, false),
            coalesce(nullif(mix_category_codes, '')::int[], '{}'),
            coalesce((nullif(allowed_mentions, '')::jsonb ->> 'organic_usage')::boolean, false),
            coalesce((nullif(allowed_mentions, '')::jsonb ->> 'biocontrol_usage')::boolean, false),
            nullif(btrim(operator_protection_mentions), ''), nullif(btrim(restricted_mentions), '')
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
    `INSERT INTO phyto_target_pfi (ephy_name, pfi_id, pfi_name, default_treatment_type)
     SELECT ephy_name, pfi_id::int, pfi_name, nullif(default_pfi_treatment_type_id, '') FROM lx_registered_phytosanitary_target_name_to_pfi_targets`,
    // Mentions de danger actuelles (H, EUH) ; les anciennes phrases R ne sont pas reprises.
    `INSERT INTO phyto_risks (product_id, code, phrase)
     SELECT product_id::int, risk_code, risk_phrase FROM lx_registered_phytosanitary_risks
     WHERE risk_code ~ '^(H|EUH)' ON CONFLICT DO NOTHING`,
    `INSERT INTO phyto_hazard_symbols (code, symbol)
     SELECT id, symbol_name FROM lx_registered_phytosanitary_symbols WHERE coalesce(symbol_name, '') <> '' ON CONFLICT DO NOTHING`,
  ],
  taxonomy: [
    `TRUNCATE taxonomy`,
    `INSERT INTO taxonomy (reference_name, parent, rank, label)
     SELECT t.reference_name, t.parent, t.taxonomic_rank, tr.fra
     FROM lx_master_taxonomy t LEFT JOIN lx_taxonomy__translations tr ON tr.id = t.translation_id`,
  ],
  // Productions de référence (activités) et leur culture IFT (migration 0011).
  productions: [
    `TRUNCATE lexicon_productions, lexicon_production_ift, lexicon_cap_codes`,
    `INSERT INTO lexicon_productions (reference_name, family, specie, usage, label, label_en, color, life_years, support_unit, agroedi_crop_code, season, started_on, stopped_on)
     SELECT p.reference_name, p.activity_family, nullif(p.specie, ''), nullif(p.usage, ''),
            coalesce(tr.fra, p.reference_name), tr.eng, nullif(p.color, ''),
            round((extract(epoch FROM nullif(p.life_duration, '')::interval) / 31557600)::numeric, 1), p.support_unit,
            nullif(btrim(p.agroedi_crop_code), ''), nullif(btrim(p.season), ''),
            nullif(p.started_on, '')::date, nullif(p.stopped_on, '')::date
     FROM lx_master_productions p LEFT JOIN lx_productions__translations tr ON tr.id = p.translation_id`,
    `INSERT INTO lexicon_production_ift (production, ift_culture, ift_label, crop_group, campaign)
     SELECT production, tfi_code, tfi_label, tfi_crop_group, campaign::int
     FROM lx_master_crop_production_tfi_codes WHERE coalesce(production, '') <> ''`,
    `INSERT INTO lexicon_cap_codes (cap_code, cap_label, production, is_seed, year)
     SELECT cap_code, cap_label, production, coalesce(nullif(is_seed, '')::boolean, false), year::int
     FROM lx_master_crop_production_cap_codes ON CONFLICT DO NOTHING`,
  ],
  // Images (familles d'activité, variétés) ; une seule par nom.
  agricultural_pictures: [
    `TRUNCATE lexicon_pictures`,
    `INSERT INTO lexicon_pictures (domain, name, extension, picture)
     SELECT DISTINCT ON (domain, name) domain, name, extension, decode(substr(picture, 3), 'hex')
     FROM lx_master_agricultural_pictures WHERE left(picture, 2) = '\\x'
     ORDER BY domain, name, (extension = 'png') DESC`,
  ],
  // Dictionnaire AgroEDI : libellés par table (codes et libellés nettoyés de
  // leurs espaces : « ZKM » est publié « ZKM »), cultures → production.
  // Zonages de l'assolement (lot AS4) : formes en WKB hexadécimal (texte PostGIS).
  protected_water_zones: [
    `TRUNCATE lexicon_water_catchments`,
    `INSERT INTO lexicon_water_catchments (id, basin, name, updated_on, shape)
     SELECT id, nullif(btrim(administrative_zone), ''), nullif(btrim(name), ''), nullif(updated_on, '')::date, ST_Multi(shape::geometry)
     FROM lx_registered_protected_water_zones WHERE coalesce(shape, '') <> ''
     ON CONFLICT (id) DO NOTHING`,
  ],
  protected_natural_zones: [
    `TRUNCATE lexicon_natura2000`,
    `INSERT INTO lexicon_natura2000 (id, name, nature, shape)
     SELECT id, nullif(btrim(name), ''), nature, ST_Multi(shape::geometry)
     FROM lx_registered_natural_zones WHERE coalesce(shape, '') <> ''
     ON CONFLICT (id) DO NOTHING`,
  ],
  // Clé de recherche : minuscules, sans accents (pas d'extension unaccent).
  seed_varieties: [
    `TRUNCATE lexicon_seed_varieties`,
    `INSERT INTO lexicon_seed_varieties (gnis_code, species, species_label, variety_name, registered_on, search)
     SELECT btrim(id), btrim(id_specie), nullif(btrim(specie_name_fra), ''), btrim(variety_name), nullif(registration_date, '')::date,
            lower(translate(btrim(variety_name) || ' ' || coalesce(specie_name_fra, ''),
                            'ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇàâäéèêëîïôöùûüç', 'AAAEEEEIIOOUUUCaaaeeeeiioouuuc'))
     FROM lx_registered_seed_varieties
     WHERE coalesce(btrim(id), '') <> '' AND coalesce(btrim(id_specie), '') <> '' AND coalesce(btrim(variety_name), '') <> ''
     ON CONFLICT (gnis_code) DO NOTHING`,
  ],
  agroedi: [
    `INSERT INTO lexicon_agroedi_codes (table_id, reference_id, code, label, ekylibre_scope, ekylibre_value)
     SELECT repository_id::int, reference_id::int, btrim(reference_code), btrim(reference_label),
            nullif(btrim(ekylibre_scope), ''), nullif(btrim(ekylibre_value), '')
     FROM lx_registered_agroedi_codes
     WHERE coalesce(btrim(reference_code), '') <> '' AND coalesce(btrim(reference_label), '') <> ''
     ON CONFLICT DO NOTHING`,
    `INSERT INTO lexicon_agroedi_crops (code, label, production)
     SELECT btrim(agroedi_code), btrim(agroedi_name), nullif(btrim(production), '')
     FROM lx_registered_agroedi_crops WHERE coalesce(btrim(agroedi_code), '') <> ''
     ON CONFLICT (code) DO NOTHING`,
  ],
};

/**
 * Transformations des tables facultatives (temps 3, lot E2) : rendements
 * Agreste, prix des productions ; prix de marché européens (relevés français).
 */
/** Table Fourmy remplie par chaque table facultative. */
const OPTIONAL_TARGETS: Record<string, string> = {
  master_production_yields: "lexicon_production_yields",
  master_production_prices: "lexicon_production_prices",
};

const TABLE_TRANSFORMS: Record<string, string[]> = {
  master_production_yields: [
    `TRUNCATE lexicon_production_yields`,
    `INSERT INTO lexicon_production_yields (department, specie, production, yield_value, yield_unit, campaign)
     SELECT btrim(department_zone), specie, production, yield_value::numeric, yield_unit, campaign::int
     FROM lx_master_production_yields
     WHERE coalesce(btrim(department_zone), '') <> '' AND coalesce(production, '') <> '' AND yield_value ~ '^[0-9.]+$' AND campaign ~ '^[0-9]+$'
     ON CONFLICT DO NOTHING`,
  ],
  // Prix final, sinon prix d'attente (acompte) ; un prix nul est écarté.
  master_production_prices: [
    `TRUNCATE lexicon_production_prices`,
    `INSERT INTO lexicon_production_prices (zone, started_on, nature, specie, output, price, unit, production, campaign, organic, label)
     SELECT btrim(department_zone), started_on::date, nullif(btrim(nature), ''), specie, product_output_specie,
            coalesce(nullif(final_price::numeric, 0), nullif(waiting_price::numeric, 0)), price_unit,
            nullif(btrim(production_reference_name), ''), nullif(campaign, '')::int, nullif(organic, '')::boolean, nullif(btrim(label), '')
     FROM lx_master_production_prices
     WHERE coalesce(nullif(final_price::numeric, 0), nullif(waiting_price::numeric, 0)) IS NOT NULL`,
  ],
};
TRANSFORMS.eu_market_prices = [
  `TRUNCATE lexicon_market_prices`,
  `INSERT INTO lexicon_market_prices (id, specie, product_code, label, stage, unit, price, started_on, ended_on)
   SELECT id, nullif(btrim(specie), ''), product_code, product_label, nullif(btrim(product_description), ''), unit_name, price::numeric,
          start_date::date, nullif(end_date, '')::date
   FROM lx_registered_eu_market_prices
   WHERE country = 'FR' AND coalesce(price, '') <> '' AND coalesce(start_date, '') <> '' AND coalesce(product_code, '') <> ''
   ON CONFLICT (id) DO NOTHING`,
];

export interface PackageReport {
  name: string;
  version: string;
  /** `absent` : jeu facultatif que la source ne publie pas (dépôt public sans `agroedi`). */
  status: "loaded" | "up-to-date" | "absent";
  rows: number;
}

export interface SyncOptions {
  /** Adresse du serveur de paquets (ex. http://127.0.0.1:8889). */
  base: string;
  /** Clé d'adhérent du bundle (voir `lexiconSourceFromEnv`). */
  apiKey?: string;
  /** Recharger même si la version est déjà en base. */
  force?: boolean;
  fetchImpl?: typeof fetch;
}

/** Tables du référentiel vidées puis rechargées (TRUNCATE des TRANSFORMS). */
const REFERENTIAL_TABLES = [
  "phyto_products", "phyto_usages", "phyto_cropsets", "phyto_target_pfi", "phyto_risks", "phyto_hazard_symbols", "taxonomy",
  "lexicon_productions", "lexicon_production_ift", "lexicon_cap_codes", "lexicon_pictures", "lexicon_agroedi_codes", "lexicon_agroedi_crops",
  "lexicon_water_catchments", "lexicon_natura2000", "lexicon_seed_varieties",
  "lexicon_production_yields", "lexicon_production_prices", "lexicon_market_prices",
];

/**
 * Verrous de tout le référentiel, pris d'un coup et sans attendre (NOWAIT) :
 * si une table est lue (import, contrôle phyto…), on relâche tout et on
 * réessaie. Le chargement n'attend donc jamais en tenant un verrou — plus
 * d'interblocage avec une transaction qui lit ces tables dans un autre
 * ordre ; elle attend seulement la fin du chargement. Deux minutes au plus.
 */
async function lockReferential(tx: TransactionSql): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await tx.savepoint((sp) => sp.unsafe(`LOCK TABLE ${REFERENTIAL_TABLES.join(", ")} IN ACCESS EXCLUSIVE MODE NOWAIT`));
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== "55P03" || attempt >= 240) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/** Synchronise le référentiel dans une transaction (tout ou rien). */
export async function syncLexicon(sql: Sql, opts: SyncOptions): Promise<PackageReport[]> {
  return sql.begin((tx) => syncLexiconIn(tx, opts)) as Promise<PackageReport[]>;
}

/** Même chose, dans une transaction fournie (tests : annulée à la fin). */
export async function syncLexiconIn(tx: TransactionSql, { base, apiKey, force = false, fetchImpl: rawFetch = fetch }: SyncOptions): Promise<PackageReport[]> {
  const fetchImpl = withApiKey(rawFetch, { base, apiKey });
  const index = await fetchIndex(base, fetchImpl);
  const reports: PackageReport[] = [];
  let locked = false;
  for (const pkg of PACKAGES) {
    const version = index.datasources[pkg.name]?.current;
    // Jeu réservé : le dépôt public en publie le nom, pas les fichiers (403) ; il faut une clé.
    if (pkg.optional && (!version || !apiKey)) {
      reports.push({ name: pkg.name, version: "", status: "absent", rows: 0 });
      continue;
    }
    if (!version && pkg.ifPublished) {
      reports.push({ name: pkg.name, version: "", status: "absent", rows: 0 });
      continue;
    }
    if (!version) throw new Error(`Lexicon : paquet « ${pkg.name} » absent de l'index`);
    const [loaded] = await tx<{ version: string; rows: number }[]>`SELECT version, rows FROM lexicon_packages WHERE name = ${pkg.name}`;
    // Version déjà chargée, mais une table facultative publiée par cette version
    // est encore vide (table ajoutée à Fourmy depuis) : on recharge.
    let missingOptional = false;
    if (!force && loaded?.version === version && pkg.optionalTables?.length) {
      const empty: string[] = [];
      for (const t of pkg.optionalTables) {
        const [r] = (await tx.unsafe(`SELECT NOT EXISTS (SELECT 1 FROM ${OPTIONAL_TARGETS[t]}) AS empty`)) as unknown as [{ empty: boolean }];
        if (r.empty) empty.push(t);
      }
      if (empty.length) {
        const published = await fetchManifest(base, pkg.name, version, fetchImpl);
        missingOptional = empty.some((t) => published.tables.some((m) => m.name === t && m.rows > 0));
      }
    }
    if (!force && loaded?.version === version && !missingOptional) {
      reports.push({ name: pkg.name, version, status: "up-to-date", rows: loaded.rows });
      continue;
    }
    const manifest = await fetchManifest(base, pkg.name, version, fetchImpl);
    const columns = parseStructure(await fetchStructure(base, pkg.name, version, fetchImpl));
    let rows = 0;
    for (const table of pkg.tables) rows += await stage(tx, base, manifest, table, columns.get(table), fetchImpl);
    const extra = (pkg.optionalTables ?? []).filter((t) => columns.has(t) && manifest.tables.some((m) => m.name === t));
    for (const table of extra) rows += await stage(tx, base, manifest, table, columns.get(table), fetchImpl);
    if (!locked) {
      await lockReferential(tx);
      locked = true;
    }
    for (const statement of TRANSFORMS[pkg.name]!) await tx.unsafe(statement);
    for (const table of extra) for (const statement of TABLE_TRANSFORMS[table]!) await tx.unsafe(statement);
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
  await tx.unsafe(`DROP TABLE IF EXISTS ${staging}`);
  await tx.unsafe(`CREATE TEMP TABLE ${staging} (${columns.map((c) => `"${c}" text`).join(", ")}) ON COMMIT DROP`);
  for (const file of entry.files) {
    const res = await fetchImpl(packageUrl(base, manifest.name, manifest.version, file.path), { signal: AbortSignal.timeout(300_000) });
    if (!res.ok || !res.body) throw new Error(`Lexicon : ${file.path} → HTTP ${res.status}`);
    const writable = await tx.unsafe(`COPY ${staging} FROM STDIN WITH (FORMAT csv)`).writable();
    // Somme du fichier tel que publié (gzip), calculée au passage.
    const hash = createHash("sha256");
    const tap = new PassThrough();
    tap.on("data", (chunk: Buffer) => hash.update(chunk));
    await pipeline(Readable.fromWeb(res.body as never), tap, createGunzip(), writable);
    if (file.sha256 && hash.digest("hex") !== file.sha256.toLowerCase()) {
      throw new Error(`Lexicon : ${manifest.name} ${manifest.version} — somme de contrôle fausse pour ${file.path}`);
    }
  }
  const [{ n }] = (await tx.unsafe(`SELECT count(*)::int AS n FROM ${staging}`)) as unknown as [{ n: number }];
  if (n !== entry.rows) throw new Error(`Lexicon : ${table} — ${n} lignes lues pour ${entry.rows} annoncées`);
  return n;
}
