import { useState } from "react";
import { Alert, Button, Center, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { useNavigate } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { DEV_USER_ID, signIn } from "../../app/session";

/**
 * Connexion de **développement** : identifiant d'utilisateur (UUID). Sera
 * remplacée par better-auth (comptes locaux, SSO) — l'écran le dit.
 */
export function LoginPage() {
  const [userId, setUserId] = useState(DEV_USER_ID);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  return (
    <Center mih="100vh" p="md">
      <Paper p="xl" w={420} maw="100%">
        <Stack>
          <Wordmark style={{ fontSize: "2rem" }} />
          <Title order={2}>Connexion</Title>
          <Alert color="ardoise" title="Connexion de développement">
            En attendant les comptes (better-auth), saisissez l'identifiant d'un utilisateur. Celui de{" "}
            <code>seed:dev</code> est prérempli.
          </Alert>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (signIn(userId)) navigate("/fermes");
              else setError("Identifiant invalide : un UUID est attendu.");
            }}
          >
            <Stack>
              <TextInput
                label="Identifiant utilisateur"
                value={userId}
                onChange={(e) => setUserId(e.currentTarget.value)}
                error={error}
                ff="monospace"
                autoComplete="off"
              />
              <Button type="submit">Se connecter</Button>
            </Stack>
          </form>
          <Text size="xs" c="dimmed">
            Fourmy — le jumeau numérique de la ferme.
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}
