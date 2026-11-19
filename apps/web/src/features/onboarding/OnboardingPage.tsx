import { useEffect, useRef, useState } from "react";
import { Accordion, Alert, Anchor, Badge, Button, Checkbox, FileButton, Group, List, Paper, Progress, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { Upload } from "lucide-react";
import { IMPORT_FORMAT_LABELS, type ImportDecisions, type ImportFormat, type ImportRunView } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { useFarmProfile } from "../../app/queries";
import { Loading } from "../../components/states";
import { IdentityTab } from "../farm/IdentityTab";
import { SitesTab } from "../farm/SitesTab";
import { IgnTab } from "../farm/IgnTab";
import { DisplaySettings } from "../farm/SettingsTabs";
import { ImportPreview } from "../imports/ImportPreview";
import { ImportReport } from "../imports/ImportReport";
import { ekylibrePhase, isEkylibreBackup, RUN_STATUS_LABELS, sourceLabel, uploadImportFile } from "../imports/fileImport";
import { EkylibreBackupUpload } from "../imports/EkylibreBackupUpload";
import { OnboardingLayout, StepError, STEPS, type StepKey } from "./OnboardingLayout";

/** Sorte de fichier : un format d'export, ou une sauvegarde Ekylibre. */
type Kind = ImportFormat | "ekylibre";
const kindOf = (r: ImportRunView): Kind => r.format ?? "ekylibre";
/** Ordre d'affichage des fichiers (du plus général au plus détaillé). */
const DISPLAY_ORDER: Kind[] = ["ekylibre", "telepac", "geofolia", "daplos"];
/**
 * Ordre d'import : la ferme Ekylibre, puis les parcelles culturales (Geofolia,
 * DAPLOS), le dossier PAC s'y rattachant ensuite (décision D2).
 */
const IMPORT_ORDER: Kind[] = ["ekylibre", "geofolia", "daplos", "telepac"];
const by = (order: Kind[]) => (a: ImportRunView, b: ImportRunView) => order.indexOf(kindOf(a)) - order.indexOf(kindOf(b));
const KIND_LABELS: Record<Kind, string> = { ...IMPORT_FORMAT_LABELS, ekylibre: "Sauvegarde Ekylibre (.zip)" };

const errorText = (e: unknown) => (e instanceof ApiError ? (e.detail ?? e.title) : String(e));

/** Imports de fichiers de la ferme (ceux de l'assistant : la ferme est neuve). */
function useRuns(farmId: string) {
  return useQuery({
    queryKey: ["file-imports", farmId],
    queryFn: () => api.get<{ items: ImportRunView[] }>(farmPath(farmId, "/imports")),
    select: (d) => d.items.filter((r) => (r.format || isEkylibreBackup(r)) && r.status !== "discarded"),
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === "running") ? 1500 : false),
  });
}

/** Où trouver chaque export (FR-ONB-5). */
const HELP: Record<Kind, string> = {
  ekylibre:
    "Ekylibre → Administration → Sauvegardes → « Créer une sauvegarde », puis la télécharger (archive .zip). Elle apporte toute votre ferme Ekylibre : parcelles, activités, interventions, matériels, stocks.",
  telepac:
    "TelePAC → « Téléprocédures » → dossier PAC de la campagne → « Exporter le dossier » (fichier .xml). Il apporte vos îlots, parcelles PAC, haies et arbres déclarés.",
  geofolia:
    "Geofolia → Export → « Parcelles et Interventions complet » (archive .zip). Il apporte vos parcelles, cultures, interventions, produits et l'historique des cultures.",
  daplos:
    "Votre logiciel de traçabilité ou votre coopérative → export EDI DAPLOS (fichier .dap). Il complète Geofolia, ou le remplace si vous n'avez que lui.",
};

// --- Étape 2 : fichiers ----------------------------------------------------------------

