import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, Stack, Tabs, Text, Title } from "@mantine/core";
import { PLANT_FAMILIES, PRICE_KIND_LABELS, PROCEDURES, getProcedure, itkProcedureAllowed, priceKey, unitLabel, type ArticleKind, type Price, type PriceKind } from "@fourmy/contracts";
import { useFarm } from "../../app/farm";
import { ARTICLE_KIND_LABELS } from "../../app/labels";
import { useActivities, useArticles } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { useEquipmentRates } from "../itk/work";
import { PriceTable, fmtEuro, type PriceRow } from "./PriceTable";
import { useArticleSuggestions, useProductSuggestions, usePrices } from "./queries";

const today = () => new Date().toISOString().slice(0, 10);
const TABS: PriceKind[] = ["article", "equipment", "labour", "service", "product"];
const INPUT_KINDS: ArticleKind[] = ["seed", "fertilizer", "phyto", "other"];
const MASS_UNITS = ["kilogram", "ton", "quintal", "liter", "hectoliter", "cubic_meter", "unity"];

/** Prix en vigueur d'une nature, par clé. */
function useCurrent(farmId: string, kind: PriceKind) {
  const q = usePrices(farmId, kind, today());
  const byKey = useMemo(() => new Map((q.data?.items ?? []).map((p) => [priceKey(p), p])), [q.data]);
  return { q, get: (ref: Partial<Price>) => byKey.get(priceKey({ kind, articleId: null, equipmentId: null, activityId: null, product: null, procedure: null, ...ref })) ?? null };
}

/**
 * Module « Économique » (temps 3, lot E1, FR-AS-30) : les prix de la ferme
 * par nature (intrants, matériels, main-d'œuvre, services, produits),
 * consultés, saisis et modifiés en masse, datés et sourcés.
 */
