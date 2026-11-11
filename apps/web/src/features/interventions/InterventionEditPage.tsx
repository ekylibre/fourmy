import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Button, Group, Paper, Stack, Title } from "@mantine/core";
import { ArrowLeft } from "lucide-react";
import type { InterventionDetail, TrackDraft } from "@fourmy/contracts";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { procedureLabel } from "../../app/labels";
import { useArticles, useIntervention, usePeople, useProcedures, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { InterventionForm, type FormInitial } from "./InterventionForm";

/**
 * Nouvelle intervention pré-remplie par l'adresse (lot K) : depuis une
 * échéance (`?procedure=equipment_maintenance&equipment=…&operations=a,b&status=planned`)
 * ou une anomalie (`&nature=corrective&problem=…`). Irrigation proposée par
 * le modèle de croissance : `?procedure=watering&parcels=…&dose=30`.
 */
function initialFromParams(p: URLSearchParams): FormInitial | undefined {
  const procedure = p.get("procedure");
  if (!procedure) return undefined;
  const nature = p.get("nature");
  const dose = Number(p.get("dose"));
  return {
    procedure,
    ...(dose > 0 ? { depthMm: Math.round(dose) } : {}),
    equipmentId: p.get("equipment") ?? undefined,
    operationIds: (p.get("operations") ?? "").split(",").filter(Boolean),
    mode: p.get("status") === "planned" ? "planned" : p.get("status") === "done" ? "done" : undefined,
    nature: nature === "corrective" || nature === "preventive" ? nature : null,
    problem: p.get("problem") ?? undefined,
    landParcelIds: (p.get("parcels") ?? "").split(",").filter(Boolean),
  };
}
import { interventionDay } from "./presenters";

/** Pré-remplissage : paramètres d'URL (entretien), ou brouillon de parcours GPS passé par la navigation (lot P). */
function initialOf(p: URLSearchParams, state: unknown): FormInitial | undefined {
  const trackDraft = (state as { trackDraft?: TrackDraft } | null)?.trackDraft;
  const fromParams = initialFromParams(p);
  return trackDraft ? { ...fromParams, trackDraft } : fromParams;
}

type FormMode = "new" | "complete" | "edit";

/**
 * Saisie d'une intervention en pleine page (exigences INT-UI-3, retours du
 * 08/11) : nouvelle, réalisation d'une intervention planifiée, ou
 * modification (planifiée : mise à jour ; réalisée : correction tracée).
 * Même mise en page partout : le formulaire à gauche ; à droite les
 * conditions de pulvérisation, la carte et le contrôle réglementaire.
 */
export function InterventionEditPage() {
  return <InterventionFormPage mode="edit" />;
}
export function InterventionCompletePage() {
  return <InterventionFormPage mode="complete" />;
}
export function InterventionNewPage() {
  return <InterventionFormPage mode="new" />;
}

function InterventionFormPage({ mode }: { mode: FormMode }) {
  const { interventionId } = useParams();
  const farm = useFarm();
  if (mode === "new") return <FormLayout mode={mode} back={`/f/${farm.id}/interventions`} />;
  return <ExistingForm mode={mode} id={interventionId!} />;
}

function ExistingForm({ mode, id }: { mode: FormMode; id: string }) {
  const farm = useFarm();
  const detail = useIntervention(farm.id, id);
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return <Loading />;
  const i = detail.data;
  if (i.status === "cancelled") return <ErrorAlert error={new Error("Intervention annulée : elle ne se modifie plus.")} />;
  if (mode === "complete" && i.status !== "planned") return <ErrorAlert error={new Error("Intervention déjà réalisée : utilisez « Modifier » pour la corriger.")} />;
  return <FormLayout mode={mode} intervention={i} back={`/f/${farm.id}/interventions/${i.id}`} />;
}

function FormLayout({ mode, intervention: i, back }: { mode: FormMode; intervention?: InterventionDetail; back: string }) {
  const farm = useFarm();
  const navigate = useNavigate();
  const location = useLocation();
  const { day: timelineDay } = useAt();
  const day = i ? interventionDay(i) : `${timelineDay}T12:00:00.000Z`;
  const snap = useSnapshot(farm.id, day);
  const articles = useArticles(farm.id);
  const people = usePeople(farm.id);
  const catalogue = useProcedures(farm.id);
  const backTo = `${back}${location.search}`;

  if (snap.error) return <ErrorAlert error={snap.error} />;
  if (snap.isLoading || !snap.data || !articles.data || !catalogue.data) return <Loading />;
  const title =
    mode === "new" ? "Nouvelle intervention" : mode === "complete" ? `Réaliser : ${procedureLabel(i!.procedure)}` : `${i!.status === "done" ? "Corriger" : "Modifier"} : ${procedureLabel(i!.procedure)}`;

  return (
    <Stack>
      <Button component={Link} to={backTo} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
        {mode === "new" ? "Interventions" : "Retour à la fiche"}
      </Button>
      <Group gap="sm">
        {i && <ProcedureIcon procedure={i.procedure} size={28} />}
        <Title order={1}>{title}</Title>
      </Group>
      <Paper p="md" withBorder>
        <InterventionForm
          farmId={farm.id}
          snapshot={snap.data}
          articles={articles.data.items}
          people={people.data?.items ?? []}
          catalogue={catalogue.data}
          planned={mode === "complete" ? i : undefined}
          editing={mode === "edit" ? i : undefined}
          defaultDay={day.slice(0, 10)}
          initial={mode === "new" ? initialOf(new URLSearchParams(location.search), location.state) : undefined}
          onDone={(id) => {
            // Après l'enregistrement : la fiche de l'intervention.
            const target = id ?? i?.id;
            navigate(target ? `/f/${farm.id}/interventions/${target}${location.search}` : backTo);
          }}
        />
      </Paper>
    </Stack>
  );
}
