import { lazy, Suspense, useMemo, useState } from "react";
import { Alert, Anchor, Badge, Button, Card, Group, Modal, NumberInput, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import type { FeatureCollection, Geometry } from "geojson";
import { SITE_RADIUS, type FarmProfile, type FarmSite, type FarmSiteWrite, type GeocodeResult, type GeoPoint } from "@fourmy/contracts";
import { geocodeQuality } from "@fourmy/domain";
import { api, ApiError, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { useSnapshot } from "../../app/queries";
import { MapBoundary } from "../../components/MapBoundary";
import { Loading } from "../../components/states";
import { AddressField } from "./AddressField";

const SitesMap = lazy(() => import("./SitesMap").then((m) => ({ default: m.SitesMap })));

/**
 * Sites de la ferme (E16 à E20) : le siège d'abord, chacun avec son point et
 * le cercle de sa zone IGN. Les parcelles hors de toutes les zones sont
 * signalées.
 */

const km = (m: number) => `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
const addressLine = (s: FarmSite) => [s.address.line1, s.address.line2, [s.address.postalCode, s.address.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

function useParcelShapes(farmId: string): FeatureCollection {
  const { at } = useAt();
  const snap = useSnapshot(farmId, at);
  return useMemo(
    () => ({
      type: "FeatureCollection",
      features: (snap.data?.landParcels ?? []).map((p) => ({ type: "Feature", geometry: p.version.shape as unknown as Geometry, properties: { id: p.id } })),
    }),
    [snap.data],
  );
}

export function SitesTab({ profile }: { profile: FarmProfile }) {
  const farm = useFarm();
  const parcels = useParcelShapes(farm.id);
  const [editing, setEditing] = useState<FarmSite | "new" | null>(null);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(farmPath(farm.id, `/farm/sites/${id}`)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Site supprimé." });
      void queryClient.invalidateQueries({ queryKey: ["farm-profile", farm.id] });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  const hq = profile.sites.find((s) => s.isHeadquarters);
  return (
    <Stack>
      {hq && !hq.location && (
        <Alert color="paille" title="Le siège n'est pas encore placé">
          Saisissez son adresse ou placez-le sur la carte : il sert de point de repère pour la météo et les données IGN.
        </Alert>
      )}
      {profile.parcelsOutside !== null && profile.parcelsOutside > 0 && (
        <Alert color="paille" title={`${profile.parcelsOutside} parcelle(s) hors des zones IGN`}>
          Agrandissez le rayon d'un site, ou ajoutez un site près de ces parcelles.
        </Alert>
      )}
      <MapBoundary what="la carte des sites">
        <Suspense fallback={<Loading />}>
          <SitesMap sites={profile.sites} parcels={parcels} />
        </Suspense>
      </MapBoundary>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {profile.sites.map((s) => (
          <Card key={s.id} withBorder padding="sm" aria-label={`Site ${s.name}`}>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Stack gap={2}>
                <Group gap="xs">
                  <Text fw={700}>{s.name}</Text>
                  {s.isHeadquarters && <Badge size="xs" variant="light">Siège</Badge>}
                </Group>
                <Text size="sm">{addressLine(s) || "Adresse non renseignée"}</Text>
                <Text size="xs" c="dimmed">
                  {s.location ? `${s.locationSource === "manual" ? "Placé à la main" : "Géocodé"} · zone de ${km(s.radiusM)}` : "Pas encore placé"}
                </Text>
              </Stack>
              {profile.canEdit && (
                <Group gap={4} wrap="nowrap">
                  <Button size="compact-sm" variant="subtle" leftSection={<Pencil size={14} />} onClick={() => setEditing(s)}>
                    Modifier
                  </Button>
                  {!s.isHeadquarters && (
                    <Button size="compact-sm" variant="subtle" color="brique" aria-label={`Supprimer le site ${s.name}`} onClick={() => remove.mutate(s.id)}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </Group>
              )}
            </Group>
          </Card>
        ))}
      </SimpleGrid>
      {profile.canEdit && (
        <Button variant="light" w="fit-content" leftSection={<Plus size={14} />} onClick={() => setEditing("new")}>
          Ajouter un site
        </Button>
      )}
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nouveau site" : editing ? `Site : ${editing.name}` : ""} size="xl">
        {editing !== null && <SiteForm site={editing === "new" ? null : editing} sites={profile.sites} parcels={parcels} onDone={() => setEditing(null)} />}
      </Modal>
    </Stack>
  );
}

const blank: FarmSiteWrite = {
  name: "",
  address: { line1: null, line2: null, postalCode: null, city: null, inseeCode: null },
  location: null,
  locationSource: null,
  geocode: null,
  radiusM: SITE_RADIUS.default,
};

/** Formulaire d'un site : adresse assistée, épingle déplaçable, rayon (E4 à E7, E17). */
export function SiteForm({ site, sites, parcels, onDone }: { site: FarmSite | null; sites: FarmSite[]; parcels: FeatureCollection; onDone: () => void }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FarmSiteWrite>(site ?? blank);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FarmSiteWrite>) => setForm((f) => ({ ...f, ...patch }));
  const setAddress = (patch: Partial<FarmSiteWrite["address"]>) => setForm((f) => ({ ...f, address: { ...f.address, ...patch } }));

  const pick = (r: GeocodeResult) =>
    setForm((f) => ({
      ...f,
      address: { ...f.address, line1: r.line1, postalCode: r.postalCode, city: r.city, inseeCode: r.inseeCode },
      // Un point placé à la main ne bouge plus quand l'adresse change (E6).
      ...(f.locationSource === "manual" ? {} : { location: r.location, locationSource: "geocoded" as const, geocode: { score: r.score, type: r.type } }),
    }));

  // Adresse la plus proche d'un point placé à la main, à titre indicatif.
  const manual = form.locationSource === "manual" ? form.location : null;
  const nearest = useQuery({
    queryKey: ["geocode-reverse", farm.id, manual?.lat.toFixed(5), manual?.lon.toFixed(5)],
    queryFn: () => api.get<GeocodeResult | null>(farmPath(farm.id, `/geocode/reverse?lat=${manual!.lat}&lon=${manual!.lon}`)),
    enabled: manual !== null,
    retry: false,
  });
  const recompute = useMutation({
    mutationFn: () => {
      const q = [form.address.line1, form.address.postalCode, form.address.city].filter(Boolean).join(" ");
      return api.get<GeocodeResult[]>(farmPath(farm.id, `/geocode?q=${encodeURIComponent(q)}&limit=1`));
    },
    onSuccess: ([r]) => {
      if (!r) return setError("Adresse introuvable : le point reste où il est.");
      setError(null);
      set({ location: r.location, locationSource: "geocoded", geocode: { score: r.score, type: r.type }, address: { ...form.address, inseeCode: r.inseeCode } });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  const save = useMutation({
    mutationFn: () => (site ? api.put(farmPath(farm.id, `/farm/sites/${site.id}`), form) : api.post(farmPath(farm.id, "/farm/sites"), form)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: site ? "Site enregistré." : "Site ajouté." });
      void queryClient.invalidateQueries({ queryKey: ["farm-profile", farm.id] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  const approximate = form.locationSource === "geocoded" && form.geocode && geocodeQuality(form.geocode.score, form.geocode.type) === "approximate";
  // Objet stable : la carte ne redessine que si le point ou le rayon change.
  const edit = useMemo(
    () => ({ id: site?.id ?? null, location: form.location, radiusM: form.radiusM, onMove: (p: GeoPoint) => set({ location: p, locationSource: "manual", geocode: null }) }),
    [site?.id, form.location, form.radiusM],
  );

  return (
    <form
      aria-label="Site"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Stack gap="sm">
        <TextInput label="Nom du site" required value={form.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <AddressField value={form.address.line1 ?? ""} onChange={(v) => setAddress({ line1: v || null })} onPick={pick} />
        <TextInput label="Complément d'adresse" value={form.address.line2 ?? ""} onChange={(e) => setAddress({ line2: e.currentTarget.value || null })} />
        <Group grow>
          <TextInput label="Code postal" value={form.address.postalCode ?? ""} onChange={(e) => setAddress({ postalCode: e.currentTarget.value || null })} />
          <TextInput label="Ville" value={form.address.city ?? ""} onChange={(e) => setAddress({ city: e.currentTarget.value || null })} />
          <NumberInput
            label="Rayon de la zone IGN (km)"
            min={SITE_RADIUS.min / 1000}
            max={SITE_RADIUS.max / 1000}
            step={1}
            decimalScale={1}
            value={form.radiusM / 1000}
            onChange={(v) => typeof v === "number" && set({ radiusM: Math.round(v * 1000) })}
          />
        </Group>
        {approximate && (
          <Alert color="paille" title="Point approximatif">
            L'adresse n'a été trouvée qu'à la commune ou avec un score faible : vérifiez sur la carte et déplacez l'épingle si besoin.
          </Alert>
        )}
        <Text size="sm" c="dimmed">
          <MapPin size={14} style={{ verticalAlign: "middle" }} />{" "}
          {form.location
            ? form.locationSource === "manual"
              ? `Placé à la main${nearest.data ? `, près de « ${nearest.data.label} »` : ""}.`
              : "Point calculé depuis l'adresse. Déplacez l'épingle pour le corriger."
            : "Choisissez une adresse proposée, ou cliquez sur la carte pour placer le point."}
          {form.locationSource === "manual" && (
            <>
              {" "}
              <Anchor component="button" type="button" size="sm" onClick={() => recompute.mutate()}>
                Recalculer depuis l'adresse
              </Anchor>
            </>
          )}
        </Text>
        <MapBoundary what="la carte du site">
          <Suspense fallback={<Loading />}>
            <SitesMap sites={sites} parcels={parcels} height={300} edit={edit} />
          </Suspense>
        </MapBoundary>
        {error && <Alert color="brique">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            Annuler
          </Button>
          <Button type="submit" loading={save.isPending}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
