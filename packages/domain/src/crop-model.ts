/**
 * Modèle de croissance des cultures (lot AB, FR-TWIN-8, docs/modele-croissance.md) :
 * stades par degrés-jours depuis le semis saisi, et bilan hydrique FAO-56 à
 * coefficient cultural unique. Pur : la météo journalière est fournie.
 *
 * Seuils calés sur le maïs de Pierre (16 saisons 2025-2026) : fin de montée
 * du NDVI et plateau entre 700 et 1 150 °Cj (base 6), NDVI sous 0,3 vers
 * 1 850 °Cj, récolte vers 2 050 °Cj.
 */
import type { CropModelKind, WeatherBasis } from "@fourmy/contracts";
import { addDays } from "./remote-sensing.js";

export interface StageDef {
  code: string;
  label: string;
  /** Somme de degrés-jours depuis le semis. */
  gdd: number;
}

export interface CropModelDef {
  kind: CropModelKind;
  label: string;
  /** Température de base et plafond des degrés-jours (°C). */
  baseC: number;
  capC: number;
  stages: StageDef[];
  /** Coefficient cultural (FAO-56) par paliers de degrés-jours, interpolé. */
  kc: [gdd: number, kc: number][];
  /** Fraction de la réserve utilisable sans stress (FAO-56, p). */
  p: number;
  /** Code des stades : enracinement complet, floraison (fenêtre sensible), maturité, récoltable. */
  rootFullAt: string;
  flowering: string;
  maturity: string;
  /** Fenêtre de sensibilité au manque d'eau autour de la floraison (°Cj avant, après). */
  sensitive: [number, number];
}

export const CROP_MODELS: Record<CropModelKind, CropModelDef> = {
  maize: {
    kind: "maize",
    label: "Maïs",
    baseC: 6,
    capC: 30,
    stages: [
      { code: "emergence", label: "Levée", gdd: 100 },
      { code: "v6", label: "6 feuilles", gdd: 380 },
      { code: "v10", label: "10 feuilles", gdd: 580 },
      { code: "flowering", label: "Floraison", gdd: 950 },
      { code: "maturity", label: "Maturité physiologique", gdd: 1850 },
      { code: "harvestable", label: "Récoltable (grain)", gdd: 2050 },
    ],
    kc: [
      [0, 0.3],
      [380, 0.3],
      [850, 1.2],
      [1550, 1.2],
      [1850, 0.6],
      [2050, 0.35],
    ],
    p: 0.55,
    rootFullAt: "flowering",
    flowering: "flowering",
    maturity: "maturity",
    sensitive: [150, 250],
  },
  winter_cereal: {
    kind: "winter_cereal",
    label: "Céréale d'hiver",
    baseC: 0,
    capC: 30,
    stages: [
      { code: "emergence", label: "Levée", gdd: 150 },
      { code: "tillering", label: "Début tallage", gdd: 450 },
      { code: "ear_1cm", label: "Épi 1 cm", gdd: 1100 },
      { code: "heading", label: "Épiaison", gdd: 1500 },
      { code: "flowering", label: "Floraison", gdd: 1600 },
      { code: "maturity", label: "Maturité physiologique", gdd: 2350 },
      { code: "harvestable", label: "Récoltable (grain)", gdd: 2550 },
    ],
    kc: [
      [0, 0.4],
      [450, 0.7],
      [1300, 1.15],
      [2000, 1.15],
      [2350, 0.3],
    ],
    p: 0.55,
    rootFullAt: "heading",
    flowering: "flowering",
    maturity: "maturity",
    sensitive: [200, 300],
  },
};

const CEREALS = /^(x_triticosecale|triticum|hordeum|avena|secale)/;

/** Modèle d'une espèce (cultivation, sinon species) ; `null` : pas de modèle (vigne, prairie, inconnue). */
export function cropModelFor(species: string | null): CropModelDef | null {
  if (!species) return null;
  if (/^zea_mays/.test(species)) return CROP_MODELS.maize;
  if (CEREALS.test(species)) return CROP_MODELS.winter_cereal;
  return null;
}

/** Part de la réserve accessible aux racines à la levée (le reste s'ouvre jusqu'à l'enracinement complet). */
const ROOT_START = 0.3;

