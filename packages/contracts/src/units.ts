/** Libellés courts des unités enregistrées (reprises d'Ekylibre : `kilogram`, `liter_per_hectare`…). */
const UNITS: Record<string, string> = {
  liter: "L",
  hectoliter: "hL",
  kilogram: "kg",
  ton: "t",
  ton_dry_matter: "t MS",
  quintal: "q",
  cubic_meter: "m³",
  gram: "g",
  unity: "u",
  thousand: "milliers",
  liter_per_hectare: "L/ha",
  kilogram_per_hectare: "kg/ha",
  ton_per_hectare: "t/ha",
  ton_dry_matter_per_hectare: "t MS/ha",
  quintal_per_hectare: "q/ha",
  cubic_meter_per_hectare: "m³/ha",
  thousand_per_hectare: "milliers/ha",
  unity_per_hectare: "u/ha",
  // Semences (lot SE3) : grains, doses, millions de grains, grains/m².
  grain: "grains",
  dose: "doses",
  million: "millions de grains",
  grain_per_hectare: "grains/ha",
  dose_per_hectare: "doses/ha",
  grain_per_square_meter: "grains/m²",
  // Comptage à l'unité (issue #130) : plants, pièces, pieds.
  plant: "plants",
  plant_per_hectare: "plants/ha",
};

export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return "";
  return UNITS[unit] ?? unit.replace(/_per_/g, "/").replace(/_/g, " ");
}

