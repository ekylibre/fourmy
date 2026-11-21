import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Itinéraires techniques de la ferme (lot IT1) : création par le responsable,
 * lecture par l'ouvrier, révision (409), références de la ferme seulement,
 * élément supprimé gardé « à remplacer », copie, suppression ou désactivation.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const wheat = crypto.randomUUID();
const seed = crypto.randomUUID();
const drill = crypto.randomUUID();
const otherDrill = crypto.randomUUID();
const REF = "fourmy_test_itk_wheat";

describe.skipIf(!url)("itinéraires techniques (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let otherFarm = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test ITK");
    farmId = o.farmId;
    owner = o.headers;
    users.push(o.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
    const other = await setupFarm(sql, "Autre ferme ITK");
    otherFarm = other.farmId;
    users.push(other.userId);
    await sql`INSERT INTO lexicon_productions (reference_name, family, specie, label, started_on, stopped_on)
              VALUES (${REF}, 'plant_farming', 'triticum_aestivum', 'Blé d''essai', '2000-10-20', '2001-07-15') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO activities (id, farm_id, name, family, reference) VALUES (${wheat}, ${farmId}, 'Blé tendre', 'plant_farming', ${REF})`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${seed}, ${farmId}, 'Blé Chevignon', 'seed', 'kilogram')`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${drill}, ${farmId}, 'Semoir 4 m', 'trailed_equipment'), (${otherDrill}, ${otherFarm}, 'Semoir voisin', 'trailed_equipment')`;
  });
  afterAll(async () => {
    await teardown(sql, otherFarm, []);
    await teardown(sql, farmId, users);
    await sql`DELETE FROM lexicon_productions WHERE reference_name = ${REF}`;
    await sql.end();
  });

  const id = crypto.randomUUID();
  const sowing = crypto.randomUUID();
  const body = (over: Record<string, unknown> = {}) => ({
    id,
    name: "Blé tendre — Le Champ",
    activityId: wheat,
    content: {
      schema: 1,
      steps: [
        { id: crypto.randomUUID(), procedure: "plowing", anchor: { kind: "sowing", offsetDays: -30 } },
        {
          id: sowing,
          procedure: "sowing",
          anchor: { kind: "sowing", offsetDays: 0 },
          inputs: [{ articleId: seed, kind: "seed", label: "Blé Chevignon", dose: 180, unit: "kilogram_per_hectare" }],
          staffing: { equipmentIds: [drill] },
          workRateHaH: 2.5,
        },
        { id: crypto.randomUUID(), procedure: "harvesting", anchor: { kind: "harvest", offsetDays: 0 } },
      ],
    },
    ...over,
  });
  let revision = 0;

  it("le responsable crée, l'ouvrier lit mais n'écrit pas", async () => {
    expect((await send(worker, "POST", "/technical-itineraries", body())).status).toBe(403);
    const res = await send(owner, "POST", "/technical-itineraries", body());
    expect(res.status).toBe(201);
    const t = await res.json();
    expect(t).toMatchObject({ id, name: "Blé tendre — Le Champ", activityId: wheat, activityName: "Blé tendre", origin: "manual", revision: 0, missing: [] });
    expect(t.content.steps).toHaveLength(3);
    // Dates d'exemple : dates types Lexicon de la production de l'activité.
    expect(t.example.sowingOn).toMatch(/-10-20$/);
    expect(t.example.harvestOn).toMatch(/-07-15$/);
    revision = t.revision;
    // Double clic : idempotent.
    expect((await send(owner, "POST", "/technical-itineraries", body())).status).toBe(201);
    const list = await (await send(worker, "GET", `/technical-itineraries?activityId=${wheat}`)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ steps: 3, procedures: ["plowing", "sowing", "harvesting"], missing: 0 });
  });

  it("refuse un contenu invalide, un matériel d'une autre ferme, un nom déjà pris", async () => {
    const bad = body({ id: crypto.randomUUID(), name: "Autre" });
    (bad.content as { steps: { procedure: string }[] }).steps[0]!.procedure = "teleportation";
    expect((await send(owner, "POST", "/technical-itineraries", bad)).status).toBe(400);
    const foreign = body({ id: crypto.randomUUID(), name: "Autre" });
    (foreign.content as { steps: { staffing?: unknown }[] }).steps[1]!.staffing = { equipmentIds: [otherDrill] };
    expect((await send(owner, "POST", "/technical-itineraries", foreign)).status).toBe(400);
    expect((await send(owner, "POST", "/technical-itineraries", body({ id: crypto.randomUUID() }))).status).toBe(409);
  });

  it("modification avec la révision lue ; 409 avec la version du serveur sinon", async () => {
    const res = await send(owner, "PUT", `/technical-itineraries/${id}`, body({ revision, notes: "Semis direct si sec." }));
    expect(res.status).toBe(200);
    const t = await res.json();
    expect(t).toMatchObject({ revision: revision + 1, notes: "Semis direct si sec." });
    const stale = await send(owner, "PUT", `/technical-itineraries/${id}`, body({ revision }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).current.revision).toBe(revision + 1);
    revision = t.revision;
  });

  it("un article supprimé reste dans l'ITK, signalé « à remplacer », et l'ITK s'enregistre encore", async () => {
    await sql`DELETE FROM articles WHERE id = ${seed}`;
    const t = await (await send(owner, "GET", `/technical-itineraries/${id}`)).json();
    expect(t.missing).toEqual([{ stepId: sowing, kind: "article", id: seed, label: "Blé Chevignon" }]);
    const res = await send(owner, "PUT", `/technical-itineraries/${id}`, body({ revision }));
    expect(res.status).toBe(200);
    revision = (await res.json()).revision;
  });

  it("copie avec de nouveaux identifiants d'étape", async () => {
    const res = await send(owner, "POST", `/technical-itineraries/${id}/copy`);
    expect(res.status).toBe(201);
    const copy = await res.json();
    expect(copy).toMatchObject({ name: "Blé tendre — Le Champ (copie)", origin: "copy", source: { itineraryId: id } });
    expect(copy.content.steps.map((s: { id: string }) => s.id)).not.toContain(sowing);
    const again = await (await send(owner, "POST", `/technical-itineraries/${id}/copy`)).json();
    expect(again.name).toBe("Blé tendre — Le Champ (copie 2)");
    expect((await send(owner, "DELETE", `/technical-itineraries/${again.id}`)).status).toBe(200);
  });

  it("suppression : désactivé s'il sert à un assolement, supprimé sinon", async () => {
    await sql`INSERT INTO crop_plans (id, farm_id, year, status, draft) VALUES (${crypto.randomUUID()}, ${farmId}, 2027, 'draft',
      ${sql.json({ schema: 1, year: 2027, operations: [], covers: [], fallow: [], excluded: [], assignments: [{ id: "a1", key: "p:x", role: "main", activityId: wheat, startedOn: null, stoppedOn: null, itineraryId: id }] })})`;
    expect(await (await send(owner, "DELETE", `/technical-itineraries/${id}`)).json()).toEqual({ deleted: false });
    const t = await (await send(owner, "GET", `/technical-itineraries/${id}`)).json();
    expect(t.active).toBe(false);
    expect((await (await send(owner, "GET", "/technical-itineraries?active=true")).json()).items.map((i: { id: string }) => i.id)).not.toContain(id);
    expect((await send(owner, "GET", `/technical-itineraries/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
