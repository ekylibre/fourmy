import { lazy, Suspense, useState } from "react";
import type { MaintenanceNature, TrackDraft } from "@fourmy/contracts";
import { draftFrom, draftNature, maintenanceBody, MaintenanceAside, MaintenanceFields, type MaintenanceDraft } from "../maintenance/MaintenanceFields";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { isIrrigation } from "@fourmy/contracts";
import { irrigationBody, irrigationDraft, IrrigationFields, type IrrigationDraft } from "./IrrigationFields";
import { kgN, nitrogenNote, useFertilizers } from "../fertilization/fertilization";
import type { FertilizationCheckRequest } from "@fourmy/contracts";
import { NitrogenLine } from "../fertilization/NitrogenLine";
import { FertilizationSummary, useFertilizationCheck, weatherExtremes } from "../fertilization/FertilizationChecks";
import { api, ApiError, farmPath } from "../../app/api";
import { unitLabel } from "../../app/labels";
import { invalidateAfterIntervention, useActivities, useCrewTemplates, useEquipments, usePhytoArticles } from "../../app/queries";
import { useFarm } from "../../app/farm";
import { RegulatoryPictos } from "../phyto/Hazards";
import { PrecautionsPanel } from "../phyto/Precautions";
import { crewRules, dangerMessages, inputUnitChoices, mergePeriods, toFree } from "@fourmy/domain";
import { ActivityBadge, activityOfParcel } from "../activities/ActivityBadge";
import { MapBoundary } from "../../components/MapBoundary";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { treatedAreaM2 } from "./zones";
import { withStart } from "./periods";
import { bbchOptionLabel, useBbchStages } from "../reference/phyto-reference";
import { CrewsEditor, CrewsSummary, PeriodsEditor, crewRowsOf, crewsBody, newCrew, toLocal, type CrewRow } from "./Crews";
import { ComplianceSummary, TreatmentCheckView, useComplianceCheck, type ComplianceDraft } from "./CompliancePanel";
import type { Activity, InterventionWeather } from "@fourmy/contracts";
import type { FeatureCollection, Geometry } from "geojson";
import { SprayingConditions, WeatherFields, type WeatherRequestDraft } from "../weather/Weather";

// La carte (MapLibre, terra-draw) n'est chargée qu'en mode « Carte ».
const ParcelPicker = lazy(() => import("./ParcelPicker").then((m) => ({ default: m.ParcelPicker })));

/** Ligne de quantité ; `keep` garde ce que le formulaire n'affiche pas (lot, lieu de prélèvement). */
type QuantityRow = {
  articleId: string | null;
  quantity: number | "";
  per: QuantityPer;
  /** Unité de saisie d'un fertilisant, si autre que celle de l'article (kg d'un engrais stocké en tonnes…). */
  unit?: string;
  to: string | null;
  keep?: { lotId?: string; from?: InterventionInput["from"] };
  /** Entretien : matériel qui reçoit la pièce ou le fluide. */
  equipmentId?: string;
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
  /** Nouvelle intervention pré-remplie (depuis une échéance d'entretien, une anomalie). */
  initial?: FormInitial;
}

