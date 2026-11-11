import { Group, NumberInput, Select, Text } from "@mantine/core";
import { IRRIGATION_DEPTH_MAX_MM, IRRIGATION_METHOD_LABELS, type IrrigationBlock, type IrrigationMethod } from "@fourmy/contracts";

/**
 * Irrigation (lot AC) : dose d'eau apportée en mm sur les parcelles, et
 * matériel. La dose alimente le bilan hydrique du modèle de croissance.
 */

export interface IrrigationDraft {
  depthMm: number | "";
  method: IrrigationMethod | null;
}

export const irrigationDraft = (v?: { depthMm: number; method?: IrrigationMethod | null } | null): IrrigationDraft => ({
  depthMm: v?.depthMm ?? "",
  method: v?.method ?? null,
});

export const irrigationBody = (d: IrrigationDraft): IrrigationBlock | undefined =>
  d.depthMm === "" || d.depthMm <= 0 ? undefined : { depthMm: d.depthMm, method: d.method };

/** 1 mm sur 1 ha = 10 m³. */
export const irrigationVolumeM3 = (depthMm: number, areaM2: number) => (depthMm * areaM2) / 1000;

const METHODS = Object.entries(IRRIGATION_METHOD_LABELS).map(([value, label]) => ({ value, label }));

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
    </Group>
  );
}
