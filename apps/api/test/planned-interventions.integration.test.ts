import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Interventions prévues d'après les ITK (lot IT3, conception §7) : l'ITK
 * choisi dans l'assolement passe à la production ; aperçu, création,
 * relance sans effet, modification à la main gardée, ITK modifié (mise à
 * jour, retrait), aperçu périmé, intervention réalisée jamais touchée.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const SQUARE = "MULTIPOLYGON(((0.5 44.8,0.51 44.8,0.51 44.809,0.5 44.809,0.5 44.8)))";

const wheat = crypto.randomUUID();
const parcel = crypto.randomUUID();
const seed = crypto.randomUUID();
const drill = crypto.randomUUID();
const itkA = crypto.randomUUID();
const itkB = crypto.randomUUID();
const S = { sowing: crypto.randomUUID(), spraying: crypto.randomUUID(), harvest: crypto.randomUUID() };

type Item = { key: string; state: string; procedure: string; day: string | null; interventionId: string | null; itineraryChanged: boolean };
type Preview = { items: Item[]; previewHash: string; withoutItinerary: number };

describe.skipIf(!url)("interventions prévues d'après les ITK (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const preview = async (): Promise<Preview> => (await send(owner, "POST", "/planned-interventions/2027/preview", {})).json();
  const states = (p: Preview) => Object.fromEntries(p.items.map((i) => [i.procedure, i.state]));
  const content = (sowingDose: number, withSpraying: boolean) => ({
    schema: 1,
    steps: [
      { id: S.sowing, procedure: "sowing", anchor: { kind: "sowing", offsetDays: 0 }, inputs: [{ articleId: seed, kind: "seed", label: "Blé Chevignon", dose: sowingDose, unit: "kilogram_per_hectare" }], staffing: { equipmentIds: [drill] } },
      ...(withSpraying ? [{ id: S.spraying, procedure: "spraying", anchor: { kind: "sowing", offsetDays: 25 }, share: 0.5 }] : []),
      { id: S.harvest, procedure: "harvesting", anchor: { kind: "harvest", offsetDays: 0 } },
    ],
  });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test interventions prévues");
    farmId = o.farmId;
    owner = o.headers;
    users.push(o.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Le Champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid) VALUES (${crypto.randomUUID()}, ${parcel}, ST_GeomFromText(${SQUARE}, 4326), 100000, tstzrange('2020-01-01', NULL))`;
    await sql`INSERT INTO activities (id, farm_id, name, family, cap_code) VALUES (${wheat}, ${farmId}, 'Blé tendre', 'plant_farming', 'BTH')`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${seed}, ${farmId}, 'Blé Chevignon', 'seed', 'kilogram')`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${drill}, ${farmId}, 'Semoir 4 m', 'trailed_equipment')`;
    for (const [id, name] of [[itkA, "Blé A"], [itkB, "Blé B"]] as const)
      expect((await send(owner, "POST", "/technical-itineraries", { id, name, activityId: wheat, content: content(180, true) })).status).toBe(201);
    // Campagne 2026 avec du blé sur Le Champ : l'assolement 2027 en part.
    const c26 = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${c26}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id, stopped_on) VALUES (${crypto.randomUUID()}, ${farmId}, ${c26}, ${parcel}, 'field_crop', ${wheat}, '2026-07-10')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql.end();
  });

  it("l'ITK choisi dans l'assolement passe à la production à la validation", async () => {
    const created = await (await send(owner, "POST", "/crop-plans/2027")).json();
    const draft = {
      ...created.draft,
      assignments: [{ id: "a1", key: `p:${parcel}`, role: "main", activityId: wheat, startedOn: "2026-10-15", stoppedOn: "2027-07-10", itineraryId: itkA }],
    };
    const saved = await send(owner, "PUT", "/crop-plans/2027/draft", { revision: created.revision, draft });
    expect(saved.status).toBe(200);
    const res = await send(owner, "POST", "/crop-plans/2027/validate", { revision: (await saved.json()).revision });
    expect(res.status).toBe(200);
    const [p] = await sql`SELECT p.attrs->>'itineraryId' AS itk FROM productions p JOIN campaigns c ON c.id = p.campaign_id WHERE c.year = 2027 AND p.farm_id = ${farmId}`;
    expect(p!.itk).toBe(itkA);
    // Rouvert, l'assolement garde l'ITK de la production.
    const reopened = await (await send(owner, "POST", "/crop-plans/2027/reopen")).json();
    expect(reopened.draft.assignments[0].itineraryId).toBe(itkA);
    await send(owner, "DELETE", "/crop-plans/2027/draft");
  });

  it("aperçu, puis création ; l'ouvrier lit l'aperçu mais ne confirme pas", async () => {
    const p = await (await send(worker, "POST", "/planned-interventions/2027/preview", {})).json();
    expect(states(p)).toEqual({ sowing: "create", spraying: "create", harvesting: "create" });
    expect(p.items.find((i: Item) => i.procedure === "spraying").day).toBe("2026-11-09");
    expect((await send(worker, "POST", "/planned-interventions/2027", { previewHash: p.previewHash, accepted: p.items.map((i: Item) => i.key) })).status).toBe(403);
    const res = await send(owner, "POST", "/planned-interventions/2027", { previewHash: p.previewHash, accepted: p.items.map((i: Item) => i.key) });
    expect(await res.json()).toEqual({ created: 3, updated: 0, removed: 0, failed: [] });
    const list = await sql`SELECT procedure, status, itinerary_ref->>'stepId' AS step FROM interventions WHERE farm_id = ${farmId} ORDER BY started_at`;
    expect(list.map((r) => [r.procedure, r.status])).toEqual([["sowing", "planned"], ["spraying", "planned"], ["harvesting", "planned"]]);
    // Le semis porte l'intrant à l'hectare, le matériel et la surface.
    const [inputs] = await sql`SELECT quantity::float8 AS q, unit FROM intervention_parameters pr JOIN interventions i ON i.id = pr.intervention_id WHERE i.farm_id = ${farmId} AND pr.role = 'input'`;
    expect(inputs).toEqual({ q: 180, unit: "kilogram_per_hectare" });
  });

  it("relancée : rien de nouveau ; une intervention déplacée à la main est conservée", async () => {
    const again = await preview();
    expect(states(again)).toEqual({ sowing: "same", spraying: "same", harvesting: "same" });
    const spraying = again.items.find((i) => i.procedure === "spraying")!;
    await sql`UPDATE interventions SET started_at = '2026-11-20T06:00:00Z' WHERE id = ${spraying.interventionId}`;
    expect(states(await preview()).spraying).toBe("modified");
  });

  it("ITK modifié : semis refait, étape retirée annulée ; aperçu périmé refusé ; réalisée jamais touchée", async () => {
    const harvest = (await preview()).items.find((i) => i.procedure === "harvesting")!;
    await sql`UPDATE interventions SET status = 'done' WHERE id = ${harvest.interventionId}`;
    await sql`UPDATE interventions SET started_at = '2026-11-09T06:00:00Z' WHERE farm_id = ${farmId} AND procedure = 'spraying'`; // remise à la date générée
    const current = await (await send(owner, "GET", `/technical-itineraries/${itkA}`)).json();
    const put = await send(owner, "PUT", `/technical-itineraries/${itkA}`, { revision: current.revision, name: current.name, activityId: wheat, content: content(200, false) });
    expect(put.status).toBe(200);
    const p = await preview();
    expect(states(p)).toEqual({ sowing: "update", spraying: "remove", harvesting: "done" });
    expect(p.items.find((i) => i.procedure === "sowing")!.itineraryChanged).toBe(true);

    expect((await send(owner, "POST", "/planned-interventions/2027", { previewHash: "périmé", accepted: [] })).status).toBe(409);
    const res = await send(owner, "POST", "/planned-interventions/2027", { previewHash: p.previewHash, accepted: p.items.map((i) => i.key) });
    expect(await res.json()).toEqual({ created: 0, updated: 1, removed: 1, failed: [] });
    const live = await sql`SELECT procedure, status FROM interventions WHERE farm_id = ${farmId} AND status <> 'cancelled' ORDER BY started_at`;
    expect(live.map((r) => [r.procedure, r.status])).toEqual([["sowing", "planned"], ["harvesting", "done"]]);
    const [dose] = await sql`SELECT pr.quantity::float8 AS q FROM intervention_parameters pr JOIN interventions i ON i.id = pr.intervention_id WHERE i.farm_id = ${farmId} AND i.status = 'planned' AND pr.role = 'input'`;
    expect(dose!.q).toBe(200);
    expect(states(await preview())).toEqual({ sowing: "same", harvesting: "done" });
  });

  it("découpe (#116) : générée annulée, saisie à la main reportée ou répartie au prorata", async () => {
    // La récolte « réalisée » du test précédent bloquerait la date d'effet : on l'annule.
    await sql`UPDATE interventions SET status = 'cancelled' WHERE farm_id = ${farmId} AND status = 'done'`;
    // Deux interventions prévues saisies à la main sur Le Champ, après la date d'effet.
    const manual = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [k, id] of manual.entries()) {
      await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at) VALUES (${id}, ${farmId}, 'mineral_fertilizing', 'planned', 'web', ${`2027-03-0${k + 1}T06:00:00Z`})`;
      await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, attrs) VALUES (${crypto.randomUUID()}, ${id}, 'target', 'land_parcel', ${parcel}, '{"workedAreaM2": 100000}'::jsonb)`;
      await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${id}, 'input', 'article', ${seed}, 100, 'kilogram')`;
    }
    const generated = (await sql`SELECT id FROM interventions WHERE farm_id = ${farmId} AND itinerary_ref IS NOT NULL AND status = 'planned'`).map((r) => r.id as string);
    expect(generated).toHaveLength(1);

    // Découpe en deux moitiés au 1er août 2026, une culture par morceau.
    const half = (x0: number, x1: number) => ({ type: "MultiPolygon", coordinates: [[[[x0, 44.8], [x1, 44.8], [x1, 44.809], [x0, 44.809], [x0, 44.8]]]] });
    const reopened = await (await send(owner, "POST", "/crop-plans/2027/reopen")).json();
    const draft = {
      ...reopened.draft,
      operations: [{ kind: "split", source: `p:${parcel}`, effectiveOn: "2026-08-01", pieces: [
        { key: "n:ouest", name: "Le Champ ouest", shape: half(0.5, 0.505), areaM2: 60000 },
        { key: "n:est", name: "Le Champ est", shape: half(0.505, 0.51), areaM2: 40000 },
      ] }],
      assignments: ["n:ouest", "n:est"].map((key, k) => ({ id: `s${k}`, key, role: "main", activityId: wheat, startedOn: "2026-10-15", stoppedOn: "2027-07-10", itineraryId: itkA })),
    };
    const saved = await (await send(owner, "PUT", "/crop-plans/2027/draft", { revision: reopened.revision, draft })).json();
    const dry = await (await send(owner, "POST", "/crop-plans/2027/validate?dryRun=1", { revision: saved.revision })).json();
    expect(dry.blockers.map((b: { code: string }) => b.code)).toContain("planned-interventions");
    expect(dry.plannedToMove.map((m: { interventionId: string }) => m.interventionId).sort()).toEqual([...manual].sort());
    expect(dry.changes.filter((c: { kind: string }) => c.kind === "intervention.cancel").map((c: { interventionId: string }) => c.interventionId)).toEqual(generated);

    const plannedMoves = { [manual[0]!]: "n:ouest", [manual[1]!]: "each" };
    const res = await send(owner, "POST", "/crop-plans/2027/validate", { revision: saved.revision, plannedMoves });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.blockers).toEqual([]);
    const pieces = Object.fromEntries((await sql`SELECT p.name, p.id FROM land_parcel_lineage l JOIN land_parcels p ON p.id = l.child_id WHERE l.parent_id = ${parcel}`).map((r) => [r.name, r.id]));
    expect(Object.keys(pieces).sort()).toEqual(["Le Champ est", "Le Champ ouest"]);
    // Générée : annulée.
    expect((await sql`SELECT status FROM interventions WHERE id = ${generated[0]!}`)[0]!.status).toBe("cancelled");
    // Reportée : sur le morceau ouest, surface saisie retirée.
    const [moved] = await sql`SELECT ref_id, attrs FROM intervention_parameters WHERE intervention_id = ${manual[0]!} AND role = 'target'`;
    expect(moved).toEqual({ ref_id: pieces["Le Champ ouest"], attrs: null });
    // Répartie : l'originale annulée, une copie par morceau, 100 kg au prorata (60 / 40).
    expect((await sql`SELECT status FROM interventions WHERE id = ${manual[1]!}`)[0]!.status).toBe("cancelled");
    const copies = await sql`SELECT t.ref_id, q.quantity::float8 AS q FROM interventions i
      JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target'
      JOIN intervention_parameters q ON q.intervention_id = i.id AND q.role = 'input'
      WHERE i.farm_id = ${farmId} AND i.status = 'planned' AND i.started_at = '2027-03-02T06:00:00Z'`;
    expect(Object.fromEntries(copies.map((c) => [c.ref_id, c.q]))).toEqual({ [pieces["Le Champ ouest"]]: 60, [pieces["Le Champ est"]]: 40 });
    // Les nouvelles productions portent l'ITK : la génération repropose ses étapes sur chaque morceau.
    const p = await preview();
    expect(p.items.filter((i) => i.state === "create").length).toBe(4); // semis et récolte (ITK sans pulvérisation) × 2 morceaux
  });
});
