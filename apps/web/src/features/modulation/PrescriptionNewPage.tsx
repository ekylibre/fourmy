import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Alert, Anchor, Button, Checkbox, Group, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  INDEX_SCALES,
  MODULATION_STRATEGY_LABELS,
  MODULATION_ZONES,
  PRESCRIPTION_UNIT_LABELS,
  PRESCRIPTION_UNIT_STEP,
  type ModulationStrategy,
  type Prescription,
  type PrescriptionUnit,
  type VegetationIndex,
  type Zoning,
} from "@fourmy/contracts";
import { conserveMean, modulationRates, prescriptionTotal } from "@fourmy/domain";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { useParcelNames } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ParcelMap } from "../map/ParcelMap";
import { IndexPicker } from "../remote-sensing/SatelliteControl";
import { ha, idx, qty, useModulationDates, zoneColor, zonesCollection } from "./modulation";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** Valeurs proposées par unité : dose de base, bornes de la machine. */
const DEFAULTS: Record<PrescriptionUnit, { base: number; min: number; max: number }> = {
  kg_ha: { base: 150, min: 50, max: 400 },
  l_ha: { base: 100, min: 20, max: 300 },
  seeds_ha: { base: 90_000, min: 60_000, max: 120_000 },
};

/**
 * Nouvelle carte de modulation (lot AD, FR-TWIN-6) : 1. zonage de la parcelle
 * d'après une image Sentinel-2 dégagée ; 2. produit, doses et machine ;
 * 3. enregistrement, puis export ou envoi depuis la fiche de la carte.
 */
