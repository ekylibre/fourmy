import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  BALANCE_TERM_LABELS,
  BALANCE_TERMS,
  COVER_BIOMASS_LABELS,
  COVER_FAMILY_LABELS,
  COVER_KIND_LABELS,
  DESTRUCTION_MODE_LABELS,
  type SteeringMeasurement,
  type SteeringWrite,
  type BalanceTerm,
  type CoverCrop,
  type CoverCropWrite,
  type FertilizationPlan,
  type PlanDraft,
  type PlannedApplication,
  type PlanTermValue,
} from "@fourmy/contracts";
import {
  NA_SOIL_TYPE_LABELS,
  isNaSoilType,
  naRapeseedMha,
} from "@fourmy/fertilization-refs";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate, formatDateTime } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { useFertilizers } from "./fertilization";
import { Documents } from "./Documents";

const ORIGIN: Record<string, { label: string; color: string }> = {
  computed: { label: "calculé", color: "ardoise" },
  measured: { label: "mesuré", color: "lichen" },
  reference: { label: "référentiel", color: "gray" },
  entered: { label: "saisi", color: "lichen" },
  override: { label: "valeur de la ferme", color: "paille" },
};
const STATUS: Record<
  FertilizationPlan["status"],
  { label: string; color: string }
> = {
  draft: { label: "Brouillon", color: "paille" },
  established: { label: "Établi", color: "lichen" },
  revised: { label: "Révisé", color: "lichen" },
};
const fmt = (v: number) =>
  v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export function usePlan(farmId: string, planId: string) {
  return useQuery({
    queryKey: ["fertilization-plan", farmId, planId],
    queryFn: () =>
      api.get<FertilizationPlan>(
        farmPath(farmId, `/fertilization/plans/${planId}`),
      ),
  });
}

/**
 * Plan prévisionnel de fumure d'une parcelle (lot AG, FR-FERT-9 à 15) : ce que
 * Fourmy a rassemblé, les saisies qui manquent, le bilan terme par terme avec
 * ses sources, les apports prévus, la dose d'un outil ou d'un conseiller,
 * l'établissement et les versions.
 */
