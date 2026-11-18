/**
 * Conditions de pulvérisation (MET-3, conception_vue_intervention.md §4) : un
 * feu par pas de temps météo, d'après les seuils de la ferme. Les valeurs
 * par défaut sont celles d'Ekylibre (`weather_spraying_cells_controller.rb`) ;
 * le vent ne peut jamais dépasser le seuil réglementaire (3 Beaufort, arrêté
 * du 4 mai 2017). Une seule règle pour toute l'application : tableau de bord,
 * fiche parcelle, saisie et fiche d'une intervention. Fonctions pures.
 */

export type Light = "ok" | "info" | "warning" | "danger" | "unknown";

export interface SprayingThresholds {
  /** Vent (km/h) : favorable jusqu'à `green`, défavorable à partir de `red`. */
  windKmh: { green: number; red: number };
  /** Température (°C) : favorable de `greenMin` à `greenMax` ; défavorable à `redMin` ou moins, `redMax` ou plus. */
  temperatureC: { greenMin: number; greenMax: number; redMin: number; redMax: number };
  /** Hygrométrie (%) : favorable de `greenMin` à `greenMax` ; défavorable à `redMin` ou moins, `redMax` ou plus. */
  humidityPct: { greenMin: number; greenMax: number; redMin: number; redMax: number };
  /** Pluie (mm par heure) : favorable jusqu'à `green`, défavorable au-delà de `red`. */
  rainMmPerHour: { green: number; red: number };
}

/** Au-delà de 3 Beaufort (19 km/h), traiter est interdit (arrêté du 4 mai 2017, art. 2). */
export const REGULATORY_WIND_KMH = 19;

/** Seuils d'Ekylibre : vent ≤ 2 m/s favorable, < 5 m/s à surveiller ; hygrométrie 75–95 % ; 5–25 °C ; pluie ≤ 0,1 mm/h. */
export const DEFAULT_SPRAYING_THRESHOLDS: SprayingThresholds = {
  windKmh: { green: 7.2, red: 18 },
  temperatureC: { greenMin: 5, greenMax: 25, redMin: 0, redMax: 30 },
  humidityPct: { greenMin: 75, greenMax: 95, redMin: 50, redMax: 99 },
  rainMmPerHour: { green: 0.1, red: 0.3 },
};

/** Seuils de la ferme bornés : le vent défavorable ne dépasse jamais le seuil réglementaire. */
export function effectiveThresholds(t: SprayingThresholds): SprayingThresholds {
  const red = Math.min(t.windKmh.red, REGULATORY_WIND_KMH);
  return { ...t, windKmh: { green: Math.min(t.windKmh.green, red), red } };
}

/** Pas de temps météo (heure, ou 3 h) : valeurs nulles si inconnues. */
export interface SprayingHourInput {
  windKmh: number | null;
  humidityPct: number | null;
  temperatureC: number | null;
  precipitationMm: number | null;
  /** Durée du pas (h), pour ramener la pluie à l'heure. */
  stepHours?: number;
}

export type SprayingLevel = "ok" | "warning" | "danger";

const fr = (v: number, d = 0) => v.toLocaleString("fr-FR", { maximumFractionDigits: d });
const worse = (a: SprayingLevel, b: SprayingLevel): SprayingLevel => (a === "danger" || b === "danger" ? "danger" : a === "warning" || b === "warning" ? "warning" : "ok");

/** Feu d'un pas de temps et raisons de ce qui n'est pas favorable (« vent 12 km/h »). */
export function sprayingHour(h: SprayingHourInput, thresholds: SprayingThresholds = DEFAULT_SPRAYING_THRESHOLDS): { level: SprayingLevel; reasons: string[] } {
  const t = effectiveThresholds(thresholds);
  let level: SprayingLevel = "ok";
  const reasons: string[] = [];
  const flag = (l: SprayingLevel, reason: string) => {
    level = worse(level, l);
    if (l !== "ok") reasons.push(reason);
  };
  const band = (v: number, b: { greenMin: number; greenMax: number; redMin: number; redMax: number }): SprayingLevel =>
    v >= b.greenMin && v <= b.greenMax ? "ok" : v > b.redMin && v < b.redMax ? "warning" : "danger";
  if (h.windKmh !== null) flag(h.windKmh <= t.windKmh.green ? "ok" : h.windKmh < t.windKmh.red ? "warning" : "danger", `vent ${fr(h.windKmh)} km/h`);
  if (h.humidityPct !== null) flag(band(h.humidityPct, t.humidityPct), `hygrométrie ${fr(h.humidityPct)} %`);
  if (h.temperatureC !== null) flag(band(h.temperatureC, t.temperatureC), `température ${fr(h.temperatureC)} °C`);
  if (h.precipitationMm !== null) {
    const perHour = h.precipitationMm / (h.stepHours || 1);
    flag(perHour <= t.rainMmPerHour.green ? "ok" : perHour <= t.rainMmPerHour.red ? "warning" : "danger", `pluie ${fr(h.precipitationMm, 1)} mm`);
  }
  return { level, reasons };
}

/**
 * Bilan d'une période (l'intervention) à partir des pas de temps qui la
 * recouvrent : le feu le plus défavorable, et les raisons distinctes de ce
 * feu. `unknown` sans pas de temps.
 */
export function sprayingPeriod<T extends { at: string; stepHours: number; level: SprayingLevel; reasons: string[] }>(
  slots: readonly T[],
  from: string,
  to: string,
): { level: SprayingLevel | "unknown"; reasons: string[]; slots: T[] } {
  const [a, b] = [Date.parse(from), Date.parse(to)];
  const inside = slots.filter((s) => {
    const start = Date.parse(s.at);
    return start < b && start + s.stepHours * 3_600_000 > a;
  });
  if (!inside.length) return { level: "unknown", reasons: [], slots: [] };
  const level = inside.reduce<SprayingLevel>((w, s) => worse(w, s.level), "ok");
  // Raisons du pire feu, sans répéter le même critère (la valeur la plus marquée d'abord).
  const reasons = [...new Map(inside.filter((s) => s.level === level).flatMap((s) => s.reasons).map((r) => [r.split(" ")[0]!, r])).values()];
  return { level, reasons, slots: inside };
}

/** Feu de l'IFT d'une ligne (dose appliquée face à la dose de référence) : ≤ 1 vert, ≤ 1,2 orange, au-delà rouge. */
export function iftLight(ift: number | null | undefined): Light {
  if (ift === null || ift === undefined || !Number.isFinite(ift)) return "unknown";
  return ift <= 1 + 1e-9 ? "ok" : ift <= 1.2 + 1e-9 ? "warning" : "danger";
}
