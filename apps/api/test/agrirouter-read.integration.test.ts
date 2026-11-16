import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { withFarm } from "@fourmy/db";
import { zip } from "@fourmy/isoxml";
import { interventionCompleteWrite, type AgrirouterInboxItem } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { agrirouterFilesConfig, storeAgrirouterFile } from "../src/integrations/agrirouter-events.js";
import { consoleTime, linkInboxIntervention, readAgrirouterInbox } from "../src/integrations/agrirouter-read.js";
import { taskDesignator } from "../src/repos/prescriptions.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * agrirouter, lot AR4 : lecture des TaskData reçus et propositions
 * d'intervention. Fichier réel d'une console Topcon (packages/isoxml,
 * fixtures/NOTICE.md) et tâche synthétique d'une carte de Fourmy revenue
 * réalisée. Aucune donnée de ferme pilote.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const TOPCON = new Uint8Array(readFileSync(new URL("../../../packages/isoxml/test/fixtures/topcon-2021-04-09-taskdata.zip", import.meta.url)));
// Parcelle sous les positions du fichier Topcon (Lombardie), et une autre au Béarn pour la carte.
const TOPCON_FIELD = "MULTIPOLYGON(((9.576 45.527,9.580 45.527,9.580 45.529,9.576 45.529,9.576 45.527)))";
const BEARN_FIELD = "MULTIPOLYGON(((-0.2 43.38,-0.196 43.38,-0.196 43.383,-0.2 43.383,-0.2 43.38)))";

/** TaskData d'une carte de Fourmy revenue réalisée : contour, période, dose réelle et surface totales. */
const returned = (designator: string, status: number) =>
  zip({
    "TASKDATA/TASKDATA.XML": `<?xml version="1.0" encoding="UTF-8"?>
<ISO11783_TaskData VersionMajor="4" VersionMinor="2" ManagementSoftwareManufacturer="Console" ManagementSoftwareVersion="1" DataTransferOrigin="2">
  <PFD A="PFD1" C="Grand Champ" D="120000">
    <PLN A="1"><LSG A="1">
      <PNT A="2" C="43.380" D="-0.200"/><PNT A="2" C="43.380" D="-0.196"/><PNT A="2" C="43.383" D="-0.196"/><PNT A="2" C="43.383" D="-0.200"/>
    </LSG></PLN>
  </PFD>
  <PDT A="PDT1" B="Ammonitrate 33,5"/>
  <DVC A="DVC1" B="Epandeur" E="SN-0042"><DET A="DET1" B="1" C="1"/></DVC>
  <TSK A="TSK1" B="${designator}" E="PFD1" G="${status}">
    <TIM A="2026-03-20T09:00:00" B="2026-03-20T10:30:00" D="4">
      <DLV A="0007" B="15000" C="DET1"/>
      <DLV A="0074" B="118000" C="DET1"/>
    </TIM>
    <PAN A="PDT1"/>
  </TSK>
</ISO11783_TaskData>`,
  });

