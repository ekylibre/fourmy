import { ITINERARY_LANE_LABELS, type ItineraryDetail, type ItineraryMark, type ItineraryStep, type TechnicalItinerary } from "@fourmy/contracts";

/**
 * Conversion d'un itinéraire de Fourmy au format JSON de TIKA
 * (@osfarm/itineraire-technique, fork ekylibre ; conception §6.2). Le format
 * de TIKA reste en bordure : l'API et le cache hors ligne ne connaissent que
 * TechnicalItinerary. Types locaux, structurellement compatibles avec ceux de
 * TIKA (le domaine ne dépend pas du paquet web). Des `type` et non des
 * `interface` : TIKA accepte des champs en plus (signature d'index).
 */

export type TikaInterventionJson = {
  id: string;
  day: number;
  name: string;
  type: "intervention_top" | "intervention_bottom";
  description: string;
  status: "done" | "planned";
  /** Rendu par onInterventionClick : de quoi ouvrir la fiche. */
  ref: TikaRef;
};

export type TikaRef = {
  interventionIds: string[];
  parcels: { id: string; name: string }[];
};

export type TikaStepJson = {
  id: string;
  name: string;
  color: string;
  startDate: string;
  endDate: string;
  description: string;
  secondary_crop: boolean;
  useDefaultColor: false;
  useDefaultStartDate: false;
  useDefaultEndDate: false;
  interventions: TikaInterventionJson[];
};

export type TikaSystemJson = {
  title: string;
  options: {
    view: "horizontal" | "donut";
    show_transcript: boolean;
    title_top_interventions: string;
    title_bottom_interventions: string;
    title_steps: string;
    show_climate_diagram: false;
  };
  steps: TikaStepJson[];
};

/** Couleurs par défaut : culture (ocre clair), couvert (vert tendre). */
export const TIKA_DEFAULT_COLORS = { crop: "#d2b48c", cover: "#9cc59a" } as const;

/** Lignes « Libellé : valeur » : TIKA met le libellé en gras. */
const lines = (details: ItineraryDetail[]) => details.map((d) => `${d.label} : ${d.value}`).join("\n");

function stepDescription(step: ItineraryStep): string {
  const parts = [...step.attributes];
  if (step.datesFrom === "campaign") parts.push({ label: "Dates", value: "bornes de la campagne (ni semis ni récolte enregistrés)" });
  return lines(parts);
}

function toIntervention(m: ItineraryMark): TikaInterventionJson {
  return {
    id: m.interventionIds.join("+"),
    day: m.day,
    name: m.label,
    type: m.lane === "works" ? "intervention_top" : "intervention_bottom",
    description: lines(m.details),
    status: m.status,
    ref: { interventionIds: m.interventionIds, parcels: m.parcels },
  };
}

export function toTikaSystem(itinerary: TechnicalItinerary, opts: { view?: "horizontal" | "donut"; stepsTitle?: string } = {}): TikaSystemJson {
  return {
    title: itinerary.title,
    options: {
      view: opts.view ?? "horizontal",
      show_transcript: true,
      title_top_interventions: ITINERARY_LANE_LABELS.works,
      title_bottom_interventions: ITINERARY_LANE_LABELS.inputs,
      title_steps: opts.stepsTitle ?? (itinerary.campaigns.length > 1 ? "Rotation" : "Culture"),
      show_climate_diagram: false,
    },
    steps: itinerary.steps.map((s) => ({
      id: `${s.kind}-${s.campaign}`,
      name: s.name,
      color: s.color ?? TIKA_DEFAULT_COLORS[s.kind],
      startDate: s.from,
      endDate: s.to,
      description: stepDescription(s),
      secondary_crop: s.kind === "cover",
      useDefaultColor: false,
      useDefaultStartDate: false,
      useDefaultEndDate: false,
      interventions: s.marks.map(toIntervention),
    })),
  };
}
