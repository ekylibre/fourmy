import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Badge, Button, Grid, Group, Modal, Paper, Stack, Tabs, Text, Title, Tooltip } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { CalendarPlus, ChevronLeft, ChevronRight, Lock, PanelRightClose, PanelRightOpen, Pencil, Redo2, Undo2, X } from "lucide-react";
import type { CropPlanContext, CropPlanParcelKey, CropPlanView } from "@fourmy/contracts";
import { worstControlLevel } from "@fourmy/domain";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";
import { MapBoundary } from "../../components/MapBoundary";
import { ControlLight } from "../certification/controls";
import { CropPlanMap, type CropPlanMapParcel } from "./CropPlanMap";
import { AssignForm, ChecksPanel, HistoryPanel, ParcelsPanel, SettingsPanel, SummaryPanel, ValidateModal, type ParcelFilter } from "./panels";
import { FALLOW, MapLegend } from "./legend";
import { draftShapes, ParcelTools, PendingOperations, splitOperation } from "./operations";
import { cropPlanKeys, useCropPlan, useCropPlanContext } from "./queries";
import { useCropPlanEditor, type SaveState } from "./useCropPlanEditor";
import { PlannedInterventionsModal } from "../itk/PlannedInterventionsModal";
import { WorkPanel } from "../itk/WorkPanel";
import { InputsPanel } from "../itk/InputsPanel";
import "./workspace.css";

/**
 * Assolement prévisionnel d'une campagne (lot AS2b, conception §7) : carte,
 * affectation des cultures, récapitulatif et contrôles en direct, validation.
 */
export function CropPlanPage() {
  const farm = useFarm();
  const year = Number(useParams().year);
  const plan = useCropPlan(farm.id, year);
  const context = useCropPlanContext(farm.id, year, !!plan.data);
  const owner = farm.role === "owner";
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post<CropPlanView>(farmPath(farm.id, `/crop-plans/${year}`), {}),
    onSuccess: (p) => {
      qc.setQueryData(cropPlanKeys.plan(farm.id, year), p);
      void qc.invalidateQueries({ queryKey: cropPlanKeys.all(farm.id), exact: true });
    },
  });

  const nav = (
    <Group gap="xs">
      <Button size="compact-sm" variant="subtle" component={Link} to={`/f/${farm.id}/crop-plan/${year - 1}`} leftSection={<ChevronLeft size={14} />}>
        {year - 1}
      </Button>
      <Button size="compact-sm" variant="subtle" component={Link} to={`/f/${farm.id}/crop-plan/${year + 1}`} rightSection={<ChevronRight size={14} />}>
        {year + 1}
      </Button>
    </Group>
  );

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return <Alert color="brique">Campagne invalide.</Alert>;
  if (plan.isLoading) return <Loading />;
  if (plan.error) return <ErrorAlert error={plan.error} />;
  if (!plan.data) {
    return (
      <Stack>
        <Group justify="space-between">
          <Title order={1}>Assolement {year}</Title>
          {nav}
        </Group>
        <Paper withBorder p="lg">
          <Stack gap="sm" align="flex-start">
            <Text>Pas encore d'assolement pour la campagne {year} (année de récolte).</Text>
            <Text size="sm" c="dimmed">
              Il part des cultures déjà saisies ou importées pour {year} ; rien ne change dans les productions avant la validation.
            </Text>
            {owner ? (
              <Button onClick={() => create.mutate()} loading={create.isPending}>
                Préparer l'assolement {year}
              </Button>
            ) : (
              <Text size="sm">Le responsable de la ferme prépare l'assolement.</Text>
            )}
            {create.error && <ErrorAlert error={create.error} />}
          </Stack>
        </Paper>
      </Stack>
    );
  }
  if (context.isLoading) return <Loading />;
  if (context.error) return <ErrorAlert error={context.error} />;
  return <Editor key={`${year}`} farmId={farm.id} year={year} plan={plan.data} context={context.data!} owner={owner} nav={nav} />;
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: "Enregistré",
  pending: "Modifications en attente…",
  saving: "Enregistrement…",
  conflict: "Modifié ailleurs",
  error: "Non enregistré",
};