export interface ModelWeatherDay {
  day: string;
  tminC: number;
  tmaxC: number;
  rainMm: number;
  et0Mm: number;
  basis: WeatherBasis;
}

/** Degrés-jours d'une journée (méthode de la moyenne, températures plafonnées). */
export function dailyGdd(tminC: number, tmaxC: number, baseC: number, capC: number): number {
  const mean = (Math.min(tmaxC, capC) + Math.min(tminC, capC)) / 2;
  return Math.max(0, mean - baseC);
}

function kcAt(def: CropModelDef, gdd: number): number {
  const k = def.kc;
  if (gdd <= k[0]![0]) return k[0]![1];
  for (let i = 1; i < k.length; i++) {
    const [g1, v1] = k[i]!;
    if (gdd <= g1) {
      const [g0, v0] = k[i - 1]!;
      return v0 + ((v1 - v0) * (gdd - g0)) / (g1 - g0);
    }
  }
  return k[k.length - 1]![1];
}

export interface SimDay {
  date: string;
  basis: WeatherBasis;
  gdd: number;
  kc: number;
  rainMm: number;
  etcMm: number;
  /** Réserve accessible aux racines ce jour (mm). */
  tawMm: number;
  /** Eau disponible, en part de la réserve accessible (0..1). */
  reserve: number;
  /** Coefficient de stress hydrique FAO-56 (1 : pas de stress). */
  ks: number;
  /** Irrigation simulée ce jour (parcelle irriguée), mm. */
  irrigationMm: number;
}

export interface SimStage extends StageDef {
  /** Date d'atteinte (null : pas atteinte dans la météo disponible). */
  on: string | null;
  basis: WeatherBasis | null;
}

export interface Simulation {
  model: CropModelDef;
  sownOn: string;
  days: SimDay[];
  stages: SimStage[];
}

/**
 * Simulation d'une saison, du semis au dernier jour de météo (ou à la
 * récolte saisie). Bilan hydrique : réservoir unique à la capacité au champ
 * au semis, pluie entière (le surplus draine), pas de ruissellement ; la
 * réserve accessible croît avec l'enracinement. Parcelle irriguée : dès que
 * la réserve facilement utilisable est épuisée (de la levée à la maturité),
 * un apport la remplit (pilotage FAO-56) ; on obtient le besoin d'irrigation
 * au lieu d'un stress.
 */
export function simulateSeason(input: {
  model: CropModelDef;
  sownOn: string;
  /** Météo journalière continue à partir du semis (les jours avant sont ignorés). */
  weather: ModelWeatherDay[];
  tawMm: number;
  /** Récolte (ou destruction) saisie : la simulation s'arrête ce jour. */
  endOn?: string | null;
  irrigated?: boolean;
}): Simulation {
  const { model, sownOn, tawMm } = input;
  const rootFull = model.stages.find((s) => s.code === model.rootFullAt)!.gdd;
  const emergence = model.stages[0]!.gdd;
  const maturity = model.stages.find((s) => s.code === model.maturity)!.gdd;
  const days: SimDay[] = [];
  const stages: SimStage[] = model.stages.map((s) => ({ ...s, on: null, basis: null }));
  let gdd = 0;
  let depletion = 0;
  for (const w of input.weather) {
    if (w.day < sownOn) continue;
    if (input.endOn && w.day > input.endOn) break;
    gdd += dailyGdd(w.tminC, w.tmaxC, model.baseC, model.capC);
    for (const s of stages) if (s.on === null && gdd >= s.gdd) Object.assign(s, { on: w.day, basis: w.basis });
    const rooting = ROOT_START + (1 - ROOT_START) * Math.min(1, Math.max(0, (gdd - emergence) / (rootFull - emergence)));
    const taw = tawMm * rooting;
    const raw = model.p * taw;
    const kc = kcAt(model, gdd);
    depletion = Math.min(depletion, taw);
    let irrigation = 0;
    if (input.irrigated && depletion > raw && gdd >= emergence && gdd < maturity) {
      irrigation = depletion;
      depletion = 0;
    }
    const ks = depletion <= raw ? 1 : Math.max(0, (taw - depletion) / (taw - raw));
    const etc = ks * kc * w.et0Mm;
    depletion = Math.min(taw, Math.max(0, depletion - w.rainMm + etc));
    days.push({
      date: w.day,
      basis: w.basis,
      gdd: Math.round(gdd),
      kc: Math.round(kc * 100) / 100,
      rainMm: w.rainMm,
      etcMm: Math.round(etc * 10) / 10,
      tawMm: Math.round(taw),
      reserve: taw > 0 ? Math.round(((taw - depletion) / taw) * 1000) / 1000 : 1,
      ks: Math.round(ks * 1000) / 1000,
      irrigationMm: Math.round(irrigation * 10) / 10,
    });
  }
  return { model, sownOn, days, stages };
}

