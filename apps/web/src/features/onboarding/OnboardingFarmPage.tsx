import { useState } from "react";
import {
  Alert,
  Button,
  Center,
  FileButton,
  Grid,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { FileSearch } from "lucide-react";
import { IMPORT_FORMAT_LABELS, type ImportFormat } from "@fourmy/contracts";
import { Wordmark } from "@fourmy/ui-lyvre";
import { api, ApiError } from "../../app/api";
import { onboardingPending, useMyFarms } from "../../app/farm";
import { StepError, Steps } from "./OnboardingLayout";
import { SireneField, type SireneCandidate } from "./SireneField";
import { ErrorBoundary } from "../../components/ErrorBoundary";

const BASE = `${globalThis.location?.origin ?? ""}/api/v1`;

interface Identity {
  siret: string | null;
  pacage: string | null;
  name: string | null;
  email: string | null;
  address: {
    line1?: string;
    line2?: string;
    postalCode?: string;
    city?: string;
  } | null;
}

/** Identité lue dans un fichier (rien n'est gardé côté serveur). */
async function readIdentity(
  file: File,
): Promise<{ format: ImportFormat; identity: Identity | null }> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`${BASE}/me/onboarding/identity`, {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.title ?? `Erreur ${res.status}`,
      body.detail,
    );
  }
  return res.json();
}

const empty = {
  name: "",
  legalName: "",
  siret: "",
  pacage: "",
  line1: "",
  line2: "",
  postalCode: "",
  city: "",
};

/**
 * Assistant de premier démarrage, étape 1 « Ma ferme » (lot IM6) : le compte
 * crée sa ferme, champs pré-remplis au besoin depuis un export (dossier PAC,
 * DAPLOS, Geofolia). Seule étape qui écrit avant la fin de l'assistant.
 */
