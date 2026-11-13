import { z } from "zod";
import { isoDate, uuid } from "./primitives.js";

/**
 * « Ma ferme », lot F1 (claudedocs/conception_ma_ferme.md §4.1) : identité
 * de l'exploitation, certificats, sites. `FarmIdentity` (register.ts) reste
 * le contrat de /settings/identity (SIRET et PACAGE seuls).
 */

/** Clé de Luhn du SIRET. La Poste (SIREN 356000000) suit une autre règle : somme des chiffres multiple de 5. */
export function siretKeyValid(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  const digits = [...siret].map(Number);
  if (siret.startsWith("356000000")) return digits.reduce((s, d) => s + d, 0) % 5 === 0;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    // De droite à gauche, un chiffre sur deux est doublé : ici les rangs pairs depuis la gauche.
    let d = digits[i]! * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

/** N° de TVA intracommunautaire français déduit du SIREN (proposé, jamais imposé). */
export function vatFromSiren(siren: string): string | null {
  if (!/^\d{9}$/.test(siren)) return null;
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${siren}`;
}

/** Espaces retirés (copier-coller d'un SIRET « 732 829 320 00074 »), vide → null. */
const compact = (schema: z.ZodType<string>) =>
  z.preprocess((v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() || null : v), schema.nullable());
/** Texte libre : espaces de bord retirés, vide → null. */
const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v), z.string().max(max).nullable());

export const legalForm = z.enum(["ei", "earl", "gaec", "scea", "sarl", "sas", "other"]);
export type LegalForm = z.infer<typeof legalForm>;
export const LEGAL_FORM_LABELS: Record<LegalForm, string> = {
  ei: "Entreprise individuelle",
  earl: "EARL",
  gaec: "GAEC",
  scea: "SCEA",
  sarl: "SARL",
  sas: "SAS",
  other: "Autre",
};

export const farmProfileIdentity = z.object({
  name: z.string().trim().min(1, "Le nom de la ferme est obligatoire.").max(120),
  legalName: text(200),
  legalForm: legalForm.nullable(),
  siret: compact(z.string().regex(/^\d{14}$/, "Le SIRET compte 14 chiffres.").refine(siretKeyValid, "SIRET invalide : la clé de contrôle ne correspond pas.")),
  vatNumber: compact(z.string().regex(/^FR[0-9A-HJ-NP-Z]{2}\d{9}$/, "N° de TVA : FR suivi de 11 caractères.")),
  nafCode: compact(z.string().regex(/^\d{2}\.\d{2}[A-Z]$/, "Code NAF au format 01.11Z.")),
  pacage: compact(z.string().regex(/^\d{9}$/, "Le PACAGE compte 9 chiffres.")),
  cvi: compact(z.string().regex(/^[0-9A-Z]{10}$/, "Le CVI compte 10 caractères.")),
  ede: compact(z.string().regex(/^\d{8}$/, "Le n° EDE compte 8 chiffres.")),
  phone: text(30),
  email: z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v), z.email("Adresse e-mail invalide.").max(200).nullable()),
  /** Une personne de l'équipe, ou un nom libre. */
  legalRep: z.union([z.object({ personId: uuid }), z.object({ name: z.string().trim().min(1).max(120) })]).nullable(),
});
export type FarmProfileIdentity = z.infer<typeof farmProfileIdentity>;

export const farmCertificationKind = z.enum(["phyto_approval", "organic", "hve"]);
export type FarmCertificationKind = z.infer<typeof farmCertificationKind>;
export const FARM_CERTIFICATION_LABELS: Record<FarmCertificationKind, string> = {
  phyto_approval: "Agrément phytosanitaire",
  organic: "Agriculture biologique",
  hve: "Haute valeur environnementale",
};

export const farmCertificationWrite = z
  .object({
    kind: farmCertificationKind,
    body: text(120),
    number: text(60),
    level: z.enum(["1", "2", "3"]).nullable(),
    expiresOn: isoDate.nullable(),
  })
  .refine((c) => c.kind === "hve" || c.level === null, { message: "Le niveau ne concerne que la HVE.", path: ["level"] });
export type FarmCertificationWrite = z.infer<typeof farmCertificationWrite>;
export type FarmCertification = FarmCertificationWrite & { id: string };

export const geoPoint = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
export type GeoPoint = z.infer<typeof geoPoint>;

export const geocodeType = z.enum(["housenumber", "street", "locality", "municipality"]);
export type GeocodeType = z.infer<typeof geocodeType>;

export const siteAddress = z.object({
  line1: text(200),
  line2: text(200),
  postalCode: compact(z.string().regex(/^\d{5}$/, "Le code postal compte 5 chiffres.")),
  city: text(120),
  inseeCode: compact(z.string().regex(/^\d[\dAB]\d{3}$/)),
});
export type SiteAddress = z.infer<typeof siteAddress>;

export const SITE_RADIUS = { min: 1000, max: 30000, default: 10000 } as const;

export const farmSiteWrite = z
  .object({
    name: z.string().trim().min(1, "Le nom du site est obligatoire.").max(120),
    address: siteAddress,
    location: geoPoint.nullable(),
    locationSource: z.enum(["geocoded", "manual"]).nullable(),
    geocode: z.object({ score: z.number().min(0).max(1), type: geocodeType }).nullable(),
    radiusM: z.number().int().min(SITE_RADIUS.min).max(SITE_RADIUS.max),
  })
  .refine((s) => (s.location === null) === (s.locationSource === null), { message: "Un point a toujours une origine.", path: ["locationSource"] })
  .refine((s) => s.locationSource === "geocoded" || s.geocode === null, { message: "Score de géocodage sans point géocodé.", path: ["geocode"] });
export type FarmSiteWrite = z.infer<typeof farmSiteWrite>;
export type FarmSite = FarmSiteWrite & { id: string; isHeadquarters: boolean };

/** Préférences d'affichage de la ferme (E9, E21 bis). */
export const farmDisplay = z.object({ basemap: z.enum(["plan", "ortho"]), areaUnit: z.enum(["ha", "a"]) });
export type FarmDisplay = z.infer<typeof farmDisplay>;
export const DEFAULT_FARM_DISPLAY: FarmDisplay = { basemap: "ortho", areaUnit: "ha" };

/** Surface lisible dans l'unité choisie : hectares à 2 décimales, ares sans décimale. */
export function formatArea(m2: number, unit: FarmDisplay["areaUnit"] = "ha"): string {
  return unit === "a"
    ? `${Math.round(m2 / 100).toLocaleString("fr-FR")} a`
    : `${(m2 / 10_000).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
}

/**
 * Couches IGN mises en cache sur le serveur (F4, F4 bis). L'hydrographie n'en
 * fait pas partie : elle est déjà gardée en base et rafraîchie tous les 30 jours.
 */
export const ignLayer = z.enum(["ortho", "plan", "elevation", "buildings"]);
export type IgnLayer = z.infer<typeof ignLayer>;
export const IGN_LAYER_LABELS: Record<IgnLayer, string> = { ortho: "Photos aériennes", plan: "Plan IGN", elevation: "Relief (3D)", buildings: "Bâtiments (3D)" };
export const farmIgnSettings = z.object({
  layers: z.array(ignLayer).min(1, "Choisissez au moins une couche.").transform((l) => [...new Set(l)]),
  detailMarginM: z.number().int().min(0).max(1000),
  autoRefresh: z.boolean(),
});
export type FarmIgnSettings = z.infer<typeof farmIgnSettings>;
export const DEFAULT_FARM_IGN: FarmIgnSettings = { layers: ["ortho", "plan", "elevation", "buildings"], detailMarginM: 200, autoRefresh: false };
/** Au-delà, le préchargement serveur demande une confirmation (N3). */
export const IGN_SERVER_CONFIRM_BYTES = 2e9;

export type IgnJobStatus = "pending" | "running" | "done" | "partial" | "failed" | "cancelled";
export interface IgnLayerProgress {
  total: number;
  done: number;
  /** Téléchargées pendant cette tâche (les autres étaient déjà en cache). */
  fetched: number;
  failed: number;
}
export interface IgnCacheJob {
  id: string;
  status: IgnJobStatus;
  layers: IgnLayer[];
  tileCount: number;
  estimateBytes: number;
  progress: Partial<Record<IgnLayer, IgnLayerProgress>>;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
/** Réponse de GET /ign/cache : réglages, plan actuel, ce qui est déjà sur le serveur. */
export interface IgnCacheState {
  settings: FarmIgnSettings;
  /** Null : aucun site n'a de point, rien à précharger. */
  plan: { tiles: number; estimateBytes: number; layers: Partial<Record<IgnLayer, number>> } | null;
  /** Tuiles du plan déjà présentes dans le cache du serveur. */
  cached: { tiles: number; bytes: number };
  lastJob: IgnCacheJob | null;
  confirmAboveBytes: number;
  canEdit: boolean;
}

/** GET /ign/cache/manifest : tuiles du plan déjà sur le serveur, pour la copie hors ligne (F5). */
export interface IgnCacheManifest {
  entries: { url: string; etag: string; bytes: number }[];
  bytes: number;
}
/** Au-delà, la copie dans le navigateur demande une confirmation (N3 bis). */
export const IGN_BROWSER_CONFIRM_BYTES = 500e6;

/** Réponse de GET /farm : tout ce qu'affiche la page, en une requête. */
export interface FarmProfile {
  identity: FarmProfileIdentity;
  certifications: FarmCertification[];
  /** Le siège d'abord. */
  sites: FarmSite[];
  /** Parcelles actuelles hors de toutes les zones (E19) ; null si aucun site n'a de point. */
  parcelsOutside: number | null;
  display: FarmDisplay;
  /** Logo de la ferme (fichier servi par /assets/:id), null : celui de Fourmy à l'impression. */
  logoAssetId: string | null;
  canEdit: boolean;
}

/** Suggestion d'adresse (géocodage IGN relayé par l'API). */
export interface GeocodeResult {
  label: string;
  line1: string | null;
  postalCode: string;
  city: string;
  inseeCode: string;
  location: GeoPoint;
  score: number;
  type: GeocodeType;
}
