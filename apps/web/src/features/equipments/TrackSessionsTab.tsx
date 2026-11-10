import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Checkbox, Grid, Group, Paper, SegmentedControl, Select, Stack, Table, Text, TextInput, Tooltip } from "@mantine/core";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import type { TrackSession, TrackSessionDetail, TrackSessionList } from "@fourmy/contracts";
import { formatHa } from "@fourmy/ui-lyvre";
import type { FeatureCollection, Geometry } from "geojson";
import { api, farmPath } from "../../app/api";
import { procedureLabel } from "../../app/labels";
import { useSnapshot } from "../../app/queries";
import { MapBoundary } from "../../components/MapBoundary";
import { ErrorAlert, Loading } from "../../components/states";
import { ParcelMap } from "../map/ParcelMap";
import { formatDuration } from "../interventions/periods";

/**
 * Onglet « Parcours » d'un matériel (lot O4, FR-GPS-10 à 15, 17) : les
 * sessions de travail et les déplacements calculés depuis les traces GPS,
 * filtrés et paginés, avec la trace et la couverture de la sélection sur une
 * mini-carte. Sur un outil sans boîtier, les parcours des tracteurs où il
 * était attelé, avec le tracteur.
 */

const DAY = 86_400_000;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const date = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const km = (m: number) => `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;

/** L'onglet n'apparaît que si le matériel a au moins un parcours (sur 400 jours). */
export function useHasTrackSessions(farmId: string, equipmentId: string) {
  return useQuery({
    queryKey: ["track-sessions-any", farmId, equipmentId],
    queryFn: () =>
      api.get<TrackSessionList>(
        farmPath(farmId, `/equipments/${equipmentId}/track-sessions?from=${new Date(Date.now() - 399 * DAY).toISOString()}&limit=1`),
      ),
    select: (r) => r.items.length > 0,
    staleTime: 5 * 60_000,
  });
}

type Filters = { from: string; to: string; kind: "" | "work" | "transit"; state: "" | "free" | "linked"; parcel: string | null };

export function TrackSessionsTab({ farmId, equipmentId }: { farmId: string; equipmentId: string }) {
  const today = new Date();
  const [filters, setFilters] = useState<Filters>({
    from: dayOf(new Date(today.getTime() - 30 * DAY)),
    to: dayOf(today),
    kind: "",
    state: "",
    parcel: null,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected([]);
  };

  const query = (cursor: string | null) => {
    const p = new URLSearchParams({
      from: new Date(`${filters.from}T00:00:00`).toISOString(),
      to: new Date(new Date(`${filters.to}T00:00:00`).getTime() + DAY).toISOString(),
      limit: "50",
    });
    if (filters.kind) p.set("kind", filters.kind);
    if (filters.state) p.set("state", filters.state);
    if (filters.parcel) p.set("parcel", filters.parcel);
    if (cursor) p.set("cursor", cursor);
    return p;
  };
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(filters.from) && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) && filters.from <= filters.to;
  const list = useInfiniteQuery({
    queryKey: ["track-sessions", farmId, equipmentId, filters],
    enabled: valid,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<TrackSessionList>(farmPath(farmId, `/equipments/${equipmentId}/track-sessions?${query(pageParam)}`)),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const onTool = items.some((s) => s.tracker);

  // Parcelles proposées au filtre : celles des parcours affichés (et celle déjà choisie).
  const parcelOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of items) for (const p of s.parcels) m.set(p.landParcelId, p.name);
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [items]);

  const toggle = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Stack>
      <Group align="flex-end" gap="sm" wrap="wrap">
        <TextInput type="date" label="Du" value={filters.from} onChange={(e) => set({ from: e.currentTarget.value })} w={160} />
        <TextInput type="date" label="Au" value={filters.to} onChange={(e) => set({ to: e.currentTarget.value })} w={160} />
        <SegmentedControl
          aria-label="Type de parcours"
          value={filters.kind}
          onChange={(v) => set({ kind: v as Filters["kind"] })}
          data={[
            { value: "", label: "Tous" },
            { value: "work", label: "Travail" },
            { value: "transit", label: "Déplacements" },
          ]}
        />
        <Select
          label="Parcelle"
          placeholder="Toutes"
          clearable
          searchable
          data={filters.parcel && !parcelOptions.some((o) => o.value === filters.parcel) ? [...parcelOptions, { value: filters.parcel, label: "Parcelle choisie" }] : parcelOptions}
          value={filters.parcel}
          onChange={(v) => set({ parcel: v })}
          w={220}
        />
        <Select
          label="État"
          data={[
            { value: "", label: "Tous" },
            { value: "free", label: "Libres" },
            { value: "linked", label: "Rattachés" },
          ]}
          value={filters.state}
          onChange={(v) => set({ state: (v ?? "") as Filters["state"] })}
          allowDeselect={false}
          w={140}
        />
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, lg: selected.length ? 7 : 12 }}>
          {list.isLoading ? (
            <Loading />
          ) : list.error ? (
            <ErrorAlert error={list.error} />
          ) : items.length === 0 ? (
            <Text c="dimmed" size="sm">
              Aucun parcours sur cette période.
            </Text>
          ) : (
            <Stack gap="xs">
              <Table striped highlightOnHover aria-label="Parcours">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={32} />
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Horaires</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Parcelles</Table.Th>
                    <Table.Th ta="right">Surface</Table.Th>
                    <Table.Th ta="right">Distance</Table.Th>
                    <Table.Th>Outil</Table.Th>
                    {onTool && <Table.Th>Tracteur</Table.Th>}
                    <Table.Th>État</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((s) => (
                    <SessionRow key={s.id} s={s} farmId={farmId} onTool={onTool} checked={selected.includes(s.id)} onToggle={() => toggle(s.id)} />
                  ))}
                </Table.Tbody>
              </Table>
              {list.hasNextPage && (
                <Button variant="subtle" size="xs" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage} style={{ alignSelf: "center" }}>
                  Parcours plus anciens
                </Button>
              )}
              <Text size="xs" c="dimmed">
                Parcours calculés depuis les traces GPS (toutes les 5 minutes). Cochez des parcours pour les voir sur la carte.
              </Text>
            </Stack>
          )}
        </Grid.Col>
        {selected.length > 0 && (
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <SelectionMap farmId={farmId} ids={selected} viewer={equipmentId} />
          </Grid.Col>
        )}
      </Grid>
    </Stack>
  );
}

function SessionRow({ s, farmId, onTool, checked, onToggle }: { s: TrackSession; farmId: string; onTool: boolean; checked: boolean; onToggle: () => void }) {
  return (
    <Table.Tr aria-label={`Parcours du ${date(s.startedAt)} ${hhmm(s.startedAt)}`}>
      <Table.Td>
        <Checkbox aria-label="Sélectionner le parcours" checked={checked} onChange={onToggle} />
      </Table.Td>
      <Table.Td style={{ whiteSpace: "nowrap" }}>{date(s.startedAt)}</Table.Td>
      <Table.Td className="lv-num" style={{ whiteSpace: "nowrap" }}>
        {hhmm(s.startedAt)}–{hhmm(s.stoppedAt)}{" "}
        <Text span size="xs" c="dimmed">
          ({formatDuration(Math.round(s.durationS / 60))})
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge variant="light" color={s.kind === "work" ? "lichen" : "ardoise"}>
          {s.kind === "work" ? "Travail" : "Déplacement"}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          {s.parcels.map((p) => (
            <Badge key={p.landParcelId} variant="outline" color="gray" tt="none" fw={500}>
              {p.name} · {formatHa(p.areaM2)}
            </Badge>
          ))}
        </Group>
      </Table.Td>
      <Table.Td ta="right" className="lv-num">
        {s.coveredAreaM2 === null ? "—" : formatHa(s.coveredAreaM2)}
      </Table.Td>
      <Table.Td ta="right" className="lv-num">
        {km(s.distanceM)}
      </Table.Td>
      <Table.Td>{s.tool?.name ?? (s.toolHint ? <Text span c="dimmed" size="sm" title="Outil annoncé par le boîtier, non relié à un matériel">{s.toolHint}</Text> : "—")}</Table.Td>
      {onTool && <Table.Td>{s.tracker?.name ?? "—"}</Table.Td>}
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {s.intervention ? (
            <Link to={`/f/${farmId}/interventions/${s.intervention.id}`}>{procedureLabel(s.intervention.procedure)}</Link>
          ) : (
            <Text size="sm" c="dimmed">
              Libre
            </Text>
          )}
          {s.drift && (
            <Tooltip label={`Trace recalculée : ${hhmm(s.drift.startedAt)}–${hhmm(s.drift.stoppedAt)}`}>
              <Badge color="paille" variant="light">
                trace modifiée
              </Badge>
            </Tooltip>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

/** Trace, couverture et parcelles des parcours cochés (au plus 10). */
function SelectionMap({ farmId, ids, viewer }: { farmId: string; ids: string[]; viewer: string }) {
  const details = useQueries({
    queries: ids.slice(0, 10).map((id) => ({
      queryKey: ["track-session", farmId, id],
      queryFn: () => api.get<TrackSessionDetail>(farmPath(farmId, `/track-sessions/${id}?equipment=${viewer}`)),
      staleTime: 5 * 60_000,
    })),
  });
  const loaded = details.map((d) => d.data).filter((d): d is TrackSessionDetail => !!d);
  const at = loaded[0]?.startedAt ?? new Date().toISOString();
  const snap = useSnapshot(farmId, at);
  const parcelIds = new Set(loaded.flatMap((s) => s.parcels.map((p) => p.landParcelId)));
  const parcels: FeatureCollection = {
    type: "FeatureCollection",
    features: (snap.data?.landParcels ?? [])
      .filter((p) => parcelIds.has(p.id))
      .map((p) => ({ type: "Feature", geometry: p.version.shape as unknown as Geometry, properties: { id: p.id, name: p.name, color: "#E8B500" } })),
  };
  const zones: FeatureCollection = {
    type: "FeatureCollection",
    features: loaded.filter((s) => s.coverage).map((s) => ({ type: "Feature", geometry: s.coverage as Geometry, properties: {} })),
  };
  // Une trace par parcours : on ne relie jamais deux parcours entre eux.
  const track: FeatureCollection = {
    type: "FeatureCollection",
    features: loaded.flatMap((s) =>
      s.samples.slice(1).map((p, k) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: [[s.samples[k]![1], s.samples[k]![2]], [p[1], p[2]]] },
        properties: { working: s.samples[k]![3] === true },
      })),
    ),
  };
  const area = loaded.reduce((n, s) => n + (s.coveredAreaM2 ?? 0), 0);
  return (
    <Stack gap="xs">
      <Paper withBorder style={{ height: 360, overflow: "hidden" }} aria-label="Carte des parcours">
        <MapBoundary>
          <ParcelMap parcels={parcels} places={EMPTY} zones={zones} track={track} minHeight={0} basemap="ortho" />
        </MapBoundary>
      </Paper>
      <Text size="xs" c="dimmed" className="lv-num">
        {ids.length} parcours · {formatHa(area)} couverts{ids.length > 10 ? " (10 premiers sur la carte)" : ""}. Orange : travail ; pointillés : déplacement.
      </Text>
    </Stack>
  );
}
