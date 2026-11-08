import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  MultiSelect,
  NumberInput,
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
import { ProcedureIcon } from "../../components/ProcedureIcon";

type QuantityRow = { articleId: string | null; quantity: number | ""; per: QuantityPer; to: string | null };
type PeriodRow = { startedAt: string; stoppedAt: string };

export interface InterventionFormProps {
  farmId: string;
  snapshot: Snapshot;
  articles: Article[];
  people: Person[];
  catalogue: ProcedureCatalogue;
  /** Intervention planifiée à réaliser (formulaire prérempli). */
  planned?: Intervention;
  defaultDay: string;
  onDone: () => void;
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
export function InterventionForm({ farmId, snapshot, articles, people, catalogue, planned, defaultDay, onDone }: InterventionFormProps) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState<string | null>(planned?.procedure ?? null);
  const procedure: ProcedureCatalogueItem | undefined = catalogue.items.find((p) => p.code === code);
  const shape = procedure?.shape;
  const [mode, setMode] = useState<"done" | "planned">("done");
  const completing = Boolean(planned) || mode === "done";

  const start = planned?.startedAt ? local(planned.startedAt) : `${defaultDay}T08:00`;
  const [periods, setPeriods] = useState<PeriodRow[]>(
    planned?.periods.length
      ? planned.periods.map((p) => ({ startedAt: local(p.startedAt), stoppedAt: local(p.stoppedAt) }))
      : [{ startedAt: start, stoppedAt: `${start.slice(0, 10)}T10:00` }],
  );
  const [parcels, setParcels] = useState<string[]>(planned?.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id) ?? []);
  const [maintained, setMaintained] = useState<string[]>(planned?.targets.filter((t) => t.kind === "equipment").map((t) => t.id) ?? []);
  const [inputs, setInputs] = useState<QuantityRow[]>(
    planned?.inputs.map((i) => ({ articleId: i.articleId, quantity: i.quantity, per: i.per, to: null })) ?? [],
  );
  const [outputs, setOutputs] = useState<QuantityRow[]>(
    planned?.outputs.map((o) => ({
      articleId: o.articleId,
      quantity: o.quantity,
      per: o.per,
      to: o.to?.containerId ? `container:${o.to.containerId}` : o.to?.placeId ? `place:${o.to.placeId}` : null,
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
          : parcels.map((id) => ({ kind: "land_parcel" as const, id })),
      inputs: quantity(inputs).map((r) => ({ articleId: r.articleId!, quantity: Number(r.quantity), per: r.per })),
      outputs: quantity(outputs).map((r) => ({
        articleId: r.articleId!,
        quantity: Number(r.quantity),
        per: r.per,
        ...(r.to ? { to: location(r.to) } : {}),
      })),
      tools: tools.map((equipmentId) => ({ equipmentId })),
      doers: doers.map((personId) => ({ personId })),
      purposes,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    } satisfies InterventionCompleteWrite;
  };

  const submit = useMutation({
    mutationFn: async () => {
      const full = body();
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
        return api.post<{ warnings: string[] }>(farmPath(farmId, `/interventions/${id}/complete`), full);
      }
      return { warnings: [] as string[] };
    },
    onSuccess: (r) => {
      for (const w of r.warnings) notifications.show({ color: "paille", title: "À vérifier", message: w, autoClose: 10_000 });
      notifications.show({ color: "lichen", message: completing ? "Intervention enregistrée." : "Intervention planifiée." });
      for (const key of ["interventions", "stock", "register", "snapshot", "contents", "procedures"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      onDone();
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!code) return setError("Choisissez une intervention.");
        if (periods.some((p) => !p.startedAt || (completing && !p.stoppedAt))) return setError("Renseignez les dates.");
        submit.mutate();
      }}
    >
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
          disabled={Boolean(planned)}
        />
        {!planned && (
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as "done" | "planned")}
            data={[
              { value: "done", label: "Réalisée" },
              { value: "planned", label: "À planifier" },
            ]}
          />
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
                  onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, startedAt: e.currentTarget.value } : x)))}
                  required
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
            value={periods[0]!.startedAt}
            onChange={(e) => setPeriods([{ ...periods[0]!, startedAt: e.currentTarget.value }])}
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
            <MultiSelect
              label="Parcelles"
              searchable
              data={snapshot.landParcels.map((p) => ({ value: p.id, label: `${p.name} (${formatHa(p.version.areaM2)})` }))}
              value={parcels}
              onChange={setParcels}
            />
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
        <Button type="submit" loading={submit.isPending}>
          {planned ? "Enregistrer la réalisation" : mode === "planned" ? "Planifier" : "Enregistrer"}
        </Button>
      </Stack>
    </form>
  );
}
