import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import { SATELLITE_IMAGE_KINDS, type SatelliteImageKind } from "@fourmy/contracts";
import { addDays, dayNumber } from "@fourmy/domain";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { syncIntegration } from "../integrations/repo.js";
import { isVegetationIndex, listScenes, parcelIndicesAt, parcelSeries, remoteSensingStatus, sceneImage } from "../repos/remote-sensing.js";
import { pendingSyncs } from "./integrations.js";
import { BadRequest, NotFound, uuidParam } from "./helpers.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

function day(value: string | undefined, label: string, fallback?: string): string {
  const v = value ?? fallback;
  if (!v || !DAY.test(v) || Number.isNaN(Date.parse(v))) throw new BadRequest(`${label} : date AAAA-MM-JJ attendue.`);
  return v;
}

function index(value: string | undefined) {
  const v = value ?? "ndvi";
  if (!isVegetationIndex(v)) throw new BadRequest("Indice inconnu (ndvi, ndre ou ndmi).");
  return v;
}

/**
 * Télédétection (docs/teledetection-design.md §7) : lectures pour la frise,
 * la carte, le plan 3D et la fiche parcelle. Le navigateur ne parle jamais à
 * Copernicus ; les images sont servies depuis la base.
 */
export const remoteSensingRoutes = new Hono<Env>()
  .get("/remote-sensing/status", async (c) => c.json(await remoteSensingStatus(db(), c.get("farmId"))))
  .get("/remote-sensing/scenes", async (c) => {
    const to = day(c.req.query("to"), "to", today());
    const from = day(c.req.query("from"), "from", addDays(to, -365));
    if (dayNumber(to) - dayNumber(from) > 366 * 6) throw new BadRequest("Période limitée à 6 ans.");
    return c.json({ items: await listScenes(db(), c.get("farmId"), from, to) });
  })
  .get("/remote-sensing/images/:date/:kind", async (c) => {
    const date = day(c.req.param("date"), "date");
    const kind = c.req.param("kind") as SatelliteImageKind;
    if (!SATELLITE_IMAGE_KINDS.includes(kind)) throw new NotFound("Sorte d'image inconnue.");
    const { bytes, etag } = await sceneImage(db(), c.get("farmId"), date, kind);
    // Une date passée ne change pas ; un retraitement change l'empreinte.
    const tag = `"${etag}"`;
    const headers = { etag: tag, "cache-control": "private, max-age=86400", "content-type": "image/png" };
    if (c.req.header("if-none-match") === tag) return c.body(null, 304, headers);
    return c.body(bytes, 200, headers);
  })
  .get("/remote-sensing/parcels", async (c) =>
    c.json(await parcelIndicesAt(db(), c.get("farmId"), day(c.req.query("at"), "at", today()), index(c.req.query("index")))),
  )
  .get("/land-parcels/:id/indices", async (c) => {
    const to = day(c.req.query("to"), "to", today());
    const from = day(c.req.query("from"), "from", addDays(to, -365));
    if (from > to) throw new BadRequest("from après to.");
    if (dayNumber(to) - dayNumber(from) > 366 * 3) throw new BadRequest("Période limitée à 3 ans.");
    return c.json(await parcelSeries(db(), c.get("farmId"), uuidParam(c, "id"), index(c.req.query("index")), from, to));
  })
  /**
   * Historique plus ancien que le défaut (1er janvier de l'année précédente).
   * Sans `confirm`, renvoie l'estimation ; avec, l'enregistre et lance la synchro.
   */
  .post("/remote-sensing/history", requireOwner, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { from?: string; confirm?: boolean };
    const from = day(body.from, "from");
    if (from < "2017-03-28") throw new BadRequest("Sentinel-2 L2A est disponible à partir de 2017.");
    const farmId = c.get("farmId");
    const [integ] = await withFarm(db(), farmId, async (tx) =>
      (await tx.execute(sql`SELECT id FROM integrations WHERE provider = 'copernicus' AND enabled AND secret_ciphertext IS NOT NULL`)) as unknown as { id: string }[],
    );
    if (!integ) throw new BadRequest("Intégration Copernicus non configurée.");
    const [{ versions } = { versions: 0 }] = await withFarm(db(), farmId, async (tx) =>
      (await tx.execute(sql`
        SELECT count(*)::int AS versions FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id
        WHERE lp.farm_id = ${farmId} AND v.valid && tstzrange(${from}::date, now())`)) as unknown as { versions: number }[],
    );
    // Environ une acquisition tous les 3 jours, 0,04 PU par date et par parcelle (mesuré le 2026-11-10).
    const days = dayNumber(today()) - dayNumber(from);
    const estimate = { requests: versions + Math.ceil(days / 100), pu: Math.round(versions * (days / 3) * 0.04 * 0.5) };
    if (!body.confirm) return c.json({ from, estimate });
    await withFarm(db(), farmId, (tx) =>
      tx.execute(sql`UPDATE integrations SET settings = settings || jsonb_build_object('historyFrom', ${from}::text), updated_at = now() WHERE id = ${integ.id}`),
    );
    const run = syncIntegration(db(), farmId, integ.id);
    pendingSyncs.add(run);
    void run.catch(() => undefined).finally(() => pendingSyncs.delete(run));
    return c.json({ from, estimate, started: true }, 202);
  });
