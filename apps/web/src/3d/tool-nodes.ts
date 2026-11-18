import { articulationOf, BOOM_SECTIONS, boomNode, FOLDED_BOOM_GAP_M } from "@fourmy/equipment-3d";

/**
 * Pose des nœuds articulés d'un outil généré (rejeu 3D et vue du matériel) :
 * montée et bascule du relevage, rampe repliée en accordéon le long de la
 * cuve. Pur : la conversion en TranslationRotationScale de Cesium se fait à
 * l'appel. Repère glTF des nœuds : X à gauche, Y en haut, Z vers l'avant.
 */

export interface ToolPose {
  liftM: number;
  /** Bascule du relevage (radians, arrière vers le haut). */
  pitchRad: number;
  /** Repliage des rampes : 0 dépliée, 1 repliée. */
  fold: number;
}

export interface NodeTransform {
  translation: [number, number, number];
  /** Rotation autour d'un axe du nœud (radians). */
  axis: "x" | "y";
  angle: number;
}

/** Pose fixe d'un mode : au travail (posé, rampe dépliée) ou sur la route (relevé, rampe repliée). */
export function modePose(template: string | null | undefined, mode: "work" | "road"): ToolPose | null {
  const a = articulationOf(template);
  if (!a) return null;
  return mode === "work" ? { liftM: 0, pitchRad: 0, fold: 0 } : { liftM: a.liftM.transport, pitchRad: (a.pitchDeg * Math.PI) / 180, fold: a.booms ? 1 : 0 };
}

/**
 * Transformations des nœuds pour une pose. Rampe repliée : le premier
 * tronçon pivote de 90° vers l'avant (le long de la cuve), le suivant de 180°
 * vers l'arrière, le troisième de nouveau vers l'avant ; chaque tronçon est
 * décalé de FOLDED_BOOM_GAP_M vers l'extérieur pour ne pas se superposer.
 */
export function nodeTransforms(pose: ToolPose, booms: boolean): Record<string, NodeTransform> {
  const out: Record<string, NodeTransform> = { lift: { translation: [0, pose.liftM, 0], axis: "x", angle: pose.pitchRad } };
  if (!booms) return out;
  const f = pose.fold;
  for (const side of ["left", "right"] as const) {
    // Gauche : -90° autour de Y amène le tronçon (+X) vers l'avant (+Z) ; droite : +90°.
    const s = side === "left" ? -1 : 1;
    for (let k = 0; k < BOOM_SECTIONS; k++) {
      const angle = (k === 0 ? s * (Math.PI / 2) : (k % 2 ? -s : s) * Math.PI) * f;
      // Décalage vers l'extérieur, dans le repère du tronçon parent (déjà tourné).
      const gap = k === 0 ? 0 : (k % 2 ? -1 : 1) * FOLDED_BOOM_GAP_M * f;
      out[boomNode(side, k)] = { translation: [0, 0, gap], axis: "y", angle };
    }
  }
  return out;
}
