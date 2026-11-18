import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { MESSAGE_TYPES } from "@fourmy/agrirouter";
import { readTaskData, IsoxmlReadError, type ReadTask } from "@fourmy/isoxml";
import type { AgrirouterInboxTask, TrackDraft } from "@fourmy/contracts";
import { prescriptionRefOf } from "../repos/prescriptions.js";
import { readAgrirouterFile } from "./agrirouter-events.js";

/**
 * agrirouter, lot AR4 (claudedocs/conception_agrirouter.md §9.1) : lecture
 * des TaskData reçus. Chaque tâche réalisée devient une proposition
 * d'intervention (même brouillon que les parcours GPS) : périodes, parcelles
 * d'après la géométrie, matériel, produits et doses relevées, carte de
 * modulation d'origine. L'utilisateur valide, corrige ou écarte.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Fuseau des heures écrites sans décalage par les consoles (pas de fuseau par ferme pour l'instant). */
export const CONSOLE_TIME_ZONE = "Europe/Paris";

/** Heure de console (locale, souvent sans fuseau) → ISO UTC. */
export function consoleTime(local: string, timeZone = CONSOLE_TIME_ZONE): string | null {
  if (!local) return null;
  if (/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(local)) {
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?$/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0), Math.round(Number(`0.${m[7] ?? 0}`) * 1000));
  // Décalage du fuseau à cet instant, corrigé une fois (changement d'heure).
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - Math.floor(t / 1000) * 1000;
  };
  let t = asUtc - offset(asUtc);
  t = asUtc - offset(t);
  return new Date(t).toISOString();
}

/**
 * Doses réellement appliquées (DDI ISO 11783-11), vers les unités de Fourmy ;
 * mêmes résolutions que l'écriture des cartes (RATE_DDI). Consigne en repli.
 */
const RATE_DDIS: { actual: number; setpoint: number; unit: string; toUnit: (v: number) => number }[] = [
  { actual: 7, setpoint: 6, unit: "kg/ha", toUnit: (v) => v / 100 }, // mg/m²
  { actual: 2, setpoint: 1, unit: "L/ha", toUnit: (v) => v / 10_000 }, // 0,01 mm³/m²
  { actual: 12, setpoint: 11, unit: "grains/ha", toUnit: (v) => v * 10 }, // 0,001 /m²
];
/** DDI 116 : surface totale travaillée (m²). */
const TOTAL_AREA_DDI = 116;
/** États de position utilisables (GNSS à RTK flottant). */
const GOOD_FIX = new Set([1, 2, 3, 4, 5]);

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

function ratesOf(task: ReadTask): { value: number; unit: string }[] {
  const out: { value: number; unit: string }[] = [];
  for (const r of RATE_DDIS) {
    for (const ddi of [r.actual, r.setpoint]) {
      const values = task.log.flatMap((rec) => Object.entries(rec.values).filter(([k, v]) => k.startsWith(`${ddi}@`) && v > 0).map(([, v]) => v));
      const fromTotals = task.totals.filter((t) => t.ddi === ddi && t.value > 0).map((t) => t.value);
      const all = values.length ? values : fromTotals;
      if (!all.length) continue;
      const mean = r.toUnit(all.reduce((a, b) => a + b, 0) / all.length);
      out.push({ value: round(mean, r.unit === "grains/ha" ? 0 : 1), unit: r.unit });
      break;
    }
  }
  return out;
}

/** Périodes de travail : TIM effectifs (type 4) d'abord, sinon toutes, sinon début et fin du journal. */
function periodsOf(task: ReadTask): { startedAt: string; stoppedAt: string }[] {
  const tims = task.times.filter((t) => t.stop);
  const chosen = tims.some((t) => t.type === 4) ? tims.filter((t) => t.type === 4) : tims;
  const periods = chosen
    .map((t) => ({ startedAt: consoleTime(t.start), stoppedAt: consoleTime(t.stop!) }))
    .filter((p): p is { startedAt: string; stoppedAt: string } => !!p.startedAt && !!p.stoppedAt && p.stoppedAt > p.startedAt);
  if (periods.length) return periods;
  const times = task.log.map((r) => r.time).filter((t): t is string => !!t);
  if (times.length >= 2) {
    const [a, b] = [consoleTime(times[0]!), consoleTime(times.at(-1)!)];
    if (a && b && b > a) return [{ startedAt: a, stoppedAt: b }];
  }
  return [];
}

