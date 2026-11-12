import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Équipe et personnes, lot P1 (docs/equipe-personnes-design.md) : tout membre
 * a une personne ; données personnelles au responsable et à la personne
 * seulement, y compris en appelant l'API ; rôle Lecture seule ; photo ; compte.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (ch) => ch.charCodeAt(0),
);

describe.skipIf(!url)("personnes (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let worker: { userId: string; headers: Record<string, string> };
  let reader: { userId: string; headers: Record<string, string> };
  const base = () => `/api/v1/farms/${farmId}`;
  type Card = { id: string; name: string; userId: string | null; account: { status: string; role: string | null }; certiphyto: { status: string } };
  const list = async (headers: Record<string, string>) => ((await (await app.request(`${base()}/people?at=2026-10-05`, { headers })).json()) as { items: Card[] }).items;
  const sheet = async (id: string, headers: Record<string, string>) => (await app.request(`${base()}/people/${id}?at=2026-10-05`, { headers })).json() as Promise<Record<string, unknown>>;
  const personOf = async (userId: string) => (await list(owner.headers)).find((p) => p.userId === userId)!;

  beforeAll(async () => {
    ({ farmId, ...owner } = await setupFarm(sql, "Ferme équipe"));
    worker = await addMember(sql, farmId, "worker");
    reader = await addMember(sql, farmId, "reader");
  });
  afterAll(async () => {
    await teardown(sql, farmId, [owner.userId, worker.userId, reader.userId]);
    await sql.end();
  });

  it("tout membre a une personne, avec son rôle ; une personne sans compte s'ajoute", async () => {
    const res = await app.request(`${base()}/people`, {
      method: "POST",
      headers: owner.headers,
      body: JSON.stringify({
        firstName: "Camille",
        lastName: "Durand",
        certiphyto: { category: "operateur", number: "OP-12", validUntil: "2026-12-01" },
        private: { email: "camille@exemple.fr", mobile: "06 12 34 56 78", address: { line1: "1 rue du Moulin", postalCode: "64000", city: "Pau", country: "FR" }, birthDate: "1990-04-02", contract: { type: "seasonal", startedOn: "2026-04-01" } },
      }),
    });
    expect(res.status).toBe(201);
    const items = await list(owner.headers);
    expect(items).toHaveLength(4);
    expect(items.filter((p) => p.account.status === "active").map((p) => p.account.role).sort()).toEqual(["owner", "reader", "worker"]);
    const camille = items.find((p) => p.name === "Camille Durand")!;
    expect(camille).toMatchObject({ account: { status: "none", role: null }, certiphyto: { status: "expiring" } });
    // Relire ne crée pas de doublon.
    expect(await list(worker.headers)).toHaveLength(4);
  });

  it("données personnelles : au responsable seulement, jamais à un collègue ni à un lecteur", async () => {
    const camille = (await list(owner.headers)).find((p) => p.name === "Camille Durand")!;
    const forOwner = await sheet(camille.id, owner.headers);
    expect(forOwner.private).toMatchObject({ email: "camille@exemple.fr", mobile: "06 12 34 56 78", address: { city: "Pau" }, birthDate: "1990-04-02", contract: { type: "seasonal" } });
    for (const h of [worker.headers, reader.headers]) {
      const s = await sheet(camille.id, h);
      expect(s).not.toHaveProperty("private");
      expect(JSON.stringify(s)).not.toContain("camille@exemple.fr");
      expect(s.certiphyto).toMatchObject({ number: "OP-12" }); // le Certiphyto reste visible
    }
    // La grille n'en porte jamais.
    expect(JSON.stringify(await list(owner.headers))).not.toContain("camille@exemple.fr");
    // Un salarié ne modifie pas la fiche d'un autre (introuvable pour lui).
    const res = await app.request(`${base()}/people/${camille.id}`, { method: "PATCH", headers: worker.headers, body: JSON.stringify({ private: { mobile: "0700000000" } }) });
    expect(res.status).toBe(404);
  });

  it("chacun lit et modifie ses coordonnées, pas son contrat ni son identité", async () => {
    const me = await personOf(worker.userId);
    const patch = (body: unknown) => app.request(`${base()}/people/${me.id}`, { method: "PATCH", headers: worker.headers, body: JSON.stringify(body) });
    const ok = await patch({ private: { email: "moi@exemple.fr", address: { city: "Orthez" } } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { private: { email: string; address: { city: string } } }).private).toMatchObject({ email: "moi@exemple.fr", address: { city: "Orthez" } });
    expect((await patch({ private: { contract: { type: "permanent" } } })).status).toBe(400);
    expect((await patch({ firstName: "Autre" })).status).toBe(400);
    // Une modification partielle garde le reste.
    await patch({ private: { mobile: "+33 6 00 00 00 00" } });
    expect(((await sheet(me.id, worker.headers)).private as { email: string }).email).toBe("moi@exemple.fr");
  });

  it("lecture seule : aucune écriture, sauf sur sa propre fiche", async () => {
    expect((await app.request(`${base()}/people`, { method: "POST", headers: reader.headers, body: JSON.stringify({ name: "X" }) })).status).toBe(403);
    expect((await app.request(`${base()}/interventions`, { method: "POST", headers: reader.headers, body: "{}" })).status).toBe(403);
    expect((await app.request(`${base()}/snapshot`, { headers: reader.headers })).status).toBe(200);
    const me = await personOf(reader.userId);
    const own = await app.request(`${base()}/people/${me.id}`, { method: "PATCH", headers: reader.headers, body: JSON.stringify({ private: { mobile: "0611223344" } }) });
    expect(own.status).toBe(200);
  });

  it("ma fiche et mes heures (application mobile) : GET /people/me, coordonnées comprises", async () => {
    const res = await app.request(`${base()}/people/me?at=2026-10-05`, { headers: worker.headers });
    expect(res.status).toBe(200);
    const me = (await res.json()) as { sheet: { userId: string; private?: { email: string } }; work: { periods: { month: { hours: number } } } };
    expect(me.sheet.userId).toBe(worker.userId);
    expect(me.sheet.private?.email).toBe("moi@exemple.fr");
    expect(me.work.periods.month.hours).toBe(0);
  });

  it("photo : PNG ou JPEG, visible de tous, avec ETag ; changée par la personne elle-même", async () => {
    const me = await personOf(worker.userId);
    const put = (body: BodyInit, headers = worker.headers) =>
      app.request(`${base()}/people/${me.id}/photo`, { method: "PUT", headers: { ...headers, "content-type": "image/png" }, body });
    expect((await put(new TextEncoder().encode("pas une image"))).status).toBe(400);
    expect((await put(PNG)).status).toBe(204);
    const got = await app.request(`${base()}/people/${me.id}/photo`, { headers: reader.headers });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    const etag = got.headers.get("etag")!;
    expect((await app.request(`${base()}/people/${me.id}/photo`, { headers: { ...reader.headers, "if-none-match": etag } })).status).toBe(304);
    expect((await personOf(worker.userId)) as unknown as { photo: unknown }).toMatchObject({ photo: { hash: etag.replaceAll('"', "") } });
    // Pas la photo d'un autre.
    const ownerPerson = await personOf(owner.userId);
    expect((await app.request(`${base()}/people/${ownerPerson.id}/photo`, { method: "PUT", headers: { ...worker.headers, "content-type": "image/png" }, body: PNG })).status).toBe(404);
    expect((await app.request(`${base()}/people/${me.id}/photo`, { method: "DELETE", headers: worker.headers })).status).toBe(204);
    expect((await app.request(`${base()}/people/${me.id}/photo`, { headers: reader.headers })).status).toBe(404);
  });

  it("compte : rôle changé, accès retiré ; la personne et son lien d'historique restent", async () => {
    const r = await personOf(reader.userId);
    const patch = (id: string, role: string) => app.request(`${base()}/people/${id}/account`, { method: "PATCH", headers: owner.headers, body: JSON.stringify({ role }) });
    expect((await patch(r.id, "worker")).status).toBe(204);
    expect((await personOf(reader.userId)).account.role).toBe("worker");
    expect((await patch((await personOf(owner.userId)).id, "reader")).status).toBe(409); // dernier responsable
    expect((await app.request(`${base()}/people/${r.id}/account`, { method: "DELETE", headers: owner.headers })).status).toBe(204);
    const after = (await list(owner.headers)).find((p) => p.id === r.id)!;
    expect(after).toMatchObject({ userId: null, account: { status: "none" } });
    expect((await app.request(`${base()}/snapshot`, { headers: reader.headers })).status).toBe(403);
  });
});
