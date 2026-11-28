import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { pendingLogs, resetRateLimits } from "../src/external/audit.js";
import { expireProposals } from "../src/repos/proposals.js";
import { addMember, ensurePhytoReferential, setupFarm, teardown } from "./helpers.js";

/**
 * Propositions des accès externes (lot AM8, conception_api_mcp.md §8) : dépôt
 * contrôlé à blanc, périmètre d'activités, acceptation (corrigée ou non) par
 * le responsable seul, refus, suivi par l'accès, expiration et purge.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const PRODUCT = 99_000_081;
const AMM = "9900081";
const mais = crypto.randomUUID();
const ble = crypto.randomUUID();
const pMais = crypto.randomUUID();
const pBle = crypto.randomUUID();
const herbicide = crypto.randomUUID();
const square = (x: number) => `MULTIPOLYGON(((${x} 44.8,${x + 0.0013} 44.8,${x + 0.0013} 44.8009,${x} 44.8009,${x} 44.8)))`;

type Proposal = {
  id: string;
  status: string;
  channel: string;
  accessName: string | null;
  corrected: boolean;
  resultId: string | null;
  decisionNote: string | null;
  checks: { level: string; messages: { level: string; message: string }[] } | null;
  payload: { inputs: { quantity: number }[] };
};

describe.skipIf(!url)("propositions des accès externes (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  let worker: Awaited<ReturnType<typeof addMember>>;
  let writeKey = "";
  let readKey = "";
  let writeAccess = "";
  const base = () => `/api/v1/farms/${farm.farmId}`;
  const asKey = (key: string) => ({ "x-api-key": key, "content-type": "application/json" });
  const spraying = (dose: number, parcel = pMais) => ({
    procedure: "spraying",
    periods: [{ startedAt: "2026-05-10T06:00:00Z", stoppedAt: "2026-05-10T08:00:00Z" }],
    targets: [{ kind: "land_parcel", id: parcel }],
    inputs: [{ articleId: herbicide, quantity: dose, per: "hectare" }],
    purposes: ["herbicide"],
    compliance: { usages: { [herbicide]: "test-am8" } },
  });
  const propose = (headers: Record<string, string>, payload: unknown, message?: string) =>
    app.request(`${base()}/proposals`, { method: "POST", headers, body: JSON.stringify({ payload, ...(message ? { message } : {}) }) });
  const interventionCount = async () => (await sql`SELECT count(*)::int AS n FROM interventions WHERE farm_id = ${farm.farmId}`)[0]!.n as number;

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme propositions");
    worker = await addMember(sql, farm.farmId, "worker");
    const f = farm.farmId;
    await ensurePhytoReferential(sql);
    await sql`INSERT INTO taxonomy (reference_name, parent, rank, label) VALUES
      ('zea_mays', 'zea', 'specie', 'Maïs'), ('zea', 'poaceae', 'genus', 'Maïs'), ('poaceae', 'plant', 'family', 'Poacées'), ('plant', NULL, NULL, 'Plante')
      ON CONFLICT (reference_name) DO NOTHING`;
    await sql`INSERT INTO phyto_products (id, amm, name, other_names, natures, reentry_delay_hours, state, started_on)
      VALUES (${PRODUCT}, ${AMM}, 'HERBI AM8', '{}', '{Herbicide}', 6, 'authorized', '2015-01-01')`;
    await sql`INSERT INTO phyto_usages (id, product_id, phrase, crop_label, species, target_label, dose_quantity, dose_unit_label,
                                        pre_harvest_delay_days, applications_count, untreated_buffer_aquatic, state)
      VALUES ('test-am8', ${PRODUCT}, 'Maïs*Désherbage', 'Maïs', '{zea_mays}', 'Désherbage', 3, 'L/ha', 30, NULL, 5, 'authorized')`;
    const c2026 = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${c2026}, ${f}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${mais}, ${f}, 'Maïs', 'plant_farming'), (${ble}, ${f}, 'Blé tendre', 'plant_farming')`;
    for (const [id, name, x, activity, cultivation] of [
      [pMais, "Le Champ de Maïs", 0.6, mais, "zea_mays"],
      [pBle, "Le Grand Champ", 0.62, ble, "triticum_aestivum"],
    ] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${f}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
                VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${square(x)}, 4326), 10000, tstzrange('2019-01-01', NULL))`;
      await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id, cultivation)
                VALUES (${crypto.randomUUID()}, ${f}, ${c2026}, ${id}, 'field_crop', ${activity}, ${cultivation})`;
    }
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${herbicide}, ${f}, 'Herbi AM8', 'phyto', 'liter', ${AMM})`;

    const key = async (name: string, grant: unknown) => {
      const res = await app.request(`${base()}/accesses`, { method: "POST", headers: farm.headers, body: JSON.stringify({ name, grant }) });
      expect(res.status, await res.clone().text()).toBe(201);
      return (await res.json()) as { access: { id: string; grant: { modules: Record<string, string> } }; key: string };
    };
    const w = await key("Assistant Maïs", { modules: { parcels: "read", interventions: "write", stocks: "write" }, activities: [mais] });
    // L'écriture n'a de sens que sur les interventions : ailleurs, ramenée à la lecture.
    expect(w.access.grant.modules).toEqual({ parcels: "read", interventions: "write", stocks: "read" });
    writeKey = w.key;
    writeAccess = w.access.id;
    readKey = (await key("Lecture", { modules: { interventions: "read" }, activities: "all" })).key;
  });
  beforeEach(() => resetRateLimits());
  afterAll(async () => {
    await sql`DELETE FROM auth_api_keys WHERE reference_id = ${farm.userId}`;
    await teardown(sql, farm.farmId, [farm.userId, worker.userId]);
    await sql`DELETE FROM phyto_usages WHERE product_id = ${PRODUCT}`;
    await sql`DELETE FROM phyto_products WHERE id = ${PRODUCT}`;
    await sql.end();
  });

  it("dépôt avec un feu rouge : contrôles renvoyés, rien d'écrit dans la ferme ; journal", async () => {
    const res = await propose(asKey(writeKey), spraying(4), "Dicté au bord du champ");
    expect(res.status, await res.clone().text()).toBe(201);
    const p = (await res.json()) as Proposal;
    expect(p).toMatchObject({ status: "pending", channel: "api", accessName: "Assistant Maïs", resultId: null });
    expect(p.checks?.level).toBe("danger");
    expect(p.checks?.messages.some((m) => m.level === "danger" && /Dose 4 L\/ha au-dessus du maximum/.test(m.message))).toBe(true);
    expect(await interventionCount()).toBe(0);
    await Promise.all([...pendingLogs]);
    const [log] = await sql`SELECT operation, status, written FROM access_log WHERE access_id = ${writeAccess} ORDER BY at DESC LIMIT 1`;
    expect(log).toMatchObject({ operation: "POST /proposals", status: 201, written: { proposals: [p.id] } });
  });

  it("refus : cible hors du périmètre (422), accès en lecture (403), contenu invalide (400 ou 422)", async () => {
    const out = await propose(asKey(writeKey), spraying(2, pBle));
    expect(out.status, await out.clone().text()).toBe(422);
    expect(((await out.json()) as { detail: string }).detail).toMatch(/hors de cet accès/);
    expect((await propose(asKey(readKey), spraying(2))).status).toBe(403);
    expect((await propose(asKey(writeKey), { ...spraying(2), procedure: "" })).status).toBe(400);
    const unknownArticle = await propose(asKey(writeKey), { ...spraying(2), inputs: [{ articleId: crypto.randomUUID(), quantity: 1, per: "hectare" }] });
    expect(unknownArticle.status, await unknownArticle.clone().text()).toBe(422);
    // L'acceptation et le refus restent fermés aux accès externes.
    const any = crypto.randomUUID();
    expect((await app.request(`${base()}/proposals/${any}/accept`, { method: "POST", headers: asKey(writeKey), body: "{}" })).status).toBe(404);
    expect(await interventionCount()).toBe(0);
  });

  it("acceptation corrigée par le formulaire : intervention, registre et stock ; origine api", async () => {
    const p = (await (await propose(asKey(writeKey), spraying(4))).json()) as Proposal;
    const id = crypto.randomUUID();
    // Le formulaire du web : création, puis réalisation avec la dose corrigée et la proposition.
    const created = await app.request(`${base()}/interventions`, { method: "POST", headers: farm.headers, body: JSON.stringify({ id, procedure: "spraying" }) });
    expect(created.status, await created.clone().text()).toBe(201);
    const { procedure: _, ...body } = spraying(2);
    // Un salarié ne peut pas accepter (B9).
    const denied = await app.request(`${base()}/interventions/${id}/complete`, { method: "POST", headers: worker.headers, body: JSON.stringify({ ...body, proposal: p.id }) });
    expect(denied.status).toBe(403);
    const done = await app.request(`${base()}/interventions/${id}/complete`, { method: "POST", headers: farm.headers, body: JSON.stringify({ ...body, proposal: p.id }) });
    expect(done.status, await done.clone().text()).toBe(200);

    const after = (await (await app.request(`${base()}/proposals/${p.id}`, { headers: farm.headers })).json()) as Proposal;
    expect(after).toMatchObject({ status: "accepted", resultId: id, corrected: true });
    // Contrôles refaits à l'enregistrement : la dose corrigée n'est plus un feu rouge.
    const [i] = await sql`SELECT status, origin, compliance->>'level' AS level FROM interventions WHERE id = ${id}`;
    expect(i).toMatchObject({ status: "done", origin: "api" });
    expect(i!.level).not.toBe("danger");
    const moves = await sql`SELECT quantity::float8 AS q FROM stock_movements WHERE intervention_id = ${id}`;
    expect(moves.map((m) => m.q)).toEqual([-2]);
    const register = (await (await app.request(`${base()}/registers/phyto?campaign=2026`, { headers: farm.headers })).json()) as { items: unknown[] };
    expect(JSON.stringify(register.items)).toContain(id);
    // Déjà traitée : un second enregistrement qui la cite est refusé.
    const again = await app.request(`${base()}/interventions`, { method: "POST", headers: farm.headers, body: JSON.stringify({ ...spraying(2), id: crypto.randomUUID(), periods: [], proposal: p.id }) });
    expect(again.status).toBe(409);
  });

  it("acceptation telle quelle (POST /proposals/:id/accept) ; un salarié ne peut pas", async () => {
    const p = (await (await propose(asKey(writeKey), spraying(2))).json()) as Proposal;
    expect(p.checks?.level).not.toBe("danger");
    const url = `${base()}/proposals/${p.id}/accept`;
    expect((await app.request(url, { method: "POST", headers: worker.headers, body: "{}" })).status).toBe(403);
    const res = await app.request(url, { method: "POST", headers: farm.headers, body: JSON.stringify({ note: "OK" }) });
    expect(res.status, await res.clone().text()).toBe(200);
    const r = (await res.json()) as { interventionId: string; proposal: Proposal };
    expect(r.proposal).toMatchObject({ status: "accepted", corrected: false, resultId: r.interventionId, decisionNote: "OK" });
    const [i] = await sql`SELECT status, origin FROM interventions WHERE id = ${r.interventionId}`;
    expect(i).toMatchObject({ status: "done", origin: "api" });
    expect((await app.request(url, { method: "POST", headers: farm.headers, body: "{}" })).status).toBe(409);
  });

  it("refus par le responsable ; suivi par l'accès (les siennes) et par le responsable (toutes)", async () => {
    const p = (await (await propose(asKey(writeKey), spraying(1))).json()) as Proposal;
    const reject = (headers: Record<string, string>) =>
      app.request(`${base()}/proposals/${p.id}/reject`, { method: "POST", headers, body: JSON.stringify({ note: "Déjà fait la veille" }) });
    expect((await reject(worker.headers)).status).toBe(403);
    const r = await reject(farm.headers);
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await r.json()).toMatchObject({ status: "rejected", decisionNote: "Déjà fait la veille" });
    expect((await reject(farm.headers)).status).toBe(409);

    // Une proposition déposée par le salarié (session) : ni l'accès ni lui ne voient celles des autres.
    const mine = await propose(worker.headers, spraying(1.5));
    expect(mine.status, await mine.clone().text()).toBe(201);
    expect(((await mine.json()) as Proposal).channel).toBe("web");

    const byKey = (await (await app.request(`${base()}/proposals`, { headers: asKey(writeKey) })).json()) as { items: Proposal[]; pending: number };
    expect(byKey.items.every((x) => x.accessName === "Assistant Maïs")).toBe(true);
    expect(byKey.items.map((x) => x.status).sort()).toEqual(["accepted", "accepted", "pending", "rejected"]);
    expect(byKey.pending).toBe(1);
    const byWorker = (await (await app.request(`${base()}/proposals`, { headers: worker.headers })).json()) as { items: Proposal[] };
    expect(byWorker.items).toHaveLength(1);
    const byOwner = (await (await app.request(`${base()}/proposals?status=pending`, { headers: farm.headers })).json()) as { items: Proposal[]; pending: number };
    expect(byOwner.pending).toBe(2);
    expect(byOwner.items).toHaveLength(2);
    expect((await app.request(`${base()}/proposals?status=nope`, { headers: farm.headers })).status).toBe(400);
    const other = byOwner.items.find((x) => x.channel === "web")!;
    expect((await app.request(`${base()}/proposals/${other.id}`, { headers: asKey(writeKey) })).status).toBe(404);
  });

  it("expiration à 90 jours sans suite, puis effacement 90 jours après", async () => {
    const p = (await (await propose(asKey(writeKey), spraying(1))).json()) as Proposal;
    await sql`UPDATE external_proposals SET created_at = now() - interval '91 days' WHERE id = ${p.id}`;
    expect((await expireProposals(db())).expired).toBeGreaterThanOrEqual(1);
    expect((await sql`SELECT status FROM external_proposals WHERE id = ${p.id}`)[0]!.status).toBe("expired");
    await sql`UPDATE external_proposals SET decided_at = now() - interval '91 days' WHERE id = ${p.id}`;
    await expireProposals(db());
    expect(await sql`SELECT 1 FROM external_proposals WHERE id = ${p.id}`).toHaveLength(0);
    // Les acceptées restent, liées à leur intervention.
    expect((await sql`SELECT count(*)::int AS n FROM external_proposals WHERE farm_id = ${farm.farmId} AND status = 'accepted'`)[0]!.n).toBe(2);
  });
});