export function PlanPage() {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const { planId = "" } = useParams();
  const location = useLocation();
  const client = useQueryClient();
  const q = usePlan(farm.id, planId);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [overriding, setOverriding] = useState<BalanceTerm | null>(null);
  const [establishing, setEstablishing] = useState(false);
  useEffect(() => {
    if (q.data && draft === null) setDraft(q.data.draft);
  }, [q.data, draft]);
  const save = useMutation({
    mutationFn: (d: PlanDraft) =>
      api.put<FertilizationPlan>(
        farmPath(farm.id, `/fertilization/plans/${planId}/draft`),
        d,
      ),
    onSuccess: (p) => {
      client.setQueryData(["fertilization-plan", farm.id, planId], p);
      setDraft(p.draft);
      void client.invalidateQueries({
        queryKey: ["fertilization-plans", farm.id],
      });
    },
  });
  if (q.isLoading || !draft) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const p = q.data!;
  const c = p.context;
  const r = p.result;
  const update = (patch: Partial<PlanDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    save.mutate(next);
  };
  const dose = draft.external?.doseKgNHa ?? r.dose;
  // Plan d'un couvert exporté (lot AQ) : ni bilan détaillé, ni couvert, ni pilotage.
  const isCover = p.kind === "cover_exported";
  const applications = draft.applications?.length
    ? draft.applications
    : p.proposedApplications;

  return (
    <Stack>
      <div>
        <Anchor
          component={Link}
          to={`/f/${farm.id}/fertilization${location.search}`}
          size="sm"
        >
          ← Fertilisation azotée
        </Anchor>
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={1}>
              Plan de fumure {p.campaign} : {p.parcel.name}
            </Title>
            <Text size="sm" c="dimmed">
              {c.cropLabel}
              {c.variety ? ` (${c.variety})` : ""} ·{" "}
              {(p.parcel.areaM2 / 10_000).toLocaleString("fr-FR", {
                maximumFractionDigits: 2,
              })}{" "}
              ha ·{" "}
              {r.annex
                ? `méthode de l'annexe ${r.annex} du référentiel régional`
                : "méthode à déterminer"}
            </Text>
          </div>
          <Badge size="lg" variant="light" color={STATUS[p.status].color}>
            {STATUS[p.status].label}
            {p.currentVersion ? ` · version ${p.currentVersion}` : ""}
          </Badge>
        </Group>
      </div>

      {isCover && (
        <Paper withBorder p="md" aria-label="Couvert exporté">
          <Title order={4} mb="xs">
            Couvert exporté
          </Title>
          {c.cover ? (
            <Text size="sm">
              {c.cover.species}
              {c.cover.family
                ? ` (${COVER_FAMILY_LABELS[c.cover.family]})`
                : ""}
              , semé le {formatDate(c.cover.sownOn)}
              {c.cover.destroyedOn
                ? `, récolté ou détruit le ${formatDate(c.cover.destroyedOn)}`
                : ", récolte à saisir"}
              . Le guide du PAR 7 demande un plan séparé pour ce couvert ; ses
              apports figurent aussi au cahier de la culture principale.
            </Text>
          ) : (
            <Missing>
              Couvert à saisir dans le plan de la culture principale.
            </Missing>
          )}
        </Paper>
      )}

      {!isCover && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Paper withBorder p="md" aria-label="Données de la parcelle">
            <Title order={4} mb="xs">
              Ce que Fourmy sait
            </Title>
            <Table fz="sm">
              <Table.Tbody>
                <Row label="Sol">
                  {c.soilType && isNaSoilType(c.soilType) ? (
                    NA_SOIL_TYPE_LABELS[c.soilType].split(" (")[0]
                  ) : (
                    <Missing>
                      à renseigner dans l'onglet Sol de la parcelle
                    </Missing>
                  )}
                  {c.irrigated ? " · irriguée" : " · en sec"}
                </Row>
                <Row label="Précédent">
                  {c.previous ? (
                    <>
                      {c.previous.label} ({c.previous.parcelName}) :{" "}
                      {c.previous.yieldRealized !== null
                        ? `${fmt(c.previous.yieldRealized)} q/ha récoltés`
                        : "rendement non saisi"}
                      ,{" "}
                      {c.previous.xMineral !== null
                        ? `${c.previous.xMineral} kg N minéral apportés`
                        : "apports inconnus"}
                    </>
                  ) : (
                    <Missing>
                      aucune culture l'an passé sur cette surface
                    </Missing>
                  )}
                </Row>
                <Row label="Objectif de rendement">
                  {c.yieldTarget ? (
                    `${fmt(c.yieldTarget.value)} q/ha (${c.yieldTarget.detail})`
                  ) : (
                    <Missing>à saisir</Missing>
                  )}
                </Row>
                <Row label="Ouverture du bilan">
                  {formatDate(c.opening.on)} (
                  {c.opening.origin === "entered"
                    ? "saisie"
                    : c.opening.origin === "rsh"
                      ? "date du reliquat mesuré"
                      : "date par défaut"}
                  )
                </Row>
                <Row label="Implantation">
                  {c.sowing.sownOn ? (
                    `semée le ${formatDate(c.sowing.sownOn)}`
                  ) : c.sowing.period ? (
                    `prévue : ${c.sowing.period}`
                  ) : (
                    <Missing>période d'implantation à saisir</Missing>
                  )}
                </Row>
                <Row label="Reliquat mesuré">
                  {c.rsh
                    ? `${c.rsh.kgNHa} kg N/ha le ${formatDate(c.rsh.sampledOn)}`
                    : "aucun : estimé d'après le précédent et la pluie"}
                </Row>
                <Row label="Pluie depuis le 1er octobre">
                  {c.rain ? (
                    `${c.rain.mm} mm jusqu'au ${formatDate(c.rain.to)}${c.rain.normalsFrom ? ` (normales à partir du ${formatDate(c.rain.normalsFrom)})` : ""}`
                  ) : (
                    <Missing>météo indisponible</Missing>
                  )}
                </Row>
                {c.irrigated && (
                  <Row label="Eau d'irrigation">
                    {c.water.name ?? "point d'eau non choisi"}
                    {c.water.no3MgL !== null
                      ? ` · ${c.water.no3MgL} mg NO3/L mesurés`
                      : c.water.origin
                        ? ` · teneur de référence (${c.water.origin === "surface" ? "25" : "40"} mg/L)`
                        : ""}
                  </Row>
                )}
              </Table.Tbody>
            </Table>
          </Paper>

          <Paper withBorder p="md" aria-label="Saisies du plan">
            <Title order={4} mb="xs">
              Saisies
            </Title>
            <SimpleGrid cols={2}>
              <NumberInput
                label="Objectif de rendement (q/ha)"
                description={
                  c.yieldTarget && c.yieldTarget.origin !== "entered"
                    ? `Calculé : ${fmt(c.yieldTarget.value)}`
                    : undefined
                }
                placeholder={
                  c.yieldTarget ? fmt(c.yieldTarget.value) : undefined
                }
                disabled={!owner}
                min={0}
                decimalSeparator=","
                value={draft.yieldTarget ?? ""}
                onBlur={(e) => {
                  const v = e.currentTarget.value
                    .replace(",", ".")
                    .replace(/[^\d.]/g, "");
                  update({ yieldTarget: v ? Number(v) : null });
                }}
              />
              <TextInput
                label="Date d'ouverture du bilan"
                type="date"
                description={
                  draft.openingOn
                    ? undefined
                    : `Par défaut : ${formatDate(c.opening.on)}`
                }
                disabled={!owner}
                value={draft.openingOn ?? ""}
                onChange={(e) =>
                  update({ openingOn: e.currentTarget.value || null })
                }
              />
              <TextInput
                label="Période d'implantation"
                placeholder="15 avril – 10 mai"
                disabled={!owner}
                defaultValue={draft.sowingPeriod ?? ""}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim() || null;
                  if (v !== (draft.sowingPeriod ?? null))
                    update({ sowingPeriod: v });
                }}
              />
              {c.irrigated && (
                <NumberInput
                  label="Irrigation prévue (mm)"
                  description={
                    c.irrigationMm && draft.irrigationMm == null
                      ? c.irrigationMm.detail
                      : undefined
                  }
                  placeholder={
                    c.irrigationMm ? String(c.irrigationMm.value) : undefined
                  }
                  disabled={!owner}
                  min={0}
                  value={draft.irrigationMm ?? ""}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.replace(/\D/g, "");
                    update({ irrigationMm: v ? Number(v) : null });
                  }}
                />
              )}
              {c.crop.startsWith("maize") && (
                <NumberInput
                  label="Azote minéral avant 4 feuilles (kg N/ha)"
                  description="Starter au semis : 50 kg au plus (PAR 7)"
                  disabled={!owner}
                  min={0}
                  max={50}
                  value={draft.nBefore4Leaves ?? ""}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.replace(/\D/g, "");
                    update({ nBefore4Leaves: v ? Number(v) : null });
                  }}
                />
              )}
              {c.previous &&
                [
                  "oat",
                  "soft_wheat",
                  "durum_wheat",
                  "improver_wheat",
                  "barley_winter",
                  "barley_spring",
                  "rye",
                  "triticale",
                  "spelt",
                ].includes(c.previous.crop) && (
                  <Select
                    label="Pailles du précédent"
                    data={[
                      { value: "returned", label: "Enfouies (restituées)" },
                      { value: "removed", label: "Enlevées" },
                    ]}
                    disabled={!owner}
                    value={
                      draft.strawReturned == null
                        ? null
                        : draft.strawReturned
                          ? "returned"
                          : "removed"
                    }
                    onChange={(v) =>
                      update({
                        strawReturned: v === null ? null : v === "returned",
                      })
                    }
                  />
                )}
              {[
                "soft_wheat",
                "durum_wheat",
                "improver_wheat",
                "barley_winter",
                "rye",
                "triticale",
                "oat",
              ].includes(c.crop) &&
                c.rsh && (
                  <NumberInput
                    label="Nombre de talles à l'ouverture"
                    disabled={!owner}
                    min={0}
                    value={draft.tillers ?? ""}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.replace(/\D/g, "");
                      update({ tillers: v ? Number(v) : null });
                    }}
                  />
                )}
            </SimpleGrid>
            {c.crop === "rapeseed_winter" && (
              <RapeseedInputs
                owner={owner}
                value={draft.rapeseed}
                onChange={(rapeseed) => update({ rapeseed })}
              />
            )}
            {[
              "soft_wheat",
              "durum_wheat",
              "improver_wheat",
              "barley_winter",
              "rye",
              "triticale",
              "oat",
            ].includes(c.crop) && (
              <Switch
                mt="sm"
                disabled={!owner}
                label="Conditions défavorables (CAU 0,8, sur justificatif)"
                checked={!!draft.unfavourable}
                onChange={(e) =>
                  update({ unfavourable: e.currentTarget.checked })
                }
              />
            )}
            {save.error && <ErrorAlert error={save.error} />}
          </Paper>
        </SimpleGrid>
      )}

      <Paper withBorder p="md" aria-label="Bilan azoté">
        <Group justify="space-between" mb={4}>
          <Title order={4}>Bilan azoté</Title>
          {r.dose !== null && (
            <Text fw={700} className="lv-num" aria-label="Dose calculée">
              {r.method === "ceiling" ? "Dose plafond" : "Dose calculée"} :{" "}
              {r.dose} kg N/ha
            </Text>
          )}
        </Group>
        <Text size="sm" c="dimmed" mb="xs" className="lv-num">
          {r.equation}
        </Text>
        {r.missing.length > 0 && (
          <Alert
            color="paille"
            mb="xs"
            title="Pour calculer la dose, il manque"
          >
            {r.missing.join(" ; ")}.
          </Alert>
        )}
        {r.warnings.map((w) => (
          <Alert key={w} color="brique" variant="light" mb="xs">
            {w}
          </Alert>
        ))}
        {Object.keys(r.terms).length > 0 && (
          <Table aria-label="Termes du bilan" fz="sm">
            <Table.Tbody>
              {BALANCE_TERMS.filter((t) => r.terms[t]).map((t) => (
                <TermRow
                  key={t}
                  term={t}
                  value={r.terms[t]!}
                  owner={owner}
                  overridden={!!draft.overrides?.[t]}
                  onEdit={() => setOverriding(t)}
                  onReset={() => {
                    const { [t]: _drop, ...rest } = draft.overrides ?? {};
                    update({ overrides: rest });
                  }}
                />
              ))}
            </Table.Tbody>
          </Table>
        )}
        {r.floor30 && (
          <Text size="sm" mt="xs">
            Dose inférieure à 30 kg : le forfait de 30 kg est possible si
            l'apport ne peut pas être plus précis (article 12).
          </Text>
        )}
      </Paper>

      <Organics
        farmId={farm.id}
        owner={owner}
        organics={c.organics ?? []}
        planned={draft.organics ?? []}
        onChange={(organics) => update({ organics })}
      />

      {!isCover && (
        <CoverSection
          farmId={farm.id}
          owner={owner}
          parcelId={p.parcel.id}
          campaign={p.campaign}
          cover={c.cover}
          onSaved={() =>
            void client.invalidateQueries({
              queryKey: ["fertilization-plan", farm.id, planId],
            })
          }
        />
      )}

      <ExternalDose
        farmId={farm.id}
        planId={planId}
        owner={owner}
        draft={draft}
        fourmyDose={r.dose}
        onChange={(external) => update({ external })}
      />

      <Applications
        farmId={farm.id}
        owner={owner}
        dose={dose}
        applications={applications}
        proposed={!draft.applications?.length}
        onChange={(apps) => update({ applications: apps })}
        modulate={{ planId, parcelId: p.parcel.id }}
        prescriptions={p.prescriptions ?? []}
      />

      {p.currentVersion && !isCover && (
        <Steering
          farmId={farm.id}
          planId={planId}
          owner={owner}
          steering={p.steering}
          planDose={
            p.versions.find((v) => v.version === p.currentVersion)
              ?.doseEfficient ?? null
          }
          onChanged={() =>
            void client.invalidateQueries({
              queryKey: ["fertilization-plan", farm.id, planId],
            })
          }
        />
      )}

      {owner && (
        <Group>
          <Button
            onClick={() => setEstablishing(true)}
            disabled={dose === null}
          >
            {p.currentVersion ? "Réviser le plan" : "Établir le plan"}
          </Button>
          {dose === null && (
            <Text size="sm" c="dimmed">
              Il faut une dose : calculée par Fourmy ou venue d'un outil ou d'un
              conseiller.
            </Text>
          )}
        </Group>
      )}

      {p.versions.length > 0 && (
        <Paper withBorder p="md" aria-label="Versions">
          <Title order={4} mb="xs">
            Versions établies
          </Title>
          <Table fz="sm">
            <Table.Tbody>
              {p.versions.map((v) => (
                <Table.Tr key={v.version}>
                  <Table.Td>Version {v.version}</Table.Td>
                  <Table.Td className="lv-num">
                    {formatDateTime(v.establishedAt)}
                  </Table.Td>
                  <Table.Td>{v.establishedBy ?? ""}</Table.Td>
                  <Table.Td className="lv-num">
                    {v.doseEfficient} kg N/ha{" "}
                    {v.external ? `(${v.external.tool})` : "(calcul Fourmy)"}
                  </Table.Td>
                  <Table.Td>{v.reason ?? ""}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt={4}>
            Chaque version garde les données, les termes et le référentiel de sa
            date ({p.versions[0]!.referential}).
          </Text>
        </Paper>
      )}

      {overriding && (
        <OverrideModal
          term={overriding}
          current={r.terms[overriding]}
          onClose={() => setOverriding(null)}
          onSave={(value, reason) => {
            update({
              overrides: {
                ...(draft.overrides ?? {}),
                [overriding]: { value, reason },
              },
            });
            setOverriding(null);
          }}
        />
      )}
      {establishing && (
        <EstablishModal
          farmId={farm.id}
          planId={planId}
          revision={!!p.currentVersion}
          dose={dose!}
          onClose={() => setEstablishing(false)}
          onDone={(np) => {
            client.setQueryData(["fertilization-plan", farm.id, planId], np);
            void client.invalidateQueries({
              queryKey: ["fertilization-plans", farm.id],
            });
            setEstablishing(false);
            notifications.show({
              color: "lichen",
              message: `Plan établi (version ${np.currentVersion}).`,
            });
          }}
        />
      )}
    </Stack>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Table.Tr>
      <Table.Td c="dimmed" w={180}>
        {label}
      </Table.Td>
      <Table.Td>{children}</Table.Td>
    </Table.Tr>
  );
}
const Missing = ({ children }: { children: React.ReactNode }) => (
  <Text span size="sm" c="paille.8">
    {children}
  </Text>
);

function TermRow({
  term,
  value,
  owner,
  overridden,
  onEdit,
  onReset,
}: {
  term: BalanceTerm;
  value: PlanTermValue;
  owner: boolean;
  overridden: boolean;
  onEdit: () => void;
  onReset: () => void;
}) {
  const missing = "missing" in value;
  return (
    <Table.Tr aria-label={BALANCE_TERM_LABELS[term]}>
      <Table.Td>{BALANCE_TERM_LABELS[term]}</Table.Td>
      <Table.Td className="lv-num" ta="right" fw={600}>
        {missing
          ? "—"
          : term === "CAU"
            ? fmt(value.value)
            : `${value.value} kg`}
      </Table.Td>
      <Table.Td>
        {missing ? (
          <Missing>{value.missing}</Missing>
        ) : (
          <>
            <Badge
              size="xs"
              variant="light"
              color={ORIGIN[value.origin]?.color ?? "gray"}
            >
              {ORIGIN[value.origin]?.label ?? value.origin}
            </Badge>{" "}
            <Text span size="xs" c="dimmed">
              {value.detail ? `${value.detail} · ` : ""}
              {value.source}
            </Text>
          </>
        )}
      </Table.Td>
      <Table.Td w={70}>
        {owner && term !== "CAU" && term !== "Nbefore4" && (
          <Group gap={2} wrap="nowrap">
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label={`Remplacer ${term}`}
              onClick={onEdit}
            >
              <Pencil size={13} />
            </ActionIcon>
            {overridden && (
              <ActionIcon
                variant="subtle"
                size="sm"
                color="gray"
                aria-label={`Revenir à la valeur de Fourmy pour ${term}`}
                onClick={onReset}
              >
                <Trash2 size={13} />
              </ActionIcon>
            )}
          </Group>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

function OverrideModal({
  term,
  current,
  onClose,
  onSave,
}: {
  term: BalanceTerm;
  current: PlanTermValue | undefined;
  onClose: () => void;
  onSave: (value: number, reason: string) => void;
}) {
  const [value, setValue] = useState<number | "">(
    current && !("missing" in current) ? current.value : "",
  );
  const [reason, setReason] = useState("");
  return (
    <Modal opened onClose={onClose} title={BALANCE_TERM_LABELS[term]}>
      <Stack>
        <Text size="sm" c="dimmed">
          Une valeur de la ferme (mesure, référence locale) remplace celle du
          référentiel. Le référentiel exige d'en garder le justificatif.
        </Text>
        <NumberInput
          label="Valeur (kg N/ha)"
          value={value}
          onChange={(v) => setValue(v === "" ? "" : Number(v))}
          decimalSeparator=","
        />
        <TextInput
          label="Motif et justificatif"
          placeholder="Référence locale chambre d'agriculture 2026…"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          required
        />
        <Group>
          <Button
            onClick={() => onSave(Number(value), reason.trim())}
            disabled={value === "" || reason.trim().length < 3}
          >
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ExternalDose({
  farmId,
  planId,
  owner,
  draft,
  fourmyDose,
  onChange,
}: {
  farmId: string;
  planId: string;
  owner: boolean;
  draft: PlanDraft;
  fourmyDose: number | null;
  onChange: (e: PlanDraft["external"]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const e = draft.external;
  const [form, setForm] = useState({
    doseKgNHa: e?.doseKgNHa ?? 0,
    tool: e?.tool ?? "",
    advisor: e?.advisor ?? "",
    computedOn: e?.computedOn ?? new Date().toISOString().slice(0, 10),
  });
  return (
    <Paper withBorder p="md" aria-label="Dose d'un outil ou d'un conseiller">
      <Group justify="space-between">
        <div>
          <Title order={4}>Dose d'un outil ou d'un conseiller</Title>
          <Text size="sm" c="dimmed">
            Une dose calculée par un outil labellisé COMIFER ou par votre
            conseiller peut être retenue à la place de celle de Fourmy ; gardez
            sa sortie.
          </Text>
        </div>
        {owner && !editing && (
          <Button
            size="compact-sm"
            variant="light"
            leftSection={e ? <Pencil size={14} /> : <Plus size={14} />}
            onClick={() => setEditing(true)}
          >
            {e ? "Modifier" : "Saisir"}
          </Button>
        )}
      </Group>
      {e && !editing && (
        <Text size="sm" mt="xs">
          <b>{e.doseKgNHa} kg N/ha</b> retenus : {e.tool}
          {e.advisor ? `, ${e.advisor}` : ""}, calculée le{" "}
          {formatDate(e.computedOn)}.
          {fourmyDose !== null
            ? ` Fourmy calcule ${fourmyDose} kg (écart ${e.doseKgNHa - fourmyDose > 0 ? "+" : ""}${e.doseKgNHa - fourmyDose} kg).`
            : ""}
          {owner && (
            <Anchor
              component="button"
              size="sm"
              ml="xs"
              onClick={() => onChange(null)}
            >
              Retirer
            </Anchor>
          )}
        </Text>
      )}
      {e && (
        <div style={{ marginTop: 8 }}>
          <Documents
            farmId={farmId}
            ownerType="plan"
            ownerId={planId}
            owner={owner}
            label="Sortie de l'outil, avis du conseiller"
          />
        </div>
      )}
      {editing && (
        <Stack mt="xs">
          <SimpleGrid cols={{ base: 1, sm: 4 }}>
            <NumberInput
              label="Dose (kg N/ha)"
              min={0}
              value={form.doseKgNHa}
              onChange={(v) => setForm({ ...form, doseKgNHa: Number(v) || 0 })}
            />
            <TextInput
              label="Outil"
              placeholder="AzoFert, Epiclès…"
              value={form.tool}
              onChange={(ev) =>
                setForm({ ...form, tool: ev.currentTarget.value })
              }
            />
            <TextInput
              label="Conseiller"
              value={form.advisor}
              onChange={(ev) =>
                setForm({ ...form, advisor: ev.currentTarget.value })
              }
            />
            <TextInput
              label="Calculée le"
              type="date"
              value={form.computedOn}
              onChange={(ev) =>
                setForm({ ...form, computedOn: ev.currentTarget.value })
              }
            />
          </SimpleGrid>
          <Group>
            <Button
              size="xs"
              disabled={!form.tool.trim()}
              onClick={() => {
                onChange({
                  doseKgNHa: form.doseKgNHa,
                  tool: form.tool.trim(),
                  advisor: form.advisor.trim() || null,
                  computedOn: form.computedOn,
                });
                setEditing(false);
              }}
            >
              Retenir cette dose
            </Button>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => setEditing(false)}
            >
              Annuler
            </Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}

function Applications({
  farmId,
  owner,
  dose,
  applications,
  proposed,
  onChange,
  modulate,
  prescriptions,
}: {
  farmId: string;
  owner: boolean;
  dose: number | null;
  applications: PlannedApplication[];
  proposed: boolean;
  onChange: (a: PlannedApplication[]) => void;
  modulate: { planId: string; parcelId: string };
  prescriptions: FertilizationPlan["prescriptions"];
}) {
  const fertilizers = useFertilizers(farmId);
  const options = [...(fertilizers.data?.values() ?? [])]
    .filter((f) => (f.composition ?? f.proposal)?.nTotal)
    .map((f) => ({ value: f.id, label: f.name }));
  const [apps, setApps] = useState(applications);
  useEffect(() => setApps(applications), [applications]);
  const sum = apps.reduce((s, a) => s + a.nKgHa, 0);
  const set = (k: number, patch: Partial<PlannedApplication>) =>
    setApps(apps.map((a, j) => (j === k ? { ...a, ...patch } : a)));
  /** Dose de produit de l'apport, dans une unité de carte de modulation (kg/ha ou L/ha). */
  const productRate = (
    a: PlannedApplication,
  ): { rate: number; unit: "kg_ha" | "l_ha"; name: string } | null => {
    const f = a.articleId ? fertilizers.data?.get(a.articleId) : undefined;
    const c = f?.composition ?? f?.proposal;
    if (!f || !c || !c.nTotal || !(a.nKgHa > 0)) return null;
    if (c.basis === "mass_percent")
      return {
        rate: Math.round((a.nKgHa * 100) / c.nTotal),
        unit: "kg_ha",
        name: f.name,
      };
    if (c.basis === "kg_per_m3")
      return {
        rate: Math.round((a.nKgHa / c.nTotal) * 1000),
        unit: "l_ha",
        name: f.name,
      };
    return {
      rate: Math.round((a.nKgHa / c.nTotal) * 1000),
      unit: "kg_ha",
      name: f.name,
    };
  };
  const modulateLink = (a: PlannedApplication) => {
    const r = productRate(a);
    if (!r) return null;
    const q = new URLSearchParams({
      parcel: modulate.parcelId,
      plan: modulate.planId,
      stage: a.stage,
      product: r.name,
      rate: String(r.rate),
      unit: r.unit,
    });
    return `/f/${farmId}/prescriptions/new?${q}`;
  };
  const productDose = (a: PlannedApplication) => {
    const f = a.articleId ? fertilizers.data?.get(a.articleId) : undefined;
    const c = f?.composition ?? f?.proposal;
    if (!c || !c.nTotal) return null;
    if (c.basis === "mass_percent")
      return `${Math.round((a.nKgHa * 100) / c.nTotal)} kg/ha`;
    return `${fmt(a.nKgHa / c.nTotal)} ${c.basis === "kg_per_t" ? "t" : "m³"}/ha`;
  };
  return (
    <Paper withBorder p="md" aria-label="Apports prévus">
      <Group justify="space-between" mb="xs">
        <div>
          <Title order={4}>Apports prévus</Title>
          <Text size="sm" c="dimmed">
            {proposed
              ? "Proposition de Fourmy selon les règles de fractionnement du programme régional ; modifiable."
              : "Apports saisis."}{" "}
            Total {Math.round(sum)} kg N/ha
            {dose !== null ? ` pour une dose de ${dose} kg` : ""}.
          </Text>
        </div>
      </Group>
      {dose !== null && sum > dose + 0.5 && (
        <Alert color="brique" mb="xs">
          Les apports dépassent la dose retenue.
        </Alert>
      )}
      <Table fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Stade</Table.Th>
            <Table.Th>Date prévue</Table.Th>
            <Table.Th>Produit</Table.Th>
            <Table.Th>Azote (kg N/ha)</Table.Th>
            <Table.Th>Dose de produit</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {apps.map((a, k) => (
            <Table.Tr key={k}>
              <Table.Td>
                <TextInput
                  size="xs"
                  aria-label="Stade"
                  disabled={!owner}
                  value={a.stage}
                  onChange={(e) => set(k, { stage: e.currentTarget.value })}
                />
                {a.reservedForSteering && (
                  <Badge size="xs" variant="light" mt={2}>
                    pilotage
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                <TextInput
                  size="xs"
                  type="date"
                  aria-label="Date prévue"
                  disabled={!owner}
                  value={a.plannedOn ?? ""}
                  onChange={(e) =>
                    set(k, { plannedOn: e.currentTarget.value || null })
                  }
                />
              </Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  aria-label="Produit"
                  disabled={!owner}
                  data={options}
                  value={a.articleId}
                  clearable
                  searchable
                  onChange={(v) => set(k, { articleId: v })}
                />
              </Table.Td>
              <Table.Td>
                <NumberInput
                  size="xs"
                  aria-label="Azote"
                  disabled={!owner}
                  min={0}
                  value={a.nKgHa}
                  onChange={(v) => set(k, { nKgHa: Number(v) || 0 })}
                />
              </Table.Td>
              <Table.Td className="lv-num">{productDose(a) ?? "—"}</Table.Td>
              <Table.Td>
                {owner && (
                  <Group gap={2} wrap="nowrap">
                    {modulateLink(a) && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        component={Link}
                        to={modulateLink(a)!}
                        aria-label={`Moduler l'apport ${a.stage}`}
                      >
                        Moduler
                      </Button>
                    )}
                    <ActionIcon
                      variant="subtle"
                      color="brique"
                      aria-label="Retirer l'apport"
                      onClick={() => setApps(apps.filter((_, j) => j !== k))}
                    >
                      <Trash2 size={14} />
                    </ActionIcon>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {prescriptions.length > 0 && (
        <Stack gap={2} mt="xs" aria-label="Cartes de modulation du plan">
          {prescriptions.map((m) => (
            <Text key={m.id} size="sm">
              Carte{" "}
              <Anchor
                component={Link}
                to={`/f/${farmId}/prescriptions/${m.id}`}
              >
                {m.name}
              </Anchor>{" "}
              ({m.stage ?? "apport"}, {m.product}) : moyenne {fmt(m.meanRate)}{" "}
              {m.unit === "l_ha" ? "L/ha" : "kg/ha"} pour {fmt(m.targetRate)}{" "}
              prévus.
            </Text>
          ))}
        </Stack>
      )}
      {owner && (
        <Group mt="xs">
          <Button
            size="xs"
            variant="subtle"
            leftSection={<Plus size={14} />}
            onClick={() =>
              setApps([
                ...apps,
                {
                  stage: "",
                  plannedOn: null,
                  articleId: null,
                  nKgHa: 0,
                  reservedForSteering: false,
                },
              ])
            }
          >
            Ajouter un apport
          </Button>
          <Button size="xs" variant="light" onClick={() => onChange(apps)}>
            Enregistrer les apports
          </Button>
          {!proposed && (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => onChange([])}
            >
              Revenir à la proposition
            </Button>
          )}
        </Group>
      )}
    </Paper>
  );
}

function EstablishModal({
  farmId,
  planId,
  revision,
  dose,
  onClose,
  onDone,
}: {
  farmId: string;
  planId: string;
  revision: boolean;
  dose: number;
  onClose: () => void;
  onDone: (p: FertilizationPlan) => void;
}) {
  const [reason, setReason] = useState("");
  const go = useMutation({
    mutationFn: () =>
      api.post<FertilizationPlan>(
        farmPath(farmId, `/fertilization/plans/${planId}/establish`),
        { reason: revision ? reason.trim() : null },
      ),
    onSuccess: onDone,
  });
  return (
    <Modal
      opened
      onClose={onClose}
      title={revision ? "Réviser le plan" : "Établir le plan"}
    >
      <Stack>
        <Text size="sm">
          Dose retenue : <b>{dose} kg N/ha</b>. Le plan est figé avec ses
          données et ses sources : il ne change plus, même si le sol ou les
          références évoluent. Il doit être établi avant le premier apport de
          sortie d'hiver.
        </Text>
        {revision && (
          <Textarea
            label="Motif de la révision"
            placeholder="Reliquat mesuré reçu, objectif revu, pilotage…"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            required
          />
        )}
        {go.error && <ErrorAlert error={go.error} />}
        <Group>
          <Button
            onClick={() => go.mutate()}
            loading={go.isPending}
            disabled={revision && reason.trim().length < 3}
          >
            {revision ? "Réviser" : "Établir"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const BLANK_COVER = (campaign: number): CoverCropWrite => ({
  campaign,
  kind: "sown",
  family: "cruciferes",
  species: "",
  sownOn: `${campaign - 1}-09-01`,
  destroyedOn: null,
  exported: false,
  biomass: null,
  destructionMode: null,
  notes: null,
});
const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/**
 * Couvert d'interculture avant la culture (lot AI, FR-FERT-19) : famille,
 * semis, destruction, biomasse. Il fixe MrCi dans le bilan et figure au
 * cahier d'enregistrement.
 */
function CoverSection({
  farmId,
  owner,
  parcelId,
  campaign,
  cover,
  onSaved,
}: {
  farmId: string;
  owner: boolean;
  parcelId: string;
  campaign: number;
  cover: CoverCrop | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CoverCropWrite | null>(null);
  const path = farmPath(farmId, `/land-parcels/${parcelId}/cover-crop`);
  const save = useMutation({
    mutationFn: (w: CoverCropWrite) => api.put<CoverCrop>(path, w),
    onSuccess: () => {
      setForm(null);
      onSaved();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`${path}?campaign=${campaign}`),
    onSuccess: onSaved,
  });
  const edit = () => {
    if (!cover) return setForm(BLANK_COVER(campaign));
    const { id: _id, parcelId: _p, ...w } = cover;
    setForm(w);
  };
  return (
    <Paper withBorder p="md" aria-label="Couvert d'interculture">
      <Group justify="space-between">
        <div>
          <Title order={4}>Couvert d'interculture</Title>
          <Text size="sm" c="dimmed">
            Couvert semé après la culture précédente : il compte dans le bilan
            (MrCi) et au cahier d'enregistrement.
          </Text>
        </div>
        {owner && !form && (
          <Button
            size="compact-sm"
            variant="light"
            leftSection={cover ? <Pencil size={14} /> : <Plus size={14} />}
            onClick={edit}
          >
            {cover ? "Modifier" : "Saisir un couvert"}
          </Button>
        )}
      </Group>
      {cover && !form && (
        <Stack gap="xs" mt="xs">
          <Text size="sm">
            <b>{cover.species}</b> (
            {cover.family
              ? COVER_FAMILY_LABELS[cover.family]
              : COVER_KIND_LABELS[cover.kind].toLowerCase()}
            ) {cover.kind === "sown" ? "semé" : "levées"} le{" "}
            {formatDate(cover.sownOn)}
            {cover.destroyedOn
              ? `, détruit le ${formatDate(cover.destroyedOn)}`
              : ", destruction à saisir"}
            {cover.destructionMode
              ? ` (${DESTRUCTION_MODE_LABELS[cover.destructionMode].toLowerCase()})`
              : ""}
            {cover.kind !== "sown"
              ? ""
              : cover.biomass
                ? ` · biomasse ${COVER_BIOMASS_LABELS[cover.biomass]}`
                : " · biomasse à estimer"}
            {cover.exported ? " · exporté" : ""}.
            {owner && (
              <Anchor
                component="button"
                size="sm"
                ml="xs"
                c="brique"
                onClick={() => remove.mutate()}
              >
                Retirer
              </Anchor>
            )}
          </Text>
          <Documents
            farmId={farmId}
            ownerType="cover_crop"
            ownerId={cover.id}
            owner={owner}
            label="Photos, factures de semences"
          />
        </Stack>
      )}
      {form && (
        <Stack mt="xs">
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select
              label="Couverture"
              data={options(COVER_KIND_LABELS)}
              value={form.kind}
              allowDeselect={false}
              onChange={(v) =>
                v &&
                setForm({
                  ...form,
                  kind: v as CoverCropWrite["kind"],
                  family: v === "sown" ? (form.family ?? "cruciferes") : null,
                  biomass: v === "sown" ? form.biomass : null,
                })
              }
            />
            {form.kind === "sown" && (
              <Select
                label="Famille"
                data={options(COVER_FAMILY_LABELS)}
                value={form.family}
                allowDeselect={false}
                onChange={(v) =>
                  v &&
                  setForm({ ...form, family: v as CoverCropWrite["family"] })
                }
              />
            )}
            <TextInput
              label="Espèces"
              placeholder="Moutarde blanche, phacélie…"
              value={form.species}
              onChange={(e) =>
                setForm({ ...form, species: e.currentTarget.value })
              }
            />
            <TextInput
              label={form.kind === "sown" ? "Semé le" : "Levées le"}
              type="date"
              value={form.sownOn}
              onChange={(e) =>
                setForm({ ...form, sownOn: e.currentTarget.value })
              }
            />
            <TextInput
              label="Détruit le"
              type="date"
              value={form.destroyedOn ?? ""}
              onChange={(e) =>
                setForm({ ...form, destroyedOn: e.currentTarget.value || null })
              }
            />
            <Select
              label="Mode de destruction"
              data={options(DESTRUCTION_MODE_LABELS)}
              value={form.destructionMode}
              clearable
              onChange={(v) =>
                setForm({
                  ...form,
                  destructionMode: v as CoverCropWrite["destructionMode"],
                })
              }
            />
            {form.kind === "sown" && (
              <Select
                label="Biomasse à la destruction"
                data={options(COVER_BIOMASS_LABELS)}
                value={form.biomass}
                clearable
                onChange={(v) =>
                  setForm({ ...form, biomass: v as CoverCropWrite["biomass"] })
                }
              />
            )}
          </SimpleGrid>
          <Switch
            label="Couvert exporté (fauché, pâturé)"
            checked={form.exported}
            onChange={(e) =>
              setForm({ ...form, exported: e.currentTarget.checked })
            }
          />
          {save.error && <ErrorAlert error={save.error} />}
          <Group>
            <Button
              size="xs"
              disabled={!form.species.trim() || !form.sownOn}
              loading={save.isPending}
              onClick={() =>
                save.mutate({ ...form, species: form.species.trim() })
              }
            >
              Enregistrer le couvert
            </Button>
            <Button size="xs" variant="subtle" onClick={() => setForm(null)}>
              Annuler
            </Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}

/**
 * Pilotage en cours de saison (lot AJ, FR-FERT-17) : une mesure (N-Tester,
 * Jubil, capteur, satellite) donne la dose de l'apport de pilotage. Elle seule
 * justifie de dépasser la dose du plan ; elle est conservée avec son bulletin.
 */
function Steering({
  farmId,
  planId,
  owner,
  steering,
  planDose,
  onChanged,
}: {
  farmId: string;
  planId: string;
  owner: boolean;
  steering: FertilizationPlan["steering"];
  planDose: number | null;
  onChanged: () => void;
}) {
  const blank: SteeringWrite = {
    measuredOn: new Date().toISOString().slice(0, 10),
    stage: null,
    tool: "",
    value: null,
    advisedKgNHa: 0,
    notes: null,
  };
  const [form, setForm] = useState<SteeringWrite | null>(null);
  const add = useMutation({
    mutationFn: (w: SteeringWrite) =>
      api.post<SteeringMeasurement>(
        farmPath(farmId, `/fertilization/plans/${planId}/steering`),
        w,
      ),
    onSuccess: () => {
      setForm(null);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(farmPath(farmId, `/fertilization/steering/${id}`)),
    onSuccess: onChanged,
  });
  return (
    <Paper withBorder p="md" aria-label="Pilotage">
      <Group justify="space-between">
        <div>
          <Title order={4}>Pilotage en cours de saison</Title>
          <Text size="sm" c="dimmed">
            {steering.measurements.length && steering.allowedDose !== null
              ? `Dose permise après la dernière mesure : ${steering.allowedDose} kg N/ha (plan : ${planDose ?? "—"} kg${steering.reservedKgNHa ? `, dont ${steering.reservedKgNHa} kg réservés au pilotage` : ""}).`
              : "Une mesure d'un outil de pilotage fixe l'apport de pilotage ; elle seule justifie de dépasser la dose du plan. Les indices satellite de Fourmy restent un repère."}
          </Text>
        </div>
        {owner && !form && (
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<Plus size={14} />}
            onClick={() => setForm(blank)}
          >
            Ajouter une mesure
          </Button>
        )}
      </Group>
      {steering.measurements.length > 0 && (
        <Table fz="sm" mt="xs">
          <Table.Tbody>
            {steering.measurements.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td className="lv-num">
                  {formatDate(m.measuredOn)}
                </Table.Td>
                <Table.Td>
                  {m.tool}
                  {m.value ? ` : ${m.value}` : ""}
                  {m.stage ? ` (${m.stage})` : ""}
                </Table.Td>
                <Table.Td className="lv-num">
                  {m.advisedKgNHa} kg N/ha conseillés
                </Table.Td>
                <Table.Td>
                  <Documents
                    farmId={farmId}
                    ownerType="steering"
                    ownerId={m.id}
                    owner={owner}
                    label="Bulletin"
                  />
                </Table.Td>
                <Table.Td>
                  {owner && (
                    <ActionIcon
                      variant="subtle"
                      color="brique"
                      aria-label="Retirer la mesure"
                      onClick={() => remove.mutate(m.id)}
                    >
                      <Trash2 size={14} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {form && (
        <Stack mt="xs">
          <SimpleGrid cols={{ base: 1, sm: 5 }}>
            <TextInput
              label="Mesuré le"
              type="date"
              value={form.measuredOn}
              onChange={(e) =>
                setForm({ ...form, measuredOn: e.currentTarget.value })
              }
            />
            <TextInput
              label="Outil"
              placeholder="N-Tester, Jubil…"
              value={form.tool}
              onChange={(e) =>
                setForm({ ...form, tool: e.currentTarget.value })
              }
            />
            <TextInput
              label="Stade"
              value={form.stage ?? ""}
              onChange={(e) =>
                setForm({ ...form, stage: e.currentTarget.value || null })
              }
            />
            <TextInput
              label="Valeur mesurée"
              value={form.value ?? ""}
              onChange={(e) =>
                setForm({ ...form, value: e.currentTarget.value || null })
              }
            />
            <NumberInput
              label="Dose conseillée (kg N/ha)"
              min={0}
              max={300}
              value={form.advisedKgNHa}
              onChange={(v) =>
                setForm({ ...form, advisedKgNHa: Number(v) || 0 })
              }
            />
          </SimpleGrid>
          {add.error && <ErrorAlert error={add.error} />}
          <Group>
            <Button
              size="xs"
              disabled={!form.tool.trim() || !form.measuredOn}
              loading={add.isPending}
              onClick={() => add.mutate({ ...form, tool: form.tool.trim() })}
            >
              Enregistrer la mesure
            </Button>
            <Button size="xs" variant="subtle" onClick={() => setForm(null)}>
              Annuler
            </Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}

type RapeseedDraft = NonNullable<PlanDraft["rapeseed"]>;
type Frequency = NonNullable<RapeseedDraft["organicHistory"]>["frequency"];
const RAPESEED_BLANK: RapeseedDraft = {
  biomassEndWinterKgM2: null,
  biomassStartWinterKgM2: null,
  legumeCompanion: false,
  organicHistory: null,
};
const FREQUENCIES = [
  { value: "every_year", label: "Tous les ans" },
  { value: "two_in_three", label: "2 années sur 3" },
  { value: "every_two", label: "Tous les 2 ans" },
  { value: "every_three_or_more", label: "Tous les 3 ans et plus" },
];

/** Colza (annexe 2.4) : pesées de matière verte, légumineuses associées, historique d'apports organiques. */
function RapeseedInputs({
  owner,
  value,
  onChange,
}: {
  owner: boolean;
  value: PlanDraft["rapeseed"];
  onChange: (v: RapeseedDraft) => void;
}) {
  const r = value ?? RAPESEED_BLANK;
  const num = (v: string) => {
    const x = v.replace(",", ".").replace(/[^\d.]/g, "");
    return x ? Number(x) : null;
  };
  return (
    <Stack gap="xs" mt="sm" aria-label="Colza">
      <SimpleGrid cols={2}>
        <NumberInput
          label="Matière verte en sortie d'hiver (kg/m²)"
          description="Pesée juste avant le premier apport (Pi)"
          decimalSeparator=","
          disabled={!owner}
          min={0}
          defaultValue={r.biomassEndWinterKgM2 ?? ""}
          onBlur={(e) =>
            onChange({ ...r, biomassEndWinterKgM2: num(e.currentTarget.value) })
          }
        />
        <NumberInput
          label="Matière verte en entrée d'hiver (kg/m²)"
          description="Si le gel est fréquent"
          decimalSeparator=","
          disabled={!owner}
          min={0}
          defaultValue={r.biomassStartWinterKgM2 ?? ""}
          onBlur={(e) =>
            onChange({
              ...r,
              biomassStartWinterKgM2: num(e.currentTarget.value),
            })
          }
        />
        <Select
          label="Historique d'apports organiques (Mha)"
          data={naRapeseedMha.rows.map((x) => x.product)}
          value={r.organicHistory?.product ?? null}
          disabled={!owner}
          clearable
          onChange={(v) =>
            onChange({
              ...r,
              organicHistory: v
                ? {
                    product: v,
                    frequency: r.organicHistory?.frequency ?? "every_two",
                  }
                : null,
            })
          }
        />
        <Select
          label="Fréquence"
          data={FREQUENCIES}
          value={r.organicHistory?.frequency ?? null}
          disabled={!owner || !r.organicHistory}
          allowDeselect={false}
          onChange={(v) =>
            r.organicHistory &&
            v &&
            onChange({
              ...r,
              organicHistory: {
                ...r.organicHistory,
                frequency: v as Frequency,
              },
            })
          }
        />
      </SimpleGrid>
      <Switch
        disabled={!owner}
        label="Colza associé à des légumineuses levées et développées (Fass)"
        checked={r.legumeCompanion}
        onChange={(e) =>
          onChange({ ...r, legumeCompanion: e.currentTarget.checked })
        }
      />
    </Stack>
  );
}

/**
 * Produits organiques de la campagne (lot AO) : apports réalisés (interventions)
 * et prévus, avec leur équivalent minéral (annexe 5) compté dans Xa ou dans
 * l'estimation du reliquat.
 */
function Organics({
  farmId,
  owner,
  organics,
  planned,
  onChange,
}: {
  farmId: string;
  owner: boolean;
  organics: FertilizationPlan["context"]["organics"];
  planned: NonNullable<PlanDraft["organics"]>;
  onChange: (o: NonNullable<PlanDraft["organics"]>) => void;
}) {
  const fertilizers = useFertilizers(farmId);
  const options = [...(fertilizers.data?.values() ?? [])]
    .filter((f) => {
      const c = f.composition ?? f.proposal;
      return c && c.basis !== "mass_percent";
    })
    .map((f) => ({
      value: f.id,
      label: `${f.name} (${(f.composition ?? f.proposal)?.basis === "kg_per_m3" ? "m³" : "t"} par ha)`,
    }));
  const [form, setForm] = useState<{
    articleId: string | null;
    quantity: number | "";
    plannedOn: string;
  } | null>(null);
  return (
    <Paper withBorder p="md" aria-label="Produits organiques">
      <Group justify="space-between">
        <div>
          <Title order={4}>Produits organiques</Title>
          <Text size="sm" c="dimmed">
            Apports réalisés et prévus sur la campagne. Leur équivalent engrais
            minéral (Keq de l'annexe 5) est déduit de la dose (Xa) ; un apport
            avant l'ouverture compte aussi dans l'estimation du reliquat.
          </Text>
        </div>
        {owner && !form && (
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<Plus size={14} />}
            onClick={() =>
              setForm({
                articleId: null,
                quantity: "",
                plannedOn: new Date().toISOString().slice(0, 10),
              })
            }
          >
            Prévoir un apport
          </Button>
        )}
      </Group>
      {organics.length > 0 && (
        <Table fz="sm" mt="xs">
          <Table.Tbody>
            {organics.map((o, k) => (
              <Table.Tr key={k}>
                <Table.Td className="lv-num">{formatDate(o.date)}</Table.Td>
                <Table.Td>
                  {o.product}
                  {o.planned ? (
                    <Badge size="xs" variant="light" ml={4}>
                      prévu
                    </Badge>
                  ) : null}
                </Table.Td>
                <Table.Td className="lv-num">
                  {fmt(o.nTotalKgHa)} kg N/ha
                </Table.Td>
                <Table.Td>
                  {o.missing ? (
                    <Missing>{o.missing}</Missing>
                  ) : (
                    <Text span size="sm">
                      {o.period} : Xa {fmt(o.xa)} kg
                      {o.ri ? `, ${fmt(o.ri)} kg dans le reliquat` : ""}
                      {o.notRecommended
                        ? " · période déconseillée (lixiviation)"
                        : ""}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {owner && o.planned && (
                    <ActionIcon
                      variant="subtle"
                      color="brique"
                      aria-label={`Retirer l'apport prévu de ${o.product}`}
                      onClick={() =>
                        onChange(
                          planned.filter(
                            (p) =>
                              !(
                                p.plannedOn === o.date &&
                                fertilizers.data?.get(p.articleId)?.name ===
                                  o.product
                              ),
                          ),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {form && (
        <Group mt="xs" align="flex-end">
          <Select
            label="Produit"
            data={options}
            value={form.articleId}
            searchable
            onChange={(v) => setForm({ ...form, articleId: v })}
            w={280}
          />
          <NumberInput
            label="Quantité par hectare"
            decimalSeparator=","
            min={0}
            value={form.quantity}
            onChange={(v) =>
              setForm({ ...form, quantity: v === "" ? "" : Number(v) })
            }
            w={160}
          />
          <TextInput
            label="Date prévue"
            type="date"
            value={form.plannedOn}
            onChange={(e) =>
              setForm({ ...form, plannedOn: e.currentTarget.value })
            }
          />
          <Button
            size="xs"
            disabled={
              !form.articleId || !(Number(form.quantity) > 0) || !form.plannedOn
            }
            onClick={() => {
              onChange([
                ...planned,
                {
                  articleId: form.articleId!,
                  quantity: Number(form.quantity),
                  plannedOn: form.plannedOn,
                },
              ]);
              setForm(null);
            }}
          >
            Ajouter
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setForm(null)}>
            Annuler
          </Button>
        </Group>
      )}
    </Paper>
  );
}
