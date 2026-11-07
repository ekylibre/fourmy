import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withFarm, type Tx } from "@fourmy/db";
import { requireOwner, type Env, type Role } from "../context.js";
import { db } from "../db.js";
import { BadRequest, Conflict, NotFound, problem, uuidParam } from "./helpers.js";

const role = z.enum(["owner", "worker"]);
const memberAdd = z.object({ email: z.string().trim().toLowerCase().email(), role });
const memberPatch = z.object({ role });

type Member = { userId: string; email: string; name: string | null; role: Role; personId: string | null };

const list = (tx: Tx) =>
  tx.execute(sql`
    SELECT m.user_id AS "userId", u.email, u.name, m.role, p.id AS "personId"
    FROM memberships m JOIN users u ON u.id = m.user_id
    LEFT JOIN people p ON p.user_id = m.user_id
    ORDER BY m.role, u.email`) as unknown as Promise<Member[]>;

/** Refuse de laisser une ferme sans responsable. */
async function assertAnotherOwner(tx: Tx, userId: string) {
  const [r] = (await tx.execute(sql`
    SELECT count(*)::int AS n FROM memberships WHERE role = 'owner' AND user_id <> ${userId}`)) as unknown as { n: number }[];
  if (!r || r.n === 0) throw new Conflict("La ferme doit garder au moins un responsable (owner).");
}

/**
 * Membres de la ferme (comptes ayant accès). Gérés par le responsable : il
 * ajoute un compte existant par son e-mail (créé par l'administrateur),
 * change son rôle, le retire. La personne (intervenant) se rattache au compte
 * par PATCH /people/:id { userId }.
 */
export const memberRoutes = new Hono<Env>()
  .get("/members", requireOwner, async (c) => c.json({ items: await withFarm(db(), c.get("farmId"), list), nextCursor: null }))
  .post("/members", requireOwner, async (c) => {
    const parsed = memberAdd.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const { email, role: r } = parsed.data;
    const farmId = c.get("farmId");
    const items = await withFarm(db(), farmId, async (tx) => {
      const [user] = (await tx.execute(sql`SELECT id FROM users WHERE email = ${email}`)) as unknown as { id: string }[];
      // Même message que le compte existe ou non dans une autre ferme : pas d'énumération utile.
      if (!user) throw new NotFound(`Aucun compte pour ${email} : à créer par l'administrateur.`);
      const added = (await tx.execute(sql`
        INSERT INTO memberships (id, farm_id, user_id, role) VALUES (gen_random_uuid(), ${farmId}, ${user.id}, ${r})
        ON CONFLICT (farm_id, user_id) DO NOTHING RETURNING id`)) as unknown as unknown[];
      if (added.length === 0) throw new Conflict(`${email} est déjà membre de la ferme.`);
      return list(tx);
    });
    return c.json({ items, nextCursor: null }, 201);
  })
  .patch("/members/:userId", requireOwner, async (c) => {
    const parsed = memberPatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const userId = uuidParam(c, "userId");
    const items = await withFarm(db(), c.get("farmId"), async (tx) => {
      if (parsed.data.role === "worker") await assertAnotherOwner(tx, userId);
      const updated = (await tx.execute(sql`
        UPDATE memberships SET role = ${parsed.data.role} WHERE user_id = ${userId} RETURNING id`)) as unknown as unknown[];
      if (updated.length === 0) throw new NotFound("Membre introuvable.");
      return list(tx);
    });
    return c.json({ items, nextCursor: null });
  })
  .delete("/members/:userId", requireOwner, async (c) => {
    const userId = uuidParam(c, "userId");
    const items = await withFarm(db(), c.get("farmId"), async (tx) => {
      await assertAnotherOwner(tx, userId);
      const removed = (await tx.execute(sql`DELETE FROM memberships WHERE user_id = ${userId} RETURNING id`)) as unknown as unknown[];
      if (removed.length === 0) throw new NotFound("Membre introuvable.");
      // La personne reste (historique des interventions) mais n'est plus rattachée au compte.
      await tx.execute(sql`UPDATE people SET user_id = NULL, updated_at = now() WHERE user_id = ${userId}`);
      return list(tx);
    });
    return c.json({ items, nextCursor: null });
  });

/** Un compte rattaché à une personne doit être membre de la ferme. */
export async function assertMember(tx: Tx, userId: string) {
  const [m] = (await tx.execute(sql`SELECT 1 FROM memberships WHERE user_id = ${userId}`)) as unknown as unknown[];
  if (!m) throw new BadRequest("Ce compte n'est pas membre de la ferme.");
}
