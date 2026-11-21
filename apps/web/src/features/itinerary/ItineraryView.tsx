import { useMemo } from "react";
import { Alert, Group, Paper, SegmentedControl, Text } from "@mantine/core";
import { useNavigate } from "react-router";
import type { TechnicalItinerary } from "@fourmy/contracts";
import { toTikaSystem, type TikaRef } from "@fourmy/domain";
import { useFarm } from "../../app/farm";
import { TikaChart } from "./TikaChart";

export type ItineraryChartView = "horizontal" | "donut";

/**
 * Frise (ou cercle) d'un itinéraire technique, avec sa liste textuelle (N6).
 * Rendu sur fond clair, en thème sombre aussi : les textes de TIKA sont foncés.
 */
export function ItineraryView({
  itinerary,
  view,
  onView,
  toolbar,
  onGroup,
  onIntervention,
  hint,
}: {
  itinerary: TechnicalItinerary;
  view: ItineraryChartView;
  onView: (v: ItineraryChartView) => void;
  /** Contrôles propres à l'écran (période, années…), à gauche de la bascule frise / cercle. */
  toolbar?: React.ReactNode;
  /** Marque regroupant plusieurs interventions (vue fusionnée) : à l'écran de décider. */
  onGroup?: (ref: TikaRef) => void;
  /** Clic sur une marque, à la place de l'ouverture de l'intervention (aperçu d'un ITK). */
  onIntervention?: (ref: TikaRef) => void;
  /** Phrase d'aide sous la barre, à la place de celle des interventions. */
  hint?: string;
}) {
  const farm = useFarm();
  const navigate = useNavigate();
  const system = useMemo(() => toTikaSystem(itinerary, { view }), [itinerary, view]);
  const marks = itinerary.steps.reduce((n, s) => n + s.marks.length, 0);

  const open = (ref: TikaRef) => {
    if (onIntervention) return onIntervention(ref);
    if (ref.interventionIds.length === 1) navigate(`/f/${farm.id}/interventions/${ref.interventionIds[0]}`);
    else onGroup?.(ref);
  };

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Group gap="sm">{toolbar}</Group>
        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => onView(v as ItineraryChartView)}
          data={[
            { value: "horizontal", label: "Frise" },
            { value: "donut", label: "Cercle" },
          ]}
          aria-label="Présentation"
        />
      </Group>
      {itinerary.steps.length === 0 ? (
        <Alert color="gray">Aucune culture ni intervention sur cette période.</Alert>
      ) : (
        <>
          <Text size="xs" c="dimmed" mb="xs">
            {hint ?? `${marks} intervention${marks > 1 ? "s" : ""} : travaux au-dessus de la culture, intrants au-dessous. Cliquez sur une intervention pour ouvrir sa fiche.`}
          </Text>
          <div style={{ background: "#ffffff", color: "#212529", borderRadius: 4, padding: 8 }}>
            <TikaChart system={system} onIntervention={open} />
          </div>
        </>
      )}
    </Paper>
  );
}
