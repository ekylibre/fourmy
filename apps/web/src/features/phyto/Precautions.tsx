import { Alert, Badge, Group, Paper, Spoiler, Stack, Text } from "@mantine/core";
import { CircleCheck, OctagonX } from "lucide-react";
import type { ComplianceResult, FarmPhytoArticle } from "@fourmy/contracts";
import { RegulatoryPictos } from "./Hazards";

/**
 * Précautions d'emploi des produits de la bouillie et vérification du
 * mélange (retours du 08/11/2026, lot F) : protection de l'opérateur et
 * mentions restrictives (E-Phy), conditions d'emploi de l'usage retenu,
 * catégories de mélange (arrêté du 7 avril 2010 modifié).
 */
export function PrecautionsPanel({ articles, compliance }: { articles: FarmPhytoArticle[]; compliance: ComplianceResult | null }) {
  if (articles.length === 0) return null;
  const mixture = compliance?.mixture ?? null;
  return (
    <Paper withBorder p="sm" aria-label="Précautions d'emploi">
      <Text size="sm" fw={700} mb="xs">
        Précautions d'emploi
      </Text>
      <Stack gap="sm">
        {articles.map((a) => {
          const check = compliance?.checks.find((c) => c.articleId === a.id);
          return (
            <Stack key={a.id} gap={4} aria-label={`Précautions : ${a.name}`}>
              <Group gap={6}>
                <Text size="sm" fw={600}>
                  {a.name}
                </Text>
                {a.organic && (
                  <Badge size="xs" color="lichen" variant="light">
                    utilisable en AB
                  </Badge>
                )}
                {a.biocontrol && (
                  <Badge size="xs" color="lichen" variant="outline">
                    biocontrôle
                  </Badge>
                )}
              </Group>
              <RegulatoryPictos article={a} zntM={check?.zntM ?? null} size={20} />
              {check?.usageConditions && <Precaution title="Conditions d'emploi de l'usage" text={check.usageConditions} />}
              {a.restrictedMentions && <Precaution title="Mentions restrictives" text={a.restrictedMentions} />}
              {a.operatorProtection && <Precaution title="Protection de l'opérateur (EPI)" text={a.operatorProtection} />}
              {!check?.usageConditions && !a.restrictedMentions && !a.operatorProtection && (
                <Text size="xs" c="dimmed">
                  Aucune précaution particulière dans E-Phy.
                </Text>
              )}
            </Stack>
          );
        })}
        {articles.length > 1 && (
          <Stack gap={4} aria-label="Mélange">
            <Text size="sm" fw={600}>
              Mélange
            </Text>
            {mixture && mixture.issues.length > 0 ? (
              <Alert color="brique" variant="light" icon={<OctagonX size={16} />} p="xs">
                <Stack gap={2}>
                  {mixture.issues.map((i) => (
                    <Text key={i.message} size="sm">
                      {i.message}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            ) : mixture ? (
              <Group gap={6} wrap="nowrap">
                <CircleCheck size={16} color="var(--mantine-color-lichen-6)" aria-hidden />
                <Text size="sm">Mélange autorisé (catégories : {articles.map((a) => `${a.name} ${a.mixCodes.join(", ") || "—"}`).join(" ; ")}).</Text>
              </Group>
            ) : (
              <Text size="xs" c="dimmed">
                Vérification en cours…
              </Text>
            )}
            <Text size="xs" c="dimmed">
              Arrêté du 7 avril 2010 modifié : catégorie 5, aucun mélange ; deux produits d'une même catégorie 2, 3 ou 4, pas de mélange.
            </Text>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function Precaution({ title, text }: { title: string; text: string }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed" fw={600}>
        {title}
      </Text>
      <Spoiler maxHeight={60} showLabel="Lire la suite" hideLabel="Réduire">
        <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
          {text}
        </Text>
      </Spoiler>
    </Stack>
  );
}
