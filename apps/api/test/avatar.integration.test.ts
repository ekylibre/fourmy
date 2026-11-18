import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { buildAvatarGlb, resolveAvatar } from "@fourmy/equipment-3d";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/** Lot M : avatar 3D (paramètres, GLB généré et mis en cache, import), dernières positions, attelages. */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("avatar 3D (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let tractor = "";
  let plough = "";
  const base = () => `/api/v1/farms/${farmId}`;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test avatar"));
    const create = async (b: object) => (await (await app.request(`${base()}/equipments`, { method: "POST", headers, body: JSON.stringify(b) })).json()).id as string;
    tractor = await create({ name: "Tracteur", kind: "tractor", brand: "Testmark" });
    plough = await create({ name: "Charrue", kind: "trailed_equipment" });
    await sql`UPDATE equipments SET technical = ${sql.json({ dimensions: { longueur: { valeur: 4895, unite: "mm" }, empattement: { valeur: 2564, unite: "mm" } } })} WHERE id = ${tractor}`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("paramètres résolus, GLB généré avec ETag, réglage par le responsable", async () => {
    const info = await (await app.request(`${base()}/equipments/${tractor}/avatar`, { headers })).json();
    expect(info).toMatchObject({ imported: false, params: { template: "tractor", lengthM: 4.89, wheelbaseM: 2.56 }, provenance: { lengthM: "technical", widthM: "default" } });
    const glb = await app.request(`${base()}/equipments/${tractor}/avatar.glb`, { headers });
    expect(glb.headers.get("content-type")).toBe("model/gltf-binary");
    expect(new TextDecoder().decode(new Uint8Array(await glb.arrayBuffer()).subarray(0, 4))).toBe("glTF");
    const etag = glb.headers.get("etag")!;
    expect((await app.request(`${base()}/equipments/${tractor}/avatar.glb`, { headers: { ...headers, "if-none-match": etag } })).status).toBe(304);
    const saved = await (await app.request(`${base()}/equipments/${tractor}/avatar`, { method: "PUT", headers, body: JSON.stringify({ widthM: 2.5, colors: { body: "#3F9A2B" } }) })).json();
    expect(saved).toMatchObject({ params: { widthM: 2.5, colors: { body: "#3F9A2B" } }, provenance: { widthM: "input" } });
    expect(saved.hash).not.toBe(info.hash);
  });

  it("modèle importé : vérifié, il remplace l'avatar généré, puis se retire", async () => {
    const send = (bytes: Uint8Array) => {
      const form = new FormData();
      form.set("file", new File([bytes], "modele.glb"));
      return app.request(`${base()}/equipments/${plough}/model`, { method: "PUT", headers: { authorization: headers.authorization! }, body: form });
    };
    expect((await send(new TextEncoder().encode("pas un glb"))).status).toBe(400);
    const own = await buildAvatarGlb(resolveAvatar({ kind: "box" }).params);
    const r = await (await send(own.glb)).json();
    expect(r.imported).toBe(true);
    const glb = new Uint8Array(await (await app.request(`${base()}/equipments/${plough}/avatar.glb`, { headers })).arrayBuffer());
    expect(glb.length).toBe(own.glb.length);
    expect((await (await app.request(`${base()}/equipments/${plough}/model`, { method: "DELETE", headers })).json()).imported).toBe(false);
  });

  it("dernière position de chaque matériel suivi ; outil attelé d'après l'intervention", async () => {
    const binding = crypto.randomUUID();
    await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid) VALUES (${binding}, ${farmId}, ${tractor}, '7', tstzrange('2026-01-01', NULL))`;
    for (const [t, lon] of [["2026-11-03T08:00:00Z", 0.5], ["2026-11-03T09:00:00Z", 0.501]] as const) {
      await sql`INSERT INTO positions (farm_id, binding_id, time, point, speed, heading, attrs) VALUES (${farmId}, ${binding}, ${t}, ST_SetSRID(ST_MakePoint(${lon}, 44.8), 4326), 6, 90, '{}'::jsonb)`;
    }
    const latest = await (await app.request(`${base()}/tracks/latest?at=2026-11-03T12:00:00.000Z`, { headers })).json();
    expect(latest.items).toEqual([expect.objectContaining({ equipmentId: tractor, lon: 0.501, heading: 90, time: "2026-11-03T09:00:00.000Z" })]);
    expect((await (await app.request(`${base()}/tracks/latest?at=2026-12-20T00:00:00.000Z`, { headers })).json()).items).toEqual([]); // plus de 30 jours
    // Labour du 03/11 avec le tracteur et la charrue.
    const periods = [{ startedAt: "2026-11-03T07:30:00.000Z", stoppedAt: "2026-11-03T10:00:00.000Z" }];
    const parcel = crypto.randomUUID();
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
              VALUES (${crypto.randomUUID()}, ${parcel}, ST_Multi(ST_MakeEnvelope(0.5, 44.8, 0.501, 44.801, 4326)), 8800, tstzrange('2020-01-01', NULL))`;
    const plan = await (await app.request(`${base()}/interventions`, { method: "POST", headers, body: JSON.stringify({ procedure: "plowing", periods, targets: [{ kind: "land_parcel", id: parcel }] }) })).json();
    const done = await app.request(`${base()}/interventions/${plan.id}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ periods, targets: [{ kind: "land_parcel", id: parcel }], tools: [{ equipmentId: tractor }, { equipmentId: plough }] }),
    });
    expect(done.status).toBe(200);
    const h = await (await app.request(`${base()}/tracks/hitches?equipment=${tractor}&from=2026-11-03T00:00:00.000Z&to=2026-11-04T00:00:00.000Z`, { headers })).json();
    // « Charrue » : gabarit de charrue portée proposé d'après le nom, accrochée au relevage (pas de timon).
    expect(h.items).toEqual([expect.objectContaining({ toolId: plough, toolName: "Charrue", from: periods[0]!.startedAt, hitchOffsetM: 0 })]);
    // Rejeu 3D : gabarit (articulation), largeur de travail et forme du procédé (couleur de la bande).
    expect(h.items[0]).toMatchObject({ template: "plough", workingWidthM: expect.any(Number), shape: "work" });
  });

  it("type de matériel : il fixe la nature et l'avatar de base ; une fiche sans type le garde", async () => {
    const res = await app.request(`${base()}/equipments`, { method: "POST", headers, body: JSON.stringify({ name: "Matériel 7", kind: "equipment", type: "sower" }) });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { id: string }).id;
    const sheet = async () => (await (await app.request(`${base()}/equipments/${id}/sheet`, { headers })).json()) as { kind: string; type: string | null };
    expect(await sheet()).toMatchObject({ kind: "trailed_equipment", type: "sower" });
    const avatar = async () => (await (await app.request(`${base()}/equipments/${id}/avatar`, { headers })).json()) as { params: { template: string }; provenance: { template: string } };
    expect(await avatar()).toMatchObject({ params: { template: "sower" }, provenance: { template: "technical" } });
    // Modification sans le champ type (ancien client) : le type reste.
    const put = await app.request(`${base()}/equipments/${id}`, { method: "PUT", headers, body: JSON.stringify({ name: "Semoir 7", kind: "trailed_equipment" }) });
    expect(put.status).toBe(204);
    expect((await sheet()).type).toBe("sower");
    // Changement de type : l'avatar suit.
    await app.request(`${base()}/equipments/${id}`, { method: "PUT", headers, body: JSON.stringify({ name: "Semoir 7", kind: "trailed_equipment", type: "mounted_sprayer" }) });
    expect((await avatar()).params.template).toBe("mounted_sprayer");
    // Un type inconnu est refusé.
    const bad = await app.request(`${base()}/equipments/${id}`, { method: "PUT", headers, body: JSON.stringify({ name: "Semoir 7", kind: "trailed_equipment", type: "fusée" }) });
    expect(bad.status).toBe(400);
  });

  it("outil annoncé par Traccar : relié à la main, il s'attelle hors des interventions saisies", async () => {
    const [b] = await sql<{ id: string }[]>`SELECT id FROM tracker_bindings WHERE equipment_id = ${tractor}`;
    const session = (id: string, from: string, to: string) =>
      sql`INSERT INTO track_sessions (id, farm_id, equipment_id, binding_id, kind, started_at, stopped_at, position_count, distance_m, tool_hint, settings_hash)
          VALUES (${id}, ${farmId}, ${tractor}, ${b!.id}, 'work', ${from}, ${to}, 10, 500, 'Herse X', 'h')`;
    const free = crypto.randomUUID();
    await session(free, "2026-11-03T11:00:00Z", "2026-11-03T12:00:00Z");
    // Pendant le labour saisi (07:30-10:00) : l'intervention prime sur le boîtier.
    await session(crypto.randomUUID(), "2026-11-03T08:00:00Z", "2026-11-03T09:00:00Z");
    const hitchesOf = async () =>
      (await (await app.request(`${base()}/tracks/hitches?equipment=${tractor}&from=2026-11-03T00:00:00.000Z&to=2026-11-04T00:00:00.000Z`, { headers })).json()).items as { toolName: string; from: string }[];
    expect((await hitchesOf()).map((x) => x.toolName)).toEqual(["Charrue"]); // nom non relié : rien de plus

    const res = await app.request(`${base()}/equipments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Herse rotative", kind: "trailed_equipment", externalIds: { traccarTool: " herse x " } }),
    });
    const harrow = ((await res.json()) as { id: string }).id;
    const [s] = await sql<{ tool_equipment_id: string | null }[]>`SELECT tool_equipment_id FROM track_sessions WHERE id = ${free}`;
    expect(s!.tool_equipment_id).toBe(harrow); // parcours libre relié tout de suite
    expect((await hitchesOf()).map((x) => [x.toolName, x.from])).toEqual([
      ["Charrue", "2026-11-03T07:30:00.000Z"],
      ["Herse rotative", "2026-11-03T11:00:00.000Z"],
    ]);
  });
});
