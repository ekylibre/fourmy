import { z } from "zod";
import { uuid } from "./primitives.js";

/**
 * Certifications et cahiers des charges des parcelles (retours du
 * 08/11/2026, lot G), avec début et fin. AB : contrôle des produits
 * phytosanitaires (utilisables en agriculture biologique).
 */
export const CERTIFICATION_KINDS = ["organic", "hve", "aop", "igp", "label_rouge", "stg", "globalgap", "rainforest", "other"] as const;
export type CertificationKind = (typeof CERTIFICATION_KINDS)[number];

export const CERTIFICATION_LABELS: Record<CertificationKind, string> = {
  organic: "Agriculture biologique (AB)",
  hve: "Haute Valeur Environnementale (HVE)",
  aop: "AOP / AOC",
  igp: "IGP",
  label_rouge: "Label Rouge",
  stg: "STG",
  globalgap: "GLOBALG.A.P.",
  rainforest: "Rainforest Alliance",
  other: "Autre cahier des charges",
};

/** Niveaux proposés : AB (conversion, certifiée), HVE (1 à 3). */
export const CERTIFICATION_LEVELS: Partial<Record<CertificationKind, { value: string; label: string }[]>> = {
  organic: [
    { value: "conversion", label: "En conversion" },
    { value: "certified", label: "Certifiée" },
  ],
  hve: [
    { value: "1", label: "Niveau 1" },
    { value: "2", label: "Niveau 2" },
    { value: "3", label: "Niveau 3" },
  ],
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date AAAA-MM-JJ attendue");

export const certificationWrite = z
  .object({
    kind: z.enum(CERTIFICATION_KINDS),
    level: z.string().trim().max(40).nullable().optional(),
    label: z.string().trim().max(200).nullable().optional(),
    certifier: z.string().trim().max(200).nullable().optional(),
    reference: z.string().trim().max(120).nullable().optional(),
    startedOn: day,
    stoppedOn: day.nullable().optional(),
  })
  .refine((c) => !c.stoppedOn || c.stoppedOn >= c.startedOn, { message: "la fin précède le début", path: ["stoppedOn"] });
export type CertificationWrite = z.infer<typeof certificationWrite>;

export interface ParcelCertification {
  id: string;
  landParcelId: string;
  kind: CertificationKind;
  level: string | null;
  label: string | null;
  certifier: string | null;
  reference: string | null;
  startedOn: string;
  stoppedOn: string | null;
}

/** Libellé court : « AB certifiée », « HVE 3 », « AOC Bordeaux »… */
export function certificationShortLabel(c: Pick<ParcelCertification, "kind" | "level" | "label">): string {
  if (c.kind === "organic") return c.level === "conversion" ? "AB (conversion)" : "AB";
  if (c.kind === "hve") return c.level ? `HVE ${c.level}` : "HVE";
  if (c.kind === "aop") return c.label || "AOP/AOC";
  if (c.kind === "igp") return c.label || "IGP";
  const base = { label_rouge: "Label Rouge", stg: "STG", globalgap: "GLOBALG.A.P.", rainforest: "Rainforest Alliance", other: "Cahier des charges" }[c.kind];
  return c.label ? `${base} — ${c.label}` : base;
}

export const parcelCertificationId = uuid;
