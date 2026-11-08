import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/**
 * Fiche, modification et correction tracée (exigences INT-UI-2, INT-UI-3) :
 * le stock et le registre suivent la nouvelle version, l'historique garde
 * l'ancienne ; une correction rejouée ou suivie d'une annulation ne
 * contre-passe jamais deux fois.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const parcelId = crypto.randomUUID();
const hangarId = crypto.randomUUID();
const fongicideId = crypto.randomUUID();
const lotA = crypto.randomUUID();

describe.skipIf(!url)("interventions : fiche et correction tracée (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let ownerId = "";
  let worker: { userId: string; headers: Record<string, string> };
  let otherFarm: { farmId: string; userId: string; headers: Record<string, string> };
  let base = "";

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test corrections");
    farmId = owner.farmId;
    ownerId = owner.userId;
    worker = await addMember(sql, farmId, "worker");
    otherFarm = await setupFarm(sql, "Autre ferme");
    base = `/api/v1/farms/${farmId}`;
    // Parcelle de 1 ha ; fongicide, 20 L en stock au hangar. Campagne 2025 close, 2026 ouverte.
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Les Vignes')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326),
              10000, tstzrange('2024-01-01', NULL))`;
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES
      (${crypto.randomUUID()}, ${farmId}, 2025, '2025-01-01', '2025-12-31'),
      (${crypto.randomUUID()}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${hangarId}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO place_versions (id, place_id, kind, source, valid) VALUES (${crypto.randomUUID()}, ${hangarId}, 'building', 'manual', tstzrange('2000-01-01', NULL))`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${fongicideId}, ${farmId}, 'Fongicide X', 'phyto', 'liter', '2100001')`;
    await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lotA}, ${farmId}, ${fongicideId}, 'LOT-A')`;
    await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${lotA}, ${hangarId}, 20, 'liter', '2025-03-01', 'purchase')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [ownerId, worker.userId]);
    await teardown(sql, otherFarm.farmId, [otherFarm.userId]);
    await sql.end();
  });

  const send = (method: string, path: string, body?: unknown, headers = worker.headers) =>
    app.request(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const get = async (path: string) => (await send("GET", path)).json();
  const stockAt = async (at: string) => (await get(`/stock?at=${at}&article=${fongicideId}`)).items[0]?.quantity;

  const period = (day: string) => ({ startedAt: `${day}T08:00:00Z`, stoppedAt: `${day}T09:00:00Z` });
  const spraying = (dose: number, day = "2026-06-10", extra: object = {}) => ({
    procedure: "spraying",
    periods: [period(day)],
    targets: [{ kind: "land_parcel", id: parcelId }],
    inputs: [{ articleId: fongicideId, quantity: dose, per: "hectare" }],
    purposes: ["fungicide"],
    ...extra,
  });

  const plannedId = crypto.randomUUID();
  const doneId = crypto.randomUUID();

  it("une intervention planifiée se modifie directement ; l'historique garde l'avant et l'après", async () => {
    await send("POST", "/interventions", { id: plannedId, procedure: "plowing", targets: [{ kind: "land_parcel", id: parcelId }], plannedAt: "2026-07-01T08:00:00Z" });
    const res = await send("PUT", `/interventions/${plannedId}`, {
      procedure: "superficial_plowing",
      targets: [{ kind: "land_parcel", id: parcelId }],
      plannedAt: "2026-07-02T08:00:00Z",
      notes: "sol ressuyé",
    });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.warnings).toEqual([]);
    expect(r.intervention).toMatchObject({ status: "planned", procedure: "superficial_plowing", notes: "sol ressuyé", startedAt: "2026-07-02T08:00:00.000Z" });

    const detail = await get(`/interventions/${plannedId}`);
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(["planned", "updated"]);
    const updated = detail.history[1];
    expect(updated.changes.procedure).toEqual({ before: "plowing", after: "superficial_plowing" });
    expect(updated.changes.notes).toEqual({ before: null, after: "sol ressuyé" });
    expect(updated.actorName).not.toBeUndefined();
  });

  it("une modification qui ne change rien est refusée (422)", async () => {
    const res = await send("PUT", `/interventions/${plannedId}`, {
      procedure: "superficial_plowing",
      targets: [{ kind: "land_parcel", id: parcelId }],
      notes: "sol ressuyé",
    });
    expect(res.status).toBe(422);
  });

  it("corriger la dose d'une intervention réalisée : stock et registre suivent, l'historique garde l'ancienne dose", async () => {
    await send("POST", "/interventions", { id: doneId, procedure: "spraying" });
    expect((await send("POST", `/interventions/${doneId}/complete`, spraying(2))).status).toBe(200);
    expect(await stockAt("2026-06-11T00:00:00Z")).toBe(18);

    const res = await send("PUT", `/interventions/${doneId}`, { ...spraying(1.5), reason: "dose mal recopiée", correctionId: crypto.randomUUID() });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.intervention.status).toBe("done");
    expect(r.intervention.inputs[0]).toMatchObject({ quantity: 1.5, per: "hectare" });
    expect(await stockAt("2026-06-11T00:00:00Z")).toBe(18.5);

    const register = await get("/registers/phyto?campaign=2026");
    expect(register.items).toEqual([expect.objectContaining({ interventionId: doneId, quantity: 1.5 })]);

    const detail = await get(`/interventions/${doneId}`);
    const corrected = detail.history.at(-1);
    expect(corrected).toMatchObject({ action: "corrected", reason: "dose mal recopiée" });
    expect(corrected.changes.inputs.before[0].quantity).toBe(2);
    expect(corrected.changes.inputs.after[0].quantity).toBe(1.5);
  });

  it("une correction rejouée (même correctionId) n'est appliquée qu'une fois", async () => {
    const correctionId = crypto.randomUUID();
    const body = { ...spraying(1), correctionId };
    expect((await send("PUT", `/interventions/${doneId}`, body)).status).toBe(200);
    expect((await send("PUT", `/interventions/${doneId}`, body)).status).toBe(200);
    expect(await stockAt("2026-06-11T00:00:00Z")).toBe(19);
    const detail = await get(`/interventions/${doneId}`);
    expect(detail.history.filter((h: { action: string }) => h.action === "corrected")).toHaveLength(2);
  });

  it("une deuxième correction qui déplace la date : le stock n'est corrigé qu'une fois, à la bonne date", async () => {
    expect((await send("PUT", `/interventions/${doneId}`, spraying(3, "2026-06-20"))).status).toBe(200);
    expect(await stockAt("2026-06-11T00:00:00Z")).toBe(20);
    expect(await stockAt("2026-06-21T00:00:00Z")).toBe(17);
  });

  it("annuler après plusieurs corrections remet le stock d'origine (pas de double contre-passation)", async () => {
    expect((await send("POST", `/interventions/${doneId}/cancel`, { reason: "parcelle non traitée" })).status).toBe(200);
    expect(await stockAt("2026-06-21T00:00:00Z")).toBe(20);
    const res = await send("PUT", `/interventions/${doneId}`, spraying(1));
    expect(res.status).toBe(409);
  });

  it("corriger une intervention d'une campagne close : possible, avec une alerte", async () => {
    const id = crypto.randomUUID();
    await send("POST", "/interventions", { id, procedure: "spraying" });
    await send("POST", `/interventions/${id}/complete`, spraying(1, "2025-06-10"));
    const res = await send("PUT", `/interventions/${id}`, spraying(0.5, "2025-06-10"));
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.warnings).toEqual([expect.stringMatching(/Campagne 2025 close/)]);
  });

  it("une intervention réalisée corrigée sans période est refusée (422)", async () => {
    const id = crypto.randomUUID();
    await send("POST", "/interventions", { id, procedure: "spraying" });
    await send("POST", `/interventions/${id}/complete`, spraying(1, "2026-08-01"));
    expect((await send("PUT", `/interventions/${id}`, { ...spraying(1, "2026-08-01"), periods: [] })).status).toBe(422);
  });

  it("liste toute une campagne (?campaign=)", async () => {
    const r = await get("/interventions?campaign=2026");
    const ids = r.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([plannedId, doneId]));
    expect(r.items.every((i: { startedAt: string }) => i.startedAt.startsWith("2026"))).toBe(true);
    expect((await send("GET", "/interventions?campaign=abc")).status).toBe(400);
  });

  it("fiche et modification sont cloisonnées par ferme", async () => {
    const foreign = `/api/v1/farms/${otherFarm.farmId}/interventions/${doneId}`;
    expect((await app.request(foreign, { headers: otherFarm.headers })).status).toBe(404);
    expect((await app.request(foreign, { method: "PUT", headers: otherFarm.headers, body: JSON.stringify(spraying(1)) })).status).toBe(404);
    // Et pas d'accès à la ferme d'un autre par son adresse.
    expect((await send("GET", `/interventions/${doneId}`, undefined, otherFarm.headers)).status).toBe(403);
  });
});
