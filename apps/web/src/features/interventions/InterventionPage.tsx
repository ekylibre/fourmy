import { useArea, useMapPrefs } from "../../app/prefs";
import { MaintenanceSummary } from "../maintenance/MaintenanceFields";
import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Badge, Box, Button, Collapse, Grid, Group, Paper, Progress, Stack, Table, Text, Timeline, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Box as Box3d, CalendarClock, ChevronDown, Pencil, Timer, User, Users } from "lucide-react";
import { formatDuration } from "./periods";
import { CrewsSummary } from "./Crews";
import { crewLabel } from "./week";
import type { FeatureCollection, Geometry } from "geojson";
import type { ComplianceResult, Intervention, InterventionDetail, InterventionWaterMap, Snapshot, TrackReplay, TrackSession } from "@fourmy/contracts";
import { getProcedure, TREATMENT_PURPOSE_LABELS } from "@fourmy/contracts";
import { displayStatus, storedUnit, type Light } from "@fourmy/domain";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDateTime, formatDays, formatNumber, formatPeriod, procedureLabel, unitLabel } from "../../app/labels";
import { useActivities, useCertifications, useArticles, useIntervention, useParcelNames, usePeople, usePhytoArticles, useSnapshot } from "../../app/queries";
import { RegulatoryPictos } from "../phyto/Hazards";
import { activeDuring, CertificationBadges } from "../certifications/Certifications";
import { ActivityBadge, activityOfParcel } from "../activities/ActivityBadge";
import { ErrorAlert, Loading } from "../../components/states";
import { MapBoundary } from "../../components/MapBoundary";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { ParcelMap } from "../map/ParcelMap";
import { kgN, nitrogenNote, useFertilizers } from "../fertilization/fertilization";
import { NitrogenLine } from "../fertilization/NitrogenLine";
import { isAreaRate, SeedLine } from "../seeds/SeedLine";
import { MixtureLine } from "../seeds/MixtureDoses";
import { useSeeds } from "../seeds/queries";
import { CancelModal } from "./CancelModal";
import { LIGHTS, TrafficLight } from "../../components/TrafficLight";
import { actionLabel, changeLines, interventionDay, STATUS, targetName, type Names } from "./presenters";
import { ComplianceSection, IftSection } from "./RegulatorySections";
import { NitrateCheckSection } from "../fertilization/FertilizationChecks";
import { CertificationCheckSection } from "../certification/controls";
import { SprayingConditions, WeatherLine } from "../weather/Weather";
import { irrigationVolumeM3 } from "./IrrigationFields";
import { IRRIGATION_METHOD_LABELS, IRRIGATION_ORIGIN_LABELS, IRRIGATION_TRIGGER_LABELS, SOWING_TECHNIQUE_LABELS } from "@fourmy/contracts";

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };
const ORIGINS: Record<string, string> = {
  web: "Web",
  mobile: "Mobile",
  migration: "Reprise d'Ekylibre",
  plugin: "Extension",
  import: "Import de fichier",
  // Proposition d'un accès externe, acceptée par le responsable (lot AM8).
  api: "Proposée par l'API",
  mcp: "Proposée par un assistant IA",
};

/**
 * Fiche d'une intervention (exigence INT-UI-2) : ce qui a été fait, où, avec
 * quoi et par qui, à la date de l'intervention (parcelles et surfaces de
 * cette date, pas de la frise), la trace GPS des matériels pendant les
 * périodes, et l'historique des modifications.
 */
export function InterventionPage() {
  const { interventionId } = useParams();
  const farm = useFarm();
  const detail = useIntervention(farm.id, interventionId!);
  if (detail.isLoading) return <Loading />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  return <InterventionSheet intervention={detail.data!} />;
}

