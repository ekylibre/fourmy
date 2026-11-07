import { PROCEDURES, SHAPE_LABELS } from "@fourmy/contracts";

/** Chiffres tirés du code à chaque construction (rien à tenir à jour à la main). */
export const catalogue = {
  procedures: PROCEDURES.length,
  shapes: Object.values(SHAPE_LABELS),
  vine: PROCEDURES.filter((p) => p.category === "vine").length,
  crops: PROCEDURES.filter((p) => p.category === "crops").length,
};
