import { ActionIcon, Button, Group, Slider, Text, TextInput, Tooltip } from "@mantine/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { todayIso, useAt } from "../app/at";

const DAY = 86_400_000;
const START = "2015-01-01";

const toDays = (day: string) => Math.round((Date.parse(day) - Date.parse(START)) / DAY);
const fromDays = (n: number) => new Date(Date.parse(START) + n * DAY).toISOString().slice(0, 10);

/**
 * Frise temporelle : la date choisie (URL ?at=) pilote toutes les vues — la
 * ferme « au 15 mars » est une requête, pas une reconstruction (FR-TIME-1).
 */
export function Timeline() {
  const { day, setDay, isToday } = useAt();
  const max = toDays(todayIso());
  const shift = (days: number) => setDay(fromDays(Math.min(Math.max(toDays(day) + days, 0), max)));
  const years = Array.from({ length: Number(todayIso().slice(0, 4)) - 2014 }, (_, i) => 2015 + i);

  return (
    <div className="fy-timeline">
      <Group gap="sm" px="md" py={6} wrap="nowrap" align="center">
        <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: "0.06em" }} visibleFrom="sm">
          Frise
        </Text>
        <Tooltip label="Jour précédent">
          <ActionIcon variant="subtle" aria-label="Jour précédent" onClick={() => shift(-1)}>
            <ChevronLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <TextInput
          type="date"
          aria-label="Date de la frise"
          value={day}
          min={START}
          max={todayIso()}
          onChange={(e) => e.currentTarget.value && setDay(e.currentTarget.value)}
          w={160}
          size="xs"
        />
        <Tooltip label="Jour suivant">
          <ActionIcon variant="subtle" aria-label="Jour suivant" onClick={() => shift(1)} disabled={isToday}>
            <ChevronRight size={18} />
          </ActionIcon>
        </Tooltip>
        <Slider
          aria-label="Curseur de la frise"
          style={{ flex: 1, minWidth: 120 }}
          // Sur téléphone, le curseur et ses années ne tiennent pas : la date et les flèches suffisent.
          visibleFrom="sm"
          min={0}
          max={max}
          value={toDays(day)}
          onChange={(n) => setDay(fromDays(n))}
          label={(n) => new Date(fromDays(n)).toLocaleDateString("fr-FR")}
          marks={years.filter((y) => y % 2 === 1).map((y) => ({ value: toDays(`${y}-01-01`), label: String(y) }))}
          mb="sm"
        />
        <Button size="xs" variant={isToday ? "light" : "filled"} onClick={() => setDay(todayIso())} disabled={isToday}>
          Aujourd'hui
        </Button>
      </Group>
    </div>
  );
}
