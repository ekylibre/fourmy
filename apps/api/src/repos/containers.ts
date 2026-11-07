import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import { planStateCorrection, DomainError, type DomainCtx } from "@fourmy/domain";
import type { ContainerAt, ContainerCorrectionWrite, Shape3d } from "@fourmy/contracts";

/** Dépôt « cuves » : lecture à une date et correction tracée. */

type Row = {
  id: string;
  place_id: string;
  name: string;
  version_id: string;
  kind: "tank" | "silo" | "barrel";
  capacity_l: string;
  shape3d: Shape3d | null;
  placement: "auto" | "manual";
  lower: string;
  upper: string | null;
};

const toContainer = (r: Row): ContainerAt => ({
  id: r.id,
  placeId: r.place_id,
  name: r.name,
  version: {
    id: r.version_id,
    containerId: r.id,
    kind: r.kind,
    capacityL: Number(r.capacity_l),
    shape3d: r.shape3d,
    placement: r.placement,
    valid: { lower: r.lower, upper: r.upper },
  },
});

const columns = sql`
  c.id, c.place_id, c.name, v.id AS version_id, v.kind, v.capacity_l, v.shape3d, v.placement,
  lower(v.valid) AS lower, upper(v.valid) AS upper`;

export async function listContainersAt(db: Database, farmId: string, at: string): Promise<ContainerAt[]> {
  return withFarm(db, farmId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ${columns} FROM containers c
      JOIN container_versions v ON v.container_id = c.id AND v.valid @> ${at}::timestamptz
      ORDER BY c.name`)) as unknown as Row[];
    return rows.map(toContainer);
  });
}

export class NotFound extends Error {}

/**
 * Corrige la version courante d'une cuve (erreur de saisie) : mise à jour en
 * place + entrée d'audit (avant/après/motif), dans une seule transaction.
 */
export async function correctContainer(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  containerId: string,
  input: ContainerCorrectionWrite,
): Promise<ContainerAt> {
  return withFarm(db, farmId, async (tx) => {
    const current = (await tx.execute(sql`
      SELECT ${columns} FROM containers c
      JOIN container_versions v ON v.container_id = c.id AND upper(v.valid) IS NULL
      WHERE c.id = ${containerId}
      FOR UPDATE OF v`)) as unknown as Row[];
    const row = current[0];
    if (!row) throw new NotFound(`Cuve ${containerId} introuvable ou sans version courante.`);

    const plan = planStateCorrection(ctx, {
      farmId,
      entity: "container_versions",
      entityId: row.version_id,
      before: { capacityL: Number(row.capacity_l), kind: row.kind },
      patch: { capacityL: input.capacityL, kind: input.kind },
      reason: input.reason,
    });

    await tx.execute(sql`
      UPDATE container_versions SET capacity_l = ${plan.after.capacityL}, kind = ${plan.after.kind}
      WHERE id = ${row.version_id}`);
    await tx.execute(sql`
      INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
      VALUES (${plan.audit.id}, ${farmId}, ${plan.audit.actor}, ${plan.audit.origin},
              ${plan.audit.entity}, ${plan.audit.entityId}, ${plan.audit.action},
              ${JSON.stringify(plan.audit.diff)}::jsonb, ${plan.audit.at}::timestamptz)`);

    return toContainer({ ...row, capacity_l: String(plan.after.capacityL), kind: plan.after.kind });
  });
}

export { DomainError };
