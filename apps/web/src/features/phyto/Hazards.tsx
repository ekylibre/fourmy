import { Badge, Box, Group, Text, Tooltip } from "@mantine/core";
import { Bomb, Cylinder, Fish, Flame, FlameKindling, PersonStanding, Skull, TestTubeDiagonal, type LucideIcon } from "lucide-react";
import { HAZARD_LABELS, type HazardPictogram } from "@fourmy/domain";
import type { FarmPhytoArticle } from "@fourmy/contracts";

/**
 * Pictogrammes réglementaires d'un produit phyto (lot D) : losanges de
 * danger SGH (CLP), d'après ses mentions H, et pastilles des contraintes
 * d'emploi (ZNT, délai de ré-entrée, délai avant récolte).
 */
const GLYPHS: Record<HazardPictogram, LucideIcon | "!"> = {
  SGH01: Bomb,
  SGH02: Flame,
  SGH03: FlameKindling,
  SGH04: Cylinder,
  SGH05: TestTubeDiagonal,
  SGH06: Skull,
  SGH07: "!",
  SGH08: PersonStanding,
  SGH09: Fish,
};

export function HazardDiamond({ code, size = 26 }: { code: string; size?: number }) {
  const picto = code as HazardPictogram;
  const Glyph = GLYPHS[picto];
  if (!Glyph) return null;
  const inner = size * 0.5;
  return (
    <Tooltip label={`${code} — ${HAZARD_LABELS[picto]}`} withArrow>
      <Box
        role="img"
        aria-label={`${code} : ${HAZARD_LABELS[picto]}`}
        w={size}
        h={size}
        style={{
          transform: "rotate(45deg) scale(0.74)",
          border: "2px solid #D7262E",
          background: "white",
          display: "grid",
          placeItems: "center",
          flex: "none",
        }}
      >
        <Box style={{ transform: "rotate(-45deg)", display: "grid", placeItems: "center", color: "#111" }}>
          {Glyph === "!" ? (
            <Text fw={900} fz={inner} lh={1}>
              !
            </Text>
          ) : (
            <Glyph size={inner} strokeWidth={2.25} />
          )}
        </Box>
      </Box>
    </Tooltip>
  );
}

/** Pictogrammes et contraintes d'emploi d'un produit (fiche, formulaire). */
export function RegulatoryPictos({
  article,
  zntM,
  harvestDays,
  size = 26,
}: {
  article: Pick<FarmPhytoArticle, "hazards" | "risks" | "reentryDelayHours"> | undefined;
  zntM?: number | null;
  harvestDays?: number | null;
  size?: number;
}) {
  if (!article) return null;
  const pills = [
    zntM ? { label: `ZNT ${zntM} m`, title: "Zone non traitée près de l'eau" } : null,
    article.reentryDelayHours ? { label: `DRE ${article.reentryDelayHours} h`, title: "Délai de ré-entrée dans la parcelle" } : null,
    harvestDays ? { label: `DAR ${harvestDays} j`, title: "Délai avant récolte" } : null,
  ].filter((p): p is { label: string; title: string } => p !== null);
  const hazards = article.hazards ?? [];
  if (hazards.length === 0 && pills.length === 0) return null;
  return (
    <Group gap={4} wrap="wrap" aria-label="Pictogrammes réglementaires">
      {hazards.map((h) => (
        <HazardDiamond key={h} code={h} size={size} />
      ))}
      {pills.map((p) => (
        <Tooltip key={p.label} label={p.title} withArrow>
          <Badge size="sm" variant="outline" color="brique" radius="sm">
            {p.label}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}
