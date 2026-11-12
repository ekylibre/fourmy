import { Hono } from "hono";
import { z } from "zod";
import { memberRole, personProfileWrite, uuid } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { createPerson, getPhoto, listPeople, personSheet, removeAccount, setAccountRole, setPhoto, updatePerson, PHOTO_MAX_BYTES, type Viewer } from "../repos/people.js";
import { BadRequest, domainCtx, problem, uuidParam } from "./helpers.js";

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
  // Compte de la personne : rôle, retrait de l'accès (la personne reste).
  .patch("/people/:id/account", requireOwner, async (c) => {
    const parsed = z.object({ role: memberRole }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    await setAccountRole(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data.role);
    return c.body(null, 204);
  })
  .delete("/people/:id/account", requireOwner, async (c) => {
    await removeAccount(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  });
