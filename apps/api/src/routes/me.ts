import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { analyzeFile, IMPORT_FORMATS, MAX_FILE_BYTES } from "@fourmy/importers";
import { accessGrant } from "@fourmy/contracts";
import { memberGrant } from "@fourmy/domain";
import type { Env, Role } from "../context.js";
import { db } from "../db.js";
import { createFarm, NoFarmQuota } from "../repos/farms.js";
import { BadRequest, problem } from "./helpers.js";
import { SireneError, sireneAvailable, sireneSearch } from "../sirene.js";

const farmCreate = z
  .object({
    name: z.string().trim().min(1).max(120),
    legalName: z.string().trim().max(200).nullish(),
    siret: z.string().regex(/^\d{14}$/, "SIRET : 14 chiffres").nullish(),
    pacage: z.string().regex(/^\d{9}$/, "PACAGE : 9 chiffres").nullish(),
    address: z
      .object({
        line1: z.string().trim().max(200).nullish(),
        line2: z.string().trim().max(200).nullish(),
        postalCode: z.string().regex(/^\d{5}$/, "Code postal : 5 chiffres").nullish(),
        city: z.string().trim().max(120).nullish(),
      })
      .nullish(),
  })
  .strict();

/**
 * Routes de l'utilisateur courant (hors ferme) : ses fermes et son rôle,
 * et, pour un compte « à embarquer » (quota de création), la création de sa
 * ferme et la lecture de l'identité d'un fichier (assistant, lot IM6).
 */
export const meRoutes = new Hono<Env>()
  .get("/farms", async (c) => {
    const { items, quota } = await db().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
      const rows = (await tx.execute(sql`SELECT farm_id AS id, name, role, onboarding, access_grant FROM fourmy_user_farms(${c.get("userId")})`)) as unknown as {
        id: string;
        name: string;
        role: Role;
        onboarding: { step?: string; completedAt?: string | null } | null;
        access_grant: unknown;
      }[];
      // Droits effectifs (lot AM3) : le web masque ce qu'ils n'ouvrent pas.
      const items = rows.map(({ access_grant, ...f }) => {
        const stored = f.role === "guest" ? accessGrant.safeParse(access_grant) : null;
        return { ...f, grant: memberGrant(f.role, stored?.success ? stored.data : null) };
      });
      const [u] = (await tx.execute(sql`SELECT farm_creation_quota AS quota FROM users WHERE id = ${c.get("userId")}`)) as unknown as { quota: number }[];
      return { items, quota: u?.quota ?? 0 };
    });
    return c.json({ userId: c.get("userId"), user: c.get("user"), canCreateFarm: quota > 0, items });
  })
  // Création de sa ferme (assistant, étape 1) : réservée aux comptes qui en ont le droit.
  .post("/farms", async (c) => {
    const parsed = farmCreate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    try {
      return c.json(await createFarm(db(), c.get("userId"), parsed.data), 201);
    } catch (e) {
      if (e instanceof NoFarmQuota) return problem(c, 403, "Création de ferme non autorisée", e.message);
      throw e;
    }
  })
  // Recherche Sirene (nom, SIREN ou SIRET) pour pré-remplir l'identité de la ferme ; clé du serveur.
  .get("/sirene/search", async (c) => {
    if (!sireneAvailable()) return problem(c, 503, "Recherche Sirene indisponible", "La recherche Sirene n'est pas configurée sur ce serveur.");
    try {
      return c.json({ items: await sireneSearch(c.req.query("q") ?? "", c.req.query("postalCode")) });
    } catch (e) {
      if (!(e instanceof SireneError)) throw e;
      const status = e.code === "invalid" ? 422 : e.code === "not_found" ? 404 : e.code === "busy" ? 429 : 503;
      if (e.code === "not_found") return c.json({ items: [] });
      return problem(c, status, "Recherche Sirene", e.message);
    }
  })
  // Identité lue dans un fichier (SIRET, PACAGE, nom, adresse) pour pré-remplir l'étape 1 : rien n'est gardé.
  .post(
    "/onboarding/identity",
    bodyLimit({ maxSize: MAX_FILE_BYTES + 64 * 1024, onError: (c) => problem(c, 413, "Fichier trop volumineux", "50 Mo au plus.") }),
    async (c) => {
      const body = await c.req.parseBody().catch(() => null);
      const file = body?.file;
      if (!(file instanceof File)) throw new BadRequest("Fichier « file » attendu (multipart/form-data).");
      const { format, bundle } = analyzeFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!IMPORT_FORMATS.includes(format)) throw new BadRequest("Format non reconnu.");
      return c.json({ format, identity: bundle?.farm ?? null, campaigns: bundle?.campaigns ?? [] });
    },
  );
