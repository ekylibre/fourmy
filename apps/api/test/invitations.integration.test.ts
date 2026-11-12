import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Transporter } from "nodemailer";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { invitePerson } from "../src/repos/invitations.js";
import { addMember, setupFarm, signIn, teardown } from "./helpers.js";

/**
 * Invitations et effacement, lot P3 (docs/equipe-personnes-design.md §4.3,
 * §4.4) : lien ou email, acceptation qui crée le compte ou relie celui de la
 * session, usage unique, révocation, expiration ; suppression ou
 * anonymisation d'une personne.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const PASSWORD = "mot-de-passe-solide";

describe.skipIf(!url)("invitations (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let other: { userId: string; email: string; headers: Record<string, string> };
  const created: string[] = [];
  const base = () => `/api/v1/farms/${farmId}`;
  const json = { "content-type": "application/json" };
  const newPerson = async (body: unknown) =>
    ((await (await app.request(`${base()}/people`, { method: "POST", headers: owner.headers, body: JSON.stringify(body) })).json()) as { id: string }).id;
  const invite = (id: string, body: unknown) => app.request(`${base()}/people/${id}/invitations`, { method: "POST", headers: owner.headers, body: JSON.stringify(body) });
  const tokenOf = (link: string) => link.split("/invitation/")[1]!;
  const pub = (token: string) => app.request(`/api/v1/invitations/${token}`);
  const accept = (token: string, body: unknown, headers: Record<string, string> = json) =>
    app.request(`/api/v1/invitations/${token}/accept`, { method: "POST", headers, body: JSON.stringify(body) });

  beforeAll(async () => {
    ({ farmId, ...owner } = await setupFarm(sql, "Ferme invitations"));
    // Un compte existant, membre d'une autre ferme : il sera invité ici.
    const elsewhere = await setupFarm(sql, "Ferme voisine (invitations)");
    other = elsewhere;
    created.push(elsewhere.farmId);
  });
  afterAll(async () => {
    const users = (await sql<{ user_id: string }[]>`SELECT user_id FROM memberships WHERE farm_id = ${farmId}`).map((r) => r.user_id);
    await teardown(sql, farmId, [...new Set([...users, owner.userId, other.userId])]);
    for (const f of created) await sql`DELETE FROM farms WHERE id = ${f}`;
    await sql.end();
  });

  it("sans SMTP : lien à transmettre ; la fiche montre l'invitation au responsable", async () => {
    const id = await newPerson({ firstName: "Léa", lastName: "Bernard" });
    expect((await invite(id, { role: "worker" })).status).toBe(400); // pas d'email
    const res = await invite(id, { email: `lea-${crypto.randomUUID()}@test.fourmy`, role: "worker" });
    expect(res.status).toBe(201);
    const r = await res.json();
    expect(r).toMatchObject({ status: "link", sentByEmail: false });
    expect(r.link).toMatch(/\/invitation\/[A-Za-z0-9_-]{43}$/);
    const sheet = await (await app.request(`${base()}/people/${id}`, { headers: owner.headers })).json();
    expect(sheet).toMatchObject({ account: { status: "invited" }, invitation: { role: "worker", sentByEmail: false } });
    // Le jeton n'est jamais stocké.
    const [row] = await sql`SELECT token_hash FROM person_invitations WHERE person_id = ${id}`;
    expect(row!.token_hash).not.toBe(tokenOf(r.link));
  });

  it("acceptation : compte créé, même personne, accès avec le rôle ; lien à usage unique", async () => {
    const email = `camille-${crypto.randomUUID()}@test.fourmy`;
    const id = await newPerson({ firstName: "Camille", lastName: "Durand", private: { email } });
    const r = await (await invite(id, { role: "reader" })).json();
    const token = tokenOf(r.link);
    expect(await (await pub(token)).json()).toMatchObject({ farmName: "Ferme invitations", firstName: "Camille", email, role: "reader", status: "open", accountExists: false });
    expect((await accept(token, { password: "court" })).status).toBe(400);
    const ok = await accept(token, { password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ farmId, created: true });
    const [p] = await sql<{ user_id: string }[]>`SELECT user_id FROM people WHERE id = ${id}`;
    const [m] = await sql<{ role: string }[]>`SELECT role FROM memberships WHERE farm_id = ${farmId} AND user_id = ${p!.user_id}`;
    expect(m!.role).toBe("reader");
    expect((await pub(token)).status).toBe(200);
    expect((await (await pub(token)).json()).status).toBe("accepted");
    expect((await accept(token, { password: PASSWORD })).status).toBe(409);
    // Le nouveau compte se connecte et voit la ferme.
    const bearer = await signIn(email, PASSWORD);
    const me = await (await app.request("/api/v1/me/farms", { headers: { authorization: `Bearer ${bearer}` } })).json();
    expect(me.items.map((f: { id: string }) => f.id)).toContain(farmId);
  });

  it("compte existant : connexion exigée, avec le même email ; son mot de passe n'est jamais remplacé", async () => {
    const id = await newPerson({ name: "Voisin" });
    const token = tokenOf((await (await invite(id, { email: other.email, role: "worker" })).json()).link);
    expect((await (await pub(token)).json()).accountExists).toBe(true);
    expect((await accept(token, { password: "un-autre-mot-de-passe" })).status).toBe(409);
    const stranger = await addMember(sql, farmId, "worker");
    expect((await accept(token, {}, stranger.headers)).status).toBe(409); // autre email
    const ok = await accept(token, {}, other.headers);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ created: false });
    const [p] = await sql<{ user_id: string }[]>`SELECT user_id FROM people WHERE id = ${id}`;
    expect(p!.user_id).toBe(other.userId);
  });

  it("révocation, expiration, jeton inconnu", async () => {
    const id = await newPerson({ name: "Saisonnier" });
    const first = tokenOf((await (await invite(id, { email: `s-${crypto.randomUUID()}@test.fourmy`, role: "worker" })).json()).link);
    // Une nouvelle invitation révoque la précédente.
    const second = tokenOf((await (await invite(id, { email: `s-${crypto.randomUUID()}@test.fourmy`, role: "worker" })).json()).link);
    expect((await (await pub(first)).json()).status).toBe("revoked");
    await sql`UPDATE person_invitations SET expires_at = now() - interval '1 minute' WHERE person_id = ${id} AND revoked_at IS NULL`;
    expect((await (await pub(second)).json()).status).toBe("expired");
    expect((await accept(second, { password: PASSWORD })).status).toBe(409);
    expect((await pub("x".repeat(43))).status).toBe(404);
    expect((await app.request(`${base()}/people/${id}/invitations`, { method: "DELETE", headers: owner.headers })).status).toBe(404); // plus rien d'ouvert
  });

  it("avec SMTP : email envoyé, pas de lien renvoyé", async () => {
    const id = await newPerson({ name: "Par email" });
    const sent: { to: string; text: string }[] = [];
    const mailer = { sendMail: async (m: { to: string; text: string }) => void sent.push(m) } as unknown as Transporter;
    const r = await invitePerson(db(), farmId, id, { email: "par.email@test.fourmy", role: "worker", invitedBy: owner.userId, appUrl: "https://fourmy.test", mailer });
    expect(r).toMatchObject({ status: "sent", link: null, sentByEmail: true });
    expect(sent[0]!.to).toBe("par.email@test.fourmy");
    expect(sent[0]!.text).toMatch(/https:\/\/fourmy\.test\/invitation\/[A-Za-z0-9_-]{43}/);
  });

  it("effacement : supprimée sans historique, anonymisée avec", async () => {
    const free = await newPerson({ firstName: "Sans", lastName: "Historique", private: { email: "x@exemple.fr" } });
    const del = await app.request(`${base()}/people/${free}`, { method: "DELETE", headers: owner.headers });
    expect(await del.json()).toEqual({ result: "deleted" });
    expect(await sql`SELECT 1 FROM people WHERE id = ${free}`).toHaveLength(0);

    const worked = await newPerson({ firstName: "Avec", lastName: "Historique", private: { email: "y@exemple.fr", mobile: "0600000000" } });
    const iid = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin) VALUES (${iid}, ${farmId}, 'plowing', 'done', 'web')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${iid}, 'doer', 'person', ${worked})`;
    const anon = await app.request(`${base()}/people/${worked}`, { method: "DELETE", headers: owner.headers });
    expect(await anon.json()).toEqual({ result: "anonymized" });
    const [p] = await sql`SELECT name, first_name, last_name, active FROM people WHERE id = ${worked}`;
    expect(p).toMatchObject({ first_name: null, last_name: null, active: false });
    expect(p!.name).toMatch(/^Personne anonymisée \d+$/);
    expect(await sql`SELECT 1 FROM person_private WHERE person_id = ${worked}`).toHaveLength(0);
    // Le dernier responsable ne s'efface pas.
    const me = (await (await app.request(`${base()}/people`, { headers: owner.headers })).json()).items.find((x: { userId: string }) => x.userId === owner.userId);
    expect((await app.request(`${base()}/people/${me.id}`, { method: "DELETE", headers: owner.headers })).status).toBe(409);
  });
});
