import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Alert, Badge, Box, Button, Group, Indicator, Paper, Popover, ScrollArea, SegmentedControl, Select, Slider, Stack, Switch, Text, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cylinder, Maximize, Minimize, Pause, Play, Satellite, Sprout, Tractor, Warehouse } from "lucide-react";
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
import { FarmScene, TERRAIN_TILE_BYTES, type PlanData, type TrackCamera } from "./FarmScene";
import { placementFromClick } from "./geometry";
import { indexColor } from "@fourmy/contracts";
import { imageFor, useParcelIndicesAt, useRemoteSensingStatus, useSatelliteLayer, useVegetationIndex } from "../features/remote-sensing/remote-sensing";
import { SatelliteControl } from "../features/remote-sensing/SatelliteControl";
import type { Vegetation3dAt } from "@fourmy/contracts";
import { weatherLook } from "./weather-look";
import { PHASE_LABELS } from "./vegetation";

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
  const [camera, setCamera] = useState<TrackCamera>("follow");
  const handlers = useRef({ ground: (_p: Pt) => {} });
  const [tools, setTools] = useState<Hitch[]>([]);
  // Mise en page (retours du 12/11/2026) : vue pleine hauteur, couches en barre d'icônes, plein écran.
  const [openSection, setOpenSection] = useState<string | null>(null);
  // Échap ferme la rubrique ouverte même quand le focus n'est plus dedans
  // (clic dans la vue 3D, focus perdu) : Mantine ne l'écoute que dans le panneau.
  // Dans le panneau ou un champ, on laisse Mantine faire (une liste ouverte se
  // ferme d'abord).
  useEffect(() => {
    if (!openSection) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (e.key !== "Escape" || t?.closest(".mantine-Popover-dropdown, input, textarea, [role=combobox]")) return;
      setOpenSection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSection]);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  // Toute la page passe en plein écran (listes et notifications restent visibles), la vue l'occupe en entier.
  // Sans l'API plein écran (navigateur qui la refuse), la vue occupe au moins toute la fenêtre.
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (full) setFull(false);
    else document.documentElement.requestFullscreen().then(undefined, () => setFull(true));
  };

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

  // Jumeau (lot AA) : rangs de végétation selon l'état observé, ambiance de la météo du jour.
  const [vegOn, setVegOn] = useState(true);
  const [weatherOn, setWeatherOn] = useState(true);
  const vegetation = useQuery({
    queryKey: ["vegetation3d", farm.id, day],
    queryFn: () => api.get<Vegetation3dAt>(farmPath(farm.id, `/vegetation3d?at=${day}`)),
    placeholderData: (prev) => prev,
    staleTime: 10 * 60_000,
  });
  // Mémorisé : un nouvel objet à chaque rendu recréerait l'effet de pluie.
  const weather = vegetation.data?.weather ?? null;
  const look = useMemo(() => weatherLook(weather), [weather]);
  useEffect(() => {
    if (!plan.data || !vegetation.data) return;
    scene.current
      ?.setVegetation(vegOn ? vegetation.data.parcels : null, weatherOn && (look?.frost ?? false))
      .catch((e) => console.warn("Végétation 3D non construite", e));
  }, [plan.data, vegetation.data, vegOn, weatherOn, look?.frost]);
  useEffect(() => scene.current?.setWeather(weatherOn ? look : null), [weatherOn, look]);
  const fromModel = (vegetation.data?.parcels ?? []).filter((p) => p.canopy.source === "model").length;
  const phases = (vegetation.data?.parcels ?? []).reduce<Record<string, number>>((m, p) => ({ ...m, [p.canopy.phase]: (m[p.canopy.phase] ?? 0) + 1 }), {});

  // Télédétection (FR-TWIN-5) : image Sentinel-2 drapée sur le relief, ou parcelles teintées par l'indice choisi.
  const [sat, setSat] = useSatelliteLayer();
  const rsStatus = useRemoteSensingStatus(farm.id);
  const rsEnabled = rsStatus.data?.enabled ?? false;
  const [idx, setIdx] = useVegetationIndex();
  const index = sat === "parcels" ? idx : "ndvi";
  const rs = useParcelIndicesAt(farm.id, day, rsEnabled && sat !== "none", index);
  const satImage = imageFor(rs.data, sat);
  useEffect(() => {
    scene.current?.setSatellite(satImage ? { href: satImage.href, bbox: satImage.bbox } : null).catch((e) => console.warn("Image satellite non chargée", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satImage?.href]);
  useEffect(() => {
    const tint =
      sat === "parcels" && rs.data
        ? new Map(rs.data.items.filter((i) => i.mean !== null && (i.status === "ok" || i.status === "stale")).map((i) => [i.parcelId, indexColor(index, i.mean!)]))
        : null;
    scene.current?.setParcelStyle(tint, satImage ? 0.05 : sat === "parcels" ? 0.7 : 0.4);
  }, [sat, index, rs.data, satImage, plan.data]);

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
      return api.get<TrackReplay>(farmPath(farm.id, `/tracks?equipment=${equipment}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&road=1`));
    },
    onSuccess: async (t) => {
      setPlaying(false);
      setTools([]);
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
      setTools(hitched?.items ?? []);
      scene.current?.setCamera(camera);
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
  const track = loadTrack.data && loadTrack.data.samples.length > 1 ? loadTrack.data : null;
  const startMs = track ? Date.parse(track.samples[0]![0]) : 0;
  const stopMs = track ? Date.parse(track.samples.at(-1)![0]) : 0;
  const clockMs = clock ? Math.min(Math.max(Date.parse(clock), startMs), stopMs) : startMs;
  const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const glass = { background: "color-mix(in srgb, var(--mantine-color-body) 90%, transparent)", backdropFilter: "blur(6px)" };
  // Listes déroulantes de la vue : au-dessus du plan 3D, même en plein écran.
  const combobox = { zIndex: 400 };

  const sections: { key: string; label: string; icon: typeof Sprout; active: boolean; content: ReactNode }[] = [
    {
      key: "twin",
      label: "Végétation et météo",
      icon: Sprout,
      active: vegOn || weatherOn,
      content: (
        <>
          <Switch label="Rangs de végétation (état observé ou simulé)" checked={vegOn} onChange={(e) => setVegOn(e.currentTarget.checked)} />
          {vegOn && vegetation.data && (
            <Text size="xs" c="dimmed" mt={4} aria-label="Phases des parcelles">
              {Object.entries(phases)
                .map(([phase, n]) => `${n} ${PHASE_LABELS[phase as keyof typeof PHASE_LABELS]}`)
                .join(" · ") || "Aucune parcelle"}
              {fromModel > 0 && ` · dont ${fromModel} d'après le modèle de croissance (pas de NDVI récent)`}
            </Text>
          )}
          <Switch mt="xs" label="Météo du jour" checked={weatherOn} onChange={(e) => setWeatherOn(e.currentTarget.checked)} />
          {weatherOn && (
            <Text size="xs" c="dimmed" mt={4}>
              {look ? `${look.label}${look.wetSoil ? " · sol mouillé" : ""}${look.frost ? " · gelée" : ""}` : vegetation.isLoading ? "…" : "Météo indisponible"}
            </Text>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            Hauteur et couleur des rangs d'après le NDVI Sentinel-2 et les interventions saisies ; orientation des rangs : grand axe de la parcelle, à corriger dans sa fiche.
          </Text>
        </>
      ),
    },
    {
      key: "satellite",
      label: "Image satellite",
      icon: Satellite,
      active: sat !== "none",
      content: <SatelliteControl farmId={farm.id} enabled={rsEnabled} data={rs.data} layer={sat} onChange={setSat} index={idx} onIndexChange={setIdx} bare />,
    },
    {
      key: "fleet",
      label: "Matériels suivis",
      icon: Tractor,
      active: fleetOn,
      content: (
        <>
          <Switch label="Tous les matériels suivis (dernière position connue)" checked={fleetOn} onChange={(e) => setFleetOn(e.currentTarget.checked)} />
          {fleetOn && fleet.data && (
            <Text size="xs" c="dimmed" mt={4}>
              {fleet.data.items.length ? fleet.data.items.map((f) => `${f.name} (${new Date(f.time).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })})`).join(" · ") : "Aucune position dans les 30 jours précédents."}
            </Text>
          )}
        </>
      ),
    },
    {
      key: "tanks",
      label: "Cuverie",
      icon: Cylinder,
      active: !!tank || placing,
      content: (
        <>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {p ? `${p.tanks.length} cuve(s) placée(s)` : "…"}
              {p?.unplaced.length ? ` · ${p.unplaced.length} non localisée(s)` : ""}
            </Text>
            <Button size="xs" variant="light" onClick={() => scene.current?.flyToTanks()} disabled={!p?.tanks.length}>
              Voir les cuves
            </Button>
          </Group>
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
            <Switch mt="sm" label="Placer les cuves (choisir une cuve, puis cliquer dans son bâtiment)" checked={placing} onChange={(e) => setPlacing(e.currentTarget.checked)} />
          )}
          {tank && (
            <Box mt="sm">
              <Text fw={600}>{tank.name}</Text>
              <Text size="sm" c="dimmed" mb="xs">
                Cylindre de {(tank.radius * 2).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} m × {tank.height.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} m
                {tank.placement === "auto" ? " (placement automatique)" : ""}
              </Text>
              <TankContents farmId={farm.id} containerId={tank.id} at={at} capacityL={snap.data?.containers.find((c) => c.id === tank.id)?.version.capacityL ?? 0} />
            </Box>
          )}
          {p && (
            <Text size="xs" c="dimmed" mt="sm">
              Volume total en cuve : {formatLiters(p.tanks.reduce((s, t) => s + t.fill * Math.PI * t.radius ** 2 * t.height * 1000, 0))} (d'après la géométrie).
            </Text>
          )}
        </>
      ),
    },
    ...(farm.role === "owner" && estimated > 0
      ? [
          {
            key: "buildings",
            label: "Bâtiments",
            icon: Warehouse,
            active: false,
            content: (
              <>
                <Text size="sm">{estimated} bâtiment(s) sans hauteur connue (6 m par défaut).</Text>
                <Button mt="xs" size="xs" variant="light" loading={heights.isPending} onClick={() => heights.mutate()}>
                  Compléter depuis la BD TOPO (IGN)
                </Button>
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <Stack gap="xs">
      {!full && (
        <Group justify="space-between" wrap="nowrap">
          <Title order={1}>Plan 3D au {formatDate(at)}</Title>
        </Group>
      )}
      {fallback && !full && (
        <Alert color="paille" title="Relief de repli">
          Le relief IGN est momentanément indisponible : certaines zones s'affichent à plat.
        </Alert>
      )}
      <div
        data-testid="plan3d-shell"
        style={
          full
            ? { position: "fixed", inset: 0, zIndex: 150, background: "#000" }
            : { position: "relative", height: "calc(100dvh - 190px)", minHeight: 520, borderRadius: 14, overflow: "hidden", background: "#000" }
        }
      >
        <div ref={container} style={{ position: "absolute", inset: 0 }} />
        {renderError ? (
          <div style={{ position: "absolute", inset: 0, zIndex: 3, background: "var(--mantine-color-body)" }}>
            <ErrorPanel error={renderError} what="la vue 3D" />
          </div>
        ) : null}
        {!p && (
          <Box pos="absolute" top="40%" left={0} right={0} style={{ zIndex: 2 }}>
            <Loading />
          </Box>
        )}

        {/* Commandes de la vue : plein écran. */}
        <Group gap={6} pos="absolute" top={12} left={12} style={{ zIndex: 2 }}>
          <Tooltip label={full ? "Quitter le plein écran (Échap)" : "Plein écran"}>
            <ActionIcon size="lg" variant="default" style={glass} onClick={toggleFull} aria-label={full ? "Quitter le plein écran" : "Plein écran"}>
              {full ? <Minimize size={18} /> : <Maximize size={18} />}
            </ActionIcon>
          </Tooltip>
          {full && (
            <Text size="sm" fw={600} px="xs" py={4} style={{ ...glass, borderRadius: 8 }}>
              Plan 3D au {formatDate(at)}
            </Text>
          )}
        </Group>

        {/* Couches et réglages : une barre d'icônes, chaque rubrique s'ouvre à côté, une à la fois. */}
        <Stack gap={6} pos="absolute" top={12} right={12} style={{ zIndex: 2 }} role="toolbar" aria-label="Couches du plan 3D" aria-orientation="vertical">
          {sections.map((sct) => (
            <Popover
              key={sct.key}
              opened={openSection === sct.key}
              onChange={(o) => setOpenSection(o ? sct.key : null)}
              position="left-start"
              offset={10}
              width={340}
              shadow="md"
              zIndex={400}
              trapFocus={false}
              closeOnEscape
            >
              <Popover.Target>
                <Tooltip label={sct.label} position="left" disabled={openSection === sct.key}>
                  <Indicator disabled={!sct.active} size={9} offset={4} color="lichen" withBorder>
                    <ActionIcon
                      size="lg"
                      variant={openSection === sct.key ? "filled" : "default"}
                      style={openSection === sct.key ? undefined : glass}
                      aria-label={sct.label}
                      aria-expanded={openSection === sct.key}
                      onClick={() => setOpenSection(openSection === sct.key ? null : sct.key)}
                    >
                      <sct.icon size={18} />
                    </ActionIcon>
                  </Indicator>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown p="sm">
                <ScrollArea.Autosize mah="min(60vh, 520px)" type="auto" offsetScrollbars>
                  <Title order={5} mb="xs">
                    {sct.label}
                  </Title>
                  {sct.content}
                </ScrollArea.Autosize>
              </Popover.Dropdown>
            </Popover>
          ))}
        </Stack>

        {/* Barre de rejeu, toujours visible en bas de la vue. */}
        <Paper
          aria-label={`Rejeu du ${formatDate(at)}`}
          pos="absolute"
          left={12}
          right={12}
          bottom={12}
          p="sm"
          style={{ zIndex: 2, ...glass, boxShadow: "var(--mantine-shadow-md)" }}
        >
          <Group gap="sm" wrap="wrap" align="center">
            <Select
              aria-label="Matériel"
              placeholder="Matériel à rejouer"
              searchable
              w={220}
              comboboxProps={combobox}
              data={snap.data?.equipments.map((e) => ({ value: e.id, label: e.name })) ?? []}
              value={equipment}
              onChange={setEquipment}
            />
            <Button variant={track ? "default" : "filled"} disabled={!equipment} loading={loadTrack.isPending} onClick={() => loadTrack.mutate()}>
              Charger
            </Button>
            {track && (
              <>
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
                  aria-label="Vitesse"
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
                <Text className="lv-num" size="sm" fw={600} miw={64}>
                  {clock ? new Date(clockMs).toLocaleTimeString("fr-FR") : hhmm(startMs)}
                </Text>
                <SegmentedControl
                  size="xs"
                  aria-label="Caméra"
                  value={camera}
                  data={[
                    { value: "follow", label: "Derrière" },
                    { value: "drone", label: "Drone" },
                    { value: "overview", label: "Libre" },
                  ]}
                  onChange={(v) => {
                    setCamera(v as TrackCamera);
                    scene.current?.setCamera(v as TrackCamera);
                  }}
                />
              </>
            )}
          </Group>
          {track && (
            <Stack gap={4} mt="sm">
              <Slider
                aria-label="Instant du rejeu"
                min={startMs}
                max={stopMs}
                step={1000}
                value={clockMs}
                label={(v) => hhmm(v)}
                onChange={(v) => {
                  scene.current?.seek(new Date(v).toISOString());
                  setClock(new Date(v).toISOString());
                }}
              />
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {tools.length
                    ? `Outil : ${tools.map((h) => `${h.toolName} (${hhmm(Date.parse(h.from))}–${hhmm(Date.parse(h.to))})`).join(" · ")}`
                    : "Aucun outil attelé connu ce jour-là (intervention réalisée ou outil Traccar relié)."}
                </Text>
                {track.road && track.road.runs > 0 && (
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    Trajets recalés sur la route : {track.road.snapped}/{track.road.runs}
                  </Text>
                )}
              </Group>
            </Stack>
          )}
        </Paper>
      </div>
    </Stack>
  );
}
