import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "../auth.js";
import { db } from "../db.js";
import { acceptInvitation, readInvitation } from "../repos/invitations.js";
import { problem } from "./helpers.js";

const accept = z.object({ password: z.string().min(10).max(200).optional(), name: z.string().trim().max(120).optional() });

/**
 * Invitations, hors ferme (docs/equipe-personnes-design.md §4.3) : la page
 * publique lit l'invitation par son jeton ; l'acceptation crée le compte, ou
 * relie celui de la session s'il a le même email.
 */
export const invitationRoutes = new Hono()
  .get("/:token", async (c) => c.json(await readInvitation(db(), c.req.param("token"))))
  .post("/:token/accept", async (c) => {
    const parsed = accept.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return problem(c as never, 400, "Corps invalide", "Mot de passe de 10 caractères au moins.");
    const h = c.req.raw.headers;
    const session = h.get("cookie") || h.get("authorization") ? await getAuth().api.getSession({ headers: h }) : null;
    const sessionUser = session ? { id: session.user.id, email: session.user.email } : null;
    return c.json(await acceptInvitation(db(), c.req.param("token"), { sessionUser, ...parsed.data }));
  });
