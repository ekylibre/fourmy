import { lazy, Suspense, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Grid,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type {
  Article,
  Intervention,
  InterventionCompleteWrite,
  InterventionInput,
  InterventionTarget,
  InterventionUpdateResult,
  Person,
  ProcedureCatalogue,
  ProcedureCatalogueItem,
  QuantityPer,
  Snapshot,
  TreatmentPurpose,
} from "@fourmy/contracts";
import { formatHa } from "@fourmy/ui-lyvre";
import { api, ApiError, farmPath } from "../../app/api";
import { unitLabel } from "../../app/labels";
import { invalidateAfterIntervention, useActivities } from "../../app/queries";
import { ActivityBadge, activityOfParcel } from "../activities/ActivityBadge";
import { MapBoundary } from "../../components/MapBoundary";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { treatedAreaM2 } from "./zones";
import { durationMinutes, formatDuration, parseDuration, withDuration, withStart } from "./periods";
import { ComplianceSummary, TreatmentCheckView, useComplianceCheck, type ComplianceDraft } from "./CompliancePanel";
import type { Activity, InterventionWeather } from "@fourmy/contracts";
import { SprayingConditions, WeatherFields, type WeatherRequestDraft } from "../weather/Weather";

// La carte (MapLibre, terra-draw) n'est chargée qu'en mode « Carte ».
const ParcelPicker = lazy(() => import("./ParcelPicker").then((m) => ({ default: m.ParcelPicker })));

/** Ligne de quantité ; `keep` garde ce que le formulaire n'affiche pas (lot, lieu de prélèvement). */
type QuantityRow = {
  articleId: string | null;
  quantity: number | "";
  per: QuantityPer;
  to: string | null;
  keep?: { lotId?: string; from?: InterventionInput["from"] };
};
type PeriodRow = { startedAt: string; stoppedAt: string };

export interface InterventionFormProps {
  farmId: string;
  snapshot: Snapshot;
  articles: Article[];
  people: Person[];
  catalogue: ProcedureCatalogue;
  /** Intervention planifiée à réaliser (formulaire prérempli). */
  planned?: Intervention;
  /**
   * Intervention à modifier : planifiée → mise à jour ; réalisée → correction
   * tracée (stock et registre suivent, l'historique garde l'avant).
   */
  editing?: Intervention;
  defaultDay: string;
  /** Après l'enregistrement, avec l'identifiant de l'intervention. */
  onDone: (id?: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  crops: "Cultures",
  vine: "Vigne",
  equipment: "Matériel",
  general: "Autres",
};

const local = (iso: string) => {
  // AAAA-MM-JJTHH:MM, heure locale, pour datetime-local.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (value: string) => new Date(value).toISOString();
const emptyRow = (per: QuantityPer): QuantityRow => ({ articleId: null, quantity: "", per, to: null });

/** Les éléments suggérés d'abord (habitudes de la ferme), puis les autres. */
function withSuggestions<T extends { value: string }>(options: T[], suggested: string[]) {
  const top = suggested.flatMap((id) => options.filter((o) => o.value === id));
  if (top.length === 0) return options;
  return [
    { group: "Habituels", items: top },
    { group: "Tous", items: options.filter((o) => !suggested.includes(o.value)) },
  ];
}

/**
 * Saisie d'une intervention (docs/interventions.md) : la **forme** de la
 * procédure décide des blocs affichés — cibles (parcelles, ou matériels pour
 * un entretien), intrants (dose par hectare ou quantité totale), sorties
 * rangées en lieu ou en cuve, motifs (traitements). Matériels, produits et
 * personnes habituels de la ferme sont proposés en premier. Planifier, ou
 * réaliser directement (une ou plusieurs périodes de travail).
 */
export function InterventionForm({ farmId, snapshot, articles, people, catalogue, planned: toComplete, editing, defaultDay, onDone }: InterventionFormProps) {
  const queryClient = useQueryClient();
  // Formulaire prérempli : intervention à réaliser ou à modifier.
  const planned = toComplete ?? editing;
  const correcting = editing?.status === "done";
  const [correctionId] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  // Contrôle réglementaire : cible (usage E-Phy) choisie par produit, dernier résultat, motif d'un feu rouge.
  const [usageChoices, setUsageChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(((toComplete ?? editing)?.compliance?.checks ?? []).filter((c) => c.usageId).map((c) => [c.articleId, c.usageId!])),
  );
  const [overrideReason, setOverrideReason] = useState((toComplete ?? editing)?.compliance?.reason ?? "");
  const [askOverride, setAskOverride] = useState(false);
  // Météo pendant l'intervention : pré-remplie (fournisseur), modifiable.
  const [weather, setWeather] = useState<InterventionWeather | null>((toComplete ?? editing)?.weather ?? null);
  const [code, setCode] = useState<string | null>(planned?.procedure ?? null);
  const procedure: ProcedureCatalogueItem | undefined = catalogue.items.find((p) => p.code === code);
  const shape = procedure?.shape;
  const start = planned?.startedAt ? local(planned.startedAt) : `${defaultDay}T08:00`;
  // Nouvelle intervention : réalisée si son début est passé, à planifier sinon (modifiable).
  const [mode, setMode] = useState<"done" | "planned">(() => (!planned && new Date(start).getTime() > Date.now() ? "planned" : "done"));
  const followStart = (startedAt: string) => {
    if (planned) return;
    const t = new Date(startedAt).getTime();
    if (!Number.isNaN(t)) setMode(t > Date.now() ? "planned" : "done");
  };
  const completing = editing ? correcting : Boolean(planned) || mode === "done";

  const [periods, setPeriods] = useState<PeriodRow[]>(
    planned?.periods.length
      ? planned.periods.map((p) => ({ startedAt: local(p.startedAt), stoppedAt: local(p.stoppedAt) }))
      : [{ startedAt: start, stoppedAt: `${start.slice(0, 10)}T10:00` }],
  );
  const [parcels, setParcels] = useState<string[]>(planned?.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id) ?? []);
  const [maintained, setMaintained] = useState<string[]>(planned?.targets.filter((t) => t.kind === "equipment").map((t) => t.id) ?? []);
  // Surface travaillée et zone de travail des cibles : conservées telles quelles.
  // Surface travaillée et zone de travail des cibles : conservées, ou dessinées sur la carte.
  const [targetExtras, setTargetExtras] = useState(
    () =>
      new Map<string, { workedAreaM2?: number; workingZone?: InterventionTarget["workingZone"] }>(
        (planned?.targets ?? []).map((t) => [t.id, { workedAreaM2: t.workedAreaM2, workingZone: t.workingZone }]),
      ),
  );
  const [parcelMode, setParcelMode] = useState<"list" | "map">("list");
  const parcelShapes = new Map(
    snapshot.landParcels.map((p) => [p.id, { id: p.id, name: p.name, shape: p.version.shape as unknown as import("@fourmy/carto").Area, areaM2: p.version.areaM2 }]),
  );
  const treatedM2 = treatedAreaM2(parcels, parcelShapes, targetExtras);
  // Activité des parcelles choisies (production de la campagne) : désigne la culture contrôlée.
  const activities = useActivities(farmId, Number(snapshot.at.slice(0, 4)));
  const parcelActivities = [
    ...parcels
      .map((id) => activityOfParcel(id, snapshot.productions, activities.data?.items))
      .filter((a): a is Activity => a !== null)
      .reduce((m, a) => m.set(a.id, { activity: a, count: (m.get(a.id)?.count ?? 0) + 1 }), new Map<string, { activity: Activity; count: number }>())
      .values(),
  ];
  const [inputs, setInputs] = useState<QuantityRow[]>(
    planned?.inputs.map((i) => ({ articleId: i.articleId, quantity: i.quantity, per: i.per, to: null, keep: { lotId: i.lotId, from: i.from } })) ?? [],
  );
  const [outputs, setOutputs] = useState<QuantityRow[]>(
    planned?.outputs.map((o) => ({
      articleId: o.articleId,
      quantity: o.quantity,
      per: o.per,
      to: o.to?.containerId ? `container:${o.to.containerId}` : o.to?.placeId ? `place:${o.to.placeId}` : null,
      keep: { lotId: o.lotId },
    })) ?? [],
  );
  const [tools, setTools] = useState<string[]>(planned?.tools.map((t) => t.equipmentId) ?? []);
  const [doers, setDoers] = useState<string[]>(planned?.doers.map((d) => d.personId) ?? []);
  const [purposes, setPurposes] = useState<TreatmentPurpose[]>(planned?.purposes ?? []);
  const [notes, setNotes] = useState(planned?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const article = (id: string | null) => articles.find((a) => a.id === id);
  const inputKinds = procedure?.inputKinds ?? [];
  const outputKinds = procedure?.outputKinds ?? [];
  const articleOptions = (kinds: string[], suggested: string[]) =>
    withSuggestions(
      articles.filter((a) => kinds.includes(a.kind)).map((a) => ({ value: a.id, label: a.amm ? `${a.name} — AMM ${a.amm}` : a.name })),
      suggested,
    );

  // Procédures : celles de la ferme d'abord (par usage), puis par catégorie.
  const used = catalogue.items.filter((p) => p.usage > 0).sort((a, b) => b.usage - a.usage);
  const procedureOptions = [
    ...(used.length ? [{ group: "Habituelles", items: used.map((p) => ({ value: p.code, label: p.label })) }] : []),
    ...Object.entries(CATEGORY_LABELS).map(([category, group]) => ({
      group,
      items: catalogue.items
        .filter((p) => p.category === category && p.usage === 0)
        .map((p) => ({ value: p.code, label: p.label }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    })),
  ].filter((g) => g.items.length > 0);

  const destinations = [
    { group: "Cuves", items: snapshot.containers.map((c) => ({ value: `container:${c.id}`, label: c.name })) },
    { group: "Lieux", items: snapshot.places.map((p) => ({ value: `place:${p.id}`, label: p.name })) },
  ].filter((g) => g.items.length > 0);

  const chooseProcedure = (next: string | null) => {
    setCode(next);
    const p = catalogue.items.find((x) => x.code === next);
    if (!p) return;
    // Lignes de saisie selon la forme ; on ne garde que ce qui reste pertinent.
    setInputs((rows) => (p.inputKinds.length === 0 ? [] : rows.length ? rows : [emptyRow(p.shape === "harvest" ? "total" : "hectare")]));
    setOutputs((rows) => (p.outputKinds.length === 0 ? [] : rows.length ? rows : [emptyRow("total")]));
    if (p.shape !== "treatment") setPurposes([]);
    if (tools.length === 0) setTools(p.suggestions.tools.slice(0, 1));
    if (doers.length === 0) setDoers(p.suggestions.doers.slice(0, 1));
  };

  const body = () => {
    const quantity = (rows: QuantityRow[]) => rows.filter((r) => r.articleId && r.quantity !== "");
    const location = (to: string | null) => {
      if (!to) return undefined;
      const [kind, id] = to.split(":");
      return kind === "container" ? { containerId: id! } : { placeId: id! };
    };
    return {
      periods: periods.map((p) => ({ startedAt: toIso(p.startedAt), stoppedAt: toIso(p.stoppedAt) })),
      targets:
        shape === "maintenance"
          ? maintained.map((id) => ({ kind: "equipment" as const, id }))
          : parcels.map((id): InterventionTarget => {
              const extra = targetExtras.get(id);
              return {
                kind: "land_parcel",
                id,
                ...(extra?.workedAreaM2 ? { workedAreaM2: extra.workedAreaM2 } : {}),
                ...(extra?.workingZone ? { workingZone: extra.workingZone } : {}),
              };
            }),
      inputs: quantity(inputs).map((r) => ({
        articleId: r.articleId!,
        quantity: Number(r.quantity),
        per: r.per,
        ...(r.keep?.lotId ? { lotId: r.keep.lotId } : {}),
        ...(r.keep?.from ? { from: r.keep.from } : {}),
      })),
      outputs: quantity(outputs).map((r) => ({
        articleId: r.articleId!,
        quantity: Number(r.quantity),
        per: r.per,
        ...(r.keep?.lotId ? { lotId: r.keep.lotId } : {}),
        ...(r.to ? { to: location(r.to) } : {}),
      })),
      tools: tools.map((equipmentId) => ({ equipmentId })),
      doers: doers.map((personId) => ({ personId })),
      purposes,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      compliance: { usages: usageChoices, ...(overrideReason.trim() ? { reason: overrideReason.trim() } : {}) },
      ...(weather ? { weather } : {}),
    } satisfies InterventionCompleteWrite;
  };

  // Brouillon soumis au contrôle réglementaire (produits phyto seulement).
  const phytoIds = new Set(articles.filter((a) => a.kind === "phyto").map((a) => a.id));
  let draft: ComplianceDraft | null = null;
  if (code && inputKinds.includes("phyto")) {
    try {
      const full = body();
      draft = {
        procedure: code,
        periods: completing ? full.periods : [],
        plannedAt: completing ? undefined : full.periods[0]?.startedAt,
        targets: full.targets,
        inputs: full.inputs.filter((i) => phytoIds.has(i.articleId)).map(({ articleId, quantity, per }) => ({ articleId, quantity, per })),
        compliance: { usages: usageChoices },
      };
    } catch {
      draft = null; // date en cours de saisie
    }
  }
  let weatherRequest: WeatherRequestDraft | null = null;
  if (code) {
    try {
      const full = body();
      weatherRequest = completing
        ? { periods: full.periods, targets: full.targets }
        : { periods: [], plannedAt: full.periods[0]?.startedAt, targets: full.targets };
    } catch {
      weatherRequest = null; // date en cours de saisie
    }
  }
  const complianceCheck = useComplianceCheck(farmId, draft, editing?.id ?? toComplete?.id);
  const compliance = complianceCheck.result;
  const chooseUsage = (articleId: string, usageId: string | null) =>
    setUsageChoices((m) => {
      const next = { ...m };
      if (usageId) next[articleId] = usageId;
      else delete next[articleId];
      return next;
    });
  const dangers = (compliance?.checks ?? []).flatMap((c) => c.indicators.filter((i) => i.level === "danger").map((i) => i.message));

  const submit = useMutation({
    mutationFn: async () => {
      const full = body();
      if (editing) {
        const write = {
          procedure: code,
          ...full,
          ...(correcting ? {} : { periods: [], plannedAt: full.periods[0]?.startedAt }),
          correctionId,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        };
        const r = await api.put<InterventionUpdateResult>(farmPath(farmId, `/interventions/${editing.id}`), write);
        return { warnings: r.warnings, id: editing.id };
      }
      const id = planned?.id ?? crypto.randomUUID();
      if (!planned) {
        // Réalisée d'emblée : on crée l'intervention puis on la réalise avec tout son contenu.
        await api.post<Intervention>(
          farmPath(farmId, "/interventions"),
          mode === "planned"
            ? { id, procedure: code, ...full, periods: [], plannedAt: full.periods[0]?.startedAt }
            : { id, procedure: code },
        );
      }
      if (completing) {
        const r = await api.post<{ warnings: string[] }>(farmPath(farmId, `/interventions/${id}/complete`), full);
        return { warnings: r.warnings, id };
      }
      return { warnings: [] as string[], id };
    },
    onSuccess: (r) => {
      for (const w of r.warnings) notifications.show({ color: "paille", title: "À vérifier", message: w, autoClose: 10_000 });
      notifications.show({
        color: "lichen",
        message: editing ? (correcting ? "Intervention corrigée." : "Intervention modifiée.") : completing ? "Intervention enregistrée." : "Intervention planifiée.",
      });
      invalidateAfterIntervention(queryClient);
      onDone(r.id);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  const quantityRows = (
    kind: "input" | "output",
    rows: QuantityRow[],
    setRows: (rows: QuantityRow[]) => void,
    options: ReturnType<typeof articleOptions>,
  ) =>
    rows.map((row, i) => {
      const a = article(row.articleId);
      const update = (patch: Partial<QuantityRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
      return (
        <Stack key={i} gap={6}>
          <Group align="flex-end" wrap="nowrap">
            <Select
              label={i === 0 ? "Produit" : undefined}
              aria-label="Produit"
              searchable
              style={{ flex: 2 }}
              data={options}
              value={row.articleId}
              onChange={(v) => update({ articleId: v })}
            />
            <NumberInput
              label={i === 0 ? "Quantité" : undefined}
              aria-label="Quantité"
              min={0}
              decimalScale={3}
              decimalSeparator=","
              style={{ flex: 1 }}
              value={row.quantity}
              onChange={(v) => update({ quantity: v === "" ? "" : Number(v) })}
            />
            <SegmentedControl
              aria-label="Quantité par"
              size="xs"
              value={row.per}
              onChange={(v) => update({ per: v as QuantityPer })}
              data={[
                { value: "hectare", label: a ? `${unitLabel(a.unit)}/ha` : "par ha" },
                { value: "total", label: a ? `${unitLabel(a.unit)} au total` : "total" },
              ]}
            />
            <ActionIcon
              variant="subtle"
              color="brique"
              aria-label={kind === "input" ? "Retirer l'intrant" : "Retirer la sortie"}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} />
            </ActionIcon>
          </Group>
          {kind === "input" && row.per === "hectare" && a && row.quantity !== "" && treatedM2 > 0 && (
            <Text size="xs" c="dimmed" className="lv-num">
              ≈ {(Number(row.quantity) * (treatedM2 / 10_000)).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} {unitLabel(a.unit)} au total sur{" "}
              {formatHa(treatedM2)}
            </Text>
          )}
          {kind === "input" && row.articleId && compliance?.checks.find((c) => c.articleId === row.articleId) && (
            <Paper withBorder p="xs" bg="var(--mantine-color-body)">
              <TreatmentCheckView check={compliance.checks.find((c) => c.articleId === row.articleId)!} onUsage={chooseUsage} withName={false} />
            </Paper>
          )}
          {kind === "output" && completing && (
            <Select
              aria-label="Destination"
              placeholder="Rangée où ? (cuve ou lieu)"
              data={destinations}
              value={row.to}
              onChange={(v) => update({ to: v })}
              clearable
            />
          )}
        </Stack>
      );
    });

  // Conditions de pulvérisation autour du début : le jour même (observées) pour un
  // traitement passé, les 3 jours à partir du jour prévu pour un traitement à venir.
  const sprayWindow = (() => {
    const t = new Date(periods[0]?.startedAt ?? "");
    if (Number.isNaN(t.getTime())) return null;
    const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const today = new Date();
    const sameDay = midnight.getTime() === new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (sameDay) return { from: undefined, days: 3 };
    return midnight.getTime() < today.getTime() ? { from: midnight.toISOString(), days: 1 } : { from: midnight.toISOString(), days: 3 };
  })();

  const aside = (
    <Stack gap="md" style={{ position: "sticky", top: 16 }}>
      {shape === "treatment" && sprayWindow && <SprayingConditions farmId={farmId} from={sprayWindow.from} days={sprayWindow.days} />}
      {procedure && shape !== "maintenance" && parcelMode === "map" && (
        <Paper withBorder p="xs" aria-label="Carte des parcelles">
          <MapBoundary>
            <Suspense fallback={<Loader size="sm" />}>
              <ParcelPicker
                parcels={[...parcelShapes.values()]}
                selected={parcels}
                zones={targetExtras}
                onSelect={setParcels}
                onZones={(found) => {
                  setTargetExtras((m) => {
                    const next = new Map(m);
                    for (const z of found) next.set(z.parcelId, { workedAreaM2: z.areaM2, workingZone: z.zone as InterventionTarget["workingZone"] });
                    return next;
                  });
                  setParcels((current) => [...new Set([...current, ...found.map((z) => z.parcelId)])]);
                }}
                onClearZone={(id) =>
                  setTargetExtras((m) => {
                    const next = new Map(m);
                    next.delete(id);
                    return next;
                  })
                }
              />
            </Suspense>
          </MapBoundary>
        </Paper>
      )}
      <ComplianceSummary check={complianceCheck} />
    </Stack>
  );

  return (
    <form
      aria-label="Saisie de l'intervention"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!code) return setError("Choisissez une intervention.");
        if (periods.some((p) => !p.startedAt || (completing && !p.stoppedAt))) return setError("Renseignez les dates.");
        // Feu rouge sur une réalisation : motif obligatoire (alerte + motif).
        if (completing && dangers.length > 0 && overrideReason.trim().length < 3) return setAskOverride(true);
        submit.mutate();
      }}
    >
      <Grid>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack>
            <Select
              label="Intervention"
              data={procedureOptions}
              value={code}
              onChange={chooseProcedure}
              renderOption={({ option }) => (
                <Group gap={8} wrap="nowrap">
                  <ProcedureIcon procedure={option.value} />
                  <span>{option.label}</span>
                </Group>
              )}
              leftSection={code ? <ProcedureIcon procedure={code} /> : undefined}
              searchable
              required
              disabled={Boolean(toComplete)}
            />
            {correcting && (
              <Alert color="ardoise" variant="light" title="Correction tracée">
                Les mouvements de stock de cette intervention sont repris puis repassés avec les nouvelles valeurs ; le registre phyto suit.
                L'historique garde la version d'avant.
              </Alert>
            )}
            {!planned && (
              <Stack gap={2}>
                <SegmentedControl
                  aria-label="Type"
                  value={mode}
                  onChange={(v) => setMode(v as "done" | "planned")}
                  data={[
                    { value: "done", label: "Réalisée" },
                    { value: "planned", label: "À planifier" },
                  ]}
                />
                <Text size="xs" c="dimmed">
                  Déduit du début : passé, réalisée ; à venir, à planifier.
                </Text>
              </Stack>
            )}

            {completing ? (
              <>
                {periods.map((p, i) => (
                  <Group key={i} grow align="flex-end" wrap="nowrap">
                    <TextInput
                      type="datetime-local"
                      label={i === 0 ? "Début" : undefined}
                      aria-label="Début"
                      value={p.startedAt}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        setPeriods(periods.map((x, j) => (j === i ? withStart(x, v) : x)));
                        if (i === 0) followStart(v);
                      }}
                      required
                    />
                    <DurationInput
                      label={i === 0 ? "Durée" : undefined}
                      minutes={durationMinutes(p)}
                      onChange={(m) => setPeriods(periods.map((x, j) => (j === i ? withDuration(x, m) : x)))}
                    />
                    <TextInput
                      type="datetime-local"
                      label={i === 0 ? "Fin" : undefined}
                      aria-label="Fin"
                      value={p.stoppedAt}
                      onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, stoppedAt: e.currentTarget.value } : x)))}
                      required
                    />
                    {periods.length > 1 && (
                      <ActionIcon variant="subtle" color="brique" aria-label="Retirer la période" style={{ flex: "none" }} onClick={() => setPeriods(periods.filter((_, j) => j !== i))}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                ))}
                <Button
                  variant="subtle"
                  size="xs"
                  leftSection={<Plus size={14} />}
                  onClick={() => {
                    const day = periods.at(-1)!.startedAt.slice(0, 10);
                    setPeriods([...periods, { startedAt: `${day}T14:00`, stoppedAt: `${day}T17:00` }]);
                  }}
                >
                  Ajouter une période de travail
                </Button>
              </>
            ) : (
              <TextInput
                type="datetime-local"
                label="Date prévue"
                aria-label="Date prévue"
                value={periods[0]!.startedAt}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setPeriods([withStart(periods[0]!, v)]);
                  followStart(v);
                }}
                required
              />
            )}

            {procedure &&
              (shape === "maintenance" ? (
                <MultiSelect
                  label="Matériels entretenus"
                  searchable
                  data={snapshot.equipments.map((e) => ({ value: e.id, label: e.name }))}
                  value={maintained}
                  onChange={setMaintained}
                />
              ) : (
                <Stack gap={6}>
                  <Group justify="space-between" align="flex-end">
                    <Text size="sm" fw={500}>
                      Parcelles{" "}
                      {parcels.length > 0 && (
                        <Text span size="xs" c="dimmed" className="lv-num">
                          · {parcels.length} parcelle(s), {formatHa(treatedM2)} traités
                        </Text>
                      )}
                    </Text>
                    <SegmentedControl
                      size="xs"
                      aria-label="Choix des parcelles"
                      value={parcelMode}
                      onChange={(v) => setParcelMode(v as "list" | "map")}
                      data={[
                        { value: "list", label: "Liste" },
                        { value: "map", label: "Carte" },
                      ]}
                    />
                  </Group>
                  <MultiSelect
                    aria-label="Parcelles"
                    searchable
                    data={snapshot.landParcels.map((p) => ({ value: p.id, label: `${p.name} (${formatHa(p.version.areaM2)})` }))}
                    value={parcels}
                    onChange={setParcels}
                  />
                  {parcelActivities.length > 0 && (
                    <Group gap="md" aria-label="Activités des parcelles">
                      {parcelActivities.map(({ activity, count }) => (
                        <Group key={activity.id} gap={4} wrap="nowrap">
                          <ActivityBadge activity={activity} size={22} />
                          <Text size="xs" c="dimmed">
                            ({count})
                          </Text>
                        </Group>
                      ))}
                      {inputKinds.includes("phyto") && (
                        <Text size="xs" c="dimmed">
                          Les usages phytosanitaires proposés suivent l'activité des parcelles.
                        </Text>
                      )}
                    </Group>
                  )}
                </Stack>
              ))}

            {inputKinds.length > 0 && (
              <>
                <Divider label="Intrants" labelPosition="left" />
                {quantityRows("input", inputs, setInputs, articleOptions(inputKinds, procedure!.suggestions.inputs))}
                <Button variant="subtle" size="xs" leftSection={<Plus size={14} />} onClick={() => setInputs([...inputs, emptyRow("hectare")])}>
                  Ajouter un intrant
                </Button>
              </>
            )}

            {outputKinds.length > 0 && (
              <>
                <Divider label={shape === "harvest" ? "Récolte" : "Sorties"} labelPosition="left" />
                {quantityRows("output", outputs, setOutputs, articleOptions(outputKinds, []))}
                <Button variant="subtle" size="xs" leftSection={<Plus size={14} />} onClick={() => setOutputs([...outputs, emptyRow("total")])}>
                  Ajouter une sortie
                </Button>
              </>
            )}

            {shape === "treatment" && (
              <MultiSelect
                label="Motifs (facultatif)"
                data={Object.entries(catalogue.purposes).map(([value, label]) => ({ value, label }))}
                value={purposes}
                onChange={(v) => setPurposes(v as TreatmentPurpose[])}
              />
            )}

            {procedure && <WeatherFields farmId={farmId} request={weatherRequest} value={weather} onChange={setWeather} />}

            {procedure && (
              <>
                <Divider label="Moyens" labelPosition="left" />
                <MultiSelect
                  label="Matériels"
                  searchable
                  data={withSuggestions(snapshot.equipments.map((e) => ({ value: e.id, label: e.name })), procedure.suggestions.tools)}
                  value={tools}
                  onChange={setTools}
                />
                <MultiSelect
                  label="Intervenants"
                  searchable
                  data={withSuggestions(
                    people.filter((p) => p.active || doers.includes(p.id)).map((p) => ({ value: p.id, label: p.role ? `${p.name} (${p.role})` : p.name })),
                    procedure.suggestions.doers,
                  )}
                  value={doers}
                  onChange={setDoers}
                  nothingFoundMessage="Aucune personne — à ajouter dans Équipe"
                />
                <Textarea label="Notes" autosize minRows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
              </>
            )}

            {error && (
              <Alert color="brique" title="Enregistrement refusé">
                {error}
              </Alert>
            )}
            {inputKinds.length > 0 && (
              <Text size="xs" c="dimmed">
                Une quantité par hectare est multipliée par la surface traitée à la date de l'intervention ; le stock et le registre phyto se mettent à jour.
              </Text>
            )}
            {editing && (
              <TextInput
                label={correcting ? "Motif de la correction (facultatif)" : "Motif de la modification (facultatif)"}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
            )}
            <Button type="submit" loading={submit.isPending}>
              {editing ? (correcting ? "Enregistrer la correction" : "Enregistrer les modifications") : planned ? "Enregistrer la réalisation" : mode === "planned" ? "Planifier" : "Enregistrer"}
            </Button>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>{aside}</Grid.Col>
      </Grid>
      <Modal opened={askOverride} onClose={() => setAskOverride(false)} title="Feu rouge réglementaire" size="lg">
        <Stack>
          <Alert color="brique" variant="light">
            <Stack gap={4}>
              {dangers.map((d, k) => (
                <Text key={k} size="sm">
                  {d}
                </Text>
              ))}
            </Stack>
          </Alert>
          <Text size="sm">
            Pour enregistrer quand même, indiquez le motif. Il reste attaché à l'intervention, visible sur sa fiche.
          </Text>
          <Textarea
            label="Motif"
            required
            autosize
            minRows={2}
            maxLength={500}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAskOverride(false)}>
              Revenir à la saisie
            </Button>
            <Button
              color="brique"
              disabled={overrideReason.trim().length < 3}
              loading={submit.isPending}
              onClick={() => {
                setAskOverride(false);
                submit.mutate();
              }}
            >
              Enregistrer malgré tout
            </Button>
          </Group>
        </Stack>
      </Modal>
    </form>
  );
}

/**
 * Durée d'une période (« 2 h 30 », « 2,5 », « 45 min ») : la fin se calcule
 * en quittant le champ (ou avec Entrée).
 */
function DurationInput({ label, minutes, onChange }: { label?: string; minutes: number | null; onChange: (minutes: number) => void }) {
  const shown = minutes === null ? "" : formatDuration(minutes);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const m = parseDuration(text);
    if (m === null) setText(shown);
    else if (m !== minutes) onChange(m);
  };
  return (
    <TextInput
      label={label}
      aria-label="Durée"
      placeholder="2 h 30"
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      style={{ flex: "0 0 7rem" }}
    />
  );
}
