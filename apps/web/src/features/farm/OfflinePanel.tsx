import { useRef, useState } from "react";
import { Alert, Button, Group, Paper, Progress, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IGN_BROWSER_CONFIRM_BYTES } from "@fourmy/contracts";
import { useFarm } from "../../app/farm";
import { formatBytes, formatDateTime } from "../../app/labels";
import { freeOffline, NotEnoughSpace, offlineStatus, offlineSupported, planCopy, runCopy, type CopyPlan } from "../../app/offline";

/**
 * Copie hors ligne sur ce poste (« Ma ferme », lot F5, E14, N3 bis, R7).
 * Ouverte à tout membre : chacun garde la ferme sur son ordinateur. Copie
 * depuis le serveur Fourmy seulement, ce qu'il a déjà en cache.
 */
export function OfflinePanel({ serverTiles }: { serverTiles: number }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const supported = offlineSupported();
  const status = useQuery({ queryKey: ["offline", farm.id], queryFn: () => offlineStatus(farm.id), enabled: supported });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, setPending] = useState<CopyPlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["offline", farm.id] });

  if (!supported) {
    return (
      <Paper withBorder p="md" aria-label="Copie hors ligne">
        <Title order={4} mb="xs">
          Sur cet ordinateur
        </Title>
        <Text size="sm" c="dimmed">
          Ce navigateur ne permet pas de garder la ferme hors ligne.
        </Text>
      </Paper>
    );
  }

  const copy = async (plan: CopyPlan) => {
    setPending(null);
    setProblem(null);
    abort.current = new AbortController();
    try {
      await runCopy(farm.id, plan, (done, total) => setProgress({ done, total }), abort.current.signal);
      notifications.show({ color: "lichen", message: "Ferme gardée sur cet ordinateur : cartes et 3D s'ouvrent sans réseau." });
    } catch (e) {
      if (e instanceof NotEnoughSpace) setProblem(`Il faut ${formatBytes(e.neededBytes)}, il en reste ${formatBytes(e.availableBytes)} sur cet ordinateur.`);
      else if ((e as Error).name === "AbortError") setProblem("Copie arrêtée : rien n'a été gardé.");
      else setProblem(`La copie a échoué, rien n'a été gardé : ${(e as Error).message}`);
    } finally {
      setProgress(null);
      abort.current = null;
      refresh();
    }
  };

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const plan = await planCopy(farm.id);
      if (plan.availableBytes !== null && plan.neededBytes > plan.availableBytes) {
        setProblem(`Il faut ${formatBytes(plan.neededBytes)}, il en reste ${formatBytes(plan.availableBytes)} sur cet ordinateur.`);
      } else if (plan.neededBytes > IGN_BROWSER_CONFIRM_BYTES) setPending(plan);
      else await copy(plan);
    } catch (e) {
      setProblem(`Impossible de préparer la copie : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const free = async () => {
    await freeOffline(farm.id);
    notifications.show({ color: "lichen", message: "Copie hors ligne supprimée de cet ordinateur." });
    refresh();
  };

  const s = status.data;
  return (
    <Paper withBorder p="md" aria-label="Copie hors ligne">
      <Title order={4} mb="xs">
        Sur cet ordinateur
      </Title>
      <Stack gap="sm">
        {s?.erased && (
          <Alert color="orange" title="Copie hors ligne effacée par le navigateur">
            Le navigateur a supprimé la copie de cette ferme (place manquante, ou plusieurs jours sans visite). Gardez-la de nouveau pour travailler sans réseau.
          </Alert>
        )}
        <Text size="sm">
          {s?.copy
            ? `Copie du ${formatDateTime(s.copy.at)} : ${s.copy.tiles.toLocaleString("fr-FR")} tuiles, ${formatBytes(s.copy.bytes)}.`
            : "Aucune copie sur cet ordinateur. Gardez la ferme pour ouvrir ses cartes et sa vue 3D sans réseau."}
          {s?.storage && ` Fourmy occupe ${formatBytes(s.storage.usage)} sur ${formatBytes(s.storage.quota)} permis par le navigateur.`}
        </Text>
        {serverTiles === 0 && !s?.copy && (
          <Text size="sm" c="dimmed">
            Rien à copier pour l'instant : téléchargez d'abord les données sur le serveur.
          </Text>
        )}
        {progress && (
          <Stack gap={4}>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 100} aria-label="Progression de la copie" />
            <Group justify="space-between">
              <Text size="xs">
                {progress.done.toLocaleString("fr-FR")} / {progress.total.toLocaleString("fr-FR")} tuiles
              </Text>
              <Button size="xs" variant="subtle" color="brique" onClick={() => abort.current?.abort()}>
                Arrêter
              </Button>
            </Group>
          </Stack>
        )}
        {pending && (
          <Alert color="orange" title="Copie volumineuse">
            <Text size="sm" mb="xs">
              Environ {formatBytes(pending.neededBytes)} seront gardés sur cet ordinateur.
            </Text>
            <Group>
              <Button color="orange" onClick={() => void copy(pending)}>
                Confirmer
              </Button>
              <Button variant="default" onClick={() => setPending(null)}>
                Annuler
              </Button>
            </Group>
          </Alert>
        )}
        {problem && (
          <Alert color="brique" role="alert">
            {problem}
          </Alert>
        )}
        {!progress && !pending && (
          <Group>
            <Button variant={s?.copy ? "default" : "filled"} loading={busy} disabled={serverTiles === 0} onClick={() => void start()}>
              {s?.copy ? "Mettre à jour la copie" : "Garder pour le hors ligne"}
            </Button>
            {s?.copy && (
              <Button variant="subtle" color="brique" onClick={() => void free()}>
                Libérer l'espace
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
