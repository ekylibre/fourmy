import { Badge, Checkbox, Select, Switch, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IAE_TYPES } from "@fourmy/certification-refs";
import type { HveIaeItem, LandscapeFeatureHveWrite } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";

const UNITS: Record<NonNullable<HveIaeItem["unit"]>, string> = { m: "m", m2: "m²", tree: "arbre" };
const TYPES = [{ value: "", label: "Pas une IAE" }, ...IAE_TYPES.map((t) => ({ value: t.code, label: t.label }))];

/**
 * Onglet IAE du contrôle HVE (lot CT4) : éléments du paysage importés de
 * TelePAC, type HVE proposé, validation par l'exploitant (maîtrise,
 * entretien, aucun traitement), mitoyenneté. Seules les IAE validées
 * comptent (item 4.1, et 5.2).
 */
export function HveIae({ campaign }: { campaign: number }) {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["certifications", "hve-iae", farm.id, campaign],
    queryFn: () => api.get<{ items: HveIaeItem[] }>(farmPath(farm.id, `/control/hve/iae?campaign=${campaign}`)),
  });
  const save = useMutation({
    mutationFn: ({ id, w }: { id: string; w: LandscapeFeatureHveWrite }) => api.put(farmPath(farm.id, `/landscape-features/${id}/hve`), w),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["certifications"] }),
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const items = q.data!.items;
  if (!items.length) return <Text c="dimmed">Aucun élément du paysage : importez la déclaration TelePAC (surfaces non agricoles) depuis Imports.</Text>;
  const write = (f: HveIaeItem, patch: Partial<LandscapeFeatureHveWrite>) =>
    save.mutate({ id: f.id, w: { type: f.type, validated: f.validated, shared: f.shared, ...patch } });
  return (
    <>
      <Text size="sm" c="dimmed">
        Validez chaque IAE dont vous avez la maîtrise et l'entretien, sans traitement ni fertilisant. Les types sont proposés d'après la déclaration TelePAC ; seules les IAE validées comptent.
      </Text>
      <Table withTableBorder aria-label="Infrastructures agro-écologiques">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Élément</Table.Th>
            <Table.Th>Type HVE</Table.Th>
            <Table.Th>Quantité</Table.Th>
            <Table.Th>Surface équivalente</Table.Th>
            <Table.Th>Terres arables</Table.Th>
            <Table.Th>Mitoyen</Table.Th>
            <Table.Th>Validée</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((f) => (
            <Table.Tr key={f.id}>
              <Table.Td>
                {f.label}
                {f.capType && (
                  <Text span size="xs" c="dimmed">
                    {" "}
                    ({f.capType})
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Select
                  aria-label={`Type HVE de ${f.label}`}
                  data={TYPES}
                  value={f.type ?? ""}
                  disabled={!owner}
                  size="xs"
                  w={220}
                  allowDeselect={false}
                  onChange={(v) => write(f, { type: v || null, validated: v ? f.validated : false })}
                />
                {f.proposed && (
                  <Badge size="xs" variant="light" color="ardoise" mt={4}>
                    Proposé
                  </Badge>
                )}
              </Table.Td>
              <Table.Td className="lv-num">{f.unit ? `${f.quantity.toLocaleString("fr-FR")} ${UNITS[f.unit]}` : "—"}</Table.Td>
              <Table.Td className="lv-num">{f.equivalentM2 !== null ? `${f.equivalentM2.toLocaleString("fr-FR")} m²` : "—"}</Table.Td>
              <Table.Td>{f.onArable ? "Adjacente" : "Non"}</Table.Td>
              <Table.Td>
                <Switch aria-label={`${f.label} mitoyen`} checked={f.shared} disabled={!owner || f.unit !== "m"} onChange={(e) => write(f, { shared: e.currentTarget.checked })} />
              </Table.Td>
              <Table.Td>
                <Checkbox aria-label={`Valider ${f.label}`} checked={f.validated} disabled={!owner || !f.type} onChange={(e) => write(f, { validated: e.currentTarget.checked })} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
}