function Editor({ farmId, year, plan, context, owner, nav }: { farmId: string; year: number; plan: CropPlanView; context: CropPlanContext; owner: boolean; nav: React.ReactNode }) {
  const qc = useQueryClient();
  const editable = owner && plan.status === "draft";
  const editor = useCropPlanEditor(farmId, year, plan, context, editable);
  const [selected, setSelected] = useState<CropPlanParcelKey[]>([]);
  const [tab, setTab] = useState<string | null>("parcels");
  const [filter, setFilter] = useState<ParcelFilter>("all");
  const [validating, setValidating] = useState<{ revision: number } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [cutting, setCutting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const colors = useMemo(() => new Map(context.activities.map((a, i) => [a.id, a.color ?? PALETTE[i % PALETTE.length]!])), [context]);
  const shapes = useMemo(() => draftShapes(context, editor.draft), [context, editor.draft]);
  const todo = new Set<string>(editor.summary.unassigned.keys);
  const mapParcels: CropPlanMapParcel[] = editor.plan.parcels
    // « Sans culture prévue » : la carte ne montre que celles-là.
    .filter((p) => shapes.has(p.key) && (filter === "all" || todo.has(p.key)))
    .map((p) => {
      const main = editor.draft.assignments.find((a) => a.key === p.key && a.role === "main");
      const fallow = editor.draft.fallow.some((f) => f.key === p.key);
      return {
        key: p.key,
        id: p.key,
        areaM2: p.areaM2,
        shape: shapes.get(p.key) as CropPlanMapParcel["shape"],
        color: main ? (colors.get(main.activityId) ?? null) : fallow ? FALLOW : null,
        fallow,
      };
    });

  const refresh = async (p: CropPlanView | null) => {
    if (p) qc.setQueryData(cropPlanKeys.plan(farmId, year), p);
    else await qc.invalidateQueries({ queryKey: cropPlanKeys.plan(farmId, year) });
    await qc.invalidateQueries({ queryKey: cropPlanKeys.all(farmId), exact: true });
  };
  const reopen = useMutation({ mutationFn: () => api.post<CropPlanView>(farmPath(farmId, `/crop-plans/${year}/reopen`), {}), onSuccess: refresh });
  // Campagne déjà saisie sans assolement : « Modifier » crée l'assolement à partir des cultures saisies.
  const start = useMutation({ mutationFn: () => api.post<CropPlanView>(farmPath(farmId, `/crop-plans/${year}`), {}), onSuccess: refresh });
  const discard = useMutation({
    mutationFn: () => api.delete<CropPlanView>(farmPath(farmId, `/crop-plans/${year}/draft`)),
    onSuccess: async (p) => {
      setDiscarding(false);
      notifications.show({ message: p ? "Brouillon abandonné : retour à la dernière version validée." : `Assolement ${year} supprimé.` });
      await refresh(p ?? null);
    },
  });
  const openValidation = async () => setValidating({ revision: await editor.flush() });
  const closeValidation = () => {
    setValidating(null);
    void qc.invalidateQueries({ queryKey: cropPlanKeys.plan(farmId, year) });
  };

  const checksLevel = worstControlLevel(editor.sections.map((s) => s.level));
  const issues = editor.sections.flatMap((s) => s.findings).filter((f) => f.level === "danger" || f.level === "warning").length;

  // Mode plein écran (retours du 20/11) : tant que le brouillon est ouvert ; « Quitter » revient à la vue classique.
  const [closed, setClosed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const fullscreen = editable && !closed;
  useEffect(() => {
    if (!fullscreen) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [fullscreen]);
  // Bandeau « parcellaire repris » : fermé une fois pour cette campagne (mémorisé dans le navigateur).
  const carried = context.parcels.filter((p) => p.carryOver).length;
  const noticeKey = `fourmy.cropPlan.carryNotice.${farmId}.${year}`;
  const [carryHidden, setCarryHidden] = useState(() => {
    try {
      return localStorage.getItem(noticeKey) === "1";
    } catch {
      return false;
    }
  });
  const hideCarry = () => {
    setCarryHidden(true);
    try {
      localStorage.setItem(noticeKey, "1");
    } catch {
      /* stockage indisponible : fermé pour cette visite */
    }
  };
  const carryNotice =
    plan.status === "draft" && carried > 0 && !carryHidden ? (
      <Alert color="ardoise" variant="light" title={`Parcellaire ${year - 1} repris`} withCloseButton onClose={hideCarry} closeButtonLabel="Fermer le message">
        {carried} parcelle(s) de {year - 1} s'arrêtent à la fin de la campagne (une parcelle par culture et par an, comme dans Ekylibre). L'assolement les reprend sous un
        nom sans culture ni année ; la validation crée les parcelles {year}. Écartez celles qui ne sont plus cultivées par « Ne pas reconduire ».
      </Alert>
    ) : null;
  const conflict =
    editor.saveState === "conflict" ? (
      <Alert color="brique" title="L'assolement a été modifié ailleurs (autre onglet, autre responsable)">
        <Group gap="xs" mt="xs">
          <Button size="xs" variant="light" onClick={() => void editor.reload()}>
            Recharger sa version
          </Button>
          <Button size="xs" variant="subtle" color="brique" onClick={() => void editor.overwrite()}>
            Garder la mienne
          </Button>
        </Group>
      </Alert>
    ) : null;

  const map = (full: boolean) => (
    <div style={{ position: "relative", height: full ? "100%" : undefined }}>
      <MapBoundary what="la carte de l'assolement">
        <CropPlanMap
          parcels={mapParcels}
          selected={selected}
          onSelect={(k) => setSelected(k as CropPlanParcelKey[])}
          cutting={cutting}
          onCut={(key, pieces) => {
            const op = splitOperation(editor, context, key, pieces);
            editor.apply((d) => ({ ...d, operations: [...d.operations, op] }));
            setCutting(null);
            if (op.kind === "split") setSelected(op.pieces.map((p) => p.key));
          }}
          onError={setNotice}
          {...(full ? { height: "100%", bare: true, controls: "bottom-left" as const, fitPadding: { top: 120, right: 520, bottom: 60, left: 60 } } : {})}
        />
      </MapBoundary>
      {/* Légende hors de la carte : visible même si la carte ne s'affiche pas (WebGL). */}
      <div style={{ position: "absolute", top: full ? 12 : 8, left: full ? 12 : 8, zIndex: 2, maxWidth: full ? 320 : "45%" }}>
        <MapLegend editor={editor} context={context} colors={colors} />
      </div>
    </div>
  );
  const tabs = (
    <Tabs value={tab} onChange={setTab} styles={{ tab: { paddingInline: 10 } }}>
      <Tabs.List>
        <Tabs.Tab value="parcels">Parcelles</Tabs.Tab>
        <Tabs.Tab value="summary">Récapitulatif</Tabs.Tab>
        <Tabs.Tab value="work">Travaux</Tabs.Tab>
        <Tabs.Tab value="inputs">Intrants</Tabs.Tab>
        <Tabs.Tab value="checks" rightSection={issues ? <Badge size="xs" color={checksLevel === "danger" ? "brique" : "paille"}>{issues}</Badge> : null}>
          Contrôles
        </Tabs.Tab>
        <Tabs.Tab value="history">Historique</Tabs.Tab>
        {owner && <Tabs.Tab value="settings">Réglages</Tabs.Tab>}
      </Tabs.List>
      <Tabs.Panel value="parcels" pt="sm">
        <ParcelsPanel editor={editor} context={context} selected={selected} onSelect={setSelected} filter={filter} onFilter={setFilter} editable={editable} />
      </Tabs.Panel>
      <Tabs.Panel value="summary" pt="sm">
        <SummaryPanel editor={editor} context={context} />
      </Tabs.Panel>
      <Tabs.Panel value="work" pt="sm">
        {tab === "work" && <WorkPanel editor={editor} context={context} />}
      </Tabs.Panel>
      <Tabs.Panel value="inputs" pt="sm">
        {tab === "inputs" && <InputsPanel editor={editor} context={context} />}
      </Tabs.Panel>
      <Tabs.Panel value="checks" pt="sm">
        <Group mb="xs" gap="xs">
          <Text size="sm">Ensemble :</Text>
          <ControlLight level={checksLevel} />
        </Group>
        <ChecksPanel
          sections={editor.sections}
          onSelect={(keys) => {
            setSelected(keys);
            setFilter("all");
            setTab("parcels");
          }}
        />
      </Tabs.Panel>
      <Tabs.Panel value="history" pt="sm">
        <HistoryPanel farmId={farmId} year={year} versions={plan.versions} editor={editor} context={context} />
      </Tabs.Panel>
      {owner && (
        <Tabs.Panel value="settings" pt="sm">
          <SettingsPanel farmId={farmId} year={year} context={context} />
        </Tabs.Panel>
      )}
    </Tabs>
  );
  const modals = (
    <>
      {validating && (
        <ValidateModal
          farmId={farmId}
          year={year}
          editor={editor}
          context={context}
          revision={validating.revision}
          revising={plan.currentVersion !== null}
          opened
          onClose={closeValidation}
          onSelect={(keys) => {
            setSelected(keys);
            setFilter("all");
            setTab("parcels");
          }}
        />
      )}
      <Modal opened={discarding} onClose={() => setDiscarding(false)} title="Abandonner le brouillon ?">
        <Stack>
          <Text size="sm">
            {plan.currentVersion ? `Les modifications sont perdues ; l'assolement revient à la version ${plan.currentVersion}.` : `L'assolement ${year} est supprimé ; les productions déjà saisies ne changent pas.`}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDiscarding(false)}>
              Garder
            </Button>
            <Button color="brique" loading={discard.isPending} onClick={() => discard.mutate()}>
              Abandonner
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );

  if (fullscreen) {
    return (
      <div className="cp-workspace" role="region" aria-label={`Assolement ${year} en plein écran`}>
        <header className="cp-workspace__bar">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Tooltip label="Revenir à l'interface classique ; le brouillon est gardé">
              <Button size="compact-sm" variant="subtle" color="gray" className="cp-on-night" leftSection={<X size={14} />} onClick={() => setClosed(true)}>
                Quitter
              </Button>
            </Tooltip>
            <h1 className="cp-workspace__title">Assolement {year}</h1>
            <Badge color="paille" variant="filled" size="sm">
              brouillon{plan.currentVersion ? ` · révision de la version ${plan.currentVersion}` : ""}
            </Badge>
            <Text size="xs" className={editor.saveState === "error" || editor.saveState === "conflict" ? "cp-on-night cp-alert" : "cp-on-night cp-muted"} aria-live="polite">
              {SAVE_LABELS[editor.saveState]}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Annuler">
              <Button size="compact-sm" variant="subtle" color="gray" className="cp-on-night" aria-label="Annuler le dernier geste" disabled={!editor.canUndo} onClick={editor.undo}>
                <Undo2 size={16} />
              </Button>
            </Tooltip>
            <Tooltip label="Rétablir">
              <Button size="compact-sm" variant="subtle" color="gray" className="cp-on-night" aria-label="Rétablir" disabled={!editor.canRedo} onClick={editor.redo}>
                <Redo2 size={16} />
              </Button>
            </Tooltip>
            <Button size="compact-sm" variant="subtle" color="gray" className="cp-on-night" onClick={() => setDiscarding(true)}>
              Abandonner le brouillon
            </Button>
            <Button size="sm" color="paille" onClick={() => void openValidation()} disabled={editor.saveState === "conflict"}>
              Valider…
            </Button>
          </Group>
        </header>
        <div className="cp-workspace__body">
          {map(true)}
          <div className="cp-workspace__tools" data-panel={panelOpen}>
            <Paper p={6} shadow="sm">
              <ParcelTools
                editor={editor}
                context={context}
                selected={selected}
                shapes={shapes}
                cutting={cutting}
                onCutting={setCutting}
                onSelect={setSelected}
                notice={notice}
                onNotice={setNotice}
                compact
              />
            </Paper>
          </div>
          {(carryNotice || conflict || editor.saveError) && (
            <div className="cp-workspace__notices" data-panel={panelOpen}>
              {conflict}
              {editor.saveError && <Alert color="brique">{editor.saveError}</Alert>}
              {carryNotice}
            </div>
          )}
          <aside className="cp-workspace__panel" data-open={panelOpen} aria-label="Panneau de l'assolement">
            <Tooltip label={panelOpen ? "Replier le panneau" : "Déplier le panneau"} position="left">
              <Button className="cp-workspace__panel-toggle" size="compact-sm" variant="default" aria-label={panelOpen ? "Replier le panneau" : "Déplier le panneau"} onClick={() => setPanelOpen((o) => !o)}>
                {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </Button>
            </Tooltip>
            {panelOpen && (
              <Paper className="cp-workspace__panel-body" p="sm" shadow="md">
                <PendingOperations editor={editor} context={context} editable={editable} />
                {tabs}
              </Paper>
            )}
          </aside>
          {selected.length > 0 && (
            <div className="cp-workspace__sheet" data-panel={panelOpen}>
              <AssignForm editor={editor} context={context} selected={selected} onSelect={setSelected} compact />
            </div>
          )}
        </div>
        {modals}
      </div>
    );
  }

  return (
    <Stack gap="sm">
      {planning && <PlannedInterventionsModal farmId={farmId} year={year} onClose={() => setPlanning(false)} />}
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Title order={1}>Assolement {year}</Title>
          {plan.status === "current" ? (
            <Badge color="ardoise" variant="light">
              cultures saisies
            </Badge>
          ) : plan.status === "draft" ? (
            <Badge color="paille" variant="light">
              brouillon{plan.currentVersion ? ` (révision de la version ${plan.currentVersion})` : ""}
            </Badge>
          ) : (
            <Badge color="lichen" variant="light" leftSection={<Lock size={12} />}>
              validé · version {plan.currentVersion}
            </Badge>
          )}
          {editable && (
            <Text size="xs" c={editor.saveState === "error" || editor.saveState === "conflict" ? "brique" : "dimmed"} aria-live="polite">
              {SAVE_LABELS[editor.saveState]}
            </Text>
          )}
        </Group>
        <Group gap="xs">
          {nav}
          {editable && (
            <>
              <Tooltip label="Annuler">
                <Button size="compact-sm" variant="default" aria-label="Annuler le dernier geste" disabled={!editor.canUndo} onClick={editor.undo}>
                  <Undo2 size={14} />
                </Button>
              </Tooltip>
              <Tooltip label="Rétablir">
                <Button size="compact-sm" variant="default" aria-label="Rétablir" disabled={!editor.canRedo} onClick={editor.redo}>
                  <Redo2 size={14} />
                </Button>
              </Tooltip>
              <Button size="compact-sm" variant="subtle" color="brique" onClick={() => setDiscarding(true)}>
                Abandonner le brouillon
              </Button>
              <Button size="sm" onClick={() => void openValidation()} disabled={editor.saveState === "conflict"}>
                Valider…
              </Button>
            </>
          )}
          {owner && plan.status === "validated" && (
            <Button size="sm" variant="default" leftSection={<CalendarPlus size={14} />} onClick={() => setPlanning(true)}>
              Préparer les interventions prévues
            </Button>
          )}
          {owner && plan.status === "validated" && (
            <Button size="sm" variant="light" leftSection={<Pencil size={14} />} loading={reopen.isPending} onClick={() => reopen.mutate()}>
              Modifier
            </Button>
          )}
          {owner && plan.status === "current" && (
            <Button size="sm" variant="light" leftSection={<Pencil size={14} />} loading={start.isPending} onClick={() => start.mutate()}>
              Modifier l'assolement {year}
            </Button>
          )}
        </Group>
      </Group>

      {editor.saveState === "conflict" && (
        <Alert color="brique" title="L'assolement a été modifié ailleurs (autre onglet, autre responsable)">
          <Group gap="xs" mt="xs">
            <Button size="xs" variant="light" onClick={() => void editor.reload()}>
              Recharger sa version
            </Button>
            <Button size="xs" variant="subtle" color="brique" onClick={() => void editor.overwrite()}>
              Garder la mienne
            </Button>
          </Group>
        </Alert>
      )}
      {editor.saveError && <Alert color="brique">{editor.saveError}</Alert>}
      {plan.status === "draft" && context.parcels.some((p) => p.carryOver) && (
        <Alert color="ardoise" variant="light" title={`Parcellaire ${year - 1} repris`}>
          {context.parcels.filter((p) => p.carryOver).length} parcelle(s) de {year - 1} s'arrêtent à la fin de la campagne (une parcelle par culture et par an, comme dans
          Ekylibre). L'assolement les reprend sous un nom sans culture ni année ; la validation crée les parcelles {year}. Écartez celles qui ne sont plus cultivées par
          « Ne pas reconduire ».
        </Alert>
      )}
      {plan.status === "current" && (
        <Alert color="ardoise" variant="light" title={`Cultures ${year} déjà saisies`}>
          Pas encore d'assolement pour {year} : voici les cultures saisies ou importées. « Modifier l'assolement {year} » ouvre un brouillon à partir d'elles ; rien ne
          change dans les productions avant la validation.
        </Alert>
      )}
      {reopen.error && <ErrorAlert error={reopen.error} />}
      {start.error && <ErrorAlert error={start.error} />}

      {editable && closed && (
        <Alert color="paille" variant="light" title="Brouillon en cours">
          <Group justify="space-between" gap="xs">
            <Text size="sm">Le brouillon est enregistré ; reprenez-le en plein écran pour continuer l'assolement.</Text>
            <Button size="xs" onClick={() => setClosed(false)}>
              Reprendre en plein écran
            </Button>
          </Group>
        </Alert>
      )}
      <Grid gap="sm">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="xs">
            {map(false)}
            <PendingOperations editor={editor} context={context} editable={false} />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          {tabs}
        </Grid.Col>
      </Grid>
      {modals}
    </Stack>
  );
}

/** Couleurs des activités sans couleur propre (palette Lyvre). */
const PALETTE = ["#E8B500", "#6A994E", "#BC6C25", "#457B9D", "#9C6644", "#A7C957", "#D62828", "#7B2CBF"];
