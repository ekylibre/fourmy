import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { encodeDeviceDescription, encodeTimeLog, EFDI_SECTION, type EfdiDevice } from "@fourmy/isoxml";
import type { AgrirouterInboxItem } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { agrirouterFilesConfig, storeAgrirouterFile } from "../src/integrations/agrirouter-events.js";
import { readAgrirouterInbox } from "../src/integrations/agrirouter-read.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * agrirouter, lot AR5 : descriptions de machine et journaux EFDI. Messages
 * synthétiques (écrits par @fourmy/isoxml), aucune donnée réelle.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const FIELD = "MULTIPOLYGON(((-0.2 43.38,-0.196 43.38,-0.196 43.383,-0.2 43.383,-0.2 43.38)))";
const DD = "iso:11783:-10:device_description:protobuf";
const TL = "iso:11783:-10:time_log:protobuf";

const devices: EfdiDevice[] = [
  { id: 1, designator: "Fendt 724", serial: "TR-724-1", elements: [{ id: 10, objectId: 1, type: 1, designator: "Tracteur", number: 0, parent: 0 }], properties: [] },
  {
    id: 2,
    designator: "ZA-TS",
    serial: null,
    elements: [
      { id: 20, objectId: 1, type: 1, designator: "Épandeur", number: 0, parent: 0 },
      ...[21, 22].map((id, i) => ({ id, objectId: 2 + i, type: EFDI_SECTION, designator: `Section ${i + 1}`, number: i + 1, parent: 1 })),
    ],
    properties: [{ objectId: 9, ddi: 68, value: 24000, designator: "Largeur" }],
  },
];

/** Cinq minutes au travail (seuils des parcours : 3 min, 200 m), une position par seconde, à travers la parcelle d'ouest en est. */
const work = (from: string, n = 300) =>
  Array.from({ length: n }, (_, i) => ({
    start: new Date(Date.parse(from) + i * 1000).toISOString(),
    type: 4,
    position: { lat: 43.3815, lon: -0.1995 + i * 0.00001, status: 4, gpsTime: null },
    values: [
      { ddi: 141, value: 1, element: 20 },
      { ddi: 397, value: 2500, element: 10 },
    ],
  }));