/** Parcelles d'après les positions du journal (part des points), ou d'après le contour de la tâche (part de la surface). */
async function parcelsOf(tx: Tx, task: ReadTask, at: string): Promise<{ id: string; name: string; share: number; areaM2: number | null }[]> {
  const pts = task.log.filter((r) => r.lat !== null && r.lon !== null && (r.status === null || GOOD_FIX.has(r.status)));
  const step = Math.max(1, Math.ceil(pts.length / 2000));
  const sample = pts.filter((_, i) => i % step === 0);
  if (sample.length) {
    const lons = `{${sample.map((p) => p.lon).join(",")}}`;
    const lats = `{${sample.map((p) => p.lat).join(",")}}`;
    const found = await rows<{ id: string; name: string; n: number }>(
      tx,
      sql`WITH p AS (SELECT ST_SetSRID(ST_MakePoint(x, y), 4326) AS g FROM unnest(${lons}::float8[], ${lats}::float8[]) AS t(x, y))
          SELECT lp.id, lp.name, count(*)::int AS n
          FROM p JOIN land_parcel_versions v ON v.valid @> ${at}::timestamptz AND ST_Contains(v.shape, p.g)
          JOIN land_parcels lp ON lp.id = v.land_parcel_id
          GROUP BY lp.id, lp.name ORDER BY n DESC`,
    );
    return found.map((f) => ({ id: f.id, name: f.name, share: round(f.n / sample.length, 3), areaM2: null })).filter((f) => f.share >= 0.05);
  }
  const polygons = task.partfield?.polygons ?? [];
  if (!polygons.length) return [];
  const geometry = JSON.stringify({ type: "MultiPolygon", coordinates: polygons });
  const found = await rows<{ id: string; name: string; area: number; total: number }>(
    tx,
    sql`WITH g AS (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326)) AS g)
        SELECT lp.id, lp.name, ST_Area(ST_Intersection(v.shape, g.g)::geography)::float8 AS area, ST_Area(g.g::geography)::float8 AS total
        FROM g JOIN land_parcel_versions v ON v.valid @> ${at}::timestamptz AND ST_Intersects(v.shape, g.g)
        JOIN land_parcels lp ON lp.id = v.land_parcel_id ORDER BY area DESC`,
  );
  return found
    .map((f) => ({ id: f.id, name: f.name, share: f.total > 0 ? round(f.area / f.total, 3) : 0, areaM2: Math.round(f.area) }))
    .filter((f) => f.share >= 0.05);
}

/** Matériel de la ferme : par numéro de série, sinon par nom ou modèle. */
async function equipmentOf(tx: Tx, task: ReadTask): Promise<{ id: string; name: string } | null> {
  for (const d of task.devices) {
    const [e] = await rows<{ id: string; name: string }>(
      tx,
      sql`SELECT id, name FROM equipments
          WHERE (${d.serial}::text IS NOT NULL AND lower(serial_number) = lower(${d.serial}::text))
             OR (${d.designator} <> '' AND (lower(name) = lower(${d.designator}) OR lower(model) = lower(${d.designator})))
          ORDER BY (lower(serial_number) = lower(${d.serial}::text)) DESC NULLS LAST, name LIMIT 1`,
    );
    if (e) return e;
  }
  return null;
}

