import type { CropGroup } from "@fourmy/fertilization-refs";
import { SPRING_CROPS } from "./crops.js";

/**
 * Conditions d'épandage et couverture des sols (lot AJ) : PAN 7, annexe I,
 * VI et VII ; guide du PAR 7 Nouvelle-Aquitaine (16/10/2026), tableaux 11
 * et 12. Fourmy ne voit ni le sol ni la pente : il rappelle la règle quand
 * la météo ou la distance au cours d'eau la rend probable, sans bloquer.
 */

export type ConditionLevel = "ok" | "info" | "warning";
export interface ConditionIndicator {
  code: "fert_frost" | "fert_wet" | "fert_water" | "fert_slope";
  level: Exclude<ConditionLevel, "ok">;
  message: string;
}

const fmtM = (m: number) => `${Math.round(m)} m`;

/** Conditions d'épandage d'un produit (FR-FERT-26). */
export function checkSpreadingConditions(input: {
  /** Type du fertilisant (0, Ia, Ib, II, III), null s'il est inconnu. */
  type: string | null;
  /** Produit solide : fumier compact, compost (seuls permis sur sol gelé). */
  solid: boolean;
  /** Produit liquide (pente de 10 % au lieu de 15 %). */
  liquid: boolean;
  foliar: boolean;
  /** Température la plus basse de la période (°C) et pluie du jour (mm). */
  weather: { minTemperatureC: number | null; precipitationMm: number | null } | null;
  /** Cours d'eau le plus proche de la parcelle (fossés exclus), si les cours d'eau sont chargés. */
  water: { name: string | null; distanceM: number } | null;
}): ConditionIndicator[] {
  if (input.foliar) return [];
  const out: ConditionIndicator[] = [];
  const t = input.weather?.minTemperatureC;
  if (t != null && t <= 0) {
    out.push(
      input.solid && (input.type === "0" || input.type === "Ia" || input.type === "Ib")
        ? { code: "fert_frost", level: "info", message: `Gel (${t} °C) : sur sol gelé, seuls les fumiers compacts et composts peuvent être épandus.` }
        : { code: "fert_frost", level: "warning", message: `Gel (${t} °C) : épandage interdit sur sol gelé, même en surface, et sur sol enneigé.` },
    );
  }
  const rain = input.weather?.precipitationMm;
  if (rain != null && rain >= 15) out.push({ code: "fert_wet", level: "info", message: `${rain} mm de pluie : épandage interdit sur sol détrempé ou inondé.` });
  const w = input.water;
  if (w && input.type) {
    const name = w.name ? `« ${w.name} »` : "un cours d'eau";
    if (input.type === "III") {
      if (w.distanceM < 2) out.push({ code: "fert_water", level: "info", message: `${name} à ${fmtM(w.distanceM)} : pas d'engrais minéral à moins de 2 m des berges ni sur les bandes enherbées.` });
    } else if (w.distanceM < 35) {
      out.push({
        code: "fert_water",
        level: "warning",
        message: `${name} à ${fmtM(w.distanceM)} : épandage de type ${input.type} interdit à moins de 35 m des berges (10 m avec une couverture végétale permanente de 10 m sans intrant).`,
      });
    }
    if (w.distanceM < 100) {
      out.push({
        code: "fert_slope",
        level: "info",
        message: `${name} à moins de 100 m : épandage interdit sur une pente de plus de ${input.liquid ? "10" : "15"} % près du cours d'eau, sauf bande enherbée ou boisée d'au moins 5 m.`,
      });
    }
  }
  return out;
}

// --- Couverture des sols en interculture (FR-FERT-27) ---------------------------------------------

export interface SoilCoverInput {
  /** Culture principale de la campagne. */
  crop: CropGroup;
  /** Culture précédente et date de sa (dernière) récolte. */
  previous: { crop: CropGroup; harvestedOn: string | null } | null;
  /** La parcelle est en zone d'actions renforcées (ZAR). */
  zar: boolean;
  cover: {
    kind: "sown" | "regrowth_cereal" | "regrowth_rapeseed";
    /** Légumineuses pures : destruction au plus tôt le 1er février. */
    pureLegumes: boolean;
    sownOn: string;
    destroyedOn: string | null;
    destructionMode: string | null;
  } | null;
  /** Broyage, enfouissement, travail du sol (dates). */
  residueWorks: string[];
}
export interface SoilCoverCheck {
  level: ConditionLevel;
  /** Interculture longue, courte après colza, ou non concernée. */
  situation: "long" | "short_after_rapeseed" | "none";
  messages: string[];
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const addMonths = (iso: string, months: number, days = 0) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return addDays(d.toISOString().slice(0, 10), days);
};
const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const CANES: ReadonlySet<CropGroup> = new Set(["maize_grain", "maize_seed", "maize_popcorn", "maize_sweet", "sorghum_grain"]);