export interface StateAt {
  /** Stade atteint au jour (null : semé, pas encore levé). */
  stage: SimStage | null;
  next: SimStage | null;
  day: SimDay | null;
  /** Jours de stress (ks < 1) de la levée à la maturité, et dans la fenêtre sensible de la floraison, jusqu'au jour. */
  stressDays: number;
  floweringStressDays: number;
  /** Irrigation simulée depuis le semis jusqu'au jour (mm). */
  irrigationMm: number;
}

/** État de la simulation à une date. */
export function stateAt(sim: Simulation, date: string): StateAt {
  const upTo = sim.days.filter((d) => d.date <= date);
  const day = upTo[upTo.length - 1] ?? null;
  const reached = sim.stages.filter((s) => s.on !== null && s.on <= date);
  const stage = reached[reached.length - 1] ?? null;
  const next = sim.stages.find((s) => s.on === null || s.on > date) ?? null;
  const flowering = sim.stages.find((s) => s.code === sim.model.flowering)!.gdd;
  const [before, after] = sim.model.sensitive;
  // Le stress ne compte que pendant que la culture pousse (de la levée à la maturité).
  const emergence = sim.stages[0]!.gdd;
  const maturity = sim.stages.find((s) => s.code === sim.model.maturity)!.gdd;
  const growing = upTo.filter((d) => d.gdd >= emergence && d.gdd < maturity);
  return {
    stage,
    next,
    day,
    stressDays: growing.filter((d) => d.ks < 1).length,
    floweringStressDays: growing.filter((d) => d.ks < 1 && d.gdd >= flowering - before && d.gdd <= flowering + after).length,
    irrigationMm: Math.round(upTo.reduce((s, d) => s + d.irrigationMm, 0)),
  };
}

/**
 * Normales journalières : pour chaque jour de l'année (mois-jour), moyenne
 * des années fournies. Le 29 février prend la moyenne disponible, sinon celle
 * du 28.
 */
export function dailyNormals(history: Omit<ModelWeatherDay, "basis">[]): Map<string, Omit<ModelWeatherDay, "basis" | "day">> {
  const acc = new Map<string, { tmin: number; tmax: number; rain: number; et0: number; n: number }>();
  for (const h of history) {
    const md = h.day.slice(5);
    const a = acc.get(md) ?? { tmin: 0, tmax: 0, rain: 0, et0: 0, n: 0 };
    a.tmin += h.tminC;
    a.tmax += h.tmaxC;
    a.rain += h.rainMm;
    a.et0 += h.et0Mm;
    a.n++;
    acc.set(md, a);
  }
  const out = new Map<string, Omit<ModelWeatherDay, "basis" | "day">>();
  for (const [md, a] of acc) out.set(md, { tminC: a.tmin / a.n, tmaxC: a.tmax / a.n, rainMm: a.rain / a.n, et0Mm: a.et0 / a.n });
  if (!out.has("02-29") && out.has("02-28")) out.set("02-29", out.get("02-28")!);
  return out;
}

/**
 * Météo continue d'un jour à un autre : la météo connue (observée ou prévue),
 * complétée par les normales au-delà. Un jour connu manquant au milieu prend
 * aussi la normale.
 */
export function weatherSeries(
  from: string,
  to: string,
  known: Map<string, Omit<ModelWeatherDay, "day">>,
  normals: Map<string, Omit<ModelWeatherDay, "basis" | "day">>,
): ModelWeatherDay[] {
  const out: ModelWeatherDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = known.get(d);
    if (k) out.push({ day: d, ...k });
    else {
      const n = normals.get(d.slice(5));
      if (!n) break; // ni connue ni normale : la série s'arrête
      out.push({ day: d, ...n, basis: "normals" });
    }
  }
  return out;
}
