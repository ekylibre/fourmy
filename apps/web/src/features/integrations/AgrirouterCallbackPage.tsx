import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, Anchor, Center, Loader, Stack, Text } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, farmPath } from "../../app/api";

/**
 * Retour du consentement agrirouter (adresse AGRIROUTER_REDIRECT_URI) :
 * `state` (ferme + jeton à usage unique), `tenant_id` ou `error`. La page
 * termine la connexion auprès de l'API (qui vérifie l'état et l'autorisation
 * chez agrirouter), puis renvoie vers les intégrations de la ferme.
 */
export function AgrirouterCallbackPage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const state = params.get("state") ?? "";
  const tenantId = params.get("tenant_id");
  const refused = params.get("error");
  const farmId = /^[0-9a-f-]{36}(?=\.)/i.exec(state)?.[0] ?? null;
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!farmId) return setOutcome({ ok: false, message: "Retour d'agrirouter incomplet (état manquant)." });
    if (refused) return setOutcome({ ok: false, message: refused === "access_denied" ? "Connexion refusée dans agrirouter." : `agrirouter : ${refused}.` });
    if (!tenantId) return setOutcome({ ok: false, message: "Retour d'agrirouter incomplet (ferme agrirouter manquante)." });
    api
      .post(farmPath(farmId, "/integrations/agrirouter/complete"), { state, tenantId })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["integrations"] });
        setOutcome({ ok: true, message: "Ferme connectée à agrirouter. Les machines reliées à Fourmy apparaissent après la synchronisation." });
      })
      .catch((e: unknown) => setOutcome({ ok: false, message: e instanceof ApiError ? (e.detail ?? e.title) : String(e) }));
  }, [farmId, refused, state, tenantId, queryClient]);

  return (
    <Center mih="60vh" p="md">
      <Stack maw={520}>
        {!outcome ? (
          <Stack align="center">
            <Loader />
            <Text>Connexion à agrirouter…</Text>
          </Stack>
        ) : (
          <Alert color={outcome.ok ? "lichen" : "brique"} title={outcome.ok ? "agrirouter connecté" : "Connexion agrirouter impossible"}>
            {outcome.message}
          </Alert>
        )}
        {outcome && (
          <Anchor component={Link} to={farmId ? `/f/${farmId}/integrations` : "/farms"}>
            Retour aux intégrations
          </Anchor>
        )}
      </Stack>
    </Center>
  );
}
