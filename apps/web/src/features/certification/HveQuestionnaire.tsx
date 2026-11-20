import { useEffect, useState } from "react";
import { Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HveAnswers, HveQuestionnaire } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";
import { Documents } from "../fertilization/Documents";

type Section = keyof HveAnswers;

/** Oui / non / sans réponse : une réponse absente laisse l'item en « données manquantes ». */
function YesNo({ label, description, value, onChange, disabled }: { label: string; description?: string; value: boolean | null | undefined; onChange: (v: boolean | null) => void; disabled: boolean }) {
  return (
    <Select
      label={label}
      description={description}
      disabled={disabled}
      data={[
        { value: "", label: "Sans réponse" },
        { value: "yes", label: "Oui" },
        { value: "no", label: "Non" },
      ]}
      value={value === null || value === undefined ? "" : value ? "yes" : "no"}
      onChange={(v) => onChange(v === "yes" ? true : v === "no" ? false : null)}
      allowDeselect={false}
    />
  );
}

function Num({ label, description, value, onChange, disabled, suffix, max }: { label: string; description?: string; value: number | null | undefined; onChange: (v: number | null) => void; disabled: boolean; suffix?: string; max?: number }) {
  return (
    <NumberInput
      label={label}
      description={description}
      disabled={disabled}
      min={0}
      max={max}
      suffix={suffix}
      decimalSeparator=","
      placeholder="Sans réponse"
      value={value ?? ""}
      onChange={(v) => onChange(v === "" ? null : Number(v))}
    />
  );
}

/**
 * Questionnaire HVE annuel (lot CT4b, D10) : items déclaratifs des quatre
 * indicateurs. Une question sans réponse laisse l'item en « données
 * manquantes » ; les pièces se joignent au questionnaire de la campagne.
 */
