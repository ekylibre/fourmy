import { Group, Paper, Stack, Text } from "@mantine/core";
import type { CropPlanContext } from "@fourmy/contracts";
import { useArea } from "../../app/prefs";
import { TODO } from "./CropPlanMap";
import type { CropPlanEditor } from "./useCropPlanEditor";

/** Couleur des parcelles « sans culture » (jachère, gel). */
export const FALLOW = "#868E96";

const Swatch = ({ color, dashed = false }: { color: string; dashed?: boolean }) => (
  <span
    aria-hidden
    style={{
      width: 14,
      height: 14,
      borderRadius: 3,
      display: "inline-block",
      flex: "none",
      background: dashed ? "transparent" : `${color}99`,
      border: `2px ${dashed ? "dashed" : "solid"} ${color}`,
    }}
  />
);

/**
 * Légende de la carte (retours de test du 20/11) : activités prévues avec leur
 * image et leur surface, parcelles sans culture, parcelles encore à affecter.
 */
export function MapLegend({ editor, context, colors }: { editor: CropPlanEditor; context: CropPlanContext; colors: Map<string, string> }) {
  const area = useArea();
  const pictures = new Map(context.activities.map((a) => [a.id, a.pictureUrl]));
  const s = editor.summary;
  return (
    <Paper withBorder shadow="xs" p={6} style={{ background: "var(--mantine-color-body)", opacity: 0.94 }} aria-label="Légende de la carte">
      <Stack gap={3}>
        {s.byActivity
          .filter((l) => l.areaM2 > 0)
          .map((l) => (
            <Group key={l.activityId} gap={6} wrap="nowrap">
              <Swatch color={colors.get(l.activityId) ?? "#999999"} />
              {pictures.get(l.activityId) ? <img src={pictures.get(l.activityId)!} alt="" width={18} height={18} style={{ objectFit: "contain", flex: "none" }} /> : null}
              <Text size="xs" lineClamp={1}>
                {l.name} <span className="lv-num">{area(l.areaM2)}</span>
              </Text>
            </Group>
          ))}
        {s.fallowM2 > 0 && (
          <Group gap={6} wrap="nowrap">
            <Swatch color={FALLOW} />
            <Text size="xs">
              Sans culture <span className="lv-num">{area(s.fallowM2)}</span>
            </Text>
          </Group>
        )}
        {s.unassigned.keys.length > 0 && (
          <Group gap={6} wrap="nowrap">
            <Swatch color={TODO} dashed />
            <Text size="xs" c="brique">
              Sans culture prévue : {s.unassigned.keys.length} ({area(s.unassigned.areaM2)})
            </Text>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
