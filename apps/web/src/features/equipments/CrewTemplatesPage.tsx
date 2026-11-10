import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Alert, Badge, Button, Group, Modal, MultiSelect, Paper, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import type { CrewTemplate, CrewTemplateWrite } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { useCrewTemplates, useEquipments, usePeople } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";

/**
 * Matériels › Attelages types (FR-ATT-6) : les compositions habituelles de
 * la ferme (matériels, intervenants), reprises en un clic dans le formulaire
 * d'intervention. Lecture pour tous, écriture pour le responsable. Modifier
 * ou supprimer un attelage type ne change pas les interventions passées.
 */
export function CrewTemplatesPage() {
  const farm = useFarm();
  const location = useLocation();
  const q = useCrewTemplates(farm.id);
  const equipments = useEquipments(farm.id);
  const people = usePeople(farm.id);
  const [editing, setEditing] = useState<CrewTemplate | "new" | null>(null);
  const owner = farm.role === "owner";

  if (q.isLoading || equipments.isLoading || people.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const equipmentName = new Map((equipments.data?.items ?? []).map((e) => [e.id, e.name]));
  const personName = new Map((people.data?.items ?? []).map((p) => [p.id, p.name]));
  const items = q.data?.items ?? [];

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="xs">
          <Button component={Link} to={`/f/${farm.id}/equipments${location.search}`} variant="subtle" px={4} aria-label="Retour aux matériels">
            <ArrowLeft size={18} />
          </Button>
          <Title order={1}>Attelages types</Title>
        </Group>
        {owner && (
          <Button leftSection={<Plus size={16} />} onClick={() => setEditing("new")}>
            Nouvel attelage type
          </Button>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        Vos compositions habituelles : à la saisie d'une intervention en attelages, un clic remplit les matériels et les intervenants ; il ne reste que les périodes.
      </Text>
      <Paper withBorder>
        <Table verticalSpacing="xs" aria-label="Attelages types">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nom</Table.Th>
              <Table.Th>Matériels</Table.Th>
              <Table.Th>Intervenants</Table.Th>
              {owner && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((t) => (
              <Table.Tr key={t.id} style={{ opacity: t.active ? 1 : 0.6 }}>
                <Table.Td>
                  <Group gap={6}>
                    <Text fw={600} size="sm">
                      {t.name}
                    </Text>
                    {!t.active && (
                      <Badge size="xs" color="gray" variant="light">
                        Hors service
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{t.equipmentIds.map((id) => equipmentName.get(id) ?? "?").join(" + ")}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={t.personIds.length ? undefined : "dimmed"}>
                    {t.personIds.map((id) => personName.get(id) ?? "?").join(", ") || "Conducteur au choix"}
                  </Text>
                </Table.Td>
                {owner && (
                  <Table.Td ta="right">
                    <Button size="compact-sm" variant="light" onClick={() => setEditing(t)} aria-label={`Modifier ${t.name}`}>
                      Modifier
                    </Button>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
            {items.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={owner ? 4 : 3}>
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    Aucun attelage type. {owner ? "Créez-en un ici, ou depuis un attelage saisi dans une intervention." : ""}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>
      {editing && (
        <CrewTemplateModal
          farmId={farm.id}
          template={editing === "new" ? null : editing}
          equipmentOptions={(equipments.data?.items ?? []).filter((e) => !e.state || e.state === "active" || (editing !== "new" && editing.equipmentIds.includes(e.id))).map((e) => ({ value: e.id, label: e.name }))}
          peopleOptions={(people.data?.items ?? []).filter((p) => p.active || (editing !== "new" && editing.personIds.includes(p.id))).map((p) => ({ value: p.id, label: p.name }))}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

type Option = { value: string; label: string };

/**
 * Création ou modification d'un attelage type. `initial` pré-remplit une
 * création (« Enregistrer comme attelage type » depuis le formulaire
 * d'intervention).
 */
export function CrewTemplateModal({
  farmId,
  template,
  initial,
  equipmentOptions,
  peopleOptions,
  onClose,
  onSaved,
}: {
  farmId: string;
  template: CrewTemplate | null;
  initial?: Partial<Pick<CrewTemplate, "name" | "equipmentIds" | "personIds">>;
  equipmentOptions: Option[];
  peopleOptions: Option[];
  onClose: () => void;
  onSaved?: (t: CrewTemplate) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(template?.name ?? initial?.name ?? "");
  const [equipmentIds, setEquipmentIds] = useState<string[]>(template?.equipmentIds ?? initial?.equipmentIds ?? []);
  const [personIds, setPersonIds] = useState<string[]>(template?.personIds ?? initial?.personIds ?? []);
  const [active, setActive] = useState(template?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const done = (message: string) => {
    setError(null);
    notifications.show({ color: "lichen", message });
    void queryClient.invalidateQueries({ queryKey: ["crew-templates", farmId] });
    onClose();
  };
  const fail = (e: unknown) => setError(e instanceof ApiError && e.status === 409 ? "Un attelage type porte déjà ce nom." : e instanceof Error ? e.message : String(e));

  const save = useMutation({
    mutationFn: (body: CrewTemplateWrite) =>
      template
        ? api.put<CrewTemplate>(farmPath(farmId, `/crew-templates/${template.id}`), body)
        : api.post<CrewTemplate>(farmPath(farmId, "/crew-templates"), { ...body, id: crypto.randomUUID() }),
    onSuccess: (t) => {
      onSaved?.(t);
      done(template ? "Attelage type modifié." : "Attelage type enregistré.");
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(farmPath(farmId, `/crew-templates/${template!.id}`)),
    onSuccess: () => done("Attelage type supprimé."),
    onError: fail,
  });

  const ready = name.trim().length > 0 && equipmentIds.length > 0;
  return (
    <Modal opened onClose={onClose} title={template ? `Modifier « ${template.name} »` : "Nouvel attelage type"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // La fenêtre est rendue hors du DOM du formulaire d'intervention, mais
          // React y fait remonter l'envoi : sans ceci, l'intervention s'enregistrerait.
          e.stopPropagation();
          if (ready) save.mutate({ name: name.trim(), active, equipmentIds, personIds });
        }}
      >
        <Stack>
          <TextInput label="Nom" placeholder="Arion 630 + charrue — Pierre" required maxLength={80} value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
          <MultiSelect label="Matériels" description="Dans l'ordre : tracteur, puis outils" searchable required data={equipmentOptions} value={equipmentIds} onChange={setEquipmentIds} />
          <MultiSelect label="Intervenants" placeholder={personIds.length ? undefined : "Conducteur au choix"} searchable data={peopleOptions} value={personIds} onChange={setPersonIds} />
          {template && <Switch label="En service" checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />}
          {error && (
            <Alert color="brique" variant="light">
              {error}
            </Alert>
          )}
          <Text size="xs" c="dimmed">
            Les interventions déjà saisies gardent leur composition.
          </Text>
          <Group justify="space-between">
            {template ? (
              <Button variant="subtle" color="brique" loading={remove.isPending} onClick={() => remove.mutate()}>
                Supprimer
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!ready} loading={save.isPending}>
              Enregistrer
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
