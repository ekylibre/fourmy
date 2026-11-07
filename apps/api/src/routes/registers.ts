import { Hono } from "hono";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { phytoRegister, phytoRegisterCsv } from "../repos/registers.js";
import { BadRequest, problem } from "./helpers.js";

/** Registre phytosanitaire d'une campagne (FR-REG-1) : JSON ou CSV. */
export const registerRoutes = new Hono<Env>().get("/registers/phyto", async (c) => {
  const year = Number(c.req.query("campaign"));
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new BadRequest("campaign : année de campagne attendue (ex. 2025)");
  }
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
});
