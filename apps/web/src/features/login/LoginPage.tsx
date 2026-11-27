import { useState } from "react";
import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { DEV_EMAIL, sessionQuery, signIn } from "../../app/session";

/**
 * Requête d'autorisation OAuth à reprendre après la connexion : les paramètres
 * d'origine, sans la signature ajoutée par le serveur (`sig`, `ba_*`).
 */
export function oauthResume(params: URLSearchParams): string | null {
  if (!params.has("sig") || !params.has("client_id")) return null;
  const q = new URLSearchParams();
  for (const [k, v] of params) if (k !== "sig" && !k.startsWith("ba_") && k !== "next") q.append(k, v);
  return `/api/auth/oauth2/authorize?${q}`;
}

/**
 * Connexion par compte local (better-auth). Les comptes sont créés par
 * l'administrateur puis rattachés à une ferme par son responsable.
 */
export function LoginPage() {
  const [email, setEmail] = useState(DEV_EMAIL);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Retour après connexion (invitation, page protégée, agrirouter) : un chemin interne seulement.
  const [params] = useSearchParams();
  const next = params.get("next");
  const target = next && /^\/(?!\/)/.test(next) ? next : "/farms";
  // Connexion demandée par le serveur d'autorisation OAuth (lot AM5) : on reprend l'autorisation.
  const oauth = oauthResume(params);

  return (
    <Center mih="100vh" p="md">
      <Paper p="xl" w={420} maw="100%">
        <Stack>
          <Wordmark style={{ fontSize: "2rem" }} />
          <Title order={2}>Connexion</Title>
          {oauth && (
            <Text size="sm">Une application demande l'accès à vos données Fourmy. Connectez-vous pour choisir ce que vous lui ouvrez.</Text>
          )}
          {DEV_EMAIL && (
            <Alert color="ardoise" title="Développement">
              Compte de <code>seed:dev</code> prérempli ; son mot de passe est affiché par la commande.
            </Alert>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setPending(true);
              const failure = await signIn(email, password);
              setPending(false);
              if (failure) return setError(failure);
              // Session relue AVANT de naviguer : la page visée ne doit pas trouver l'ancienne réponse
              // « non connecté » en cache (sinon retour ici, et second clic nécessaire).
              await queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
              if (oauth) return globalThis.location.assign(oauth);
              navigate(target);
            }}
          >
            <Stack>
              <TextInput
                label="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                autoComplete="username"
                required
              />
              <PasswordInput
                label="Mot de passe"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                autoComplete="current-password"
                required
              />
              {error && <Alert color="brique">{error}</Alert>}
              <Button type="submit" loading={pending}>
                Se connecter
              </Button>
            </Stack>
          </form>
          <Text size="xs" c="dimmed">
            Pas encore de compte ? Demandez-le au responsable de votre ferme.
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}
