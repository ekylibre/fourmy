import { describe, expect, it } from "vitest";
import { AgrirouterClient, AgrirouterError, MESSAGE_TYPES } from "../src/index.js";

/** Réponses synthétiques de l'API G4 (aucune donnée réelle). */
type Call = { method: string; url: string; headers: Headers; body: unknown };
function fake(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const raw = init.body;
    const body = raw instanceof URLSearchParams ? Object.fromEntries(raw) : typeof raw === "string" ? JSON.parse(raw) : raw;
    const call = { method: init.method ?? "GET", url: String(input), headers, body };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { f, calls };
}
const app = { clientId: "client-1", clientSecret: "SECRET-APP", applicationId: "11111111-1111-4111-8111-111111111111", softwareVersionId: "22222222-2222-4222-8222-222222222222", environment: "production" as const };
const TENANT = "33333333-3333-4333-8333-333333333333";
const token = () => Response.json({ access_token: "jeton", token_type: "Bearer", expires_in: 3600 });

describe("AgrirouterClient", () => {
  it("construit l'adresse de consentement", () => {
    const url = new URL(new AgrirouterClient(app).authorizeUrl("ferme.nonce", "https://fourmy.test/agrirouter/callback"));
    expect(url.origin + url.pathname).toBe("https://app.agrirouter.com/api/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "client-1", scope: "endpoints:manage", state: "ferme.nonce", redirect_uri: "https://fourmy.test/agrirouter/callback" });
  });

  it("obtient un jeton client_credentials, le réutilise, et pose l'en-tête de la ferme", async () => {
    const { f, calls } = fake((c) => (c.url.endsWith("/token") ? token() : Response.json({ tenants: [{ tenant_id: TENANT, state: "s", endpoints: [] }] })));
    const c = new AgrirouterClient(app, { fetch: f });
    expect(await c.tenants()).toHaveLength(1);
    await c.tenantEndpoints(TENANT).catch(() => undefined);
    expect(calls.filter((x) => x.url.endsWith("/token"))).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ grant_type: "client_credentials", client_id: "client-1", client_secret: "SECRET-APP" });
    expect(calls[1]!.headers.get("authorization")).toBe("Bearer jeton");
    expect(calls[2]!.url).toBe(`https://api.agrirouter.com/tenants/${TENANT}/endpoints`);
    expect(calls[2]!.headers.get("x-agrirouter-tenant-id")).toBe(TENANT);
  });

  it("crée le point de terminaison avec l'application, la version et les capacités", async () => {
    const { f, calls } = fake((c) => (c.url.endsWith("/token") ? token() : Response.json({ id: "ep-1", external_id: "urn:x", endpoint_type: "cloud_software", tenant_id: TENANT, capabilities: [] }, { status: 201 })));
    const ep = await new AgrirouterClient(app, { fetch: f }).putEndpoint(TENANT, "urn:fourmy:farm:1", {
      name: "Fourmy",
      endpointType: "cloud_software",
      capabilities: [{ message_type: MESSAGE_TYPES.taskdata, direction: "SEND" }],
      subscriptions: [],
    });
    expect(ep.id).toBe("ep-1");
    expect(calls[1]!.method).toBe("PUT");
    expect(calls[1]!.url).toBe("https://api.agrirouter.com/endpoints/urn%3Afourmy%3Afarm%3A1");
    expect(calls[1]!.body).toEqual({
      name: "Fourmy",
      application_id: app.applicationId,
      software_version_id: app.softwareVersionId,
      endpoint_type: "cloud_software",
      capabilities: [{ message_type: "iso:11783:-10:taskdata:zip", direction: "SEND" }],
      subscriptions: [],
    });
  });

  it("envoie un fichier binaire avec l'enveloppe en en-têtes, et réessaie sur 429", async () => {
    let attempts = 0;
    const { f, calls } = fake((c) => (c.url.endsWith("/token") ? token() : ++attempts === 1 ? Response.json({ message: "rate limit exceeded" }, { status: 429 }) : new Response(null, { status: 200 })));
    const waits: number[] = [];
    const payload = new Uint8Array([80, 75, 3, 4]);
    await new AgrirouterClient(app, { fetch: f, sleep: async (ms) => void waits.push(ms) }).sendFile(TENANT, {
      senderEndpointId: "ep-1",
      messageType: MESSAGE_TYPES.taskdata,
      recipients: ["vcu-1", "vcu-2"],
      filename: "carte.zip",
      payload,
      sentAt: new Date("2026-11-11T10:00:00Z"),
    });
    expect(waits).toEqual([1000]);
    const sent = calls.at(-1)!;
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("https://api.agrirouter.com/messages");
    expect(sent.body).toBe(payload);
    expect(Object.fromEntries([...sent.headers].filter(([k]) => k.startsWith("x-agrirouter") || k.startsWith("content")))).toEqual({
      "content-length": "4",
      "content-type": "application/octet-stream",
      "x-agrirouter-direct-recipients": "vcu-1,vcu-2",
      "x-agrirouter-endpoint-id": "ep-1",
      "x-agrirouter-filename": "carte.zip",
      "x-agrirouter-is-publish": "false",
      "x-agrirouter-message-type": "iso:11783:-10:taskdata:zip",
      "x-agrirouter-sent-timestamp": "2026-11-11T10:00:00.000Z",
      "x-agrirouter-tenant-id": TENANT,
    });
  });

  it("relaie le message d'erreur sans jamais le secret", async () => {
    const refused = fake(() => new Response("{}", { status: 401 }));
    const err = await new AgrirouterClient(app, { fetch: refused.f }).tenants().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgrirouterError);
    expect(String(err)).not.toContain("SECRET-APP");

    const routing = fake((c) => (c.url.endsWith("/token") ? token() : Response.json({ message: "No recipients for this sender and info type" }, { status: 400 })));
    await expect(
      new AgrirouterClient(app, { fetch: routing.f }).sendFile(TENANT, { senderEndpointId: "e", messageType: MESSAGE_TYPES.shape, recipients: ["r"], filename: "f.zip", payload: new Uint8Array(1) }),
    ).rejects.toThrow("400 No recipients for this sender and info type");
  });
});
