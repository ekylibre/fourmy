import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { CertificationWrite, ParcelCertification } from "@fourmy/contracts";
import { NotFound } from "../routes/helpers.js";

/** Certifications des parcelles (lot G des retours du 08/11/2026). */
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

const SELECT = sql`SELECT id, land_parcel_id AS "landParcelId", kind, level, label, certifier, reference,
                          started_on::text AS "startedOn", stopped_on::text AS "stoppedOn"
                   FROM parcel_certifications`;

/** Toutes les certifications de la ferme (ou d'une parcelle), les plus récentes d'abord. */
export async function listCertifications(db: Database, farmId: string, parcelId?: string): Promise<ParcelCertification[]> {
  return withFarm(db, farmId, (tx) =>
    rows<ParcelCertification>(tx, sql`${SELECT} ${parcelId ? sql`WHERE land_parcel_id = ${parcelId}` : sql``} ORDER BY started_on DESC, kind`),
  );
}

export async function createCertification(db: Database, farmId: string, parcelId: string, body: CertificationWrite): Promise<ParcelCertification> {
  return withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ id: string }>(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId}`);
    if (!p) throw new NotFound("Parcelle introuvable");
    const id = crypto.randomUUID();
    await tx.execute(sql`
      INSERT INTO parcel_certifications (id, farm_id, land_parcel_id, kind, level, label, certifier, reference, started_on, stopped_on)
      VALUES (${id}, ${farmId}, ${parcelId}, ${body.kind}, ${body.level || null}, ${body.label || null}, ${body.certifier || null},
              ${body.reference || null}, ${body.startedOn}::date, ${body.stoppedOn ?? null}::date)`);
    return (await rows<ParcelCertification>(tx, sql`${SELECT} WHERE id = ${id}`))[0]!;
  });
}

export async function updateCertification(db: Database, farmId: string, id: string, body: CertificationWrite): Promise<ParcelCertification> {
  return withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(
      tx,
      sql`UPDATE parcel_certifications SET kind = ${body.kind}, level = ${body.level || null}, label = ${body.label || null},
            certifier = ${body.certifier || null}, reference = ${body.reference || null},
            started_on = ${body.startedOn}::date, stopped_on = ${body.stoppedOn ?? null}::date, updated_at = now()
          WHERE id = ${id} RETURNING id`,
    );
    if (!done.length) throw new NotFound("Certification introuvable");
    return (await rows<ParcelCertification>(tx, sql`${SELECT} WHERE id = ${id}`))[0]!;
  });
}

export async function deleteCertification(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(tx, sql`DELETE FROM parcel_certifications WHERE id = ${id} RETURNING id`);
    if (!done.length) throw new NotFound("Certification introuvable");
  });
}
