/**
 * Itinéraires techniques (claudedocs/conception_itineraires_techniques.md §4) :
 * modèle de Fourmy renvoyé par l'API, converti au format de TIKA par le web.
 * Réponses seulement, d'où des types sans schéma zod (comme FarmProfile).
 */

/** Au-dessus de la culture : travaux (sol, semis, récolte, vigne). Au-dessous : intrants (fertilisation, protection, irrigation). */
export type ItineraryLane = "works" | "inputs";

export const ITINERARY_LANE_LABELS: Record<ItineraryLane, string> = { works: "Travaux", inputs: "Intrants" };

/** Ligne de détail « libellé : valeur », en texte brut (jamais du HTML). */
export interface ItineraryDetail {
  label: string;
  value: string;
}

export interface ItineraryMark {
  /** Une intervention (vue parcelle) ou plusieurs (groupe de la vue fusionnée). */
  interventionIds: string[];
  procedure: string;
  /** « Pulvérisation · Karaté K ». */
  label: string;
  lane: ItineraryLane;
  status: "done" | "planned";
  /** Date affichée (jour, ou jour médian d'un groupe), au format AAAA-MM-JJ, heure de Paris. */
  at: string;
  /** Bornes (identiques à `at` pour une seule intervention). */
  from: string;
  to: string;
  /** Décalage en jours depuis le début de l'étape (négatif avant le semis). */
  day: number;
  details: ItineraryDetail[];
  /** Parcelles touchées. */
  parcels: { id: string; name: string }[];
  /** Groupe de la vue fusionnée : chacune de ses interventions, pour l'ouvrir. */
  members?: ItineraryMember[];
}

export interface ItineraryMember {
  interventionId: string;
  /** AAAA-MM-JJ. */
  at: string;
  label: string;
  status: "done" | "planned";
  parcels: string[];
}

export interface ItineraryStep {
  /** Culture de la campagne, ou couvert d'interculture. */
  kind: "crop" | "cover";
  campaign: number;
  name: string;
  /** Couleur de l'activité ; null : couleur par défaut du rendu. */
  color: string | null;
  /** AAAA-MM-JJ. */
  from: string;
  to: string;
  /** D'où viennent les dates : semis et récolte, bornes de la campagne, dates du couvert. */
  datesFrom: "interventions" | "campaign" | "cover";
  attributes: ItineraryDetail[];
  marks: ItineraryMark[];
}

export interface TechnicalItinerary {
  title: string;
  /** Dans l'ordre du temps. */
  steps: ItineraryStep[];
  /** Campagnes couvertes, de la plus ancienne à la plus récente. */
  campaigns: number[];
}

/** Vue fusionnée d'une activité : une étape, et ses parcelles pour descendre sur l'une d'elles. */
export interface ActivityItinerary extends TechnicalItinerary {
  parcels: { id: string; name: string; areaM2: number; interventions: number }[];
}
