import { inflateRawSync } from "node:zlib";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Integration, IntegrationProviderDefinition, ModulationDate, Prescription, PrescriptionSend, PrescriptionSummary, Zoning } from "@fourmy/contracts";
import { INDEX_RASTER_METHOD } from "@fourmy/sentinel";
import { createApp } from "../src/app.js";
import { setAgrirouterClientOptions } from "../src/integrations/agrirouter.js";
import { pendingSyncs } from "../src/routes/integrations.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Cartes de modulation et agrirouter (lot AD). Aucun appel réseau : le raster
 * Sentinel-2 est déposé dans le cache (parcel_index_rasters) et agrirouter est
 * simulé par un faux fetch qui suit l'API G4 (consentement, tenants, points de
 * terminaison, routes, envoi).
 */
const url = process.env.DATABASE_URL;
const app = createApp();

// Béarn (UTM 30N), parcelle de 300 × 300 m environ.
const SHAPE = "MULTIPOLYGON(((-0.2 43.38,-0.19629 43.38,-0.19629 43.3827,-0.2 43.3827,-0.2 43.38)))";
const TENANT = "33333333-3333-4333-8333-333333333333";
const OWN_ENDPOINT = "44444444-4444-4444-8444-444444444444";
const TRACTOR = "55555555-5555-4555-8555-555555555555";
const SPRAYER = "66666666-6666-4666-8666-666666666666";

/** Faux agrirouter : enregistre les appels, suit l'état passé au consentement. */
function fakeAgrirouter() {
  const calls: { method: string; path: string; headers: Headers; body: unknown }[] = [];
  const state = { consentState: "", sendStatus: 200 };
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const u = new URL(String(input));
    const headers = new Headers(init.headers);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method: init.method ?? "GET", path: u.pathname, headers, body });
    if (u.pathname === "/token") return Response.json({ access_token: "jeton-app", expires_in: 3600 });
    if (u.pathname === "/tenants") return Response.json({ tenants: [{ tenant_id: TENANT, company_name: "EARL Essai", state: state.consentState, endpoints: [] }] });
    if (u.pathname.startsWith("/endpoints/") && init.method === "PUT") {
      return Response.json({ id: OWN_ENDPOINT, external_id: decodeURIComponent(u.pathname.slice(11)), endpoint_type: "cloud_software", tenant_id: TENANT, capabilities: [] }, { status: 201 });
    }
    if (u.pathname === `/tenants/${TENANT}/endpoints`) {
      return Response.json({
        company_name: "EARL Essai",
        endpoints: [
          {
            id: OWN_ENDPOINT, name: "Fourmy", endpoint_type: "cloud_software", application_id: "a", tenant_id: TENANT, owned_by_your_application: true,
            capabilities: { can_send: [], can_receive: [] },
            routed_endpoints: { can_send_to: { [TRACTOR]: ["iso:11783:-10:taskdata:zip", "shp:shape:zip"], [SPRAYER]: ["shp:shape:zip"] } },
          },
          { id: TRACTOR, name: "Fendt 724 terminal", endpoint_type: "virtual_communication_unit", application_id: "b", tenant_id: TENANT, owned_by_your_application: false, capabilities: { can_send: [], can_receive: [] } },
          { id: SPRAYER, name: "Pulvé Amazone", endpoint_type: "virtual_communication_unit", application_id: "b", tenant_id: TENANT, owned_by_your_application: false, capabilities: { can_send: [], can_receive: [] } },
          { id: "77777777-7777-4777-8777-777777777777", name: "Sans route", endpoint_type: "cloud_software", application_id: "c", tenant_id: TENANT, owned_by_your_application: false, capabilities: { can_send: [], can_receive: [] } },
        ],
      });
    }
    if (u.pathname === "/messages") return new Response(null, { status: state.sendStatus });
    if (u.pathname.startsWith("/endpoints/") && init.method === "DELETE") return new Response(null, { status: 204 });
    if (u.pathname === "/authorizations") return new Response(null, { status: 204 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls, state };
}

/** Fichiers d'une archive zip produite par Fourmy. */
function unzip(bytes: ArrayBuffer): Record<string, Buffer> {
  const buf = Buffer.from(bytes);
  const out: Record<string, Buffer> = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const n = buf.readUInt16LE(at + 26);
    out[buf.subarray(at + 30, at + 30 + n).toString("utf8")] = inflateRawSync(buf.subarray(at + 30 + n, at + 30 + n + size));
    at += 30 + n + size;
  }
  return out;
}

