import { Link, useParams, useSearchParams } from "react-router";
import { Anchor, Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  BALANCE_TERM_LABELS,
  BALANCE_TERMS,
  COVER_FAMILY_LABELS,
  COVER_KIND_LABELS,
  DESTRUCTION_MODE_LABELS,
  NITRATE_ZONE_LABELS,
  type FertilizationPlan,
  type FertilizationPlanSummary,
  type FertilizationRecord,
  type NitrateZoneStatus,
} from "@fourmy/contracts";
import { NA_SOIL_TYPE_LABELS, isNaSoilType } from "@fourmy/fertilization-refs";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import "./print.css";

const soil = (s: string | null) => (s && isNaSoilType(s) ? NA_SOIL_TYPE_LABELS[s].split(" (")[0] : "non renseigné");
const zone = (z: string | null) => (z ? NITRATE_ZONE_LABELS[z as NitrateZoneStatus] : "zonage non déterminé");
const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));

/**
 * Éditions de la directive nitrates (lot AH, FR-FERT-34) : cahier
 * d'enregistrement et plans prévisionnels de fumure d'une campagne, en pages
 * imprimables (« Imprimer », puis « Enregistrer en PDF »), lisibles sans Fourmy.
 */
export function PrintPage() {
  const farm = useFarm();
  const { doc } = useParams();
  const [params] = useSearchParams();
  const campaign = Number(params.get("campaign") ?? new Date().getFullYear());
  return (
    <div className="print-page">
      <Group justify="space-between" className="no-print" mb="md">
        <Anchor component={Link} to={`/f/${farm.id}/fertilization`}>
          ← Fertilisation azotée
        </Anchor>
        <Group>
          {doc === "record" && (
            <Button variant="light" component="a" href={`/api/v1${farmPath(farm.id, `/fertilization/record?campaign=${campaign}&format=csv`)}`} download>
              CSV
            </Button>
          )}
          <Button onClick={() => window.print()}>Imprimer ou enregistrer en PDF</Button>
        </Group>
      </Group>
      {doc === "record" ? <RecordDoc farmId={farm.id} farmName={farm.name} campaign={campaign} /> : <PlansDoc farmId={farm.id} farmName={farm.name} campaign={campaign} />}
    </div>
  );
}

function Header({ title, farmName, campaign, from, to }: { title: string; farmName: string; campaign: number; from?: string; to?: string }) {
  return (
    <Stack gap={2} mb="md">
      <Title order={1} size="h2">
        {title}
      </Title>
      <Text size="sm">
        Exploitation : <b>{farmName}</b> · Campagne {campaign}
        {from && to ? ` (du ${formatDate(from)} au ${formatDate(to)})` : ""}
      </Text>
      <Text size="xs" c="dimmed">
        Programme d'actions national nitrates (arrêté du 19/12/2011 modifié le 30/01/2023, annexe I, partie IV) ; référentiel régional Nouvelle-Aquitaine du
        29/07/2025. Document à conserver au moins 5 campagnes. Édité le {formatDate(new Date().toISOString())} par Fourmy.
      </Text>
    </Stack>
  );
}