export function PrescriptionNewPage() {
  const farm = useFarm();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const names = useParcelNames(farm.id);
  const [parcelId, setParcelId] = useState<string | null>(params.get("parcel"));
  const [index, setIndex] = useState<VegetationIndex>("ndvi");
  const [date, setDate] = useState<string | null>(null);
  const [zoneCount, setZoneCount] = useState<number>(MODULATION_ZONES.default);
  const dates = useModulationDates(farm.id, parcelId, index);
  const [zoning, setZoning] = useState<Zoning | null>(null);

  // Carte partie d'un apport du plan de fumure (lot AN) : dose visée en moyenne pondérée.
  const fromPlan = useMemo(
    () => (params.get("plan") && Number(params.get("rate")) > 0 ? { planId: params.get("plan")!, stage: params.get("stage") ?? "", targetRate: Number(params.get("rate")) } : null),
    [params],
  );
  const [keepMean, setKeepMean] = useState(!!fromPlan);
  const [name, setName] = useState(fromPlan ? `Azote ${fromPlan.stage}`.trim() : "");
  const [product, setProduct] = useState(params.get("product") ?? "");
  const [unit, setUnit] = useState<PrescriptionUnit>((params.get("unit") as PrescriptionUnit | null) ?? "kg_ha");
  const [strategy, setStrategy] = useState<ModulationStrategy>("compensate");
  const [baseRate, setBaseRate] = useState<number>(fromPlan?.targetRate ?? DEFAULTS.kg_ha.base);
  const [modulationPct, setModulationPct] = useState<number>(20);
  // Depuis le plan : bornes de la machine autour de la dose de l'apport (la moitié, une fois et demie), à ajuster.
  const [minRate, setMinRate] = useState<number>(fromPlan ? Math.round(fromPlan.targetRate * 0.5) : DEFAULTS.kg_ha.min);
  const [maxRate, setMaxRate] = useState<number>(fromPlan ? Math.round(fromPlan.targetRate * 1.5) : DEFAULTS.kg_ha.max);
  const [widthM, setWidthM] = useState<number>(24);
  // Doses saisies à la main (null : calculées).
  const [edited, setEdited] = useState<(number | null)[]>([]);

  // Date par défaut : la plus proche avant la date prévue de l'apport du plan (`on`), sinon la plus récente.
  const plannedOn = params.get("on");
  useEffect(() => {
    if (!dates.data || dates.data.items.some((d) => d.date === date)) return;
    const sorted = [...dates.data.items].sort((a, b) => b.date.localeCompare(a.date));
    setDate((plannedOn ? sorted.find((d) => d.date <= plannedOn) : undefined)?.date ?? sorted[0]?.date ?? null);
  }, [dates.data, date, plannedOn]);
  useEffect(() => setZoning(null), [parcelId, index, date, zoneCount]);
  useEffect(() => setEdited([]), [zoneCount, strategy, baseRate, modulationPct, minRate, maxRate, unit]);

  const zone = useMutation({
    mutationFn: () => api.post<Zoning>(farmPath(farm.id, "/prescriptions/zoning"), { parcelId, date, index, zoneCount }),
    onSuccess: (z) => {
      setZoning(z);
      if (!name) setName(`Modulation ${INDEX_SCALES[index].label} du ${formatDate(z.date)}`);
    },
  });

  const computed = useMemo(
    () => modulationRates({ zoneCount, strategy, baseRate: baseRate || 0, modulationPct: modulationPct || 0, minRate: minRate || 0, maxRate: maxRate || 0, unit }),
    [zoneCount, strategy, baseRate, modulationPct, minRate, maxRate, unit],
  );
  const conserved = useMemo(() => {
    if (!fromPlan || !keepMean || !zoning) return null;
    const areas = computed.map((_, k) => zoning.zones.find((z) => z.code === k + 1)?.areaM2 ?? 0);
    return conserveMean(computed, areas, fromPlan.targetRate, { minRate: minRate || 0, maxRate: maxRate || 0, unit });
  }, [fromPlan, keepMean, zoning, computed, minRate, maxRate, unit]);
  const rates = (conserved?.rates ?? computed).map((r, k) => edited[k] ?? r);
  const zones = (zoning?.zones ?? []).map((z) => ({ ...z, rate: rates[z.code - 1] ?? 0 }));
  const total = prescriptionTotal(zones);
  const area = zones.reduce((s, z) => s + z.areaM2, 0);
  const tooWide = maxRate < minRate;

  const save = useMutation({
    mutationFn: () =>
      api.post<Prescription>(farmPath(farm.id, "/prescriptions"), {
        parcelId, date, index, zoneCount, name, product, unit, strategy, baseRate, modulationPct, minRate, maxRate, widthM,
        rates: edited.some((e) => e !== null) ? rates : undefined,
        ...(fromPlan && keepMean ? { planLink: fromPlan } : {}),
      }),
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: ["prescriptions", farm.id] });
      notifications.show({ color: "lichen", message: "Carte de modulation enregistrée." });
      navigate(`/f/${farm.id}/prescriptions/${p.id}${location.search}`);
    },
  });

  if (names.isLoading) return <Loading />;
  const parcelOptions = [...(names.data ?? new Map()).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
  const unitLabel = PRESCRIPTION_UNIT_LABELS[unit];
  const quantityUnit = unit === "kg_ha" ? "kg" : unit === "l_ha" ? "L" : "grains";

  return (
    <Stack>
      <div>
        <Anchor component={Link} to={`/f/${farm.id}/prescriptions${location.search}`} size="sm">
          ← Cartes de modulation
        </Anchor>
        <Title order={1}>Nouvelle carte de modulation</Title>
        {fromPlan && (
          <Alert color="lichen" variant="light" mt="xs" aria-label="Apport du plan de fumure">
            <Stack gap={4}>
              <Text size="sm">
                Carte partie de l'apport « {fromPlan.stage || "sans stade"} » du plan de fumure : {qty(fromPlan.targetRate)} {PRESCRIPTION_UNIT_LABELS[unit]} de {product || "produit"}.
              </Text>
              <Checkbox
                label="Garder la dose du plan en moyenne pondérée sur la parcelle (les doses des zones sont décalées d'autant)"
                checked={keepMean}
                onChange={(e) => setKeepMean(e.currentTarget.checked)}
              />
            </Stack>
          </Alert>
        )}
        <Text size="sm" c="dimmed">
          Zones de la parcelle d'après une image Sentinel-2 (10 m), dose par zone, puis export pour la console du tracteur.
        </Text>
      </div>

      <Paper p="md" withBorder>
        <Title order={2} size="h4" mb="sm">
          1. Zonage
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
          <Select label="Parcelle" searchable data={parcelOptions} value={parcelId} onChange={setParcelId} required />
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Indice
            </Text>
            <IndexPicker value={index} onChange={setIndex} />
          </Stack>
          <Select
            label="Image"
            description="Dates sans nuage sur la parcelle (80 % au moins)"
            disabled={!parcelId}
            data={(dates.data?.items ?? []).map((d) => ({ value: d.date, label: `${formatDate(d.date)} · ${INDEX_SCALES[index].label} ${idx(d.mean)}` }))}
            value={date}
            onChange={setDate}
            nothingFoundMessage="Aucune image"
            required
          />
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Nombre de zones
            </Text>
            <SegmentedControl
              aria-label="Nombre de zones"
              value={String(zoneCount)}
              onChange={(v) => setZoneCount(Number(v))}
              data={[2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
            />
          </Stack>
        </SimpleGrid>
        {parcelId && dates.data && dates.data.items.length === 0 && (
          <Alert color="paille" mt="sm">
            Aucune image assez dégagée de cette parcelle dans les 3 dernières années. Vérifiez l'intégration Copernicus (Intégrations).
          </Alert>
        )}
        {dates.error && <ErrorAlert error={dates.error} />}
        <Group mt="md">
          <Button onClick={() => zone.mutate()} loading={zone.isPending} disabled={!parcelId || !date}>
            Calculer les zones
          </Button>
          {zone.error && (
            <Text size="sm" c="brique">
              {zone.error instanceof ApiError ? (zone.error.detail ?? zone.error.title) : String(zone.error)}
            </Text>
          )}
        </Group>
      </Paper>

      {zoning && (
        <>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Paper withBorder style={{ height: 380, overflow: "hidden" }}>
              <ParcelMap parcels={zonesCollection(zones, zoneCount)} places={EMPTY} track={EMPTY} basemap="ortho" minHeight={0} fillOpacity={0.6} />
            </Paper>
            <Paper p="md" withBorder>
              <Title order={2} size="h4" mb="xs">
                {zoning.parcelName} · {ha(zoning.parcelAreaM2)} ha
              </Title>
              <Text size="sm" c="dimmed" mb="sm">
                Image du {formatDate(zoning.date)}, {Math.round(zoning.validRatio * 100)} % de la parcelle sans nuage. Zones de surfaces voisines (classes
                de même effectif), lissées ; la zone 1 a l'indice le plus faible.
              </Text>
              <Table aria-label="Zones" className="lv-num">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Zone</Table.Th>
                    <Table.Th>{INDEX_SCALES[index].label} moyen</Table.Th>
                    <Table.Th>Surface</Table.Th>
                    <Table.Th>Dose ({unitLabel})</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {zones.map((z) => (
                    <Table.Tr key={z.code}>
                      <Table.Td>
                        <Group gap={6}>
                          <span style={{ width: 12, height: 12, borderRadius: 2, background: zoneColor(z.code, zoneCount), display: "inline-block" }} />
                          Zone {z.code}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {idx(z.meanIndex)}{" "}
                        <Text span size="xs" c="dimmed">
                          ({idx(z.minIndex)} – {idx(z.maxIndex)})
                        </Text>
                      </Table.Td>
                      <Table.Td>{ha(z.areaM2)} ha</Table.Td>
                      <Table.Td>
                        <NumberInput
                          aria-label={`Dose zone ${z.code}`}
                          size="xs"
                          w={120}
                          min={0}
                          step={PRESCRIPTION_UNIT_STEP[unit]}
                          thousandSeparator=" "
                          value={z.rate}
                          onChange={(v) => {
                            const next = [...edited];
                            next[z.code - 1] = v === "" ? null : Number(v);
                            setEdited(next);
                          }}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          </SimpleGrid>

          <Paper p="md" withBorder>
            <Title order={2} size="h4" mb="sm">
              2. Produit, doses et machine
            </Title>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
              <TextInput label="Nom de la carte" value={name} onChange={(e) => setName(e.currentTarget.value)} required maxLength={100} />
              <TextInput label="Produit" placeholder="Ammonitrate 33,5, semence…" value={product} onChange={(e) => setProduct(e.currentTarget.value)} required maxLength={100} />
              <Select
                label="Unité de dose"
                data={Object.entries(PRESCRIPTION_UNIT_LABELS).map(([value, label]) => ({ value, label }))}
                value={unit}
                allowDeselect={false}
                onChange={(v) => {
                  const u = (v ?? "kg_ha") as PrescriptionUnit;
                  setUnit(u);
                  setBaseRate(DEFAULTS[u].base);
                  setMinRate(DEFAULTS[u].min);
                  setMaxRate(DEFAULTS[u].max);
                }}
              />
              <Select
                label="Répartition"
                data={Object.entries(MODULATION_STRATEGY_LABELS).map(([value, label]) => ({ value, label }))}
                value={strategy}
                allowDeselect={false}
                onChange={(v) => setStrategy((v ?? "compensate") as ModulationStrategy)}
              />
              <NumberInput label={`Dose de base (${unitLabel})`} description="Dose de la zone moyenne" min={0} thousandSeparator=" " value={baseRate} onChange={(v) => setBaseRate(Number(v) || 0)} />
              <NumberInput
                label="Écart entre zones"
                description="De la zone moyenne aux zones extrêmes"
                suffix=" %"
                min={0}
                max={100}
                disabled={strategy === "uniform"}
                value={modulationPct}
                onChange={(v) => setModulationPct(Number(v) || 0)}
              />
              <NumberInput label={`Dose minimale de la machine (${unitLabel})`} min={0} thousandSeparator=" " value={minRate} onChange={(v) => setMinRate(Number(v) || 0)} />
              <NumberInput
                label={`Dose maximale de la machine (${unitLabel})`}
                min={0}
                thousandSeparator=" "
                value={maxRate}
                onChange={(v) => setMaxRate(Number(v) || 0)}
                error={tooWide ? "Inférieure à la dose minimale" : undefined}
              />
              <NumberInput
                label="Largeur de travail"
                description="Taille des mailles de la grille ISO-XML"
                suffix=" m"
                min={1}
                max={60}
                decimalScale={1}
                value={widthM}
                onChange={(v) => setWidthM(Number(v) || 0)}
              />
            </SimpleGrid>
            <Text mt="md" size="sm">
              Quantité totale : <b>{qty(total)} {quantityUnit}</b> sur {ha(area)} ha, soit {qty(area > 0 ? total / (area / 10_000) : 0)} {unitLabel} en moyenne.
            </Text>
            {fromPlan && keepMean && area > 0 && Math.abs(total / (area / 10_000) - fromPlan.targetRate) > fromPlan.targetRate * 0.02 && (
              <Alert color="paille" mt="xs" aria-label="Écart à la dose du plan">
                La moyenne de la carte ({qty(total / (area / 10_000))} {unitLabel}) s'écarte de la dose du plan ({qty(fromPlan.targetRate)} {unitLabel}) : les doses
                minimale ou maximale de la machine la bornent. Élargissez-les ou corrigez les doses des zones.
              </Alert>
            )}
            {save.error && <ErrorAlert error={save.error} />}
            <Group mt="md">
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim() || !product.trim() || tooWide || !(baseRate > 0) || !(widthM >= 1)}>
                Enregistrer la carte
              </Button>
            </Group>
          </Paper>
        </>
      )}
    </Stack>
  );
}
