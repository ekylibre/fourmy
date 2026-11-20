import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { lexiconSourceFromEnv, LEXICON_BUNDLE_URL, LEXICON_PACKAGES_URL, parseStructure, packageUrl, syncLexiconIn, withApiKey } from "../src/index.js";

describe("structure des paquets", () => {
  it("lit les noms de colonnes sans rien exécuter", () => {
    const cols = parseStructure(`
      CREATE TABLE registered_phytosanitary_cropsets (
        id character varying PRIMARY KEY NOT NULL,
        name character varying NOT NULL,
        crop_names text[],  --commentaire--
        record_checksum integer
      );
      CREATE TABLE registered_hydrographic_items (
        id character varying PRIMARY KEY NOT NULL,
        shape postgis.geometry(MultiPolygon,4326),
        CONSTRAINT pk PRIMARY KEY (id)
      );`);
    expect(cols.get("registered_phytosanitary_cropsets")).toEqual(["id", "name", "crop_names", "record_checksum"]);
    expect(cols.get("registered_hydrographic_items")).toEqual(["id", "shape"]);
  });

  it("refuse un chemin de paquet qui sort du serveur", () => {
    expect(() => packageUrl("http://x", "phytosanitary", "../etc")).toThrow(/invalide/);
    expect(packageUrl("http://x/", "taxonomy", "2026.10.07.1", "data/a_0.csv.gz")).toBe("http://x/taxonomy/2026.10.07.1/data/a_0.csv.gz");
  });
});

describe("source des paquets", () => {
  it("dépôt public sans clé, bundle « fourmy » avec, rien si off", () => {
    expect(lexiconSourceFromEnv({})).toEqual({ base: LEXICON_PACKAGES_URL, apiKey: undefined });
    expect(lexiconSourceFromEnv({ FOURMY_LEXICON_API_KEY: " lex_abc " })).toEqual({ base: LEXICON_BUNDLE_URL, apiKey: "lex_abc" });
    expect(lexiconSourceFromEnv({ FOURMY_LEXICON_PACKAGES_URL: "http://127.0.0.1:8889", FOURMY_LEXICON_API_KEY: "lex_abc" })).toEqual({ base: "http://127.0.0.1:8889", apiKey: "lex_abc" });
    expect(lexiconSourceFromEnv({ FOURMY_LEXICON_PACKAGES_URL: "off", FOURMY_LEXICON_API_KEY: "lex_abc" })).toBeNull();
  });

  it("la clé part vers la source seulement, sans suivre de redirection", async () => {
    const seen: { url: string; auth: string | null; redirect?: RequestRedirect }[] = [];
    const spy = (async (input: string | URL, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), redirect: init?.redirect });
      return new Response("{}");
    }) as typeof fetch;
    const f = withApiKey(spy, { base: "https://lexicon.osfarm.org/bundles/fourmy", apiKey: "lex_abc" });
    await f("https://lexicon.osfarm.org/bundles/fourmy/index.json");
    await f("https://ailleurs.example/x");
    expect(seen).toEqual([
      { url: "https://lexicon.osfarm.org/bundles/fourmy/index.json", auth: "Bearer lex_abc", redirect: "error" },
      { url: "https://ailleurs.example/x", auth: null, redirect: undefined },
    ]);
    expect(withApiKey(spy, { base: "http://x" })).toBe(spy);
  });
});

// --- Chargement réel (base de test), dans une transaction annulée -------------

const url = process.env.DATABASE_URL;

/** Faux serveur de paquets : deux versions, de petits CSV gzip. */
/** Petit triangle (WKB hexadécimal, comme les CSV des zonages Lexicon). */
const WKB = "0106000020e61000000100000001030000000100000004000000000000000000e03f666666666666464052b81e85eb51e03f666666666666464052b81e85eb51e03f48e17a14ae674640000000000000e03f6666666666664640";

