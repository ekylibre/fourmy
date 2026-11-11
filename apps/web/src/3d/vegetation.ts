import { ndviColor, type ParcelVegetation } from "@fourmy/contracts";
import { cropProfile, visualSpacing } from "@fourmy/domain";

/**
 * Apparence de la végétation d'une parcelle dans le plan 3D (lot AA) : un
 * rang dessiné tous les `spacingM` mètres, posé à `baseM` du sol, haut de
 * `heightM`, large de `widthM`. `null` : rien à dessiner (sol nu, état inconnu).
 */
export interface VegetationStyle {
  color: string;
  baseM: number;
  heightM: number;
  widthM: number;
  spacingM: number;
}

const STRAW = "#C9B27A";
const DRY = "#C8A96A";
const WOOD = "#6B4F3A";
const FROST = "#E8F0F4";

/** Mélange de deux couleurs #rrggbb (k = part de `b`). */
export function mix(a: string, b: string, k: number): string {
  const t = Math.min(1, Math.max(0, k));
  const c = (i: number) =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(1)}${c(3)}${c(5)}`;
}

export function vegetationStyle(v: ParcelVegetation, frost = false): VegetationStyle | null {
  const profile = cropProfile(v.species, v.nature);
  const spacingM = visualSpacing(profile, v.rows.spacingM, v.nature);
  const c = v.canopy;
  const iced = (color: string) => (frost ? mix(color, FROST, 0.4) : color);
  if (v.nature === "vine") {
    // Ceps et cordon toujours là ; le feuillage s'épaissit avec le NDVI.
    const leafy = c.phase === "growing";
    return {
      color: iced(leafy ? ndviColor(c.ndvi ?? 0.6) : WOOD),
      baseM: 0.4,
      heightM: Math.max(c.heightM - 0.4, 0.3),
      widthM: 0.12 + 0.4 * c.density,
      spacingM,
    };
  }
  switch (c.phase) {
    case "harvested":
      return { color: iced(STRAW), baseM: 0, heightM: 0.12, widthM: spacingM * 0.9, spacingM };
    case "senescent":
      return {
        color: iced(mix(ndviColor(c.ndvi ?? 0.4), DRY, 1 - c.density)),
        baseM: 0,
        heightM: c.heightM,
        widthM: spacingM * profile.widthFraction * Math.max(c.density, 0.35),
        spacingM,
      };
    case "growing":
      if (c.heightM < 0.05) return null;
      return {
        color: iced(ndviColor(c.ndvi ?? 0.5)),
        baseM: 0,
        heightM: c.heightM,
        widthM: spacingM * profile.widthFraction * Math.max(c.density, 0.25),
        spacingM,
      };
    default:
      return null;
  }
}

export const PHASE_LABELS: Record<ParcelVegetation["canopy"]["phase"], string> = {
  growing: "en végétation",
  senescent: "en maturation",
  harvested: "récolté (chaumes)",
  bare: "sol nu",
  dormant: "en repos",
  unknown: "pas de mesure récente",
};