export function OnboardingFarmPage() {
  const farms = useMyFarms();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [source, setSource] = useState<string | null>(null);
  // Valeur lue tout de suite : l'événement n'est plus utilisable quand React applique la mise à jour.
  const set =
    (k: keyof typeof empty) => (e: { currentTarget: { value: string } }) => {
      const value = e.currentTarget.value;
      setForm((f) => ({ ...f, [k]: value }));
    };

  // Entreprise choisie dans Sirene : identité et adresse du siège (le nom de la ferme seulement s'il est vide).
  const pick = (c: SireneCandidate) => {
    setSource("Sirene (INSEE)");
    setForm((f) => ({
      ...f,
      name: f.name || c.name,
      legalName: c.name,
      siret: c.siret ?? f.siret,
      line1: c.line1 ?? "",
      line2: c.line2 ?? "",
      postalCode: c.postalCode ?? "",
      city: c.city ?? "",
    }));
  };
  const prefill = useMutation({
    mutationFn: readIdentity,
    onSuccess: ({ format, identity }) => {
      if (!identity) return;
      setSource(IMPORT_FORMAT_LABELS[format]);
      setForm((f) => ({
        name: f.name || identity.name || "",
        legalName: f.legalName || identity.name || "",
        siret: f.siret || identity.siret || "",
        pacage: f.pacage || identity.pacage || "",
        line1: f.line1 || identity.address?.line1 || "",
        line2: f.line2 || identity.address?.line2 || "",
        postalCode: f.postalCode || identity.address?.postalCode || "",
        city: f.city || identity.address?.city || "",
      }));
    },
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/me/farms", {
        name: form.name.trim(),
        legalName: form.legalName.trim() || null,
        siret: form.siret.replace(/\s/g, "") || null,
        pacage: form.pacage.replace(/\s/g, "") || null,
        address:
          form.line1 || form.city || form.postalCode
            ? {
                line1: form.line1 || null,
                line2: form.line2 || null,
                postalCode: form.postalCode || null,
                city: form.city || null,
              }
            : null,
      }),
    onSuccess: async ({ id }) => {
      await client.invalidateQueries({ queryKey: ["me", "farms"] });
      navigate(`/f/${id}/onboarding/files`);
    },
  });

  if (farms.isLoading)
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  if (farms.error)
    return (
      <Stack p="xl" maw={900} mx="auto">
        <StepError error={farms.error} onRetry={() => void farms.refetch()} />
      </Stack>
    );
  // Une ferme en cours d'assistant : on la reprend ; un compte sans droit : la page des fermes l'explique.
  const pending = farms.data?.items.find(onboardingPending);
  if (pending)
    return (
      <Navigate
        to={`/f/${pending.id}/onboarding/${pending.onboarding?.step ?? "files"}`}
        replace
      />
    );
  if (!farms.data?.canCreateFarm) return <Navigate to="/farms" replace />;

  const error = create.error ?? prefill.error;
  return (
    <Stack p="xl" maw={900} mx="auto">
      <Wordmark style={{ fontSize: "2rem" }} />
      <Title order={1}>Bienvenue dans Fourmy</Title>
      <Text c="dimmed">
        En quelques étapes : votre ferme, vos exports (dossier PAC, Geofolia,
        DAPLOS), un aperçu de ce qui sera repris, vos réglages, puis l'import de
        votre historique. Vous pouvez fermer la page à tout moment : l'assistant
        reprendra où vous en étiez.
      </Text>
      <Steps active={0} />
      <ErrorBoundary
        label="assistant"
        fallback={(e, reset) => <StepError error={e} onRetry={reset} />}
      >
        <Paper p="md">
          <form
            aria-label="Ma ferme"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Stack>
              <Group justify="space-between">
                <Title order={2}>Ma ferme</Title>
                <FileButton
                  accept=".zip,.xml,.dap"
                  onChange={(f) => f && prefill.mutate(f)}
                >
                  {(props) => (
                    <Button
                      {...props}
                      variant="light"
                      leftSection={<FileSearch size={16} />}
                      loading={prefill.isPending}
                    >
                      Pré-remplir depuis un fichier
                    </Button>
                  )}
                </FileButton>
              </Group>
              {source && (
                <Alert color="lichen">
                  Champs pré-remplis depuis le fichier ({source}) :
                  vérifiez-les. Le fichier n'est pas gardé ; vous le déposerez à
                  l'étape suivante.
                </Alert>
              )}
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput
                    label="Nom de la ferme"
                    required
                    value={form.name}
                    onChange={set("name")}
                    maxLength={120}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <SireneField
                    label="Raison sociale"
                    mode="name"
                    value={form.legalName}
                    onChange={(v) => setForm((f) => ({ ...f, legalName: v }))}
                    onPick={pick}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <SireneField
                    label="SIRET"
                    mode="number"
                    value={form.siret}
                    onChange={(v) => setForm((f) => ({ ...f, siret: v }))}
                    onPick={pick}
                    placeholder="14 chiffres"
                    inputMode="numeric"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput
                    label="N° PACAGE"
                    value={form.pacage}
                    onChange={set("pacage")}
                    placeholder="9 chiffres"
                    inputMode="numeric"
                  />
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput
                    label="Adresse"
                    value={form.line1}
                    onChange={set("line1")}
                  />
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput
                    label="Complément d'adresse"
                    value={form.line2}
                    onChange={set("line2")}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <TextInput
                    label="Code postal"
                    value={form.postalCode}
                    onChange={set("postalCode")}
                    inputMode="numeric"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 8 }}>
                  <TextInput
                    label="Commune"
                    value={form.city}
                    onChange={set("city")}
                  />
                </Grid.Col>
              </Grid>
              {error && (
                <Alert color="brique">
                  {error instanceof ApiError
                    ? (error.detail ?? error.title)
                    : String(error)}
                </Alert>
              )}
              <Group justify="flex-end">
                <Button
                  type="submit"
                  loading={create.isPending}
                  disabled={!form.name.trim()}
                >
                  Créer ma ferme
                </Button>
              </Group>
            </Stack>
          </form>
        </Paper>
      </ErrorBoundary>
    </Stack>
  );
}
