import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { withFarm } from "@fourmy/db";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { setAgrirouterClientOptions } from "../src/integrations/agrirouter.js";
import { agrirouterFilesConfig, storeAgrirouterFile } from "../src/integrations/agrirouter-events.js";
import { deliverAgrirouterSend, drainAgrirouterOutbox, enqueueAgrirouterSend } from "../src/integrations/agrirouter-outbox.js";
import { pendingSyncs } from "../src/routes/integrations.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * agrirouter, lot AR3 : file d'envoi. Coupure (réseau, identifiants
 * refusés, 5xx), reprise par le worker avec les mêmes octets, jamais de
 * renvoi après un 200, livraison partielle, abandon après 24 h, ferme
 * déconnectée. agrirouter est simulé ; aucune donnée réelle.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const TENANT = "33333333-3333-4333-8333-333333333333";
const OWN = "44444444-4444-4444-8444-444444444444";
const TRACTOR = "55555555-5555-4555-8555-555555555555";
const SPRAYER = "66666666-6666-4666-8666-666666666666";

type Mode = "ok" | "network" | "token" | 400 | 403 | 503;
function fakeAgrirouter() {
  const sent: { body: Uint8Array; recipients: string | null; sender: string | null }[] = [];
  const state = { consentState: "", messages: "ok" as Mode };
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const u = new URL(String(input));
    if (u.pathname === "/token") {
      if (state.messages === "network") throw new TypeError("fetch failed");
      if (state.messages === "token") return new Response("{}", { status: 401 });
      return Response.json({ access_token: "jeton-app", expires_in: 3600 });
    }
    if (u.pathname === "/tenants") return Response.json({ tenants: [{ tenant_id: TENANT, company_name: "EARL Essai", state: state.consentState, endpoints: [] }] });
    if (u.pathname.startsWith("/endpoints/") && init.method === "PUT") {
      return Response.json({ id: OWN, external_id: decodeURIComponent(u.pathname.slice(11)), endpoint_type: "cloud_software", tenant_id: TENANT, capabilities: [] }, { status: 201 });
    }
    if (u.pathname === `/tenants/${TENANT}/endpoints`) return Response.json({ endpoints: [] });
    if (u.pathname === "/messages") {
      if (state.messages === "network") throw new TypeError("fetch failed");
      if (typeof state.messages === "number") return Response.json({ message: "refus simulé" }, { status: state.messages });
      const headers = new Headers(init.headers);
      sent.push({ body: init.body as Uint8Array, recipients: headers.get("x-agrirouter-direct-recipients"), sender: headers.get("x-agrirouter-endpoint-id") });
      return new Response(null, { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, sent, state };
}

describe.skipIf(!url)("agrirouter : file d'envoi (AR3)", () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  const fake = fakeAgrirouter();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let filesDir = "";
  const savedDir = agrirouterFilesConfig.dir;
  const env = { ...process.env };
  const base = () => `/api/v1/farms/${farmId}`;

  /** Un envoi en file, pris en charge comme par l'API. */
  async function enqueue(recipients = [TRACTOR], content = "carte-figee") {
    const sha = await storeAgrirouterFile(new TextEncoder().encode(content));
    return withFarm(db(), farmId, (tx) =>
      enqueueAgrirouterSend(tx, { farmId, prescriptionSendId: null, messageType: "iso:11783:-10:taskdata:zip", filename: "carte.zip", recipients, fileSha256: sha, claimed: true }),
    );
  }
  const outbox = async (id: string) =>
    (await sql<{ state: string; attempts: number; last_error: string | null; next_attempt_at: Date }[]>`SELECT state, attempts, last_error, next_attempt_at FROM agrirouter_outbox WHERE id = ${id}`)[0]!;
  const makeDue = (id: string) => sql`UPDATE agrirouter_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}`;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test file agrirouter"));
    filesDir = await mkdtemp(join(tmpdir(), "fourmy-outbox-"));
    agrirouterFilesConfig.dir = filesDir;
    Object.assign(process.env, {
      AGRIROUTER_CLIENT_ID: "client-test",
      AGRIROUTER_CLIENT_SECRET: "SECRET-APP-AGRIROUTER",
      AGRIROUTER_APPLICATION_ID: "11111111-1111-4111-8111-111111111111",
      AGRIROUTER_SOFTWARE_VERSION_ID: "22222222-2222-4222-8222-222222222222",
      AGRIROUTER_REDIRECT_URI: "https://fourmy.test/agrirouter/callback",
    });
    setAgrirouterClientOptions({ fetch: fake.f, sleep: async () => {} });
    const start = (await (await app.request(`${base()}/integrations/agrirouter/connect`, { method: "POST", headers })).json()) as { url: string };
    const state = new URL(start.url).searchParams.get("state")!;
    fake.state.consentState = state;
    expect((await app.request(`${base()}/integrations/agrirouter/complete`, { method: "POST", headers, body: JSON.stringify({ state, tenantId: TENANT }) })).status).toBe(200);
    await Promise.all(pendingSyncs);
  });
  beforeEach(() => {
    fake.state.messages = "ok";
    fake.sent.length = 0;
  });
  afterAll(async () => {
    process.env = env;
    setAgrirouterClientOptions({});
    agrirouterFilesConfig.dir = savedDir;
    await rm(filesDir, { recursive: true, force: true });
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("agrirouter répond : envoyé aussitôt, une seule fois", async () => {
    const id = await enqueue();
    expect(await deliverAgrirouterSend(db(), farmId, id)).toEqual({ state: "sent", error: null, nextAttemptAt: null });
    expect(fake.sent.map((s) => [new TextDecoder().decode(s.body), s.recipients, s.sender])).toEqual([["carte-figee", TRACTOR, OWN]]);
    // Déjà envoyé : ni le worker ni un second appel ne le renvoient.
    await drainAgrirouterOutbox(db(), 20, farmId);
    expect((await deliverAgrirouterSend(db(), farmId, id)).state).toBe("failed");
    expect(fake.sent).toHaveLength(1);
    expect((await outbox(id)).state).toBe("sent");
  });

  for (const [mode, label] of [
    ["network", "agrirouter injoignable"],
    ["token", "identifiants de l'application refusés"],
    [503, "agrirouter en panne (503)"],
  ] as const) {
    it(`coupure (${label}) : en attente, puis reprise par le worker avec les mêmes octets`, async () => {
      fake.state.messages = mode;
      const id = await enqueue([TRACTOR], `carte-${mode}`);
      const before = Date.now();
      const queued = await deliverAgrirouterSend(db(), farmId, id);
      expect(queued.state).toBe("queued");
      expect(queued.error).toMatch(/^En attente : /);
      // Première attente : 1 minute.
      expect(Date.parse(queued.nextAttemptAt!) - before).toBeGreaterThanOrEqual(59_000);
      expect(Date.parse(queued.nextAttemptAt!) - before).toBeLessThan(65_000);
      // Pas encore dû : le worker n'y touche pas.
      fake.state.messages = "ok";
      await drainAgrirouterOutbox(db(), 20, farmId);
      expect(fake.sent).toHaveLength(0);
      // Dû, connexion revenue : parti.
      await makeDue(id);
      const counts = await drainAgrirouterOutbox(db(), 20, farmId);
      expect(counts.sent).toBeGreaterThanOrEqual(1);
      expect(fake.sent.map((s) => new TextDecoder().decode(s.body))).toContain(`carte-${mode}`);
      expect(await outbox(id)).toMatchObject({ state: "sent", attempts: 2, last_error: null });
    });
  }

  it("attentes croissantes tant que la coupure dure", async () => {
    fake.state.messages = "network";
    const id = await enqueue();
    await deliverAgrirouterSend(db(), farmId, id);
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      await makeDue(id);
      const before = Date.now();
      await drainAgrirouterOutbox(db(), 20, farmId);
      delays.push(Math.round(((await outbox(id)).next_attempt_at.getTime() - before) / 60_000));
    }
    expect(delays).toEqual([2, 5, 15]);
    await sql`DELETE FROM agrirouter_outbox WHERE id = ${id}`;
  });

  it("400 sur un envoi à plusieurs destinataires : livraison peut-être partielle, jamais renvoyé", async () => {
    fake.state.messages = 400;
    const id = await enqueue([TRACTOR, SPRAYER]);
    const r = await deliverAgrirouterSend(db(), farmId, id);
    expect(r.state).toBe("partial");
    expect(r.error).toContain("refus simulé");
    await sql`UPDATE agrirouter_outbox SET next_attempt_at = now() - interval '1 hour' WHERE id = ${id}`;
    fake.state.messages = "ok";
    await drainAgrirouterOutbox(db(), 20, farmId);
    expect(fake.sent).toHaveLength(0);
  });

  it("refus définitif (403, ou 400 à un seul destinataire) : abandonné sans reprise", async () => {
    for (const status of [403, 400] as const) {
      fake.state.messages = status;
      const id = await enqueue();
      expect((await deliverAgrirouterSend(db(), farmId, id)).state).toBe("failed");
      expect((await outbox(id)).last_error).toContain("refus simulé");
    }
  });

  it("abandonné après 24 h de coupure", async () => {
    fake.state.messages = "network";
    const id = await enqueue();
    await sql`UPDATE agrirouter_outbox SET created_at = now() - interval '25 hours' WHERE id = ${id}`;
    const r = await deliverAgrirouterSend(db(), farmId, id);
    expect(r).toMatchObject({ state: "failed", nextAttemptAt: null });
    expect(r.error).toContain("injoignable depuis 24 h");
  });

  it("envoi pris par un processus mort : repris à l'expiration de sa prise en charge", async () => {
    const id = await enqueue();
    await sql`UPDATE agrirouter_outbox SET locked_until = now() - interval '1 second' WHERE id = ${id}`;
    await drainAgrirouterOutbox(db(), 20, farmId);
    expect(await outbox(id)).toMatchObject({ state: "sent", attempts: 2 });
  });

  it("ferme déconnectée pendant l'attente : l'envoi échoue, sans appel", async () => {
    fake.state.messages = "network";
    const id = await enqueue();
    await deliverAgrirouterSend(db(), farmId, id);
    await sql`UPDATE integrations SET secret_ciphertext = NULL, status = 'disconnected' WHERE farm_id = ${farmId} AND provider = 'agrirouter'`;
    await makeDue(id);
    fake.state.messages = "ok";
    await drainAgrirouterOutbox(db(), 20, farmId);
    expect(fake.sent).toHaveLength(0);
    expect(await outbox(id)).toMatchObject({ state: "failed", last_error: "Ferme déconnectée d'agrirouter : reconnectez-la, puis renvoyez la carte." });
  });
});
