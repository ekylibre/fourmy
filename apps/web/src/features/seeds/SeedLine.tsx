import { Link, useLocation } from "react-router";
import { Anchor, Text } from "@mantine/core";
import type { SeedListItem } from "@fourmy/contracts";
import { parseSeedUnit, seedConversionGap, seedEquivalents, seedRate, seedUnitChoices } from "@fourmy/domain";
import { fmt } from "./labels";

/** Unité rapportée au m² (`grain_per_square_meter`) : la dose est déjà par surface. */
export const isAreaRate = (unit: string | null | undefined) => !!unit && /_per_square_meter$/.test(unit);

const ctxOf = (seed: SeedListItem | undefined) => ({ tgwG: seed?.tgw?.tgwG ?? null, grainsPerDose: seed?.sheet?.grainsPerDose ?? null });

/**
 * Unités de saisie d'une semence (lot SE5, FR-SE-20) : la sienne, les
 * grains/m² et les unités où elle se convertit (par le PMG retenu et le
 * nombre de grains par dose). Unité illisible ou mélange : la sienne seulement.
 */
export function seedInputUnits(articleUnit: string, seed: SeedListItem | undefined): string[] {
  if (seed?.sheet?.isMixture) return [articleUnit];
  const ctx = ctxOf(seed);
  const units = seedUnitChoices(articleUnit, ctx);
  if (!parseSeedUnit(articleUnit, ctx.grainsPerDose)) return units;
  const perM2 = seedConversionGap("grain", articleUnit, ctx) === null ? ["grain_per_square_meter"] : [];
  return [units[0]!, ...perM2, ...units.slice(1)];
}

/**
 * « ≈ 9 grains/m² · 1,8 dose/ha · 27 kg/ha (PMG 300 g) » sous un semis : la
 * densité et la dose, quelle que soit l'unité saisie (FR-SE-20, 22). PMG
 * repère : « estimé ». Ce qui manque est dit, avec un lien vers la fiche.
 */
export function SeedLine({ quantity, unit, seed, areaHa, farmId }: { quantity: number | null; unit: string | null; seed: SeedListItem | undefined; areaHa: number | null; farmId: string }) {
  const location = useLocation();
  if (!seed || quantity === null || !unit || seed.sheet?.isMixture || !seed.unitDim) return null;
  const ctx = ctxOf(seed);
  const eq = seedEquivalents(quantity, unit, ctx, areaHa);
  if (!eq) return null;
  // Plants comptés à la pièce (issue #130) : la densité en plants, sans PMG.
  if (eq.plantsPerHa !== undefined) {
    return (
      <Text size="xs" c="dimmed" className="lv-num" aria-label="Densité de plantation">
        ≈ {fmt(eq.plantsPerHa, 0)} plants/ha · {fmt(eq.plantsPerM2 ?? 0, 2)} plant/m²
      </Text>
    );
  }
  const parts = [
    eq.grainsPerM2 !== null ? `${fmt(eq.grainsPerM2, 1)} grains/m²` : null,
    eq.dosesPerHa !== null ? `${fmt(eq.dosesPerHa, 2)} dose/ha` : null,
    eq.kgPerHa !== null ? `${fmt(eq.kgPerHa, 1)} kg/ha` : null,
  ].filter(Boolean);
  const entered = parseSeedUnit(seedRate(unit).unit, ctx.grainsPerDose)?.dim;
  const missing = (entered === "mass" ? eq.grainsPerM2 === null : eq.kgPerHa === null) && !ctx.tgwG;
  return (
    <Text size="xs" c="dimmed" className="lv-num" aria-label="Densité de semis">
      {parts.length > 0 && <>≈ {parts.join(" · ")}</>}
      {seed.tgw && (entered === "mass" ? eq.grainsPerM2 !== null : eq.kgPerHa !== null) && (
        <> ({seed.tgw.estimated ? `PMG repère ${seed.reference?.org ?? ""} ${fmt(seed.tgw.tgwG)} g, estimé` : `PMG ${fmt(seed.tgw.tgwG)} g`})</>
      )}
      {missing && (
        <>
          {parts.length ? " · " : ""}PMG inconnu.{" "}
          <Anchor component={Link} to={`/f/${farmId}/seeds${location.search}`} size="xs">
            Compléter la semence
          </Anchor>
        </>
      )}
    </Text>
  );
}
