import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { AgrirouterClient, type AgrirouterEvent } from "@fourmy/agrirouter";
import type { AgrirouterInboxItem, Integration } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { setAgrirouterClientOptions, startAgrirouterConnect } from "../src/integrations/agrirouter.js";
import {
  agrirouterFilesConfig,
  confirmAgrirouterInbox,
  handleAgrirouterEvent,
  runAgrirouterListener,
} from "../src/integrations/agrirouter-events.js";
import { pendingSyncs } from "../src/routes/integrations.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * agrirouter, lot AR2 : événements du flux /events (réception, connexion
 * défaite, autorisation, liste des points de terminaison), confirmations,
 * écouteur unique. agrirouter est simulé ; aucune donnée réelle.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const TENANT = "33333333-3333-4333-8333-333333333333";
const OWN = "44444444-4444-4444-8444-444444444444";
const TRACTOR = "55555555-5555-4555-8555-555555555555";
const OTHER_ENDPOINT = "99999999-9999-4999-8999-999999999999";
const APP = {
  clientId: "client-test",
  clientSecret: "SECRET-APP-AGRIROUTER",
  applicationId: "11111111-1111-4111-8111-111111111111",
  softwareVersionId: "22222222-2222-4222-8222-222222222222",
  environment: "production" as const,
};

function fakeAgrirouter() {
  const calls: { method: string; path: string; tenant: string | null; body: unknown }[] = [];
  const state = { consentState: "", confirmStatus: 202, events: "" };
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const u = new URL(String(input));
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? "GET", path: u.pathname, tenant: headers.get("x-agrirouter-tenant-id"), body });
    if (u.hostname === "cdn.example.test") return new Response(new TextEncoder().encode("contenu-telecharge"));
    if (u.pathname === "/token") return Response.json({ access_token: "jeton-app", expires_in: 3600 });
    if (u.pathname === "/tenants") return Response.json({ tenants: [{ tenant_id: TENANT, company_name: "EARL Essai", state: state.consentState, endpoints: [] }] });
    if (u.pathname.startsWith("/endpoints/") && init.method === "PUT") {
      return Response.json({ id: OWN, external_id: decodeURIComponent(u.pathname.slice(11)), endpoint_type: "cloud_software", tenant_id: TENANT, capabilities: [] }, { status: 201 });
    }
    if (u.pathname === `/tenants/${TENANT}/endpoints`) return Response.json({ company_name: "EARL Essai", endpoints: [{ id: OWN, name: "Fourmy", endpoint_type: "cloud_software", application_id: "a", tenant_id: TENANT, owned_by_your_application: true, capabilities: { can_send: [], can_receive: [] } }] });
    if (u.pathname === "/confirmations") return new Response(state.confirmStatus === 202 ? null : "{}", { status: state.confirmStatus });
    if (u.pathname === "/events") return new Response(state.events, { headers: { "content-type": "text/event-stream" } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls, state };
}

const received = (id: string, extra: Partial<Extract<AgrirouterEvent, { type: "MESSAGE_RECEIVED" }>> = {}): AgrirouterEvent => ({
  type: "MESSAGE_RECEIVED",
  id,
  message_type: "iso:11783:-10:taskdata:zip",
  receiving_endpoint_id: OWN,
  sending_endpoint_id: TRACTOR,
  tenant_id: TENANT,
  sent_at: "2026-11-16T08:00:00Z",
  filename: "tache.zip",
  payload: Buffer.from("tache-realisee").toString("base64"),
  ...extra,
});

