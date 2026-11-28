import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Center, Group, Loader, Paper, Radio, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { MEMBER_ROLE_LABELS, type AccessGrant, type OAuthNext, type OAuthRequest } from "@fourmy/contracts";
import { api, ApiError } from "../../app/api";
import { AccessGrantEditor, grantUsable } from "../team/AccessGrantEditor";

/**
 * Autorisation OAuth d'une application (lot AM5, conception_api_mcp.md §7.1) :
 * choix de la ferme (`/oauth/ferme`, étape postLogin du serveur
 * d'autorisation), puis consentement (`/oauth/consentement`) avec les modules
 * et les activités ouverts. La requête signée par le serveur passe d'une page
 * à l'autre dans l'adresse.
 */

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const DEFAULT_GRANT: AccessGrant = { modules: { activities: "read", interventions: "read" }, activities: "all" };

/** Requête signée de la page courante (sans le « ? »). */
function useOAuthQuery() {
  return useLocation().search.slice(1);
}

/** Demande en cours, relue par chaque page (la ferme choisie change entre les deux). */
function useOAuthRequest(q: string, step: "farm" | "consent") {
  return useQuery({
    queryKey: ["oauth-request", step, q],
    queryFn: () => api.get<OAuthRequest>(`/oauth/request?q=${encodeURIComponent(q)}`),
    enabled: q.includes("sig="),
    retry: false,
    staleTime: Infinity,
  });
}

/** Suite du parcours : une page de Fourmy (navigation interne) ou l'application (redirection). */
function useFollow() {
  const navigate = useNavigate();
  return (next: OAuthNext) => {
    const url = new URL(next.url, globalThis.location.origin);
    if (url.origin === globalThis.location.origin && url.pathname.startsWith("/oauth/")) navigate(url.pathname + url.search, { replace: true });
    else globalThis.location.assign(url.toString());
  };
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Center mih="100vh" p="md">
      <Paper p="xl" w={640} maw="100%">
        <Stack>
          <Wordmark style={{ fontSize: "1.6rem" }} />
          <Title order={2}>{title}</Title>
          {children}
        </Stack>
      </Paper>
    </Center>
  );
}

const Invalid = () => (
  <Frame title="Autorisation interrompue">
    <Alert color="brique">Cette demande d'autorisation est invalide ou a expiré. Recommencez depuis l'application.</Alert>
  </Frame>
);

/** Étape 1 : la ferme que l'application pourra consulter. Une seule ferme : choisie d'office. */
export function OAuthFarmPage() {
  const q = useOAuthQuery();
  const request = useOAuthRequest(q, "farm");
  const follow = useFollow();
  const [farmId, setFarmId] = useState<string | null>(null);
  const choose = useMutation({
    mutationFn: (id: string) => api.post<OAuthNext>("/oauth/farm", { farmId: id, oauthQuery: q }),
    onSuccess: follow,
  });
  const auto = useRef(false);
  const only = request.data?.farms.length === 1 ? request.data.farms[0]!.id : null;
  useEffect(() => {
    if (only && !auto.current) {
      auto.current = true;
      choose.mutate(only);
    }
  }, [only, choose]);
  const farms = request.data?.farms ?? [];

  if (!q.includes("sig=") || request.error) return <Invalid />;
  if (!request.data || farms.length === 1) {
    return (
      <Frame title="Autorisation">
        {choose.error ? <Alert color="brique">{message(choose.error)}</Alert> : <Loader size="sm" />}
      </Frame>
    );
  }
  const app = request.data.client;
  return (
    <Frame title={`Connecter « ${app.name} »`}>
      {!farms.length ? (
        <Alert color="paille">Vous n'êtes membre d'aucune ferme : rien à ouvrir à cette application.</Alert>
      ) : (
        <>
          <Text size="sm">Quelle ferme cette application pourra-t-elle consulter ? Pour une autre ferme, il faudra l'autoriser à nouveau.</Text>
          <Radio.Group value={farmId} onChange={setFarmId} aria-label="Ferme">
            <Stack gap="xs">
              {farms.map((f) => (
                <Radio
                  key={f.id}
                  value={f.id}
                  label={
                    <Group gap="xs">
                      {f.name}
                      <Badge size="xs" variant="light" color="ardoise">
                        {MEMBER_ROLE_LABELS[f.role]}
                      </Badge>
                    </Group>
                  }
                />
              ))}
            </Stack>
          </Radio.Group>
          {choose.error && <Alert color="brique">{message(choose.error)}</Alert>}
          <Group justify="flex-end">
            <Button disabled={!farmId} loading={choose.isPending} onClick={() => farmId && choose.mutate(farmId)}>
              Continuer
            </Button>
          </Group>
        </>
      )}
    </Frame>
  );
}

/** Étape 2 : ce que l'application pourra consulter, puis « Autoriser » ou « Refuser ». */
export function OAuthConsentPage() {
  const q = useOAuthQuery();
  const request = useOAuthRequest(q, "consent");
  const follow = useFollow();
  const [grant, setGrant] = useState<AccessGrant | null>(null);
  const answer = useMutation({
    mutationFn: (accept: boolean) => api.post<OAuthNext>("/oauth/consent", accept ? { accept, grant, oauthQuery: q } : { accept, oauthQuery: q }),
    onSuccess: follow,
  });
  const data = request.data;
  useEffect(() => {
    if (data && grant === null) setGrant(data.current ?? DEFAULT_GRANT);
  }, [data, grant]);

  if (!q.includes("sig=") || request.error) return <Invalid />;
  const farm = data?.farms.find((f) => f.id === data.farmId);
  if (!data || !grant) return <Frame title="Autorisation">{<Loader size="sm" />}</Frame>;
  if (!farm) return <Invalid />;
  return (
    <Frame title={`Autoriser « ${data.client.name} » ?`}>
      <Text size="sm">
        Cette application pourra <b>consulter</b> les données de la ferme <b>{farm.name}</b> choisies ci-dessous, en votre nom, sans votre mot de passe.
        {data.write
          ? " Elle demande aussi à proposer des interventions : ouvrez « Lecture et propositions » pour le lui permettre. Ses propositions n'écrivent rien sans la validation du responsable de la ferme."
          : " Elle ne pourra rien modifier."}
        {data.client.uri && (
          <>
            {" "}
            Site de l'application :{" "}
            <a href={data.client.uri} target="_blank" rel="noreferrer noopener">
              {new URL(data.client.uri).host}
            </a>
            .
          </>
        )}
      </Text>
      {farm.role !== "owner" && (
        <Text size="xs" c="dimmed">
          Vos propres droits sur cette ferme plafonnent ce que vous ouvrez : un module ou une activité que vous ne voyez pas reste fermé.
        </Text>
      )}
      <AccessGrantEditor farmId={farm.id} value={grant} onChange={setGrant} writable={data.write && farm.role !== "reader"} />
      <Text size="xs" c="dimmed">
        Vous pourrez retirer cet accès à tout moment dans Ma ferme → Accès externes.
      </Text>
      {answer.error && <Alert color="brique">{message(answer.error)}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" loading={answer.isPending && answer.variables === false} onClick={() => answer.mutate(false)}>
          Refuser
        </Button>
        <Button disabled={!grantUsable(grant)} loading={answer.isPending && answer.variables === true} onClick={() => answer.mutate(true)}>
          Autoriser
        </Button>
      </Group>
    </Frame>
  );
}
