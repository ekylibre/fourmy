import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { PersonIntervention, PersonWork } from "@fourmy/contracts";
import { campaignWindow, lastMonths, monthOf, parisMidnight, weekOf, workTime, type WorkEntry, type WorkWindow } from "@fourmy/domain";
import { NotFound } from "../routes/helpers.js";

/**
 * Temps de travaux des personnes, lot P2 (docs/equipe-personnes-design.md §5) :
 * périodes des interventions réalisées où la personne est intervenante (en
 * mode attelage, celles de son attelage), union des plages par
 * `workTime` (domaine).
 */
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const hours = (s: number) => Math.round((s / 3600) * 100) / 100;
/** Fin du jour `day` à Paris (minuit du lendemain). */
const endOfDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return parisMidnight(d.toISOString().slice(0, 10));
};
const list = (ids: readonly string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

type EntryRow = { person_id: string; intervention_id: string; procedure: string; started_at: string; stopped_at: string };

/** Plages de travail des personnes données sur [from, to[. */
async function entriesOf(tx: Tx, people: readonly string[], from: number, to: number): Promise<Map<string, (WorkEntry & { procedure: string })[]>> {
  const out = new Map<string, (WorkEntry & { procedure: string })[]>();
  if (!people.length) return out;
  const found = await rows<EntryRow>(
    tx,
    sql`SELECT me.ref_id AS person_id, i.id AS intervention_id, i.procedure, w.started_at, w.stopped_at
        FROM intervention_parameters me
        JOIN interventions i ON i.id = me.intervention_id AND i.status = 'done'
          -- Dates seules (intervention importée) : pas de durée de travail connue.
          AND i.period_precision = 'time'
        JOIN intervention_periods w ON w.intervention_id = i.id AND (i.staffing = 'free' OR w.crew_id = me.crew_id)
        WHERE me.role = 'doer' AND me.ref_type = 'person' AND me.ref_id IN (${list(people)})
          AND w.stopped_at > ${new Date(from).toISOString()}::timestamptz AND w.started_at < ${new Date(to).toISOString()}::timestamptz`,
  );
  for (const r of found) {
    const e = { interventionId: r.intervention_id, procedure: r.procedure, from: Date.parse(new Date(r.started_at).toISOString()), to: Date.parse(new Date(r.stopped_at).toISOString()) };
    out.set(r.person_id, [...(out.get(r.person_id) ?? []), e]);
  }
  return out;
}

/** Heures du mois et dernière intervention réalisée, pour la grille Équipe. */
export async function cardsWork(
  tx: Tx,
  people: readonly string[],
  day: string,
): Promise<Map<string, { monthHours: number; lastIntervention: { id: string; date: string; procedure: string } | null }>> {
  const month = monthOf(day);
  const entries = await entriesOf(tx, people, month.from, month.to);
  const last = people.length
    ? await rows<{ person_id: string; id: string; date: string; procedure: string }>(
        tx,
        sql`SELECT DISTINCT ON (me.ref_id) me.ref_id AS person_id, i.id, i.procedure,
                   to_char(i.started_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS date
            FROM intervention_parameters me JOIN interventions i ON i.id = me.intervention_id AND i.status = 'done'
            WHERE me.role = 'doer' AND me.ref_type = 'person' AND me.ref_id IN (${list(people)})
              AND i.started_at < ${new Date(endOfDay(day)).toISOString()}::timestamptz
            ORDER BY me.ref_id, i.started_at DESC`,
      )
    : [];
  const lastBy = new Map(last.map((r) => [r.person_id, { id: r.id, date: r.date, procedure: r.procedure }]));
  return new Map(people.map((p) => [p, { monthHours: hours(workTime(entries.get(p) ?? [], month).totalS), lastIntervention: lastBy.get(p) ?? null }]));
}

/** Campagne de la ferme qui contient `day`, sinon l'année civile. */
async function campaignOf(tx: Tx, day: string): Promise<WorkWindow & { label: string }> {
  const [c] = await rows<{ year: number; starts_on: string; stops_on: string }>(
    tx,
    sql`SELECT year, starts_on::text, stops_on::text FROM campaigns WHERE ${day}::date BETWEEN starts_on AND stops_on ORDER BY starts_on DESC LIMIT 1`,
  );
  if (c) return { ...campaignWindow(c.starts_on, c.stops_on), label: `Campagne ${c.year}` };
  const y = day.slice(0, 4);
  return { ...campaignWindow(`${y}-01-01`, `${y}-12-31`), label: `Année ${y}` };
}

async function assertPerson(tx: Tx, id: string) {
  const [p] = await rows<{ id: string }>(tx, sql`SELECT id FROM people WHERE id = ${id}`);
  if (!p) throw new NotFound("Personne introuvable");
}

/** Résumé des heures d'une personne à la date de la frise. */
export async function personWork(db: Database, farmId: string, id: string, day: string): Promise<PersonWork> {
  return withFarm(db, farmId, async (tx) => {
    await assertPerson(tx, id);
    const week = weekOf(day);
    const month = monthOf(day);
    const campaign = await campaignOf(tx, day);
    const months = lastMonths(day, 12);
    const last12 = { from: months[0]!.from, to: months.at(-1)!.to, fromDay: months[0]!.fromDay, toDay: months.at(-1)!.toDay };
    const from = Math.min(week.from, campaign.from, last12.from);
    const to = Math.max(week.to, campaign.to, last12.to);
    const entries = (await entriesOf(tx, [id], from, to)).get(id) ?? [];
    const bucket = (w: WorkWindow) => ({ from: w.fromDay, to: w.toDay, hours: hours(workTime(entries, w).totalS) });

    // Répartitions sur la campagne : part de chaque intervention (domaine).
    const shares = workTime(entries, campaign).byIntervention;
    const procedureOf = new Map(entries.map((e) => [e.interventionId, e.procedure]));
    const byProcedure = new Map<string, number>();
    for (const [iid, s] of shares) byProcedure.set(procedureOf.get(iid)!, (byProcedure.get(procedureOf.get(iid)!) ?? 0) + s);

    const byActivity = new Map<string, { activityId: string | null; name: string; s: number }>();
    const ids = [...shares.keys()];
    const weights = ids.length
      ? await rows<{ intervention_id: string; activity_id: string | null; name: string | null; w: number }>(
          tx,
          // Poids : zone travaillée, sinon surface de la parcelle à la date ; activité de la production de la campagne de l'intervention.
          sql`SELECT DISTINCT ON (t.id) t.intervention_id, a.id AS activity_id, a.name,
                     coalesce(ST_Area(t.working_zone::geography), v.area_m2, 0)::float8 AS w
              FROM intervention_parameters t
              JOIN interventions i ON i.id = t.intervention_id
              LEFT JOIN land_parcel_versions v ON v.land_parcel_id = t.ref_id AND v.valid @> i.started_at
              LEFT JOIN campaigns c ON (i.started_at AT TIME ZONE 'Europe/Paris')::date BETWEEN c.starts_on AND c.stops_on
              LEFT JOIN productions pr ON pr.land_parcel_id = t.ref_id AND pr.campaign_id = c.id AND pr.activity_id IS NOT NULL AND NOT pr.declared
              LEFT JOIN activities a ON a.id = pr.activity_id
              WHERE t.role = 'target' AND t.ref_type = 'land_parcel' AND t.intervention_id IN (${list(ids)})
              ORDER BY t.id, a.name`,
        )
      : [];
    const byIntervention = new Map<string, typeof weights>();
    for (const w of weights) byIntervention.set(w.intervention_id, [...(byIntervention.get(w.intervention_id) ?? []), w]);
    const add = (activityId: string | null, name: string, s: number) => {
      const key = activityId ?? "";
      const cur = byActivity.get(key) ?? { activityId, name, s: 0 };
      byActivity.set(key, { ...cur, s: cur.s + s });
    };
    for (const [iid, s] of shares) {
      const ws = byIntervention.get(iid) ?? [];
      const total = ws.reduce((sum, w) => sum + Number(w.w), 0);
      if (!ws.length || total <= 0) add(null, "Sans activité", s);
      else for (const w of ws) add(w.activity_id, w.activity_id ? w.name! : "Sans activité", (s * Number(w.w)) / total);
    }

    return {
      at: day,
      periods: { week: bucket(week), month: bucket(month), campaign: { ...bucket(campaign), label: campaign.label }, last12: bucket(last12) },
      byMonth: months.map((m) => ({ month: m.month, hours: hours(workTime(entries, m).totalS) })),
      byActivity: [...byActivity.values()].map((a) => ({ activityId: a.activityId, name: a.name, hours: hours(a.s) })).filter((a) => a.hours > 0).sort((a, b) => b.hours - a.hours),
      byProcedure: [...byProcedure].map(([procedure, s]) => ({ procedure, hours: hours(s) })).filter((p) => p.hours > 0).sort((a, b) => b.hours - a.hours),
    };
  });
}

/** Interventions de la personne sur [from, to[ (jours), les plus récentes d'abord, paginées. */
export async function personInterventions(
  db: Database,
  farmId: string,
  id: string,
  q: { fromDay: string; toDay: string; offset: number; limit: number },
): Promise<{ items: PersonIntervention[]; nextCursor: string | null }> {
  return withFarm(db, farmId, async (tx) => {
    await assertPerson(tx, id);
    const windowMs = { from: parisMidnight(q.fromDay), to: parisMidnight(q.toDay) };
    const entries = (await entriesOf(tx, [id], windowMs.from, windowMs.to)).get(id) ?? [];
    const shares = workTime(entries, windowMs).byIntervention;
    const start = new Map<string, number>();
    for (const e of entries) start.set(e.interventionId, Math.min(start.get(e.interventionId) ?? Infinity, e.from));
    const ordered = [...shares.keys()].sort((a, b) => start.get(b)! - start.get(a)!);
    const page = ordered.slice(q.offset, q.offset + q.limit);
    if (!page.length) return { items: [], nextCursor: null };
    const details = await rows<{ id: string; procedure: string; date: string; parcels: string[] | null; equipments: string[] | null }>(
      tx,
      sql`SELECT i.id, i.procedure, to_char(i.started_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS date,
                 (SELECT array_agg(DISTINCT lp.name ORDER BY lp.name) FROM intervention_parameters t JOIN land_parcels lp ON lp.id = t.ref_id
                   WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel') AS parcels,
                 (SELECT array_agg(DISTINCT e.name ORDER BY e.name) FROM intervention_parameters o JOIN equipments e ON e.id = o.ref_id
                   WHERE o.intervention_id = i.id AND o.role = 'tool' AND o.ref_type = 'equipment'
                     AND (i.staffing = 'free' OR o.crew_id IN (SELECT me.crew_id FROM intervention_parameters me
                          WHERE me.intervention_id = i.id AND me.role = 'doer' AND me.ref_id = ${id}))) AS equipments
          FROM interventions i WHERE i.id IN (${list(page)})`,
    );
    const byId = new Map(details.map((d) => [d.id, d]));
    return {
      items: page.map((iid) => {
        const d = byId.get(iid)!;
        return { id: iid, date: d.date, procedure: d.procedure, hours: hours(shares.get(iid) ?? 0), parcels: d.parcels ?? [], equipments: d.equipments ?? [] };
      }),
      nextCursor: q.offset + q.limit < ordered.length ? String(q.offset + q.limit) : null,
    };
  });
}
