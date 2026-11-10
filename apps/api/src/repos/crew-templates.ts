import { sql } from "drizzle-orm";
import type { Tx } from "@fourmy/db";
import type { CrewTemplate, CrewTemplateWrite } from "@fourmy/contracts";
import { BadRequest, NotFound } from "../routes/helpers.js";

/**
 * Attelages types (FR-ATT-6, migration 0025). Les membres sont réécrits à
 * chaque modification ; l'ordre saisi est gardé (`rank`), matériels d'abord.
 */

type Row = { id: string; name: string; active: boolean; equipmentIds: string[]; personIds: string[]; updatedAt: string | Date };

const select = sql`
  SELECT t.id, t.name, t.active, t.updated_at AS "updatedAt",
    coalesce(array_agg(m.equipment_id ORDER BY m.rank) FILTER (WHERE m.equipment_id IS NOT NULL), '{}') AS "equipmentIds",
    coalesce(array_agg(m.person_id ORDER BY m.rank) FILTER (WHERE m.person_id IS NOT NULL), '{}') AS "personIds"
  FROM crew_templates t LEFT JOIN crew_template_members m ON m.template_id = t.id`;

const read = (r: Row): CrewTemplate => ({ ...r, updatedAt: new Date(r.updatedAt).toISOString() });

export async function listCrewTemplates(tx: Tx): Promise<CrewTemplate[]> {
  const rows = (await tx.execute(sql`${select} GROUP BY t.id ORDER BY t.active DESC, t.name`)) as unknown as Row[];
  return rows.map(read);
}

export async function getCrewTemplate(tx: Tx, id: string): Promise<CrewTemplate> {
  const [row] = (await tx.execute(sql`${select} WHERE t.id = ${id} GROUP BY t.id`)) as unknown as Row[];
  if (!row) throw new NotFound(`Attelage type ${id} introuvable.`);
  return read(row);
}

/** Matériels et personnes de la ferme (RLS), sans doublon. */
async function checkMembers(tx: Tx, w: { equipmentIds: string[]; personIds: string[] }) {
  const equipmentIds = [...new Set(w.equipmentIds)];
  const personIds = [...new Set(w.personIds)];
  const [found] = (await tx.execute(sql`
    SELECT (SELECT count(*)::int FROM equipments WHERE id = ANY(${pgArray(equipmentIds)}::uuid[])) AS equipments,
           (SELECT count(*)::int FROM people WHERE id = ANY(${pgArray(personIds)}::uuid[])) AS people`)) as unknown as {
    equipments: number;
    people: number;
  }[];
  if (found!.equipments !== equipmentIds.length) throw new BadRequest("Matériel inconnu dans cette ferme.");
  if (found!.people !== personIds.length) throw new BadRequest("Intervenant inconnu dans cette ferme.");
  return { equipmentIds, personIds };
}

const pgArray = (ids: string[]) => `{${ids.join(",")}}`;

async function writeMembers(tx: Tx, id: string, m: { equipmentIds: string[]; personIds: string[] }) {
  await tx.execute(sql`DELETE FROM crew_template_members WHERE template_id = ${id}`);
  const rows = [...m.equipmentIds.map((e) => ({ e, p: null as string | null })), ...m.personIds.map((p) => ({ e: null as string | null, p }))];
  for (const [rank, r] of rows.entries())
    await tx.execute(sql`INSERT INTO crew_template_members (template_id, rank, equipment_id, person_id) VALUES (${id}, ${rank}, ${r.e}, ${r.p})`);
}

type Write = Omit<CrewTemplateWrite, "personIds"> & { personIds: string[] };

/** Création, idempotente sur l'identifiant (rejeu hors ligne). */
export async function createCrewTemplate(tx: Tx, farmId: string, id: string, w: Write): Promise<CrewTemplate> {
  const members = await checkMembers(tx, w);
  const inserted = await tx.execute(sql`
    INSERT INTO crew_templates (id, farm_id, name, active) VALUES (${id}, ${farmId}, ${w.name}, ${w.active ?? true})
    ON CONFLICT (id) DO NOTHING RETURNING id`);
  if ((inserted as unknown as unknown[]).length) await writeMembers(tx, id, members);
  return getCrewTemplate(tx, id);
}

export async function updateCrewTemplate(tx: Tx, id: string, w: Write): Promise<CrewTemplate> {
  const members = await checkMembers(tx, w);
  const updated = (await tx.execute(sql`
    UPDATE crew_templates SET name = ${w.name}, active = coalesce(${w.active ?? null}, active), updated_at = now()
    WHERE id = ${id} RETURNING id`)) as unknown as unknown[];
  if (!updated.length) throw new NotFound(`Attelage type ${id} introuvable.`);
  await writeMembers(tx, id, members);
  return getCrewTemplate(tx, id);
}

/** Suppression : les attelages saisis gardent leur composition, leur origine passe à NULL. */
export async function deleteCrewTemplate(tx: Tx, id: string): Promise<void> {
  const deleted = (await tx.execute(sql`DELETE FROM crew_templates WHERE id = ${id} RETURNING id`)) as unknown as unknown[];
  if (!deleted.length) throw new NotFound(`Attelage type ${id} introuvable.`);
}
