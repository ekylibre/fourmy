import { useMemo, useState } from "react";
import { ActionIcon, Alert, Button, Checkbox, Divider, Group, Modal, MultiSelect, NumberInput, SegmentedControl, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { Plus, Trash2 } from "lucide-react";
import {
  ITK_DOSE_UNITS,
  PROCEDURES,
  SHAPE_LABELS,
  getProcedure,
  itkProcedureAllowed,
  itkStep,
  itkUnitAllowed,
  unitLabel,
  type ArticleKind,
  type ItkAnchor,
  type ItkInput,
  type ItkMachineryRateInfo,
  type ItkStep,
} from "@fourmy/contracts";
import { ARTICLE_KIND_LABELS } from "../../app/labels";
import { useMachineryRates } from "./work";

type Option = { value: string; label: string };
export interface StepOptions {
  articles: { id: string; name: string; kind: ArticleKind }[];
  equipments: Option[];
  people: Option[];
  crewTemplates: Option[];
  /** Lignes du barème déjà connues (libellé du type de matériel choisi). */
  machineryRates?: Record<string, ItkMachineryRateInfo>;
}

/** Procédures proposées : catalogue, hors entretien du matériel, groupées par forme. */
const PROCEDURE_GROUPS = (() => {
  const allowed = PROCEDURES.filter((p) => itkProcedureAllowed(p.code));
  return (Object.keys(SHAPE_LABELS) as (keyof typeof SHAPE_LABELS)[])
    .map((shape) => ({
      group: SHAPE_LABELS[shape],
      items: allowed
        .filter((p) => p.shape === shape)
        .map((p) => ({ value: p.code, label: p.label }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    }))
    .filter((g) => g.items.length > 0);
})();

const rateLabel = (r: ItkMachineryRateInfo) => `${r.label}${r.haH ? ` · ${String(r.haH).replace(".", ",")} ha/h` : ""}`;
const defaultUnit = (kind: ArticleKind) => (kind === "phyto" ? "liter_per_hectare" : "kilogram_per_hectare");

/** « 15/02 » → « 02-15 » ; null si illisible. */
function parseDayMonth(text: string): string | null {
  const m = /^\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const dayMonthText = (md: string) => `${md.slice(3)}/${md.slice(0, 2)}`;

/**
 * Ajout ou modification d'une étape d'ITK (lot IT1) : procédure, date
 * relative, passages, part, intrants et doses, matériels et personnes,
 * débit saisi. Rien n'est enregistré avant « Enregistrer » dans l'éditeur.
 */
export function StepModal({
  farmId,
  step,
  options,
  readOnly,
  onSave,
  onClose,
}: {
  farmId: string;
  step: ItkStep | null;
  options: StepOptions;
  readOnly: boolean;
  /** `rate` : ligne du barème choisie, pour le calcul avant enregistrement. */
  onSave: (step: ItkStep, rate?: ItkMachineryRateInfo) => void;
  onClose: () => void;
}) {
  const [procedure, setProcedure] = useState<string | null>(step?.procedure ?? null);
  const [label, setLabel] = useState(step?.label ?? "");
  const [anchor, setAnchor] = useState<ItkAnchor>(step?.anchor ?? { kind: "sowing", offsetDays: 0 });
  const [dayMonth, setDayMonth] = useState(step?.anchor.kind === "date" ? dayMonthText(step.anchor.monthDay) : "");
  const [windowDays, setWindowDays] = useState<number | "">(step?.windowDays ?? "");
  const [repeatCount, setRepeatCount] = useState<number>(step?.repeat?.count ?? 1);
  const [repeatEvery, setRepeatEvery] = useState<number>(step?.repeat?.everyDays ?? 15);
  const [sharePct, setSharePct] = useState<number>(Math.round((step?.share ?? 1) * 100));
  const [optional, setOptional] = useState(step?.optional ?? false);
  const [inputs, setInputs] = useState<ItkInput[]>(step?.inputs ?? []);
  const [crewTemplateId, setCrewTemplateId] = useState<string | null>(step?.staffing.crewTemplateId ?? null);
  const [equipmentIds, setEquipmentIds] = useState<string[]>(step?.staffing.equipmentIds ?? []);
  const [personIds, setPersonIds] = useState<string[]>(step?.staffing.personIds ?? []);
  const [people, setPeople] = useState<number | "">(step?.staffing.people ?? "");
  const [workRate, setWorkRate] = useState<number | "">(step?.workRateHaH ?? "");
  // Type de matériel du barème BCMA quand aucun matériel de la ferme n'est désigné (lot IT4, §15.3).
  const [machineryRateId, setMachineryRateId] = useState<string | null>(step?.staffing.machineryRateId ?? null);
  const [rateSearch, setRateSearch] = useState("");
  const [chosenRate, setChosenRate] = useState<ItkMachineryRateInfo | null>(machineryRateId ? (options.machineryRates?.[machineryRateId] ?? null) : null);
  const noEquipment = !crewTemplateId && equipmentIds.length === 0;
  const rates = useMachineryRates(farmId, procedure, rateSearch, noEquipment && !!procedure);
  const [notes, setNotes] = useState(step?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const definition = procedure ? getProcedure(procedure) : null;
  const inputKinds = definition?.inputKinds ?? [];
  const articleOptions = useMemo(
    () =>
      options.articles
        .filter((a) => inputKinds.includes(a.kind))
        .map((a) => ({ value: a.id, label: `${a.name} · ${ARTICLE_KIND_LABELS[a.kind] ?? a.kind}` }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [options.articles, inputKinds],
  );
  // Un élément disparu reste affiché (« à remplacer ») plutôt que retiré en silence.
  const withUnknown = (opts: Option[], ids: string[]) => [...opts, ...ids.filter((id) => !opts.some((o) => o.value === id)).map((id) => ({ value: id, label: "Élément supprimé — à remplacer" }))];

  const setInput = (i: number, patch: Partial<ItkInput>) => setInputs((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = () => {
    if (!procedure) return setError("Choisissez une procédure.");
    let a: ItkAnchor = anchor;
    if (anchor.kind === "date") {
      const md = parseDayMonth(dayMonth);
      if (!md) return setError("Date au format JJ/MM (par exemple 15/02).");
      a = { kind: "date", monthDay: md, yearOffset: anchor.yearOffset };
    }
    const parsed = itkStep.safeParse({
      ...(step?.evidence ? { evidence: step.evidence } : {}),
      ...(step?.purposes ? { purposes: step.purposes } : {}),
      id: step?.id ?? crypto.randomUUID(),
      procedure,
      label: label.trim() || undefined,
      anchor: a,
      windowDays: windowDays === "" ? undefined : windowDays,
      repeat: repeatCount > 1 ? { count: repeatCount, everyDays: repeatEvery } : undefined,
      share: sharePct / 100,
      optional,
      inputs: inputs.filter((i) => inputKinds.includes(i.kind)),
      staffing: {
        crewTemplateId: crewTemplateId ?? undefined,
        equipmentIds,
        personIds,
        people: people === "" ? undefined : people,
        ...(noEquipment && machineryRateId ? { machineryRateId } : {}),
      },
      workRateHaH: workRate === "" ? undefined : workRate,
      notes: notes.trim() || undefined,
    });
    if (!parsed.success) return setError(parsed.error.issues.map((i) => i.message).join(" "));
    const bad = parsed.data.inputs.find((i) => !itkUnitAllowed(i.unit, i.kind));
    if (bad) return setError(`« ${bad.label} » : unité réservée aux semences.`);
    onSave(parsed.data, noEquipment && chosenRate ? chosenRate : undefined);
  };

  return (
    <Modal opened onClose={onClose} title={step ? "Étape de l'itinéraire" : "Nouvelle étape"} size="lg">
      <Stack>
        <Group grow align="flex-start">
          <Select
            label="Procédure"
            data={PROCEDURE_GROUPS}
            value={procedure}
            onChange={setProcedure}
            searchable
            required
            disabled={readOnly}
            data-autofocus={step ? undefined : true}
          />
          <TextInput label="Libellé" placeholder={definition?.label ?? "Désherbage d'automne"} value={label} onChange={(e) => setLabel(e.currentTarget.value)} maxLength={120} disabled={readOnly} />
        </Group>

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Quand
          </Text>
          <Group align="flex-end" wrap="wrap">
            <SegmentedControl
              value={anchor.kind}
              disabled={readOnly}
              onChange={(k) =>
                setAnchor(k === "date" ? { kind: "date", monthDay: parseDayMonth(dayMonth) ?? "03-01", yearOffset: 0 } : { kind: k as "sowing" | "harvest", offsetDays: anchor.kind === "date" ? 0 : anchor.offsetDays })
              }
              data={[
                { value: "sowing", label: "Par rapport au semis" },
                { value: "harvest", label: "Par rapport à la récolte" },
                { value: "date", label: "Date fixe" },
              ]}
            />
            {anchor.kind === "date" ? (
              <>
                <TextInput label="Jour/mois" placeholder="15/02" value={dayMonth} onChange={(e) => setDayMonth(e.currentTarget.value)} w={100} disabled={readOnly} />
                <Checkbox
                  label="Année précédant la récolte"
                  checked={anchor.yearOffset === -1}
                  onChange={(e) => setAnchor({ ...anchor, yearOffset: e.currentTarget.checked ? -1 : 0 })}
                  disabled={readOnly}
                  mb={8}
                />
              </>
            ) : (
              <NumberInput
                label="Jours (négatif : avant)"
                value={anchor.offsetDays}
                onChange={(v) => setAnchor({ ...anchor, offsetDays: typeof v === "number" ? Math.round(v) : 0 })}
                min={-366}
                max={730}
                w={170}
                disabled={readOnly}
              />
            )}
            <NumberInput label="Plage ± jours" value={windowDays} onChange={(v) => setWindowDays(typeof v === "number" ? v : "")} min={0} max={90} w={120} disabled={readOnly} />
          </Group>
        </Stack>

        <Group align="flex-end" wrap="wrap">
          <NumberInput label="Passages" value={repeatCount} onChange={(v) => setRepeatCount(typeof v === "number" ? v : 1)} min={1} max={20} w={100} disabled={readOnly} />
          {repeatCount > 1 && (
            <NumberInput label="Tous les (jours)" value={repeatEvery} onChange={(v) => setRepeatEvery(typeof v === "number" ? v : 15)} min={1} max={365} w={130} disabled={readOnly} />
          )}
          <NumberInput label="Part de la surface (%)" value={sharePct} onChange={(v) => setSharePct(typeof v === "number" ? v : 100)} min={1} max={100} w={170} disabled={readOnly} />
          <Checkbox label="Si besoin (facultative)" checked={optional} onChange={(e) => setOptional(e.currentTarget.checked)} disabled={readOnly} mb={8} />
        </Group>

        {inputKinds.length > 0 && (
          <>
            <Divider label="Intrants (dose à l'hectare traité)" labelPosition="left" />
            {inputs.map((input, i) => (
              <Group key={i} align="flex-end" wrap="nowrap" gap="xs">
                <Select
                  label={i === 0 ? "Article" : undefined}
                  placeholder="Intrant générique"
                  data={withUnknown(articleOptions, input.articleId ? [input.articleId] : [])}
                  value={input.articleId ?? null}
                  onChange={(v) => {
                    const a = options.articles.find((x) => x.id === v);
                    setInput(i, a ? { articleId: a.id, label: a.name, kind: a.kind, unit: itkUnitAllowed(input.unit, a.kind) ? input.unit : defaultUnit(a.kind) } : { articleId: undefined });
                  }}
                  searchable
                  clearable
                  style={{ flex: 2 }}
                  disabled={readOnly}
                />
                {!input.articleId && (
                  <>
                    <TextInput label={i === 0 ? "Libellé" : undefined} placeholder="Azote 40 u" value={input.label} onChange={(e) => setInput(i, { label: e.currentTarget.value })} style={{ flex: 2 }} disabled={readOnly} />
                    <Select
                      label={i === 0 ? "Nature" : undefined}
                      data={inputKinds.map((k) => ({ value: k, label: ARTICLE_KIND_LABELS[k] ?? k }))}
                      value={input.kind}
                      onChange={(v) => v && setInput(i, { kind: v as ArticleKind, unit: itkUnitAllowed(input.unit, v as ArticleKind) ? input.unit : defaultUnit(v as ArticleKind) })}
                      allowDeselect={false}
                      w={140}
                      disabled={readOnly}
                    />
                  </>
                )}
                <NumberInput label={i === 0 ? "Dose" : undefined} value={input.dose} onChange={(v) => setInput(i, { dose: typeof v === "number" ? v : 0 })} min={0} decimalSeparator="," w={100} disabled={readOnly} />
                <Select
                  label={i === 0 ? "Unité" : undefined}
                  data={ITK_DOSE_UNITS.filter((u) => itkUnitAllowed(u, input.kind)).map((u) => ({ value: u, label: unitLabel(u) }))}
                  value={input.unit}
                  onChange={(v) => v && setInput(i, { unit: v as ItkInput["unit"] })}
                  allowDeselect={false}
                  w={130}
                  disabled={readOnly}
                />
                {!readOnly && (
                  <ActionIcon variant="subtle" color="red" onClick={() => setInputs((l) => l.filter((_, j) => j !== i))} aria-label="Retirer l'intrant" mb={4}>
                    <Trash2 size={16} />
                  </ActionIcon>
                )}
              </Group>
            ))}
            {!readOnly && (
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<Plus size={14} />}
                onClick={() => setInputs((l) => [...l, { kind: inputKinds[0]!, label: "", dose: 1, unit: defaultUnit(inputKinds[0]!) }])}
                style={{ alignSelf: "flex-start" }}
              >
                Ajouter un intrant
              </Button>
            )}
          </>
        )}

        <Divider label="Chantier" labelPosition="left" />
        <Group grow align="flex-start">
          <Select label="Attelage type" data={withUnknown(options.crewTemplates, crewTemplateId ? [crewTemplateId] : [])} value={crewTemplateId} onChange={setCrewTemplateId} clearable disabled={readOnly} />
          <NumberInput
            label="Débit (ha/h)"
            description="Sinon observé sur la ferme ou barème"
            value={workRate}
            onChange={(v) => setWorkRate(typeof v === "number" ? v : "")}
            min={0}
            max={200}
            decimalScale={2}
            decimalSeparator=","
            disabled={readOnly}
          />
        </Group>
        {!crewTemplateId && (
          <Group grow align="flex-start">
            <MultiSelect label="Matériels" data={withUnknown(options.equipments, equipmentIds)} value={equipmentIds} onChange={setEquipmentIds} searchable disabled={readOnly} />
            <MultiSelect label="Intervenants" data={withUnknown(options.people, personIds)} value={personIds} onChange={setPersonIds} searchable disabled={readOnly} />
            {personIds.length === 0 && (
              <NumberInput label="Personnes" description="Si aucune n'est nommée" value={people} onChange={(v) => setPeople(typeof v === "number" ? v : "")} min={0} max={50} disabled={readOnly} />
            )}
          </Group>
        )}
        {noEquipment && (
          <Select
            label="Type de matériel (barème BCMA)"
            description="Sans matériel de la ferme (prestation, matériel à acheter) : son débit de référence sert au temps de travaux"
            placeholder="Rechercher : semoir 4 m, pulvérisateur 24 m…"
            data={[
              ...(machineryRateId && !(rates.data?.items ?? []).some((r) => r.id === machineryRateId)
                ? [{ value: machineryRateId, label: chosenRate ? rateLabel(chosenRate) : "Type de matériel du barème" }]
                : []),
              ...(rates.data?.items ?? []).map((r) => ({ value: r.id, label: rateLabel(r) })),
            ]}
            value={machineryRateId}
            onChange={(v) => {
              setMachineryRateId(v);
              setChosenRate(v ? ((rates.data?.items ?? []).find((r) => r.id === v) ?? chosenRate) : null);
              setRateSearch("");
            }}
            searchable
            searchValue={rateSearch}
            onSearchChange={setRateSearch}
            filter={({ options }) => options}
            clearable
            nothingFoundMessage="Aucun matériel du barème"
            disabled={readOnly}
          />
        )}
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} maxLength={1000} autosize minRows={1} disabled={readOnly} />
        {step?.evidence && (
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              D'après l'historique : {step.evidence.parcels} parcelle{step.evidence.parcels > 1 ? "s" : ""} sur {step.evidence.ofParcels}, {step.evidence.campaigns.join(", ")}
              {step.evidence.note ? ` (${step.evidence.note})` : ""}
              {step.evidence.observedRateHaH ? ` ; débit observé ${String(step.evidence.observedRateHaH).replace(".", ",")} ha/h sur ${step.evidence.observedSamples} chantiers` : ""}.
            </Text>
            {!readOnly && step.evidence.observedRateHaH && workRate === "" && (
              <Button size="compact-xs" variant="subtle" onClick={() => setWorkRate(step.evidence!.observedRateHaH!)}>
                Reprendre ce débit
              </Button>
            )}
          </Group>
        )}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {readOnly ? "Fermer" : "Annuler"}
          </Button>
          {!readOnly && <Button onClick={save}>{step ? "Appliquer" : "Ajouter l'étape"}</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}
