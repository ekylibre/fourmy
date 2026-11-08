import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Grid, Group, Loader, NumberInput, Paper, Radio, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, MousePointerClick } from "lucide-react";
import type { FeatureCollection, Geometry } from "geojson";
import type { ParcelIdentify } from "@fourmy/contracts";
import { formatHa } from "@fourmy/ui-lyvre";
import { api, ApiError, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { useActivities, useSnapshot } from "../../app/queries";
import { MapBoundary } from "../../components/MapBoundary";
import { ParcelMap } from "../map/ParcelMap";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Nouvelle parcelle depuis la carte (lot H des retours du 08/11/2026), comme
 * l'identificateur de parcelle de Lexicon : un clic sur la carte de la ferme
 * propose la parcelle PAC (RPG) et les parcelles cadastrales du point ; on
 * choisit la forme, on valide les champs pré-remplis (nom, campagne,
 * activité) et la parcelle est créée avec sa production pour l'activité.
 */
export function ParcelCreatePage() {
  const farm = useFarm();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { at, day } = useAt();
  const snap = useSnapshot(farm.id, at);
  const [year, setYear] = useState(Number(day.slice(0, 4)));
  const activities = useActivities(farm.id, year);
  const [found, setFound] = useState<ParcelIdentify | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null); // "cap" | idu
  const [name, setName] = useState("");
  const [activityId, setActivityId] = useState<string | null>(params.get("activity"));
  const [error, setError] = useState<string | null>(null);

  const parcels = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: (snap.data?.landParcels ?? []).map((p) => ({ type: "Feature", geometry: p.version.shape as unknown as Geometry, properties: { id: p.id, name: p.name, color: "#E8B500" } })),
    }),
    [snap.data],
  );
  const chosen = choice === "cap" ? found?.cap : found?.cadastre.find((c) => c.idu === choice);
  const highlight = useMemo<FeatureCollection>(
    () => (chosen ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: chosen.geometry as unknown as Geometry, properties: {} }] } : EMPTY),
    [chosen],
  );

  const identify = async (lngLat: { lng: number; lat: number }) => {
    setLooking(true);
    setLookError(null);
    try {
      const r = await api.get<ParcelIdentify>(farmPath(farm.id, `/land-parcels/identify?lat=${lngLat.lat}&lon=${lngLat.lng}&year=${year}`));
      setFound(r);
      const pick = r.cap ? "cap" : (r.cadastre[0]?.idu ?? null);
      setChoice(pick);
      prefill(r, pick);
    } catch (e) {
      setLookError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLooking(false);
    }
  };
  // Champs pré-remplis : nom (lieu-dit cadastral, culture déclarée, campagne), activité proposée.
  const prefill = (r: ParcelIdentify, pick: string | null) => {
    const place = r.cadastre[0]?.label.split(" ").slice(2).join(" ") || "Parcelle";
    const crop = pick === "cap" ? r.cap?.cropLabel : null;
    const section = pick && pick !== "cap" ? r.cadastre.find((c) => c.idu === pick)?.label.split(" ").slice(0, 2).join(" ") : null;
    setName([place, section, crop, String(year)].filter(Boolean).join(" "));
    if (!params.get("activity") && r.cap?.suggestedActivity) setActivityId(r.cap.suggestedActivity.id);
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(farmPath(farm.id, "/land-parcels/from-map"), {
        name: name.trim(),
        shape: chosen!.geometry,
        year,
        activityId,
        capRef: choice === "cap" ? found?.cap?.id : null,
      }),
    onSuccess: (r) => {
      notifications.show({ color: "lichen", message: "Parcelle créée." });
      navigate(`/f/${farm.id}/land-parcels/${r.id}${location.search}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  return (
    <Stack>
      <Button component={Link} to={`/f/${farm.id}/activities${location.search}`} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
        Activités
      </Button>
      <Title order={1}>Nouvelle parcelle</Title>
      <Grid>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Paper withBorder style={{ height: 560, overflow: "hidden" }} aria-label="Carte de la ferme">
            <MapBoundary>
              <ParcelMap parcels={parcels} places={EMPTY} track={EMPTY} highlight={highlight} basemap="ortho" minHeight={0} onMapClick={identify} />
            </MapBoundary>
          </Paper>
          <Group gap={6} mt={4}>
            <MousePointerClick size={14} aria-hidden />
            <Text size="xs" c="dimmed">
              Cliquez dans le champ : Fourmy propose la parcelle PAC et les parcelles cadastrales de ce point (API Carto de l'IGN). En jaune, les parcelles existantes.
            </Text>
          </Group>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Paper withBorder p="md">
            <Stack>
              {looking && (
                <Group gap="xs">
                  <Loader size="xs" />
                  <Text size="sm">Recherche des parcelles PAC et cadastrales…</Text>
                </Group>
              )}
              {lookError && <Alert color="brique">{lookError}</Alert>}
              {!found && !looking && (
                <Text size="sm" c="dimmed">
                  Cliquez sur la carte pour commencer.
                </Text>
              )}
              {found && (
                <>
                  {found.existing && (
                    <Alert color="paille" variant="light">
                      Ce point est déjà dans la parcelle{" "}
                      <Link to={`/f/${farm.id}/land-parcels/${found.existing.id}${location.search}`}>{found.existing.name}</Link>.
                    </Alert>
                  )}
                  {found.unavailable && <Alert color="paille">API Carto de l'IGN injoignable en partie : propositions incomplètes.</Alert>}
                  <Radio.Group label="Forme de la parcelle" value={choice} onChange={(v) => { setChoice(v); prefill(found, v); }}>
                    <Stack gap={6} mt={4}>
                      {found.cap && (
                        <Radio
                          value="cap"
                          label={`Parcelle PAC ${found.cap.year} : ${found.cap.cropLabel ?? found.cap.cropCode} (${formatHa(found.cap.areaM2)})`}
                        />
                      )}
                      {found.cadastre.map((c) => (
                        <Radio key={c.idu} value={c.idu} label={`Parcelle cadastrale ${c.label}${c.areaM2 ? ` (${formatHa(c.areaM2)})` : ""}`} />
                      ))}
                      {!found.cap && found.cadastre.length === 0 && <Text size="sm">Aucune parcelle PAC ni cadastrale à ce point.</Text>}
                    </Stack>
                  </Radio.Group>
                  {found.cap && found.capYear < year && (
                    <Text size="xs" c="dimmed">
                      Registre parcellaire graphique publié jusqu'à {found.capYear} : la déclaration de {year} n'est pas encore disponible.
                    </Text>
                  )}
                  <TextInput label="Nom" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
                  <NumberInput label="Campagne" min={2000} max={2100} value={year} onChange={(v) => typeof v === "number" && setYear(v)} />
                  <Select
                    label="Activité"
                    description={found.cap?.suggestedActivity ? `Proposée d'après la culture déclarée à la PAC : ${found.cap.suggestedActivity.name}.` : undefined}
                    data={(activities.data?.items ?? []).filter((a) => !a.suspended).map((a) => ({ value: a.id, label: a.name }))}
                    value={activityId}
                    onChange={setActivityId}
                    clearable
                  />
                  {error && <Alert color="brique">{error}</Alert>}
                  <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!chosen || !name.trim() || farm.role !== "owner"}>
                    Créer la parcelle
                  </Button>
                </>
              )}
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