export function HveQuestionnaireForm({ campaign }: { campaign: number }) {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["certifications", "hve-questionnaire", farm.id, campaign],
    queryFn: () => api.get<HveQuestionnaire>(farmPath(farm.id, `/control/hve/questionnaire?campaign=${campaign}`)),
  });
  const [a, setA] = useState<HveAnswers | null>(null);
  useEffect(() => setA(q.data?.answers ?? null), [q.data]);
  const save = useMutation({
    mutationFn: (answers: HveAnswers) => api.put<HveQuestionnaire>(farmPath(farm.id, `/control/hve/questionnaire?campaign=${campaign}`), answers),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["certifications"] });
      notifications.show({ color: "lichen", message: `Questionnaire ${campaign} enregistré.` });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  if (q.isLoading || !a) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const set = <S extends Section, K extends keyof HveAnswers[S]>(section: S, key: K) => (v: HveAnswers[S][K]) => setA({ ...a, [section]: { ...a[section], [key]: v } });
  const off = !owner;
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Réponses de la campagne {campaign}, à justifier par des pièces lors de l'audit. Une question sans réponse laisse l'item en « données manquantes ».
      </Text>
      <Paper withBorder p="md">
        <Title order={4} mb="sm">
          Biodiversité
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Num label="4.5 Espèces animales élevées" description="Espèces, pas races ; abeilles exclues" value={a.biodiversity.animalSpecies} onChange={set("biodiversity", "animalSpecies")} disabled={off} />
          <YesNo label="4.6 Trois ruches au moins, toute la campagne" value={a.biodiversity.hives} onChange={set("biodiversity", "hives")} disabled={off} />
          <Num label="4.7 Variétés menacées (annexe 3, région)" value={a.biodiversity.threatenedVarieties} onChange={set("biodiversity", "threatenedVarieties")} disabled={off} />
          <Num label="4.7 Races menacées (arrêté du 29/04/2015)" value={a.biodiversity.threatenedBreeds} onChange={set("biodiversity", "threatenedBreeds")} disabled={off} />
          <Select
            label="4.8 Qualité biologique du sol"
            disabled={off}
            data={[
              { value: "", label: "Sans réponse" },
              { value: "none", label: "Aucun test" },
              { value: "spade_test", label: "Test bêche OPVT (3 campagnes)" },
              { value: "microbial_analysis", label: "Analyse de biomasse microbienne (année précédente)" },
            ]}
            value={a.biodiversity.soilBiology ?? ""}
            onChange={(v) => set("biodiversity", "soilBiology")((v || null) as HveAnswers["biodiversity"]["soilBiology"])}
            allowDeselect={false}
          />
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="md">
        <Title order={4} mb="sm">
          Stratégie phytosanitaire
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <YesNo label="5.5 Outil de diagnostic ou de modélisation" description="Pièges, modèles, lecture du BSV tracée au cahier" value={a.phyto.diagnosticTool} onChange={set("phyto", "diagnosticTool")} disabled={off} />
          <YesNo label="5.5 Prospection collective (FREDON, GDON…)" value={a.phyto.collectiveProspection} onChange={set("phyto", "collectiveProspection")} disabled={off} />
          <Num label="5.5 Observateur BSV : part de SAU représentée" suffix=" %" max={100} value={a.phyto.bsvObserverPercent} onChange={set("phyto", "bsvObserverPercent")} disabled={off} />
          <Num label="5.6 Méthodes alternatives : part de SAU" description="Méthode physique ou biocontrôle ayant remplacé un traitement" suffix=" %" max={100} value={a.phyto.alternativeMethodsPercent} onChange={set("phyto", "alternativeMethodsPercent")} disabled={off} />
          <Num label="5.7 Équipements limitant les fuites" description="Annexe 6, présents sur tous les pulvérisateurs" value={a.phyto.leakEquipment} onChange={set("phyto", "leakEquipment")} disabled={off} />
          <Num label="5.9 et 6.7 Inter-rang couvert (cultures pérennes)" suffix=" %" max={100} value={a.phyto.interRowCoverPercent} onChange={set("phyto", "interRowCoverPercent")} disabled={off} />
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="md">
        <Title order={4} mb="sm">
          Fertilisation
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Num label="Bilan azoté : azote des animaux (kg N)" description="Rejets − effluents cédés + effluents reçus, pâturage compris ; 0 sans élevage" value={a.fertilization.livestockNitrogenKg} onChange={set("fertilization", "livestockNitrogenKg")} disabled={off} />
          <Num label="6.4 Blé sous OPI : part des grandes cultures" suffix=" %" max={100} value={a.fertilization.opiWheatPercent} onChange={set("fertilization", "opiWheatPercent")} disabled={off} />
          <Num label="6.4 Cultures mineures sous PPF ajusté ou pilotage" suffix=" %" max={100} value={a.fertilization.minorOadPercent} onChange={set("fertilization", "minorOadPercent")} disabled={off} />
          <YesNo label="6.4 Cultures mineures : PPF sur plus de 50 %" value={a.fertilization.minorPpf} onChange={set("fertilization", "minorPpf")} disabled={off} />
          <YesNo label="6.7 Durée réglementaire de couverture respectée partout" value={a.fertilization.coverRegulatory} onChange={set("fertilization", "coverRegulatory")} disabled={off} />
          <Num label="6.7 Semaines de couvert" max={52} value={a.fertilization.coverWeeks} onChange={set("fertilization", "coverWeeks")} disabled={off} />
          <Num label="6.7 Part de la surface couverte" suffix=" %" max={100} value={a.fertilization.coverPercent} onChange={set("fertilization", "coverPercent")} disabled={off} />
          <YesNo label="6.7 Zone vulnérable" value={a.fertilization.vulnerableZone} onChange={set("fertilization", "vulnerableZone")} disabled={off} />
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="md">
        <Title order={4} mb="sm">
          Irrigation
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <YesNo label="7.2 Outil d'offre (sondes, tensiomètres, station)" value={a.irrigation.supplyTool} onChange={set("irrigation", "supplyTool")} disabled={off} />
          <YesNo label="7.2 Outil de demande (ETP, potentiel hydrique)" value={a.irrigation.demandTool} onChange={set("irrigation", "demandTool")} disabled={off} />
          <YesNo label="7.2 OAD mixte" value={a.irrigation.mixedTool} onChange={set("irrigation", "mixedTool")} disabled={off} />
          <Num label="7.3 SAU irriguée équipée de matériel économe" suffix=" %" max={100} value={a.irrigation.efficientEquipmentPercent} onChange={set("irrigation", "efficientEquipmentPercent")} disabled={off} />
          <YesNo label="7.4 Démarche collective de gestion de l'eau" value={a.irrigation.collective} onChange={set("irrigation", "collective")} disabled={off} />
          <Num label="7.5 SAU irriguée en pratiques économes" suffix=" %" max={100} value={a.irrigation.waterSavingPercent} onChange={set("irrigation", "waterSavingPercent")} disabled={off} />
        </SimpleGrid>
      </Paper>
      {owner && (
        <Group>
          <Button loading={save.isPending} onClick={() => save.mutate(a)}>
            Enregistrer le questionnaire
          </Button>
        </Group>
      )}
      {q.data?.id ? (
        <Documents farmId={farm.id} ownerType="hve_questionnaire" ownerId={q.data.id} owner={owner} label="Pièces justificatives" />
      ) : (
        <Text size="sm" c="dimmed">
          Les pièces justificatives se joignent une fois le questionnaire enregistré.
        </Text>
      )}
    </Stack>
  );
}
