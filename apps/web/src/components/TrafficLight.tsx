import { Badge, Group, Text, ThemeIcon, Tooltip } from "@mantine/core";
import { Led } from "@gfazioli/mantine-led";
import { CircleAlert, CircleCheck, CircleDashed, Info, OctagonX } from "lucide-react";
import type { Light } from "@fourmy/domain";

/**
 * Feux de la fiche et de la saisie (conformité, dose, IFT, conditions de
 * pulvérisation) : une couleur Lyvre, une icône et un mot, jamais la couleur
 * seule (daltonisme, impression en noir et blanc).
 */
export const LIGHTS: Record<Light, { color: string; label: string; icon: typeof Info }> = {
  ok: { color: "lichen", label: "Conforme", icon: CircleCheck },
  info: { color: "ardoise", label: "À noter", icon: Info },
  warning: { color: "paille", label: "À vérifier", icon: CircleAlert },
  danger: { color: "brique", label: "Non conforme", icon: OctagonX },
  unknown: { color: "gray", label: "Non renseigné", icon: CircleDashed },
};

/**
 * `badge` : en tête de pavé (pastille, icône, mot) ; `inline` : dans une
 * ligne (icône et mot, détail au survol) ; `icon` : icône seule, le mot
 * restant dans le nom accessible ; `led` : voyant lumineux (doses
 * maximales, IFT), suivi du mot, ou seul avec `compact`. Un voyant rouge
 * pulse trois fois pour attirer l'œil, puis reste allumé.
 */
export function TrafficLight({
  level,
  label,
  detail,
  variant = "inline",
  size = "sm",
  compact = false,
}: {
  level: Light;
  /** Mot affiché ; par défaut celui du niveau (« Conforme »…). */
  label?: string;
  /** Précision (valeur, règle), au survol et dans le nom accessible. */
  detail?: string;
  variant?: "badge" | "inline" | "icon" | "led";
  size?: "xs" | "sm";
  /** Voyant seul (variante `led`), le mot restant dans le nom accessible et au survol. */
  compact?: boolean;
}) {
  const l = LIGHTS[level];
  const word = label ?? l.label;
  const name = detail ? `${word} : ${detail}` : word;
  const iconSize = size === "xs" ? 14 : 16;
  if (variant === "badge") {
    return (
      <Badge color={l.color} variant="light" size={size === "xs" ? "sm" : "md"} leftSection={<l.icon size={iconSize - 2} aria-hidden />} role="img" aria-label={name} data-level={level} title={detail}>
        {word}
      </Badge>
    );
  }
  if (variant === "led") {
    const led = (
      <Led
        // Nuance 4 : un voyant allumé se lit clair, la nuance 7 des textes paraîtrait éteinte.
        color={`${l.color}.4`}
        value={level !== "unknown"}
        offColor="gray"
        variant="dot"
        shape="circle"
        size="sm"
        animate={level === "danger"}
        animationType="pulse"
        animationCount={3}
        role="img"
        aria-label={name}
        data-level={level}
      />
    );
    const body = compact ? (
      led
    ) : (
      <Group gap={6} wrap="nowrap" data-level={level}>
        {led}
        <Text size={size} c={`${l.color}.8`} fw={500} aria-hidden>
          {word}
        </Text>
      </Group>
    );
    return compact || detail ? (
      <Tooltip label={compact ? name : detail} withArrow multiline maw={320}>
        <span style={{ display: "inline-flex" }}>{body}</span>
      </Tooltip>
    ) : (
      body
    );
  }
  const icon = (
    <ThemeIcon size={iconSize + 2} variant="transparent" color={l.color} role="img" aria-label={name} data-level={level}>
      <l.icon size={iconSize} aria-hidden />
    </ThemeIcon>
  );
  if (variant === "icon") return detail ? <Tooltip label={name} withArrow>{icon}</Tooltip> : icon;
  const body = (
    <Group gap={4} wrap="nowrap" data-level={level}>
      <ThemeIcon size={iconSize + 2} variant="transparent" color={l.color} aria-hidden>
        <l.icon size={iconSize} />
      </ThemeIcon>
      <Text size={size} c={`${l.color}.8`} fw={500} role="img" aria-label={name}>
        {word}
      </Text>
    </Group>
  );
  return detail ? (
    <Tooltip label={detail} withArrow multiline maw={320}>
      {body}
    </Tooltip>
  ) : (
    body
  );
}
