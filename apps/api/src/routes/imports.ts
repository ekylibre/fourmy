import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { importDecisions } from "@fourmy/contracts";
import { MAX_FILE_BYTES } from "@fourmy/importers";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { startImport, ImportsNotConfigured } from "../repos/imports.js";
import { analyzeUpload, applyRun, discardRun, getRun, listRuns, saveDecisions } from "../repos/file-imports.js";
import { revertRun } from "../repos/import-revert.js";
import { EKYLIBRE_MAX_BYTES, EKYLIBRE_SOURCE_PREFIX, EkylibreUploadsNotConfigured, queueEkylibreMigration, receiveEkylibreBackup, TooLarge } from "../repos/ekylibre-uploads.js";
import { BadRequest, problem, uuidParam } from "./helpers.js";

const importWrite = z.object({ sourceDatabase: z.string() });

/** Tâches d'import suivies (pour les tests : attendre la fin d'un import). */
export const pendingImports = new Set<Promise<unknown>>();

/**
 * Imports : reprise Ekylibre (owner, asynchrone) et imports de fichiers
 * DAPLOS, Geofolia, TelePAC (owner ; claudedocs/conception_import_onboarding.md §7.1).
 * Le suivi se lit par tous les membres.
 */
export const importRoutes = new Hono<Env>()
  .post("/imports/ekylibre", requireOwner, async (c) => {
    const parsed = importWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", "sourceDatabase attendu");
    try {
      const run = await startImport(db(), c.get("farmId"), parsed.data, (p) => {
        pendingImports.add(p);
        void p.finally(() => pendingImports.delete(p));
      });
      return c.json(run, 202, { location: `imports/${run.id}` });
    } catch (e) {
      if (e instanceof ImportsNotConfigured) return problem(c, 503, "Service indisponible", e.message);
      throw e;
    }
  })
  .post(
    "/imports/files",
    requireOwner,
    // Fichier de 50 Mo au plus, plus l'enveloppe multipart.
    bodyLimit({ maxSize: MAX_FILE_BYTES + 64 * 1024, onError: (c) => problem(c, 413, "Fichier trop volumineux", "50 Mo au plus.") }),
    async (c) => {
      const body = await c.req.parseBody().catch(() => null);
      const file = body?.file;
      if (!(file instanceof File)) throw new BadRequest("Fichier « file » attendu (multipart/form-data).");
      const { run, created } = await analyzeUpload(db(), c.get("farmId"), c.get("userId"), {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      return c.json(run, created ? 201 : 200, { location: `imports/${run.id}` });
    },
  )
  .get("/imports", async (c) => c.json({ items: await listRuns(db(), c.get("farmId")) }))
  .get("/imports/:id", async (c) => c.json(await getRun(db(), c.get("farmId"), uuidParam(c, "id"))))
  .put("/imports/:id/decisions", requireOwner, async (c) => {
    const parsed = importDecisions.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await saveDecisions(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data));
  })
  // Sauvegarde de tenant Ekylibre (zip jusqu'à 2 Go) : corps brut, nom dans X-File-Name ; restaurée ensuite par le worker.
  .post("/imports/ekylibre/upload", requireOwner, async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > EKYLIBRE_MAX_BYTES) return problem(c, 413, "Sauvegarde trop volumineuse", "2 Go au plus.");
    const name = decodeURIComponent(c.req.header("x-file-name") ?? "sauvegarde.zip");
    try {
      const run = await receiveEkylibreBackup(db(), c.get("farmId"), c.get("userId"), name, c.req.raw.body);
      return c.json(run, 201);
    } catch (e) {
      if (e instanceof TooLarge) return problem(c, 413, "Sauvegarde trop volumineuse", e.message);
      if (e instanceof EkylibreUploadsNotConfigured) return problem(c, 503, "Reprise d'Ekylibre indisponible", e.message);
      throw e;
    }
  })
  .post("/imports/:id/discard", requireOwner, async (c) => c.json(await discardRun(db(), c.get("farmId"), uuidParam(c, "id"))))
  // Annulation d'un import de fichier terminé : ce qu'il a créé et que personne n'a touché depuis.
  .post("/imports/:id/revert", requireOwner, async (c) => {
    const id = uuidParam(c, "id");
    const revert = await revertRun(db(), c.get("farmId"), id);
    return c.json({ run: await getRun(db(), c.get("farmId"), id), revert });
  })
  // Écriture en tâche de fond : 202, puis suivi par GET /imports/:id.
  .post("/imports/:id/apply", requireOwner, async (c) => {
    // Sauvegarde Ekylibre restaurée : la migration est confiée au worker.
    const id = uuidParam(c, "id");
    const current = await getRun(db(), c.get("farmId"), id);
    if (current.source.startsWith(EKYLIBRE_SOURCE_PREFIX)) return c.json(await queueEkylibreMigration(db(), c.get("farmId"), id), 202);
    const run = await applyRun(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), (p) => {
      pendingImports.add(p);
      void p.finally(() => pendingImports.delete(p));
    });
    return c.json(run, 202, { location: `imports/${run.id}` });
  });
