import { useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, ColorInput, Group, Modal, MultiSelect, Paper, Select, SimpleGrid, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, Pencil, Plus } from "lucide-react";
import { ACTIVITY_FAMILIES, ACTIVITY_FAMILY_LABELS, PARCEL_FAMILIES, type Activity, type ActivityFamily, type ReferenceProduction } from "@fourmy/contracts";
import { formatHa } from "@fourmy/ui-lyvre";
import { api, ApiError, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { useActivities, useCertifications, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ActivityPicture } from "./ActivityBadge";
import { activeDuring, CertificationBadges, CertificationRecap, ParcelCertificationsModal } from "../certifications/Certifications";

/**
 * Activités de la ferme (lot C des retours du 08/11/2026) : comme dans
 * Ekylibre, chaque activité a une production de référence Lexicon (culture
 * contrôlée, culture IFT, image) et ses parcelles par campagne.
 */
export function ActivitiesPage() {
  const farm = useFarm();
  const { at, day } = useAt();
  const year = Number(day.slice(0, 4));
  const list = useActivities(farm.id, year);
  const owner = farm.role === "owner";
  const [editing, setEditing] = useState<Activity | "new" | null>(null);
  const [parcelsOf, setParcelsOf] = useState<Activity | null>(null);

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorAlert error={list.error} />;
  const items = list.data!.items;
  const families = ACTIVITY_FAMILIES.filter((f) => items.some((a) => a.family === f));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Activités {year}</Title>
        {owner && (
          <Button leftSection={<Plus size={16} />} onClick={() => setEditing("new")}>
            Nouvelle activité
          </Button>
        )}
      </Group>
      <Text c="dimmed" size="sm">
        L'activité d'une parcelle désigne sa culture : usages phytosanitaires contrôlés, culture IFT, image. Parcelles et surfaces de la campagne {year}.
      </Text>
      {items.length === 0 && <Alert color="ardoise">Aucune activité : créez-en une, ou reprenez celles d'Ekylibre (Imports).</Alert>}
      {families.map((family) => (
        <Stack key={family} gap="xs">
          <Title order={3}>{ACTIVITY_FAMILY_LABELS[family]}</Title>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {items
              .filter((a) => a.family === family)
              .map((a) => (
                <Paper key={a.id} withBorder p="md" aria-label={`Activité ${a.name}`} style={{ opacity: a.suspended ? 0.6 : 1 }}>
                  <Group wrap="nowrap" align="flex-start">
                    <ActivityPicture activity={a} size={56} />
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={6}>
                        <Text fw={700}>{a.name}</Text>
                        {a.suspended && (
                          <Badge size="xs" color="gray">
                            en sommeil
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {a.referenceLabel ? `Référence : ${a.referenceLabel}` : "Sans production de référence"}
                        {a.cultivationLabel ? ` · culture : ${a.cultivationLabel}` : ""}
                      </Text>
                      {PARCEL_FAMILIES.includes(a.family) && (
                        <Text size="sm" className="lv-num">
                          {a.parcelIds.length} parcelle(s){a.areaM2 ? ` · ${formatHa(a.areaM2)}` : ""}
                        </Text>
                      )}
                      <CertificationRecap parcelIds={a.parcelIds} year={year} />
                    </Stack>
                  </Group>
                  {owner && (
                    <Group gap="xs" mt="sm">
                      <Button size="compact-sm" variant="light" leftSection={<Pencil size={14} />} onClick={() => setEditing(a)}>
                        Modifier
                      </Button>
                      {PARCEL_FAMILIES.includes(a.family) && (
                        <Button size="compact-sm" variant="subtle" leftSection={<MapIcon size={14} />} onClick={() => setParcelsOf(a)}>
                          Parcelles {year}
                        </Button>
                      )}
                    </Group>
                  )}
                </Paper>
              ))}
          </SimpleGrid>
        </Stack>
      ))}
      <ActivityModal activity={editing} year={year} onClose={() => setEditing(null)} />
      <ParcelsModal activity={parcelsOf} year={year} at={at} onClose={() => setParcelsOf(null)} />
    </Stack>
  );
}

function useSave<T>(fn: (body: T) => Promise<unknown>, message: string, onDone: () => void) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: fn,
    onSuccess: () => {
      notifications.show({ color: "lichen", message });
      for (const key of ["activities", "snapshot"]) void queryClient.invalidateQueries({ queryKey: [key] });
      setError(null);
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  return { ...m, error };
}

/** Création ou modification : la production de référence pré-remplit famille, culture et couleur. */
function ActivityModal({ activity, year, onClose }: { activity: Activity | "new" | null; year: number; onClose: () => void }) {
  return (
    <Modal opened={activity !== null} onClose={onClose} title={activity === "new" ? "Nouvelle activité" : "Modifier l'activité"} size="lg">
      {activity !== null && <ActivityForm key={activity === "new" ? "new" : activity.id} activity={activity === "new" ? null : activity} year={year} onDone={onClose} />}
    </Modal>
  );
}

function ActivityForm({ activity, year, onDone }: { activity: Activity | null; year: number; onDone: () => void }) {
  const farm = useFarm();
  const [name, setName] = useState(activity?.name ?? "");
  const [family, setFamily] = useState<ActivityFamily>(activity?.family ?? "plant_farming");
  const [reference, setReference] = useState<string | null>(activity?.reference ?? null);
  const [referenceLabel, setReferenceLabel] = useState<string | null>(activity?.referenceLabel ?? null);
  const [cultivation, setCultivation] = useState<string | null>(activity?.cultivation ?? null);
  const [color, setColor] = useState(activity?.color ?? "");
  const [suspended, setSuspended] = useState(activity?.suspended ?? false);
  const [search, setSearch] = useState("");
  const [q] = useDebouncedValue(search, 250);
  const refs = useQuery({
    queryKey: ["activity-references", farm.id, q],
    queryFn: () => api.get<{ items: ReferenceProduction[] }>(farmPath(farm.id, `/activities/references?q=${encodeURIComponent(q)}`)),
    staleTime: 60_000,
  });
  const options = refs.data?.items ?? [];
  const save = useSave(
    () => {
      const body = { name: name.trim(), family, reference, cultivation, color: color || null, suspended };
      return activity
        ? api.put(farmPath(farm.id, `/activities/${activity.id}?year=${year}`), body)
        : api.post(farmPath(farm.id, `/activities?year=${year}`), body);
    },
    activity ? "Activité modifiée." : "Activité créée.",
    onDone,
  );
  const remove = useSave(() => api.delete(farmPath(farm.id, `/activities/${activity!.id}`)), "Activité supprimée.", onDone);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <Stack>
        <Select
          label="Production de référence (Lexicon)"
          description="Désigne la culture contrôlée (usages E-Phy), la culture IFT et l'image."
          searchable
          clearable
          placeholder="Maïs grain, Jachère, Vigne…"
          searchValue={search}
          onSearchChange={setSearch}
          filter={({ options: o }) => o}
          data={[
            ...(reference && !options.some((o) => o.referenceName === reference) ? [{ value: reference, label: referenceLabel ?? reference }] : []),
            ...options.map((o) => ({ value: o.referenceName, label: `${o.label}${o.specieLabel ? ` (${o.specieLabel})` : ""}` })),
          ]}
          value={reference}
          onChange={(v) => {
            setReference(v);
            const o = options.find((x) => x.referenceName === v);
            if (!o) return;
            setReferenceLabel(o.label);
            setFamily(o.family);
            setCultivation(o.specie);
            if (!name.trim()) setName(o.label);
            if (!color && o.color) setColor(o.color);
          }}
        />
        <TextInput label="Nom" required maxLength={120} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select
          label="Famille"
          data={ACTIVITY_FAMILIES.map((f) => ({ value: f, label: ACTIVITY_FAMILY_LABELS[f] }))}
          value={family}
          onChange={(v) => v && setFamily(v as ActivityFamily)}
          allowDeselect={false}
        />
        <TextInput
          label="Variété cultivée (taxonomie)"
          description="Reprise de la référence ; à préciser au besoin (zea_mays, vitis…)."
          value={cultivation ?? ""}
          onChange={(e) => setCultivation(e.currentTarget.value.trim().toLowerCase() || null)}
        />
        <ColorInput label="Couleur" value={color} onChange={setColor} format="hex" />
        <Switch label="En sommeil (plus proposée)" checked={suspended} onChange={(e) => setSuspended(e.currentTarget.checked)} />
        {(save.error || remove.error) && <Alert color="brique">{save.error ?? remove.error}</Alert>}
        <Group justify="space-between">
          {activity ? (
            <Button variant="subtle" color="brique" onClick={() => remove.mutate(undefined)} loading={remove.isPending}>
              Supprimer
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Parcelles de l'activité pour la campagne (une production par parcelle). */
function ParcelsModal({ activity, year, at, onClose }: { activity: Activity | null; year: number; at: string; onClose: () => void }) {
  return (
    <Modal opened={activity !== null} onClose={onClose} title={activity ? `${activity.name} : parcelles ${year}` : ""} size="lg">
      {activity && <ParcelsForm key={activity.id} activity={activity} year={year} at={at} onDone={onClose} />}
    </Modal>
  );
}

function ParcelsForm({ activity, year, at, onDone }: { activity: Activity; year: number; at: string; onDone: () => void }) {
  const farm = useFarm();
  const snap = useSnapshot(farm.id, at);
  const [selected, setSelected] = useState<string[]>(activity.parcelIds);
  const certifications = useCertifications(farm.id);
  const [certifying, setCertifying] = useState<{ id: string; name: string } | null>(null);
  const save = useSave(
    () => api.put(farmPath(farm.id, `/activities/${activity.id}/parcels`), { year, parcelIds: selected }),
    "Parcelles enregistrées.",
    onDone,
  );
  if (!snap.data) return <Loading />;
  // Parcelles à la date de la frise, plus celles déjà rattachées (d'une autre date).
  const known = new Map(snap.data.landParcels.map((p) => [p.id, `${p.name} (${formatHa(p.version.areaM2)})`]));
  const data = [...known].map(([value, label]) => ({ value, label }));
  for (const id of activity.parcelIds) if (!known.has(id)) data.push({ value: id, label: "Parcelle d'une autre date" });
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Une parcelle peut porter plusieurs activités dans la campagne (cultures successives) ; retirer une parcelle supprime sa production pour cette activité.
      </Text>
      <MultiSelect label="Parcelles" searchable data={data} value={selected} onChange={setSelected} />
      {selected.length > 0 && (
        <Stack gap={4} aria-label="Parcelles et certifications">
          {selected.map((id) => {
            const name = known.get(id) ?? "Parcelle d'une autre date";
            const certs = (certifications.data?.items ?? []).filter((c) => c.landParcelId === id && activeDuring(c, `${year}-01-01`, `${year}-12-31`));
            return (
              <Group key={id} justify="space-between" wrap="nowrap" gap="xs">
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" component={Link} to={`/f/${farm.id}/land-parcels/${id}`} c="inherit">
                    {name}
                  </Text>
                  <CertificationBadges certs={certs} />
                </Group>
                <Button size="compact-xs" variant="subtle" onClick={() => setCertifying({ id, name })}>
                  Certifications
                </Button>
              </Group>
            );
          })}
        </Stack>
      )}
      <ParcelCertificationsModal parcel={certifying} onClose={() => setCertifying(null)} />
      {save.error && <Alert color="brique">{save.error}</Alert>}
      <Group justify="space-between">
        <Button component={Link} to={`/f/${farm.id}/land-parcels/new?activity=${activity.id}`} variant="subtle" leftSection={<Plus size={14} />}>
          Nouvelle parcelle sur la carte
        </Button>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>
          Enregistrer
        </Button>
      </Group>
    </Stack>
  );
}
