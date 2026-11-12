import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AddressRow, ContractRow, PersonRow } from "./extract.js";

/**
 * Personnes d'Ekylibre → Fourmy (lot P4, docs/equipe-personnes-design.md §7) :
 * fonctions pures de correspondance, testées sans base.
 */

/** Une adresse postale Ekylibre : ligne 1 = nom, dernière ligne = code postal et commune. */
export function parsePostal(lines: readonly (string | null)[], country: string | null) {
  const clean = lines.map((l) => l?.trim() ?? "").map((l, i) => (i === 0 ? "" : l));
  const last = clean.reduce((k, l, i) => (l ? i : k), -1);
  if (last < 1) return null;
  const tail = clean[last]!;
  let postalCode: string | null = null;
  let city: string | null = tail;
  const before = /^(\d{4,5})\s+(.+)$/.exec(tail); // « 64000 Pau »
  const after = /^(.+?),?\s+(\d{4,5})$/.exec(tail); // « Pau, 64000 »
  if (before) [postalCode, city] = [before[1]!, before[2]!];
  else if (after) [postalCode, city] = [after[2]!, after[1]!.replace(/,$/, "")];
  const street = clean.slice(1, last).filter(Boolean);
  return {
    line1: street[0] ?? null,
    line2: street.length > 1 ? street.slice(1).join(", ") : null,
    postalCode,
    city: city || null,
    country: country && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null,
  };
}

/** Nature d'un contrat Ekylibre → type Fourmy (null si inconnue). */
export function contractTypeOf(nature: string | null): string | null {
  const n = nature?.toLowerCase() ?? "";
  if (/seasonal|saison/.test(n)) return "seasonal";
  if (/apprenti/.test(n)) return "apprentice";
  if (/permanent|cdi/.test(n)) return "permanent";
  if (/temporary|fixed|cdd/.test(n)) return "fixed_term";
  if (/intern|external|contractor|prestat/.test(n)) return "contractor";
  if (/volunt|benevol/.test(n)) return "volunteer";
  return null;
}

/** Portable : chiffres, espaces, +, (), . et - ; sinon ignoré (contrainte de la base). */
const mobileOk = (v: string | null) => (v && /^[0-9 +().-]{4,30}$/.test(v) ? v : null);
const emailOk = (v: string | null) => (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254 ? v.toLowerCase() : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export type PersonPrivateImport = {
  email: string | null;
  mobile: string | null;
  address: ReturnType<typeof parsePostal>;
  birthDate: string | null;
  contract: { type: string | null; startedOn: string | null; endedOn: string | null } | null;
};

/**
 * Données personnelles d'une entité : l'adresse « par défaut » de chaque
 * canal, sinon la plus récente (l'extraction les trie ainsi) ; l'email du
 * compte utilisateur à défaut ; le contrat le plus récent.
 */
export function privateOf(p: PersonRow, addresses: readonly AddressRow[], contracts: readonly ContractRow[]): PersonPrivateImport {
  const first = (canal: AddressRow["canal"]) => addresses.find((a) => a.canal === canal);
  const mail = first("mail");
  const c = contracts[0];
  const startedOn = day(c?.started_at ?? null);
  let endedOn = day(c?.stopped_at ?? null);
  if (startedOn && endedOn && endedOn < startedOn) endedOn = null;
  return {
    email: emailOk(first("email")?.coordinate ?? null) ?? emailOk(p.user_email),
    mobile: mobileOk(first("mobile")?.coordinate ?? null),
    address: mail ? parsePostal(mail.lines, mail.mail_country) : null,
    birthDate: day(p.born_at),
    contract: c ? { type: contractTypeOf(c.nature), startedOn, endedOn } : null,
  };
}

/** Partition d'identifiant de Paperclip : 1 → 000/000/001. */
const idPartition = (id: number) => String(id).padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1/$2/$3");

/**
 * Photo d'une entité dans les fichiers du tenant (Paperclip) : PNG ou JPEG
 * de 2 Mo au plus, sinon null.
 */
export function readPicture(filesDir: string | undefined, tenant: string, p: PersonRow): { bytes: Buffer; mediaType: "image/png" | "image/jpeg" } | null {
  if (!filesDir || !p.picture_file_name) return null;
  const rel = join("entities", "pictures", idPartition(p.entity_id), "original", p.picture_file_name);
  const path = [join(filesDir, tenant, rel), join(filesDir, rel)].find((f) => existsSync(f));
  if (!path || statSync(path).size > 2 * 1024 * 1024) return null;
  const bytes = readFileSync(path);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, mediaType: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, mediaType: "image/jpeg" };
  return null;
}

/** Nom affiché : « Prénom Nom », sinon le nom complet d'Ekylibre. */
export const personName = (p: PersonRow) => [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name;
