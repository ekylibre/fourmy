/**
 * Lecture des positions Traccar — fonctions pures.
 * Particularités constatées sur traccar.osfarm.org (2026-11-07) :
 *  - vitesse en **nœuds** ;
 *  - attributs métier d'un module agricole : `isWorking`, `workingWidth`
 *    (« 18 m »), `tool` (« Arion UF1201 »), `field` (« 15,56 ha »),
 *    `appliedArea` (« 5,54 ») — nombres au **format français**.
 */

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId?: string;
  category?: string | null;
  lastUpdate?: string | null;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  fixTime: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number; // nœuds
  course?: number;
  valid?: boolean;
  attributes?: Record<string, unknown>;
}

/** Fourmy stocke la vitesse en km/h. */
export const knotsToKmh = (knots: number) => knots * 1.852;

/** « 2,8 m », « 15,56 ha », « 5,54 », 18 → nombre ; null si illisible. */
export function frNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(/\s/g, ""));
  return m ? Number(m[0].replace(",", ".")) : null;
}

/**
 * Booléen tolérant : Traccar (module agricole d'osfarm) envoie `isWorking`
 * sous forme de chaîne « True » / « False » et non de booléen JSON.
 */
export function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  if (typeof v === "number") return v !== 0;
  return null;
}

export interface PositionRecord {
  time: string;
  lon: number;
  lat: number;
  speedKmh: number | null;
  heading: number | null;
  attrs: {
    working: boolean | null;
    widthM: number | null;
    tool: string | null;
    fieldHa: number | null;
    appliedHa: number | null;
  };
}

/** Convertit une position Traccar ; null si invalide ou à (0, 0). */
export function toPositionRecord(p: TraccarPosition): PositionRecord | null {
  if (p.valid === false) return null;
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
  if (p.latitude === 0 && p.longitude === 0) return null;
  if (Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) return null;
  const a = p.attributes ?? {};
  const working = bool(a.isWorking);
  const tool = typeof a.tool === "string" && a.tool.trim() ? a.tool.trim() : null;
  return {
    time: new Date(p.fixTime).toISOString(),
    lon: p.longitude,
    lat: p.latitude,
    speedKmh: typeof p.speed === "number" ? Math.round(knotsToKmh(p.speed) * 100) / 100 : null,
    heading: typeof p.course === "number" ? p.course : null,
    attrs: {
      working,
      widthM: frNumber(a.workingWidth),
      tool,
      fieldHa: frNumber(a.field),
      appliedHa: frNumber(a.appliedArea),
    },
  };
}

/** Déduplique par instant (Traccar peut renvoyer deux fixes à la même seconde). */
export function dedupeByTime(records: PositionRecord[]): PositionRecord[] {
  const byTime = new Map<string, PositionRecord>();
  for (const r of records) if (!byTime.has(r.time)) byTime.set(r.time, r);
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface EquipmentRef {
  id: string;
  name: string;
}

/**
 * Apparie boîtiers et matériels par nom normalisé (casse, accents,
 * ponctuation). Un nom ambigu (plusieurs matériels) n'est pas apparié.
 */
export function matchDevices(devices: TraccarDevice[], equipments: EquipmentRef[]) {
  const byName = new Map<string, EquipmentRef[]>();
  for (const e of equipments) {
    const k = normalize(e.name);
    byName.set(k, [...(byName.get(k) ?? []), e]);
  }
  const matched: { device: TraccarDevice; equipment: EquipmentRef }[] = [];
  const unmatched: { device: TraccarDevice; reason: string }[] = [];
  for (const d of devices) {
    const candidates = byName.get(normalize(d.name)) ?? [];
    if (candidates.length === 1) matched.push({ device: d, equipment: candidates[0]! });
    else
      unmatched.push({
        device: d,
        reason: candidates.length === 0 ? "aucun matériel de ce nom" : "plusieurs matériels de ce nom",
      });
  }
  return { matched, unmatched };
}
