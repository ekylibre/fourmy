import { Hono } from "hono";
import { z } from "zod";
import { personAccountWrite, personInvite, personProfileWrite, uuid } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { createPerson, erasePerson, getPhoto, personOfUser, listPeople, personSheet, removeAccount, setAccountRole, setPhoto, updatePerson, PHOTO_MAX_BYTES, type Viewer } from "../repos/people.js";
import { BadRequest, domainCtx, problem, uuidParam } from "./helpers.js";
import { personInterventions, personWork } from "../repos/people-work.js";
import { invitePerson, revokeInvitation } from "../repos/invitations.js";
import { appMailer } from "../mail.js";

/** Date de la frise (AAAA-MM-JJ), aujourd'hui par défaut. */
const atDay = (v: string | undefined) => {
  const d = (v ?? new Date().toISOString()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequest("at : date AAAA-MM-JJ");
  return d;
};

/** Création : le profil, et l'ancien format (`name`, `role`, `userId`) des premiers clients. */
const personCreate = personProfileWrite.extend({ id: uuid.optional(), role: z.string().trim().max(100).optional(), userId: uuid.optional() });

/**
 * Personnes de la ferme (docs/equipe-personnes-design.md §4) : la grille et
 * les fiches pour tous les membres ; les données personnelles pour le
 * responsable et la personne elle-même ; l'écriture au responsable, sauf
 * ses propres coordonnées et sa photo.
 */
export const peopleRoutes = new Hono<Env>()
  .get("/people", async (c) => c.json({ items: await listPeople(db(), c.get("farmId"), atDay(c.req.query("at"))), nextCursor: null }))
  // Ma fiche et mes heures (lot P5, application mobile) : la personne du compte connecté.
  .get("/people/me", async (c) => {
    const day = atDay(c.req.query("at"));
    const id = await personOfUser(db(), c.get("farmId"), c.get("userId"));
    const viewer: Viewer = { userId: c.get("userId"), role: c.get("role") };
    const [sheet, work] = await Promise.all([personSheet(db(), c.get("farmId"), id, day, viewer), personWork(db(), c.get("farmId"), id, day)]);
    return c.json({ sheet, work });
  })
  .get("/people/:id", async (c) => {
    const viewer: Viewer = { userId: c.get("userId"), role: c.get("role") };
    return c.json(await personSheet(db(), c.get("farmId"), uuidParam(c, "id"), atDay(c.req.query("at")), viewer));
  })
  .post("/people", requireOwner, async (c) => {
    const parsed = personCreate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await createPerson(db(), c.get("farmId"), domainCtx(c), parsed.data), 201);
  })
  .patch("/people/:id", async (c) => {
    const parsed = personProfileWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const id = uuidParam(c, "id");
    const viewer: Viewer = { userId: c.get("userId"), role: c.get("role") };
    await updatePerson(db(), c.get("farmId"), domainCtx(c), id, viewer, parsed.data);
    return c.json(await personSheet(db(), c.get("farmId"), id, atDay(undefined), viewer));
  })
  // Temps de travaux (lot P2) : visibles de tous les membres.
  .get("/people/:id/work", async (c) => c.json(await personWork(db(), c.get("farmId"), uuidParam(c, "id"), atDay(c.req.query("at")))))
  .get("/people/:id/interventions", async (c) => {
    const day = (k: string) => {
      const v = c.req.query(k);
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequest(`${k} : date AAAA-MM-JJ`);
      return v;
    };
    const fromDay = day("from");
    const toDay = day("to");
    if (toDay <= fromDay) throw new BadRequest("from < to");
    const offset = Number(c.req.query("cursor") ?? 0);
    const limit = Number(c.req.query("limit") ?? 20);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequest("cursor, limit : entiers (limit ≤ 100)");
    return c.json(await personInterventions(db(), c.get("farmId"), uuidParam(c, "id"), { fromDay, toDay, offset, limit }));
  })
  // Photo : visible de tous les membres (pavés), modifiable par le responsable ou la personne.
  .get("/people/:id/photo", async (c) => {
    const photo = await getPhoto(db(), c.get("farmId"), uuidParam(c, "id"));
    if (!photo) return problem(c, 404, "Pas de photo");
    const headers = { etag: photo.etag, "cache-control": "private, max-age=0, must-revalidate" };
    if (c.req.header("if-none-match") === photo.etag) return c.body(null, 304, headers);
    return c.body(photo.bytes, 200, { ...headers, "content-type": photo.mediaType });
  })
  .put("/people/:id/photo", async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw new BadRequest("Photo vide.");
    if (bytes.length > PHOTO_MAX_BYTES) throw new BadRequest("Photo trop lourde (2 Mo au plus).");
    await setPhoto(db(), c.get("farmId"), uuidParam(c, "id"), { userId: c.get("userId"), role: c.get("role") }, bytes);
    return c.body(null, 204);
  })
  .delete("/people/:id/photo", async (c) => {
    await setPhoto(db(), c.get("farmId"), uuidParam(c, "id"), { userId: c.get("userId"), role: c.get("role") }, null);
    return c.body(null, 204);
  })
  // Invitation à avoir un compte (lot P3) : email si SMTP, sinon lien à transmettre.
  .post("/people/:id/invitations", requireOwner, async (c) => {
    const parsed = personInvite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message ?? parsed.error.message);
    const appUrl = process.env.BETTER_AUTH_URL ?? new URL(c.req.url).origin;
    const r = await invitePerson(db(), c.get("farmId"), uuidParam(c, "id"), { ...parsed.data, invitedBy: c.get("userId"), appUrl, mailer: appMailer() });
    return c.json(r, 201);
  })
  .delete("/people/:id/invitations", requireOwner, async (c) => {
    await revokeInvitation(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  })
  // Effacement : supprimée sans historique, anonymisée sinon (design §4.4).
  .delete("/people/:id", requireOwner, async (c) => {
    const result = await erasePerson(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"));
    return c.json({ result });
  })
  // Compte de la personne : rôle, retrait de l'accès (la personne reste).
  .patch("/people/:id/account", requireOwner, async (c) => {
    const parsed = personAccountWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message ?? parsed.error.message);
    await setAccountRole(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data.role, parsed.data.grant);
    return c.body(null, 204);
  })
  .delete("/people/:id/account", requireOwner, async (c) => {
    await removeAccount(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  });
