import { useState } from "react";
import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { DEV_EMAIL, signIn } from "../../app/session";

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

  return (
    <Center mih="100vh" p="md">
      <Paper p="xl" w={420} maw="100%">
        <Stack>
          <Wordmark style={{ fontSize: "2rem" }} />
          <Title order={2}>Connexion</Title>
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
              await queryClient.invalidateQueries({ queryKey: ["session"] });
              navigate("/farms");
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
