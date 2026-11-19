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
};

export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return "";
  return UNITS[unit] ?? unit.replace(/_per_/g, "/").replace(/_/g, " ");
}

