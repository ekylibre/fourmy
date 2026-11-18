import type { AvatarTemplate } from "./params.js";

/**
 * Articulation d'un outil généré au rejeu 3D (claudedocs/conception_rejeu_3d_outils_paysage.md §5) :
 * de combien le nœud `lift` monte et bascule en bout de champ et en transport,
 * et si les demi-rampes (`boom_left`, `boom_right`) se replient en transport.
 * Fonction pure, partagée par l'API et le navigateur.
 */
export interface Articulation {
  /** Montée du nœud `lift` (m) en bout de champ, puis en transport. */
  liftM: { headland: number; transport: number };
  /** Bascule du nœud `lift` (degrés, arrière vers le haut) en bout de champ et en transport. */
  pitchDeg: number;
  /** Demi-rampes repliées en accordéon en transport (pulvérisateurs). */
  booms: boolean;
}

/** Écart entre deux tronçons de rampe repliés côte à côte (m). */
export const FOLDED_BOOM_GAP_M = 0.18;

const MOUNTED: Articulation = { liftM: { headland: 0.5, transport: 0.5 }, pitchDeg: 8, booms: false };

const ARTICULATIONS: Partial<Record<AvatarTemplate, Articulation>> = {
  mounted_tool: MOUNTED,
  sower: MOUNTED,
  rotary_harrow: MOUNTED,
  plough: MOUNTED,
  roller: MOUNTED,
  fertilizer_spreader: { liftM: { headland: 0.2, transport: 0.4 }, pitchDeg: 3, booms: false },
  mounted_sprayer: { liftM: { headland: 0.3, transport: 0.5 }, pitchDeg: 3, booms: true },
  trailed_tool: { liftM: { headland: 0.3, transport: 0.3 }, pitchDeg: 0, booms: false },
  disc_harrow: { liftM: { headland: 0.3, transport: 0.3 }, pitchDeg: 0, booms: false },
  trailed_sprayer: { liftM: { headland: 0.3, transport: 0.4 }, pitchDeg: 0, booms: true },
};

/** Articulation d'un gabarit ; null pour un modèle sans nœud mobile (tracteur, remorque, modèle importé). */
export function articulationOf(template: string | null | undefined): Articulation | null {
  return (template && ARTICULATIONS[template as AvatarTemplate]) || null;
}