describe.skipIf(!url)("agrirouter : EFDI, descriptions de machine et journaux (AR5)", () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let filesDir = "";
  const savedDir = agrirouterFilesConfig.dir;
  const tractor = randomUUID();
  const spreader = randomUUID();
  const tracked = randomUUID();
  const base = () => `/api/v1/farms/${farmId}`;

  async function receive(type: string, bytes: Uint8Array, teamset: string | null, receivedAt = new Date().toISOString()) {
    const id = randomUUID();
    const sha = await storeAgrirouterFile(bytes);
    await sql`INSERT INTO agrirouter_inbox (id, farm_id, endpoint_id, message_ids, message_type, size, file_sha256, teamset_context_id, received_at)
              VALUES (${id}, ${farmId}, 'ep', ${`{${randomUUID()}}`}::text[], ${type}, ${bytes.byteLength}, ${sha}, ${teamset}, ${receivedAt})`;
    return id;
  }
  const item = async (id: string) =>
    ((await (await app.request(`${base()}/agrirouter/inbox`, { headers })).json()) as { items: AgrirouterInboxItem[] }).items.find((i) => i.id === id)!;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test EFDI"));
    filesDir = await mkdtemp(join(tmpdir(), "fourmy-efdi-"));
    agrirouterFilesConfig.dir = filesDir;
    const parcel = randomUUID();
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Grand Champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
              VALUES (${randomUUID()}, ${parcel}, ST_GeomFromText(${FIELD}, 4326), 120000, tstzrange('2020-01-01', NULL))`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind, serial_number) VALUES (${tractor}, ${farmId}, 'Fendt', 'tractor', 'tr-724-1')`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind, model) VALUES (${spreader}, ${farmId}, 'Épandeur', 'implement', 'ZA-TS')`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind, serial_number) VALUES (${tracked}, ${farmId}, 'Tracteur Traccar', 'tractor', 'TR-TRACCAR')`;
    await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, source, device_id, valid)
              VALUES (${randomUUID()}, ${farmId}, ${tracked}, 'traccar', '42', tstzrange('2020-01-01', NULL))`;
  });
  afterAll(async () => {
    agrirouterFilesConfig.dir = savedDir;
    await rm(filesDir, { recursive: true, force: true });
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  let ddId = "";
  it("description de machine : matériels reconnus (n° de série, modèle), largeur proposée, sections ; report sur la fiche", async () => {
    ddId = await receive(DD, encodeDeviceDescription(devices), "ts-1");
    expect((await readAgrirouterInbox(db(), 50, farmId)).proposed).toBe(1);
    const it = await item(ddId);
    expect(it.state).toBe("proposed");
    expect(it.devices).toEqual([
      { index: 0, designator: "Fendt 724", serial: "TR-724-1", equipment: { id: tractor, name: "Fendt" }, workingWidthM: null, currentWidthM: null, sections: 0, proposeWidth: false, applied: false },
      { index: 1, designator: "ZA-TS", serial: null, equipment: { id: spreader, name: "Épandeur" }, workingWidthM: 24, currentWidthM: null, sections: 2, proposeWidth: true, applied: false },
    ]);
    expect((await app.request(`${base()}/agrirouter/inbox/${ddId}/devices/0/apply`, { method: "POST", headers })).status).toBe(400);
    const res = await app.request(`${base()}/agrirouter/inbox/${ddId}/devices/1/apply`, { method: "POST", headers });
    expect(res.status).toBe(200);
    expect((await res.json()) as AgrirouterInboxItem).toMatchObject({ state: "validated", devices: [{}, { applied: true, currentWidthM: 24 }] });
    const [eq] = await sql<{ avatar: { workingWidthM: number } }[]>`SELECT avatar FROM equipments WHERE id = ${spreader}`;
    expect(eq!.avatar.workingWidthM).toBe(24);
    expect((await app.request(`${base()}/agrirouter/inbox/${ddId}/devices/1/apply`, { method: "POST", headers })).status).toBe(400);
  });

  it("journal du même attelage : versé dans les parcours du tracteur, outil attelé, travail et vitesse ; parcours calculé", async () => {
    const id = await receive(TL, encodeTimeLog(work("2026-04-16T07:30:00Z")), "ts-1");
    expect((await readAgrirouterInbox(db(), 50, farmId)).merged).toBe(1);
    const it = await item(id);
    expect(it).toMatchObject({
      state: "merged",
      telemetry: { equipment: { id: tractor, name: "Fendt" }, tool: "Épandeur", positions: 300, from: "2026-04-16T07:30:00.000Z", to: "2026-04-16T07:34:59.000Z" },
    });
    const [b] = await sql<{ source: string; n: number; working: boolean; tool: string; speed: number; width: number }[]>`
      SELECT b.source, count(*)::int AS n, bool_and((p.attrs->>'working')::boolean) AS working, min(p.attrs->>'tool') AS tool,
             min(p.speed)::float8 AS speed, min((p.attrs->>'widthM')::float8) AS width
      FROM tracker_bindings b JOIN positions p ON p.binding_id = b.id WHERE b.equipment_id = ${tractor} GROUP BY b.source`;
    expect(b).toEqual({ source: "agrirouter", n: 300, working: true, tool: "Épandeur", speed: 9, width: 24 });
    const sessions = await sql<{ kind: string; parcels: { name: string }[] }[]>`SELECT kind, parcels FROM track_sessions WHERE equipment_id = ${tractor}`;
    expect(sessions.some((s) => s.kind === "work" && (s.parcels ?? []).some((p) => p.name === "Grand Champ"))).toBe(true);

    // Même journal redélivré sous un autre message : pas de position en double.
    await receive(TL, encodeTimeLog(work("2026-04-16T07:30:00Z")), "ts-1");
    await readAgrirouterInbox(db(), 50, farmId);
    const [{ n }] = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM positions p JOIN tracker_bindings b ON b.id = p.binding_id WHERE b.equipment_id = ${tractor}`) as [{ n: number }];
    expect(n).toBe(300);
  });

  it("journal sans description de machine : attendu une heure, puis sans suite", async () => {
    const recent = await receive(TL, encodeTimeLog(work("2026-04-17T07:30:00Z", 5)), "ts-inconnu");
    await readAgrirouterInbox(db(), 50, farmId);
    expect((await item(recent)).state).toBe("received");
    await sql`UPDATE agrirouter_inbox SET received_at = now() - interval '2 hours' WHERE id = ${recent}`;
    await readAgrirouterInbox(db(), 50, farmId);
    expect(await item(recent)).toMatchObject({ state: "ignored", error: "Machine inconnue : aucune description de machine reçue pour ce journal." });
  });

  it("matériel déjà suivi par Traccar : journal non versé ; matériel inconnu ; message abîmé", async () => {
    await receive(DD, encodeDeviceDescription([{ ...devices[0]!, serial: "TR-TRACCAR" }]), "ts-2");
    await receive(DD, encodeDeviceDescription([{ ...devices[0]!, designator: "Inconnu", serial: "X" }]), "ts-3");
    await readAgrirouterInbox(db(), 50, farmId);
    const traccar = await receive(TL, encodeTimeLog(work("2026-04-18T07:30:00Z", 5)), "ts-2");
    const unknown = await receive(TL, encodeTimeLog(work("2026-04-18T08:30:00Z", 5)), "ts-3");
    const broken = await receive(TL, new Uint8Array([0x22, 0x10, 1]), "ts-1");
    await readAgrirouterInbox(db(), 50, farmId);
    expect((await item(traccar)).error).toBe("Tracteur Traccar est déjà suivi par Traccar : journal non versé, pour ne pas doubler ses parcours.");
    expect(await item(unknown)).toMatchObject({ state: "ignored", error: "Matériel non reconnu : « Inconnu »." });
    expect(await item(broken)).toMatchObject({ state: "unreadable", error: "Message EFDI tronqué." });
  });
});
