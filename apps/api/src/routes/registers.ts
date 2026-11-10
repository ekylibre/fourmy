import { Hono } from "hono";
import { z } from "zod";
import type { BbchStage, FarmIdentity, PhytoCrop } from "@fourmy/contracts";
import { officialRegisterCsv, officialRegisterJsonLine } from "@fourmy/domain";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { officialPhytoRegister, phytoRegister, phytoRegisterCsv } from "../repos/registers.js";
import { BadRequest, problem } from "./helpers.js";

const campaignOf = (raw: string | undefined) => {
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new BadRequest("campaign : année de campagne attendue (ex. 2025)");
  return year;
};

const identity = z.object({
  siret: z.string().trim().regex(/^\d{14}$/, "SIRET : 14 chiffres").nullable(),
  pacage: z.string().trim().regex(/^\d{9}$/, "PACAGE : 9 chiffres").nullable(),
});

/** Registre phytosanitaire d'une campagne (FR-REG-1) : JSON ou CSV ; format réglementaire (lot X). */
export const registerRoutes = new Hono<Env>()
  .get("/registers/phyto", async (c) => {
    const year = campaignOf(c.req.query("campaign"));
    const format = c.req.query("format") ?? "json";
    const entries = await phytoRegister(db(), c.get("farmId"), year);
    if (format === "csv") {
      return c.body(phytoRegisterCsv(entries), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="registre-phyto-${year}.csv"`,
      });
    }
    if (format === "pdf") return problem(c, 501, "Not Implemented", "Export PDF du registre : à venir.");
    return c.json({ campaign: year, items: entries });
  })
  // Format réglementaire (arrêté du 24/12/2025, notice du 22/09/2026) :
  // json (écran, anomalies), csv (intitulés standard), export (JSON complet).
  .get("/registers/phyto/official", async (c) => {
    const year = campaignOf(c.req.query("campaign"));
    const register = await officialPhytoRegister(db(), c.get("farmId"), year);
    const format = c.req.query("format") ?? "json";
    if (format === "csv") {
      return c.body(officialRegisterCsv(register.lines), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="registre-phyto-reglementaire-${year}.csv"`,
      });
    }
    if (format === "export") {
      const body = {
        detenteur: { nom: register.holder.name, siret: register.holder.siret, pacage: register.holder.pacage },
        campagne: year,
        genereLe: register.generatedAt,
        traitements: register.lines.map(officialRegisterJsonLine),
      };
      return c.body(JSON.stringify(body, null, 2), 200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="registre-phyto-reglementaire-${year}.json"`,
      });
    }
    return c.json(register);
  })
  // Détenteur du registre : SIRET et PACAGE (lecture membres, écriture responsable).
  .get("/settings/identity", async (c) =>
    c.json(
      await withFarm(db(), c.get("farmId"), async (tx) => {
        const [f] = (await tx.execute(sql`SELECT siret, pacage FROM farms WHERE id = ${c.get("farmId")}`)) as unknown as FarmIdentity[];
        return { siret: f?.siret ?? null, pacage: f?.pacage ?? null } satisfies FarmIdentity;
      }),
    ),
  )
  .put("/settings/identity", requireOwner, async (c) => {
    const parsed = identity.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" ; "));
    const { siret, pacage } = parsed.data;
    await withFarm(db(), c.get("farmId"), (tx) => tx.execute(sql`UPDATE farms SET siret = ${siret || null}, pacage = ${pacage || null}, updated_at = now() WHERE id = ${c.get("farmId")}`));
    return c.json({ siret: siret || null, pacage: pacage || null } satisfies FarmIdentity);
  })
  // Référentiels du ministère : cultures (codes OEPP) et stades BBCH.
  .get("/reference/phyto-crops", async (c) =>
    c.json({
      items: await withFarm(db(), c.get("farmId"), async (tx) =>
        ((await tx.execute(sql`SELECT code, label, oepp, bbch_ref FROM ref_phyto_crops ORDER BY label`)) as unknown as {
          code: string;
          label: string;
          oepp: string | null;
          bbch_ref: string | null;
        }[]).map((r): PhytoCrop => ({ code: r.code, label: r.label.trim(), oepp: r.oepp, bbchRef: r.bbch_ref })),
      ),
    }),
  )
  .get("/reference/bbch", async (c) => {
    const crop = c.req.query("crop");
    if (!crop) throw new BadRequest("crop : code culture attendu");
    return c.json({
      items: await withFarm(db(), c.get("farmId"), async (tx) =>
        (await tx.execute(sql`SELECT s.code, s.label, s.description FROM ref_bbch_stages s
            JOIN ref_phyto_crops c ON c.bbch_ref = s.bbch_ref WHERE c.code = ${crop} ORDER BY s.code`)) as unknown as BbchStage[],
      ),
    });
  });