/** Proposition d'intervention pour une tâche réalisée, ou null (tâche non réalisée, sans période). */
async function propose(tx: Tx, inboxId: string, index: number, task: ReadTask): Promise<AgrirouterInboxTask | null> {
  // Prévue (1), modèle (5) ou annulée (6) : rien à enregistrer.
  if (task.status !== null && [1, 5, 6].includes(task.status)) return null;
  const periods = periodsOf(task);
  if (!periods.length) return null;
  const at = periods[0]!.startedAt;

  const ref = prescriptionRefOf(task.designator);
  const [prescription] = ref
    ? await rows<{ id: string; name: string; parcel_id: string; parcel_name: string; product: string | null }>(
        tx,
        sql`SELECT p.id, p.name, p.land_parcel_id AS parcel_id, lp.name AS parcel_name, p.product
            FROM prescriptions p JOIN land_parcels lp ON lp.id = p.land_parcel_id
            WHERE p.id::text LIKE ${`${ref}%`} ORDER BY p.created_at DESC LIMIT 1`,
      )
    : [];
  let parcels = await parcelsOf(tx, task, at);
  if (!parcels.length && prescription) parcels = [{ id: prescription.parcel_id, name: prescription.parcel_name, share: 1, areaM2: null }];
  const equipment = await equipmentOf(tx, task);
  const totalArea = task.totals.find((t) => t.ddi === TOTAL_AREA_DDI)?.value ?? null;
  const rates = ratesOf(task);
  const products = [...new Set([...task.products.map((p) => p.name), ...(prescription?.product ? [prescription.product] : [])])];

  const suggestions = equipment
    ? await rows<{ procedure: string }>(
        tx,
        sql`SELECT i.procedure FROM interventions i
            JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'tool' AND p.ref_id = ${equipment.id}
            WHERE i.status = 'done' GROUP BY i.procedure ORDER BY count(*) DESC, i.procedure LIMIT 5`,
      )
    : [];
  const deviceName = task.devices[0]?.designator || null;
  const hints = [
    `Tâche « ${task.designator || task.id} » reçue de la console par agrirouter.`,
    ...(prescription ? [`Carte de modulation d'origine : ${prescription.name}.`] : []),
    ...(!equipment && deviceName ? [`Matériel « ${deviceName} » non reconnu : à choisir.`] : []),
    ...(!parcels.length ? ["Aucune parcelle de la ferme sous le travail : à choisir."] : []),
    ...(products.length ? [`Produit : ${products.join(", ")}${rates.length ? ` — dose moyenne relevée ${rates.map((r) => `${r.value} ${r.unit}`).join(", ")}` : ""} (à saisir dans les intrants).`] : []),
    ...(!products.length && rates.length ? [`Dose moyenne relevée : ${rates.map((r) => `${r.value} ${r.unit}`).join(", ")}.`] : []),
  ];
  const draft: TrackDraft = {
    body: {
      staffing: "crews",
      crews: [{ tools: equipment ? [{ equipmentId: equipment.id }] : [], doers: [], periods }],
      periods: [],
      tools: [],
      doers: [],
      targets: parcels.map((p) => ({
        kind: "land_parcel" as const,
        id: p.id,
        // Surface travaillée relevée par la console d'abord (répartie selon la part de chaque parcelle), sinon celle du contour.
        ...(totalArea !== null ? { workedAreaM2: Math.round(totalArea * p.share) } : p.areaM2 !== null ? { workedAreaM2: p.areaM2 } : {}),
      })),
      inputs: [],
      outputs: [],
      purposes: [],
      trackSessionIds: [],
      agrirouterInbox: { id: inboxId, task: index },
    },
    procedureSuggestions: suggestions.map((s) => s.procedure),
    hints,
    parcelNames: Object.fromEntries(parcels.map((p) => [p.id, p.name])),
  };
  return {
    index,
    designator: task.designator || task.id,
    startedAt: periods[0]!.startedAt,
    stoppedAt: periods.at(-1)!.stoppedAt,
    parcels: parcels.map(({ id, name, share }) => ({ id, name, share })),
    equipment,
    deviceName,
    products,
    rates,
    areaM2: totalArea,
    prescription: prescription ? { id: prescription.id, name: prescription.name } : null,
    interventionId: null,
    draft,
  };
}

