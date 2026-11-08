import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Matériels, lot I (docs/materiels-entretien-design.md) : fiche, compteur,
 * relevés cohérents (correction motivée), droits ouvrier / responsable,
 * marque et logo, synchro mobile des relevés.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

describe.skipIf(!url)("matériels (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  let tractor = "";
  const base = () => `/api/v1/farms/${farmId}`;

  beforeAll(async () => {
    const s = await setupFarm(sql, "Ferme test matériels");
    farmId = s.farmId;
    owner = s.headers;
    users.push(s.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql.end();
  });

  it("le responsable crée la fiche ; un tracteur a un compteur d'heures, la marque est créée", async () => {
    const body = { name: "ARION 430", kind: "tractor", brand: "Claas", model: "ARION 430", serialNumber: "A0000001", aggregates: [{ organ: "moteur", designation: "4045HRT83D" }] };
    expect((await app.request(`${base()}/equipments`, { method: "POST", headers: worker, body: JSON.stringify(body) })).status).toBe(403);
    const r = await app.request(`${base()}/equipments`, { method: "POST", headers: owner, body: JSON.stringify(body) });
    expect(r.status).toBe(201);
    tractor = (await r.json()).id;
    const tool = await app.request(`${base()}/equipments`, { method: "POST", headers: owner, body: JSON.stringify({ name: "Charrue", kind: "trailed_equipment", brand: "CLAAS" }) });
    const list = (await (await app.request(`${base()}/equipments`, { headers: worker })).json()).items;
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: tractor, meterUnit: "hours", brand: "Claas" }),
        expect.objectContaining({ id: (await tool.json()).id, meterUnit: null }),
      ]),
    );
    const brands = (await (await app.request(`${base()}/brands`, { headers: worker })).json()).items;
    expect(brands).toEqual([expect.objectContaining({ name: "Claas", equipments: 2 })]); // « CLAAS » = « Claas »
  });

  it("un ouvrier saisit des relevés ; une valeur plus basse est refusée, sauf correction motivée", async () => {
    const post = (headers: Record<string, string>, b: object) =>
      app.request(`${base()}/equipments/${tractor}/readings`, { method: "POST", headers, body: JSON.stringify(b) });
    const id = crypto.randomUUID();
    const first = await post(worker, { id, readAt: "2026-10-01T08:00:00.000Z", value: 4300 });
    expect(first.status).toBe(201);
    expect((await post(worker, { id, readAt: "2026-10-01T08:00:00.000Z", value: 4300 })).status).toBe(201); // idempotent
    const low = await post(worker, { readAt: "2026-11-01T08:00:00.000Z", value: 4290 });
    expect(low.status).toBe(409);
    expect((await low.json()).detail).toMatch(/4\s300 h/);
    expect((await post(worker, { readAt: "2026-11-01T08:00:00.000Z", value: 12, correction: "replacement" })).status).toBe(400);
    const fixed = await post(worker, { readAt: "2026-11-01T08:00:00.000Z", value: 12, correction: "replacement", correctionReason: "compteur remplacé" });
    expect(fixed.status).toBe(201);
    const later = await (await post(worker, { readAt: "2026-11-05T08:00:00.000Z", value: 40 })).json();
    expect(later.reading).toMatchObject({ value: 40, usage: 4328, status: "valid", origin: "manual" });
    // Saut plus rapide que l'horloge : accepté, signalé.
    expect((await (await post(worker, { readAt: "2026-11-05T10:00:00.000Z", value: 400 })).json()).warning).toContain("vérifiez");
    const [audit] = await sql`SELECT action FROM audit_log WHERE farm_id = ${farmId} AND entity = 'meter_reading'`;
    expect(audit!.action).toBe("correction_replacement");
    // Un outil sans compteur n'a pas de relevé ; l'ouvrier ne supprime pas.
    const sheet = await (await app.request(`${base()}/equipments/${tractor}/sheet`, { headers: worker })).json();
    expect(sheet.readings).toHaveLength(4);
    expect(sheet.lastReading).toMatchObject({ value: 400 });
    expect((await app.request(`${base()}/meter-readings/${id}`, { method: "DELETE", headers: worker })).status).toBe(403);
    expect((await app.request(`${base()}/meter-readings/${id}`, { method: "DELETE", headers: owner })).status).toBe(204);
  });

  it("options datées, sans chevauchement", async () => {
    const add = () =>
      app.request(`${base()}/equipments/${tractor}/options`, {
        method: "POST",
        headers: owner,
        body: JSON.stringify({ code: "front_linkage", label: "Relevage avant", from: "2024-01-01T00:00:00.000Z" }),
      });
    expect((await add()).status).toBe(201);
    expect((await add()).status).toBe(409);
  });

  it("logo : type vérifié par les octets, repli sur le logo de la marque, fichier servi en sandbox", async () => {
    const send = (path: string, bytes: Uint8Array, name: string) => {
      const form = new FormData();
      form.set("file", new File([bytes], name));
      return app.request(`${base()}${path}`, { method: "PUT", headers: { authorization: owner.authorization! }, body: form });
    };
    expect((await send(`/equipments/${tractor}/logo`, new TextEncoder().encode("<html><script>alert(1)</script>"), "x.png")).status).toBe(400);
    const brand = (await (await app.request(`${base()}/brands`, { headers: owner })).json()).items[0];
    const r = await send(`/brands/${brand.id}/logo`, PNG, "claas.png");
    expect(r.status).toBe(200);
    const { logoAssetId } = await r.json();
    const list = (await (await app.request(`${base()}/equipments`, { headers: worker })).json()).items;
    expect(list.find((e: { id: string }) => e.id === tractor)).toMatchObject({ logoAssetId, logoSource: "brand" });
    const file = await app.request(`${base()}/assets/${logoAssetId}`, { headers: worker });
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>');
    const own = await (await send(`/equipments/${tractor}/logo`, svg, "logo.svg")).json();
    const sheet = await (await app.request(`${base()}/equipments/${tractor}/sheet`, { headers: worker })).json();
    expect(sheet).toMatchObject({ logoAssetId: own.logoAssetId, logoSource: "equipment" });
  });

  it("synchro mobile : relevés tirés, relevé poussé idempotent, incohérence rapportée", async () => {
    const pull = await (await app.request(`${base()}/sync/pull`, { headers: worker })).json();
    expect(pull.changes.meter_readings.created.length).toBeGreaterThan(0);
    expect(pull.changes.equipments.created.find((e: { id: string }) => e.id === tractor)).toMatchObject({ meter_unit: "hours", brand: "Claas" });
    const id = crypto.randomUUID();
    const push = (value: number, rid = id) =>
      app.request(`${base()}/sync/push`, {
        method: "POST",
        headers: worker,
        body: JSON.stringify({
          lastPulledAt: pull.timestamp,
          changes: { interventions: { created: [], updated: [], deleted: [] }, meter_readings: { created: [{ id: rid, equipment_id: tractor, read_at: Date.parse("2026-11-07T18:00:00Z"), value }], updated: [], deleted: [] } },
        }),
      });
    const once = await (await push(410)).json();
    expect(once.failed).toEqual([]);
    expect(once.applied).toEqual([{ id, outcome: "created" }]);
    expect((await (await push(410)).json()).applied).toEqual([{ id, outcome: "created" }]);
    const bad = await (await push(5, crypto.randomUUID())).json();
    expect(bad.failed[0].error).toContain("inférieure");
  });
});
