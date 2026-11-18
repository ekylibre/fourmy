import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { MESSAGE_TYPES } from "@fourmy/agrirouter";
import { decodeDeviceDescription, decodeTimeLog, EFDI_SECTION, EfdiReadError, readTaskData, IsoxmlReadError, type ReadTask } from "@fourmy/isoxml";
import type { AgrirouterInboxDevice, AgrirouterInboxTask, TrackDraft } from "@fourmy/contracts";
import { prescriptionRefOf } from "../repos/prescriptions.js";
import { computeTrackSessions } from "../repos/track-sessions.js";
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

type MatchedEquipment = { id: string; name: string; kind: string; width: number | null };

/** Matériel de la ferme d'après la machine : par numéro de série, sinon par nom ou modèle. */
async function matchEquipment(tx: Tx, d: { serial: string | null; designator: string }): Promise<MatchedEquipment | null> {
  const [e] = await rows<MatchedEquipment>(
    tx,
    sql`SELECT id, name, kind, (avatar->>'workingWidthM')::float8 AS width FROM equipments
        WHERE (${d.serial}::text IS NOT NULL AND lower(serial_number) = lower(${d.serial}::text))
           OR (${d.designator} <> '' AND (lower(name) = lower(${d.designator}) OR lower(model) = lower(${d.designator})))
        ORDER BY (lower(serial_number) = lower(${d.serial}::text)) DESC NULLS LAST, name LIMIT 1`,
  );
  return e ?? null;
}

