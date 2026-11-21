import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@fourmy/db";
import { itkContent, type ItkContent, type ItkDetail, type ItkSummary, type ItkWriteParsed } from "@fourmy/contracts";
import { itkMissing, itkReferences } from "@fourmy/domain";
import { BadRequest, NotFound } from "../routes/helpers.js";

/**
 * Itinéraires techniques de la ferme (assolement temps 2, lot IT1,
 * claudedocs/conception_assolement_itk.md §4 et §10). Le contenu est un
 * document jsonb validé par zod ; la révision protège des écritures
 * concurrentes (409 avec l'ITK du serveur).
 */

type Write = ItkWriteParsed;

type Row = {
  id: string;
  name: string;
  activity_id: string | null;
  activity_name: string | null;
  activity_reference: string | null;
  production: string | null;
  system: ItkDetail["system"];
  cycle: ItkDetail["cycle"];
  origin: ItkDetail["origin"];
  source: Record<string, unknown> | null;
  notes: string | null;
  content: ItkContent;
  revision: number;
  active: boolean;
  updated_at: string;
};

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

const select = sql`
  SELECT t.id, t.name, t.activity_id, a.name AS activity_name, a.reference AS activity_reference, t.production, t.system, t.cycle,
         t.origin, t.source, t.notes, t.content, t.revision, t.active, t.updated_at::text
  FROM technical_itineraries t LEFT JOIN activities a ON a.id = t.activity_id`;

/** Articles, matériels en service, personnes actives et attelages types actifs de la ferme (RLS). */
async function knownRefs(tx: Tx) {
  const [r] = await rows<{ articles: string[]; equipments: string[]; people: string[]; crew_templates: string[] }>(
    tx,
    sql`SELECT (SELECT coalesce(array_agg(id), '{}') FROM articles) AS articles,
               (SELECT coalesce(array_agg(id), '{}') FROM equipments WHERE coalesce(state, 'active') = 'active') AS equipments,
               (SELECT coalesce(array_agg(id), '{}') FROM people WHERE active) AS people,
               (SELECT coalesce(array_agg(id), '{}') FROM crew_templates WHERE active) AS crew_templates`,
  );
  return { articles: new Set(r!.articles), equipments: new Set(r!.equipments), people: new Set(r!.people), crewTemplates: new Set(r!.crew_templates) };
}

/** Dates d'exemple de l'aperçu : dates types Lexicon de la production, ramenées à l'an prochain ; sinon semis mi-octobre, récolte mi-juillet. */
async function exampleDates(tx: Tx, reference: string | null): Promise<ItkDetail["example"]> {
  const year = new Date().getUTCFullYear() + 1;
  if (reference) {
    const [d] = await rows<{ sowing_on: string | null; harvest_on: string | null }>(
      tx,
      sql`SELECT (started_on + make_interval(years => ${year} - extract(year FROM stopped_on)::int))::date::text AS sowing_on,
                 (stopped_on + make_interval(years => ${year} - extract(year FROM stopped_on)::int))::date::text AS harvest_on
          FROM lexicon_productions WHERE reference_name = ${reference} AND started_on IS NOT NULL AND stopped_on IS NOT NULL LIMIT 1`,
    );
    if (d?.sowing_on && d.harvest_on && d.sowing_on <= d.harvest_on) return { sowingOn: d.sowing_on, harvestOn: d.harvest_on, year };
  }
  return { sowingOn: `${year - 1}-10-15`, harvestOn: `${year}-07-10`, year };
}

const base = (r: Row) => ({
  id: r.id,
  name: r.name,
  activityId: r.activity_id,
  activityName: r.activity_name,
  production: r.production,
  system: r.system,
  cycle: r.cycle,
  origin: r.origin,
  active: r.active,
  revision: r.revision,
  updatedAt: new Date(r.updated_at).toISOString(),
});

export async function listItks(tx: Tx, filter: { activityId?: string; active?: boolean }): Promise<ItkSummary[]> {
  const where: SQL[] = [];
  if (filter.activityId) where.push(sql`t.activity_id = ${filter.activityId}`);
  if (filter.active !== undefined) where.push(sql`t.active = ${filter.active}`);
  const list = await rows<Row>(tx, sql`${select} ${where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``} ORDER BY t.active DESC, a.name NULLS LAST, t.name`);
  const known = await knownRefs(tx);
  return list.map((r) => ({
    ...base(r),
    steps: r.content.steps.length,
    procedures: [...new Set(r.content.steps.map((s) => s.procedure))],
    missing: itkMissing(r.content, known).length,
  }));
}

export async function getItk(tx: Tx, id: string, lock = false): Promise<ItkDetail> {
  const [r] = await rows<Row>(tx, sql`${select} WHERE t.id = ${id} ${lock ? sql`FOR UPDATE OF t` : sql``}`);
  if (!r) throw new NotFound(`Itinéraire technique ${id} introuvable.`);
  return {
    ...base(r),
    source: r.source,
    notes: r.notes,
    content: r.content,
    missing: itkMissing(r.content, await knownRefs(tx)),
    example: await exampleDates(tx, r.production ?? r.activity_reference),
  };
}

/** L'ITK a changé depuis sa lecture : 409 avec la version du serveur. */
export class StaleItk extends Error {
  constructor(readonly current: ItkDetail) {
    super("Cet itinéraire a été modifié entre-temps (autre onglet ou autre personne).");
  }
}

/**
 * Références d'un contenu : chaque article, matériel, personne ou attelage
 * type doit être de la ferme (RLS), sauf s'il figurait déjà dans la version
 * enregistrée (élément supprimé depuis, gardé « à remplacer »).
 */
