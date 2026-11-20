import type { SeedFlag } from "@fourmy/contracts";
import { tgwWarning, type TgwReference } from "./tgw.js";
import { parseSeedUnit } from "./units.js";

/**
 * Ce qui manque à une semence pour convertir ou contrôler (FR-SE-4).
 * `seed` est la fiche (null : pas encore de fiche).
 */
export function seedFlags(input: {
  unit: string;
  seed: { species: string | null; isMixture: boolean; grainsPerDose: number | null; tgwG: number | null } | null;
  componentCount?: number;
  reference?: TgwReference | null;
}): SeedFlag[] {
  const { unit, seed } = input;
  const flags: SeedFlag[] = [];
  if (!parseSeedUnit(unit, seed?.grainsPerDose ?? null)) flags.push("unit_unknown");
  if (seed?.isMixture) {
    if (!input.componentCount) flags.push("mixture_empty");
    return flags;
  }
  if (!seed?.species) flags.push("species_unknown");
  if (!seed?.tgwG) flags.push("tgw_missing");
  else if (tgwWarning(seed.tgwG, input.reference)) flags.push("tgw_far_from_reference");
  return flags;
}

/**
 * Semence qui ressemble à un mélange, d'après son nom ou l'espèce importée
 * (« Avoine + TI + Radis », espèce « Mélange ») : la liste le propose, le
 * responsable confirme.
 */
export function looksLikeMixture(name: string, importedSpecies?: string | null): boolean {
  const n = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const s = (importedSpecies ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /\+/.test(n) || /\bmelange\b/.test(n) || /\bmelange\b/.test(s);
}
