import { siretKeyValid, type LegalForm } from "@fourmy/contracts";
import { parsePostal } from "./people.js";

/**
 * Identité de la société Ekylibre → « Ma ferme » (claudedocs/conception_ma_ferme.md §7).
 * Valeurs normalisées et contrôlées ; ce qui ne passe pas le contrôle n'est
 * pas appliqué et part dans le compte rendu. Un champ déjà rempli dans
 * Fourmy n'est jamais écrasé : l'écart est signalé.
 */

export type CompanyRow = {
  id: number;
  full_name: string | null;
  siret_number: string | null;
  vat_number: string | null;
  activity_code: string | null;
  legal_position_code: string | null;
  /** mail_line_1 à mail_line_6 de l'adresse postale par défaut, ou null sans adresse. */
  lines: (string | null)[] | null;
  mail_country: string | null;
};

export interface CompanyIdentity {
  legal_name: string | null;
  legal_form: LegalForm | null;
  siret: string | null;
  vat_number: string | null;
  naf_code: string | null;
}
export interface CompanyAddress {
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
}

const LEGAL_FORMS: Record<string, LegalForm> = { EI: "ei", EARL: "earl", GAEC: "gaec", SCEA: "scea", SARL: "sarl", SAS: "sas" };
const LABELS: Record<keyof CompanyIdentity | keyof CompanyAddress, string> = {
  legal_name: "raison sociale",
  legal_form: "forme juridique",
  siret: "SIRET",
  vat_number: "n° de TVA",
  naf_code: "code NAF",
  address_line1: "adresse",
  address_line2: "complément d'adresse",
  postal_code: "code postal",
  city: "ville",
};

const compact = (v: string | null) => v?.replace(/\s/g, "").toUpperCase() || null;

/** Valeurs contrôlées de la société, et la liste de celles qui ont été écartées. */
export function companyIdentity(row: CompanyRow): { identity: CompanyIdentity; address: CompanyAddress | null; invalid: string[] } {
  const invalid: string[] = [];
  const siretRaw = compact(row.siret_number);
  const siret = siretRaw && /^\d{14}$/.test(siretRaw) && siretKeyValid(siretRaw) ? siretRaw : null;
  if (siretRaw && !siret) invalid.push(`SIRET « ${row.siret_number} » invalide, non repris`);
  const vatRaw = compact(row.vat_number);
  const vat = vatRaw && /^FR[0-9A-HJ-NP-Z]{2}\d{9}$/.test(vatRaw) ? vatRaw : null;
  if (vatRaw && !vat) invalid.push(`N° de TVA « ${row.vat_number} » non français ou mal formé, non repris`);
  const naf = /^(\d{2})\.?(\d{2})([A-Z])$/.exec(compact(row.activity_code) ?? "");
  if (row.activity_code?.trim() && !naf) invalid.push(`Code NAF « ${row.activity_code} » mal formé, non repris`);
  const code = compact(row.legal_position_code);
  return {
    identity: {
      legal_name: row.full_name?.trim().slice(0, 200) || null,
      legal_form: code ? (LEGAL_FORMS[code] ?? "other") : null,
      siret,
      vat_number: vat,
      naf_code: naf ? `${naf[1]}.${naf[2]}${naf[3]}` : null,
    },
    address: row.lines ? companyAddress(row.lines, row.mail_country) : null,
    invalid,
  };
}

/** Lignes Ekylibre : 2 et 3 compléments, 4 voie, 5 lieu-dit, 6 code postal et ville. */
function companyAddress(lines: (string | null)[], country: string | null): CompanyAddress | null {
  const postal = parsePostal(lines, country);
  if (!postal) return null;
  const at = (i: number) => lines[i]?.trim() || null;
  const main = at(3) ?? at(4) ?? at(2) ?? at(1);
  const rest = [at(1), at(2), at(3), at(4)].filter((l): l is string => l !== null && l !== main);
  return {
    address_line1: main?.slice(0, 200) ?? null,
    address_line2: rest.join(", ").slice(0, 200) || null,
    postal_code: postal.postalCode && /^\d{5}$/.test(postal.postalCode) ? postal.postalCode : null,
    city: postal.city?.slice(0, 120) ?? null,
  };
}

/**
 * Ce qu'on peut écrire sans rien écraser : les champs vides dans Fourmy.
 * Les champs déjà remplis avec une autre valeur deviennent des écarts.
 */
export function mergeWithoutOverwrite<T extends object>(current: T, incoming: T): { updates: Partial<T>; conflicts: string[] } {
  const updates: Partial<T> = {};
  const conflicts: string[] = [];
  for (const key of Object.keys(incoming) as (keyof T & string)[]) {
    const next = incoming[key];
    if (next === null || next === undefined) continue;
    const now = current[key];
    if (now === null || now === undefined || now === "") updates[key] = next;
    else if (String(now) !== String(next)) conflicts.push(`${LABELS[key as keyof typeof LABELS] ?? key} : « ${String(now)} » gardé, Ekylibre indique « ${String(next)} »`);
  }
  return { updates, conflicts };
}
