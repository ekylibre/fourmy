import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Button, Group, Paper, Stack, Title } from "@mantine/core";
import { ArrowLeft } from "lucide-react";
import { useFarm } from "../../app/farm";
import { procedureLabel } from "../../app/labels";
import { useArticles, useIntervention, usePeople, useProcedures, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { InterventionForm } from "./InterventionForm";
import { interventionDay } from "./presenters";

/**
 * Modification d'une intervention (exigence INT-UI-3) : le formulaire de
 * saisie, prérempli. Planifiée : mise à jour ; réalisée : correction tracée.
 * Les parcelles proposées sont celles de la date de l'intervention.
 */
export function InterventionEditPage() {
  const { interventionId } = useParams();
  const farm = useFarm();
  const navigate = useNavigate();
  const location = useLocation();
  const detail = useIntervention(farm.id, interventionId!);
  const day = detail.data ? interventionDay(detail.data) : null;
  const snap = useSnapshot(farm.id, day ?? new Date().toISOString());
  const articles = useArticles(farm.id);
  const people = usePeople(farm.id);
  const catalogue = useProcedures(farm.id);
  const sheet = `/f/${farm.id}/interventions/${interventionId}${location.search}`;

  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data || !day || snap.isLoading || !snap.data || !articles.data || !catalogue.data) return <Loading />;
  const i = detail.data;
  if (i.status === "cancelled") return <ErrorAlert error={new Error("Intervention annulée : elle ne se modifie plus.")} />;

  return (
    <Stack maw={760}>
      <Button component={Link} to={sheet} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
        Retour à la fiche
      </Button>
      <Group gap="sm">
        <ProcedureIcon procedure={i.procedure} size={28} />
        <Title order={1}>
          {i.status === "done" ? "Corriger" : "Modifier"} : {procedureLabel(i.procedure)}
        </Title>
      </Group>
      <Paper p="md" withBorder>
        <InterventionForm
          farmId={farm.id}
          snapshot={snap.data}
          articles={articles.data.items}
          people={people.data?.items ?? []}
          catalogue={catalogue.data}
          editing={i}
          defaultDay={day.slice(0, 10)}
          onDone={() => navigate(sheet)}
        />
      </Paper>
    </Stack>
  );
}
