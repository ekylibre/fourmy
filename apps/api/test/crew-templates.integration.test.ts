import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Attelages types (lot Q1, FR-ATT-6) : « Arion 630 + charrue — Pierre »
 * enregistré par le responsable, lu par l'ouvrier, repris dans une
 * intervention ; le modifier ou le supprimer ne change pas le passé.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const tractor = crypto.randomUUID();
const plough = crypto.randomUUID();
const harrow = crypto.randomUUID();
const driver = crypto.randomUUID();
const parcel = crypto.randomUUID();

describe.skipIf(!url)("attelages types (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let otherFarm = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test attelages types");
    farmId = o.farmId;
    owner = o.headers;
    users.push(o.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
    const other = await setupFarm(sql, "Autre ferme attelages types");
    otherFarm = other.farmId;
    users.push(other.userId);
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES
      (${tractor}, ${farmId}, 'Arion 630', 'tractor'), (${plough}, ${farmId}, 'Charrue', 'trailed_equipment'),
      (${harrow}, ${otherFarm}, 'Herse voisine', 'trailed_equipment')`;
    await sql`INSERT INTO people (id, farm_id, name) VALUES (${driver}, ${farmId}, 'Pierre')`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Grand champ')`;
  });
  afterAll(async () => {
    await teardown(sql, otherFarm, []);
    await teardown(sql, farmId, users);
    await sql.end();
  });

  const id = crypto.randomUUID();
  const body = { id, name: "Arion 630 + charrue — Pierre", equipmentIds: [tractor, plough], personIds: [driver] };

  it("le responsable crée, l'ouvrier lit mais n'écrit pas", async () => {
    expect((await send(worker, "POST", "/crew-templates", body)).status).toBe(403);
    const res = await send(owner, "POST", "/crew-templates", body);
    expect(res.status).toBe(201);
    const t = await res.json();
    expect(t).toMatchObject({ id, name: body.name, active: true, equipmentIds: [tractor, plough], personIds: [driver] });
    // Rejeu (hors ligne) : idempotent.
    expect((await send(owner, "POST", "/crew-templates", body)).status).toBe(201);
    const list = await (await send(worker, "GET", "/crew-templates")).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].equipmentIds).toEqual([tractor, plough]); // ordre saisi
  });

  it("refuse un nom pris, un matériel d'une autre ferme, un modèle sans matériel", async () => {
    expect((await send(owner, "POST", "/crew-templates", { ...body, id: crypto.randomUUID() })).status).toBe(409);
    expect((await send(owner, "POST", "/crew-templates", { name: "Voisin", equipmentIds: [harrow] })).status).toBe(400);
    expect((await send(owner, "POST", "/crew-templates", { name: "Vide", equipmentIds: [] })).status).toBe(400);
    expect((await send(owner, "PUT", `/crew-templates/${crypto.randomUUID()}`, { name: "X", equipmentIds: [tractor] })).status).toBe(404);
  });

  const intervention = crypto.randomUUID();
  const P = { startedAt: "2026-10-02T08:00:00.000Z", stoppedAt: "2026-10-02T11:00:00.000Z" };

  it("une intervention garde la composition copiée et l'origine ; modifier le modèle ne la change pas", async () => {
    const res = await send(owner, "POST", "/interventions", {
      id: intervention,
      procedure: "plowing",
      staffing: "crews",
      crews: [{ templateId: id, tools: [{ equipmentId: tractor }, { equipmentId: plough }], doers: [{ personId: driver }], periods: [P] }],
      targets: [{ kind: "land_parcel", id: parcel }],
    });
    expect(res.status).toBe(201);
    const put = await send(owner, "PUT", `/crew-templates/${id}`, { name: "Arion 630 seul", active: false, equipmentIds: [tractor] });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ name: "Arion 630 seul", active: false, equipmentIds: [tractor], personIds: [] });
    const i = await (await send(owner, "GET", `/interventions/${intervention}`)).json();
    expect(i.crews[0].templateId).toBe(id);
    expect(i.crews[0].tools.map((t: { equipmentId: string }) => t.equipmentId).sort()).toEqual([tractor, plough].sort());
    expect(i.crews[0].doers).toEqual([{ personId: driver }]);
  });

  it("une origine inconnue est oubliée, la suppression du modèle laisse l'intervention intacte", async () => {
    const stray = crypto.randomUUID();
    const res = await send(owner, "POST", "/interventions", {
      id: stray,
      procedure: "plowing",
      staffing: "crews",
      crews: [{ templateId: crypto.randomUUID(), tools: [{ equipmentId: tractor }], periods: [P] }],
      targets: [{ kind: "land_parcel", id: parcel }],
    });
    expect(res.status).toBe(201);
    expect((await (await send(owner, "GET", `/interventions/${stray}`)).json()).crews[0].templateId).toBeNull();

    expect((await send(worker, "DELETE", `/crew-templates/${id}`)).status).toBe(403);
    expect((await send(owner, "DELETE", `/crew-templates/${id}`)).status).toBe(204);
    expect((await send(owner, "DELETE", `/crew-templates/${id}`)).status).toBe(404);
    const i = await (await send(owner, "GET", `/interventions/${intervention}`)).json();
    expect(i.crews[0].templateId).toBeNull();
    expect(i.crews[0].tools).toHaveLength(2);
  });

  it("isolation : l'autre ferme ne voit pas les attelages types", async () => {
    await send(owner, "POST", "/crew-templates", { name: "Arion 630", equipmentIds: [tractor] });
    const [n] = await sql`SELECT count(*)::int AS n FROM crew_templates WHERE farm_id = ${farmId}`;
    expect(n!.n).toBe(1);
    const res = await app.request(`/api/v1/farms/${otherFarm}/crew-templates`, { headers: owner });
    expect(res.status).toBe(403); // pas membre
  });
});
