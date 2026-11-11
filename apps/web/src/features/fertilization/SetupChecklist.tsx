import { Anchor, Badge, Group, List, Paper, Progress, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Check, CircleDashed } from "lucide-react";
import type { FertilizationPlanSummary, FertilizationRecord, FertilizerArticle, ParcelFertilizationContext } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { formatDate } from "../../app/labels";
import { useFertilizers } from "./fertilization";

interface Step {
  key: string;
  title: string;
  /** Pourquoi Fourmy en a besoin. */
  why: string;
  done: boolean;
  /** Ce qui reste, avec un lien vers l'écran de saisie. */
  todo: { label: string; to: string }[];
}

const MAX_LINKS = 6;

/**
 * Démarrage de la fertilisation azotée (lot AP) : ce que l'exploitant doit
 * saisir pour que Fourmy calcule les plans et tienne le cahier, d'après ce
 * qu'il sait déjà (parcelles, fertilisants, plans, cahier), avec un lien vers
 * chaque saisie. Rien n'est appelé en plus : les requêtes sont celles de la page.
 */
export function SetupChecklist({
  farmId,
  campaign,
  parcels,
  analysisDone,
}: {
  farmId: string;
  campaign: number;
  parcels: ParcelFertilizationContext[];
  analysisDone: boolean | null;
}) {
  const fertilizers = useFertilizers(farmId);
  const plans = useQuery({
    queryKey: ["fertilization-plans", farmId, campaign],
    queryFn: () => api.get<{ items: FertilizationPlanSummary[] }>(farmPath(farmId, `/fertilization/plans?campaign=${campaign}`)),
  });
  const record = useQuery({
    queryKey: ["fertilization-record", farmId, campaign],
    queryFn: () => api.get<FertilizationRecord>(farmPath(farmId, `/fertilization/record?campaign=${campaign}`)),
  });
  const inZone = parcels.filter((p) => p.zone?.status === "in" || p.zone?.status === "partial");
  if (!inZone.length) return null;
  const soilTab = (id: string) => `/f/${farmId}/land-parcels/${id}?tab=soil`;

  const used = [...(fertilizers.data?.values() ?? [])].filter((f) => f.usage > 0);
  const comp = (f: FertilizerArticle) => f.composition ?? f.proposal;
  const noNitrogen = used.filter((f) => {
    const c = comp(f);
    return !c || (c.nTotal > 0 && !c.nitrateType);
  });
  const organics = used.filter((f) => {
    const c = comp(f);
    return c && c.basis !== "mass_percent" && c.nTotal > 0 && (!c.proProduct || (!c.aplshProduct && !c.cN));
  });
  const incomplete = (plans.data?.items ?? []).filter((p) => p.missing > 0 && !p.currentVersion);
  const cover = (record.data?.parcels ?? []).filter((p) => p.soilCover?.level === "warning");
  const year = campaign;

  const steps: Step[] = [
    {
      key: "soil",
      title: "Type de sol des parcelles en zone vulnérable",
      why: "Il fixe l'azote restant à la récolte, la minéralisation de l'humus et le reliquat estimé : sans lui, pas de dose.",
      done: inZone.every((p) => !!p.soil.soilType),
      todo: inZone.filter((p) => !p.soil.soilType).map((p) => ({ label: `Sol de ${p.name}`, to: soilTab(p.parcelId) })),
    },
    {
      key: "analysis",
      title: `Analyse de terre de la campagne ${year}`,
      why: "Obligatoire chaque année au-delà de 3 ha en zone vulnérable ; son pH et sa CEC servent aussi à noter l'efficacité des apports.",
      done: analysisDone !== false,
      todo: analysisDone === false ? [{ label: `Ajouter une analyse (${inZone[0]!.name}, onglet Sol)`, to: soilTab(inZone[0]!.parcelId) }] : [],
    },
    {
      key: "fertilizers",
      title: "Composition des fertilisants utilisés",
      why: "Teneur en azote et type (programme nitrates) : sans eux, l'azote apporté n'est pas compté et le calendrier n'est pas vérifié.",
      done: fertilizers.isSuccess && noNitrogen.length === 0,
      todo: noNitrogen.map((f) => ({ label: f.name, to: `/f/${farmId}/fertilizers` })),
    },
    {
      key: "organics",
      title: "Références des produits organiques",
      why: "Ligne de l'annexe 5 (équivalent minéral déduit de la dose) et dénomination COMIFER ou C/N (azote libéré avant l'hiver).",
      done: fertilizers.isSuccess && organics.length === 0,
      todo: organics.map((f) => ({ label: f.name, to: `/f/${farmId}/fertilizers` })),
    },
    {
      key: "plans",
      title: `Plans de fumure ${year} calculables`,
      why: "Un plan auquel il manque une donnée n'a pas de dose ; il doit être établi avant le premier apport de sortie d'hiver.",
      done: plans.isSuccess && incomplete.length === 0,
      todo: incomplete.map((p) => ({ label: `${p.parcel.name} (${p.missing} donnée${p.missing > 1 ? "s" : ""} à saisir)`, to: `/f/${farmId}/fertilization/plans/${p.id}` })),
    },
    {
      key: "cover",
      title: "Couverture des sols après la récolte du précédent",
      why: "Programme régional : couvert implanté à temps, ou cannes de maïs broyées et enfouies dans les 15 jours.",
      done: record.isSuccess && cover.length === 0,
      todo: cover.map((p) => {
        const s = p.soilCover!;
        const q = new URLSearchParams({ procedure: "crop_residues_grinding", status: "done", ...(s.previousParcelId ? { parcels: s.previousParcelId } : {}), ...(s.harvestedOn ? { at: s.harvestedOn } : {}) });
        return {
          label: `${p.name} : saisir le broyage des cannes${s.harvestedOn ? ` (récolte du ${formatDate(s.harvestedOn)})` : ""}, ou le couvert dans le plan`,
          to: `/f/${farmId}/interventions/new?${q}`,
        };
      }),
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) {
    return (
      <Paper withBorder p="sm" aria-label="Démarrage">
        <Group gap="xs">
          <ThemeIcon size="sm" color="lichen" radius="xl">
            <Check size={12} />
          </ThemeIcon>
          <Text size="sm">Tout ce dont Fourmy a besoin pour la campagne {year} est saisi.</Text>
        </Group>
      </Paper>
    );
  }
  return (
    <Paper withBorder p="md" aria-label="Démarrage">
      <Group justify="space-between" mb={4}>
        <Title order={2} size="h4">
          À compléter pour la campagne {year}
        </Title>
        <Badge variant="light" color="paille">
          {done} sur {steps.length}
        </Badge>
      </Group>
      <Progress value={(done / steps.length) * 100} size="sm" color="lichen" mb="sm" />
      <Stack gap="sm">
        {steps.map((s) => (
          <Group key={s.key} align="flex-start" wrap="nowrap" gap="sm" aria-label={s.title}>
            <ThemeIcon size="sm" radius="xl" color={s.done ? "lichen" : "paille"} variant={s.done ? "filled" : "light"} mt={2}>
              {s.done ? <Check size={12} /> : <CircleDashed size={12} />}
            </ThemeIcon>
            <div>
              <Text size="sm" fw={600} c={s.done ? "dimmed" : undefined}>
                {s.title}
              </Text>
              {!s.done && (
                <>
                  <Text size="xs" c="dimmed">
                    {s.why}
                  </Text>
                  <List size="sm" spacing={0} mt={2}>
                    {s.todo.slice(0, MAX_LINKS).map((t) => (
                      <List.Item key={t.label}>
                        <Anchor component={Link} to={t.to} size="sm">
                          {t.label}
                        </Anchor>
                      </List.Item>
                    ))}
                  </List>
                  {s.todo.length > MAX_LINKS && (
                    <Text size="xs" c="dimmed">
                      et {s.todo.length - MAX_LINKS} autre{s.todo.length - MAX_LINKS > 1 ? "s" : ""}.
                    </Text>
                  )}
                </>
              )}
            </div>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}
