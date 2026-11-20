import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { DOCUMENT_MAX_BYTES, type DocumentOwnerType, type RegulatoryDocument } from "@fourmy/contracts";
import { BadRequest, NotFound } from "../routes/helpers.js";

/**
 * Justificatifs joints (lot AI, FR-FERT-28) : analyse de sol, d'eau ou de
 * produit, avis d'un conseiller pour une dose externe, couvert. PDF, JPEG ou
 * PNG de 10 Mio au plus ; le type est reconnu au contenu, pas au nom.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Table du propriétaire : le justificatif n'est accepté que pour un objet de la ferme. */
const OWNER_TABLES: Record<DocumentOwnerType, string> = {
  plan: "fertilization_plans",
  soil_analysis: "soil_analyses",
  water_source: "water_sources",
  product_analysis: "product_analyses",
  cover_crop: "cover_crops",
  steering: "steering_measurements",
  hve_questionnaire: "hve_questionnaires",
};

export function sniffDocument(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

type Row = { id: string; owner_type: DocumentOwnerType; owner_id: string; name: string; content_type: string; size: number; uploaded_at: string; uploaded_by: string | null };
const view = (r: Row): RegulatoryDocument => ({
  id: r.id,
  ownerType: r.owner_type,
  ownerId: r.owner_id,
  name: r.name,
  contentType: r.content_type,
  size: r.size,
  uploadedAt: new Date(r.uploaded_at).toISOString(),
  uploadedBy: r.uploaded_by,
});
const COLUMNS = sql`id, owner_type, owner_id, name, content_type, size, uploaded_at, uploaded_by`;

export async function listDocuments(db: Database, farmId: string, ownerType: DocumentOwnerType, ownerId: string): Promise<RegulatoryDocument[]> {
  return withFarm(db, farmId, async (tx) =>
    (await rows<Row>(tx, sql`SELECT ${COLUMNS} FROM regulatory_documents WHERE owner_type = ${ownerType} AND owner_id = ${ownerId} ORDER BY uploaded_at, name`)).map(view),
  );
}

export async function addDocument(
  db: Database,
  farmId: string,
  userId: string | null,
  input: { ownerType: DocumentOwnerType; ownerId: string; name: string; bytes: Uint8Array },
): Promise<RegulatoryDocument> {
  if (!input.bytes.length) throw new BadRequest("Fichier vide.");
  if (input.bytes.length > DOCUMENT_MAX_BYTES) throw new BadRequest("Fichier trop gros : 10 Mio au plus.");
  const type = sniffDocument(input.bytes);
  if (!type) throw new BadRequest("Format non accepté : PDF, JPEG ou PNG.");
  // Nom affiché seulement : sans séparateur de chemin ni caractère de contrôle.
  const name = [...input.name.trim()].map((ch) => (ch === "/" || ch === "\\" || ch.charCodeAt(0) < 32 ? "_" : ch)).join("").slice(0, 200) || "justificatif";
  return withFarm(db, farmId, async (tx) => {
    const table = sql.raw(OWNER_TABLES[input.ownerType]);
    const [owner] = await rows(tx, sql`SELECT id FROM ${table} WHERE id = ${input.ownerId} AND farm_id = ${farmId}`);
    if (!owner) throw new NotFound("Objet du justificatif introuvable.");
    const [r] = await rows<Row>(
      tx,
      sql`INSERT INTO regulatory_documents (id, farm_id, owner_type, owner_id, name, content_type, size, bytes, uploaded_by)
          VALUES (${crypto.randomUUID()}, ${farmId}, ${input.ownerType}, ${input.ownerId}, ${name}, ${type}, ${input.bytes.length}, ${Buffer.from(input.bytes)}, ${userId})
          RETURNING ${COLUMNS}`,
    );
    return view(r!);
  });
}

export async function readDocument(db: Database, farmId: string, id: string): Promise<{ name: string; contentType: string; bytes: Uint8Array }> {
  return withFarm(db, farmId, async (tx) => {
    const [d] = await rows<{ name: string; content_type: string; bytes: Uint8Array }>(tx, sql`SELECT name, content_type, bytes FROM regulatory_documents WHERE id = ${id}`);
    if (!d) throw new NotFound("Justificatif introuvable.");
    return { name: d.name, contentType: d.content_type, bytes: d.bytes };
  });
}

export async function deleteDocument(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows(tx, sql`DELETE FROM regulatory_documents WHERE id = ${id} RETURNING id`);
    if (!done.length) throw new NotFound("Justificatif introuvable.");
  });
}
