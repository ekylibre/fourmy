import { Link, useLocation } from "react-router";
import { Anchor, Text } from "@mantine/core";
import { kgN, type NitrogenNote } from "./fertilization";

/** Ligne « ≈ 48 kg N/ha » sous un intrant, ou ce qui manque pour la calculer (lot AE, FR-FERT-20). */
export function NitrogenLine({ note, farmId }: { note: NitrogenNote | null; farmId: string }) {
  const location = useLocation();
  if (!note) return null;
  if (!note.ok) {
    return (
      <Text size="xs" c="paille.8">
        Azote apporté : {note.reason}.{" "}
        <Anchor component={Link} to={`/f/${farmId}/fertilizers${location.search}`} size="xs">
          Compléter la composition
        </Anchor>
      </Text>
    );
  }
  return (
    <Text size="xs" c="dimmed" className="lv-num" aria-label="Azote de l'intrant">
      ≈ <b>{kgN(note.totalKgHa)}</b>
      {note.efficientKgHa === null ? " total" : ""} ({note.origin})
    </Text>
  );
}