function RecordDoc({ farmId, farmName, campaign }: { farmId: string; farmName: string; campaign: number }) {
  const q = useQuery({ queryKey: ["fertilization-record", farmId, campaign], queryFn: () => api.get<FertilizationRecord>(farmPath(farmId, `/fertilization/record?campaign=${campaign}`)) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const r = q.data!;
  return (
    <>
      <Header title="Cahier d'enregistrement des pratiques de fertilisation azotée" farmName={farmName} campaign={campaign} from={r.from} to={r.to} />
      {(r.toComplete > 0 || r.late > 0) && (
        <Text size="sm" mb="sm" className="no-print" c="paille.8">
          {r.toComplete ? `${r.toComplete} apport(s) dont l'azote n'est pas connu (composition à compléter). ` : ""}
          {r.late ? `${r.late} apport(s) saisi(s) plus de 30 jours après l'épandage.` : ""}
        </Text>
      )}
      {(r.forced ?? []).length > 0 && (
        <Text size="sm" mb="sm" aria-label="Épandages en période d'interdiction">
          Épandages enregistrés en période d'interdiction :{" "}
          {r.forced.map((f) => `${formatDate(f.date)} (${f.parcels.join(", ")}) — motif : ${f.reason ?? "aucun (saisie mobile)"}`).join(" ; ")}.
        </Text>
      )}
      {r.parcels.map((p) => (
        <section key={p.parcelId} className="print-block" aria-label={`Cahier ${p.name}`}>
          <Title order={2} size="h4">
            {p.name} · {n(p.areaHa)} ha
          </Title>
          <Text size="sm">
            {zone(p.zone)} · sol : {soil(p.soilType)} · culture : <b>{p.crop}</b>
            {p.variety ? ` (${p.variety})` : ""} · semis {p.sownOn ? formatDate(p.sownOn) : "non saisi"} · récolte{" "}
            {p.harvestedOn.length ? p.harvestedOn.map(formatDate).join(", ") : "non saisie"} · rendement réalisé {p.yieldQHa !== null ? `${n(p.yieldQHa)} q/ha` : "non saisi"}
          </Text>
          <Text size="sm">
            Interculture et résidus : {p.interculture.length ? p.interculture.map((i) => `${i.label} le ${formatDate(i.date)}`).join(", ") : "rien de saisi"}
            {p.noPlowing === false ? " · labour sur la période" : ""}
          </Text>
          <Text size="sm">
            Couvert d'interculture :{" "}
            {p.cover
              ? `${p.cover.species} (${p.cover.family ? COVER_FAMILY_LABELS[p.cover.family] : COVER_KIND_LABELS[p.cover.kind].toLowerCase()}), ${p.cover.kind === "sown" ? "semé" : "levées"} le ${formatDate(p.cover.sownOn)}, ${p.cover.destroyedOn ? `détruit le ${formatDate(p.cover.destroyedOn)}` : "destruction non saisie"}${p.cover.destructionMode ? ` (${DESTRUCTION_MODE_LABELS[p.cover.destructionMode].toLowerCase()})` : ""}${p.cover.exported ? ", exporté" : ""}`
              : "aucun saisi"}
            {p.soilCover && p.soilCover.situation !== "none" && (
              <Text span size="sm" c={p.soilCover.level === "warning" ? "brique.7" : undefined}>
                {" "}
                · couverture des sols : {p.soilCover.level === "ok" ? "conforme" : p.soilCover.level === "warning" ? "à vérifier" : "non vérifiée"}
                {p.soilCover.messages.length ? ` (${p.soilCover.messages.join(" ")})` : ""}
              </Text>
            )}
          </Text>
          {(p.steering ?? []).length > 0 && (
            <Text size="sm">
              Pilotage :{" "}
              {p.steering.map((m) => `${m.tool}${m.value ? ` ${m.value}` : ""} le ${formatDate(m.measuredOn)}${m.stage ? ` (${m.stage})` : ""}, ${m.advisedKgNHa} kg N/ha conseillés`).join(" ; ")}
            </Text>
          )}
          <Table fz="xs" mt={4} withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Surface (ha)</Table.Th>
                <Table.Th>Fertilisant</Table.Th>
                <Table.Th>Teneur</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Dose</Table.Th>
                <Table.Th>N total (kg/ha)</Table.Th>
                <Table.Th>N efficace (kg/ha)</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {p.applications.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={8}>Aucun apport d'azote.</Table.Td>
                </Table.Tr>
              ) : (
                p.applications.map((a, k) => (
                  <Table.Tr key={k}>
                    <Table.Td>{formatDate(a.date)}</Table.Td>
                    <Table.Td>{n(a.areaHa)}</Table.Td>
                    <Table.Td>{a.product}</Table.Td>
                    <Table.Td>{a.content ?? "—"}</Table.Td>
                    <Table.Td>{a.nitrateType ?? "—"}</Table.Td>
                    <Table.Td>{a.doseLabel}</Table.Td>
                    <Table.Td>{a.nTotalKgHa === null ? (a.missing ?? "—") : n(a.nTotalKgHa)}</Table.Td>
                    <Table.Td>{n(a.nEfficientKgHa)}</Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
          <Text size="sm" mt={4}>
            Total : <b>{p.totalNKgHa} kg N efficace/ha</b>
            {p.plannedDose !== null ? ` pour ${p.plannedDose} kg prévus au plan (version ${p.planVersion})` : " · pas de plan établi"}.
          </Text>
        </section>
      ))}
    </>
  );
}

function PlansDoc({ farmId, farmName, campaign }: { farmId: string; farmName: string; campaign: number }) {
  const list = useQuery({
    queryKey: ["fertilization-plans", farmId, campaign],
    queryFn: () => api.get<{ items: FertilizationPlanSummary[] }>(farmPath(farmId, `/fertilization/plans?campaign=${campaign}`)),
  });
  const plans = useQueries({
    queries: (list.data?.items ?? []).map((p) => ({ queryKey: ["fertilization-plan", farmId, p.id], queryFn: () => api.get<FertilizationPlan>(farmPath(farmId, `/fertilization/plans/${p.id}`)) })),
  });
  if (list.isLoading || plans.some((p) => p.isLoading)) return <Loading />;
  if (list.error) return <ErrorAlert error={list.error} />;
  return (
    <>
      <Header title="Plan prévisionnel de fumure azotée" farmName={farmName} campaign={campaign} />
      <Table fz="xs" withTableBorder mb="md" aria-label="Synthèse des plans">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Îlot cultural</Table.Th>
            <Table.Th>Surface (ha)</Table.Th>
            <Table.Th>Culture</Table.Th>
            <Table.Th>Zonage</Table.Th>
            <Table.Th>État</Table.Th>
            <Table.Th>Dose (kg N efficace/ha)</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(list.data?.items ?? []).map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{p.parcel.name}</Table.Td>
              <Table.Td>{n(p.parcel.areaM2 / 10_000)}</Table.Td>
              <Table.Td>{p.cropLabel}</Table.Td>
              <Table.Td>{zone(p.zone)}</Table.Td>
              <Table.Td>{p.status === "draft" ? "brouillon" : `établi (v${p.currentVersion}, ${p.establishedAt ? formatDate(p.establishedAt) : ""})`}</Table.Td>
              <Table.Td>{p.dose ?? "—"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {plans.map((q) => {
        const p = q.data;
        if (!p) return null;
        const v = p.versions[0];
        const c = v?.snapshot.context ?? p.context;
        const r = v?.snapshot.result ?? p.result;
        const apps = v?.applications ?? p.proposedApplications;
        return (
          <section key={p.id} className="print-block print-break" aria-label={`Plan ${p.parcel.name}`}>
            <Title order={2} size="h4">
              {p.parcel.name} · {n(p.parcel.areaM2 / 10_000)} ha · {c.cropLabel}
              {c.variety ? ` (${c.variety})` : ""}
            </Title>
            <Text size="sm">
              {v ? `Version ${v.version} établie le ${formatDate(v.establishedAt)}${v.establishedBy ? ` par ${v.establishedBy}` : ""}${v.reason ? ` — ${v.reason}` : ""}` : "Brouillon, non établi"} · {zone(c.zone)} · sol :{" "}
              {soil(c.soilType)} · {c.irrigated ? "irriguée" : "en sec"}
            </Text>
            <Text size="sm">
              Objectif de production : {c.yieldTarget ? `${n(c.yieldTarget.value)} q/ha (${c.yieldTarget.detail})` : "—"} · précédent :{" "}
              {c.previous ? `${c.previous.label}, ${n(c.previous.yieldRealized)} q/ha` : "—"} · reliquat : {c.rsh ? `${c.rsh.kgNHa} kg N/ha mesuré le ${formatDate(c.rsh.sampledOn)}` : "estimé"}
            </Text>
            {c.opening && (
              <Text size="sm">
                Ouverture du bilan : {formatDate(c.opening.on)} · implantation : {c.sowing?.sownOn ? `semée le ${formatDate(c.sowing.sownOn)}` : (c.sowing?.period ?? "non précisée")}
                {c.cover ? ` · couvert : ${c.cover.species}` : ""}
              </Text>
            )}
            <Text size="xs" mt={4}>
              {r.equation} (annexe {r.annex})
            </Text>
            <Table fz="xs" withTableBorder mt={4}>
              <Table.Tbody>
                {BALANCE_TERMS.filter((t) => r.terms[t]).map((t) => {
                  const x = r.terms[t]!;
                  return (
                    <Table.Tr key={t}>
                      <Table.Td>{BALANCE_TERM_LABELS[t]}</Table.Td>
                      <Table.Td>{"missing" in x ? `manquant : ${x.missing}` : t === "CAU" ? x.value : `${x.value} kg N/ha`}</Table.Td>
                      <Table.Td>{"missing" in x ? "" : `${x.detail ? `${x.detail} · ` : ""}${x.source}`}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
            <Text size="sm" mt={4}>
              Dose : <b>{v?.doseEfficient ?? p.draft.external?.doseKgNHa ?? r.dose ?? "—"} kg N efficace/ha</b>
              {(v?.external ?? p.draft.external) ? ` (calculée par ${(v?.external ?? p.draft.external)!.tool}${r.dose !== null ? `, Fourmy : ${r.dose} kg` : ""})` : ""}
            </Text>
            <Table fz="xs" withTableBorder mt={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Apport prévu</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>N efficace (kg/ha)</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {apps.map((a, k) => (
                  <Table.Tr key={k}>
                    <Table.Td>{a.stage}</Table.Td>
                    <Table.Td>{a.plannedOn ? formatDate(a.plannedOn) : "—"}</Table.Td>
                    <Table.Td>{a.nKgHa}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </section>
        );
      })}
    </>
  );
}
