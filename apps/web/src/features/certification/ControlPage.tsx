import { useState } from "react";
import { Alert, Button, Group, Paper, Select, Stack, Tabs, Text, Title } from "@mantine/core";
import { Settings } from "lucide-react";
import { ControlSettingsModal } from "./ControlSettings";
import { useParams } from "react-router";
import { CONTROL_KIND_LABELS, type ControlKind } from "@fourmy/contracts";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";
import { ControlLight, FindingList, useControlReport } from "./controls";
import { AbParcels } from "./AbParcels";
import { AbSeeds } from "./AbSeeds";
import { HveIrrigated } from "./HveIrrigated";
import { HveIae } from "./HveIae";
import { HveQuestionnaireForm } from "./HveQuestionnaire";

/**
 * Tableau de bord d'un contrôle HVE ou AB pour une campagne (lot CT1) :
 * verdict, sections et constats sourcés. Les règles arrivent avec les lots
 * CT2 à CT5 ; l'export d'audit avec CT6.
 */
export function ControlPage() {
  const { kind: raw } = useParams();
  const kind: ControlKind = raw === "hve" ? "hve" : "ab";
  const farm = useFarm();
  const { day } = useAt();
  const [campaign, setCampaign] = useState(Number(day.slice(0, 4)));
  const report = useControlReport(farm.id, kind, campaign);
  const [tab, setTab] = useState<string>("rules");
  const [settings, setSettings] = useState(false);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear + 2 - 2015 }, (_, i) => String(thisYear + 1 - i));
  const fmt = (d: string) => new Date(d).toLocaleDateString("fr-FR");

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Title order={1}>Contrôle {kind === "hve" ? "HVE" : "AB"}</Title>
        <Group align="flex-end">
          {farm.role === "owner" && (
            <Button variant="default" leftSection={<Settings size={16} />} onClick={() => setSettings(true)}>
              Réglages
            </Button>
          )}
          <Select label="Campagne" data={years} value={String(campaign)} onChange={(v) => v && setCampaign(Number(v))} w={120} allowDeselect={false} />
        </Group>
      </Group>
      {settings && <ControlSettingsModal kind={kind} onClose={() => setSettings(false)} />}
      <Text c="dimmed">{CONTROL_KIND_LABELS[kind]} : contrôle calculé à partir de vos saisies, pour préparer l'audit. Il ne remplace pas la décision de l'organisme certificateur.</Text>
      <Tabs value={tab} onChange={(v) => v && setTab(v)}>
        <Tabs.List>
          <Tabs.Tab value="rules">{kind === "ab" ? "Règles" : "Indicateurs"}</Tabs.Tab>
          {kind === "ab" ? (
            <>
              <Tabs.Tab value="parcels">Parcelles</Tabs.Tab>
              <Tabs.Tab value="seeds">Semences</Tabs.Tab>
            </>
          ) : (
            <>
              <Tabs.Tab value="questionnaire">Questionnaire</Tabs.Tab>
              <Tabs.Tab value="iae">IAE</Tabs.Tab>
              <Tabs.Tab value="irrigation">Parcelles irriguées</Tabs.Tab>
            </>
          )}
        </Tabs.List>
      </Tabs>
      {kind === "ab" && tab === "parcels" && <AbParcels campaign={campaign} />}
      {kind === "ab" && tab === "seeds" && <AbSeeds campaign={campaign} />}
      {kind === "hve" && tab === "irrigation" && <HveIrrigated campaign={campaign} />}
      {kind === "hve" && tab === "iae" && <HveIae campaign={campaign} />}
      {kind === "hve" && tab === "questionnaire" && <HveQuestionnaireForm key={campaign} campaign={campaign} />}
      {tab === "rules" && report.isLoading && <Loading />}
      {tab === "rules" && report.error && <ErrorAlert error={report.error} />}
      {tab === "rules" && report.data && (
        <>
          <Paper withBorder p="md" aria-label="Verdict">
            <Group justify="space-between">
              <div>
                <Text fw={700}>
                  Campagne {report.data.campaign} : du {fmt(report.data.period.from)} au {fmt(report.data.period.to)}
                </Text>
                <Text size="xs" c="dimmed">
                  Calculé le {new Date(report.data.computedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}, référentiels {report.data.refsVersion}.
                </Text>
              </div>
              <ControlLight level={report.data.verdict} />
            </Group>
            {report.data.changedSinceExport && (
              <Alert color="paille" variant="light" mt="sm">
                Des données ont changé depuis le dernier export : exportez à nouveau avant l'audit.
              </Alert>
            )}
          </Paper>
          {report.data.sections.map((s) => (
            <Paper key={s.id} withBorder p="md" aria-label={s.label}>
              <Group justify="space-between" mb="xs">
                <Text fw={700}>
                  {s.label}
                  {s.points ? ` — ${s.points.got} / ${s.points.max} points (minimum ${s.points.min})` : ""}
                </Text>
                <ControlLight level={s.level} />
              </Group>
              <FindingList findings={s.findings} />
            </Paper>
          ))}
        </>
      )}
    </Stack>
  );
}