/**
 * Couverture des sols après la récolte du précédent (guide PAR 7 NA,
 * tableaux 11 et 12) : couvert ou repousses implantés à temps, maintenus
 * 2,5 mois (3 en ZAR), détruits au plus tôt le 15 novembre ; derrière un maïs
 * grain ou un sorgho grain, cannes broyées et enfouies dans les 15 jours.
 */
export function checkSoilCover(input: SoilCoverInput): SoilCoverCheck {
  const prev = input.previous;
  if (!prev) return { level: "ok", situation: "none", messages: [] };
  const long = SPRING_CROPS.has(input.crop);
  if (!long) {
    if (prev.crop !== "rapeseed_winter") return { level: "ok", situation: "none", messages: [] };
    // Interculture courte derrière colza : couvert ou repousses maintenus au moins 1 mois.
    const c = input.cover;
    if (!c) return { level: "warning", situation: "short_after_rapeseed", messages: ["Interculture courte derrière colza : couvert ou repousses de colza à maintenir au moins 1 mois. Saisissez-les."] };
    if (c.destroyedOn && c.destroyedOn < addMonths(c.sownOn, 1)) return { level: "warning", situation: "short_after_rapeseed", messages: [`Couverture détruite le ${fr(c.destroyedOn)} : moins d'un mois après son implantation.`] };
    return { level: "ok", situation: "short_after_rapeseed", messages: ["Interculture courte derrière colza : couverture saisie."] };
  }
  const h = prev.harvestedOn;
  if (!h) return { level: "info", situation: "long", messages: ["Interculture longue : date de récolte du précédent inconnue, couverture des sols non vérifiée."] };
  const year = h.slice(0, 4);
  const messages: string[] = [];
  let level: ConditionLevel = "ok";
  const warn = (m: string) => {
    messages.push(m);
    level = "warning";
  };
  const residues = input.residueWorks.filter((d) => d >= h && d <= addDays(h, 15));
  const c = input.cover;
  const sown = c?.kind === "sown" ? c : null;

  if (CANES.has(prev.crop)) {
    // Derrière maïs grain ou sorgho grain : couvert avant le 1er décembre, ou cannes broyées et enfouies sous 15 jours.
    if (sown && sown.sownOn < `${year}-12-01`) messages.push(`Couvert implanté le ${fr(sown.sownOn)}.`);
    else if (residues.length) messages.push(`Cannes broyées ou enfouies le ${fr(residues[0]!)}, dans les 15 jours suivant la récolte.`);
    else warn(`Récolte du précédent le ${fr(h)} : cannes à broyer finement et enfouir dans les 15 jours (au plus tard le ${fr(addDays(h, 15))}), ou couvert à implanter avant le 01/12.`);
  } else if (h > `${year}-10-15`) {
    if (prev.crop === "sunflower" && !residues.length && !sown) warn(`Tournesol récolté après le 15/10 : cannes à broyer et enfouir dans les 15 jours (au plus tard le ${fr(addDays(h, 15))}).`);
    else return { level: "ok", situation: "long", messages: [`Précédent récolté le ${fr(h)}, après le 15/10 : couverture des sols non obligatoire.`] };
  } else {
    const deadline = h >= `${year}-09-15` ? addDays(h, 15) : `${year}-09-${input.zar ? "15" : "30"}`;
    if (!c) warn(`Couverture des sols obligatoire : couvert ou repousses à implanter au plus tard le ${fr(deadline)}. Saisissez le couvert.`);
    else if (c.sownOn > deadline) warn(`Couverture implantée le ${fr(c.sownOn)}, après la date limite du ${fr(deadline)}.`);
    else messages.push(`${c.kind === "sown" ? "Couvert" : "Repousses"} du ${fr(c.sownOn)} (date limite ${fr(deadline)}).`);
  }

  if (c && level === "ok") {
    if (c.destroyedOn) {
      const minEnd = input.zar ? addMonths(c.sownOn, 3) : addMonths(c.sownOn, 2, 15);
      const earliest = c.pureLegumes ? `${Number(year) + 1}-02-01` : `${year}-11-15`;
      if (c.destroyedOn < minEnd) warn(`Couverture détruite le ${fr(c.destroyedOn)} : à maintenir ${input.zar ? "3 mois" : "2,5 mois"} (jusqu'au ${fr(minEnd)}).`);
      if (c.destroyedOn < earliest) warn(`Destruction le ${fr(c.destroyedOn)} : au plus tôt le ${fr(earliest)}${c.pureLegumes ? " pour des légumineuses pures" : ""}.`);
      if (c.destructionMode === "chemical") warn("Destruction chimique : interdite sauf techniques culturales simplifiées, légumes ou porte-graines, ou adventices vivaces déclarées.");
    } else messages.push("Date de destruction à saisir.");
  }
  return { level, situation: "long", messages };
}