/** Matériel d'une tâche : le premier de ses matériels reconnu. */
async function equipmentOf(tx: Tx, task: ReadTask): Promise<{ id: string; name: string } | null> {
  for (const d of task.devices) {
    const e = await matchEquipment(tx, d);
    if (e) return { id: e.id, name: e.name };
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

// --- Description de machine EFDI (lot AR5) -------------------------------------------

/** DDI de largeur de travail (mm) : par défaut (68), réelle (67), de consigne (66). */
const WIDTH_DDIS = [68, 67, 66];

async function readDeviceDescription(tx: Tx, bytes: Uint8Array): Promise<{ state: "proposed" | "ignored"; parsed: unknown; error: string | null }> {
  const dd = decodeDeviceDescription(bytes);
  const devices: AgrirouterInboxDevice[] = [];
  for (const [index, d] of dd.devices.entries()) {
    const equipment = await matchEquipment(tx, d);
    const widthMm = WIDTH_DDIS.map((ddi) => d.properties.find((p) => p.ddi === ddi && p.value > 0)?.value).find((v) => v !== undefined) ?? null;
    const workingWidthM = widthMm === null ? null : round(widthMm / 1000, 2);
    const currentWidthM = equipment?.width ?? null;
    devices.push({
      index,
      designator: d.designator,
      serial: d.serial,
      equipment: equipment ? { id: equipment.id, name: equipment.name } : null,
      workingWidthM,
      currentWidthM,
      sections: d.elements.filter((e) => e.type === EFDI_SECTION).length,
      proposeWidth: !!equipment && workingWidthM !== null && workingWidthM <= 60 && (currentWidthM === null || Math.abs(currentWidthM - workingWidthM) >= 0.01),
      applied: false,
    });
  }
  const proposed = devices.some((d) => d.proposeWidth);
  return {
    state: proposed ? "proposed" : "ignored",
    parsed: { taskController: dd.taskController, devices },
    error: proposed ? null : devices.length ? "Description de machine gardée : rien à mettre à jour sur les fiches." : "Aucune machine dans cette description.",
  };
}

// --- Journal EFDI (lot AR5) -------------------------------------------------------------

/** Délai d'attente de la description de machine d'un journal (elles arrivent en général ensemble). */
const WAIT_FOR_DEVICE_MS = 60 * 60_000;
const WORK_STATE_DDI = 141; // 1 : au travail
const SPEED_DDI = 397; // mm/s
const ACTUAL_WIDTH_DDI = 67; // mm
const SELF_PROPELLED = new Set(["tractor", "self_propelled_equipment"]);

type InboxRow = { id: string; file_sha256: string; message_type: string; received_at: Date | string; teamset_context_id: string | null };

/**
 * Verse les positions d'un journal EFDI dans les parcours GPS du matériel
 * (rattachement de source « agrirouter »), comme celles de Traccar. Le
 * matériel vient de la description de machine du même attelage (teamset).
 */
async function readTimeLog(tx: Tx, row: InboxRow, bytes: Uint8Array, farmId: string): Promise<{ state: "merged" | "ignored" | "wait"; parsed: unknown; error: string | null }> {
  const log = decodeTimeLog(bytes);
  const [dd] = row.teamset_context_id
    ? await rows<{ parsed: { devices?: AgrirouterInboxDevice[] } | null }>(
        tx,
        sql`SELECT parsed FROM agrirouter_inbox
            WHERE message_type = ${MESSAGE_TYPES.deviceDescription} AND teamset_context_id = ${row.teamset_context_id} AND parsed IS NOT NULL
            ORDER BY received_at DESC LIMIT 1`,
      )
    : [];
  const devices = dd?.parsed?.devices ?? [];
  if (!devices.length) {
    if (Date.now() - new Date(row.received_at).getTime() < WAIT_FOR_DEVICE_MS) return { state: "wait", parsed: null, error: null };
    return { state: "ignored", parsed: null, error: "Machine inconnue : aucune description de machine reçue pour ce journal." };
  }
  const matched = devices.filter((d) => d.equipment);
  if (!matched.length) {
    return { state: "ignored", parsed: null, error: `Matériel non reconnu : ${devices.map((d) => `« ${d.designator} »`).join(", ")}.` };
  }
  const kinds = await rows<{ id: string; kind: string }>(
    tx,
    sql`SELECT id, kind FROM equipments WHERE id IN (${sql.join(matched.map((d) => sql`${d.equipment!.id}::uuid`), sql`, `)})`,
  );
  const kindOf = new Map(kinds.map((k) => [k.id, k.kind]));
  const carrier = matched.find((d) => SELF_PROPELLED.has(kindOf.get(d.equipment!.id) ?? "")) ?? matched[0]!;
  const tool = matched.find((d) => d !== carrier) ?? null;
  const equipment = carrier.equipment!;

  // Rattachement : un matériel déjà suivi par Traccar n'est pas doublé.
  const [binding] = await rows<{ id: string; source: string }>(
    tx,
    sql`SELECT id, source FROM tracker_bindings WHERE equipment_id = ${equipment.id} AND upper_inf(valid) ORDER BY lower(valid) DESC LIMIT 1`,
  );
  if (binding && binding.source !== "agrirouter") {
    return { state: "ignored", parsed: null, error: `${equipment.name} est déjà suivi par Traccar : journal non versé, pour ne pas doubler ses parcours.` };
  }
  const bindingId = binding?.id ?? crypto.randomUUID();
  if (!binding) {
    await tx.execute(sql`
      INSERT INTO tracker_bindings (id, farm_id, equipment_id, source, device_id, valid)
      VALUES (${bindingId}, ${farmId}, ${equipment.id}, 'agrirouter', ${`efdi:${carrier.serial ?? carrier.designator}`}, tstzrange('-infinity', NULL))`);
  }
  const widthM = (v: number | undefined) => (v !== undefined && v > 0 ? v / 1000 : (tool?.workingWidthM ?? carrier.workingWidthM ?? null));
  const points = log.times
    .filter((t) => t.position && (t.start ?? t.position.gpsTime) && GOOD_FIX.has(t.position.status))
    .map((t) => {
      const value = (ddi: number) => t.values.find((v) => v.ddi === ddi)?.value;
      const work = value(WORK_STATE_DDI);
      const speed = value(SPEED_DDI);
      const width = widthM(value(ACTUAL_WIDTH_DDI));
      return {
        time: (t.start ?? t.position!.gpsTime)!,
        lat: t.position!.lat,
        lon: t.position!.lon,
        speed: speed === undefined ? null : round(speed * 0.0036, 2),
        attrs: { ...(work !== undefined ? { working: work === 1 } : {}), ...(width !== null ? { widthM: width } : {}), ...(tool ? { tool: tool.equipment!.name } : {}), source: "agrirouter" },
      };
    });
  if (!points.length) return { state: "ignored", parsed: null, error: "Journal sans position exploitable." };
  await tx.execute(sql`
    WITH u AS (
      SELECT * FROM unnest(${`{${points.map((p) => p.time).join(",")}}`}::timestamptz[], ${`{${points.map((p) => p.lon).join(",")}}`}::float8[],
                           ${`{${points.map((p) => p.lat).join(",")}}`}::float8[], ${`{${points.map((p) => p.speed ?? "NULL").join(",")}}`}::float8[])
             WITH ORDINALITY AS u(t, x, y, s, n)
    ), a AS (SELECT value AS a, ordinality AS n FROM jsonb_array_elements(${JSON.stringify(points.map((p) => p.attrs))}::jsonb) WITH ORDINALITY)
    INSERT INTO positions (farm_id, binding_id, time, point, speed, attrs)
    SELECT ${farmId}, ${bindingId}, u.t, ST_SetSRID(ST_MakePoint(u.x, u.y), 4326), u.s, a.a
    FROM u JOIN a USING (n)
    ON CONFLICT (binding_id, time) DO NOTHING`);
  const times = points.map((p) => p.time).sort();
  return {
    state: "merged",
    parsed: { telemetry: { equipment, tool: tool?.equipment?.name ?? null, positions: points.length, from: times[0]!, to: times.at(-1)! } },
    error: null,
  };
}

/** Lit un fichier reçu (déjà verrouillé) et enregistre son état. `wait` : à relire plus tard (description de machine attendue). */
async function readOne(tx: Tx, row: InboxRow, farmId: string): Promise<"proposed" | "ignored" | "unreadable" | "merged" | "wait"> {
  if (row.message_type !== MESSAGE_TYPES.taskdata) {
    let outcome: { state: "proposed" | "ignored" | "merged" | "wait" | "unreadable"; parsed: unknown; error: string | null };
    try {
      const bytes = new Uint8Array(await readAgrirouterFile(row.file_sha256));
      outcome = row.message_type === MESSAGE_TYPES.deviceDescription ? await readDeviceDescription(tx, bytes) : await readTimeLog(tx, row, bytes, farmId);
    } catch (e) {
      outcome = { state: "unreadable", parsed: null, error: e instanceof EfdiReadError ? e.message : `Fichier illisible : ${e instanceof Error ? e.message : String(e)}` };
    }
    if (outcome.state === "wait") return "wait";
    await tx.execute(sql`
      UPDATE agrirouter_inbox SET state = ${outcome.state}, parsed = ${outcome.parsed === null ? null : JSON.stringify(outcome.parsed)}::jsonb,
        error = ${outcome.error?.slice(0, 500) ?? null}
      WHERE id = ${row.id}`);
    return outcome.state;
  }
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

/** Types lus : TaskData (lot AR4), descriptions de machine et journaux EFDI (lot AR5). Les descriptions d'abord. */
const READ_TYPES = [MESSAGE_TYPES.taskdata, MESSAGE_TYPES.deviceDescription, MESSAGE_TYPES.timeLog];

/** Worker : lit les fichiers reçus non encore lus, au plus `max` par tour ; `farmId` : une seule ferme (tests). */
export async function readAgrirouterInbox(
  db: Database,
  max = 50,
  farmId: string | null = null,
): Promise<Record<"proposed" | "ignored" | "unreadable" | "merged", number>> {
  const counts = { proposed: 0, ignored: 0, unreadable: 0, merged: 0 };
  const types = `{${READ_TYPES.join(",")}}`;
  const farms = farmId
    ? [farmId]
    : await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
        return (await rows<{ farm_id: string }>(tx, sql`SELECT farm_id FROM fourmy_agrirouter_unread_farms(${types}::text[])`)).map((r) => r.farm_id);
      });
  let done = 0;
  for (const farm of farms) {
    // Fichiers en attente de leur description de machine : sautés pendant ce tour.
    const waiting: string[] = [];
    let merged = false;
    while (done < max) {
      const outcome = await withFarm(db, farm, async (tx) => {
        const [row] = await rows<InboxRow>(
          tx,
          sql`SELECT id, file_sha256, message_type, received_at, teamset_context_id FROM agrirouter_inbox
              WHERE state = 'received' AND message_type = ANY(${types}::text[])
                AND NOT (id = ANY(${`{${waiting.join(",")}}`}::uuid[]))
              ORDER BY (message_type = ${MESSAGE_TYPES.deviceDescription}) DESC, received_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        return row ? { id: row.id, state: await readOne(tx, row, farm) } : null;
      });
      if (!outcome) break;
      if (outcome.state === "wait") waiting.push(outcome.id);
      else {
        counts[outcome.state]++;
        merged ||= outcome.state === "merged";
      }
      done++;
    }
    // Journaux versés : parcours recalculés tout de suite (le worker ne le fait seul que pour Traccar).
    if (merged) await computeTrackSessions(db, farm);
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
