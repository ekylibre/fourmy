import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, ScrollArea, Stack, Table, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unitLabel, type PlannedConfirmResult, type PlannedItem, type PlannedPreview, type PlannedState } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";

const STATE: Record<PlannedState, { label: string; color: string }> = {
  create: { label: "à créer", color: "lichen" },
  update: { label: "à mettre à jour", color: "paille" },
  remove: { label: "à retirer", color: "brique" },
  same: { label: "à jour", color: "gray" },
  modified: { label: "modifiée à la main, gardée", color: "ardoise" },
  done: { label: "réalisée, gardée", color: "gray" },
  undated: { label: "date à préciser", color: "orange" },
};
const ACTIONABLE = new Set<PlannedState>(["create", "update", "remove"]);
const frenchDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

/**
 * « Préparer les interventions prévues » d'une campagne (lot IT3, conception
 * §7, décisions A10 et A14) : propositions des ITK des productions,
 * rapprochées de l'existant, cochées puis confirmées. Rien n'est écrit avant
 * « Confirmer » ; ce qui a été modifié à la main ou réalisé n'est jamais touché.
 */
export function PlannedInterventionsModal({ farmId, year, onClose }: { farmId: string; year: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ["planned-interventions", farmId, year],
    queryFn: () => api.post<PlannedPreview>(farmPath(farmId, `/planned-interventions/${year}/preview`), {}),
    staleTime: 0,
    gcTime: 0,
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dates, setDates] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<PlannedConfirmResult["failed"]>([]);
  const [stale, setStale] = useState(false);

  // Coché par défaut : ce qui est à créer (sauf les étapes « si besoin »), à mettre à jour ou à retirer.
  useEffect(() => {
    if (!preview.data) return;
    setChecked(new Set(preview.data.items.filter((i) => ACTIONABLE.has(i.state) && !(i.state === "create" && i.optional)).map((i) => i.key)));
    setDates({});
  }, [preview.data]);

  const groups = useMemo(() => {
    const m = new Map<string, PlannedItem[]>();
    for (const i of preview.data?.items ?? []) {
      const k = `${i.parcelName}|${i.activityName}`;
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m];
  }, [preview.data]);

  const confirm = useMutation({
    mutationFn: () =>
      api.post<PlannedConfirmResult>(farmPath(farmId, `/planned-interventions/${year}`), {
        previewHash: preview.data!.previewHash,
        accepted: [...checked],
        dateEdits: Object.fromEntries(Object.entries(dates).filter(([k, v]) => checked.has(k) && /^\d{4}-\d{2}-\d{2}$/.test(v))),
      }),
    onSuccess: async (r) => {
      setFailed(r.failed);
      setStale(false);
      const parts = [r.created && `${r.created} créée(s)`, r.updated && `${r.updated} mise(s) à jour`, r.removed && `${r.removed} retirée(s)`].filter(Boolean);
      notifications.show({ color: r.failed.length ? "orange" : "lichen", message: `Interventions prévues : ${parts.join(", ") || "aucun changement"}${r.failed.length ? `, ${r.failed.length} refusée(s)` : ""}.` });
      await queryClient.invalidateQueries({ queryKey: ["interventions", farmId] });
      await preview.refetch();
      if (!r.failed.length) onClose();
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setStale(true);
        await preview.refetch();
      } else notifications.show({ color: "red", message: e instanceof Error ? e.message : String(e) });
    },
  });

  const p = preview.data;
  const counts = (s: PlannedState) => p?.items.filter((i) => i.state === s).length ?? 0;
  const toggle = (key: string, on: boolean) => setChecked((cur) => {
    const next = new Set(cur);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  });

  return (
    <Modal opened onClose={onClose} title={`Interventions prévues ${year}`} size="90%">
      <Stack>
        <Text size="sm" c="dimmed">
          D'après l'itinéraire technique de chaque culture de l'assolement. Cochez ce qui doit être créé, mis à jour ou retiré, ajustez les dates, puis confirmez.
          Une intervention modifiée à la main ou réalisée n'est jamais touchée.
        </Text>
        {preview.isLoading && <Loader size="sm" />}
        {preview.error && <Alert color="red">{(preview.error as Error).message}</Alert>}
        {stale && <Alert color="orange">L'aperçu avait changé (itinéraire ou assolement modifié entre-temps) : relisez-le, puis confirmez à nouveau.</Alert>}
        {p && (
          <>
            <Group gap="xs">
              {(["create", "update", "remove", "same", "modified", "done", "undated"] as PlannedState[])
                .filter((s) => counts(s) > 0)
                .map((s) => (
                  <Badge key={s} color={STATE[s].color} variant="light">
                    {counts(s)} {STATE[s].label}
                  </Badge>
                ))}
              {p.withoutItinerary > 0 && (
                <Badge color="gray" variant="outline">
                  {p.withoutItinerary} culture(s) sans itinéraire
                </Badge>
              )}
            </Group>
            {p.items.length === 0 ? (
              <Alert color="gray">
                Aucune culture de {year} n'a d'itinéraire technique. Choisissez-en un dans l'assolement (« Modifier », panneau Affecter), ou{" "}
                <Text component={Link} to={`/f/${farmId}/itineraries`} c="lichen" inherit>
                  créez des itinéraires
                </Text>
                .
              </Alert>
            ) : (
              <ScrollArea.Autosize mah="60vh">
                <Table verticalSpacing={4} aria-label="Interventions proposées">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={36} />
                      <Table.Th>Intervention</Table.Th>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Surface</Table.Th>
                      <Table.Th>Intrants</Table.Th>
                      <Table.Th>État</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {groups.map(([k, items]) => (
                      <Fragment key={k}>
                        <Table.Tr>
                          <Table.Td colSpan={6} bg="var(--mantine-color-default-hover)">
                            <Text size="sm" fw={600}>
                              {items[0]!.parcelName}
                              {items[0]!.activityName ? ` · ${items[0]!.activityName}` : ""}
                              <Text span size="xs" c="dimmed">
                                {items[0]!.itineraryName ? ` — ${items[0]!.itineraryName}` : ""}
                              </Text>
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                        {items.map((i) => {
                          const actionable = ACTIONABLE.has(i.state);
                          const editable = i.state === "create" || i.state === "update";
                          return (
                            <Table.Tr key={i.key}>
                              <Table.Td>
                                {actionable && <Checkbox checked={checked.has(i.key)} onChange={(e) => toggle(i.key, e.currentTarget.checked)} aria-label={`${i.parcelName} · ${i.label}`} />}
                              </Table.Td>
                              <Table.Td>
                                <Group gap={6} wrap="nowrap">
                                  <Text size="sm">{i.label}</Text>
                                  {i.optional && (
                                    <Badge size="xs" variant="light" color="gray">
                                      si besoin
                                    </Badge>
                                  )}
                                </Group>
                              </Table.Td>
                              <Table.Td>
                                {editable ? (
                                  <TextInput
                                    type="date"
                                    size="xs"
                                    w={150}
                                    value={dates[i.key] ?? i.day ?? ""}
                                    onChange={(e) => {
                                      const value = e.currentTarget.value;
                                      setDates((d) => ({ ...d, [i.key]: value }));
                                    }}
                                    aria-label={`Date de ${i.label}`}
                                  />
                                ) : (
                                  <Text size="sm" c={i.day ? undefined : "dimmed"}>
                                    {i.day ? frenchDay(i.day) : "à préciser"}
                                  </Text>
                                )}
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm">{i.areaM2 ? `${fmt(i.areaM2 / 10_000)} ha` : "—"}</Text>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c={i.inputs.length ? undefined : "dimmed"}>
                                  {i.inputs.map((x) => `${x.label} ${fmt(x.dose)} ${unitLabel(x.unit)}${x.articleId ? "" : " (à préciser)"}`).join(" · ") || "—"}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Group gap={4} wrap="nowrap">
                                  <Badge size="sm" color={STATE[i.state].color} variant="light">
                                    {STATE[i.state].label}
                                  </Badge>
                                  {i.itineraryChanged && (
                                    <Badge size="sm" color="paille" variant="outline">
                                      itinéraire modifié
                                    </Badge>
                                  )}
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
            {failed.length > 0 && (
              <Alert color="orange" title="Refusées (le reste est enregistré)">
                <Stack gap={2}>
                  {failed.map((f) => (
                    <Text key={f.key} size="sm">
                      {f.message}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Fermer
              </Button>
              <Button onClick={() => confirm.mutate()} loading={confirm.isPending} disabled={checked.size === 0}>
                Confirmer ({checked.size})
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