describe.skipIf(!url)("agrirouter : événements et boîte de réception (AR2)", () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  const fake = fakeAgrirouter();
  const client = () => new AgrirouterClient(APP, { fetch: fake.f, sleep: async () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let worker = { userId: "", headers: {} as Record<string, string> };
  let filesDir = "";
  const savedDir = agrirouterFilesConfig.dir;
  const env = { ...process.env };
  const base = () => `/api/v1/farms/${farmId}`;
  const integration = async () =>
    ((await (await app.request(`${base()}/integrations`, { headers })).json()) as { items: Integration[] }).items.find((i) => i.provider === "agrirouter");
  const inbox = async () => ((await (await app.request(`${base()}/agrirouter/inbox`, { headers })).json()) as { items: AgrirouterInboxItem[] }).items;

  /** Connexion complète de la ferme par l'API (consentement simulé). */
  async function connect() {
    const start = (await (await app.request(`${base()}/integrations/agrirouter/connect`, { method: "POST", headers })).json()) as { url: string };
    const state = new URL(start.url).searchParams.get("state")!;
    fake.state.consentState = state;
    const res = await app.request(`${base()}/integrations/agrirouter/complete`, { method: "POST", headers, body: JSON.stringify({ state, tenantId: TENANT }) });
    expect(res.status).toBe(200);
    await Promise.all(pendingSyncs);
    return state;
  }

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test agrirouter"));
    worker = await addMember(sql, farmId, "worker");
    filesDir = await mkdtemp(join(tmpdir(), "fourmy-agrirouter-"));
    agrirouterFilesConfig.dir = filesDir;
    Object.assign(process.env, {
      AGRIROUTER_CLIENT_ID: APP.clientId,
      AGRIROUTER_CLIENT_SECRET: APP.clientSecret,
      AGRIROUTER_APPLICATION_ID: APP.applicationId,
      AGRIROUTER_SOFTWARE_VERSION_ID: APP.softwareVersionId,
      AGRIROUTER_REDIRECT_URI: "https://fourmy.test/agrirouter/callback",
    });
    setAgrirouterClientOptions({ fetch: fake.f, sleep: async () => {} });
    await connect();
  });
  afterAll(async () => {
    process.env = env;
    setAgrirouterClientOptions({});
    agrirouterFilesConfig.dir = savedDir;
    await rm(filesDir, { recursive: true, force: true });
    await teardown(sql, farmId, [userId, worker.userId]);
    await sql.end();
  });

  it("range un message reçu une seule fois, même redélivré ; contenu intégré ou téléchargé", async () => {
    await handleAgrirouterEvent(db(), client(), received("m-1"));
    await handleAgrirouterEvent(db(), client(), received("m-1"));
    await handleAgrirouterEvent(db(), client(), {
      type: "FILE_RECEIVED",
      message_ids: ["f-1", "f-2"],
      message_type: "iso:11783:-10:time_log:protobuf",
      receiving_endpoint_id: OWN,
      tenant_id: TENANT,
      size: 18,
      payload_uri: "https://cdn.example.test/p/f-1?sig=x",
    });
    const items = await inbox();
    expect(items.map((i) => [i.messageType, i.filename, i.size, i.state, i.confirmedAt])).toEqual([
      ["iso:11783:-10:time_log:protobuf", null, 18, "received", null],
      ["iso:11783:-10:taskdata:zip", "tache.zip", 14, "received", null],
    ]);
    expect(items[1]!.senderEndpointId).toBe(TRACTOR);
    // Le contenu est sur le volume, téléchargeable par le responsable seulement.
    const file = await app.request(`${base()}/agrirouter/inbox/${items[1]!.id}/file`, { headers });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toBe('attachment; filename="tache.zip"');
    expect(await file.text()).toBe("tache-realisee");
    expect(await (await app.request(`${base()}/agrirouter/inbox/${items[0]!.id}/file`, { headers })).text()).toBe("contenu-telecharge");
    expect((await app.request(`${base()}/agrirouter/inbox`, { headers: worker.headers })).status).toBe(403);
  });

  it("message pour un point de terminaison inconnu : confirmé tout de suite, rien gardé", async () => {
    const before = fake.calls.length;
    await handleAgrirouterEvent(db(), client(), received("m-x", { receiving_endpoint_id: OTHER_ENDPOINT }));
    const confirm = fake.calls.slice(before).find((c) => c.path === "/confirmations")!;
    expect(confirm.tenant).toBe(TENANT);
    expect(confirm.body).toEqual({ confirmations: [{ message_id: "m-x", endpoint_id: OTHER_ENDPOINT }] });
    expect(await inbox()).toHaveLength(2);
  });

  it("confirme les fichiers rangés ; un échec est retenté au tour suivant", async () => {
    fake.state.confirmStatus = 500;
    expect(await confirmAgrirouterInbox(db(), client())).toEqual({ confirmed: 0, failed: 2 });
    expect((await inbox()).every((i) => i.confirmedAt === null && i.confirmError?.includes("500"))).toBe(true);

    fake.state.confirmStatus = 202;
    const before = fake.calls.length;
    expect(await confirmAgrirouterInbox(db(), client())).toEqual({ confirmed: 2, failed: 0 });
    const confirm = fake.calls.slice(before).find((c) => c.path === "/confirmations")!;
    expect(confirm.tenant).toBe(TENANT);
    expect((confirm.body as { confirmations: { message_id: string }[] }).confirmations.map((c) => c.message_id).sort()).toEqual(["f-1", "f-2", "m-1"]);
    expect((await inbox()).every((i) => i.confirmedAt && i.confirmError === null)).toBe(true);
    expect(await confirmAgrirouterInbox(db(), client())).toEqual({ confirmed: 0, failed: 0 });
  });

  it("liste des points de terminaison changée : destinataires recalculés sans appel", async () => {
    const before = fake.calls.length;
    await handleAgrirouterEvent(db(), client(), {
      type: "ENDPOINTS_LIST_CHANGED",
      tenant_id: TENANT,
      endpoints: [
        { id: OWN, name: "Fourmy", endpoint_type: "cloud_software", application_id: "a", tenant_id: TENANT, owned_by_your_application: true, capabilities: { can_send: [], can_receive: [] }, routed_endpoints: { can_send_to: { [TRACTOR]: ["iso:11783:-10:taskdata:zip"] } } },
        { id: TRACTOR, name: "Console Fendt", endpoint_type: "virtual_communication_unit", application_id: "b", tenant_id: TENANT, owned_by_your_application: false, capabilities: { can_send: [], can_receive: [] } },
      ],
    });
    expect(fake.calls.length).toBe(before);
    expect((await integration())!.lastReport).toMatchObject({ recipients: [{ id: TRACTOR, name: "Console Fendt", formats: ["isoxml"] }] });
  });

  it("point de terminaison supprimé dans agrirouter : seulement le sien, la ferme passe déconnectée", async () => {
    await handleAgrirouterEvent(db(), client(), { type: "ENDPOINT_DELETED", id: OTHER_ENDPOINT, external_id: "urn:autre:app:x" });
    expect((await integration())!.status).toBe("ok");
    await handleAgrirouterEvent(db(), client(), { type: "ENDPOINT_DELETED", id: OWN, external_id: `urn:fourmy.org:fourmy:farm-${farmId}` });
    expect(await integration()).toMatchObject({ status: "disconnected", hasSecret: false, settings: { disconnectReason: "endpoint_deleted" } });
  });

  it("autorisation ajoutée sans retour du navigateur : la connexion se termine ; le retour tardif reste sans erreur", async () => {
    const start = await startAgrirouterConnect(db(), farmId);
    const state = new URL(start.url).searchParams.get("state")!;
    fake.state.consentState = state;
    await handleAgrirouterEvent(db(), client(), { type: "AUTHORIZATION_ADDED", tenant: { tenant_id: TENANT, endpoints: [] }, scope: "endpoints:manage", state });
    expect(await integration()).toMatchObject({ hasSecret: true, settings: { endpointId: OWN } });
    const late = await app.request(`${base()}/integrations/agrirouter/complete`, { method: "POST", headers, body: JSON.stringify({ state, tenantId: TENANT }) });
    expect(late.status).toBe(200);
    expect((await app.request(`${base()}/integrations/agrirouter/complete`, { method: "POST", headers, body: JSON.stringify({ state: `${farmId}.autre`, tenantId: TENANT }) })).status).toBe(400);
  });

  it("autorisation retirée dans agrirouter : toutes les fermes de ce compte passent déconnectées", async () => {
    await handleAgrirouterEvent(db(), client(), { type: "AUTHORIZATION_REVOKED", tenant_id: "00000000-0000-4000-8000-000000000000", scope: "endpoints:manage" });
    expect((await integration())!.hasSecret).toBe(true);
    await handleAgrirouterEvent(db(), client(), { type: "AUTHORIZATION_REVOKED", tenant_id: TENANT, scope: "endpoints:manage" });
    expect(await integration()).toMatchObject({ status: "disconnected", hasSecret: false, settings: { disconnectReason: "revoked" } });
    expect((await integration())!.lastError).toContain("retirée dans agrirouter");
  });

  it("écouteur : un seul à la fois (verrou), traite le flux puis s'arrête proprement", async () => {
    await connect();
    fake.state.events = `event: MESSAGE_RECEIVED\ndata: ${JSON.stringify(received("m-flux"))}\n\n`;
    const logs: string[] = [];
    const first = new AbortController();
    const second = new AbortController();
    let secondTries = 0;
    const listen = (signal: AbortSignal, name: string, onSleep: () => void) =>
      runAgrirouterListener({
        db: db(),
        databaseUrl: url!,
        client,
        signal,
        lockRetryMs: 5,
        log: (m) => logs.push(`${name} ${m}`),
        sleep: async (ms) => {
          onSleep();
          await new Promise((r) => setTimeout(r, Math.min(ms, 20)));
        },
      });
    const a = listen(first.signal, "A", () => undefined);
    // Attend que A tienne le verrou et ait rangé le message du flux.
    for (let i = 0; i < 100 && !(await inbox()).some((x) => x.filename === "tache.zip" && x.sentAt && logs.some((l) => l.includes("reçu"))); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const b = listen(second.signal, "B", () => void secondTries++);
    while (secondTries < 3) await new Promise((r) => setTimeout(r, 10));
    first.abort();
    second.abort();
    await Promise.all([a, b]);
    expect(logs.filter((l) => l.endsWith("écoute des événements agrirouter"))).toEqual(["A écoute des événements agrirouter"]);
    expect(logs.some((l) => l.startsWith("A ferme") && l.includes("taskdata:zip reçu"))).toBe(true);
    const [stored] = await sql<{ file_sha256: string }[]>`SELECT file_sha256 FROM agrirouter_inbox WHERE farm_id = ${farmId} AND message_ids[1] = 'm-flux'`;
    expect(await readFile(join(filesDir, stored!.file_sha256.slice(0, 2), stored!.file_sha256), "utf8")).toBe("tache-realisee");
  });
});