async function checkRefs(tx: Tx, w: Write, previous: ItkContent | null) {
  const refs = itkReferences(w.content);
  const kept = previous ? itkReferences(previous) : null;
  const check = async (table: "articles" | "equipments" | "people" | "crew_templates", ids: Set<string>, keptIds: Set<string> | undefined, what: string) => {
    const wanted = [...ids].filter((id) => !keptIds?.has(id));
    if (!wanted.length) return;
    const found = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id = ANY(${`{${wanted.join(",")}}`}::uuid[])`);
    if (found[0]!.n !== wanted.length) throw new BadRequest(`${what} inconnu dans cette ferme.`);
  };
  await check("articles", refs.articles, kept?.articles, "Article");
  await check("equipments", refs.equipments, kept?.equipments, "Matériel");
  await check("people", refs.people, kept?.people, "Intervenant");
  await check("crew_templates", refs.crewTemplates, kept?.crewTemplates, "Attelage type");
  if (w.activityId) {
    const [a] = await rows<{ id: string }>(tx, sql`SELECT id FROM activities WHERE id = ${w.activityId}`);
    if (!a) throw new BadRequest("Activité inconnue dans cette ferme.");
  }
}

/** Création, idempotente sur l'identifiant (double clic, rejeu). */
export async function createItk(tx: Tx, farmId: string, id: string, w: Write, userId: string): Promise<ItkDetail> {
  await checkRefs(tx, w, null);
  await tx.execute(sql`
    INSERT INTO technical_itineraries (id, farm_id, name, activity_id, production, system, cycle, origin, source, content, notes, active, updated_by)
    VALUES (${id}, ${farmId}, ${w.name}, ${w.activityId}, ${w.production}, ${w.system}, ${w.cycle}, ${w.origin},
            ${w.source ? JSON.stringify(w.source) : null}::jsonb, ${JSON.stringify(w.content)}::jsonb, ${w.notes}, ${w.active}, ${userId})
    ON CONFLICT (id) DO NOTHING`);
  return getItk(tx, id);
}

export async function updateItk(tx: Tx, id: string, w: Write, userId: string): Promise<ItkDetail> {
  const current = await getItk(tx, id, true);
  if (w.revision === undefined) throw new BadRequest("Révision manquante.");
  if (w.revision !== current.revision) throw new StaleItk(current);
  await checkRefs(tx, w, current.content);
  await tx.execute(sql`
    UPDATE technical_itineraries SET name = ${w.name}, activity_id = ${w.activityId}, production = ${w.production}, system = ${w.system},
      cycle = ${w.cycle}, notes = ${w.notes}, active = ${w.active}, content = ${JSON.stringify(w.content)}::jsonb,
      revision = revision + 1, updated_at = now(), updated_by = ${userId}
    WHERE id = ${id}`);
  return getItk(tx, id);
}

/** Copie (« Blé tendre (copie) », puis « (copie 2) »…), active, origine « copy ». */
export async function copyItk(tx: Tx, farmId: string, id: string, newId: string, userId: string): Promise<ItkDetail> {
  const src = await getItk(tx, id);
  const taken = new Set((await rows<{ name: string }>(tx, sql`SELECT name FROM technical_itineraries`)).map((r) => r.name));
  const stem = `${src.name.slice(0, 100)} (copie`;
  let name = `${stem})`;
  for (let n = 2; taken.has(name); n++) name = `${stem} ${n})`;
  // Nouveaux identifiants d'étape : la copie a ses propres interventions prévues (lot IT3).
  const content = itkContent.parse({ ...src.content, steps: src.content.steps.map((s) => ({ ...s, id: crypto.randomUUID() })) });
  await tx.execute(sql`
    INSERT INTO technical_itineraries (id, farm_id, name, activity_id, production, system, cycle, origin, source, content, notes, active, updated_by)
    VALUES (${newId}, ${farmId}, ${name}, ${src.activityId}, ${src.production}, ${src.system}, ${src.cycle}, 'copy',
            ${JSON.stringify({ itineraryId: src.id, revision: src.revision })}::jsonb, ${JSON.stringify(content)}::jsonb, ${src.notes}, true, ${userId})`);
  return getItk(tx, newId);
}

/**
 * Suppression : un ITK référencé par un assolement (brouillon ou version)
 * ou une production est seulement désactivé ; sinon il est supprimé.
 */
export async function deleteItk(tx: Tx, id: string, userId: string): Promise<{ deleted: boolean }> {
  await getItk(tx, id, true);
  const [used] = await rows<{ used: boolean }>(
    tx,
    sql`SELECT EXISTS (SELECT 1 FROM crop_plans p, jsonb_array_elements(coalesce(p.draft->'assignments', '[]')) a WHERE a->>'itineraryId' = ${id})
            OR EXISTS (SELECT 1 FROM crop_plan_versions v, jsonb_array_elements(coalesce(v.snapshot->'assignments', '[]')) a WHERE a->>'itineraryId' = ${id})
            OR EXISTS (SELECT 1 FROM productions WHERE attrs->>'itineraryId' = ${id}) AS used`,
  );
  if (used!.used) {
    await tx.execute(sql`UPDATE technical_itineraries SET active = false, revision = revision + 1, updated_at = now(), updated_by = ${userId} WHERE id = ${id}`);
    return { deleted: false };
  }
  await tx.execute(sql`DELETE FROM technical_itineraries WHERE id = ${id}`);
  return { deleted: true };
}