export function EconomicsPage() {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as PriceKind) ? params.get("tab") : "article") as PriceKind;
  return (
    <Stack>
      <Title order={1}>Économique</Title>
      <Text size="sm" c="dimmed">
        Prix hors taxes de la ferme, datés : un nouveau prix s'ajoute à partir de sa date d'effet et l'ancien reste dans l'historique. Ils servent au calcul des marges de
        l'assolement.
      </Text>
      <Tabs value={tab} onChange={(v) => setParams(v ? { tab: v } : {})}>
        <Tabs.List>
          {TABS.map((k) => (
            <Tabs.Tab key={k} value={k}>
              {PRICE_KIND_LABELS[k]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value={tab} pt="md">
          {tab === "article" && <InputsTab farmId={farm.id} owner={owner} />}
          {tab === "equipment" && <EquipmentTab farmId={farm.id} owner={owner} />}
          {tab === "labour" && <LabourTab farmId={farm.id} owner={owner} />}
          {tab === "service" && <ServicesTab farmId={farm.id} owner={owner} />}
          {tab === "product" && <ProductsTab farmId={farm.id} owner={owner} />}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function InputsTab({ farmId, owner }: { farmId: string; owner: boolean }) {
  const articles = useArticles(farmId);
  const { q, get } = useCurrent(farmId, "article");
  const refs = useArticleSuggestions(farmId);
  const byArticle = new Map((refs.data?.items ?? []).map((i) => [i.articleId, i]));
  if (articles.isLoading || q.isLoading) return <Loading />;
  if (articles.error || q.error) return <ErrorAlert error={articles.error ?? q.error} />;
  const rows: PriceRow[] = (articles.data?.items ?? [])
    .filter((a) => INPUT_KINDS.includes(a.kind as ArticleKind))
    .sort((a, b) => INPUT_KINDS.indexOf(a.kind as ArticleKind) - INPUT_KINDS.indexOf(b.kind as ArticleKind) || a.name.localeCompare(b.name, "fr"))
    .map((a) => ({
      label: a.name,
      sub: `${ARTICLE_KIND_LABELS[a.kind] ?? a.kind} · stock en ${unitLabel(a.unit) || a.unit}`,
      ref: { articleId: a.id },
      unit: a.unit,
      units: [a.unit, ...MASS_UNITS, ...(a.kind === "seed" ? ["dose", "thousand"] : [])],
      current: get({ articleId: a.id }),
      suggestions: byArticle.get(a.id)?.suggestions,
      hint: byArticle.get(a.id) ? (
        <Text size="xs" c="dimmed">
          Référence : {byArticle.get(a.id)!.match}
        </Text>
      ) : undefined,
    }));
  return (
    <Stack gap="xs">
      {(refs.data?.items.length ?? 0) > 0 && (
        <Alert color="gray" p="xs">
          Prix de référence relevés par Cereapro et Germineo (jeux Lexicon réservés aux adhérents, réutilisation avec attribution) : prix livrés hors taxes,
          par conditionnement, du dernier mois relevé. « Reprendre » remplit le prix avec sa source ; il reste à l'enregistrer.
        </Alert>
      )}
      <PriceTable farmId={farmId} kind="article" rows={rows} owner={owner} label="Intrant" />
    </Stack>
  );
}

function EquipmentTab({ farmId, owner }: { farmId: string; owner: boolean }) {
  const list = useEquipmentRates(farmId);
  const { q, get } = useCurrent(farmId, "equipment");
  if (list.isLoading || q.isLoading) return <Loading />;
  if (list.error || q.error) return <ErrorAlert error={list.error ?? q.error} />;
  const rows: PriceRow[] = (list.data?.items ?? []).map((e) => {
    const r = e.rate;
    const bcma = r?.costPerUnit !== undefined ? `${fmtEuro(r.costPerUnit)} / ${r.unit === "hectares" ? "ha" : r.unit === "heures" ? "h" : r.unit}` : null;
    return {
      label: e.name,
      sub: e.carrier ? "tracteur ou porteur" : (r?.label ?? "non rattaché au barème"),
      ref: { equipmentId: e.id },
      unit: r?.unit === "heures" || e.carrier ? "hour" : "hectare",
      units: ["hectare", "hour"],
      current: get({ equipmentId: e.id }),
      fallback: bcma ? "barème BCMA" : undefined,
      hint: bcma ? (
        <Text size="xs" c="dimmed">
          Barème BCMA : {bcma}
        </Text>
      ) : (
        <Text size="xs" c="dimmed" component={Link} to={`/f/${farmId}/equipments/${e.id}`}>
          Rattacher au barème…
        </Text>
      ),
    };
  });
  return (
    <Stack gap="xs">
      <Alert color="gray" p="xs">
        Sans prix propre, un matériel est compté à son coût du barème BCMA « façons culturales » (coûts fixe et variable, carburant compris). Un prix saisi ici le remplace.
      </Alert>
      <PriceTable farmId={farmId} kind="equipment" rows={rows} owner={owner} label="Matériel" />
    </Stack>
  );
}

function LabourTab({ farmId, owner }: { farmId: string; owner: boolean }) {
  const { q, get } = useCurrent(farmId, "labour");
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const rows: PriceRow[] = [{ label: "Coût horaire de la main-d'œuvre", sub: "salaire et charges, par heure de travail", ref: {}, unit: "hour", units: ["hour"], current: get({}) }];
  return <PriceTable farmId={farmId} kind="labour" rows={rows} owner={owner} label="Main-d'œuvre" />;
}

function ServicesTab({ farmId, owner }: { farmId: string; owner: boolean }) {
  const { q, get } = useCurrent(farmId, "service");
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  // Toutes les procédures d'un itinéraire, vigne comprise (vendange, pulvérisation en prestation).
  const rows: PriceRow[] = PROCEDURES.filter((p) => itkProcedureAllowed(p.code))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"))
    .map((p) => ({ label: getProcedure(p.code).label, sub: "prestation (ETA, CUMA)", ref: { procedure: p.code }, unit: "hectare", units: ["hectare", "hour"], current: get({ procedure: p.code }) }));
  return <PriceTable farmId={farmId} kind="service" rows={rows} owner={owner} label="Prestation" />;
}

function ProductsTab({ farmId, owner }: { farmId: string; owner: boolean }) {
  const activities = useActivities(farmId, new Date().getFullYear());
  const { q, get } = useCurrent(farmId, "product");
  const refs = useProductSuggestions(farmId);
  const byActivity = new Map((refs.data?.items ?? []).map((i) => [i.activityId, i]));
  const dept = refs.data?.department;
  if (activities.isLoading || q.isLoading) return <Loading />;
  if (activities.error || q.error) return <ErrorAlert error={activities.error ?? q.error} />;
  // Un produit principal par activité au premier lot ; les autres produits (paille…) viendront avec les prévisions (lot E3).
  const rows: PriceRow[] = (activities.data?.items ?? [])
    .filter((a) => !a.suspended && PLANT_FAMILIES.includes(a.family))
    .map((a) => {
      const ref = byActivity.get(a.id);
      const y = ref?.yields[0];
      return {
        label: a.name,
        sub: y ? `produit principal · rendement Agreste ${dept} : ${y.value.toLocaleString("fr-FR")} q/ha en ${y.campaign}` : "produit principal",
        ref: { activityId: a.id, product: "principal" },
        unit: "ton",
        units: ["ton", "quintal", "kilogram", "hectoliter", "unity"],
        current: get({ activityId: a.id, product: "principal" }),
        suggestions: ref?.suggestions,
      };
    });
  return (
    <Stack gap="xs">
      <Alert color="gray" p="xs">
        Repères Lexicon pour les productions à grain : prix payés aux producteurs (Agreste, département et France), cours MATIF et prix de marché européens
        (Commission européenne). « Reprendre » remplit le prix avec sa source ; il reste à l'enregistrer.
      </Alert>
      <PriceTable farmId={farmId} kind="product" rows={rows} owner={owner} label="Production" />
    </Stack>
  );
}
