import type { MultiPolygon, Point, Polygon } from "geojson";
import type { TreatmentPurpose } from "@fourmy/contracts";

/**
 * Modèle commun des imports (claudedocs/conception_import_onboarding.md §4) :
 * ce que chaque lecteur (DAPLOS, Geofolia, TelePAC) tire d'un fichier,
 * identique quel que soit le format. Géométries en GeoJSON WGS 84. Aucun
 * identifiant Fourmy ici : le rapprochement avec la ferme se fait ensuite,
 * dans l'API, par les clés source.
 */

export const IMPORT_FORMATS = ["daplos", "geofolia", "telepac"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export interface ImportBundle {
  format: ImportFormat;
  /** Logiciel et version d'origine (« Geofolia 26.2.48.0 »), émetteur DAPLOS. */
  producedBy: string | null;
  exportedAt: string | null;
  farm: BundleFarm;
  /** Campagnes (années de récolte) couvertes. */
  campaigns: number[];
  /** Parcelles culturales (Geofolia, DAPLOS), ou parcelles PAC (TelePAC seul). */
  parcels: BundleParcel[];
  /** Cultures des campagnes précédentes (N-1…N-5). */
  history: BundleHistoryCrop[];
  /** Îlots et parcelles PAC (TelePAC). */
  capRefs: BundleCapRef[];
  /** Éléments non agricoles déclarés : SNA, ZDH (TelePAC). */
  landscape: BundleLandscapeFeature[];
  articles: BundleArticle[];
  people: BundlePerson[];
  /** Un couple intervention × parcelle : l'unité commune aux formats. */
  workUnits: BundleWorkUnit[];
  /** Ce que le fichier contient et que Fourmy n'importe pas (volailles, aides…). */
  notImported: { kind: string; label: string; count: number }[];
  warnings: BundleWarning[];
}

export interface BundleAddress {
  line1?: string;
  line2?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}

export interface BundleFarm {
  siret: string | null;
  pacage: string | null;
  name: string | null;
  email: string | null;
  address: BundleAddress | null;
}

export interface BundleCrop {
  /** Code espèce AgroEDI (table 18), éventuellement combiné (« ZDUZLT »). */
  aeeCode: string | null;
  /** Complément (table 37), période de semis (table 30), usage final (table 17). */
  aeeComplement: string | null;
  aeeSowingPeriod: string | null;
  aeeUsage: string | null;
  /** Code culture PAC (« PTR »), TelePAC. */
  capCode: string | null;
  label: string;
  variety: { name: string | null; gnis: string | null } | null;
  sownOn: string | null;
  harvestedOn: string | null;
  /** Destination de la culture (pâturée et fauchée, grain…). */
  destination: string | null;
}

/**
 * Une culture d'une campagne sur une parcelle. Plusieurs cultures peuvent
 * partager la même terre la même campagne (culture principale, puis
 * interculture ou dérobée : « parcelle secondaire » de Geofolia) : elles
 * ont la même `landKey`, et deviennent des productions d'une même parcelle
 * Fourmy.
 */
export interface BundleParcel {
  /** Numéro de travail (« 143 »), ou « îlot/parcelle » PAC. */
  key: string;
  /** Clé de la terre : celle de la culture principale (= `key` pour elle). */
  landKey: string;
  /** Culture secondaire (interculture, dérobée) sur la terre d'une autre. */
  secondary: boolean;
  campaign: number;
  name: string;
  shape: MultiPolygon | null;
  areaM2: number | null;
  /** N° d'îlot PAC déclaré par le logiciel. */
  islet: string | null;
  inseeCode: string | null;
  crop: BundleCrop;
  soil: { code: string | null; label: string | null } | null;
  yield: { objective: number | null; realized: number | null; unit: string | null } | null;
  /** Conseils de fumure P, K, Mg… (kg/ha). */
  advice: Record<string, number> | null;
  /** Surface non épandable, surfaces épandables (m²). */
  spreadable: Record<string, number> | null;
  /** Identifiants de la source, par espace de noms (« geofolia.field »). */
  sourceIds: Record<string, string>;
}

export interface BundleHistoryCrop {
  parcelKey: string;
  /** Campagne passée. */
  campaign: number;
  aeeCode: string | null;
  label: string;
}

export interface BundleCapRef {
  kind: "islet" | "parcel";
  /** N° d'îlot de référence, ou « îlot/parcelle ». */
  ref: string;
  campaign: number;
  isletNumber: string;
  parcelNumber: string | null;
  capCode: string | null;
  admissibleAreaM2: number | null;
  shape: MultiPolygon | null;
  attrs: Record<string, unknown>;
}

export interface BundleLandscapeFeature {
  source: "telepac.sna" | "telepac.zdh";
  /** numeroSna, numeroZdh. */
  ref: string;
  category: string | null;
  /** Code TelePAC (« V4 »…), « ZDH ». */
  capType: string;
  widthM: number | null;
  areaM2: number | null;
  geometry: Polygon | MultiPolygon | Point;
  attrs: Record<string, unknown>;
}

export const ARTICLE_NATURES = ["phyto", "adjuvant", "seed", "fertilizer", "amendment", "water", "harvest", "other"] as const;
export type ArticleNature = (typeof ARTICLE_NATURES)[number];

export const NUTRIENTS = ["n", "p2o5", "k2o", "mgo", "so3", "cao", "na2o", "b", "cu", "zn", "mn", "fe", "mo", "co", "ms", "cn"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

export interface BundleArticle {
  /** SupplyId Geofolia, sinon nom normalisé. */
  key: string;
  name: string;
  nature: ArticleNature;
  amm: string | null;
  gnis: string | null;
  /** Unité Fourmy (`kilogram`, `liter`, `ton`…). */
  unit: string;
  /** Teneurs (% du produit brut), quand le fichier les donne. */
  composition: Partial<Record<Nutrient, number>> | null;
  /** Espèce (semence, récolte). */
  species: string | null;
  /** Motif de traitement d'un phyto (herbicide…), s'il est connu. */
  purpose?: TreatmentPurpose;
  /** Fertilisant organique (effluent d'élevage, sous-produit). */
  organic?: boolean;
  sourceIds: Record<string, string>;
}

export interface BundlePerson {
  key: string;
  firstName: string | null;
  lastName: string;
  startedOn: string | null;
  sourceIds: Record<string, string>;
}

export interface BundleQuantity {
  articleKey: string;
  /** Quantité sur la parcelle, et dose par hectare, dans `unit`. */
  total: number | null;
  perHa: number | null;
  unit: string;
}

export interface BundleWorkUnit {
  /** RecognitionId Geofolia = intervention_guid DAPLOS, en majuscules sans tirets. */
  guid: string;
  /** ActionId Geofolia (regroupe plusieurs parcelles) ; null en DAPLOS. */
  groupKey: string | null;
  parcelKey: string;
  campaign: number;
  operation: { aeeCode: string | null; label: string; category: string | null };
  status: "done" | "planned";
  /** Date de début (AAAA-MM-JJ) et de fin si différente. */
  on: string;
  until: string | null;
  workedAreaM2: number | null;
  inputs: BundleQuantity[];
  outputs: BundleQuantity[];
  /** Eau d'irrigation apportée sur la parcelle (L). */
  waterL: number | null;
  weather: { temperatureC?: number; windKmh?: number; humidity?: number } | null;
  purpose: string | null;
  notes: string | null;
  doerKeys: string[];
  modifiedBy: string | null;
}

export interface BundleWarning {
  level: "info" | "warning" | "blocking";
  message: string;
  /** Clé source concernée (parcelle, article, GUID…). */
  ref?: string;
}

/** Bundle vide d'un format : point de départ des lecteurs. */
export function emptyBundle(format: ImportFormat): ImportBundle {
  return {
    format,
    producedBy: null,
    exportedAt: null,
    farm: { siret: null, pacage: null, name: null, email: null, address: null },
    campaigns: [],
    parcels: [],
    history: [],
    capRefs: [],
    landscape: [],
    articles: [],
    people: [],
    workUnits: [],
    notImported: [],
    warnings: [],
  };
}

/** GUID normalisé : majuscules, sans tirets ni accolades (`1e2fe394-ab31-…` → `1E2FE394AB31…`). */
export function normalizeGuid(guid: string): string {
  return guid.replace(/[{}-]/g, "").toUpperCase();
}