/** Lit un fichier reçu (déjà verrouillé) et enregistre son état : proposé, sans suite ou illisible. */
async function readOne(tx: Tx, row: { id: string; file_sha256: string }): Promise<"proposed" | "ignored" | "unreadable"> {
  let state: "proposed" | "ignored" | "unreadable";
  let parsed: unknown = null;
  let error: string | null = null;
  try {
    const bytes = await readAgrirouterFile(row.file_sha256);
    const data = readTaskData(new Uint8Array(bytes));
    const tasks: AgrirouterInboxTask[] = [];
    for (const [i, t] of data.tasks.entries()) {
      const p = await propose(tx, row.id, i, t);
      if (p) tasks.push(p);
    }
    parsed = { software: data.software, warnings: data.warnings, taskCount: data.tasks.length, tasks };
    state = tasks.length ? "proposed" : "ignored";
    if (!tasks.length) error = data.tasks.length ? "Aucune tâche réalisée dans ce fichier." : "Aucune tâche dans ce fichier.";
  } catch (e) {
    state = "unreadable";
    error = e instanceof IsoxmlReadError || e instanceof RangeError ? e.message : `Fichier illisible : ${e instanceof Error ? e.message : String(e)}`;
  }
  await tx.execute(sql`
    UPDATE agrirouter_inbox SET state = ${state}, parsed = ${parsed === null ? null : JSON.stringify(parsed)}::jsonb, error = ${error?.slice(0, 500) ?? null}
    WHERE id = ${row.id}`);
  return state;
}

/** Types lus à ce lot (les journaux EFDI viendront au lot AR5). */
const READ_TYPES = [MESSAGE_TYPES.taskdata];

/** Worker : lit les fichiers reçus non encore lus, au plus `max` par tour ; `farmId` : une seule ferme (tests). */
export async function readAgrirouterInbox(db: Database, max = 20, farmId: string | null = null): Promise<Record<"proposed" | "ignored" | "unreadable", number>> {
  const counts = { proposed: 0, ignored: 0, unreadable: 0 };
  const types = `{${READ_TYPES.join(",")}}`;
  const farms = farmId
    ? [farmId]
    : await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
        return (await rows<{ farm_id: string }>(tx, sql`SELECT farm_id FROM fourmy_agrirouter_unread_farms(${types}::text[])`)).map((r) => r.farm_id);
      });
  let done = 0;
  for (const farm of farms) {
    while (done < max) {
      const state = await withFarm(db, farm, async (tx) => {
        const [row] = await rows<{ id: string; file_sha256: string }>(
          tx,
          sql`SELECT id, file_sha256 FROM agrirouter_inbox WHERE state = 'received' AND message_type = ANY(${types}::text[])
              ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        return row ? readOne(tx, row) : null;
      });
      if (!state) break;
      counts[state]++;
      done++;
    }
  }
  return counts;
}

/**
 * Rattache une intervention enregistrée à la tâche reçue dont elle est tirée
 * (appelé dans la transaction de l'intervention) : le fichier passe « validé ».
 */
export async function linkInboxIntervention(tx: Tx, link: { id: string; task: number } | undefined, interventionId: string): Promise<void> {
  if (!link) return;
  await tx.execute(sql`
    UPDATE agrirouter_inbox SET state = 'validated',
      parsed = jsonb_set(parsed, ARRAY['tasks'], (
        SELECT coalesce(jsonb_agg(CASE WHEN (t->>'index')::int = ${link.task} THEN t || jsonb_build_object('interventionId', ${interventionId}::text) ELSE t END), '[]'::jsonb)
        FROM jsonb_array_elements(parsed->'tasks') t))
    WHERE id = ${link.id} AND parsed ? 'tasks'`);
}
