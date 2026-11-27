import { Checkbox, Radio, SegmentedControl, Stack, Table, Text } from "@mantine/core";
import { ACCESS_MODULE_LABELS, accessModules, type AccessGrant, type AccessLevel } from "@fourmy/contracts";
import { useActivities } from "../../app/queries";

/** Droits de départ d'un invité restreint : la carte, les activités et les interventions, en lecture. */
export const DEFAULT_GUEST_GRANT: AccessGrant = { modules: { parcels: "read", activities: "read", interventions: "read" }, activities: "all" };

/** Les droits ouvrent-ils quelque chose ? (au moins un module, et une activité si la liste est restreinte) */
export const grantUsable = (g: AccessGrant) =>
  Object.values(g.modules).some((l) => l && l !== "none") && (g.activities === "all" || g.activities.length > 0);

/**
 * Éditeur de droits d'un accès restreint (lot AM3, conception_api_mcp.md §9) :
 * un niveau par module, puis toutes les activités ou une liste. Lot AM3 :
 * aucun ou lecture ; « lecture et propositions » viendra avec les propositions (AM8).
 */
export function AccessGrantEditor({ farmId, value, onChange }: { farmId: string; value: AccessGrant; onChange: (g: AccessGrant) => void }) {
  const activities = useActivities(farmId, new Date().getFullYear());
  const setLevel = (m: (typeof accessModules)[number], level: AccessLevel) => onChange({ ...value, modules: { ...value.modules, [m]: level } });
  const chosen = value.activities === "all" ? [] : value.activities;
  return (
    <Stack gap="sm">
      <Table withRowBorders={false} verticalSpacing={4} aria-label="Droits par module">
        <Table.Tbody>
          {accessModules.map((m) => (
            <Table.Tr key={m}>
              <Table.Td>
                <Text size="sm">{ACCESS_MODULE_LABELS[m]}</Text>
              </Table.Td>
              <Table.Td>
                <SegmentedControl
                  size="xs"
                  aria-label={`Accès au module ${ACCESS_MODULE_LABELS[m]}`}
                  value={value.modules[m] === "read" || value.modules[m] === "write" ? "read" : "none"}
                  onChange={(v) => setLevel(m, v as AccessLevel)}
                  data={[
                    { value: "none", label: "Aucun" },
                    { value: "read", label: "Lecture" },
                  ]}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Radio.Group
        label="Activités"
        description="Limitez l'accès à certaines activités : parcelles, interventions, registres et assolement ne montrent alors que celles-ci."
        value={value.activities === "all" ? "all" : "some"}
        onChange={(v) => onChange({ ...value, activities: v === "all" ? "all" : [] })}
      >
        <Stack gap={4} mt={4}>
          <Radio value="all" label="Toutes les activités, y compris celles créées plus tard" />
          <Radio value="some" label="Certaines activités" />
        </Stack>
      </Radio.Group>
      {value.activities !== "all" && (
        <Checkbox.Group value={chosen} onChange={(ids) => onChange({ ...value, activities: ids })} aria-label="Activités ouvertes">
          <Stack gap={4} pl="md">
            {(activities.data?.items ?? []).map((a) => (
              <Checkbox key={a.id} value={a.id} label={a.name} />
            ))}
            {activities.data && !activities.data.items.length && (
              <Text size="sm" c="dimmed">
                Aucune activité sur la ferme.
              </Text>
            )}
          </Stack>
        </Checkbox.Group>
      )}
      <Text size="xs" c="dimmed">
        Un invité restreint consulte seulement : il ne saisit rien et ne voit ni les coordonnées des personnes, ni les réglages de la ferme.
      </Text>
    </Stack>
  );
}
