import { createHash, randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { mcpResource } from "../src/auth.js";
import { pendingLogs, resetRateLimits } from "../src/external/audit.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Serveur MCP (lot AM6, conception_api_mcp.md §7.2) : outils listés selon les
 * droits, périmètre d'activités et prorata, ferme par défaut, journal, et
 * connexion par clé d'API ou par jeton OAuth.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const vigne = crypto.randomUUID();
const ble = crypto.randomUUID();
const pVigne = crypto.randomUUID(); // 1 ha de vigne
const pBle = crypto.randomUUID(); // 3 ha de blé
const fongicide = crypto.randomUUID();
const engrais = crypto.randomUUID();
const iVigne = crypto.randomUUID();
const iBle = crypto.randomUUID();
const iMixte = crypto.randomUUID();
const square = (x: number) => `MULTIPOLYGON(((${x} 44.8,${x + 0.001} 44.8,${x + 0.001} 44.801,${x} 44.801,${x} 44.8)))`;

type ToolOut = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

async function connect(headers: Record<string, string>) {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp"), {
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    requestInit: { headers },
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(transport);
  return client;
}

describe.skipIf(!url)("serveur MCP (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  const base = () => `/api/v1/farms/${farm.farmId}`;
  const clients: string[] = [];

  const key = async (grant: unknown) => {
    const res = await app.request(`${base()}/accesses`, { method: "POST", headers: farm.headers, body: JSON.stringify({ name: "Assistant", grant }) });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { access: { id: string }; key: string };
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as ToolOut;

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme MCP");
    const f = farm.farmId;
    const c2026 = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${c2026}, ${f}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${vigne}, ${f}, 'Vigne', 'vine_farming'), (${ble}, ${f}, 'Blé tendre', 'plant_farming')`;
    for (const [id, name, x, area] of [
      [pVigne, "Les Vignes", 0.5, 10000],
      [pBle, "Le Grand Champ", 0.51, 30000],
    ] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${f}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
                VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${square(x)}, 4326), ${area}, tstzrange('2019-01-01', NULL))`;
    }
    for (const [parcel, activity] of [
      [pVigne, vigne],
      [pBle, ble],
    ])
      await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id) VALUES (${crypto.randomUUID()}, ${f}, ${c2026}, ${parcel}, 'field_crop', ${activity})`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${fongicide}, ${f}, 'Fongicide X', 'phyto', 'liter', '9100001'), (${engrais}, ${f}, 'Ammonitrate', 'fertilizer', 'kilogram', null)`;
    const plan = async (id: string, targets: string[], inputs: unknown[]) => {
      const res = await app.request(`${base()}/interventions`, {
        method: "POST",
        headers: farm.headers,
        body: JSON.stringify({ id, procedure: "spraying", plannedAt: "2026-06-10T08:00:00Z", targets: targets.map((t) => ({ kind: "land_parcel", id: t })), inputs, purposes: ["fungicide"] }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    await plan(iVigne, [pVigne], [{ articleId: fongicide, quantity: 2, per: "hectare" }]);
    await plan(iBle, [pBle], [{ articleId: fongicide, quantity: 2, per: "hectare" }]);
    await plan(iMixte, [pVigne, pBle], [{ articleId: fongicide, quantity: 40, per: "total" }]);
  });
  beforeEach(() => resetRateLimits());
  afterAll(async () => {
    await sql`DELETE FROM auth_api_keys WHERE reference_id = ${farm.userId}`;
    if (clients.length) await sql`DELETE FROM auth_oauth_clients WHERE client_id IN ${sql(clients)}`;
    await teardown(sql, farm.farmId, [farm.userId]);
    await sql.end();
  });

  it("sans identifiant : 401 et adresse des métadonnées ; GET refusé", async () => {
    const res = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"`);
    expect((await app.request("/mcp", { method: "POST", headers: { authorization: "Bearer eyJ.eyJ.sig" } })).status).toBe(401);
    expect((await app.request("/mcp", { headers: { "x-api-key": "fmy_x" } })).status).toBe(405);
  });

  it("outils listés selon les droits : tout, parcelles et interventions, stock seul", async () => {
    const all = await connect({ "x-api-key": (await key({ modules: Object.fromEntries(["farm", "parcels", "activities", "interventions", "phyto", "stocks", "equipments", "certifications"].map((m) => [m, "read"])), activities: "all" })).key });
    expect((await all.listTools()).tools.map((t) => t.name).sort()).toEqual(
      ["activites", "assolement", "controles_certification", "detail_intervention", "etat_propositions", "fermes", "fiche_parcelle", "interventions_periode", "interventions_prevues", "materiels", "parcelles", "registre_phyto", "stock"].sort(),
    );
    const some = await connect({ "x-api-key": (await key({ modules: { parcels: "read", interventions: "read" }, activities: "all" })).key });
    expect((await some.listTools()).tools.map((t) => t.name).sort()).toEqual(["detail_intervention", "etat_propositions", "fermes", "fiche_parcelle", "interventions_periode", "interventions_prevues", "parcelles"]);
    const stock = await connect({ "x-api-key": (await key({ modules: { stocks: "read" }, activities: "all" })).key });
    expect((await stock.listTools()).tools.map((t) => t.name).sort()).toEqual(["fermes", "stock"]);
    // Outil absent de la liste : refusé.
    const r = await call(stock, "parcelles");
    expect(r.isError).toBe(true);
  });

  it("outils sur une ferme Vigne + Blé, accès Vigne : parcelles, interventions prévues au prorata, assolement", async () => {
    const c = await connect({ "x-api-key": (await key({ modules: { parcels: "read", interventions: "read", activities: "read", stocks: "read" }, activities: [vigne] })).key });
    const parcels = await call(c, "parcelles");
    expect(parcels.content[0]!.text).toMatch(/^1 parcelle, 1 ha au total/);
    expect((parcels.structuredContent!.parcelles as { nom: string; activites: string[] }[]).map((p) => [p.nom, p.activites])).toEqual([["Les Vignes", ["Vigne"]]]);

    const planned = await call(c, "interventions_prevues", { du: "2026-06-01", au: "2026-06-30" });
    expect(planned.content[0]!.text).toContain("2 interventions prévues du 01/06/2026 au 30/06/2026 sur 1 parcelle");
    expect(planned.content[0]!.text).toContain("1 partagée(s)");
    const items = planned.structuredContent!.interventions as { id: string; parcelles: string[]; intrants: { article: string; quantite: string }[]; partagee?: boolean }[];
    const mixte = items.find((i) => i.id === iMixte)!;
    expect(mixte).toMatchObject({ parcelles: ["Les Vignes"], partagee: true, intrants: [{ article: "Fongicide X", quantite: "10 L" }] });
    expect(items.some((i) => i.id === iBle)).toBe(false);

    const detail = await call(c, "detail_intervention", { id: iBle });
    expect(detail.isError).toBe(true);
    const ok = await call(c, "detail_intervention", { id: iVigne });
    expect(ok.content[0]!.text).toMatch(/^Pulvérisation prévue le 10\/06\/2026 sur Les Vignes\./);

    const crop = await call(c, "assolement", { campagne: 2026 });
    expect(crop.content[0]!.text.split("\n")[0]).toBe("Assolement 2026 : 1 activité sur 1 ha (Vigne 1 ha).");
    const fiche = await call(c, "fiche_parcelle", { parcelle: "grand champ" });
    expect(fiche.isError).toBe(true);
    expect((await call(c, "fiche_parcelle", { parcelle: "les vignes" })).content[0]!.text).toMatch(/^Les Vignes : 1 ha, Vigne en 2026/);
  });

  it("journal : une ligne par appel d'outil, canal mcp, sous le nom de l'outil", async () => {
    const k = await key({ modules: { parcels: "read", activities: "read" }, activities: "all" });
    const c = await connect({ "x-api-key": k.key });
    await call(c, "parcelles", { recherche: "vigne" });
    await Promise.all([...pendingLogs]);
    const log = await sql`SELECT channel, operation, status FROM access_log WHERE access_id = ${k.access.id}`;
    expect(log.map((l) => [l.channel, l.operation, l.status])).toEqual([["mcp", "parcelles (GET /land-parcels)", 200]]);
  });

  it("jeton OAuth (audience /mcp) : fermes et outil, ferme par défaut", async () => {
    const reg = await app.request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Assistant MCP", redirect_uris: ["https://a.exemple.test/cb"], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"], scope: "fourmy:read" }),
    });
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    clients.push(clientId);
    const verifier = randomBytes(32).toString("base64url");
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://a.exemple.test/cb", scope: "fourmy:read", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: mcpResource() });
    const toFarm = new URL((await app.request(`/api/auth/oauth2/authorize?${q}`, { headers: farm.headers, redirect: "manual" })).headers.get("location")!, "http://x");
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: farm.headers, body: JSON.stringify(body) });
    const toConsent = new URL((await (await post("/api/v1/oauth/farm", { farmId: farm.farmId, oauthQuery: toFarm.search.slice(1) })).json()).url, "http://x");
    const back = new URL((await (await post("/api/v1/oauth/consent", { accept: true, grant: { modules: { activities: "read" }, activities: "all" }, oauthQuery: toConsent.search.slice(1) })).json()).url);
    const tok = await app.request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: "https://a.exemple.test/cb", client_id: clientId, code_verifier: verifier, resource: mcpResource() }).toString(),
    });
    const { access_token } = (await tok.json()) as { access_token: string };
    const c = await connect({ authorization: `Bearer ${access_token}` });
    expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(["activites", "assolement", "fermes"]);
    const fermes = await call(c, "fermes");
    expect(fermes.structuredContent!.fermes).toEqual([expect.objectContaining({ nom: "Ferme MCP", modules: ["Activités et assolement"] })]);
    const acts = await call(c, "activites");
    expect(acts.content[0]!.text).toMatch(/^2 activités : /);
    expect((await call(c, "activites", { ferme: "Autre ferme" })).isError).toBe(true);
  });
  it("propositions (lot AM8) : dépôt dicté, refus hors périmètre, acceptation, état ; canal mcp", async () => {
    const read = await connect({ "x-api-key": (await key({ modules: { parcels: "read", interventions: "read" }, activities: "all" })).key });
    expect((await read.listTools()).tools.map((t) => t.name)).not.toContain("proposer_intervention");
    const k = await key({ modules: { parcels: "read", interventions: "write", stocks: "read" }, activities: [vigne] });
    const c = await connect({ "x-api-key": k.key });
    const tools = (await c.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["proposer_intervention", "etat_propositions"]));
    expect(tools.find((t) => t.name === "proposer_intervention")!.annotations?.readOnlyHint).toBe(false);

    const out = await call(c, "proposer_intervention", { type: "spraying", parcelles: ["Le Grand Champ"], debut: "2026-06-12" });
    expect(out.isError).toBe(true);
    const r = await call(c, "proposer_intervention", {
      type: "spraying",
      parcelles: ["les vignes"],
      debut: "2026-06-12T07:30",
      intrants: [{ produit: "fongicide x", quantite: 1.5 }],
      message: "Dicté au bord de la vigne",
    });
    expect(r.isError, r.content[0]!.text).toBeFalsy();
    expect(r.content[0]!.text).toMatch(/^Proposition déposée : .* réalisée le 12\/06\/2026 07:30 sur 1 parcelle \(Les Vignes\)\. Elle attend la validation/);
    const id = (r.structuredContent!.proposition as { id: string }).id;
    const [stored] = await sql`SELECT channel, status, payload FROM external_proposals WHERE id = ${id}`;
    expect(stored).toMatchObject({ channel: "mcp", status: "pending" });
    expect((stored!.payload as { periods: { startedAt: string }[] }).periods[0]!.startedAt).toBe("2026-06-12T05:30:00.000Z");

    const acc = await app.request(`${base()}/proposals/${id}/accept`, { method: "POST", headers: farm.headers, body: "{}" });
    expect(acc.status, await acc.clone().text()).toBe(200);
    const { interventionId } = (await acc.json()) as { interventionId: string };
    expect((await sql`SELECT origin FROM interventions WHERE id = ${interventionId}`)[0]!.origin).toBe("mcp");

    const etat = await call(c, "etat_propositions");
    expect(etat.content[0]!.text).toMatch(/^1 proposition, dont 0 en attente de validation/);
    expect((etat.structuredContent!.propositions as { etat: string; intervention: string }[])[0]).toMatchObject({ etat: "acceptée", intervention: interventionId });
    await Promise.all([...pendingLogs]);
    const log = await sql`SELECT operation, written FROM access_log WHERE access_id = ${k.access.id} AND written IS NOT NULL`;
    expect(log).toEqual([{ operation: "proposer_intervention (POST /proposals)", written: { proposals: [id] } }]);
  });
});