describe.skipIf(!url)("agrirouter : lecture des TaskData reçus (AR4)", () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let filesDir = "";
  const savedDir = agrirouterFilesConfig.dir;
  const topconParcel = randomUUID();
  const bearnParcel = randomUUID();
  const tractor = randomUUID();
  const spreader = randomUUID();
  const prescription = randomUUID();
  const base = () => `/api/v1/farms/${farmId}`;

  async function receive(bytes: Uint8Array, filename: string) {
    const id = randomUUID();
    const sha = await storeAgrirouterFile(bytes);
    await sql`INSERT INTO agrirouter_inbox (id, farm_id, endpoint_id, message_ids, message_type, filename, size, file_sha256)
              VALUES (${id}, ${farmId}, 'ep', ${`{${randomUUID()}}`}::text[], 'iso:11783:-10:taskdata:zip', ${filename}, ${bytes.byteLength}, ${sha})`;
    return id;
  }
  const inbox = async () => ((await (await app.request(`${base()}/agrirouter/inbox`, { headers })).json()) as { items: AgrirouterInboxItem[] }).items;
  const item = async (id: string) => (await inbox()).find((i) => i.id === id)!;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test lecture agrirouter"));
    filesDir = await mkdtemp(join(tmpdir(), "fourmy-read-"));
    agrirouterFilesConfig.dir = filesDir;
    for (const [id, name, shape] of [[topconParcel, "Champ du Pô", TOPCON_FIELD], [bearnParcel, "Grand Champ", BEARN_FIELD]] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
                VALUES (${randomUUID()}, ${id}, ST_GeomFromText(${shape}, 4326), 120000, tstzrange('2020-01-01', NULL))`;
    }
    await sql`INSERT INTO equipments (id, farm_id, name, kind, model) VALUES (${tractor}, ${farmId}, 'Gros tracteur', 'tractor', '8250-8280 TTV')`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind, serial_number) VALUES (${spreader}, ${farmId}, 'Épandeur', 'implement', 'sn-0042')`;
    await sql`INSERT INTO prescriptions (id, farm_id, land_parcel_id, name, acquired_on, vegetation_index, zone_count, product, unit, strategy,
                base_rate, modulation_pct, min_rate, max_rate, width_m)
              VALUES (${prescription}, ${farmId}, ${bearnParcel}, 'Azote 3e apport', '2026-03-01', 'ndvi', 3, 'Ammonitrate', 'kg_ha', 'compensate',
                120, 20, 90, 150, 24)`;
  });
  afterAll(async () => {
    agrirouterFilesConfig.dir = savedDir;
    await rm(filesDir, { recursive: true, force: true });
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("heures de console sans fuseau : heure de Paris, été comme hiver ; avec fuseau : telle quelle", () => {
    expect(consoleTime("2021-04-09T14:54:04.975")).toBe("2021-04-09T12:54:04.975Z");
    expect(consoleTime("2026-01-15T08:00:00")).toBe("2026-01-15T07:00:00.000Z");
    expect(consoleTime("2026-03-29T03:30:00")).toBe("2026-03-29T01:30:00.000Z"); // juste après le passage à l'heure d'été
    expect(consoleTime("2026-06-01T10:00:00+00:00")).toBe("2026-06-01T10:00:00.000Z");
    expect(consoleTime("pas une date")).toBeNull();
  });

  it("fichier réel Topcon : parcelle par les positions, tracteur par son modèle, période en UTC", async () => {
    const id = await receive(TOPCON, "topcon.zip");
    expect(await readAgrirouterInbox(db(), 20, farmId)).toEqual({ proposed: 1, ignored: 0, unreadable: 0 });
    const it = await item(id);
    expect(it.state).toBe("proposed");
    expect(it.tasks).toHaveLength(1);
    const t = it.tasks[0]!;
    expect(t).toMatchObject({
      index: 0,
      designator: "Task 9 Apr, 2021 1450",
      startedAt: "2021-04-09T12:54:04.975Z",
      stoppedAt: "2021-04-09T12:54:44.107Z",
      parcels: [{ id: topconParcel, name: "Champ du Pô", share: 1 }],
      equipment: { id: tractor, name: "Gros tracteur" },
      prescription: null,
      interventionId: null,
    });
    expect(t.draft.body).toMatchObject({
      staffing: "crews",
      crews: [{ tools: [{ equipmentId: tractor }], doers: [], periods: [{ startedAt: "2021-04-09T12:54:04.975Z", stoppedAt: "2021-04-09T12:54:44.107Z" }] }],
      targets: [{ kind: "land_parcel", id: topconParcel }],
      trackSessionIds: [],
      agrirouterInbox: { id, task: 0 },
    });
    expect(t.draft.parcelNames).toEqual({ [topconParcel]: "Champ du Pô" });
    expect(t.draft.hints[0]).toContain("reçue de la console");
  });

  it("carte de Fourmy revenue réalisée : carte retrouvée, parcelle par le contour, épandeur par son n° de série, dose et surface relevées", async () => {
    const id = await receive(returned(taskDesignator("Azote 3e apport", prescription), 4), "retour.zip");
    await readAgrirouterInbox(db(), 20, farmId);
    const t = (await item(id)).tasks[0]!;
    expect(t).toMatchObject({
      designator: `Azote 3e apport F${prescription.slice(0, 8)}`,
      startedAt: "2026-03-20T08:00:00.000Z",
      stoppedAt: "2026-03-20T09:30:00.000Z",
      equipment: { id: spreader, name: "Épandeur" },
      products: ["Ammonitrate 33,5", "Ammonitrate"],
      rates: [{ value: 150, unit: "kg/ha" }],
      areaM2: 118000,
      prescription: { id: prescription, name: "Azote 3e apport" },
    });
    expect(t.parcels.map((p) => [p.id, p.share])).toEqual([[bearnParcel, 1]]);
    expect(t.draft.body.targets[0]!.workedAreaM2).toBe(118_000);
    expect(t.draft.hints.join(" ")).toContain("dose moyenne relevée 150 kg/ha");
  });

  it("tâche seulement prévue : sans suite ; fichier abîmé : illisible avec le motif", async () => {
    const planned = await receive(returned("Prévue", 1), "prevue.zip");
    const broken = await receive(new Uint8Array([80, 75, 1, 2, 3]), "abime.zip");
    expect(await readAgrirouterInbox(db(), 20, farmId)).toEqual({ proposed: 0, ignored: 1, unreadable: 1 });
    expect(await item(planned)).toMatchObject({ state: "ignored", error: "Aucune tâche réalisée dans ce fichier.", tasks: [] });
    expect((await item(broken)).state).toBe("unreadable");
    expect((await item(broken)).error).toContain("Archive zip illisible");
    // Déjà lus : rien de plus au tour suivant.
    expect(await readAgrirouterInbox(db(), 20, farmId)).toEqual({ proposed: 0, ignored: 0, unreadable: 0 });
  });

  it("intervention enregistrée depuis la proposition (API) : le fichier passe validé, la tâche garde l'intervention", async () => {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM agrirouter_inbox WHERE farm_id = ${farmId} AND filename = 'topcon.zip'`;
    const draft = (await item(row!.id)).tasks[0]!.draft;
    const send = (path: string, body: unknown) => app.request(`${base()}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const iid = randomUUID();
    expect((await send("/interventions", { id: iid, procedure: "plowing" })).status).toBe(201);
    const done = await send(`/interventions/${iid}/complete`, draft.body);
    expect(done.status).toBe(200);
    const it = await item(row!.id);
    expect(it.state).toBe("validated");
    expect(it.tasks[0]!.interventionId).toBe(iid);
    // Validé : ne s'écarte plus ; le lien se fait aussi sans passer par l'API.
    expect((await app.request(`${base()}/agrirouter/inbox/${row!.id}/dismiss`, { method: "POST", headers })).status).toBe(400);
    expect(interventionCompleteWrite.safeParse({ ...draft.body, agrirouterInbox: { id: "pas-un-uuid", task: 0 } }).success).toBe(false);
    await withFarm(db(), farmId, (tx) => linkInboxIntervention(tx, undefined, iid));
  });

  it("écarter un fichier proposé", async () => {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM agrirouter_inbox WHERE farm_id = ${farmId} AND filename = 'retour.zip'`;
    const res = await app.request(`${base()}/agrirouter/inbox/${row!.id}/dismiss`, { method: "POST", headers });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AgrirouterInboxItem).state).toBe("dismissed");
  });
});
