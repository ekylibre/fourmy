import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import type { AgrirouterInboxItem } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { readAgrirouterFile } from "../integrations/agrirouter-events.js";
import { NotFound, uuidParam } from "./helpers.js";

type Row = {
  id: string;
  message_type: string;
  filename: string | null;
  size: string | number;
  sender_endpoint_id: string | null;
  sender_name: string | null;
  sent_at: Date | string | null;
  received_at: Date | string;
  state: AgrirouterInboxItem["state"];
  error: string | null;
  confirmed_at: Date | string | null;
  confirm_error: string | null;
};
const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());

const view = (r: Row): AgrirouterInboxItem => ({
  id: r.id,
  messageType: r.message_type,
  filename: r.filename,
  size: Number(r.size),
  senderEndpointId: r.sender_endpoint_id,
  senderName: r.sender_name,
  sentAt: iso(r.sent_at),
  receivedAt: iso(r.received_at)!,
  state: r.state,
  error: r.error,
  confirmedAt: iso(r.confirmed_at),
  confirmError: r.confirm_error,
});

/** Nom de fichier sûr pour l'en-tête de téléchargement. */
const safeName = (name: string) => name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "agrirouter";

/**
 * Boîte de réception agrirouter (lot AR2) : fichiers reçus des machines et
 * des autres logiciels, réservée au responsable.
 */
export const agrirouterRoutes = new Hono<Env>()
  .use("/agrirouter/*", requireOwner)
  .get("/agrirouter/inbox", async (c) => {
    const items = await withFarm(db(), c.get("farmId"), (tx) =>
      tx.execute(sql`
        SELECT id, message_type, filename, size, sender_endpoint_id, sender_name, sent_at, received_at, state, error, confirmed_at, confirm_error
        FROM agrirouter_inbox ORDER BY received_at DESC LIMIT 500`),
    );
    return c.json({ items: (items as unknown as Row[]).map(view) });
  })
  .get("/agrirouter/inbox/:id/file", async (c) => {
    const [row] = (await withFarm(db(), c.get("farmId"), (tx) =>
      tx.execute(sql`SELECT file_sha256, filename, message_type FROM agrirouter_inbox WHERE id = ${uuidParam(c, "id")}`),
    )) as unknown as { file_sha256: string; filename: string | null; message_type: string }[];
    if (!row) throw new NotFound("Fichier introuvable.");
    const bytes = await readAgrirouterFile(row.file_sha256).catch(() => {
      throw new NotFound("Contenu du fichier introuvable sur le serveur.");
    });
    const ext = row.message_type.endsWith(":zip") ? ".zip" : row.message_type.endsWith(":protobuf") ? ".bin" : "";
    const name = safeName(row.filename ?? `agrirouter-${row.message_type.split(":").at(-2) ?? "fichier"}${ext}`);
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    });
  });
