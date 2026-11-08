import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import postgres from "postgres";
import { parseStructure, packageUrl, syncLexiconIn } from "../src/index.js";

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

// --- Chargement réel (base de test), dans une transaction annulée -------------

const url = process.env.DATABASE_URL;

/** Faux serveur de paquets : deux versions, de petits CSV gzip. */
function fakeServer(phytoVersion: string) {
  const csv = (lines: string[]) => gzipSync(lines.join("\n") + "\n");
  const files: Record<string, string | Buffer> = {
    "index.json": JSON.stringify({ datasources: { phytosanitary: { current: phytoVersion, versions: [phytoVersion] }, taxonomy: { current: "t1", versions: ["t1"] } } }),
    [`phytosanitary/${phytoVersion}/manifest.json`]: JSON.stringify({
      name: "phytosanitary",
      version: phytoVersion,
      tables: [
        { name: "registered_phytosanitary_products", rows: 1, files: [{ path: "data/p_0.csv.gz" }] },
        { name: "registered_phytosanitary_usages", rows: 2, files: [{ path: "data/u_0.csv.gz" }] },
        { name: "registered_phytosanitary_cropsets", rows: 1, files: [{ path: "data/c_0.csv.gz" }] },
        { name: "registered_phytosanitary_target_name_to_pfi_targets", rows: 1, files: [{ path: "data/t_0.csv.gz" }] },
      ],
    }),
    [`phytosanitary/${phytoVersion}/structure.sql`]: `
      CREATE TABLE registered_phytosanitary_cropsets (name character varying, label jsonb, crop_names text[]);
      CREATE TABLE registered_phytosanitary_products (id integer, name character varying, other_names text[], natures text[],
        active_compounds text[], france_maaid character varying, in_field_reentry_delay interval, state character varying,
        started_on date, stopped_on date, firm_name character varying, product_type character varying, is_derogation boolean);
      CREATE TABLE registered_phytosanitary_usages (id character varying, product_id integer, ephy_usage_phrase character varying,
        crop_label_fra character varying, species text[], target_name_label_fra character varying, treatment jsonb,
        dose_quantity numeric, dose_unit character varying, dose_unit_name character varying, pre_harvest_delay interval,
        applications_count integer, applications_frequency interval, untreated_buffer_aquatic integer,
        untreated_buffer_arthropod integer, untreated_buffer_plants integer, usage_conditions character varying,
        decision_date date, state character varying, is_derogation boolean, derogation_started_on date, derogation_stopped_on date);
      CREATE TABLE registered_phytosanitary_target_name_to_pfi_targets (ephy_name character varying, pfi_id integer, pfi_name character varying);`,
    [`phytosanitary/${phytoVersion}/data/p_0.csv.gz`]: csv([
      `9999001,GLISTER TEST,"{""BARBARIAN TEST""}",{Herbicide},"{""Glyphosate 360 g/L""}",9999001,PT6H,authorized,2015-08-12,,FIRME,PPP,f`,
    ]),
    [`phytosanitary/${phytoVersion}/data/u_0.csv.gz`]: csv([
      `u1,9999001,Maïs*Désherbage,Maïs,{zea_mays},Désherbage,"{""fra"": ""Trt Part.Aer.""}",3.0000,liter_per_hectare,L/ha,P90D,2,P14D,5,,,,2020-01-01,authorized,f,,`,
      `u2,9999001,Céréales*Désherbage,Céréales,{ephy_wheat},Désherbage,,4.0000,liter_per_hectare,L/ha,,,,20,,,,2020-01-01,withdrawn,f,,`,
    ]),
    [`phytosanitary/${phytoVersion}/data/c_0.csv.gz`]: csv([`ephy_wheat,"{""fra"": ""Blés""}","{triticum,triticosecale}"`]),
    [`phytosanitary/${phytoVersion}/data/t_0.csv.gz`]: csv([`Désherbage,1,Adventices`]),
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
  };
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const path = String(input).replace("http://lexicon.test/", "");
    requested.push(path);
    const body = files[path];
    if (body === undefined) return new Response("absent", { status: 404 });
    return new Response(body);
  }) as typeof fetch;
  return { fetchImpl, requested };
}

class Rollback extends Error {}

describe.skipIf(!url)("synchro du référentiel (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });

  it("charge produits, usages, ensembles et taxonomie ; une version connue n'est pas retéléchargée", async () => {
    await sql
      .begin(async (tx) => {
        const server = fakeServer("v1");
        const first = await syncLexiconIn(tx, { base: "http://lexicon.test", fetchImpl: server.fetchImpl, force: true });
        expect(first).toEqual([
          { name: "phytosanitary", version: "v1", status: "loaded", rows: 5 },
          { name: "taxonomy", version: "t1", status: "loaded", rows: 4 },
        ]);
        const [p] = await tx`SELECT amm, name, other_names, reentry_delay_hours, natures FROM phyto_products`;
        expect(p).toEqual({ amm: "9999001", name: "GLISTER TEST", other_names: ["BARBARIAN TEST"], reentry_delay_hours: 6, natures: ["Herbicide"] });
        const usages = await tx`SELECT id, species, dose_quantity::float8 AS dose, pre_harvest_delay_days, applications_count,
                                       applications_frequency_days, untreated_buffer_aquatic, treatment_label, state FROM phyto_usages ORDER BY id`;
        expect(usages[0]).toEqual({ id: "u1", species: ["zea_mays"], dose: 3, pre_harvest_delay_days: 90, applications_count: 2, applications_frequency_days: 14, untreated_buffer_aquatic: 5, treatment_label: "Trt Part.Aer.", state: "authorized" });
        expect(usages[1]).toMatchObject({ id: "u2", species: ["ephy_wheat"], pre_harvest_delay_days: null, state: "withdrawn" });
        expect(await tx`SELECT crop_names, label FROM phyto_cropsets`).toEqual([{ crop_names: ["triticum", "triticosecale"], label: "Blés" }]);
        expect(await tx`SELECT reference_name, parent, label FROM taxonomy ORDER BY 1`).toEqual([
          { reference_name: "zea", parent: "poaceae", label: "Maïs (genre)" },
          { reference_name: "zea_mays", parent: "zea", label: "Maïs" },
        ]);

        // Même version : rien n'est retéléchargé.
        const again = fakeServer("v1");
        const second = await syncLexiconIn(tx, { base: "http://lexicon.test", fetchImpl: again.fetchImpl });
        expect(second.map((r) => r.status)).toEqual(["up-to-date", "up-to-date"]);
        expect(again.requested).toEqual(["index.json"]);
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
