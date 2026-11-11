import { calendarPeriods, periodTexts, type CalendarPeriod, type CropGroup, type FertilizerType } from "@fourmy/fertilization-refs";
import { isMaizeOrSorghum, isStrawCereal, SPRING_CROPS } from "./crops.js";

/**
 * Calendrier d'interdiction d'épandage (lot AH, FR-FERT-25) : PAN 7 et
 * programme régional, d'après le jeu de données officiel (data.gouv.fr) pour
 * la Nouvelle-Aquitaine. La catégorie de culture vient de la culture en
 * place ; les zones (ouest, sud, montagne, ZAR) de la commune de la parcelle.
 */

export type CalendarLevel = "ok" | "info" | "warning" | "danger";
export interface CalendarCheck {
  level: CalendarLevel;
  message: string;
  period: { from: string; to: string } | null;
  /** Prescriptions du programme national ou régional imprimées avec la période. */
  texts: string[];
}

/** Catégorie du calendrier d'après la culture principale en place. */
export function calendarCategory(crop: CropGroup): { category: RegExp; sub?: RegExp } | null {
  if (crop === "rapeseed_winter") return { category: /^Culture principale \(colza\)/ };
  if (crop === "grassland") return { category: /^Prairie de \+ de 6 mois/, sub: /^Prairie implantée/ };
  if (crop === "vine" || crop === "orchard" || crop === "kiwi" || crop === "walnut") return { category: /^Autres cultures/, sub: /^cultures pérennes/ };
  if (crop === "vegetables") return { category: /^Autres cultures/, sub: /^cultures maraîchères/ };
  if (crop === "seed_crops") return { category: /^Autres cultures/, sub: /^cultures porte-graines/ };
  if (SPRING_CROPS.has(crop)) return { category: /^Culture principale récoltée avant la fin de l'année/ };
  if (isStrawCereal(crop) || crop === "flax") return { category: /^Culture principale \(hors colza\)/ };
  return null;
}

const inPeriod = (md: string, from: string, to: string) => (from <= to ? md >= from && md <= to : md >= from || md <= to);
const specificity = (p: CalendarPeriod) => Object.keys(p.zone).length;

/** Période d'interdiction applicable : la ligne la plus précise compatible avec les zones de la commune. */
export function prohibitionPeriod(crop: CropGroup, type: FertilizerType, zones: string[], region = "75"): CalendarPeriod | null {
  const cat = calendarCategory(crop);
  if (!cat) return null;
  const flags = new Set(zones);
  const candidates = calendarPeriods.rows.filter(
    (p) =>
      p.region === region &&
      p.fertilizerType === type &&
      cat.category.test(p.cropCategory) &&
      (!cat.sub || cat.sub.test(p.cropSubCategory)) &&
      Object.entries(p.zone).every(([k, v]) => flags.has(k) === v),
  );
  return candidates.sort((a, b) => specificity(b) - specificity(a))[0] ?? null;
}

export function checkCalendar(input: { date: string; crop: CropGroup; type: FertilizerType | null; foliar: boolean; irrigated: boolean; zones: string[] }): CalendarCheck {
  if (input.foliar) return { level: "ok", message: "Apport foliaire : hors calendrier d'épandage.", period: null, texts: [] };
  if (!input.type) return { level: "info", message: "Type de fertilisant inconnu : calendrier d'épandage non vérifié (Stocks → Fertilisants).", period: null, texts: [] };
  const p = prohibitionPeriod(input.crop, input.type, input.zones);
  if (!p) return { level: "info", message: "Culture absente du calendrier connu de Fourmy : calendrier non vérifié.", period: null, texts: [] };
  const texts = Object.values(periodTexts(p)).filter((t): t is string => !!t);
  const md = input.date.slice(5, 10);
  const period = { from: p.from, to: p.to };
  if (p.noProhibition) return { level: "ok", message: "Pas d'interdiction pour cette culture et ce type.", period: null, texts };
  const fmt = (x: string) => `${x.slice(3)}/${x.slice(0, 2)}`;
  if (p.allYear) return { level: "danger", message: `Épandage de type ${input.type} interdit toute l'année sur cette culture.`, period, texts };
  if (!inPeriod(md, p.from, p.to)) return { level: "ok", message: `Hors période d'interdiction (du ${fmt(p.from)} au ${fmt(p.to)} pour le type ${input.type}).`, period, texts };
  // Note (4) du PAN 7 : engrais minéral permis sur maïs irrigué jusqu'au stade brunissement des soies.
  if (input.type === "III" && input.irrigated && isMaizeOrSorghum(input.crop) && md >= "07-01" && md <= "08-31") {
    return { level: "info", message: "Maïs irrigué : engrais minéral permis jusqu'au stade brunissement des soies (PAN 7, note 4).", period, texts };
  }
  return { level: "danger", message: `Période d'interdiction d'épandage : du ${fmt(p.from)} au ${fmt(p.to)} pour un fertilisant de type ${input.type} sur cette culture.`, period, texts };
}