function fakeServer(phytoVersion: string, { agroedi = false, zones = false, seeds = false, apiKey }: { agroedi?: boolean; zones?: boolean; seeds?: boolean; apiKey?: string } = {}) {
  const csv = (lines: string[]) => gzipSync(lines.join("\n") + "\n");
  const files: Record<string, string | Buffer> = {
    "index.json": JSON.stringify({
      datasources: {
        phytosanitary: { current: phytoVersion, versions: [phytoVersion] },
        taxonomy: { current: "t1", versions: ["t1"] },
        productions: { current: "pr1", versions: ["pr1"] },
        agricultural_pictures: { current: "pi1", versions: ["pi1"] },
        ...(agroedi ? { agroedi: { current: "a1", versions: ["a1"] } } : {}),
        ...(zones ? { protected_water_zones: { current: "w1", versions: ["w1"] }, protected_natural_zones: { current: "n1", versions: ["n1"] } } : {}),
        ...(seeds ? { seed_varieties: { current: "sv1", versions: ["sv1"] } } : {}),
      },
    }),
    [`phytosanitary/${phytoVersion}/manifest.json`]: JSON.stringify({
      name: "phytosanitary",
      version: phytoVersion,
      tables: [
        { name: "registered_phytosanitary_products", rows: 1, files: [{ path: "data/p_0.csv.gz" }] },
        { name: "registered_phytosanitary_usages", rows: 2, files: [{ path: "data/u_0.csv.gz" }] },
        { name: "registered_phytosanitary_cropsets", rows: 1, files: [{ path: "data/c_0.csv.gz" }] },
        { name: "registered_phytosanitary_target_name_to_pfi_targets", rows: 1, files: [{ path: "data/t_0.csv.gz" }] },
        { name: "registered_phytosanitary_risks", rows: 3, files: [{ path: "data/r_0.csv.gz" }] },
        { name: "registered_phytosanitary_symbols", rows: 2, files: [{ path: "data/s_0.csv.gz" }] },
      ],
    }),
    [`phytosanitary/${phytoVersion}/structure.sql`]: `
      CREATE TABLE registered_phytosanitary_cropsets (name character varying, label jsonb, crop_names text[]);
      CREATE TABLE registered_phytosanitary_products (id integer, name character varying, other_names text[], natures text[],
        active_compounds text[], france_maaid character varying, in_field_reentry_delay interval, state character varying,
        started_on date, stopped_on date, firm_name character varying, product_type character varying, is_derogation boolean,
        mix_category_codes integer[], allowed_mentions jsonb, restricted_mentions character varying, operator_protection_mentions text);
      CREATE TABLE registered_phytosanitary_usages (id character varying, product_id integer, ephy_usage_phrase character varying,
        crop_label_fra character varying, species text[], target_name_label_fra character varying, treatment jsonb,
        dose_quantity numeric, dose_unit character varying, dose_unit_name character varying, pre_harvest_delay interval,
        applications_count integer, applications_frequency interval, untreated_buffer_aquatic integer,
        untreated_buffer_arthropod integer, untreated_buffer_plants integer, usage_conditions character varying,
        decision_date date, state character varying, is_derogation boolean, derogation_started_on date, derogation_stopped_on date);
      CREATE TABLE registered_phytosanitary_target_name_to_pfi_targets (ephy_name character varying, pfi_id integer, pfi_name character varying, default_pfi_treatment_type_id character varying);
      CREATE TABLE registered_phytosanitary_risks (product_id integer, risk_code character varying, risk_phrase character varying, record_checksum integer);
      CREATE TABLE registered_phytosanitary_symbols (id character varying, symbol_name character varying);`,
    [`phytosanitary/${phytoVersion}/data/p_0.csv.gz`]: csv([
      `9999001,GLISTER TEST,"{""BARBARIAN TEST""}",{Herbicide},"{""Glyphosate 360 g/L""}",9999001,PT6H,authorized,2015-08-12,,FIRME,PPP,f,"{1,3}","{""organic_usage"": true}",,Gants en nitrile`,
    ]),
    [`phytosanitary/${phytoVersion}/data/u_0.csv.gz`]: csv([
      `u1,9999001,Maïs*Désherbage,Maïs,{zea_mays},Désherbage,"{""fra"": ""Trt Part.Aer.""}",3.0000,liter_per_hectare,L/ha,P90D,2,P14D,5,,,,2020-01-01,authorized,f,,`,
      `u2,9999001,Céréales*Désherbage,Céréales,{ephy_wheat},Désherbage,,4.0000,liter_per_hectare,L/ha,,,,20,,,,2020-01-01,withdrawn,f,,`,
    ]),
    [`phytosanitary/${phytoVersion}/data/c_0.csv.gz`]: csv([`ephy_wheat,"{""fra"": ""Blés""}","{triticum,triticosecale}"`]),
    [`phytosanitary/${phytoVersion}/data/t_0.csv.gz`]: csv([`Désherbage,1,Adventices,T21`]),
    [`phytosanitary/${phytoVersion}/data/r_0.csv.gz`]: csv([
      `9999001,H319,Provoque une sévère irritation des yeux,1`,
      `9999001,H410,"Très toxique pour les organismes aquatiques, entraîne des effets néfastes à long terme",2`,
      `9999001,R50,Très toxique pour les organismes aquatiques,3`,
    ]),
    [`phytosanitary/${phytoVersion}/data/s_0.csv.gz`]: csv([`H319,SGH07`, `H410,SGH09`]),
    "taxonomy/t1/manifest.json": JSON.stringify({
      name: "taxonomy",
      version: "t1",
      tables: [
        { name: "master_taxonomy", rows: 2, files: [{ path: "data/m_0.csv.gz" }] },
        { name: "taxonomy__translations", rows: 2, files: [{ path: "data/tr_0.csv.gz" }] },
      ],
    }),
    "taxonomy/t1/structure.sql": `
      CREATE TABLE master_taxonomy (reference_name character varying, parent character varying, taxonomic_rank character varying, translation_id character varying);
      CREATE TABLE taxonomy__translations (id character varying, fra character varying, eng character varying);`,
    "taxonomy/t1/data/m_0.csv.gz": csv([`zea_mays,zea,specie,tr1`, `zea,poaceae,genus,tr2`]),
    "taxonomy/t1/data/tr_0.csv.gz": csv([`tr1,Maïs,Corn`, `tr2,Maïs (genre),Corn genus`]),
    "productions/pr1/manifest.json": JSON.stringify({
      name: "productions",
      version: "pr1",
      tables: [
        { name: "master_productions", rows: 2, files: [{ path: "data/mp_0.csv.gz" }] },
        { name: "productions__translations", rows: 2, files: [{ path: "data/ptr_0.csv.gz" }] },
        { name: "master_crop_production_tfi_codes", rows: 1, files: [{ path: "data/tfi_0.csv.gz" }] },
        { name: "master_crop_production_cap_codes", rows: 1, files: [{ path: "data/cap_0.csv.gz" }] },
      ],
    }),
    "productions/pr1/structure.sql": `
      CREATE TABLE master_productions (reference_name character varying, activity_family character varying, specie character varying,
        usage character varying, started_on date, stopped_on date, agroedi_crop_code character varying, season character varying,
        life_duration interval, support_unit character varying, idea_botanic_family character varying, idea_specie_family character varying,
        idea_output_family character varying, color character varying, translation_id character varying);
      CREATE TABLE productions__translations (id character varying, fra character varying, eng character varying);
      CREATE TABLE master_crop_production_tfi_codes (tfi_code character varying, tfi_label character varying, production character varying,
        tfi_crop_group character varying, campaign integer);
      CREATE TABLE master_crop_production_cap_codes (cap_code character varying, cap_label character varying, production character varying,
        cap_precision character varying, cap_category character varying, is_seed boolean, year integer);`,
    "productions/pr1/data/mp_0.csv.gz": csv([
      `grain_corn,plant_farming,zea_mays,grain,2000-03-01,2000-11-30,ZMA,,,hectare,,,,#F5D33D,ptr1`,
      `vine,vine_farming,vitis,fruit,2000-11-01,2001-10-31,ZMO,,P50Y,hectare,,,,,ptr2`,
    ]),
    "productions/pr1/data/ptr_0.csv.gz": csv([`ptr1,Maïs grain,Grain corn`, `ptr2,Vigne,Vine`]),
    "productions/pr1/data/tfi_0.csv.gz": csv([`1112,Maïs,grain_corn,GCU1,2020`]),
    "productions/pr1/data/cap_0.csv.gz": csv([`MIS,Maïs,grain_corn,,,f,2024`]),
    "agricultural_pictures/pi1/manifest.json": JSON.stringify({
      name: "agricultural_pictures",
      version: "pi1",
      tables: [{ name: "master_agricultural_pictures", rows: 2, files: [{ path: "data/pic_0.csv.gz" }] }],
    }),
    "agricultural_pictures/pi1/structure.sql": `
      CREATE TABLE master_agricultural_pictures (id integer, domain character varying, name character varying, extension character varying, picture bytea);`,
    "agricultural_pictures/pi1/data/pic_0.csv.gz": csv([`1,varieties,zea,jpg,\\xffd8ff`, `2,activity_families,plant_farming,png,\\x89504e47`]),
    "agroedi/a1/structure.sql": `
      CREATE TABLE registered_agroedi_codes (repository_id integer NOT NULL, reference_id integer NOT NULL, reference_code character varying,
        reference_label character varying, ekylibre_scope character varying, ekylibre_value character varying);
      CREATE TABLE registered_agroedi_crops (agroedi_code character varying NOT NULL, agroedi_name character varying NOT NULL, production character varying);`,
    "agroedi/a1/data/codes_0.csv.gz": csv([
      `14,1993,ZKE,Semis de précision,Procedo,sowing_without_plant_output`,
      `5,1100,ZKE,Amendements calco-magnésiens,ProductNatureVariant,mineral_fertilizer`,
      `36,433,ZKM ,Dose / ha,Unit,unity_per_hectare`,
      `2,19907,,sans code,,`,
    ]),
    "agroedi/a1/data/crops_0.csv.gz": csv([`ZCSZLF,Maïs fourrage,silage_corn`, `ZDA,Moutarde blanche,`]),
  };
  const codes = files["agroedi/a1/data/codes_0.csv.gz"] as Buffer;
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  files["agroedi/a1/manifest.json"] = JSON.stringify({
    name: "agroedi",
    version: "a1",
    scope: "members",
    tables: [
      { name: "registered_agroedi_codes", rows: 4, files: [{ path: "data/codes_0.csv.gz", sha256: sha(codes) }] },
      { name: "registered_agroedi_crops", rows: 2, files: [{ path: "data/crops_0.csv.gz", sha256: sha(files["agroedi/a1/data/crops_0.csv.gz"] as Buffer) }] },
    ],
  });
  const requested: string[] = [];
  if (zones) {
    files["protected_water_zones/w1/structure.sql"] = `CREATE TABLE registered_protected_water_zones (id character varying NOT NULL, administrative_zone character varying,
      creator_name character varying, name character varying, updated_on date, shape postgis.geometry(MultiPolygon, 4326) NOT NULL, centroid postgis.geometry(Point, 4326));`;
    files["protected_water_zones/w1/data/w_0.csv.gz"] = csv([`16,ADOUR-GARONNE,,BAC du Moulin,2024-08-23,${WKB},`]);
    files["protected_water_zones/w1/manifest.json"] = JSON.stringify({ name: "protected_water_zones", version: "w1", tables: [{ name: "registered_protected_water_zones", rows: 1, files: [{ path: "data/w_0.csv.gz" }] }] });
    files["protected_natural_zones/n1/structure.sql"] = `CREATE TABLE registered_natural_zones (id character varying NOT NULL, name character varying, nature character varying NOT NULL,
      shape postgis.geometry(MultiPolygon, 4326) NOT NULL, centroid postgis.geometry(Point, 4326));`;
    files["protected_natural_zones/n1/data/n_0.csv.gz"] = csv([`FR7200700,Vallée de la Garonne,sic,${WKB},`]);
    files["protected_natural_zones/n1/manifest.json"] = JSON.stringify({ name: "protected_natural_zones", version: "n1", tables: [{ name: "registered_natural_zones", rows: 1, files: [{ path: "data/n_0.csv.gz" }] }] });
  }
  if (seeds) {
    files["seed_varieties/sv1/structure.sql"] = `CREATE TABLE registered_seed_varieties (id character varying PRIMARY KEY NOT NULL, id_specie character varying NOT NULL,
      specie_name jsonb, specie_name_fra character varying, variety_name character varying, registration_date date);`;
    files["seed_varieties/sv1/data/sv_0.csv.gz"] = csv([
      `512E492,triticum_aestivum,"{""fra"": ""BLE TENDRE""}",BLE TENDRE,THERMIDOR,2023-12-27`,
      `510A387,avena_sativa,"{""fra"": ""AVOINE""}",AVOINE,KWS PURSANT,`,
      `5219021,trifolium_incarnatum,"{""fra"": ""TRÈFLE INCARNAT""}",TRÈFLE INCARNAT,CONTEA,`,
      `0000000,zea_mays,,,,`,
    ]);
    files["seed_varieties/sv1/manifest.json"] = JSON.stringify({ name: "seed_varieties", version: "sv1", tables: [{ name: "registered_seed_varieties", rows: 4, files: [{ path: "data/sv_0.csv.gz" }] }] });
  }
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const path = String(input).replace("http://lexicon.test/", "");
    requested.push(path);
    if (apiKey && new Headers(init?.headers).get("authorization") !== `Bearer ${apiKey}`) return new Response("clé requise", { status: 401 });
    const body = files[path];
    if (body === undefined) return new Response("absent", { status: 404 });
    return new Response(body);
  }) as typeof fetch;
  return { fetchImpl, requested };
}

