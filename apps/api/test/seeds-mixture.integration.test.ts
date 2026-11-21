import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Mélanges et couverts (lot SE6, FR-SE-13 à 16, S7) : espèces d'un mélange
 * sans proportion, doses saisies au semis (somme = dose du mélange, refus
 * sinon), doses du dernier semis proposées, couvert de la parcelle rattaché
 * au semis avec ses espèces, proposition « Reprendre le semis ».
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const parcelId = crypto.randomUUID();
const bareParcel = crypto.randomUUID();
const mix = crypto.randomUUID();
const single = crypto.randomUUID();
const lot = crypto.randomUUID();

describe.skipIf(!url)("mélanges de semences et couverts (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let ownerId = "";
  let headers: Record<string, string> = {};
  let base = "";
  let taxonomy = false;

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test mélanges");
    farmId = owner.farmId;
    ownerId = owner.userId;
    headers = owner.headers;
    base = `/api/v1/farms/${farmId}`;
    for (const [id, name] of [
      [parcelId, "Les Noues"],
      [bareParcel, "Le Pré"],
    ] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${crypto.randomUUID()}, ${id},
                ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5126 44.8,0.5126 44.8090,0.5 44.8090,0.5 44.8)))', 4326),
                100000, tstzrange('2026-01-01', NULL))`;
    }
    const place = crypto.randomUUID();
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${place}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES
      (${mix}, ${farmId}, 'Couvert Avoine + Vesce + Phacélie + Radis', 'seed', 'kilogram'),
      (${single}, ${farmId}, 'Moutarde blanche', 'seed', 'kilogram')`;
    await sql`INSERT INTO article_seeds (article_id, farm_id, species, is_mixture) VALUES
      (${mix}, ${farmId}, null, true), (${single}, ${farmId}, 'sinapis_alba', false)`;
    await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lot}, ${farmId}, ${mix}, 'LOT-COUVERT')`;
    await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${lot}, ${place}, 500, 'kilogram', '2026-07-01', 'purchase')`;
    // Couvert déjà saisi (plan de fumure), semé « vers le 20 août » : le semis du 12 le rattache.
    await sql`INSERT INTO cover_crops (id, farm_id, land_parcel_id, campaign, kind, family, species, sown_on)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${parcelId}, 2027, 'sown', 'melange_graminees_legumineuses', 'Couvert', '2026-08-20')`;
    const [t] = await sql`SELECT count(*)::int AS n FROM taxonomy WHERE reference_name IN ('fabaceae', 'vicia_sativa', 'brassicaceae', 'poaceae')`;
    taxonomy = t!.n === 4;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [ownerId]);
    await sql.end();
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const sow = async (input: object, parcel = parcelId, day = "2026-08-12") => {
    const id = crypto.randomUUID();
    await send("POST", "/interventions", { id, procedure: "sowing" });
    const res = await send("POST", `/interventions/${id}/complete`, {
      periods: [{ startedAt: `${day}T07:00:00Z`, stoppedAt: `${day}T12:00:00Z` }],
      targets: [{ kind: "land_parcel", id: parcel }],
      inputs: [input],
    });
    return { id, res };
  };
  let components: { id: string; label: string; species: string | null; legume?: boolean }[] = [];
  const doses = () => [
    { componentId: components[0]!.id, label: "Avoine rude", species: "avena_strigosa", kgHa: 8 },
    { componentId: components[1]!.id, label: "Vesce commune", species: "vicia_sativa", kgHa: 4 },
    { componentId: components[2]!.id, label: "Phacélie", species: "phacelia_tanacetifolia", kgHa: 2 },
    { componentId: components[3]!.id, label: "Radis fourrager", species: "raphanus_sativus", kgHa: 1 },
  ];

  it("décrit les quatre espèces du mélange, sans proportion ; une espèce gardée garde son identifiant", async () => {
    const res = await send("PUT", `/articles/${mix}/seed/components`, {
      components: [
        { label: "Avoine rude", species: "avena_strigosa" },
        { label: "Vesce commune", species: "vicia_sativa" },
        { label: "Phacélie", species: "phacelia_tanacetifolia" },
        { label: "Radis", species: "raphanus_sativus" },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const first = (await res.json()).components;
    expect(first.map((c: { label: string }) => c.label)).toEqual(["Avoine rude", "Vesce commune", "Phacélie", "Radis"]);
    if (taxonomy) expect(first.filter((c: { legume: boolean }) => c.legume).map((c: { label: string }) => c.label)).toEqual(["Vesce commune"]);
    // Renommer le radis : les trois autres gardent leur identifiant.
    const again = await send("PUT", `/articles/${mix}/seed/components`, {
      components: [
        { label: "Avoine rude", species: "avena_strigosa" },
        { label: "Vesce commune", species: "vicia_sativa" },
        { label: "Phacélie", species: "phacelia_tanacetifolia" },
        { label: "Radis fourrager", species: "raphanus_sativus" },
      ],
    });
    components = (await again.json()).components;
    expect(components.slice(0, 3).map((c) => c.id)).toEqual(first.slice(0, 3).map((c: { id: string }) => c.id));
    expect((await (await send("GET", `/seeds`)).json()).items.find((s: { articleId: string }) => s.articleId === mix).flags).not.toContain("mixture_empty");
  });

  it("refuse les espèces d'une semence qui n'est pas un mélange, et une espèce en double", async () => {
    expect((await send("PUT", `/articles/${single}/seed/components`, { components: [{ label: "Moutarde" }] })).status).toBe(400);
    expect((await send("PUT", `/articles/${mix}/seed/components`, { components: [{ label: "Avoine" }, { label: "avoine" }] })).status).toBe(400);
  });

  it("422 si la dose du mélange n'est pas la somme des doses, ou pas en kg/ha", async () => {
    const wrong = await sow({ articleId: mix, quantity: 16, per: "hectare", lotId: lot, mixture: doses() });
    expect(wrong.res.status).toBe(422);
    expect(await wrong.res.text()).toMatch(/16 kg\/ha.*somme.*15 kg\/ha/);
    const total = await sow({ articleId: mix, quantity: 150, per: "total", lotId: lot, mixture: doses() });
    expect(total.res.status).toBe(422);
    const notMix = await sow({ articleId: single, quantity: 8, per: "hectare", mixture: [{ label: "Moutarde", kgHa: 8 }] });
    expect(notMix.res.status).toBe(422);
    const foreign = await sow({ articleId: mix, quantity: 8, per: "hectare", mixture: [{ componentId: crypto.randomUUID(), label: "Avoine rude", kgHa: 8 }] });
    expect(foreign.res.status).toBe(422);
  });

  it("8 + 4 + 2 + 1 = 15 kg/ha sur 10 ha : 150 kg sortent du stock, doses gardées et proposées au semis suivant", async () => {
    const { id, res } = await sow({ articleId: mix, quantity: 15, per: "hectare", lotId: lot, mixture: doses() });
    expect(res.status, await res.clone().text()).toBe(200);
    const r = await res.json();
    expect(r.movements[0].quantity).toBeCloseTo(-150);
    expect(r.intervention.inputs[0].mixture).toHaveLength(4);
    expect(r.intervention.inputs[0].mixture[1]).toMatchObject({ label: "Vesce commune", kgHa: 4 });
    expect(r.warnings.join(" ")).toMatch(/Couvert d'interculture de la parcelle rattaché/);

    const m = await (await send("GET", `/articles/${mix}/seed/mixture`)).json();
    expect(m.last).toMatchObject({ interventionId: id, startedAt: "2026-08-12" });
    expect(m.last.doses.map((d: { kgHa: number }) => d.kgHa)).toEqual([8, 4, 2, 1]);
    expect(m.components).toHaveLength(4);
  });

  it("le couvert de la parcelle reprend les quatre espèces, leurs doses et la date du semis", async () => {
    const [cc] = await sql`SELECT species, sown_on::text, components, sowing_intervention_id FROM cover_crops WHERE land_parcel_id = ${parcelId}`;
    expect(cc!.sown_on).toBe("2026-08-12");
    expect(cc!.species).toBe("Avoine rude, Vesce commune, Phacélie, Radis fourrager");
    expect((cc!.components as { kgHa: number }[]).map((c) => c.kgHa)).toEqual([8, 4, 2, 1]);
    expect(cc!.sowing_intervention_id).not.toBeNull();
    if (!taxonomy) return;
    // Légumineuse repérée d'après les espèces semées, même si la famille saisie n'en disait rien.
    await sql`UPDATE cover_crops SET family = 'cruciferes' WHERE land_parcel_id = ${parcelId}`;
    const [l] = await sql.unsafe(
      `SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(components) x JOIN taxonomy t ON t.reference_name = x->>'species' WHERE t.parent = 'vicia') AS legume
       FROM cover_crops WHERE land_parcel_id = $1`,
      [parcelId],
    );
    expect(l!.legume).toBe(true);
  });

  it("sans couvert saisi : rien n'est créé, la parcelle propose de reprendre le semis, famille déduite", async () => {
    const { res } = await sow({ articleId: mix, quantity: 15, per: "hectare", lotId: lot, mixture: doses() }, bareParcel, "2026-08-14");
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.join(" ")).not.toMatch(/Couvert/);
    const [n] = await sql`SELECT count(*)::int AS n FROM cover_crops WHERE land_parcel_id = ${bareParcel}`;
    expect(n!.n).toBe(0);
    const p = await (await send("GET", `/land-parcels/${bareParcel}/cover-crop/sowings?campaign=2027`)).json();
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ startedAt: "2026-08-14" });
    expect(p.items[0].components.map((c: { label: string }) => c.label)).toEqual(["Avoine rude", "Vesce commune", "Phacélie", "Radis fourrager"]);
    // Graminée, légumineuse, phacélie et crucifère : aucune famille du référentiel, le responsable choisit.
    if (taxonomy) expect(p.items[0]).toMatchObject({ family: null, legumes: 1 });

    const save = await send("PUT", `/land-parcels/${bareParcel}/cover-crop`, {
      campaign: 2027,
      family: "melange_graminees_legumineuses",
      species: "Avoine rude, Vesce commune, Phacélie, Radis fourrager",
      sownOn: "2026-08-14",
      sowingInterventionId: p.items[0].interventionId,
      components: p.items[0].components,
    });
    expect(save.status, await save.clone().text()).toBe(200);
    expect((await save.json()).components).toHaveLength(4);
    // Repris : il n'est plus proposé.
    expect((await (await send("GET", `/land-parcels/${bareParcel}/cover-crop/sowings?campaign=2027`)).json()).items).toHaveLength(0);
    // Un semis d'une autre parcelle ne se reprend pas.
    const other = await send("PUT", `/land-parcels/${parcelId}/cover-crop`, {
      campaign: 2027,
      family: "legumineuses",
      species: "Vesce",
      sownOn: "2026-08-14",
      sowingInterventionId: p.items[0].interventionId,
    });
    expect(other.status).toBe(400);
  });

  it("une semence seule : le couvert reprend son espèce et sa dose", async () => {
    const parcel = crypto.randomUUID();
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'La Lande')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcel}, ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5126 44.8,0.5126 44.8090,0.5 44.8090,0.5 44.8)))', 4326),
              100000, tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO cover_crops (id, farm_id, land_parcel_id, campaign, kind, family, species, sown_on)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${parcel}, 2027, 'sown', 'cruciferes', 'Moutarde', '2026-09-01')`;
    const { res } = await sow({ articleId: single, quantity: 8, per: "hectare" }, parcel, "2026-09-03");
    expect(res.status, await res.clone().text()).toBe(200);
    const [cc] = await sql`SELECT components FROM cover_crops WHERE land_parcel_id = ${parcel}`;
    expect(cc!.components).toEqual([{ label: expect.any(String), species: "sinapis_alba", kgHa: 8 }]);
  });
});
