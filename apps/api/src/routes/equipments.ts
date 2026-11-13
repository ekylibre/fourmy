import { Hono, type Context } from "hono";
import { avatarWrite, equipmentOptionWrite, equipmentWrite, farmBrandWrite, meterReadingWrite } from "@fourmy/contracts";
import { avatarGlb, avatarInfo, saveAvatar, setModel } from "../repos/avatar.js";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import {
  addOption,
  addReading,
  createEquipment,
  deleteOption,
  deleteReading,
  equipmentSheet,
  listBrands,
  listEquipments,
  listReadings,
  readAsset,
  setLogo,
  updateBrand,
  updateEquipment,
  type LogoUpload,
} from "../repos/equipments.js";
import { farmDues } from "../repos/maintenance.js";
import { BadRequest, domainCtx, problem, uuidParam } from "./helpers.js";

/** Logo envoyé en multipart : `file` (PNG, JPEG ou SVG) et, pour un SVG, `raster` (PNG). */
export async function logoUpload(c: Context<Env>): Promise<LogoUpload> {
  const body = await c.req.parseBody().catch(() => null);
  const file = body?.file;
  if (!(file instanceof File)) throw new BadRequest("Fichier « file » attendu (multipart/form-data).");
  const raster = body?.raster instanceof File ? new Uint8Array(await body.raster.arrayBuffer()) : undefined;
  return { file: new Uint8Array(await file.arrayBuffer()), raster };
}

/**
 * Matériels (lot I) : lecture et relevés pour tous les membres ; fiche,
 * options, marques et logos pour le responsable (NFR-MAT-4).
 */
export const equipmentRoutes = new Hono<Env>()
  .get("/equipments", async (c) => {
    const [items, dues] = await Promise.all([listEquipments(db(), c.get("farmId")), farmDues(db(), c.get("farmId"), new Date().toISOString())]);
    return c.json({ items: items.map((e) => ({ ...e, due: dues.byEquipment[e.id] ?? null })) });
  })
  .post("/equipments", requireOwner, async (c) => {
    const parsed = equipmentWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await createEquipment(db(), c.get("farmId"), domainCtx(c), parsed.data), 201);
  })
  .get("/equipments/:id/sheet", async (c) => c.json(await equipmentSheet(db(), c.get("farmId"), uuidParam(c, "id"))))
  .put("/equipments/:id", requireOwner, async (c) => {
    const parsed = equipmentWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    await updateEquipment(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data);
    return c.body(null, 204);
  })
  .post("/equipments/:id/options", requireOwner, async (c) => {
    const parsed = equipmentOptionWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await addOption(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data), 201);
  })
  .delete("/equipment-options/:id", requireOwner, async (c) => {
    await deleteOption(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"));
    return c.body(null, 204);
  })
  .get("/equipments/:id/readings", async (c) => c.json({ items: await listReadings(db(), c.get("farmId"), uuidParam(c, "id")) }))
  .post("/equipments/:id/readings", async (c) => {
    const parsed = meterReadingWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" ; "));
    if (parsed.data.origin === "reference" && c.get("role") !== "owner") return problem(c, 403, "Accès refusé", "Relevé de référence : responsable seulement.");
    return c.json(await addReading(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data), 201);
  })
  .delete("/meter-readings/:id", requireOwner, async (c) => {
    await deleteReading(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"));
    return c.body(null, 204);
  })
  .put("/equipments/:id/logo", requireOwner, async (c) =>
    c.json(await setLogo(db(), c.get("farmId"), domainCtx(c), { equipmentId: uuidParam(c, "id") }, await logoUpload(c))),
  )
  .delete("/equipments/:id/logo", requireOwner, async (c) =>
    c.json(await setLogo(db(), c.get("farmId"), domainCtx(c), { equipmentId: uuidParam(c, "id") }, null)),
  )
  .get("/brands", async (c) => c.json({ items: await listBrands(db(), c.get("farmId")) }))
  .put("/brands/:id", requireOwner, async (c) => {
    const parsed = farmBrandWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await updateBrand(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data));
  })
  .put("/brands/:id/logo", requireOwner, async (c) =>
    c.json(await setLogo(db(), c.get("farmId"), domainCtx(c), { brandId: uuidParam(c, "id") }, await logoUpload(c))),
  )
  .delete("/brands/:id/logo", requireOwner, async (c) => c.json(await setLogo(db(), c.get("farmId"), domainCtx(c), { brandId: uuidParam(c, "id") }, null)))
  // Avatar 3D (lot M) : paramètres, GLB (généré ou importé), réglage, import.
  .get("/equipments/:id/avatar", async (c) => c.json(await avatarInfo(db(), c.get("farmId"), uuidParam(c, "id"))))
  .get("/equipments/:id/avatar.glb", async (c) => {
    const { bytes, etag } = await avatarGlb(db(), c.get("farmId"), uuidParam(c, "id"));
    const tag = `"${etag}"`;
    const headers = { etag: tag, "cache-control": "private, max-age=0, must-revalidate", "content-type": "model/gltf-binary" };
    if (c.req.header("if-none-match") === tag) return c.body(null, 304, headers);
    return c.body(bytes, 200, headers);
  })
  .put("/equipments/:id/avatar", requireOwner, async (c) => {
    const parsed = avatarWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await saveAvatar(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data));
  })
  .put("/equipments/:id/model", requireOwner, async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    if (!(body?.file instanceof File)) throw new BadRequest("Fichier « file » attendu (multipart/form-data).");
    return c.json(await setModel(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), new Uint8Array(await body.file.arrayBuffer())));
  })
  .delete("/equipments/:id/model", requireOwner, async (c) => c.json(await setModel(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), null)))
  // Fichier : adressé par un identifiant neuf à chaque envoi, donc immuable.
  // Un SVG n'est jamais exécuté : servi en sandbox, sans scripts.
  .get("/assets/:id", async (c) => {
    const a = await readAsset(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(new Uint8Array(a.bytes), 200, {
      "content-type": a.mediaType,
      "cache-control": "private, max-age=31536000, immutable",
      etag: `"${a.sha256}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
  });
