import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Center, Loader, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MEMBER_ROLE_LABELS, type PublicInvitation } from "@fourmy/contracts";
import { api, ApiError } from "../../app/api";
import { signIn, useSession } from "../../app/session";

/**
 * Acceptation d'une invitation (lot P3, docs/equipe-personnes-design.md §6.1) :
 * page publique. Sans compte : choisir un mot de passe ; avec un compte :
 * se connecter, puis accepter.
 */
export function InvitationPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const inv = useQuery({ queryKey: ["invitation", token], queryFn: () => api.get<PublicInvitation>(`/invitations/${token}`), retry: false });

  const accept = useMutation({
    mutationFn: async () => {
      const i = inv.data!;
      const r = await api.post<{ farmId: string; created: boolean }>(`/invitations/${token}/accept`, i.accountExists ? {} : { password });
      // Compte tout juste créé : on ouvre la session avec le mot de passe choisi.
      if (r.created) {
        const error = await signIn(i.email, password);
        if (error) throw new Error(error);
      }
      await queryClient.invalidateQueries();
      return r;
    },
    onSuccess: (r) => navigate(`/f/${r.farmId}`),
  });

  const frame = (children: ReactNode) => (
    <Center mih="100vh" p="md">
      <Paper p="xl" w={460} maw="100%">
        {children}
      </Paper>
    </Center>
  );
  if (inv.isLoading) return frame(<Loader />);
  if (inv.error || !inv.data)
    return frame(
      <Stack>
        <Title order={2}>Invitation introuvable</Title>
        <Text>Ce lien n'est pas (ou plus) valable. Demandez une nouvelle invitation au responsable de la ferme.</Text>
      </Stack>,
    );
  const i = inv.data;
  if (i.status !== "open")
    return frame(
      <Stack>
        <Title order={2}>Invitation {i.status === "accepted" ? "déjà acceptée" : i.status === "expired" ? "expirée" : "annulée"}</Title>
        <Text>
          {i.status === "accepted" ? (
            <>
              Elle a déjà servi : <Link to="/login">connectez-vous</Link>.
            </>
          ) : (
            "Demandez une nouvelle invitation au responsable de la ferme."
          )}
        </Text>
      </Stack>,
    );

  const signedAs = session.data?.email ?? null;
  const error = accept.error ? (accept.error instanceof ApiError ? accept.error.message : accept.error.message) : null;
  return frame(
    <Stack>
      <Title order={2}>Rejoindre {i.farmName}</Title>
      <Text>
        Bonjour {i.firstName}, vous êtes invité(e) sur Fourmy en tant que <strong>{MEMBER_ROLE_LABELS[i.role].toLowerCase()}</strong>.
      </Text>
      <TextInput label="Email" value={i.email} readOnly />
      {i.accountExists ? (
        signedAs?.toLowerCase() === i.email ? (
          <Button loading={accept.isPending} onClick={() => accept.mutate()}>
            Accepter l'invitation
          </Button>
        ) : (
          <Stack gap="xs">
            <Text size="sm">Un compte existe déjà pour cet email : connectez-vous avec lui, puis revenez sur ce lien.</Text>
            {signedAs && (
              <Text size="sm" c="dimmed">
                Vous êtes connecté(e) avec {signedAs}.
              </Text>
            )}
            <Button component={Link} to={`/login?next=${encodeURIComponent(`/invitation/${token}`)}`} variant="light">
              Se connecter
            </Button>
          </Stack>
        )
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            accept.mutate();
          }}
        >
          <Stack gap="sm">
            <PasswordInput label="Choisissez un mot de passe" description="10 caractères au moins." value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="new-password" />
            <PasswordInput
              label="Confirmez le mot de passe"
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
              autoComplete="new-password"
              error={confirm && confirm !== password ? "Les deux mots de passe diffèrent." : null}
            />
            <Button type="submit" loading={accept.isPending} disabled={password.length < 10 || password !== confirm}>
              Créer mon compte et rejoindre la ferme
            </Button>
          </Stack>
        </form>
      )}
      {error && <Alert color="brique">{error}</Alert>}
    </Stack>,
  );
}
