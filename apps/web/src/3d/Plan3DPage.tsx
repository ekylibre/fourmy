import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Grid, Group, Paper, SegmentedControl, Select, Stack, Switch, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import type { AvatarInfo, Hitch, LatestPosition, TrackReplay } from "@fourmy/contracts";
import { assetUrl } from "../features/equipments/EquipmentLogo";
import type { Pt } from "@fourmy/domain";
import { formatLiters } from "@fourmy/ui-lyvre";
import { api, ApiError, farmPath } from "../app/api";
import { useAt } from "../app/at";
import { useFarm } from "../app/farm";
import { formatDate } from "../app/labels";
import { useSnapshot } from "../app/queries";
import { ErrorAlert, Loading } from "../components/states";
import { ErrorPanel } from "../components/RouteError";
import { TankContents } from "../features/cellar/CellarPage";
import { FarmScene, TERRAIN_TILE_BYTES, type PlanData } from "./FarmScene";
import { placementFromClick } from "./geometry";

type Plan = PlanData & { at: string; unplaced: { id: string; name: string; reason: string }[] };

/**
 * Plan 3D de la ferme (US-4, US-9) à la date de la frise : relief IGN,
 * bâtiments, cuverie remplie selon l'historique, rejeu de la trace du jour.
 */
export function Plan3DPage() {
  const farm = useFarm();
  const { at, day } = useAt();
  const queryClient = useQueryClient();
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<FarmScene | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("60");
  const [clock, setClock] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<unknown>(null);
  const [following, setFollowing] = useState(true);
  const handlers = useRef({ ground: (_p: Pt) => {} });

  const plan = useQuery({
    queryKey: ["plan3d", farm.id, at],
    queryFn: () => api.get<Plan>(farmPath(farm.id, `/plan3d?at=${encodeURIComponent(at)}&context=1`)),
    placeholderData: (prev) => prev,
  });
  const snap = useSnapshot(farm.id, at);
  const modelUrl = (id: string, hash: string) => `${location.origin}/api/v1${farmPath(farm.id, `/equipments/${id}/avatar.glb?v=${hash}`)}`;
  // Tous les matériels suivis, à leur dernière position connue à la date (FR-MAT-86).
  const [fleetOn, setFleetOn] = useState(false);
  const fleet = useQuery({
    queryKey: ["tracks-latest", farm.id, at],
    queryFn: () => api.get<{ items: LatestPosition[] }>(farmPath(farm.id, `/tracks/latest?at=${encodeURIComponent(at)}`)),
    enabled: fleetOn,
  });
  useEffect(() => {
    scene.current?.setFleet(
      fleetOn ? (fleet.data?.items ?? []).map((f) => ({ id: f.equipmentId, name: f.name, lon: f.lon, lat: f.lat, heading: f.heading, modelUrl: modelUrl(f.equipmentId, f.avatarHash) })) : [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetOn, fleet.data]);

  // Scène Cesium : créée une fois, détruite au départ de la page.
  useEffect(() => {
    if (!container.current) return;
    let lastTick = 0;
    const s = new FarmScene(container.current, {
      onRenderError: (e) => setRenderError(e ?? new Error("Erreur de rendu")),
      loadTerrainTile: async (level, x, y) => {
        const res = await fetch(`${location.origin}/api/v1${farmPath(farm.id, `/terrain/heightmap/${level}/${x}/${y}`)}`, {
          credentials: "same-origin",
        });
        // Une erreur (400, 401, 429…) lue comme une grille donnerait des altitudes
        // absurdes et Cesium s'arrêterait (« normalized result is not a number ») :
        // la tuile est déclarée en échec, Cesium affiche alors sa tuile parente.
        const buffer = await res.arrayBuffer();
        if (!res.ok || buffer.byteLength !== TERRAIN_TILE_BYTES) {
          throw new Error(`relief ${level}/${x}/${y} : HTTP ${res.status}, ${buffer.byteLength} octets`);
        }
        return { heights: new Float32Array(buffer), source: res.headers.get("x-terrain-source") ?? "ign" };
      },
      onTankClick: (id) => setSelected(id),
      onGroundClick: (p) => handlers.current.ground(p),
      onTerrainFallback: () => setFallback(true),
      onClockTick: (iso) => {
        const now = Date.now();
        if (now - lastTick > 400) {
          lastTick = now;
          setClock(iso);
        }
      },
    });
    scene.current = s;
    return () => {
      s.destroy();
      scene.current = null;
    };
  }, [farm.id]);

  useEffect(() => {
    if (plan.data) scene.current?.setPlan(plan.data);
  }, [plan.data]);
  useEffect(() => scene.current?.selectTank(selected), [selected]);

  // Placement manuel : cuve choisie, puis clic dans son bâtiment.
  const place = useMutation({
    mutationFn: (v: { id: string; x: number; y: number; radius: number; height: number }) =>
      api.patch(farmPath(farm.id, `/containers/${v.id}/placement`), { shape3d: { x: v.x, y: v.y, z: 0, radius: v.radius, height: v.height } }),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Cuve placée." });
      void queryClient.invalidateQueries({ queryKey: ["plan3d"] });
    },
    onError: (e) => notifications.show({ color: "brique", title: "Placement refusé", message: e instanceof ApiError ? e.message : String(e) }),
  });
  handlers.current.ground = (p) => {
    if (!placing || !selected || !plan.data) return;
    const tank = plan.data.tanks.find((t) => t.id === selected);
    const building = plan.data.buildings.find((b) => b.id === tank?.placeId);
    if (!tank || !building) return;
    const r = placementFromClick(p, building.footprint, tank.radius);
    if ("error" in r) notifications.show({ color: "paille", message: r.error });
    else place.mutate({ id: tank.id, ...r, radius: tank.radius, height: tank.height });
  };

  const heights = useMutation({
    mutationFn: () => api.post<{ updated: { name: string; heightM: number }[]; unmatched: string[] }>(farmPath(farm.id, "/places/ign-heights"), {}),
    onSuccess: (r) => {
      notifications.show({
        color: "lichen",
        message: `${r.updated.length} hauteur(s) reprise(s) de la BD TOPO${r.unmatched.length ? ` ; sans correspondance : ${r.unmatched.join(", ")}` : ""}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["plan3d"] });
    },
  });

  const loadTrack = useMutation({
    mutationFn: async () => {
      const from = new Date(`${day}T00:00:00`).toISOString();
      const to = new Date(Date.parse(`${day}T00:00:00`) + 86_400_000).toISOString();
      return api.get<TrackReplay>(farmPath(farm.id, `/tracks?equipment=${equipment}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    },
    onSuccess: async (t) => {
      setPlaying(false);
      if (t.samples.length < 2) {
        notifications.show({ color: "paille", message: `Aucune position le ${formatDate(at)}.` });
        scene.current?.clearTrack();
        return;
      }
      const name = snap.data?.equipments.find((e) => e.id === equipment)?.name ?? "Matériel";
      // Avatar 3D (lot M) : modèle du matériel, son logo, outils attelés ce jour-là.
      const [avatar, hitched] = await Promise.all([
        api.get<AvatarInfo>(farmPath(farm.id, `/equipments/${equipment}/avatar`)).catch(() => null),
        api.get<{ items: Hitch[] }>(farmPath(farm.id, `/tracks/hitches?equipment=${equipment}&from=${encodeURIComponent(t.from)}&to=${encodeURIComponent(t.to)}`)).catch(() => null),
      ]);
      // Logo au-dessus du véhicule : la version PNG (un SVG sans dimensions n'est pas une texture valide).
      const logo = avatar?.logoAssetId;
      const offset = Number((avatar?.params as { hitchOffsetM?: number } | undefined)?.hitchOffsetM ?? 1);
      scene.current?.follow(following);
      await scene.current?.setTrack(t.samples, name, {
        modelUrl: avatar ? modelUrl(equipment!, avatar.hash) : undefined,
        logoUrl: logo ? assetUrl(farm.id, logo) : undefined,
        hitches: (hitched?.items ?? []).map((h) => ({ name: h.toolName, url: modelUrl(h.toolId, h.avatarHash), offsetM: offset, from: h.from, to: h.to })),
      });
    },
  });

  if (plan.error) return <ErrorAlert error={plan.error} />;
  const p = plan.data;
  const estimated = p?.buildings.filter((b) => b.heightSource === "estimated").length ?? 0;
  const tank = p?.tanks.find((t) => t.id === selected);

  return (
    <Stack>
      <Title order={1}>Plan 3D au {formatDate(at)}</Title>
      {fallback && (
        <Alert color="paille" title="Relief de repli">
          Le relief IGN est momentanément indisponible : certaines zones s'affichent à plat.
        </Alert>
      )}
      <Grid>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <div ref={container} style={{ height: "72vh", minHeight: 480, borderRadius: 14, overflow: "hidden", position: "relative" }}>
            {renderError ? (
              <div style={{ position: "absolute", inset: 0, zIndex: 2, background: "var(--mantine-color-body)" }}>
                <ErrorPanel error={renderError} what="la vue 3D" />
              </div>
            ) : null}
          </div>
          {!p && <Loading />}
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack>
            <Paper p="md">
              <Group justify="space-between">
                <Title order={4}>Cuverie</Title>
                <Button size="xs" variant="light" onClick={() => scene.current?.flyToTanks()} disabled={!p?.tanks.length}>
                  Voir les cuves
                </Button>
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                {p ? `${p.tanks.length} cuve(s) placée(s)` : "…"}
                {p?.unplaced.length ? ` · ${p.unplaced.length} non localisée(s)` : ""}
              </Text>
              <Stack gap={4} mt="xs">
                {p?.tanks.map((t) => (
                  <Group key={t.id} justify="space-between" wrap="nowrap">
                    <Button size="compact-sm" variant={t.id === selected ? "filled" : "subtle"} onClick={() => setSelected(t.id)}>
                      {t.name}
                    </Button>
                    <Group gap={4}>
                      <Text className="lv-num" size="sm">
                        {Math.round(t.fill * 100)} %
                      </Text>
                      {t.placement === "manual" && <Badge size="xs" color="ardoise">placée</Badge>}
                    </Group>
                  </Group>
                ))}
                {p?.unplaced.map((u) => (
                  <Text key={u.id} size="xs" c="dimmed">
                    {u.name} : {u.reason}
                  </Text>
                ))}
              </Stack>
              {farm.role === "owner" && (
                <Switch
                  mt="sm"
                  label="Placer les cuves (choisir une cuve, puis cliquer dans son bâtiment)"
                  checked={placing}
                  onChange={(e) => setPlacing(e.currentTarget.checked)}
                />
              )}
            </Paper>

            {tank && (
              <Paper p="md">
                <Title order={4} mb="xs">
                  {tank.name}
                </Title>
                <Text size="sm" c="dimmed" mb="xs">
                  Cylindre de {(tank.radius * 2).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} m × {tank.height.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} m
                  {tank.placement === "auto" ? " (placement automatique)" : ""}
                </Text>
                <TankContents farmId={farm.id} containerId={tank.id} at={at} capacityL={snap.data?.containers.find((c) => c.id === tank.id)?.version.capacityL ?? 0} />
              </Paper>
            )}

            <Paper p="md">
              <Title order={4} mb="xs">
                Rejeu du {formatDate(at)}
              </Title>
              <Group align="flex-end" wrap="nowrap">
                <Select
                  label="Matériel"
                  placeholder="Choisir"
                  searchable
                  style={{ flex: 1 }}
                  data={snap.data?.equipments.map((e) => ({ value: e.id, label: e.name })) ?? []}
                  value={equipment}
                  onChange={setEquipment}
                />
                <Button disabled={!equipment} loading={loadTrack.isPending} onClick={() => loadTrack.mutate()}>
                  Charger
                </Button>
              </Group>
              {loadTrack.data && loadTrack.data.samples.length > 1 && (
                <Switch
                  mt="sm"
                  label="Suivre le matériel (caméra derrière son avatar)"
                  checked={following}
                  onChange={(e) => {
                    setFollowing(e.currentTarget.checked);
                    scene.current?.follow(e.currentTarget.checked);
                  }}
                />
              )}
              <Switch
                mt="sm"
                label="Tous les matériels suivis (dernière position connue)"
                checked={fleetOn}
                onChange={(e) => setFleetOn(e.currentTarget.checked)}
              />
              {fleetOn && fleet.data && (
                <Text size="xs" c="dimmed">
                  {fleet.data.items.length ? fleet.data.items.map((f) => `${f.name} (${new Date(f.time).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })})`).join(" · ") : "Aucune position dans les 30 jours précédents."}
                </Text>
              )}
              {loadTrack.data && loadTrack.data.samples.length > 1 && (
                <Group mt="sm" wrap="nowrap">
                  <Button
                    leftSection={playing ? <Pause size={16} /> : <Play size={16} />}
                    onClick={() => {
                      scene.current?.play(!playing, Number(speed));
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? "Pause" : "Lecture"}
                  </Button>
                  <SegmentedControl
                    size="xs"
                    value={speed}
                    onChange={(v) => {
                      setSpeed(v);
                      scene.current?.play(playing, Number(v));
                    }}
                    data={[
                      { value: "60", label: "×60" },
                      { value: "300", label: "×300" },
                      { value: "900", label: "×900" },
                    ]}
                  />
                  <Text className="lv-num" size="sm">
                    {clock ? new Date(clock).toLocaleTimeString("fr-FR") : ""}
                  </Text>
                </Group>
              )}
            </Paper>

            {farm.role === "owner" && estimated > 0 && (
              <Paper p="md">
                <Text size="sm">
                  {estimated} bâtiment(s) sans hauteur connue (6 m par défaut).
                </Text>
                <Button mt="xs" size="xs" variant="light" loading={heights.isPending} onClick={() => heights.mutate()}>
                  Compléter depuis la BD TOPO (IGN)
                </Button>
              </Paper>
            )}
            {p && (
              <Text size="xs" c="dimmed">
                Volume total en cuve : {formatLiters(p.tanks.reduce((s, t) => s + t.fill * Math.PI * t.radius ** 2 * t.height * 1000, 0))} (d'après la géométrie).
              </Text>
            )}
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
