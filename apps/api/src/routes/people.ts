import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import { personWrite, type Person } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { NotFound, domainCtx, problem, uuidParam } from "./helpers.js";
import { assertMember } from "./members.js";

const columns = sql`id, farm_id AS "farmId", name, role, user_id AS "userId", active, created_at AS "createdAt", updated_at AS "updatedAt"`;
const iso = (p: Person) => ({ ...p, createdAt: new Date(p.createdAt).toISOString(), updatedAt: new Date(p.updatedAt).toISOString() });

/** Personnes de la ferme (intervenants). Lecture pour tous, écriture owner. */
export const peopleRoutes = new Hono<Env>()
  .get("/people", async (c) => {
    const items = await withFarm(db(), c.get("farmId"), async (tx) =>
      ((await tx.execute(sql`SELECT ${columns} FROM people ORDER BY active DESC, name`)) as unknown as Person[]).map(iso),
    );
    return c.json({ items, nextCursor: null });
  })
  .post("/people", requireOwner, async (c) => {
    const parsed = personWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const p = parsed.data;
    const id = p.id ?? domainCtx(c).newId();
    const person = await withFarm(db(), c.get("farmId"), async (tx) => {
      if (p.userId) await assertMember(tx, p.userId);
      const [row] = (await tx.execute(sql`
        INSERT INTO people (id, farm_id, name, role, user_id, active)
        VALUES (${id}, ${c.get("farmId")}, ${p.name}, ${p.role ?? null}, ${p.userId ?? null}, ${p.active ?? true})
        ON CONFLICT (id) DO NOTHING
        RETURNING ${columns}`)) as unknown as Person[];
      return row ?? ((await tx.execute(sql`SELECT ${columns} FROM people WHERE id = ${id}`)) as unknown as Person[])[0]!;
    });
    return c.json(iso(person), 201);
  })
  .patch("/people/:id", requireOwner, async (c) => {
    const parsed = personWrite.partial().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const p = parsed.data;
    const id = uuidParam(c, "id");
    const person = await withFarm(db(), c.get("farmId"), async (tx) => {
      if (p.userId) await assertMember(tx, p.userId);
      const [row] = (await tx.execute(sql`
        UPDATE people SET name = coalesce(${p.name ?? null}, name), role = coalesce(${p.role ?? null}, role),
          user_id = coalesce(${p.userId ?? null}, user_id), active = coalesce(${p.active ?? null}, active), updated_at = now()
        WHERE id = ${id} RETURNING ${columns}`)) as unknown as Person[];
      if (!row) throw new NotFound(`Personne ${id} introuvable.`);
      return row;
    });
    return c.json(iso(person));
  });
