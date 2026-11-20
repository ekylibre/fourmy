import { Alert, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { Combine, Scissors, Undo2, X } from "lucide-react";
import type { Polygon } from "geojson";
import { areaM2, CartoError, mergeAreas, polygons, type Area } from "@fourmy/carto";
import type { CropPlanContext, CropPlanDraft, CropPlanOperation, CropPlanParcelKey, GeoJsonGeometry } from "@fourmy/contracts";
import { defaultEffectiveOn } from "@fourmy/domain";
import { useArea } from "../../app/prefs";
import type { CropPlanEditor } from "./useCropPlanEditor";

/**
 * Découpe et fusion de parcelles dans l'assolement (lot AS3, conception §3.4) :
 * les nouvelles parcelles existent à partir de la date d'effet (par défaut
 * le lendemain de la dernière récolte de la parcelle d'origine) ; rien ne
 * change dans le parcellaire avant la validation.
 */

const newKey = (): `n:${string}` => `n:${crypto.randomUUID()}`;

/** Formes des parcelles du brouillon : parcellaire de départ et morceaux des opérations. */
export function draftShapes(context: CropPlanContext, draft: CropPlanDraft): Map<string, Area> {
  const out = new Map<string, Area>(context.parcels.map((p) => [`p:${p.id}`, p.shape as Area]));
  for (const op of draft.operations) for (const piece of op.kind === "split" ? op.pieces : [op.result]) out.set(piece.key, piece.shape as Area);
  return out;
}

/** Parcelles de départ dont viennent des parcelles du brouillon (date d'effet proposée). */
const originsOf = (editor: CropPlanEditor, keys: string[]) =>
  [...new Set(keys.flatMap((k) => editor.plan.byKey.get(k as CropPlanParcelKey)?.origins.map((o) => o.parcelId) ?? []))];

export function splitOperation(editor: CropPlanEditor, context: CropPlanContext, key: string, pieces: Polygon[]): CropPlanOperation {
  const name = editor.plan.byKey.get(key as CropPlanParcelKey)?.name ?? "Parcelle";
  return {
    kind: "split",
    source: key as CropPlanParcelKey,
    effectiveOn: defaultEffectiveOn(context, originsOf(editor, [key])),
    pieces: pieces.map((shape, i) => ({ key: newKey(), name: `${name} ${i + 1}`, shape: shape as unknown as GeoJsonGeometry, areaM2: Math.round(areaM2(shape) * 100) / 100 })),
  };
}

export function mergeOperation(editor: CropPlanEditor, context: CropPlanContext, keys: CropPlanParcelKey[], shapes: Map<string, Area>): CropPlanOperation {
  const merged = mergeAreas(keys.map((k) => shapes.get(k)!));
  const name = editor.plan.byKey.get(keys[0]!)?.name ?? "Parcelle";
  return {
    kind: "merge",
    sources: keys,
    effectiveOn: defaultEffectiveOn(context, originsOf(editor, keys)),
    result: { key: newKey(), name: `${name} (fusion)`, shape: merged as unknown as GeoJsonGeometry, areaM2: Math.round(areaM2(merged) * 100) / 100 },
  };
}

/** Barre d'outils au-dessus de la carte. */
export function ParcelTools({
  editor,
  context,
  selected,
  shapes,
  cutting,
  onCutting,
  onSelect,
  notice,
  onNotice,
  compact = false,
}: {
  editor: CropPlanEditor;
  context: CropPlanContext;
  selected: CropPlanParcelKey[];
  shapes: Map<string, Area>;
  cutting: string | null;
  onCutting: (key: string | null) => void;
  onSelect: (keys: CropPlanParcelKey[]) => void;
  notice: string | null;
  onNotice: (message: string | null) => void;
  /** Plein écran : consigne courte, sauf pendant une découpe. */
  compact?: boolean;
}) {
  const one = selected.length === 1 ? selected[0]! : null;
  const cuttable = one && polygons(shapes.get(one)).length === 1;
  const merge = () => {
    try {
      const op = mergeOperation(editor, context, selected, shapes);
      editor.apply((d) => ({ ...d, operations: [...d.operations, op] }));
      onSelect([op.kind === "merge" ? op.result.key : selected[0]!]);
      onNotice(null);
    } catch (e) {
      onNotice(e instanceof CartoError ? e.message : "Fusion impossible.");
    }
  };
  return (
    <Stack gap={4}>
      <Group gap="xs" justify="space-between">
        <Text size="xs" c="dimmed">
          {cutting
            ? "Tracez une ligne qui commence et finit hors de la parcelle ; double-cliquez pour finir."
            : compact
              ? "Maj + glisser : plusieurs parcelles"
              : "Clic : choisir ou retirer une parcelle · Maj + glisser : plusieurs parcelles."}
        </Text>
        <Group gap="xs">
          {cutting ? (
            <Button size="compact-sm" variant="default" leftSection={<X size={14} />} onClick={() => onCutting(null)}>
              Annuler la découpe
            </Button>
          ) : (
            <>
              <Button
                size="compact-sm"
                variant="light"
                leftSection={<Scissors size={14} />}
                disabled={!cuttable}
                title={one && !cuttable ? "Parcelle en plusieurs morceaux : non découpable ici" : undefined}
                onClick={() => {
                  onNotice(null);
                  onCutting(one);
                }}
              >
                Découper
              </Button>
              <Button size="compact-sm" variant="light" leftSection={<Combine size={14} />} disabled={selected.length < 2} onClick={merge}>
                Fusionner
              </Button>
            </>
          )}
        </Group>
      </Group>
      {notice && (
        <Text size="sm" c="brique" role="alert">
          {notice}
        </Text>
      )}
    </Stack>
  );
}

/** Découpes et fusions en attente de validation : date d'effet et noms modifiables. */
export function PendingOperations({ editor, context, editable }: { editor: CropPlanEditor; context: CropPlanContext; editable: boolean }) {
  const area = useArea();
  const ops = editor.draft.operations;
  if (!ops.length) return null;
  // Les parcelles d'origine ne sont plus dans le parcellaire du brouillon : leur nom vient du départ ou d'une opération précédente.
  const name = (k: string) =>
    context.parcels.find((p) => `p:${p.id}` === k)?.name ??
    editor.draft.operations.flatMap((o) => (o.kind === "split" ? o.pieces : [o.result])).find((p) => p.key === k)?.name ??
    k;
  const update = (i: number, change: (op: CropPlanOperation) => CropPlanOperation) =>
    editor.apply((d) => ({ ...d, operations: d.operations.map((op, j) => (j === i ? change(op) : op)) }));
  const renamePiece = (op: CropPlanOperation, key: string, value: string): CropPlanOperation =>
    op.kind === "split" ? { ...op, pieces: op.pieces.map((p) => (p.key === key ? { ...p, name: value } : p)) } : { ...op, result: { ...op.result, name: value } };
  const removeLast = () =>
    editor.apply((d) => {
      const last = d.operations.at(-1)!;
      const keys = new Set<string>((last.kind === "split" ? last.pieces : [last.result]).map((p) => p.key));
      return {
        ...d,
        operations: d.operations.slice(0, -1),
        assignments: d.assignments.filter((a) => !keys.has(a.key)),
        covers: d.covers.filter((c) => !keys.has(c.key)),
        fallow: d.fallow.filter((f) => !keys.has(f.key)),
      };
    });

  return (
    <Paper withBorder p="sm" aria-label="Découpes et fusions">
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">
          Découpes et fusions (appliquées à la validation)
        </Text>
        {editable && (
          <Button size="compact-xs" variant="subtle" color="brique" leftSection={<Undo2 size={12} />} onClick={removeLast}>
            Retirer la dernière
          </Button>
        )}
      </Group>
      <Stack gap="sm">
        {ops.map((op, i) => {
          const pieces = op.kind === "split" ? op.pieces : [op.result];
          return (
            <Stack key={i} gap={4}>
              <Text size="sm">
                {op.kind === "split" ? `${name(op.source)} découpée en ${pieces.length}` : `${op.sources.map(name).join(", ")} fusionnées`}
              </Text>
              <Group gap="xs" align="flex-end" wrap="wrap">
                <TextInput
                  size="xs"
                  type="date"
                  label="Date d'effet"
                  value={op.effectiveOn}
                  disabled={!editable}
                  onChange={(e) => e.currentTarget.value && update(i, (o) => ({ ...o, effectiveOn: e.currentTarget.value }))}
                  w={150}
                />
                {pieces.map((p) => (
                  <TextInput
                    key={p.key}
                    size="xs"
                    label={`Nom (${area(p.areaM2)})`}
                    defaultValue={p.name}
                    disabled={!editable}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== p.name) update(i, (o) => renamePiece(o, p.key, v));
                    }}
                    w={170}
                  />
                ))}
              </Group>
            </Stack>
          );
        })}
      </Stack>
      <Alert color="ardoise" variant="light" mt="sm" p="xs">
        <Text size="xs">
          Les nouvelles parcelles existent à partir de la date d'effet ; la parcelle d'origine reste telle quelle avant. Une intervention réalisée ou prévue sur la parcelle d'origine après cette date bloque la validation.
        </Text>
      </Alert>
    </Paper>
  );
}
