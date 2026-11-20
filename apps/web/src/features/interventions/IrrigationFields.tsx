import { Group, NumberInput, Select, Switch, Text } from "@mantine/core";
import {
  IRRIGATION_DEPTH_MAX_MM,
  IRRIGATION_METHOD_LABELS,
  IRRIGATION_ORIGIN_LABELS,
  IRRIGATION_TRIGGER_LABELS,
  type IrrigationBlock,
  type IrrigationMethod,
  type IrrigationOrigin,
  type IrrigationTrigger,
} from "@fourmy/contracts";

/**
 * Irrigation (lot AC) : dose d'eau apportée en mm sur les parcelles, et
 * matériel. La dose alimente le bilan hydrique du modèle de croissance.
 */

export interface IrrigationDraft {
  depthMm: number | "";
  method: IrrigationMethod | null;
  /** Enregistrement HVE (7.1, 7.6) : origine de l'eau, facteur déclenchant, matériel mobile. */
  origin: IrrigationOrigin | null;
  trigger: IrrigationTrigger | null;
  mobile: boolean | null;
}

export const irrigationDraft = (
  v?: { depthMm: number; method?: IrrigationMethod | null; origin?: IrrigationOrigin | null; trigger?: IrrigationTrigger | null; mobile?: boolean | null } | null,
): IrrigationDraft => ({
  depthMm: v?.depthMm ?? "",
  method: v?.method ?? null,
  origin: v?.origin ?? null,
  trigger: v?.trigger ?? null,
  mobile: v?.mobile ?? null,
});

export const irrigationBody = (d: IrrigationDraft): IrrigationBlock | undefined =>
  d.depthMm === "" || d.depthMm <= 0 ? undefined : { depthMm: d.depthMm, method: d.method, origin: d.origin, trigger: d.trigger, mobile: d.mobile };

/** 1 mm sur 1 ha = 10 m³. */
export const irrigationVolumeM3 = (depthMm: number, areaM2: number) => (depthMm * areaM2) / 1000;

const METHODS = Object.entries(IRRIGATION_METHOD_LABELS).map(([value, label]) => ({ value, label }));
const ORIGINS = Object.entries(IRRIGATION_ORIGIN_LABELS).map(([value, label]) => ({ value, label }));
const TRIGGERS = Object.entries(IRRIGATION_TRIGGER_LABELS).map(([value, label]) => ({ value, label }));

export function IrrigationFields({ value, onChange, areaM2, required }: { value: IrrigationDraft; onChange: (v: IrrigationDraft) => void; areaM2: number; required: boolean }) {
  const volume = value.depthMm !== "" && areaM2 > 0 ? irrigationVolumeM3(value.depthMm, areaM2) : null;
  return (
    <Group align="flex-end" gap="md">
      <NumberInput
        label="Dose d'eau"
        description="Hauteur d'eau apportée sur les parcelles"
        suffix=" mm"
        decimalSeparator=","
        min={0}
        max={IRRIGATION_DEPTH_MAX_MM}
        decimalScale={1}
        w={200}
        required={required}
        value={value.depthMm}
        onChange={(v) => onChange({ ...value, depthMm: v === "" ? "" : Number(v) })}
      />
      <Select
        label="Matériel d'irrigation"
        placeholder="Facultatif"
        clearable
        data={METHODS}
        w={220}
        value={value.method}
        onChange={(v) => onChange({ ...value, method: (v as IrrigationMethod | null) ?? null })}
      />
      {volume !== null && (
        <Text size="sm" c="dimmed" className="lv-num" pb={8}>
          soit {Math.round(volume).toLocaleString("fr-FR")} m³
        </Text>
      )}
      <Select
        label="Origine de l'eau"
        placeholder="Facultatif"
        clearable
        data={ORIGINS}
        w={220}
        value={value.origin}
        onChange={(v) => onChange({ ...value, origin: (v as IrrigationOrigin | null) ?? null })}
      />
      <Select
        label="Facteur déclenchant"
        placeholder="Facultatif"
        clearable
        data={TRIGGERS}
        w={240}
        value={value.trigger}
        onChange={(v) => onChange({ ...value, trigger: (v as IrrigationTrigger | null) ?? null })}
      />
      <Switch label="Matériel mobile" checked={value.mobile === true} onChange={(e) => onChange({ ...value, mobile: e.currentTarget.checked })} pb={8} />
    </Group>
  );
}