function FilesStep({ farmId, runs }: { farmId: string; runs: ImportRunView[] }) {
  const client = useQueryClient();
  const [errors, setErrors] = useState<string[]>([]);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const failed: string[] = [];
      for (const f of files) await uploadImportFile(farmId, f).catch((e) => failed.push(`${f.name} : ${errorText(e)}`));
      return failed;
    },
    onSuccess: (failed) => {
      setErrors(failed);
      void client.invalidateQueries({ queryKey: ["file-imports", farmId] });
    },
  });
  const discard = useMutation({
    mutationFn: (id: string) => api.post(farmPath(farmId, `/imports/${id}/discard`), {}),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["file-imports", farmId] }),
  });
  const present = new Set(runs.map(kindOf));
  return (
    <Stack>
      <Paper p="md">
        <EkylibreBackupUpload farmId={farmId} />
      </Paper>
      <Paper p="md">
        <Group>
          <FileButton multiple accept=".zip,.xml,.dap,.edi" onChange={(files) => files.length && upload.mutate(files)}>
            {(props) => (
              <Button {...props} leftSection={<Upload size={16} />} loading={upload.isPending}>
                Déposer des fichiers
              </Button>
            )}
          </FileButton>
          <Text size="sm" c="dimmed">
            Un ou plusieurs exports : chacun est reconnu et lu, rien n'est encore écrit.
          </Text>
        </Group>
        {errors.map((e) => (
          <Alert key={e} color="brique" mt="sm">
            {e}
          </Alert>
        ))}
      </Paper>
      {runs.length > 0 && (
        <Table aria-label="Fichiers déposés">
          <Table.Tbody>
            {[...runs].sort(by(DISPLAY_ORDER)).map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{sourceLabel(r)}</Table.Td>
                <Table.Td>{r.file?.name ?? r.preview?.fileName ?? ((r.report as { file?: { name?: string } } | null)?.file?.name ?? "")}</Table.Td>
                <Table.Td>
                  <Badge size="sm" color={RUN_STATUS_LABELS[r.status].color} variant="light" title={ekylibrePhase(r) ?? undefined}>
                    {r.status === "analyzed" ? "Lu" : (ekylibrePhase(r) ?? RUN_STATUS_LABELS[r.status].label)}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">
                  {r.status === "analyzed" && (
                    <Button size="compact-sm" variant="subtle" color="gray" onClick={() => discard.mutate(r.id)}>
                      Retirer
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Accordion variant="contained">
        {DISPLAY_ORDER.map((f) => (
          <Accordion.Item key={f} value={f}>
            <Accordion.Control>
              <Group gap="xs">
                {KIND_LABELS[f]}
                {present.has(f) && (
                  <Badge size="xs" color="lichen">
                    déposé
                  </Badge>
                )}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm">Où trouver cet export : {HELP[f]}</Text>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}

// --- Étape 3 : aperçu d'une sauvegarde Ekylibre -------------------------------------------

function EkylibreSummary({ run }: { run: ImportRunView }) {
  const r = (run.report ?? {}) as { tenant?: string; restore?: { copiedRows: number; errors: number; refused: Record<string, number> } };
  const refused = Object.values(r.restore?.refused ?? {}).reduce((a, b) => a + b, 0);
  return (
    <Stack gap="xs" aria-label="Aperçu de la sauvegarde Ekylibre">
      <Text size="sm">
        Sauvegarde de la ferme Ekylibre « {r.tenant} » restaurée : {(r.restore?.copiedRows ?? 0).toLocaleString("fr-FR")} lignes de données. À l'import,
        Fourmy en reprend l'identité de la ferme, les parcelles et leur historique, les activités et productions, les interventions, les matériels,
        les bâtiments, les stocks et les personnes.
      </Text>
      {(r.restore?.errors ?? 0) + refused > 0 && (
        <Text size="sm" c="dimmed">
          {refused} instruction(s) de la sauvegarde écartée(s) (règles, commandes non utiles à la reprise)
          {r.restore?.errors ? `, ${r.restore.errors} en erreur` : ""}.
        </Text>
      )}
    </Stack>
  );
}

// --- Étape 4 : rapprochements -----------------------------------------------------------

function RunMatching({ farmId, run }: { farmId: string; run: ImportRunView }) {
  const client = useQueryClient();
  const r = run.preview?.reconciliation;
  const save = useMutation({
    mutationFn: (decisions: ImportDecisions) => api.put<ImportRunView>(farmPath(farmId, `/imports/${run.id}/decisions`), decisions),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["file-imports", farmId] }),
  });
  if (!r) return null;
  const rename = (key: string, name: string) => {
    const current = run.decisions.activities?.[key];
    if ((current?.name ?? "") === name) return;
    save.mutate({ ...run.decisions, activities: { ...run.decisions.activities, [key]: { ...current, name } } });
  };
  const skipPerson = (key: string, skip: boolean) => save.mutate({ ...run.decisions, people: { ...run.decisions.people, [key]: { skip } } });
  const toCreate = r.articles.filter((a) => a.action === "create");
  return (
    <Paper p="md">
      <Title order={3} mb="sm">
        {sourceLabel(run)}
      </Title>
      {r.activities.length > 0 && (
        <>
          <Title order={4}>Cultures → activités</Title>
          <Table fz="sm" mb="md" aria-label={`Activités (${sourceLabel(run)})`}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Activité</Table.Th>
                <Table.Th>Production de référence</Table.Th>
                <Table.Th ta="right">Cultures</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {r.activities.map((a) => (
                <Table.Tr key={a.key}>
                  <Table.Td>
                    {a.action === "create" ? (
                      <TextInput
                        size="xs"
                        aria-label={`Nom de l'activité ${a.name}`}
                        defaultValue={a.name}
                        onBlur={(e) => rename(a.key, e.currentTarget.value.trim() || a.name)}
                      />
                    ) : (
                      <Text size="sm">
                        {a.name}{" "}
                        <Badge size="xs" variant="outline">
                          existante
                        </Badge>
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{a.referenceLabel ?? <Text span c="paille" size="sm">sans référence</Text>}</Table.Td>
                  <Table.Td ta="right" className="lv-num">
                    {a.productions}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
      {r.articles.length > 0 && (
        <Text size="sm" mb="xs">
          Articles : {r.articles.length - toCreate.length} reconnus, {toCreate.length} créés à l'import
          {toCreate.length ? ` (${toCreate.slice(0, 6).map((a) => a.name).join(", ")}${toCreate.length > 6 ? "…" : ""})` : ""}.
        </Text>
      )}
      {r.people.length > 0 && (
        <Stack gap={4}>
          <Title order={4}>Personnes</Title>
          {r.people.map((p) => (
            <Checkbox
              key={p.key}
              label={`${p.name}${p.action === "link" ? " (déjà dans Fourmy)" : ""}`}
              checked={!run.decisions.people?.[p.key]?.skip}
              onChange={(e) => skipPerson(p.key, !e.currentTarget.checked)}
            />
          ))}
        </Stack>
      )}
      {save.error && <Alert color="brique">{errorText(save.error)}</Alert>}
    </Paper>
  );
}

// --- Étape 6 : import -------------------------------------------------------------------

function ImportStep({ farmId, runs, onFinished }: { farmId: string; runs: ImportRunView[]; onFinished: (ok: boolean) => void }) {
  const client = useQueryClient();
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const pending = runs.filter((r) => r.status === "analyzed").sort(by(IMPORT_ORDER));
  const run = async () => {
    started.current = true;
    setError(null);
    for (const r of pending) {
      setCurrent(r.id);
      try {
        await api.post(farmPath(farmId, `/imports/${r.id}/apply`), {});
        // Écriture en tâche de fond : on attend la fin avant le fichier suivant (ordre D2).
        for (;;) {
          await new Promise((ok) => setTimeout(ok, 1000));
          const s = await api.get<ImportRunView>(farmPath(farmId, `/imports/${r.id}`));
          if (s.status !== "running") break;
        }
      } catch (e) {
        setError(`${sourceLabel(r)} : ${errorText(e)}`);
        break;
      } finally {
        await client.invalidateQueries({ queryKey: ["file-imports", farmId] });
      }
    }
    setCurrent(null);
    const after = await api.get<{ items: ImportRunView[] }>(farmPath(farmId, "/imports"));
    onFinished(after.items.every((r) => r.status !== "failed" && r.status !== "analyzed" && r.status !== "running"));
    for (const key of ["snapshot", "interventions", "activities", "articles"]) void client.invalidateQueries({ queryKey: [key] });
  };
  // Progression d'ensemble : fichiers terminés sur l'ensemble des fichiers de l'assistant.
  const total = runs.filter((r) => ["analyzed", "running", "completed", "failed"].includes(r.status)).length;
  const finished = runs.filter((r) => r.status === "completed" || r.status === "failed").length;
  const currentRun = runs.find((r) => r.id === current);
  const phase = currentRun ? ekylibrePhase(currentRun) : null;
  return (
    <Stack>
      {total > 0 && (started.current || finished > 0) && (
        <Paper p="md" aria-label="Progression de l'import">
          <Group justify="space-between" mb={6}>
            <Text size="sm" fw={600}>
              {finished === total ? "Import terminé" : `${finished} fichier(s) importé(s) sur ${total}`}
            </Text>
            <Text size="sm" c="dimmed" className="lv-num">
              {Math.round((finished / total) * 100)} %
            </Text>
          </Group>
          <Progress value={(finished / total) * 100} striped={!!current} animated={!!current} size="lg" aria-label="Fichiers importés" />
          {currentRun && (
            <Text size="sm" c="dimmed" mt={6}>
              En cours : {sourceLabel(currentRun)}
              {phase ? ` — ${phase}` : " — écriture des parcelles, cultures et interventions…"}
            </Text>
          )}
        </Paper>
      )}
      {pending.length > 0 && !current && (
        <Paper p="md">
          <Text mb="sm">
            {pending.length} fichier(s) à importer, dans cet ordre : {pending.map((r) => sourceLabel(r)).join(", puis ")}. Comptez de quelques
            secondes à quelques minutes par fichier.
          </Text>
          <Button onClick={() => void run()} disabled={started.current && !error}>
            Lancer l'import
          </Button>
        </Paper>
      )}
      {error && <Alert color="brique">{error}</Alert>}
      {[...runs].sort(by(IMPORT_ORDER)).map((r) => (
        <Paper key={r.id} p="md">
          <Group justify="space-between" mb="xs">
            <Title order={3}>{sourceLabel(r)}</Title>
            <Badge color={r.id === current ? "paille" : RUN_STATUS_LABELS[r.status].color}>{r.id === current ? "En cours" : RUN_STATUS_LABELS[r.status].label}</Badge>
          </Group>
          {["completed", "failed"].includes(r.status) && <ImportReport farmId={farmId} run={r} onChange={() => undefined} revertable={false} />}
        </Paper>
      ))}
    </Stack>
  );
}

// --- Étape 7 : fin ---------------------------------------------------------------------

function DoneStep({ farmId }: { farmId: string }) {
  const links = [
    { to: `/f/${farmId}`, label: "Tableau de bord" },
    { to: `/f/${farmId}/map`, label: "Carte des parcelles" },
    { to: `/f/${farmId}/interventions`, label: "Interventions" },
    { to: `/f/${farmId}/register`, label: "Registre phytosanitaire" },
    { to: `/f/${farmId}/fertilization`, label: "Cahier de fertilisation" },
    { to: `/f/${farmId}/imports`, label: "Imports (rapports, annulation)" },
  ];
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
      {links.map((l) => (
        <Button key={l.to} component={Link} to={l.to} variant={l.to === `/f/${farmId}` ? "filled" : "light"}>
          {l.label}
        </Button>
      ))}
    </SimpleGrid>
  );
}

// --- Étape 1 (ferme créée) : identité ---------------------------------------------------

function FarmIdentity() {
  const farm = useFarm();
  const profile = useFarmProfile(farm.id);
  if (profile.isLoading) return <Loading />;
  if (profile.error) return <StepError error={profile.error} onRetry={() => void profile.refetch()} />;
  return (
    <Paper p="md">
      <IdentityTab key={JSON.stringify(profile.data!.identity)} profile={profile.data!} />
    </Paper>
  );
}

// --- Étape 5 : site, carte et données IGN -------------------------------------------------

/**
 * Siège reconnu (adresse géocodée ou point placé) : « Sites et cartes » et
 * « Données IGN » sont proposés ; le téléchargement IGN tourne sur le
 * serveur, l'assistant continue pendant ce temps. Sinon : placer le siège.
 */
function SiteAndIgn() {
  const farm = useFarm();
  const profile = useFarmProfile(farm.id);
  if (profile.isLoading) return <Loading />;
  if (profile.error) return <StepError error={profile.error} onRetry={() => void profile.refetch()} />;
  const p = profile.data!;
  const located = !!p.sites.find((x) => x.isHeadquarters)?.location;
  return (
    <Stack>
      <Paper p="md" aria-label="Sites et cartes">
        <Title order={3} mb="xs">
          Sites et cartes
        </Title>
        {!located && (
          <Alert color="paille" mb="sm" title="Adresse du siège non reconnue">
            Placez le siège sur la carte (bouton « Modifier » du siège) : Fourmy pourra ensuite préparer les données IGN autour de la ferme.
          </Alert>
        )}
        <Stack>
          <DisplaySettings key={JSON.stringify(p.display)} profile={p} />
          <SitesTab profile={p} />
        </Stack>
      </Paper>
      {located && (
        <Paper p="md" aria-label="Données IGN">
          <Title order={3} mb={4}>
            Données IGN
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            Photos aériennes, plans, relief et bâtiments autour de vos sites, gardés sur le serveur pour des cartes rapides. Le téléchargement se fait en
            tâche de fond : lancez-le et poursuivez l'assistant.
          </Text>
          <IgnTab />
        </Paper>
      )}
    </Stack>
  );
}

// --- Page -------------------------------------------------------------------------------

/**
 * Assistant de premier démarrage, étapes 2 à 7 (lot IM6) : l'étape courante
 * est gardée dans `farm_settings.onboarding`, fermer la page la reprend.
 */
export function OnboardingPage() {
  const farm = useFarm();
  const { step = "files" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const runs = useRuns(farm.id);
  const [imported, setImported] = useState<boolean | null>(null);
  const save = useMutation({
    mutationFn: (body: { step: StepKey; completed?: boolean }) => api.put(farmPath(farm.id, "/farm/onboarding"), body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["me", "farms"] }),
  });
  const go = (next: StepKey) => {
    save.mutate({ step: next, ...(next === "done" ? { completed: true } : {}) });
    navigate(`/f/${farm.id}/onboarding/${next}`);
  };
  const keys = STEPS.map((s) => s.key) as readonly string[];
  const done = step === "done";
  // La fin s'enregistre aussi quand on arrive directement à la dernière étape.
  useEffect(() => {
    if (done && !farm.onboarding?.completedAt) save.mutate({ step: "done", completed: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (farm.role !== "owner") return <Navigate to={`/f/${farm.id}`} replace />;
  if (!keys.includes(step)) return <Navigate to={`/f/${farm.id}/onboarding/files`} replace />;
  const list = runs.data ?? [];
  // Fichiers illisibles côté serveur (API injoignable…) : dit dans l'étape, au lieu d'une liste vide.
  const loadError = runs.error ? <StepError error={runs.error} onRetry={() => void runs.refetch()} /> : null;
  const saveError = save.error ? <Alert color="brique">L'étape n'a pas été enregistrée : {errorText(save.error)}</Alert> : null;
  const analyzed = list.filter((r) => r.status === "analyzed").sort(by(DISPLAY_ORDER));
  // Sauvegarde Ekylibre en cours de restauration : l'aperçu attend.
  const restoring = list.some((r) => isEkylibreBackup(r) && r.status === "running");
  const common = { step: step as StepKey, farmName: farm.name };

  switch (step) {
    case "farm":
      return (
        <OnboardingLayout
          {...common}
          title="Ma ferme"
          intro="Votre ferme est créée : corrigez ou complétez son identité. L'adresse et le point du siège se règlent à l'étape « Paramétrage »."
          next={<Button onClick={() => go("files")}>Continuer</Button>}
        >
          <FarmIdentity />
        </OnboardingLayout>
      );
    case "files":
      return (
        <OnboardingLayout
          {...common}
          title="Mes fichiers"
          intro="Déposez les exports de vos logiciels : ils sont lus tout de suite, et rien n'est écrit dans Fourmy avant l'étape « Import »."
          onBack={() => go("farm")}
          onSkip={() => go("settings")}
          next={
            <Button onClick={() => go("preview")} disabled={analyzed.length === 0 || restoring}>
              Voir l'aperçu
            </Button>
          }
        >
          {loadError}
          {saveError}
          <FilesStep farmId={farm.id} runs={list} />
        </OnboardingLayout>
      );
    case "preview":
      return (
        <OnboardingLayout
          {...common}
          title="Aperçu"
          intro="Ce que chaque fichier apportera à votre ferme. Les fichiers se complètent : ce qu'un fichier précédent a déjà apporté n'est pas doublé."
          onBack={() => go("files")}
          next={<Button onClick={() => go("matching")}>Continuer</Button>}
        >
          {loadError}
          {saveError}
          {!loadError && analyzed.length === 0 && <Alert color="ardoise">Aucun fichier à importer.</Alert>}
          {analyzed.map((r) => (
            <Paper key={r.id} p="md">
              <Title order={3} mb="sm">
                {sourceLabel(r)}
              </Title>
              {isEkylibreBackup(r) ? <EkylibreSummary run={r} /> : <ImportPreview farmId={farm.id} run={r} onChange={() => void runs.refetch()} actions={false} />}
            </Paper>
          ))}
        </OnboardingLayout>
      );
    case "matching":
      return (
        <OnboardingLayout
          {...common}
          title="Rapprochements"
          intro="Nommez vos activités comme vous en avez l'habitude ; choisissez les personnes à reprendre. Le reste se règle plus tard dans Fourmy."
          onBack={() => go("preview")}
          onSkip={() => go("settings")}
          next={<Button onClick={() => go("settings")}>Continuer</Button>}
        >
          {analyzed.map((r) => (
            <RunMatching key={r.id} farmId={farm.id} run={r} />
          ))}
        </OnboardingLayout>
      );
    case "settings":
      return (
        <OnboardingLayout
          {...common}
          title="Paramétrage"
          intro="Les réglages courants, que vous pourrez reprendre à tout moment dans « Ma ferme ». Les liens du bas s'ouvrent dans un nouvel onglet : l'assistant vous attend ici."
          onBack={() => go(analyzed.length ? "matching" : "files")}
          next={<Button onClick={() => go(analyzed.length ? "import" : "done")}>{analyzed.length ? "Continuer" : "Terminer"}</Button>}
        >
          <SiteAndIgn />
          <Title order={3} mt="md">
            Et aussi
          </Title>
          <List spacing="xs">
            <List.Item>
              <Anchor component={Link} to={`/f/${farm.id}/farm`} target="_blank">
                Ma ferme
              </Anchor>{" "}
              : certifications, préférences.
            </List.Item>
            <List.Item>
              <Anchor component={Link} to={`/f/${farm.id}/farm?tab=team`} target="_blank">
                Équipe
              </Anchor>{" "}
              : inviter vos associés et salariés.
            </List.Item>
            <List.Item>
              <Anchor component={Link} to={`/f/${farm.id}/activities`} target="_blank">
                Activités
              </Anchor>{" "}
              : couleurs et productions de référence (après l'import).
            </List.Item>
            <List.Item>
              <Anchor component={Link} to={`/f/${farm.id}/integrations`} target="_blank">
                Intégrations
              </Anchor>{" "}
              : boîtiers GPS, agrirouter, stations météo (facultatif).
            </List.Item>
          </List>
        </OnboardingLayout>
      );
    case "import":
      return (
        <OnboardingLayout
          {...common}
          title="Import"
          intro="Chaque fichier est écrit d'un bloc : en cas d'erreur, rien n'est écrit pour ce fichier et vous pouvez le relancer."
          onBack={imported === null ? () => go("settings") : undefined}
          next={
            <Button onClick={() => go("done")} disabled={list.some((r) => r.status === "analyzed" || r.status === "running")}>
              Terminer
            </Button>
          }
        >
          {loadError}
          {saveError}
          <ImportStep farmId={farm.id} runs={list} onFinished={setImported} />
        </OnboardingLayout>
      );
    default:
      return (
        <OnboardingLayout {...common} title="Votre ferme est prête" intro="Retrouvez vos données dans Fourmy :">
          <DoneStep farmId={farm.id} />
        </OnboardingLayout>
      );
  }
}
