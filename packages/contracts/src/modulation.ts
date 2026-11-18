import { z } from "zod";
import { VEGETATION_INDICES, type VegetationIndex } from "./remote-sensing.js";

/**
 * Cartes de modulation (lot AD, FR-TWIN-6, docs/modulation.md) : zonage
 * intra-parcellaire d'après un indice Sentinel-2 à 10 m, dose par zone,
 * export ISO-XML (TaskData, grille de type 1) et Shapefile, envoi aux
 * machines par agrirouter.
 */

export const MODULATION_ZONES = { min: 2, max: 7, default: 3 } as const;

/** Part minimale de la parcelle sans nuage pour zoner une date. */
export const MODULATION_MIN_VALID_RATIO = 0.8;

export const prescriptionUnit = z.enum(["kg_ha", "l_ha", "seeds_ha"]);
export type PrescriptionUnit = z.infer<typeof prescriptionUnit>;

export const PRESCRIPTION_UNIT_LABELS: Record<PrescriptionUnit, string> = {
  kg_ha: "kg/ha",
  l_ha: "L/ha",
  seeds_ha: "grains/ha",
};

/** Pas d'arrondi des doses calculées, par unité. */
export const PRESCRIPTION_UNIT_STEP: Record<PrescriptionUnit, number> = { kg_ha: 1, l_ha: 1, seeds_ha: 1000 };

/**
 * Répartition des doses : `compensate` (plus sur les zones faibles, ex. azote
 * de rattrapage), `boost` (plus sur les zones fortes, ex. densité de semis sur
 * les bons sols), `uniform` (même dose partout : la carte sert de repère).
 */
export const modulationStrategy = z.enum(["compensate", "boost", "uniform"]);
export type ModulationStrategy = z.infer<typeof modulationStrategy>;

export const MODULATION_STRATEGY_LABELS: Record<ModulationStrategy, string> = {
  compensate: "Compenser : plus sur les zones faibles",
  boost: "Valoriser : plus sur les zones fortes",
  uniform: "Uniforme : même dose partout",
};

export const vegetationIndex = z.enum(VEGETATION_INDICES);

export const zoningRequest = z.object({
  parcelId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  index: vegetationIndex.default("ndvi"),
  zoneCount: z.number().int().min(MODULATION_ZONES.min).max(MODULATION_ZONES.max).default(MODULATION_ZONES.default),
});
export type ZoningRequest = z.infer<typeof zoningRequest>;

/** Géométrie GeoJSON (WGS84) d'une zone. */
export interface ZoneGeometry {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export interface ModulationZone {
  /** 1 = indice le plus faible. */
  code: number;
  meanIndex: number;
  minIndex: number;
  maxIndex: number;
  areaM2: number;
  geometry: ZoneGeometry;
}

export interface Zoning {
  parcelId: string;
  parcelName: string;
  parcelAreaM2: number;
  date: string;
  index: VegetationIndex;
  zoneCount: number;
  /** Part de la parcelle sans nuage à cette date (0..1). */
  validRatio: number;
  zones: ModulationZone[];
}

/** Date proposée au zonage : indice moyen de la parcelle et part sans nuage. */
export interface ModulationDate {
  date: string;
  mean: number;
  validRatio: number;
}

export const prescriptionWrite = zoningRequest.extend({
  name: z.string().trim().min(1).max(100),
  product: z.string().trim().min(1).max(100),
  unit: prescriptionUnit,
  strategy: modulationStrategy,
  baseRate: z.number().positive().max(10_000_000),
  /** Écart de dose entre la zone moyenne et les zones extrêmes, en %. */
  modulationPct: z.number().min(0).max(100),
  minRate: z.number().min(0).max(10_000_000),
  maxRate: z.number().positive().max(10_000_000),
  /** Largeur de travail (m) : taille des mailles de la grille ISO-XML. */
  widthM: z.number().min(1).max(60),
  /** Doses saisies zone par zone (sinon calculées) : une par zone, de la zone 1 à la dernière. */
  rates: z.array(z.number().min(0).max(10_000_000)).optional(),
  /** Apport du plan de fumure (lot AN) : la moyenne pondérée des doses est ramenée à targetRate. */
  planLink: z.object({ planId: z.string().uuid(), stage: z.string().trim().max(120), targetRate: z.number().positive().max(10_000_000) }).optional(),
});
export type PrescriptionWrite = z.infer<typeof prescriptionWrite>;

export const prescriptionRates = z.object({ rates: z.array(z.number().min(0).max(10_000_000)).min(MODULATION_ZONES.min).max(MODULATION_ZONES.max) });

export interface PrescriptionZone extends ModulationZone {
  rate: number;
}

export type PrescriptionFormat = "isoxml" | "shape";
export const PRESCRIPTION_FORMAT_LABELS: Record<PrescriptionFormat, string> = {
  isoxml: "ISO-XML (TaskData ISOBUS)",
  shape: "Shapefile",
};

export interface PrescriptionSend {
  id: string;
  format: PrescriptionFormat;
  channel: "agrirouter";
  recipients: { id: string; name: string }[];
  sentAt: string;
  sentBy: string | null;
  /**
   * `queued` : en attente (agrirouter injoignable), reprise automatique ;
   * `partial` : livraison peut-être partielle (non renvoyée) ; `error` : refusé.
   */
  status: "queued" | "sent" | "partial" | "error";
  error: string | null;
  /** Prochaine tentative d'un envoi en attente. */
  nextAttemptAt: string | null;
}

export interface Prescription {
  id: string;
  name: string;
  parcelId: string;
  parcelName: string;
  parcelAreaM2: number;
  date: string;
  index: VegetationIndex;
  zoneCount: number;
  product: string;
  unit: PrescriptionUnit;
  strategy: ModulationStrategy;
  baseRate: number;
  modulationPct: number;
  minRate: number;
  maxRate: number;
  widthM: number;
  /** Quantité totale à prévoir (unité de la dose × ha : kg, L ou grains). */
  totalQuantity: number;
  /** Apport du plan de fumure dont la carte est partie, et dose visée (moyenne pondérée). */
  plan: { planId: string; stage: string | null; targetRate: number } | null;
  createdAt: string;
  zones: PrescriptionZone[];
  sends: PrescriptionSend[];
}

export type PrescriptionSummary = Omit<Prescription, "zones" | "sends"> & { lastSentAt: string | null };

export const prescriptionSendRequest = z.object({
  format: z.enum(["isoxml", "shape"]).default("isoxml"),
  recipients: z.array(z.string().uuid()).min(1).max(20),
});

/** Destinataire agrirouter : machine (unité de communication virtuelle) ou logiciel joignable par une route. */
export interface AgrirouterRecipient {
  id: string;
  name: string;
  endpointType: string;
  /** Formats que la route permet d'envoyer à ce destinataire. */
  formats: PrescriptionFormat[];
}

/** Fichier reçu d'agrirouter (boîte de réception, lot AR2). */
export interface AgrirouterInboxItem {
  id: string;
  /** Type de message agrirouter (`iso:11783:-10:taskdata:zip`, `…:time_log:protobuf`…). */
  messageType: string;
  filename: string | null;
  size: number;
  senderEndpointId: string | null;
  senderName: string | null;
  sentAt: string | null;
  receivedAt: string;
  /** `received` : rangé, pas encore lu (la lecture vient aux lots AR4 et AR5). */
  state: "received" | "proposed" | "validated" | "dismissed" | "unreadable" | "ignored";
  error: string | null;
  /** Confirmé à agrirouter (le message quitte sa file). */
  confirmedAt: string | null;
  confirmError: string | null;
}