function InterventionSheet({ intervention: i }: { intervention: InterventionDetail }) {
  const mapPrefs = useMapPrefs();
  const area = useArea();
  const farm = useFarm();
  const location = useLocation();
  const day = interventionDay(i);
  const snap = useSnapshot(farm.id, day);
  const articles = useArticles(farm.id);
  const people = usePeople(farm.id);
  const parcelNames = useParcelNames(farm.id);
  const activities = useActivities(farm.id, Number(day.slice(0, 4)));
  const certifications = useCertifications(farm.id);
  // Pictogrammes réglementaires des intrants phyto : produit (mentions H, ré-entrée) et contrôle (ZNT, DAR).
  const phytoArticles = usePhytoArticles(farm.id);
  const liveCompliance = useQuery({
    queryKey: ["intervention-compliance", farm.id, i.id, i.updatedAt],
    enabled: i.inputs.length > 0 && !i.compliance,
    queryFn: () => api.get<ComplianceResult>(farmPath(farm.id, `/interventions/${i.id}/compliance`)),
  });
  const compliance = i.compliance ?? liveCompliance.data ?? null;
  const pictosOf = (articleId: string) => {
    const article = phytoArticles.data?.items.find((a) => a.id === articleId);
    const check = compliance?.checks.find((c) => c.articleId === articleId);
    const dar = /Délai avant récolte[^:]*: (\d+) j/.exec(check?.indicators.find((x) => x.code === "dar")?.message ?? "");
    return { article, zntM: check?.zntM ?? null, harvestDays: dar ? Number(dar[1]) : null };
  };
  const [cancelling, setCancelling] = useState(false);
  const status = displayStatus(i, new Date().toISOString());
  const list = `/f/${farm.id}/interventions${location.search}`;

  const names: Names = {
    parcel: parcelNames.data ?? new Map(),
    equipment: new Map(snap.data?.equipments.map((e) => [e.id, e.name])),
    article: new Map(articles.data?.items.map((a) => [a.id, { name: a.name, unit: a.unit, amm: a.amm }])),
    person: new Map(people.data?.items.map((p) => [p.id, p.name])),
  };
  const doerNames = i.doers.map((d) => names.person.get(d.personId) ?? "?");

  // Surfaces à la date de l'intervention : saisie (partielle), sinon parcelle.
  const parcelAt = new Map(snap.data?.landParcels.map((p) => [p.id, p]));
  const parcelTargets = i.targets.filter((t) => t.kind === "land_parcel");
  const areaOf = (t: (typeof i.targets)[number]) => t.workedAreaM2 ?? parcelAt.get(t.id)?.version.areaM2 ?? null;
  const treatedM2 = parcelTargets.reduce((sum, t) => sum + (areaOf(t) ?? 0), 0);
  const treatedHa = treatedM2 / 10_000;
  // Azote apporté par les fertilisants (lot AE).
  const fertilizers = useFertilizers(farm.id, i.inputs.length > 0);
  const nitrogenOfInput = (q: (typeof i.inputs)[number]) =>
    nitrogenNote(fertilizers.data?.get(q.articleId), { quantity: q.quantity, per: q.per, unit: q.unit }, treatedHa || null, (i.startedAt ?? new Date().toISOString()).slice(0, 10));
  // Semences (lot SE5) : densité et dose du semis, quelle que soit l'unité saisie.
  const isSeed = (id: string) => articles.data?.items.find((a) => a.id === id)?.kind === "seed";
  const seeds = useSeeds(farm.id, i.stoppedAt ?? i.startedAt ?? new Date().toISOString(), i.inputs.some((q) => isSeed(q.articleId)));
  const nitrogenTotal = i.inputs.reduce((sum, q) => {
    const n = nitrogenOfInput(q);
    return n?.ok ? sum + n.totalKgHa : sum;
  }, 0);

  // Trace GPS des matériels pendant l'intervention : fenêtre de ses périodes ;
  // en attelages, chaque matériel sur les périodes de son attelage (FR-ATT-7).
  const trackWindows =
    i.status === "planned"
      ? []
      : i.staffing === "crews" && i.crews.length
        ? i.crews.flatMap((c) => c.tools.flatMap((t) => c.periods.map((p) => ({ equipmentId: t.equipmentId, from: p.startedAt, to: p.stoppedAt }))))
        : i.startedAt && i.stoppedAt
          ? i.tools.map((t) => ({ equipmentId: t.equipmentId, from: i.startedAt!, to: i.stoppedAt! }))
          : [];
  const tracks = useQueries({
    queries: trackWindows.map((w) => ({
      queryKey: ["track", farm.id, w.equipmentId, w.from, w.to],
      queryFn: () => api.get<TrackReplay>(farmPath(farm.id, `/tracks?equipment=${w.equipmentId}&from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`)),
      staleTime: 5 * 60_000,
    })),
  });
  // Une trace par fenêtre : on ne relie jamais deux matériels ou deux périodes.
  const trackRuns = tracks.map((q) => q.data?.samples ?? []).filter((r) => r.length > 1);
  const trackSamples = trackRuns.flat();

  const layers = useMemo(() => mapLayers(i, snap.data), [i, snap.data]);
  // Traitement : cours d'eau proches et bande de ZNT sur la carte.
  const treatment = (i.compliance?.checks.length ?? 0) > 0 || i.inputs.some((q) => names.article.get(q.articleId)?.amm);
  const water = useQuery({
    queryKey: ["intervention-water", farm.id, i.id, i.updatedAt],
    queryFn: () => api.get<InterventionWaterMap>(farmPath(farm.id, `/interventions/${i.id}/water`)),
    enabled: treatment,
    staleTime: 10 * 60_000,
  });
  const waterLayer = (water.data?.water as FeatureCollection | undefined) ?? EMPTY_FC;
  const bufferLayer = useMemo<FeatureCollection>(
    () =>
      water.data?.buffer
        ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: water.data.buffer as Geometry, properties: {} }] }
        : EMPTY_FC,
    [water.data],
  );
  const trackLayer = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: trackRuns.flatMap((run) =>
        run.slice(1).map((s, k) => ({
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: [[run[k]![1], run[k]![2]], [s[1], s[2]]] },
          properties: { working: run[k]![3] === true },
        })),
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackSamples.length],
  );

  const isSpraying = getProcedure(i.procedure).shape === "treatment";
  const narrow = useMediaQuery("(max-width: 62em)");
  // Parcours GPS rattachés : sous-partie des moyens, et matériel du rejeu 3D (le premier, Q4).
  const sessions = useQuery({
    queryKey: ["intervention-track-sessions", farm.id, i.id],
    queryFn: () => api.get<{ items: TrackSession[] }>(farmPath(farm.id, `/interventions/${i.id}/track-sessions`)),
    enabled: i.status !== "planned",
  });
  const firstSession = [...(sessions.data?.items ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  const replay3d = firstSession
    ? `/f/${farm.id}/3d-plan?${new URLSearchParams({ at: day.slice(0, 10), equipment: firstSession.equipmentId, t: i.startedAt ?? firstSession.startedAt, replay: "1" })}`
    : null;

  const map = layers && (
    <Stack gap={6}>
      <Paper withBorder style={{ height: 360, overflow: "hidden" }}>
        <MapBoundary>
          <ParcelMap parcels={layers.parcels} places={EMPTY_FC} zones={layers.zones} water={waterLayer} buffer={bufferLayer} track={trackLayer} minHeight={0} basemap={mapPrefs.basemap} />
        </MapBoundary>
      </Paper>
      {treatment && water.data && (
        <Text size="xs" c="dimmed">
          En bleu, les cours d'eau et plans d'eau (fossés en pointillés) ;
          {water.data.zntM ? ` en rouge, la ZNT de ${water.data.zntM} m autour de la zone traitée.` : " aucune ZNT fixée par les usages."}
        </Text>
      )}
      {trackSamples.length > 0 && (
        <Text size="xs" c="dimmed">
          Trace GPS des matériels pendant l'intervention (orange : travail, pointillés : transport).
        </Text>
      )}
    </Stack>
  );

  // 1. Météo en une ligne ; pour une pulvérisation, la frise horaire du jour (heures de l'intervention soulignées).
  const sprayWindow = isSpraying && i.startedAt && i.stoppedAt ? { from: i.startedAt, to: i.stoppedAt } : null;
  const weatherPanel = (i.weather || sprayWindow) && (
    <Paper p="md" withBorder aria-label="Météo de l'intervention">
      <Title order={4} mb="xs">
        Météo
      </Title>
      <Stack gap="md">
        {i.weather ? (
          <WeatherLine weather={i.weather} />
        ) : (
          <Text size="sm" c="dimmed">
            Pas de données météo enregistrées pour cette intervention.
          </Text>
        )}
        {sprayWindow && <SprayingConditions farmId={farm.id} from={`${day.slice(0, 10)}T00:00:00`} days={1} highlight={sprayWindow} bare />}
      </Stack>
    </Paper>
  );

  // 2. Parcelles : hectares travaillés, surface et part de chaque parcelle, puis le total.
  const parcelRows = i.targets.map((t) => {
    const parcelM2 = t.kind === "land_parcel" ? (parcelAt.get(t.id)?.version.areaM2 ?? null) : null;
    const workedM2 = t.kind === "land_parcel" ? (t.workedAreaM2 ?? parcelM2) : null;
    return { t, parcelM2, workedM2, whole: t.kind === "land_parcel" && !t.workedAreaM2 };
  });
  const totalParcelM2 = parcelRows.reduce((n, r) => n + (r.parcelM2 ?? 0), 0);
  const parcelsPanel = (
    <Paper p="md" withBorder aria-label="Parcelles">
      <Group justify="space-between" align="baseline" mb="xs">
        <Title order={4}>{parcelTargets.length ? "Parcelles" : "Cibles"}</Title>
        {parcelTargets.length > 0 && (
          <Text size="sm" className="lv-num">
            <b>{area(treatedM2)}</b> travaillés{totalParcelM2 > 0 ? ` sur ${area(totalParcelM2)}` : ""}
          </Text>
        )}
      </Group>
      <Table aria-label="Cibles" verticalSpacing={6}>
        {parcelTargets.length > 0 && (
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Parcelle</Table.Th>
              <Table.Th />
              <Table.Th ta="right">Travaillé</Table.Th>
              <Table.Th ta="right">Surface</Table.Th>
              <Table.Th ta="right" w={120}>
                Part
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
        )}
        <Table.Tbody>
          {parcelRows.map(({ t, parcelM2, workedM2, whole }) => {
            const activity = t.kind === "land_parcel" ? activityOfParcel(t.id, snap.data?.productions ?? [], activities.data?.items) : null;
            const share = workedM2 !== null && parcelM2 ? Math.min(1, workedM2 / parcelM2) : null;
            return (
              <Table.Tr key={t.id}>
                <Table.Td>{targetName(names, t)}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {activity && <ActivityBadge activity={activity} />}
                    <CertificationBadges certs={(certifications.data?.items ?? []).filter((c) => c.landParcelId === t.id && activeDuring(c, day.slice(0, 10), day.slice(0, 10)))} />
                  </Group>
                </Table.Td>
                <Table.Td ta="right" className="lv-num" fw={600}>
                  {workedM2 === null ? "" : area(workedM2)}
                </Table.Td>
                <Table.Td ta="right" className="lv-num" c="dimmed">
                  {parcelM2 === null ? "" : area(parcelM2)}
                </Table.Td>
                <Table.Td>
                  {share !== null && (
                    <Stack gap={2} aria-label={`Part travaillée : ${Math.round(share * 100)} %`}>
                      <Text size="sm" ta="right" className="lv-num">
                        {whole ? "entière" : `${Math.round(share * 100)} %`}
                      </Text>
                      <Progress value={share * 100} size={4} color="lichen" aria-hidden />
                    </Stack>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
        {parcelTargets.length > 1 && (
          <Table.Tfoot>
            <Table.Tr>
              <Table.Th>Total</Table.Th>
              <Table.Th />
              <Table.Th ta="right" className="lv-num">
                {area(treatedM2)}
              </Table.Th>
              <Table.Th ta="right" className="lv-num">
                {totalParcelM2 ? area(totalParcelM2) : ""}
              </Table.Th>
              <Table.Th ta="right" className="lv-num">
                {totalParcelM2 ? `${Math.round((treatedM2 / totalParcelM2) * 100)} %` : ""}
              </Table.Th>
            </Table.Tr>
          </Table.Tfoot>
        )}
      </Table>
      {parcelRows.some((r) => r.whole) && (
        <Text size="xs" c="dimmed" mt={4}>
          « entière » : pas de zone travaillée enregistrée, la parcelle compte en entier.
        </Text>
      )}
    </Paper>
  );

  // 3. Moyens : attelages (ou périodes), matériels, intervenants, puis les parcours GPS rattachés.
  const meansPanel = (
    <Paper p="md" withBorder aria-label="Moyens">
      <Title order={4} mb="xs">
        {i.staffing === "crews" && i.crews.length ? "Moyens et attelages" : "Moyens"}
      </Title>
      <Stack gap="sm">
        {i.staffing === "crews" && i.crews.length ? (
          <CrewsView i={i} names={names} />
        ) : i.periodPrecision === "day" && i.periods.length ? (
          // Importée d'un autre logiciel : seule la date est connue, pas les heures.
          <Group gap={6} aria-label="Période de travail">
            <CalendarClock size={16} aria-hidden color="var(--mantine-color-dimmed)" />
            <Text className="lv-num" size="sm">
              {i.status === "planned" ? "Prévue " : "Réalisée "}
              {formatDays(i.periods[0]!.startedAt, i.periods.at(-1)!.stoppedAt)}
            </Text>
            <Text size="xs" c="dimmed">
              (heures non connues)
            </Text>
          </Group>
        ) : i.periods.length ? (
          <Stack gap={6}>
            {i.periods.map((p) => {
              const minutes = Math.round((new Date(p.stoppedAt).getTime() - new Date(p.startedAt).getTime()) / 60_000);
              return (
                <Group key={p.startedAt} gap="lg" wrap="wrap" aria-label="Période de travail">
                  <Group gap={6} wrap="nowrap">
                    <CalendarClock size={16} aria-hidden color="var(--mantine-color-dimmed)" />
                    <Text className="lv-num" size="sm">
                      {formatPeriod(p.startedAt, p.stoppedAt)}
                    </Text>
                  </Group>
                  <Group gap={6} wrap="nowrap">
                    <Timer size={16} aria-hidden color="var(--mantine-color-dimmed)" />
                    <Text className="lv-num" size="sm" fw={600}>
                      {formatDuration(minutes)}
                    </Text>
                  </Group>
                </Group>
              );
            })}
            {i.periods.length > 1 && (
              <Text size="xs" c="dimmed" className="lv-num">
                Total : {formatDuration(i.periods.reduce((n, p) => n + Math.round((new Date(p.stoppedAt).getTime() - new Date(p.startedAt).getTime()) / 60_000), 0))}
              </Text>
            )}
          </Stack>
        ) : (
          <Group gap={6}>
            <CalendarClock size={16} aria-hidden color="var(--mantine-color-dimmed)" />
            <Text size="sm">{i.status === "planned" ? `Prévue le ${formatDateTime(i.startedAt)}` : formatDateTime(i.startedAt)}</Text>
          </Group>
        )}
        <Stack gap={4}>
          {!(i.staffing === "crews" && i.crews.length) && (
            <>
              <Text size="sm">
                <strong>Matériels :</strong> {i.tools.map((t) => names.equipment.get(t.equipmentId) ?? "?").join(", ") || "—"}
              </Text>
              <Group gap={6} wrap="nowrap">
                {doerNames.length > 1 ? <Users size={16} aria-hidden color="var(--mantine-color-dimmed)" /> : <User size={16} aria-hidden color="var(--mantine-color-dimmed)" />}
                <Text size="sm">
                  <strong>Intervenants :</strong> {doerNames.join(", ") || "—"}
                </Text>
              </Group>
            </>
          )}
          {i.purposes.length > 0 && (
            <Text size="sm">
              <strong>Motifs :</strong> {i.purposes.map((p) => TREATMENT_PURPOSE_LABELS[p]).join(", ")}
            </Text>
          )}
          {i.bbch && (
            <Text size="sm">
              <strong>Stade :</strong> {i.bbch.label}
            </Text>
          )}
          {i.notes && (
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              <strong>Notes :</strong> {i.notes}
            </Text>
          )}
        </Stack>
        <LinkedTrackSessions farmId={farm.id} items={sessions.data?.items ?? []} names={names.equipment} />
      </Stack>
    </Paper>
  );

  // 4. Intrants et sorties ; pour une pulvérisation, un feu de dose par produit phyto.
  const doseLight = (articleId: string): { level: Light; label: string; detail: string } | null => {
    if (!isSpraying || !names.article.get(articleId)?.amm) return null;
    const check = compliance?.checks.find((c) => c.articleId === articleId);
    if (!check) return { level: "unknown", label: "Non contrôlé", detail: "Pas de contrôle réglementaire pour ce produit." };
    const dose = check.indicators.find((x) => x.code === "dose");
    if (!check.usageId && check.usages.length > 1) return { level: "warning", label: "Cible à préciser", detail: `Sans cible, la dose ne se contrôle que face à l'usage le plus permissif. ${dose?.message ?? ""}`.trim() };
    if (!dose) return { level: "unknown", label: "Dose non contrôlée", detail: "Aucune dose de référence pour cet usage." };
    return { level: dose.level, label: dose.level === "ok" ? "Dose conforme" : LIGHTS[dose.level].label, detail: dose.message };
  };
  const inputsPanel = (i.inputs.length > 0 || i.outputs.length > 0) && (
    <Paper p="md" withBorder aria-label="Intrants et sorties">
      <Title order={4} mb="xs">
        Intrants et sorties
      </Title>
      <Table aria-label="Intrants et sorties">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Produit</Table.Th>
            <Table.Th ta="right">Par hectare</Table.Th>
            <Table.Th ta="right">Total</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[...i.inputs.map((q) => ({ ...q, role: "Intrant" })), ...i.outputs.map((q) => ({ ...q, role: "Sortie" }))].map((q, k) => {
            const a = names.article.get(q.articleId);
            const unit = unitLabel(q.unit);
            // Grains/m² : dose déjà rapportée à la surface (×10 000 par hectare).
            const rate = isAreaRate(q.unit);
            const perHa = rate || q.per === "hectare" ? q.quantity : treatedHa ? q.quantity / treatedHa : null;
            const total = rate ? (treatedHa ? q.quantity * 10_000 * treatedHa : null) : q.per === "total" ? q.quantity : treatedHa ? q.quantity * treatedHa : null;
            const light = q.role === "Intrant" ? doseLight(q.articleId) : null;
            return (
              <Table.Tr key={k}>
                <Table.Td>
                  <Group gap="xs" wrap="wrap" align="center">
                    <Text size="sm" fw={500}>
                      {a?.name ?? "?"}
                    </Text>
                    <Text span size="xs" c="dimmed">
                      {q.role}
                    </Text>
                    {light && <TrafficLight level={light.level} variant="led" label={light.label} detail={light.detail} size="xs" />}
                  </Group>
                  {light && light.level === "warning" && light.label === "Cible à préciser" && i.status !== "cancelled" && (
                    <Button component={Link} to={`edit${location.search}`} variant="subtle" size="compact-xs" px={0}>
                      Préciser la cible
                    </Button>
                  )}
                  {q.role === "Intrant" && (
                    <Box mt={4}>
                      <RegulatoryPictos {...pictosOf(q.articleId)} size={24} />
                    </Box>
                  )}
                  {q.role === "Intrant" && <NitrogenLine note={nitrogenOfInput(q)} farmId={farm.id} />}
                  {q.role === "Intrant" && isSeed(q.articleId) && (
                    <SeedLine
                      quantity={q.quantity}
                      unit={rate ? q.unit : storedUnit(q.unit, q.per)}
                      seed={seeds.data?.items.find((x) => x.articleId === q.articleId)}
                      areaHa={treatedHa || null}
                      farmId={farm.id}
                    />
                  )}
                  {"mixture" in q && q.mixture && <MixtureLine doses={q.mixture} />}
                </Table.Td>
                <Table.Td ta="right" className="lv-num" fw={rate || q.per === "hectare" ? 600 : undefined}>
                  {perHa === null ? "—" : rate ? `${formatNumber(perHa, 3)} ${unit}` : `${formatNumber(perHa, 3)} ${unit}/ha`}
                </Table.Td>
                <Table.Td ta="right" className="lv-num" fw={!rate && q.per === "total" ? 600 : undefined}>
                  {total === null ? "—" : rate ? `${formatNumber(total, 0)} grains` : `${formatNumber(total, 3)} ${unit}`}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      {nitrogenTotal > 0 && (
        <Text size="sm" mt="xs" className="lv-num" aria-label="Azote apporté">
          Azote apporté : <b>{kgN(Math.round(nitrogenTotal * 10) / 10)}</b>
        </Text>
      )}
      <Text size="xs" c="dimmed" mt={4}>
        En gras, la valeur saisie ; l'autre est calculée sur la surface traitée.
      </Text>
    </Paper>
  );

  const sowingPanel = i.sowing && (
    <Paper p="md" withBorder aria-label="Semis">
      <Title order={4} mb="xs">
        Semis
      </Title>
      <Text>{SOWING_TECHNIQUE_LABELS[i.sowing.technique]}</Text>
    </Paper>
  );

  const irrigationPanel = i.irrigation && (
    <Paper p="md" withBorder aria-label="Irrigation">
      <Title order={4} mb="xs">
        Irrigation
      </Title>
      <Text className="lv-num">
        <Text span fw={600}>
          {formatNumber(i.irrigation.depthMm, 1)} mm
        </Text>
        {treatedM2 > 0 && ` soit ${Math.round(irrigationVolumeM3(i.irrigation.depthMm, treatedM2)).toLocaleString("fr-FR")} m³ sur ${area(treatedM2)}`}
        {i.irrigation.method && ` · ${IRRIGATION_METHOD_LABELS[i.irrigation.method]}`}
        {i.irrigation.mobile && " (mobile)"}
        {i.irrigation.origin && ` · eau : ${IRRIGATION_ORIGIN_LABELS[i.irrigation.origin].toLowerCase()}`}
        {i.irrigation.trigger && ` · déclenché par : ${IRRIGATION_TRIGGER_LABELS[i.irrigation.trigger].toLowerCase()}`}
      </Text>
    </Paper>
  );

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Button component={Link} to={list} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
            Interventions
          </Button>
          <Group gap="sm">
            <ProcedureIcon procedure={i.procedure} size={32} />
            <Title order={1}>{procedureLabel(i.procedure)}</Title>
          </Group>
          <Group gap={6}>
            <Badge color={STATUS[status].color}>{STATUS[status].label}</Badge>
            <Badge variant="outline" color="gray">
              {ORIGINS[i.origin] ?? i.origin}
            </Badge>
          </Group>
        </Stack>
        <Group gap="xs">
          {replay3d && (
            <Button component={Link} to={replay3d} variant="default" leftSection={<Box3d size={16} />} aria-label="Revoir l'intervention en 3D">
              Revoir en 3D
            </Button>
          )}
          {i.status !== "cancelled" && (
            <>
              {i.status === "planned" && (
                <Button variant="light" component={Link} to={`complete${location.search}`}>
                  Réaliser
                </Button>
              )}
              <Button component={Link} to={`edit${location.search}`} leftSection={<Pencil size={16} />}>
                Modifier
              </Button>
              <Button variant="subtle" color="brique" onClick={() => setCancelling(true)}>
                Annuler l'intervention
              </Button>
            </>
          )}
        </Group>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack>
            {weatherPanel}
            {parcelsPanel}
            {narrow && map}
            {meansPanel}
            {inputsPanel}
            <MaintenanceSummary farmId={farm.id} intervention={i} names={names.equipment} />
            {irrigationPanel}
            {sowingPanel}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack>
            {!narrow && map}
            <ComplianceSection farmId={farm.id} intervention={i} />
            <NitrateCheckSection check={i.nitrateCheck} />
            <CertificationCheckSection check={i.certificationCheck} stored />
            <IftSection farmId={farm.id} intervention={i} names={names} />
            <HistoryPanel intervention={i} names={names} />
          </Stack>
        </Grid.Col>
      </Grid>

      <CancelModal farmId={farm.id} intervention={cancelling ? i : null} onClose={() => setCancelling(false)} />
    </Stack>
  );
}

/** Historique replié par défaut : il sert rarement et occupait tout l'écran ; 10 entrées, puis « Afficher tout ». */
function HistoryPanel({ intervention: i, names }: { intervention: InterventionDetail; names: Names }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const n = i.history.length;
  const shown = all ? i : { ...i, history: i.history.slice(-10) };
  return (
    <Paper p="md" withBorder aria-label="Historique">
      <UnstyledButton onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="intervention-history" w="100%">
        <Group justify="space-between" wrap="nowrap">
          <Title order={4}>Historique</Title>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" c="dimmed" className="lv-num">
              {n === 0 ? "aucune modification" : `${n} modification${n > 1 ? "s" : ""}`}
            </Text>
            <ChevronDown size={18} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }} />
          </Group>
        </Group>
      </UnstyledButton>
      <Collapse expanded={open} id="intervention-history">
        {open && (
          <Stack gap="xs" mt="sm">
            <History intervention={shown} names={names} />
            {!all && n > 10 && (
              <Button variant="subtle" size="compact-sm" onClick={() => setAll(true)} w="fit-content">
                Afficher les {n} modifications
              </Button>
            )}
          </Stack>
        )}
      </Collapse>
    </Paper>
  );
}

/** Historique tiré du journal : qui, quand, quoi (avant → après), motif. */
function History({ intervention: i, names }: { intervention: InterventionDetail; names: Names }) {
  if (i.history.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {i.origin === "migration"
          ? "Importée d'Ekylibre ; aucune modification depuis dans Fourmy."
          : i.origin === "import"
            ? "Importée d'un fichier (Geofolia, DAPLOS) ; aucune modification depuis dans Fourmy."
            : "Aucun historique."}
      </Text>
    );
  }
  return (
    <Timeline bulletSize={14} lineWidth={2} active={i.history.length - 1}>
      {i.history.map((h) => (
        <Timeline.Item key={h.id} title={actionLabel(h.action)}>
          <Text size="xs" c="dimmed">
            {formatDateTime(h.at)}
            {h.actorName ? ` · ${h.actorName}` : ""}
            {h.origin === "mobile" ? " · mobile" : ""}
          </Text>
          {h.reason && (
            <Text size="sm" fs="italic">
              « {h.reason} »
            </Text>
          )}
          {changeLines(names, h).map((c) => (
            <Text key={c.field} size="sm">
              <strong>{c.field} :</strong> {c.before} → {c.after}
            </Text>
          ))}
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

/** Parcelles ciblées (à la date de l'intervention) et zones travaillées, pour la mini-carte. */
function mapLayers(i: InterventionDetail, snap: Snapshot | undefined) {
  if (!snap) return null;
  const targeted = new Set(i.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id));
  const parcels: FeatureCollection = {
    type: "FeatureCollection",
    features: snap.landParcels
      .filter((p) => targeted.has(p.id))
      .map((p) => ({ type: "Feature", geometry: p.version.shape as unknown as Geometry, properties: { id: p.id, name: p.name, color: "#E8B500" } })),
  };
  const zones: FeatureCollection = {
    type: "FeatureCollection",
    features: i.targets
      .filter((t) => t.workingZone)
      .map((t) => ({ type: "Feature", geometry: t.workingZone as unknown as Geometry, properties: {} })),
  };
  return parcels.features.length ? { parcels, zones } : null;
}

/** Attelages d'une intervention : moyens, périodes et durées de chacun, puis la synthèse du chantier (FR-ATT-5). */
function CrewsView({ i, names }: { i: Intervention; names: { equipment: Map<string, string>; person: Map<string, string> } }) {
  const minutes = (p: { startedAt: string; stoppedAt: string }) => Math.round((new Date(p.stoppedAt).getTime() - new Date(p.startedAt).getTime()) / 60_000);
  return (
    <Stack gap="sm">
      {i.crews.map((c) => (
        <Paper key={c.id} withBorder p="xs" role="group" aria-label={crewLabel(c)}>
          <Text size="sm" fw={600}>
            {crewLabel(c)}
          </Text>
          <Text size="sm">
            {c.tools.map((t) => names.equipment.get(t.equipmentId) ?? "?").join(" + ")}
            {" — "}
            {c.doers.length ? c.doers.map((d) => names.person.get(d.personId) ?? "?").join(", ") : <Text span c="dimmed" size="sm">conducteur inconnu</Text>}
          </Text>
          {c.periods.map((p) => (
            <Group key={p.startedAt} gap="lg" aria-label="Période de travail">
              <Group gap={6} wrap="nowrap">
                <CalendarClock size={16} aria-hidden color="var(--mantine-color-dimmed)" />
                <Text className="lv-num" size="sm">
                  {formatPeriod(p.startedAt, p.stoppedAt)}
                </Text>
              </Group>
              <Group gap={6} wrap="nowrap">
                <Timer size={16} aria-hidden color="var(--mantine-color-dimmed)" />
                <Text className="lv-num" size="sm" fw={600}>
                  {formatDuration(minutes(p))}
                </Text>
              </Group>
            </Group>
          ))}
        </Paper>
      ))}
      <CrewsSummary crews={i.crews} />
    </Stack>
  );
}

/** Parcours GPS rattachés (FR-GPS-23), sous-partie des moyens, avec la trace recalculée si elle a changé depuis (FR-GPS-15). */
function LinkedTrackSessions({ farmId, items, names }: { farmId: string; items: TrackSession[]; names: Map<string, string> }) {
  const area = useArea();
  if (items.length === 0) return null;
  const hm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return (
    <Box aria-label="Parcours GPS rattachés" role="group">
      <Title order={5} fz="sm" mb={4}>
        Parcours GPS rattachés ({items.length})
      </Title>
      <Stack gap={6} role="list">
        {items.map((s) => (
          <Box key={s.id} role="listitem">
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Link to={`/f/${farmId}/equipments/${s.equipmentId}?tab=tracks`} style={{ whiteSpace: "nowrap" }}>
                  {names.get(s.equipmentId) ?? "Matériel"}
                </Link>
                <Text size="sm" className="lv-num" style={{ whiteSpace: "nowrap" }}>
                  {new Date(s.startedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} {hm(s.startedAt)}–{hm(s.stoppedAt)}
                </Text>
                <Badge variant="light" color={s.kind === "work" ? "lichen" : "ardoise"} style={{ flexShrink: 0 }}>
                  {s.kind === "work" ? "Travail" : "Déplacement"}
                </Badge>
                {s.drift && (
                  <Tooltip label={`Trace recalculée : ${hm(s.drift.startedAt)}–${hm(s.drift.stoppedAt)}`}>
                    <Badge color="paille" variant="light" style={{ flexShrink: 0 }}>
                      trace modifiée
                    </Badge>
                  </Tooltip>
                )}
              </Group>
              <Text size="sm" fw={600} className="lv-num" style={{ whiteSpace: "nowrap" }}>
                {s.coveredAreaM2 === null ? "—" : area(s.coveredAreaM2)}
              </Text>
            </Group>
            {s.parcels.length > 0 && (
              <Text size="xs" c="dimmed">
                {s.parcels.map((p) => p.name).join(", ")}
              </Text>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
