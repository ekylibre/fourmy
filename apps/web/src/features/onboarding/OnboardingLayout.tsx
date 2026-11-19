import type { ReactNode } from "react";
import { Alert, Button, Group, ScrollArea, Stack, Stepper, Text, Title } from "@mantine/core";
import { Link, useParams } from "react-router";
import { RefreshCw } from "lucide-react";
import { Wordmark } from "@fourmy/ui-lyvre";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { errorMessage, isChunkError } from "../../components/RouteError";

/**
 * Erreur dans une étape de l'assistant : la frise reste, la progression est
 * gardée (en base) ; on réessaie l'étape, on recharge, ou on revient aux fermes.
 */
export function StepError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const chunk = isChunkError(error);
  // Ferme déjà créée : son tableau de bord (la liste des fermes ramènerait ici).
  const { farmId } = useParams();
  return (
    <Alert color={chunk ? "paille" : "brique"} title={chunk ? "Fourmy a été mis à jour" : "Cette étape a rencontré une erreur"} role="alert">
      <Stack gap="sm">
        <Text size="sm">
          {chunk
            ? "Une partie de l'application a changé depuis l'ouverture de la page : rechargez-la pour continuer."
            : "Votre progression est enregistrée : vous pouvez réessayer, recharger la page ou revenir plus tard, l'assistant reprendra ici."}
        </Text>
        {!chunk && (
          <Text size="xs" c="dimmed" ff="monospace">
            {errorMessage(error)}
          </Text>
        )}
        <Group>
          {onRetry && !chunk && (
            <Button size="xs" variant="light" onClick={onRetry}>
              Réessayer
            </Button>
          )}
          <Button size="xs" variant="light" leftSection={<RefreshCw size={14} />} onClick={() => globalThis.location.reload()}>
            Recharger la page
          </Button>
          <Button size="xs" variant="subtle" color="gray" component={Link} to={farmId ? `/f/${farmId}` : "/farms"}>
            {farmId ? "Tableau de bord de la ferme" : "Mes fermes"}
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

/** Étapes de l'assistant (claudedocs/conception_import_onboarding.md §9.2). */
export const STEPS = [
  { key: "farm", label: "Ma ferme" },
  { key: "files", label: "Mes fichiers" },
  { key: "preview", label: "Aperçu" },
  { key: "matching", label: "Rapprochements" },
  { key: "settings", label: "Paramétrage" },
  { key: "import", label: "Import" },
  { key: "done", label: "Fin" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export const stepIndex = (key: string | undefined) => Math.max(0, STEPS.findIndex((s) => s.key === key));

/** Frise des étapes (sans clic : on avance par les boutons de chaque étape). */
export function Steps({ active }: { active: number }) {
  return (
    // Les 7 étapes sur une ligne ; sur un écran étroit, la frise défile plutôt que de passer à la ligne.
    <ScrollArea type="never" offsetScrollbars={false}>
      <Stepper active={active} size="xs" iconSize={26} wrap={false} allowNextStepsSelect={false} aria-label="Étapes de la mise en route" miw={720}>
        {STEPS.map((s, i) => (
          <Stepper.Step key={s.key} label={`${i + 1}. ${s.label}`} />
        ))}
      </Stepper>
    </ScrollArea>
  );
}

/**
 * Mise en page de l'assistant : sans le menu de l'application, frise des
 * étapes, contenu, puis « Retour », « Passer » et l'action de l'étape.
 */
export function OnboardingLayout({
  step,
  farmName,
  title,
  intro,
  children,
  onBack,
  onSkip,
  next,
}: {
  step: StepKey;
  farmName: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  onBack?: () => void;
  onSkip?: () => void;
  /** Action principale de l'étape. */
  next?: ReactNode;
}) {
  return (
    <Stack p={{ base: "md", sm: "xl" }} maw={1000} mx="auto">
      <Group justify="space-between">
        <Wordmark style={{ fontSize: "1.6rem" }} />
        <Text c="dimmed" size="sm">
          {farmName}
        </Text>
      </Group>
      <Steps active={stepIndex(step)} />
      <Title order={1}>{title}</Title>
      {intro && <Text c="dimmed">{intro}</Text>}
      <ErrorBoundary label="assistant" resetKey={step} fallback={(error, reset) => <StepError error={error} onRetry={reset} />}>
        {children}
      </ErrorBoundary>
      <Group justify="space-between" mt="md">
        <Group>
          {onBack && (
            <Button variant="subtle" color="gray" onClick={onBack}>
              Retour
            </Button>
          )}
        </Group>
        <Group>
          {onSkip && (
            <Button variant="default" onClick={onSkip}>
              Passer
            </Button>
          )}
          {next}
        </Group>
      </Group>
    </Stack>
  );
}
