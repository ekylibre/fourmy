import { useState } from "react";
import { ActionIcon, Alert, Button, Divider, Group, MultiSelect, NumberInput, SegmentedControl, Select, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { Intervention, InterventionParameterWrite, Snapshot, Article } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { formatHa } from "@fourmy/ui-lyvre";
import { doseUnits, PROCEDURE_OPTIONS, unitLabel } from "../../app/labels";

type InputRow = { articleId: string | null; dose: number | ""; unit: string | null };

export interface InterventionFormProps {
  farmId: string;
  snapshot: Snapshot;
  articles: Article[];
  /** Intervention planifiée à réaliser (formulaire prérempli). */
  planned?: Intervention;
  defaultDay: string;
  onDone: () => void;
}

const local = (iso: string) => iso.slice(0, 16); // AAAA-MM-JJTHH:MM pour datetime-local

/**
 * Saisie d'une intervention (US-2) : cibles, intrants (dose par hectare ou
 * quantité totale — le serveur calcule le mouvement de stock), matériels,
 * sortie éventuelle rangée en cuve. Planifier, ou réaliser directement.
 */
export function InterventionForm({ farmId, snapshot, articles, planned, defaultDay, onDone }: InterventionFormProps) {
  const queryClient = useQueryClient();
  const param = (role: string) => planned?.parameters.filter((p) => p.role === role) ?? [];

  const [procedure, setProcedure] = useState<string | null>(planned?.procedure ?? "spraying");
  const [mode, setMode] = useState<"done" | "planned">("done");
  const [startedAt, setStartedAt] = useState(local(planned?.startedAt ?? `${defaultDay}T08:00`));
  const [stoppedAt, setStoppedAt] = useState(local(planned?.stoppedAt ?? `${defaultDay}T10:00`));
  const [targets, setTargets] = useState<string[]>(param("target").flatMap((p) => (p.refId ? [p.refId] : [])));
  const [tools, setTools] = useState<string[]>(param("tool").flatMap((p) => (p.refId ? [p.refId] : [])));
  const [inputs, setInputs] = useState<InputRow[]>(
    param("input").length
      ? param("input").map((p) => ({ articleId: p.refId, dose: p.quantity ?? "", unit: p.unit }))
      : [{ articleId: null, dose: "", unit: null }],
  );
  const [output, setOutput] = useState<{ articleId: string | null; quantity: number | ""; containerId: string | null }>({
    articleId: null,
    quantity: "",
    containerId: null,
  });
  const [error, setError] = useState<string | null>(null);

  const inputArticles = articles.filter((a) => a.kind !== "harvest" && a.kind !== "wine");
  const outputArticles = articles.filter((a) => a.kind === "harvest" || a.kind === "wine" || a.kind === "other");
  const article = (id: string | null) => articles.find((a) => a.id === id);

  const parameters = (): InterventionParameterWrite[] => [
    ...targets.map((refId) => ({ role: "target" as const, refType: "land_parcel", refId, quantity: null, unit: null })),
    ...inputs
      .filter((r) => r.articleId && r.dose !== "" && r.unit)
      .map((r) => ({ role: "input" as const, refType: "article", refId: r.articleId!, quantity: Number(r.dose), unit: r.unit })),
    ...tools.map((refId) => ({ role: "tool" as const, refType: "equipment", refId, quantity: null, unit: null })),
    ...(output.articleId && output.quantity !== ""
      ? [
          {
            role: "output" as const,
            refType: "article",
            refId: output.articleId,
            quantity: Number(output.quantity),
            unit: article(output.articleId)?.unit ?? null,
            stock: output.containerId ? { containerId: output.containerId } : undefined,
          },
        ]
      : []),
  ];

  const submit = useMutation({
    mutationFn: async () => {
      const params = parameters();
      const start = new Date(startedAt).toISOString();
      const stop = new Date(stoppedAt).toISOString();
      const id = planned?.id ?? crypto.randomUUID();
      if (!planned) {
        await api.post<Intervention>(farmPath(farmId, "/interventions"), {
          id,
          procedure,
          startedAt: start,
          parameters: mode === "planned" ? params : [],
        });
      }
      if (planned || mode === "done") {
        return api.post<{ warnings: string[] }>(farmPath(farmId, `/interventions/${id}/complete`), {
          startedAt: start,
          stoppedAt: stop,
          parameters: params,
        });
      }
      return { warnings: [] as string[] };
    },
    onSuccess: (r) => {
      for (const w of r.warnings) notifications.show({ color: "paille", title: "À vérifier", message: w, autoClose: 10_000 });
      notifications.show({ color: "lichen", message: mode === "planned" && !planned ? "Intervention planifiée." : "Intervention enregistrée." });
      for (const key of ["interventions", "stock", "register", "snapshot", "contents"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!procedure) return setError("Choisissez une intervention.");
        if (targets.length === 0) return setError("Choisissez au moins une parcelle.");
        submit.mutate();
      }}
    >
      <Stack>
        <Select label="Intervention" data={PROCEDURE_OPTIONS} value={procedure} onChange={setProcedure} searchable required />
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
        <Group grow>
          <TextInput type="datetime-local" label="Début" value={startedAt} onChange={(e) => setStartedAt(e.currentTarget.value)} required />
          {(planned || mode === "done") && (
            <TextInput type="datetime-local" label="Fin" value={stoppedAt} onChange={(e) => setStoppedAt(e.currentTarget.value)} required />
          )}
        </Group>
        <MultiSelect
          label="Parcelles"
          searchable
          data={snapshot.landParcels.map((p) => ({ value: p.id, label: `${p.name} (${formatHa(p.version.areaM2)})` }))}
          value={targets}
          onChange={setTargets}
        />

        <Divider label="Intrants" labelPosition="left" />
        {inputs.map((row, i) => {
          const a = article(row.articleId);
          return (
            <Group key={i} align="flex-end" wrap="nowrap">
              <Select
                label={i === 0 ? "Produit" : undefined}
                aria-label="Produit"
                searchable
                style={{ flex: 2 }}
                data={inputArticles.map((x) => ({ value: x.id, label: x.amm ? `${x.name} — AMM ${x.amm}` : x.name }))}
                value={row.articleId}
                onChange={(v) =>
                  setInputs(inputs.map((r, j) => (j === i ? { ...r, articleId: v, unit: v ? `${article(v)!.unit}_per_hectare` : null } : r)))
                }
              />
              <NumberInput
                label={i === 0 ? "Dose" : undefined}
                aria-label="Dose"
                min={0}
                decimalScale={3}
                decimalSeparator=","
                style={{ flex: 1 }}
                value={row.dose}
                onChange={(v) => setInputs(inputs.map((r, j) => (j === i ? { ...r, dose: v === "" ? "" : Number(v) } : r)))}
              />
              <Select
                label={i === 0 ? "Unité" : undefined}
                aria-label="Unité"
                style={{ flex: 1 }}
                data={a ? doseUnits(a.unit) : []}
                value={row.unit}
                onChange={(v) => setInputs(inputs.map((r, j) => (j === i ? { ...r, unit: v } : r)))}
                disabled={!a}
              />
              <ActionIcon variant="subtle" color="brique" aria-label="Retirer l'intrant" onClick={() => setInputs(inputs.filter((_, j) => j !== i))}>
                <Trash2 size={16} />
              </ActionIcon>
            </Group>
          );
        })}
        <Button variant="subtle" leftSection={<Plus size={16} />} onClick={() => setInputs([...inputs, { articleId: null, dose: "", unit: null }])}>
          Ajouter un intrant
        </Button>

        <MultiSelect
          label="Matériels"
          searchable
          data={snapshot.equipments.map((e) => ({ value: e.id, label: e.name }))}
          value={tools}
          onChange={setTools}
        />

        {(planned || mode === "done") && (
          <>
            <Divider label="Récolte (facultatif)" labelPosition="left" />
            <Group grow align="flex-end">
              <Select
                label="Produit récolté"
                clearable
                data={outputArticles.map((x) => ({ value: x.id, label: x.name }))}
                value={output.articleId}
                onChange={(v) => setOutput({ ...output, articleId: v })}
              />
              <NumberInput
                label={`Quantité${output.articleId ? ` (${unitLabel(article(output.articleId)?.unit)})` : ""}`}
                min={0}
                decimalSeparator=","
                value={output.quantity}
                onChange={(v) => setOutput({ ...output, quantity: v === "" ? "" : Number(v) })}
              />
              <Select
                label="Cuve"
                clearable
                data={snapshot.containers.map((c) => ({ value: c.id, label: c.name }))}
                value={output.containerId}
                onChange={(v) => setOutput({ ...output, containerId: v })}
              />
            </Group>
          </>
        )}

        {error && (
          <Alert color="brique" title="Enregistrement refusé">
            {error}
          </Alert>
        )}
        <Text size="xs" c="dimmed">
          La dose par hectare est multipliée par la surface traitée à la date de l'intervention ; le stock et le registre phyto se mettent à jour.
        </Text>
        <Button type="submit" loading={submit.isPending}>
          {planned ? "Enregistrer la réalisation" : mode === "planned" ? "Planifier" : "Enregistrer"}
        </Button>
      </Stack>
    </form>
  );
}
