import { Link, useLocation } from "react-router";
import { Anchor, Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { Sprout } from "lucide-react";
import type { CropAlert, CropAlertKind } from "@fourmy/contracts";
import { useCropModel } from "./crop-model";

const KINDS: { kind: CropAlertKind; title: string; color: string }[] = [
  { kind: "water_stress", title: "Stress hydrique (en sec)", color: "brique" },
  { kind: "irrigation_due", title: "Irrigation à prévoir", color: "ardoise" },
  { kind: "flowering_soon", title: "Floraison dans les 10 jours", color: "lichen" },
  { kind: "harvestable_soon", title: "Récoltable dans les 15 jours", color: "paille" },
];

/**
 * Widget du tableau de bord (lot AB) : ce que le modèle de croissance prévoit
 * à la date de la frise, regroupé par sorte (une ligne par parcelle).
 */
export function CropModelWidget({ farmId, day }: { farmId: string; day: string }) {
  const location = useLocation();
  const q = useCropModel(farmId, day);
  const alerts = q.data?.alerts ?? [];
  if (alerts.length === 0) return null;
  const link = (a: CropAlert) => `/f/${farmId}/land-parcels/${a.parcelId}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), tab: "vegetation" })}`;
  return (
    <Paper p="md" aria-label="Modèle de croissance">
      <Group gap="xs" mb="xs">
        <Sprout size={18} />
        <Title order={3}>Cultures : ce que prévoit le modèle</Title>
      </Group>
      <Stack gap="sm">
        {KINDS.map(({ kind, title, color }) => {
          const list = alerts.filter((a) => a.kind === kind);
          if (list.length === 0) return null;
          return (
            <div key={kind}>
              <Group gap="xs" mb={4}>
                <Badge color={color} variant="light">
                  {list.length}
                </Badge>
                <Text fw={600} size="sm">
                  {title}
                </Text>
              </Group>
              <Stack gap={2} pl="md">
                {list.map((a) => (
                  <Text key={`${a.parcelId}:${a.kind}`} size="sm">
                    <Anchor component={Link} to={link(a)}>
                      {a.parcelName}
                    </Anchor>{" "}
                    <Text span size="xs" c="dimmed">
                      {a.text}
                    </Text>
                  </Text>
                ))}
              </Stack>
            </div>
          );
        })}
      </Stack>
      <Text size="xs" c="dimmed" mt="sm">
        Stades par degrés-jours depuis le semis saisi, bilan hydrique FAO-56, météo Open-Meteo.
      </Text>
    </Paper>
  );
}
