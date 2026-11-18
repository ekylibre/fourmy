import { describe, expect, it } from "vitest";
import { AgrirouterClient, readSse } from "../src/index.js";

/** Flux SSE et réception (lot AR2) : trames synthétiques, aucune donnée réelle. */
const app = { clientId: "c", clientSecret: "SECRET-APP", applicationId: "a", softwareVersionId: "v", environment: "production" as const };
const TENANT = "33333333-3333-4333-8333-333333333333";
const token = () => Response.json({ access_token: "jeton", expires_in: 3600 });

/** Corps découpé en morceaux arbitraires, comme sur le réseau. */
function stream(text: string, size = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.slice(at, (at += size)));
    },
  });
}

describe("readSse", () => {
  it("assemble les trames : événement, données sur plusieurs lignes, id, commentaires, fins de ligne CRLF", async () => {
    const text = ": maintien\n\nevent: A\ndata: {\"x\":\ndata: 1}\nid: 7\n\r\nevent: B\r\ndata: {}\r\n\r\ndata: sans type\n\n";
    const frames = [];
    for await (const f of readSse(stream(text))) frames.push(f);
    expect(frames).toEqual([
      { event: "A", data: '{"x":\n1}', id: "7" },
      { event: "B", data: "{}", id: "7" },
      { event: "message", data: "sans type", id: "7" },
    ]);
  });
});

describe("réception", () => {
  it("lit le flux /events avec le jeton, type chaque événement, garde les inconnus", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const body =
      'event: MESSAGE_RECEIVED\ndata: {"id":"m1","message_type":"iso:11783:-10:taskdata:zip","receiving_endpoint_id":"e1","payload":"QUJD"}\n\n' +
      'event: AUTHORIZATION_REVOKED\ndata: {"tenant_id":"t1","scope":"endpoints:manage"}\n\n' +
      "event: NOUVEAU\ndata: {\"a\":1}\n\nevent: MESSAGE_RECEIVED\ndata: pas du json\n\n";
    const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({ url: String(input), headers: new Headers(init.headers) });
      return String(input).endsWith("/token") ? token() : new Response(stream(body), { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const events = [];
    for await (const e of new AgrirouterClient(app, { fetch: f }).events()) events.push(e);
    expect(events).toEqual([
      { type: "MESSAGE_RECEIVED", id: "m1", message_type: "iso:11783:-10:taskdata:zip", receiving_endpoint_id: "e1", payload: "QUJD" },
      { type: "AUTHORIZATION_REVOKED", tenant_id: "t1", scope: "endpoints:manage" },
      { type: "UNKNOWN", event: "NOUVEAU", data: { a: 1 } },
    ]);
    const call = seen.find((s) => s.url.endsWith("/events"))!;
    expect(call.headers.get("authorization")).toBe("Bearer jeton");
    expect(call.headers.get("accept")).toBe("text/event-stream");
  });

  it("contenu intégré (base64) ou téléchargé tel quel, sans jeton", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), headers: new Headers(init.headers) });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    const c = new AgrirouterClient(app, { fetch: f, sleep: async () => {} });
    expect([...(await c.payload({ payload: "QUJD" }))]).toEqual([65, 66, 67]);
    expect(calls).toHaveLength(0);
    const uri = "https://cdn.example.test/p/abc?sig=1";
    expect([...(await c.payload({ payload_uri: uri }))]).toEqual([1, 2, 3]);
    expect(calls[0]!.url).toBe(uri);
    expect(calls[0]!.headers.get("authorization")).toBeNull();
  });

  it("confirme les messages d'un compte en une requête", async () => {
    const bodies: unknown[] = [];
    const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).endsWith("/token")) return token();
      bodies.push({ url: String(input), tenant: new Headers(init.headers).get("x-agrirouter-tenant-id"), body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const c = new AgrirouterClient(app, { fetch: f });
    await c.confirm(TENANT, []);
    expect(bodies).toHaveLength(0);
    await c.confirm(TENANT, [{ messageId: "m1", endpointId: "e1" }, { messageId: "m2", endpointId: "e1" }]);
    expect(bodies).toEqual([
      {
        url: "https://api.agrirouter.com/confirmations",
        tenant: TENANT,
        body: { confirmations: [{ message_id: "m1", endpoint_id: "e1" }, { message_id: "m2", endpoint_id: "e1" }] },
      },
    ]);
  });
});