class Rollback extends Error {}

// Le chargement prend le verrou du référentiel sans attendre et réessaie
// pendant deux minutes (load.ts) : en CI, les tests de l'API lisent ces tables
// en parallèle et peuvent le retarder de plusieurs secondes. Le délai du test
// dépasse celui du verrou : il n'échoue que si le verrou est impossible à prendre.
describe.skipIf(!url)("synchro du référentiel (intégration)", { timeout: 150_000 }, () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });

  it("zonages de l'assolement : aires de captage et Natura 2000, s'ils sont publiés", async () => {
    await sql
      .begin(async (tx) => {
        const reports = await syncLexiconIn(tx, { base: "http://lexicon.test", fetchImpl: fakeServer("v1", { zones: true }).fetchImpl, force: true });
        expect(reports.filter((r) => r.name.startsWith("protected_"))).toEqual([
          { name: "protected_water_zones", version: "w1", status: "loaded", rows: 1 },
          { name: "protected_natural_zones", version: "n1", status: "loaded", rows: 1 },
        ]);
        expect(await tx`SELECT id, basin, name, updated_on::text, ST_GeometryType(shape) AS t FROM lexicon_water_catchments`).toEqual([
          { id: "16", basin: "ADOUR-GARONNE", name: "BAC du Moulin", updated_on: "2024-08-23", t: "ST_MultiPolygon" },
        ]);
        expect(await tx`SELECT id, name, nature FROM lexicon_natura2000`).toEqual([{ id: "FR7200700", name: "Vallée de la Garonne", nature: "sic" }]);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it("catalogue des variétés de semences, s'il est publié : clé de recherche sans accents", async () => {
    await sql
      .begin(async (tx) => {
        const reports = await syncLexiconIn(tx, { base: "http://lexicon.test", fetchImpl: fakeServer("v1", { seeds: true }).fetchImpl, force: true });
        expect(reports.find((r) => r.name === "seed_varieties")).toEqual({ name: "seed_varieties", version: "sv1", status: "loaded", rows: 4 });
        // Une ligne sans nom de variété est écartée.
        expect(await tx`SELECT gnis_code, species, species_label, variety_name, registered_on::text, search FROM lexicon_seed_varieties ORDER BY 1`).toEqual([
          { gnis_code: "510A387", species: "avena_sativa", species_label: "AVOINE", variety_name: "KWS PURSANT", registered_on: null, search: "kws pursant avoine" },
          { gnis_code: "512E492", species: "triticum_aestivum", species_label: "BLE TENDRE", variety_name: "THERMIDOR", registered_on: "2023-12-27", search: "thermidor ble tendre" },
          { gnis_code: "5219021", species: "trifolium_incarnatum", species_label: "TRÈFLE INCARNAT", variety_name: "CONTEA", registered_on: null, search: "contea trefle incarnat" },
        ]);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it("charge produits, usages, ensembles et taxonomie ; une version connue n'est pas retéléchargée", async () => {
    await sql
      .begin(async (tx) => {
        const server = fakeServer("v1");
        const first = await syncLexiconIn(tx, { base: "http://lexicon.test", fetchImpl: server.fetchImpl, force: true });
        expect(first).toEqual([
          { name: "phytosanitary", version: "v1", status: "loaded", rows: 10 },
          { name: "taxonomy", version: "t1", status: "loaded", rows: 4 },
          { name: "productions", version: "pr1", status: "loaded", rows: 6 },
          { name: "agricultural_pictures", version: "pi1", status: "loaded", rows: 2 },
          { name: "agroedi", version: "", status: "absent", rows: 0 },
          { name: "protected_water_zones", version: "", status: "absent", rows: 0 },
          { name: "protected_natural_zones", version: "", status: "absent", rows: 0 },
          { name: "seed_varieties", version: "", status: "absent", rows: 0 },
        ]);
        expect(await tx`SELECT reference_name, started_on::text, stopped_on::text FROM lexicon_productions ORDER BY 1`).toEqual([
          { reference_name: "grain_corn", started_on: "2000-03-01", stopped_on: "2000-11-30" },
          { reference_name: "vine", started_on: "2000-11-01", stopped_on: "2001-10-31" },
        ]);
        expect(await tx`SELECT reference_name, agroedi_crop_code FROM lexicon_productions ORDER BY 1`).toEqual([
          { reference_name: "grain_corn", agroedi_crop_code: "ZMA" },
          { reference_name: "vine", agroedi_crop_code: "ZMO" },
        ]);
        expect(await tx`SELECT reference_name, family, specie, label, color, life_years::float8 AS life FROM lexicon_productions ORDER BY 1`).toEqual([
          { reference_name: "grain_corn", family: "plant_farming", specie: "zea_mays", label: "Maïs grain", color: "#F5D33D", life: null },
          { reference_name: "vine", family: "vine_farming", specie: "vitis", label: "Vigne", color: null, life: 50 },
        ]);
        expect(await tx`SELECT cap_code, cap_label, production, year FROM lexicon_cap_codes`).toEqual([{ cap_code: "MIS", cap_label: "Maïs", production: "grain_corn", year: 2024 }]);
        expect(await tx`SELECT production, ift_culture, campaign FROM lexicon_production_ift`).toEqual([{ production: "grain_corn", ift_culture: "1112", campaign: 2020 }]);
        const pics = await tx`SELECT domain, name, encode(picture, 'hex') AS hex FROM lexicon_pictures ORDER BY 1`;
        expect(pics).toEqual([
          { domain: "activity_families", name: "plant_farming", hex: "89504e47" },
          { domain: "varieties", name: "zea", hex: "ffd8ff" },
        ]);
        const [extra] = await tx`SELECT mix_codes, organic, biocontrol, operator_protection FROM phyto_products`;
        expect(extra).toEqual({ mix_codes: [1, 3], organic: true, biocontrol: false, operator_protection: "Gants en nitrile" });
        expect(await tx`SELECT pfi_id, default_treatment_type FROM phyto_target_pfi`).toEqual([{ pfi_id: 1, default_treatment_type: "T21" }]);
        const [p] = await tx`SELECT amm, name, other_names, reentry_delay_hours, natures FROM phyto_products`;
        expect(p).toEqual({ amm: "9999001", name: "GLISTER TEST", other_names: ["BARBARIAN TEST"], reentry_delay_hours: 6, natures: ["Herbicide"] });
        const usages = await tx`SELECT id, species, dose_quantity::float8 AS dose, pre_harvest_delay_days, applications_count,
                                       applications_frequency_days, untreated_buffer_aquatic, treatment_label, state FROM phyto_usages ORDER BY id`;
        expect(usages[0]).toEqual({ id: "u1", species: ["zea_mays"], dose: 3, pre_harvest_delay_days: 90, applications_count: 2, applications_frequency_days: 14, untreated_buffer_aquatic: 5, treatment_label: "Trt Part.Aer.", state: "authorized" });
        expect(usages[1]).toMatchObject({ id: "u2", species: ["ephy_wheat"], pre_harvest_delay_days: null, state: "withdrawn" });
        // Mentions de danger actuelles seulement (pas les phrases R) et leur pictogramme.
        expect(await tx`SELECT code FROM phyto_risks ORDER BY code`).toEqual([{ code: "H319" }, { code: "H410" }]);
        expect(await tx`SELECT code, symbol FROM phyto_hazard_symbols ORDER BY code`).toEqual([{ code: "H319", symbol: "SGH07" }, { code: "H410", symbol: "SGH09" }]);
        expect(await tx`SELECT crop_names, label FROM phyto_cropsets`).toEqual([{ crop_names: ["triticum", "triticosecale"], label: "Blés" }]);
        expect(await tx`SELECT reference_name, parent, label FROM taxonomy ORDER BY 1`).toEqual([
          { reference_name: "zea", parent: "poaceae", label: "Maïs (genre)" },
          { reference_name: "zea_mays", parent: "zea", label: "Maïs" },
        ]);

        // Même version : rien n'est retéléchargé.
        const again = fakeServer("v1");
        const second = await syncLexiconIn(tx, { base: "http://lexicon.test", fetchImpl: again.fetchImpl });
        expect(second.map((r) => r.status)).toEqual(["up-to-date", "up-to-date", "up-to-date", "up-to-date", "absent", "absent", "absent", "absent"]);
        expect(again.requested).toEqual(["index.json"]);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it("avec une clé : bundle, jeu agroedi chargé (codes nettoyés, lignes sans code ignorées)", async () => {
    await sql
      .begin(async (tx) => {
        const server = fakeServer("v1", { agroedi: true, apiKey: "lex_test" });
        const reports = await syncLexiconIn(tx, { base: "http://lexicon.test", apiKey: "lex_test", fetchImpl: server.fetchImpl, force: true });
        expect(reports.find((r) => r.name === "agroedi")).toEqual({ name: "agroedi", version: "a1", status: "loaded", rows: 6 });
        expect(await tx`SELECT table_id, code, label, ekylibre_value FROM lexicon_agroedi_codes ORDER BY table_id`).toEqual([
          { table_id: 5, code: "ZKE", label: "Amendements calco-magnésiens", ekylibre_value: "mineral_fertilizer" },
          { table_id: 14, code: "ZKE", label: "Semis de précision", ekylibre_value: "sowing_without_plant_output" },
          { table_id: 36, code: "ZKM", label: "Dose / ha", ekylibre_value: "unity_per_hectare" },
        ]);
        expect(await tx`SELECT code, label, production FROM lexicon_agroedi_crops ORDER BY code`).toEqual([
          { code: "ZCSZLF", label: "Maïs fourrage", production: "silage_corn" },
          { code: "ZDA", label: "Moutarde blanche", production: null },
        ]);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it("sans clé, un jeu réservé listé dans l'index (fichiers en 403) est « absent », sans erreur", async () => {
    await sql
      .begin(async (tx) => {
        const server = fakeServer("v1", { agroedi: true });
        const forbidden = (async (input: string | URL, init?: RequestInit) =>
          String(input).includes("/agroedi/") ? new Response("réservé", { status: 403 }) : server.fetchImpl(input, init)) as typeof fetch;
        const reports = await syncLexiconIn(tx, { base: "http://lexicon.test", fetchImpl: forbidden, force: true });
        expect(reports.find((r) => r.name === "agroedi")).toEqual({ name: "agroedi", version: "", status: "absent", rows: 0 });
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it("refuse un fichier dont la somme de contrôle est fausse", async () => {
    await sql
      .begin(async (tx) => {
        const server = fakeServer("v1", { agroedi: true, apiKey: "lex_test" });
        const tampered = (async (input: string | URL, init?: RequestInit) => {
          if (String(input).endsWith("agroedi/a1/data/crops_0.csv.gz")) return new Response(gzipSync("ZXX,Autre,\n"));
          return server.fetchImpl(input, init);
        }) as typeof fetch;
        await expect(syncLexiconIn(tx, { base: "http://lexicon.test", apiKey: "lex_test", fetchImpl: tampered, force: true })).rejects.toThrow(/somme de contrôle fausse/);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it("refuse une structure inattendue sans rien écrire", async () => {
    await sql
      .begin(async (tx) => {
        const server = fakeServer("v2");
        const broken = (async (input: string | URL) => {
          if (String(input).endsWith("phytosanitary/v2/structure.sql")) {
            return new Response("CREATE TABLE registered_phytosanitary_products (id integer, name character varying);");
          }
          return server.fetchImpl(input);
        }) as typeof fetch;
        await expect(syncLexiconIn(tx, { base: "http://lexicon.test", fetchImpl: broken, force: true })).rejects.toThrow(/structure inattendue/);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