describe.skipIf(!url)("cartes de modulation et agrirouter (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const parcel = crypto.randomUUID();
  const version = crypto.randomUUID();
  const fake = fakeAgrirouter();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let worker = { userId: "", headers: {} as Record<string, string> };
  let prescription: Prescription;
  const base = () => `/api/v1/farms/${farmId}`;
  const env = { ...process.env };

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test modulation"));
    worker = await addMember(sql, farmId, "worker");
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Grand Champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid) VALUES
      (${version}, ${parcel}, ST_GeomFromText(${SHAPE}, 4326), 90000, tstzrange('2026-01-01', NULL))`;
    // Indices de la parcelle : une date dégagée, une nuageuse.
    for (const [d, valid] of [["2026-06-10", 780], ["2026-06-15", 200]] as const) {
      await sql`INSERT INTO parcel_indices (farm_id, land_parcel_version_id, acquired_on, vegetation_index, mean, valid_px, parcel_px, method)
                VALUES (${farmId}, ${version}, ${d}, 'ndvi', 0.55, ${valid}, 784, 'test')`;
    }
    // Raster synthétique du 10/06 : NDVI croissant d'ouest en est (0,2 à 0,8), une tache de nuage.
    const [b] = await sql<{ xmin: number; ymin: number; xmax: number; ymax: number }[]>`
      SELECT floor(ST_XMin(g) / 10) * 10 AS xmin, floor(ST_YMin(g) / 10) * 10 AS ymin, ceil(ST_XMax(g) / 10) * 10 AS xmax, ceil(ST_YMax(g) / 10) * 10 AS ymax
      FROM (SELECT ST_Transform(ST_GeomFromText(${SHAPE}, 4326), 32630) AS g) x`;
    const width = (b!.xmax - b!.xmin) / 10;
    const height = (b!.ymax - b!.ymin) / 10;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cloud = x > 3 && x < 7 && y > 3 && y < 7;
        pixels[y * width + x] = cloud ? 0 : 1 + Math.round((0.2 + (0.6 * x) / (width - 1) + 1) * 127);
      }
    }
    await sql`INSERT INTO parcel_index_rasters (farm_id, land_parcel_version_id, acquired_on, vegetation_index, method, epsg, x_min, y_max, resolution, width, height, pixels)
              VALUES (${farmId}, ${version}, '2026-06-10', 'ndvi', ${INDEX_RASTER_METHOD}, 32630, ${b!.xmin}, ${b!.ymax}, 10, ${width}, ${height}, ${Buffer.from(pixels)})`;

    Object.assign(process.env, {
      AGRIROUTER_CLIENT_ID: "client-test",
      AGRIROUTER_CLIENT_SECRET: "SECRET-APP-AGRIROUTER",
      AGRIROUTER_APPLICATION_ID: "11111111-1111-4111-8111-111111111111",
      AGRIROUTER_SOFTWARE_VERSION_ID: "22222222-2222-4222-8222-222222222222",
      AGRIROUTER_REDIRECT_URI: "https://fourmy.test/agrirouter/callback",
    });
    setAgrirouterClientOptions({ fetch: fake.f, sleep: async () => {} });
  });
  afterAll(async () => {
    process.env = env;
    setAgrirouterClientOptions({});
    await teardown(sql, farmId, [userId, worker.userId]);
    await sql.end();
  });

  it("propose les dates assez dégagées et zone la parcelle par quantiles", async () => {
    const dates = (await (await app.request(`${base()}/land-parcels/${parcel}/modulation-dates?index=ndvi`, { headers })).json()) as { items: ModulationDate[] };
    expect(dates.items.map((d) => d.date)).toEqual(["2026-06-10"]);

    const res = await app.request(`${base()}/prescriptions/zoning`, { method: "POST", headers, body: JSON.stringify({ parcelId: parcel, date: "2026-06-10", zoneCount: 3 }) });
    expect(res.status).toBe(200);
    const z = (await res.json()) as Zoning;
    expect(z.zones.map((x) => x.code)).toEqual([1, 2, 3]);
    // Gradient ouest-est : zones de surfaces voisines, indices moyens croissants.
    expect(z.zones[0]!.meanIndex).toBeLessThan(z.zones[1]!.meanIndex);
    expect(z.zones[1]!.meanIndex).toBeLessThan(z.zones[2]!.meanIndex);
    const total = z.zones.reduce((s, x) => s + x.areaM2, 0);
    expect(Math.abs(total - z.parcelAreaM2)).toBeLessThan(z.parcelAreaM2 * 0.01);
    for (const x of z.zones) expect(x.areaM2 / total).toBeGreaterThan(0.25);
    expect(z.validRatio).toBeGreaterThan(0.9);

    // Une date absente du cache demande Copernicus : non configuré ici.
    const missing = await app.request(`${base()}/prescriptions/zoning`, { method: "POST", headers, body: JSON.stringify({ parcelId: parcel, date: "2026-06-15", zoneCount: 3 }) });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { detail: string }).detail).toContain("Copernicus");
    // Réservé au responsable (requêtes Copernicus de la ferme).
    expect((await app.request(`${base()}/prescriptions/zoning`, { method: "POST", headers: worker.headers, body: "{}" })).status).toBe(403);
  });

  it("enregistre une carte : doses par stratégie, bornées ; doses corrigées ensuite", async () => {
    const body = {
      parcelId: parcel, date: "2026-06-10", index: "ndvi", zoneCount: 3, name: "Azote 3e apport", product: "Ammonitrate 33,5",
      unit: "kg_ha", strategy: "compensate", baseRate: 100, modulationPct: 30, minRate: 80, maxRate: 200, widthM: 24,
    };
    const res = await app.request(`${base()}/prescriptions`, { method: "POST", headers, body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    prescription = (await res.json()) as Prescription;
    // Compenser : plus sur la zone faible ; 70 est relevé à la dose minimale de 80.
    expect(prescription.zones.map((z) => z.rate)).toEqual([130, 100, 80]);
    const expected = prescription.zones.reduce((s, z) => s + (z.rate * z.areaM2) / 10_000, 0);
    expect(prescription.totalQuantity).toBeCloseTo(expected, 0);
    expect((await app.request(`${base()}/prescriptions`, { method: "POST", headers: worker.headers, body: JSON.stringify(body) })).status).toBe(403);

    const upd = await app.request(`${base()}/prescriptions/${prescription.id}/rates`, { method: "PUT", headers, body: JSON.stringify({ rates: [140, 100, 85] }) });
    expect(upd.status).toBe(200);
    prescription = (await upd.json()) as Prescription;
    expect(prescription.zones.map((z) => z.rate)).toEqual([140, 100, 85]);

    const list = (await (await app.request(`${base()}/prescriptions?parcel=${parcel}`, { headers: worker.headers })).json()) as { items: PrescriptionSummary[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: "Azote 3e apport", parcelName: "Grand Champ", lastSentAt: null });
  });

  it("carte partie d'un apport du plan de fumure : moyenne pondérée ramenée à la dose de l'apport (lot AN)", async () => {
    const plan = crypto.randomUUID();
    await sql`INSERT INTO fertilization_plans (id, farm_id, campaign, land_parcel_id) VALUES (${plan}, ${farmId}, 2026, ${parcel})`;
    const body = {
      parcelId: parcel, date: "2026-06-10", index: "ndvi", zoneCount: 3, name: "Azote du plan", product: "Ammonitrate 33,5",
      unit: "kg_ha", strategy: "compensate", baseRate: 150, modulationPct: 20, minRate: 50, maxRate: 300, widthM: 24,
      planLink: { planId: plan, stage: "6 feuilles", targetRate: 150 },
    };
    const res = await app.request(`${base()}/prescriptions`, { method: "POST", headers, body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    const p = (await res.json()) as Prescription;
    expect(p.plan).toEqual({ planId: plan, stage: "6 feuilles", targetRate: 150 });
    const area = p.zones.reduce((s, z) => s + z.areaM2, 0);
    const mean = p.zones.reduce((s, z) => s + z.rate * z.areaM2, 0) / area;
    expect(Math.abs(mean - 150)).toBeLessThanOrEqual(1);
    // L'écart entre zones voulu par la stratégie est gardé : 60 kg entre la zone faible et la forte.
    expect(p.zones[0]!.rate - p.zones[2]!.rate).toBe(60);
    const other = crypto.randomUUID();
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${other}, ${farmId}, 'Autre')`;
    await sql`INSERT INTO fertilization_plans (id, farm_id, campaign, land_parcel_id) VALUES (${crypto.randomUUID()}, ${farmId}, 2026, ${other})`;
    const [o] = await sql`SELECT id FROM fertilization_plans WHERE land_parcel_id = ${other}`;
    expect((await app.request(`${base()}/prescriptions`, { method: "POST", headers, body: JSON.stringify({ ...body, planLink: { ...body.planLink, planId: o!.id } }) })).status).toBe(400);
    await app.request(`${base()}/prescriptions/${p.id}`, { method: "DELETE", headers });
  });

  it("exporte l'ISO-XML (grille de type 1) et le Shapefile", async () => {
    const iso = await app.request(`${base()}/prescriptions/${prescription.id}/files/isoxml`, { headers: worker.headers });
    expect(iso.status).toBe(200);
    expect(iso.headers.get("content-disposition")).toContain("grand-champ-azote-3e-apport-isoxml.zip");
    const files = unzip(await iso.arrayBuffer());
    const xml = files["TASKDATA/TASKDATA.XML"]!.toString("utf8");
    expect(xml).toContain('<TZN A="1" B="Zone 1 NDVI ');
    expect(xml).toContain('<PDV A="0006" B="14000" C="PDT1" E="VPN1"/>');
    const grd = /<GRD [^>]*E="(\d+)" F="(\d+)" G="GRD00001" H="(\d+)" I="1"\/>/.exec(xml)!;
    const [cols, rows, length] = [Number(grd[1]), Number(grd[2]), Number(grd[3])];
    // Mailles de 24 m sur 300 m environ.
    expect(cols).toBeGreaterThanOrEqual(12);
    expect(cols).toBeLessThanOrEqual(14);
    const bin = files["TASKDATA/GRD00001.bin"]!;
    expect(bin.length).toBe(cols * rows);
    expect(length).toBe(bin.length);
    // Ligne du milieu : zone 1 à l'ouest, zone 3 à l'est.
    const mid = [...bin.subarray(Math.floor(rows / 2) * cols, Math.floor(rows / 2) * cols + cols)].filter((c) => c > 0);
    expect(mid[0]).toBe(1);
    expect(mid.at(-1)).toBe(3);

    const shp = await app.request(`${base()}/prescriptions/${prescription.id}/files/shape`, { headers: worker.headers });
    const shapes = unzip(await shp.arrayBuffer());
    expect(Object.keys(shapes).sort()).toEqual(["grand-champ-azote-3e-apport.cpg", "grand-champ-azote-3e-apport.dbf", "grand-champ-azote-3e-apport.prj", "grand-champ-azote-3e-apport.shp", "grand-champ-azote-3e-apport.shx"]);
    expect(shapes["grand-champ-azote-3e-apport.dbf"]!.readUInt32LE(4)).toBe(3);
  });

  it("agrirouter : non configuré, puis connexion par consentement vérifiée", async () => {
    const id = process.env.AGRIROUTER_CLIENT_ID;
    delete process.env.AGRIROUTER_CLIENT_ID;
    const off = (await (await app.request(`${base()}/integrations`, { headers })).json()) as { providers: IntegrationProviderDefinition[] };
    expect(off.providers.find((p) => p.provider === "agrirouter")).toMatchObject({ available: false });
    const refused = await app.request(`${base()}/integrations/agrirouter/connect`, { method: "POST", headers });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { detail: string }).detail).toContain("AGRIROUTER_");
    process.env.AGRIROUTER_CLIENT_ID = id;

    const catalogue = (await (await app.request(`${base()}/integrations`, { headers })).json()) as { providers: IntegrationProviderDefinition[] };
    expect(catalogue.providers.find((p) => p.provider === "agrirouter")).toMatchObject({ connect: "oauth", available: true });
    expect((await app.request(`${base()}/integrations/agrirouter/connect`, { method: "POST", headers: worker.headers })).status).toBe(403);

    const start = (await (await app.request(`${base()}/integrations/agrirouter/connect`, { method: "POST", headers })).json()) as { url: string };
    const consent = new URL(start.url);
    expect(consent.origin + consent.pathname).toBe("https://app.agrirouter.com/api/authorize");
    const state = consent.searchParams.get("state")!;
    expect(state.startsWith(`${farmId}.`)).toBe(true);
    expect(consent.searchParams.get("redirect_uri")).toBe("https://fourmy.test/agrirouter/callback");
    const complete = (s: string) => app.request(`${base()}/integrations/agrirouter/complete`, { method: "POST", headers, body: JSON.stringify({ state: s, tenantId: TENANT }) });

    // État inconnu, puis tenant qui n'a pas autorisé avec cet état.
    expect((await complete(`${farmId}.inconnu`)).status).toBe(400);
    fake.state.consentState = "autre-etat";
    expect((await complete(state)).status).toBe(400);

    fake.state.consentState = state;
    const ok = await complete(state);
    expect(ok.status).toBe(200);
    await Promise.all(pendingSyncs);
    const put = fake.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe(`/endpoints/${encodeURIComponent(`urn:fourmy:farm:${farmId}`)}`);
    expect(put.headers.get("x-agrirouter-tenant-id")).toBe(TENANT);
    expect(put.body).toMatchObject({
      name: "Fourmy Ferme test modulation",
      endpoint_type: "cloud_software",
      capabilities: [
        { message_type: "iso:11783:-10:taskdata:zip", direction: "SEND" },
        { message_type: "shp:shape:zip", direction: "SEND" },
      ],
    });
    // Un état ne sert qu'une fois.
    expect((await complete(state)).status).toBe(400);

    const items = (await (await app.request(`${base()}/integrations`, { headers })).json()) as { items: Integration[] };
    const integ = items.items.find((i) => i.provider === "agrirouter")!;
    expect(integ).toMatchObject({ status: "ok", hasSecret: true, secretHint: null });
    expect(integ.settings).toMatchObject({ endpointId: OWN_ENDPOINT, companyName: "EARL Essai" });
    expect(JSON.stringify(items)).not.toContain(TENANT);
    expect(JSON.stringify(items)).not.toContain("SECRET-APP");
    expect((integ.lastReport as { recipients: { name: string; formats: string[] }[] }).recipients).toEqual([
      { id: TRACTOR, name: "Fendt 724 terminal", endpointType: "virtual_communication_unit", formats: ["isoxml", "shape"] },
      { id: SPRAYER, name: "Pulvé Amazone", endpointType: "virtual_communication_unit", formats: ["shape"] },
    ]);
  });

  it("envoie la carte à une machine joignable, et trace l'envoi", async () => {
    const send = (body: unknown, h = headers) => app.request(`${base()}/prescriptions/${prescription.id}/send`, { method: "POST", headers: h, body: JSON.stringify(body) });
    expect((await send({ format: "isoxml", recipients: [TRACTOR] }, worker.headers)).status).toBe(403);
    // Le pulvérisateur ne reçoit que du Shapefile ; un destinataire sans route est refusé.
    expect((await send({ format: "isoxml", recipients: [SPRAYER] })).status).toBe(400);
    expect((await send({ format: "isoxml", recipients: ["77777777-7777-4777-8777-777777777777"] })).status).toBe(400);

    const res = await send({ format: "isoxml", recipients: [TRACTOR] });
    expect(res.status).toBe(200);
    expect((await res.json()) as PrescriptionSend).toMatchObject({ status: "sent", recipients: [{ id: TRACTOR, name: "Fendt 724 terminal" }] });
    const msg = fake.calls.findLast((c) => c.path === "/messages")!;
    expect(msg.headers.get("x-agrirouter-message-type")).toBe("iso:11783:-10:taskdata:zip");
    expect(msg.headers.get("x-agrirouter-direct-recipients")).toBe(TRACTOR);
    expect(msg.headers.get("x-agrirouter-endpoint-id")).toBe(OWN_ENDPOINT);
    expect(msg.headers.get("x-agrirouter-tenant-id")).toBe(TENANT);
    expect(msg.headers.get("x-agrirouter-filename")).toBe("grand-champ-azote-3e-apport-isoxml.zip");
    expect(unzip((msg.body as Uint8Array).buffer as ArrayBuffer)["TASKDATA/TASKDATA.XML"]).toBeDefined();

    // Refus d'agrirouter : tracé en erreur.
    fake.state.sendStatus = 403;
    expect((await send({ format: "shape", recipients: [SPRAYER] })).status).toBe(400);
    fake.state.sendStatus = 200;
    const p = (await (await app.request(`${base()}/prescriptions/${prescription.id}`, { headers: worker.headers })).json()) as Prescription;
    expect(p.sends.map((s) => [s.format, s.status])).toEqual([
      ["shape", "error"],
      ["isoxml", "sent"],
    ]);
    expect(p.sends[1]!.sentBy).toBeTruthy();
  });

  it("retire la connexion : point de terminaison supprimé puis autorisation révoquée", async () => {
    const items = (await (await app.request(`${base()}/integrations`, { headers })).json()) as { items: Integration[] };
    const id = items.items.find((i) => i.provider === "agrirouter")!.id;
    const before = fake.calls.length;
    expect((await app.request(`${base()}/integrations/${id}`, { method: "DELETE", headers })).status).toBe(204);
    expect(fake.calls.slice(before).filter((c) => c.path !== "/token").map((c) => [c.method, c.path])).toEqual([
      ["DELETE", `/endpoints/${encodeURIComponent(`urn:fourmy:farm:${farmId}`)}`],
      ["DELETE", "/authorizations"],
    ]);
    const send = await app.request(`${base()}/prescriptions/${prescription.id}/send`, { method: "POST", headers, body: JSON.stringify({ format: "isoxml", recipients: [TRACTOR] }) });
    expect(send.status).toBe(400);

    expect((await app.request(`${base()}/prescriptions/${prescription.id}`, { method: "DELETE", headers })).status).toBe(204);
  });
});
