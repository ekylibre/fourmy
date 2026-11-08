import { ActionIcon, Alert, Button, Group, Paper, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import { Combine, MousePointer2, Pentagon, Ruler, Scissors, SquareDashed, Trash2, Undo2 } from "lucide-react";
import type { CartoTool } from "./editor";
import type { CartoState } from "./useCartoEditor";
import { formatArea, formatLength } from "./format";

const TOOLS: { value: CartoTool; label: string; icon: typeof Pentagon; help: string }[] = [
  { value: "select", label: "Modifier", icon: MousePointer2, help: "Cliquez une surface, puis déplacez-la ou tirez ses sommets ; un point au milieu d'un bord ajoute un sommet." },
  { value: "draw", label: "Dessiner", icon: Pentagon, help: "Cliquez les sommets ; cliquez le premier point pour fermer la surface." },
  { value: "cut", label: "Découper", icon: Scissors, help: "Tracez une ligne qui commence et finit hors de la surface ; double-cliquez pour finir. Sans sélection, toutes les surfaces traversées sont découpées." },
  { value: "merge", label: "Fusionner", icon: Combine, help: "Cliquez les surfaces voisines à fusionner, puis « Fusionner la sélection »." },
  { value: "measure-line", label: "Distance", icon: Ruler, help: "Cliquez les points du trajet ; double-cliquez pour finir." },
  { value: "measure-area", label: "Surface", icon: SquareDashed, help: "Cliquez les sommets ; la surface s'affiche pendant le tracé." },
];

/**
 * Barre d'outils carto commune : choix de l'outil, consigne, mesure en cours,
 * actions sur la sélection, annuler. S'utilise avec n'importe quelle carte
 * éditée par `useCartoEditor`.
 */
export function CartoToolbar({ state, tools = TOOLS.map((t) => t.value) }: { state: CartoState; tools?: CartoTool[] }) {
  const { editor, tool, selection, measure, error } = state;
  const current = TOOLS.find((t) => t.value === tool)!;
  return (
    <Paper p="sm" withBorder>
      <Stack gap="xs">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <SegmentedControl
            aria-label="Outil de carte"
            value={tool}
            onChange={(v) => state.setTool(v as CartoTool)}
            disabled={!editor}
            data={TOOLS.filter((t) => tools.includes(t.value)).map((t) => ({
              value: t.value,
              label: (
                <Group gap={6} wrap="nowrap">
                  <t.icon size={16} aria-hidden />
                  <span>{t.label}</span>
                </Group>
              ),
            }))}
          />
          <Group gap="xs">
            {tool === "merge" && (
              <Button size="xs" onClick={() => editor?.mergeSelected()} disabled={selection.length < 2}>
                Fusionner la sélection ({selection.length})
              </Button>
            )}
            <Tooltip label="Supprimer la sélection">
              <ActionIcon variant="default" aria-label="Supprimer la sélection" onClick={() => editor?.deleteSelected()} disabled={selection.length === 0}>
                <Trash2 size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Annuler la dernière opération">
              <ActionIcon variant="default" aria-label="Annuler" onClick={() => editor?.undo()} disabled={!state.canUndo}>
                <Undo2 size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <Text size="sm" c="dimmed">
          {current.help}
        </Text>
        {measure && (
          <Text size="sm" role="status" aria-label="Mesure">
            {measure.areaM2 !== undefined && <>Surface : <strong className="lv-num">{formatArea(measure.areaM2)}</strong></>}
            {measure.perimeterM !== undefined && <> · périmètre {formatLength(measure.perimeterM)}</>}
            {measure.lengthM !== undefined && <>Distance : <strong className="lv-num">{formatLength(measure.lengthM)}</strong></>}
          </Text>
        )}
        {error && (
          <Alert color="red" variant="light" withCloseButton onClose={state.clearError} role="alert">
            {error}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