export interface FormInitial {
  procedure?: string;
  /** Irrigation : dose proposée (mm), depuis le modèle de croissance. */
  depthMm?: number;
  equipmentId?: string;
  operationIds?: string[];
  mode?: "planned" | "done";
  nature?: MaintenanceNature | null;
  problem?: string;
  /** Parcelles ciblées (signalement satellite d'une récolte probable, lot Z). */
  landParcelIds?: string[];
  /** Brouillon tiré de parcours GPS (lot P) : attelage, périodes, cibles, parcours à rattacher. */
  trackDraft?: TrackDraft;
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
export function InterventionForm({ farmId, snapshot, articles, people, catalogue, planned: toComplete, editing, defaultDay, onDone, initial }: InterventionFormProps) {
  const queryClient = useQueryClient();
  // Formulaire prérempli : intervention à réaliser ou à modifier.
  const planned = toComplete ?? editing;
  const correcting = editing?.status === "done";
  const [correctionId] = useState(() => crypto.randomUUID());
  // Identifiant tiré une fois par formulaire : un second envoi (double clic,
  // Entrée répétée) retombe sur la même intervention au lieu d'en créer une autre.
  const [newId] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  // Contrôle réglementaire : cible (usage E-Phy) choisie par produit, dernier résultat, motif d'un feu rouge.
  const [usageChoices, setUsageChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(((toComplete ?? editing)?.compliance?.checks ?? []).filter((c) => c.usageId).map((c) => [c.articleId, c.usageId!])),
  );
  const [overrideReason, setOverrideReason] = useState((toComplete ?? editing)?.compliance?.reason ?? "");
  const [askOverride, setAskOverride] = useState(false);
  // Météo pendant l'intervention : pré-remplie (fournisseur), modifiable.
  const [weather, setWeather] = useState<InterventionWeather | null>((toComplete ?? editing)?.weather ?? null);
  const [code, setCode] = useState<string | null>(planned?.procedure ?? initial?.procedure ?? null);
  const procedure: ProcedureCatalogueItem | undefined = catalogue.items.find((p) => p.code === code);
  const shape = procedure?.shape;
  const start = planned?.startedAt ? local(planned.startedAt) : `${defaultDay}T08:00`;
  // Nouvelle intervention : réalisée si son début est passé, à planifier sinon (modifiable).
  const fromTracks = planned ? undefined : initial?.trackDraft;
  const [mode, setMode] = useState<"done" | "planned">(() => initial?.mode ?? (fromTracks ? "done" : undefined) ?? (!planned && new Date(start).getTime() > Date.now() ? "planned" : "done"));
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
  const [parcels, setParcels] = useState<string[]>(
    planned?.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id) ?? fromTracks?.body.targets.map((t) => t.id) ?? initial?.landParcelIds ?? [],
  );
  const [maintained, setMaintained] = useState<string[]>(
    planned?.targets.filter((t) => t.kind === "equipment").map((t) => t.id) ?? (initial?.equipmentId ? [initial.equipmentId] : []),
  );
  // Entretien (lot K) : relevés, opérations du plan, nature, problème, atelier.
  const [maint, setMaint] = useState<MaintenanceDraft>(() => draftFrom(planned, initial));
  // Irrigation (lot AC) : dose d'eau et matériel.
  const [irrigation, setIrrigation] = useState<IrrigationDraft>(() =>
    planned?.irrigation ? irrigationDraft(planned.irrigation) : irrigationDraft(initial?.depthMm ? { depthMm: initial.depthMm } : null),
  );
  const equipmentList = useEquipments(farmId);
  const farmRole = useFarm().role;
  const crewTemplates = useCrewTemplates(farmId);
  // Surface travaillée et zone de travail des cibles : conservées telles quelles.
  // Surface travaillée et zone de travail des cibles : conservées, ou dessinées sur la carte.
  const [targetExtras, setTargetExtras] = useState(
    () =>
      new Map<string, { workedAreaM2?: number; workingZone?: InterventionTarget["workingZone"] }>(
        (planned?.targets ?? fromTracks?.body.targets ?? []).map((t) => [
          t.id,
          { workedAreaM2: t.workedAreaM2, workingZone: t.workingZone as InterventionTarget["workingZone"] },
        ]),
      ),
  );
  const [parcelMode, setParcelMode] = useState<"list" | "map">("list");
  const parcelShapes = new Map(
    snapshot.landParcels.map((p) => [p.id, { id: p.id, name: p.name, shape: p.version.shape as unknown as import("@fourmy/carto").Area, areaM2: p.version.areaM2 }]),
  );
  const treatedM2 = treatedAreaM2(parcels, parcelShapes, targetExtras);
  // Activité des parcelles choisies (production de la campagne) : désigne la culture contrôlée.
  const activities = useActivities(farmId, Number(snapshot.at.slice(0, 4)));
  const phytoArticles = usePhytoArticles(farmId);
  const parcelActivities = [
    ...parcels
      .map((id) => activityOfParcel(id, snapshot.productions, activities.data?.items))
      .filter((a): a is Activity => a !== null)
      .reduce((m, a) => m.set(a.id, { activity: a, count: (m.get(a.id)?.count ?? 0) + 1 }), new Map<string, { activity: Activity; count: number }>())
      .values(),
  ];
  const [inputs, setInputs] = useState<QuantityRow[]>(
    planned?.inputs.map((i) => ({ articleId: i.articleId, quantity: i.quantity, per: i.per, unit: i.unit, to: null, keep: { lotId: i.lotId, from: i.from }, equipmentId: i.equipmentId })) ?? [],
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
  // Moyens (lot N4) : mode libre (comme avant), ou attelages avec leurs périodes.
  const [staffing, setStaffing] = useState<"free" | "crews">((planned?.staffing === "crews" && planned.crews.length) || fromTracks ? "crews" : "free");
  const [crews, setCrews] = useState<CrewRow[]>(() =>
    planned?.staffing === "crews"
      ? crewRowsOf(planned.crews)
      : fromTracks
        ? fromTracks.body.crews.map((c) =>
            newCrew({
              tools: c.tools.map((t) => t.equipmentId),
              doers: c.doers.map((d) => d.personId),
              periods: c.periods.map((p) => ({ startedAt: toLocal(p.startedAt), stoppedAt: toLocal(p.stoppedAt) })),
            }),
          )
        : [],
  );
  const [freeLosses, setFreeLosses] = useState<string[] | null>(null);
  const inCrews = staffing === "crews" && shape !== "maintenance";
  /** Périodes de l'intervention : celles du mode libre, ou la réunion de celles des attelages (heure locale). */
  const allPeriods = inCrews
    ? crews
        .flatMap((c) => c.periods)
        .filter((p) => p.startedAt)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    : periods;
  const [purposes, setPurposes] = useState<TreatmentPurpose[]>(planned?.purposes ?? []);
  const [notes, setNotes] = useState(planned?.notes ?? "");
  // Stade BBCH (registre phyto réglementaire, lot X) : stades de la culture des parcelles choisies.
  const [bbch, setBbch] = useState<string | null>(planned?.bbch?.code ?? null);
  const [error, setError] = useState<string | null>(null);

  // Échéances lues au jour de l'intervention.
  const maintenanceAt = (() => {
    const d = allPeriods[0]?.startedAt?.slice(0, 10);
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59.000Z` : snapshot.at;
  })();
  const article = (id: string | null) => articles.find((a) => a.id === id);
  // Azote apporté par les fertilisants (lot AE) : composition enregistrée, analyse ou proposition.
  const fertilizers = useFertilizers(farmId, inputs.some((r) => article(r.articleId)?.kind === "fertilizer"));
  const inputDay = maintenanceAt.slice(0, 10);
  const nitrogenOf = (row: QuantityRow) => {
    const a = article(row.articleId);
    if (!a || row.quantity === "") return null;
    return nitrogenNote(fertilizers.data?.get(a.id), { quantity: Number(row.quantity), per: row.per, unit: row.unit ?? a.unit }, treatedM2 > 0 ? treatedM2 / 10_000 : null, inputDay);
  };
  // Unités de saisie d'un fertilisant : la sienne, ses voisines, le volume ou la masse si la densité est connue.
  const unitChoices = (a: ReturnType<typeof article>) =>
    a?.kind === "fertilizer" ? inputUnitChoices(a.unit, fertilizers.data?.get(a.id)?.composition?.density ?? null) : a ? [a.unit] : [];
  const nitrogenTotal = inputs.reduce((s, r) => {
    const n = nitrogenOf(r);
    return n?.ok ? s + n.totalKgHa : s;
  }, 0);
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
    if (p.shape === "maintenance") setTools([]);
    else if (tools.length === 0) setTools(p.suggestions.tools.slice(0, 1));
    if (doers.length === 0) setDoers(p.suggestions.doers.slice(0, 1));
    setCrews((rows) =>
      rows.map((c, k) =>
        k === 0 ? { ...c, tools: c.tools.length ? c.tools : p.suggestions.tools.slice(0, 1), doers: c.doers.length ? c.doers : p.suggestions.doers.slice(0, 1) } : c,
      ),
    );
  };

  const body = () => {
    const quantity = (rows: QuantityRow[]) => rows.filter((r) => r.articleId && r.quantity !== "");
    const location = (to: string | null) => {
      if (!to) return undefined;
      const [kind, id] = to.split(":");
      return kind === "container" ? { containerId: id! } : { placeId: id! };
    };
    return {
      periods: inCrews ? [] : periods.map((p) => ({ startedAt: toIso(p.startedAt), stoppedAt: toIso(p.stoppedAt) })),
      targets:
        shape === "maintenance"
          ? maintained.map((id) => ({
              kind: "equipment" as const,
              id,
              ...(completing && maint.meters[id] !== undefined && maint.meters[id] !== "" ? { meter: { value: Number(maint.meters[id]) } } : {}),
            }))
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
        ...(r.unit && r.unit !== article(r.articleId)?.unit && unitChoices(article(r.articleId)).includes(r.unit) ? { unit: r.unit } : {}),
        ...(r.keep?.lotId ? { lotId: r.keep.lotId } : {}),
        ...(r.keep?.from ? { from: r.keep.from } : {}),
        ...(shape === "maintenance" && r.equipmentId && maintained.includes(r.equipmentId) ? { equipmentId: r.equipmentId } : {}),
      })),
      outputs: quantity(outputs).map((r) => ({
        articleId: r.articleId!,
        quantity: Number(r.quantity),
        per: r.per,
        ...(r.keep?.lotId ? { lotId: r.keep.lotId } : {}),
        ...(r.to ? { to: location(r.to) } : {}),
      })),
      tools: shape === "maintenance" || inCrews ? [] : tools.map((equipmentId) => ({ equipmentId })),
      ...(shape === "maintenance" ? { maintenance: maintenanceBody(maint, maintained) } : {}),
      ...(code && isIrrigation(code) && irrigationBody(irrigation) ? { irrigation: irrigationBody(irrigation) } : {}),
      doers: inCrews ? [] : doers.map((personId) => ({ personId })),
      staffing: inCrews ? "crews" : "free",
      crews: inCrews ? crewsBody(crews) : [],
      purposes,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(shape === "treatment" ? { bbch } : {}),
      compliance: { usages: usageChoices, ...(overrideReason.trim() ? { reason: overrideReason.trim() } : {}) },
      ...(weather ? { weather } : {}),
      ...(fromTracks ? { trackSessionIds: fromTracks.body.trackSessionIds } : {}),
    } satisfies InterventionCompleteWrite;
  };

  /** Périodes à plat (ISO) : en attelages, réunion fusionnée de leurs périodes. */
  const flatPeriods = (full: ReturnType<typeof body>) => (inCrews ? mergePeriods(full.crews.flatMap((c) => c.periods)) : full.periods);

  // Brouillon soumis au contrôle réglementaire (produits phyto seulement).
  const phytoIds = new Set(articles.filter((a) => a.kind === "phyto").map((a) => a.id));
  let draft: ComplianceDraft | null = null;
  if (code && inputKinds.includes("phyto")) {
    try {
      const full = body();
      draft = {
        procedure: code,
        periods: completing ? flatPeriods(full) : [],
        plannedAt: completing ? undefined : flatPeriods(full)[0]?.startedAt,
        targets: full.targets,
        inputs: full.inputs.filter((i) => phytoIds.has(i.articleId)).map(({ articleId, quantity, per, equipmentId }) => ({ articleId, quantity, per, ...(equipmentId ? { equipmentId } : {}) })),
        compliance: { usages: usageChoices },
        // Attelages en cours de saisie (sans matériel ou sans période) : pas encore contrôlés.
        ...(inCrews && full.crews.length && full.crews.every((c) => c.tools.length && c.periods.length) ? { staffing: "crews" as const, crews: full.crews } : {}),
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
        ? { periods: flatPeriods(full), targets: full.targets }
        : { periods: [], plannedAt: flatPeriods(full)[0]?.startedAt, targets: full.targets };
    } catch {
      weatherRequest = null; // date en cours de saisie
    }
  }
  const complianceCheck = useComplianceCheck(farmId, draft, editing?.id ?? toComplete?.id);
  // Directive nitrates (lot AH) : calendrier, plan de fumure, premier apport.
  let fertDraft: FertilizationCheckRequest | null = null;
  if (code && parcels.length && inputs.some((r) => article(r.articleId)?.kind === "fertilizer" && r.quantity !== "")) {
    try {
      const full = body();
      const startedAt = flatPeriods(full)[0]?.startedAt;
      if (startedAt)
        fertDraft = {
          startedAt,
          parcelIds: parcels,
          inputs: full.inputs.filter((i) => article(i.articleId)?.kind === "fertilizer").map(({ articleId, quantity, per, unit }) => ({ articleId, quantity, per, ...(unit ? { unit } : {}) })),
          areaM2: treatedM2 > 0 ? treatedM2 : null,
          interventionId: editing?.id ?? null,
          // Conditions d'épandage (lot AJ) : gel et forte pluie d'après la météo de la saisie.
          weather: weather ? weatherExtremes(weather) : null,
        };
    } catch {
      fertDraft = null; // date en cours de saisie
    }
  }
  const fertilizationCheck = useFertilizationCheck(farmId, fertDraft);
  const compliance = complianceCheck.result;
  const chooseUsage = (articleId: string, usageId: string | null) =>
    setUsageChoices((m) => {
      const next = { ...m };
      if (usageId) next[articleId] = usageId;
      else delete next[articleId];
      return next;
    });
  const dangers = [
    ...(compliance ? dangerMessages(compliance) : []),
    // Directive nitrates (lot AI) : épandage en période d'interdiction, même motif que le phyto.
    ...(fertilizationCheck.result?.indicators ?? []).filter((i) => i.level === "danger").map((i) => `${i.parcelName ? `${i.parcelName} : ` : ""}${i.message}`),
  ];

  const submit = useMutation({
    mutationFn: async () => {
      const full = body();
      if (editing) {
        const write = {
          procedure: code,
          ...full,
          ...(correcting ? {} : { periods: [], plannedAt: flatPeriods(full)[0]?.startedAt }),
          correctionId,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        };
        const r = await api.put<InterventionUpdateResult>(farmPath(farmId, `/interventions/${editing.id}`), write);
        return { warnings: r.warnings, id: editing.id };
      }
      const id = planned?.id ?? newId;
      if (!planned) {
        // Réalisée d'emblée : on crée l'intervention puis on la réalise avec tout son contenu.
        await api.post<Intervention>(
          farmPath(farmId, "/interventions"),
          mode === "planned"
            ? { id, procedure: code, ...full, periods: [], plannedAt: flatPeriods(full)[0]?.startedAt }
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
      const units = kind === "input" ? unitChoices(a) : a ? [a.unit] : [];
      const unit = row.unit && units.includes(row.unit) ? row.unit : a?.unit;
      return (
        <Stack key={i} gap={6}>
          <Group align="flex-end" wrap="nowrap">
            <Select
              label={i === 0 ? "Produit" : undefined}
              aria-label="Produit"
              searchable
              selectFirstOptionOnChange
              style={{ flex: 2 }}
              data={options}
              value={row.articleId}
              onChange={(v) => update({ articleId: v, unit: undefined })}
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
            {units.length > 1 && (
              <Select
                aria-label="Unité"
                w={130}
                allowDeselect={false}
                data={units.map((u) => ({ value: u, label: unitLabel(u) }))}
                value={unit ?? null}
                onChange={(v) => update({ unit: v && v !== a?.unit ? v : undefined })}
              />
            )}
            <SegmentedControl
              aria-label="Quantité par"
              size="xs"
              value={row.per}
              onChange={(v) => update({ per: v as QuantityPer })}
              data={[
                { value: "hectare", label: unit ? `${unitLabel(unit)}/ha` : "par ha" },
                { value: "total", label: unit ? `${unitLabel(unit)} au total` : "total" },
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
              ≈ {(Number(row.quantity) * (treatedM2 / 10_000)).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} {unitLabel(unit ?? a.unit)} au total sur{" "}
              {formatHa(treatedM2)}
            </Text>
          )}
          {kind === "input" && <NitrogenLine note={nitrogenOf(row)} farmId={farmId} />}
          {kind === "input" && row.articleId && a?.kind === "phyto" && (
            <RegulatoryPictos
              article={phytoArticles.data?.items.find((x) => x.id === row.articleId)}
              zntM={compliance?.checks.find((c) => c.articleId === row.articleId)?.zntM ?? null}
              size={22}
            />
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
    const t = new Date(allPeriods[0]?.startedAt ?? "");
    if (Number.isNaN(t.getTime())) return null;
    const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const today = new Date();
    const sameDay = midnight.getTime() === new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (sameDay) return { from: undefined, days: 3 };
    return midnight.getTime() < today.getTime() ? { from: midnight.toISOString(), days: 1 } : { from: midnight.toISOString(), days: 3 };
  })();

  // Carte de saisie : eau autour de la ferme et bande de ZNT des parcelles choisies.
  const mapOpen = parcelMode === "map" && !!procedure && shape !== "maintenance";
  const farmWater = useQuery({
    queryKey: ["phyto-water", farmId],
    enabled: mapOpen,
    queryFn: () => api.get<FeatureCollection>(farmPath(farmId, "/phyto/water")),
    staleTime: 30 * 60_000,
  });
  const zntM = Math.max(0, ...(compliance?.checks ?? []).map((c) => c.zntM ?? 0));
  const bufferRequest =
    mapOpen && zntM > 0 && draft ? JSON.stringify({ targets: draft.targets, at: draft.plannedAt ?? draft.periods[0]?.startedAt, zntM }) : null;
  const zntBuffer = useQuery({
    queryKey: ["phyto-buffer", farmId, bufferRequest],
    enabled: !!bufferRequest,
    queryFn: () => api.post<{ buffer: Geometry | null }>(farmPath(farmId, "/phyto/water/buffer"), JSON.parse(bufferRequest!)),
    placeholderData: (prev) => prev,
  });
  const bufferLayer: FeatureCollection | undefined =
    bufferRequest && zntBuffer.data?.buffer ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: zntBuffer.data.buffer, properties: {} }] } : undefined;

  let crewSummary: React.ReactNode = null;
  try {
    crewSummary = inCrews ? <CrewsSummary crews={crewsBody(crews)} /> : null;
  } catch {
    crewSummary = null; // date en cours de saisie
  }
  // Règles des attelages, en direct (le serveur les applique aussi).
  const equipmentName = new Map(snapshot.equipments.map((e) => [e.id, e.name]));
  const personName = new Map(people.map((p) => [p.id, p.name]));
  let crewErrors: string[] = [];
  if (inCrews) {
    try {
      crewErrors = crewRules({ staffing: "crews", crews: crewsBody(crews) }, { equipment: (id) => equipmentName.get(id), person: (id) => personName.get(id) });
    } catch {
      crewErrors = [];
    }
  }
  const equipmentOptions = withSuggestions(snapshot.equipments.map((e) => ({ value: e.id, label: e.name })), procedure?.suggestions.tools ?? []);
  const peopleOptions = withSuggestions(
    people
      .filter((p) => p.active || doers.includes(p.id) || crews.some((c) => c.doers.includes(p.id)))
      .map((p) => ({ value: p.id, label: p.name })),
    procedure?.suggestions.doers ?? [],
  );
  /** Libre → attelages : un attelage avec tous les moyens et toutes les périodes (FR-ATT-4). */
  const switchToCrews = () => {
    setCrews([newCrew({ tools: [...tools], doers: [...doers], periods: periods.map((p) => ({ ...p })) })]);
    setStaffing("crews");
  };
  /** Attelages → libre : réunion des moyens et des périodes, après confirmation des pertes. */
  const switchToFree = (confirmed: boolean) => {
    let result: ReturnType<typeof toFree>;
    try {
      result = toFree({ crews: crewsBody(crews) });
    } catch {
      return setError("Renseignez les dates des attelages avant de changer de mode.");
    }
    if (!confirmed && result.losses.length) return setFreeLosses(result.losses);
    setTools(result.body.tools.map((t) => t.equipmentId));
    setDoers(result.body.doers.map((d) => d.personId));
    if (result.body.periods.length) setPeriods(result.body.periods.map((p) => ({ startedAt: toLocal(p.startedAt), stoppedAt: toLocal(p.stoppedAt) })));
    setCrews([]);
    setStaffing("free");
    setFreeLosses(null);
  };

  const aside = (
    <Stack gap="md" style={{ position: "sticky", top: 16 }}>
      {shape === "treatment" && sprayWindow && <SprayingConditions farmId={farmId} from={sprayWindow.from} days={sprayWindow.days} />}
      {shape === "maintenance" && <MaintenanceAside farmId={farmId} at={maintenanceAt} equipments={equipmentList.data?.items ?? []} selected={maintained} />}
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
                water={farmWater.data}
                buffer={bufferLayer}
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
      <PrecautionsPanel
        articles={[...new Set(inputs.map((r) => r.articleId))]
          .map((id) => phytoArticles.data?.items.find((a) => a.id === id))
          .filter((a): a is NonNullable<typeof a> => !!a)}
        compliance={compliance}
      />
      <ComplianceSummary check={complianceCheck} />
      <FertilizationSummary check={fertilizationCheck} />
    </Stack>
  );

  return (
    <form
      aria-label="Saisie de l'intervention"
      // Entrée dans un champ (liste de matériels, quantité…) n'envoie pas le
      // formulaire : seul le bouton l'envoie.
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "submit") e.preventDefault();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (submit.isPending) return;
        setError(null);
        if (!code) return setError("Choisissez une intervention.");
        if (inCrews ? crews.some((c) => c.periods.some((p) => !p.startedAt || !p.stoppedAt)) : periods.some((p) => !p.startedAt || (completing && !p.stoppedAt))) {
          return setError("Renseignez les dates.");
        }
        if (code && isIrrigation(code) && completing && !irrigationBody(irrigation)) return setError("Indiquez la dose d'eau apportée (mm).");
        if (shape === "maintenance" && completing && draftNature(maint) === "corrective" && !maint.problem.trim()) {
          return setError("Une réparation (entretien curatif) demande la description du problème.");
        }
        // Feu rouge sur une réalisation : motif obligatoire (alerte + motif).
        if (completing && dangers.length > 0 && overrideReason.trim().length < 3) return setAskOverride(true);
        submit.mutate();
      }}
    >
      <Grid>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack>
            <Divider label="1 · Intervention" labelPosition="left" />
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
              selectFirstOptionOnChange
              required
              disabled={Boolean(toComplete)}
            />
            {fromTracks && <TrackDraftBanner draft={fromTracks} catalogue={catalogue} chosen={code} onChoose={chooseProcedure} />}
            {correcting && (
              <Alert color="ardoise" variant="light" title="Correction tracée">
                Les mouvements de stock de cette intervention sont repris puis repassés avec les nouvelles valeurs ; le registre phyto suit.
                L'historique garde la version d'avant.
              </Alert>
            )}

            <Divider label="2 · Réalisation et moyens" labelPosition="left" />
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

            {procedure && shape !== "maintenance" && (
              <Stack gap={2}>
                <SegmentedControl
                  aria-label="Déclaration des moyens"
                  value={inCrews ? "crews" : "free"}
                  onChange={(v) => (v === "crews" ? switchToCrews() : switchToFree(false))}
                  data={[
                    { value: "free", label: "Libre" },
                    { value: "crews", label: "Attelages" },
                  ]}
                />
                <Text size="xs" c="dimmed">
                  {inCrews
                    ? "Chaque attelage : ses matériels, ses intervenants et ses propres périodes (deux tracteurs en même temps, par exemple)."
                    : "Matériels, intervenants et périodes indépendants."}
                </Text>
              </Stack>
            )}
            {!inCrews &&
              (completing ? (
                <PeriodsEditor periods={periods} onChange={setPeriods} onFirstStart={followStart} />
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
              ))}
            {procedure && (
              <>
                {inCrews ? (
                  <>
                    <CrewsEditor
                      crews={crews}
                      onChange={setCrews}
                      equipmentOptions={equipmentOptions}
                      peopleOptions={peopleOptions}
                      defaultDay={defaultDay}
                      errors={crewErrors}
                      templates={{ farmId, items: crewTemplates.data?.items ?? [], canWrite: farmRole === "owner" }}
                    />
                    {crewSummary}
                  </>
                ) : (
                  <>
                    {shape !== "maintenance" && <MultiSelect label="Matériels" searchable selectFirstOptionOnChange data={equipmentOptions} value={tools} onChange={setTools} />}
                    <MultiSelect
                      label="Intervenants"
                      searchable
                      selectFirstOptionOnChange
                      data={peopleOptions}
                      value={doers}
                      onChange={setDoers}
                      nothingFoundMessage="Aucune personne — à ajouter dans Équipe"
                    />
                  </>
                )}
              </>
            )}

            {procedure && <Divider label={shape === "maintenance" ? "3 · Matériel entretenu" : "3 · Parcelles et produits"} labelPosition="left" />}
            {procedure &&
              (shape === "maintenance" ? (
                <MaintenanceFields
                  farmId={farmId}
                  at={maintenanceAt}
                  equipments={equipmentList.data?.items ?? snapshot.equipments.map((e) => ({ ...e, state: e.state ?? null, brand: null, brandId: null, model: null, serialNumber: null, year: null, meterUnit: null, logoAssetId: null, logoSource: null, lastReading: null, tracked: false }))}
                  selected={maintained}
                  onSelect={setMaintained}
                  value={maint}
                  onChange={setMaint}
                  completing={completing}
                  prefill={!planned}
                  onParts={(parts) =>
                    setInputs((rows) => {
                      const kept = rows.filter((r) => r.articleId);
                      const added = parts
                        .filter((p) => !kept.some((r) => r.articleId === p.articleId && r.equipmentId === p.equipmentId))
                        .map((p): QuantityRow => ({ articleId: p.articleId, quantity: p.quantity, per: "total", to: null, equipmentId: p.equipmentId }));
                      return [...kept, ...added];
                    })
                  }
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
                    selectFirstOptionOnChange
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

            {code && isIrrigation(code) && (
              <>
                <Divider label="Irrigation" labelPosition="left" />
                <IrrigationFields value={irrigation} onChange={setIrrigation} areaM2={treatedM2} required={completing} />
              </>
            )}

            {inputKinds.length > 0 && (
              <>
                <Divider label={shape === "maintenance" ? "Pièces et fluides" : "Intrants"} labelPosition="left" />
                {quantityRows("input", inputs, setInputs, articleOptions(inputKinds, procedure!.suggestions.inputs))}
                {nitrogenTotal > 0 && inputs.filter((r) => nitrogenOf(r)?.ok).length > 1 && (
                  <Text size="sm" className="lv-num" aria-label="Azote apporté">
                    Azote apporté : <b>{kgN(Math.round(nitrogenTotal * 10) / 10)}</b>
                  </Text>
                )}
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
            {shape === "treatment" && <BbchField farmId={farmId} activities={parcelActivities.map((p) => p.activity)} value={bbch} onChange={setBbch} />}


            {procedure && shape !== "maintenance" && (
              <>
                <Divider label="4 · Météo" labelPosition="left" />
                <WeatherFields farmId={farmId} request={weatherRequest} value={weather} onChange={setWeather} />
              </>
            )}

            <Divider label={shape === "maintenance" ? "4 · Notes" : "5 · Notes"} labelPosition="left" />
            <Textarea label="Notes" autosize minRows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />

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
            {submit.isPaused && (
              <Alert color="paille" role="status" title="Pas de réseau">
                L'enregistrement partira dès le retour de la connexion. Gardez cette page ouverte d'ici là.
              </Alert>
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
      <Modal opened={freeLosses !== null} onClose={() => setFreeLosses(null)} title="Passer en mode libre ?">
        <Stack>
          <Text size="sm">Les attelages sont réunis : matériels, intervenants et périodes de l'intervention.</Text>
          <Alert color="paille" variant="light">
            <Stack gap={4}>
              {(freeLosses ?? []).map((l) => (
                <Text key={l} size="sm">
                  {l}
                </Text>
              ))}
            </Stack>
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setFreeLosses(null)}>
              Garder les attelages
            </Button>
            <Button onClick={() => switchToFree(true)}>Passer en mode libre</Button>
          </Group>
        </Stack>
      </Modal>
    </form>
  );
}

/** Bandeau d'une intervention tirée de parcours GPS (FR-GPS-21) : parcours rattachés, indices, procédures suggérées. */
function TrackDraftBanner({
  draft,
  catalogue,
  chosen,
  onChoose,
}: {
  draft: TrackDraft;
  catalogue: ProcedureCatalogue;
  chosen: string | null;
  onChoose: (code: string) => void;
}) {
  const n = draft.body.trackSessionIds.length;
  const suggestions = draft.procedureSuggestions
    .map((code) => catalogue.items.find((p) => p.code === code))
    .filter((p): p is ProcedureCatalogueItem => !!p);
  return (
    <Alert color="lichen" variant="light" title={`${n} parcours GPS ${n > 1 ? "seront rattachés" : "sera rattaché"}`} aria-label="Parcours GPS">
      <Stack gap={6}>
        <Text size="sm">Attelage, périodes et parcelles viennent des traces. Tout reste modifiable avant l'enregistrement.</Text>
        {suggestions.length > 0 && (
          <Group gap={6}>
            <Text size="sm">Procédure suggérée :</Text>
            {suggestions.map((p) => (
              <Button key={p.code} size="compact-xs" variant={chosen === p.code ? "filled" : "light"} onClick={() => onChoose(p.code)}>
                {p.label}
              </Button>
            ))}
          </Group>
        )}
        {draft.hints.map((h) => (
          <Text key={h} size="sm" c="dimmed">
            {h}
          </Text>
        ))}
      </Stack>
    </Alert>
  );
}

/**
 * Stade BBCH du traitement (facultatif, registre réglementaire) : stades du
 * référentiel pour la culture de la première activité des parcelles qui en a
 * une ; plusieurs cultures : on le signale.
 */
function BbchField({ farmId, activities, value, onChange }: { farmId: string; activities: Activity[]; value: string | null; onChange: (v: string | null) => void }) {
  const crops = [...new Map(activities.filter((a) => a.crop).map((a) => [a.crop!.code, a.crop!])).values()];
  const crop = crops[0] ?? null;
  const stages = useBbchStages(farmId, crop?.code ?? null);
  const items = stages.data?.items ?? [];
  const data = items.map((s) => ({ value: s.code, label: bbchOptionLabel(s) }));
  if (value && !items.some((s) => s.code === value)) data.unshift({ value, label: value });
  return (
    <Select
      label="Stade BBCH (facultatif)"
      description={crops.length > 1 ? `Stades de : ${crop!.label}` : undefined}
      placeholder={crop ? "Stade de la culture au traitement" : "Culture des parcelles inconnue"}
      disabled={!crop}
      searchable
      selectFirstOptionOnChange
      clearable
      data={data}
      value={value}
      onChange={onChange}
      nothingFoundMessage="Aucun stade"
    />
  );
}
