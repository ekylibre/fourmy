import { DISCOURAGED_SUCCESSIONS, returnIntervalOf, type AgronomySource } from "@fourmy/certification-refs";
import type { ControlFinding } from "@fourmy/contracts";
import { finding } from "../../certification/report.js";
import type { Bcae7Parcel } from "./bcae7.js";

/**
 * Repères agronomiques de l'assolement (conception §4.3, décision A8) :
 * délai de retour d'une culture et précédents à éviter, d'après Triple
 * Performance. Conseils seulement : orange, jamais bloquant ; une année
 * inconnue ne déclenche rien.
 */

const source = (s: AgronomySource, reviewed: boolean) =>
  `Triple Performance, « ${s.page} » (${s.url}, consulté le ${s.consultedOn.split("-").reverse().join("/")})${reviewed ? "" : ", repère à relire"}`;

/** Parcelle avec sa culture prévue et son historique (forme partagée avec la BCAE 7). */
export type AgronomyParcel = Pick<Bcae7Parcel, "key" | "name" | "main" | "history">;

export function returnIntervalFindings(parcels: AgronomyParcel[], year: number, overrides: Readonly<Record<string, number>> = {}): ControlFinding[] {
  const out: ControlFinding[] = [];
  for (const p of parcels) {
    if (!p.main) continue;
    const rule = returnIntervalOf(p.main);
    if (!rule) continue;
    const min = overrides[rule.id] ?? rule.minYears;
    const group = new Set(rule.capCodes);
    // Le retour le plus rapproché, toutes origines confondues (parcelle fusionnée).
    let closest: number | null = null;
    for (const part of p.history) {
      for (let k = 1; k < min; k++) {
        const c = part.years[year - k];
        if (c?.main && group.has(c.main.toUpperCase())) {
          closest = closest === null ? k : Math.min(closest, k);
          break;
        }
      }
    }
    if (closest === null) continue;
    out.push(
      finding({
        ruleId: `agro.return.${rule.id}`,
        level: "warning",
        message: `${p.name} : ${rule.label.toLowerCase()} en ${year}, déjà en ${year - closest} : retour en ${closest} an${closest > 1 ? "s" : ""}, ${min} conseillés.`,
        value: closest,
        threshold: min,
        unit: "an(s)",
        refs: { parcelIds: [p.key] },
        source: source(rule.source, rule.reviewed),
      }),
    );
  }
  return out;
}

export function successionFindings(parcels: AgronomyParcel[], year: number): ControlFinding[] {
  const out: ControlFinding[] = [];
  for (const rule of DISCOURAGED_SUCCESSIONS) {
    const crop = new Set(rule.capCodes);
    const previous = new Set(rule.previous);
    for (const p of parcels) {
      if (!p.main || !crop.has(p.main.toUpperCase())) continue;
      const prev = p.history.map((h) => h.years[year - 1]?.main?.toUpperCase()).find((c) => c && previous.has(c));
      if (!prev) continue;
      out.push(
        finding({
          ruleId: `agro.succession.${rule.id}`,
          level: "warning",
          message: `${p.name} : ${rule.label.toLowerCase()} (précédent ${prev} en ${year - 1}) : ${rule.reason}.`,
          refs: { parcelIds: [p.key] },
          source: source(rule.source, rule.reviewed),
        }),
      );
    }
  }
  return out;
}

export function agronomyFindings(parcels: AgronomyParcel[], year: number, overrides?: Readonly<Record<string, number>>): ControlFinding[] {
  return [...returnIntervalFindings(parcels, year, overrides), ...successionFindings(parcels, year)];
}
