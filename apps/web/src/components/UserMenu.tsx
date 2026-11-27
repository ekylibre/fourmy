import { useState } from "react";
import { Alert, Avatar, Button, Group, Menu, Modal, PasswordInput, Stack, Text, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Building, KeyRound, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { MEMBER_ROLE_LABELS, type PersonSheet } from "@fourmy/contracts";
import { api, farmPath } from "../app/api";
import { useFarm, useMyFarms } from "../app/farm";
import { authClient, useSession, useSignOut } from "../app/session";
import { initials, photoUrl } from "../features/team/PersonAvatar";

/**
 * Menu du compte (claudedocs/besoins_navigation_compte.md §3.1) : un rond en
 * haut à droite, photo de la fiche personne de l'utilisateur ou ses
 * initiales ; au clic, son nom, son e-mail, son rôle et la ferme ouverte,
 * puis Ma ferme, le mot de passe et la déconnexion.
 */
export function UserMenu() {
  const farm = useFarm();
  const farms = useMyFarms();
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [password, setPassword] = useState(false);
  // Sa propre fiche, pour la photo ; sans fiche sur cette ferme (404), les initiales suffisent.
  const me = useQuery({
    queryKey: ["people", "me", farm.id],
    queryFn: () => api.get<{ sheet: PersonSheet }>(farmPath(farm.id, "/people/me")),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const user = session.data;
  const name = user?.name ?? user?.email ?? "";
  const sheet = me.data?.sheet;
  const logout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <>
      <Menu position="bottom-end" width={260} shadow="md" withinPortal>
        <Menu.Target>
          <UnstyledButton aria-label={`Compte de ${name}`} style={{ borderRadius: "50%" }}>
            <Avatar
              src={sheet?.photo ? photoUrl(farm.id, sheet.id, sheet.photo.hash) : null}
              alt={sheet?.photo ? `Photo de ${name}` : undefined}
              radius="xl"
              size={36}
              color="lichen"
              variant="filled"
            >
              {initials(sheet ?? { name: name || "?" })}
            </Avatar>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Stack gap={2} px="sm" py="xs" aria-label="Compte connecté">
            <Text fw={600} size="sm" truncate>
              {name}
            </Text>
            {user?.name && (
              <Text size="xs" c="dimmed" truncate>
                {user.email}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {MEMBER_ROLE_LABELS[farm.role]}
            </Text>
          </Stack>
          <Menu.Divider />
          <Menu.Label>Ferme ouverte</Menu.Label>
          <Text size="sm" px="sm" pb={4} truncate>
            {farm.name}
          </Text>
          {(farms.data?.items.length ?? 0) > 1 && (
            <Menu.Item component={Link} to="/farms" leftSection={<ArrowLeftRight size={16} />}>
              Changer de ferme
            </Menu.Item>
          )}
          {farm.role !== "guest" && (
            <Menu.Item component={Link} to={`/f/${farm.id}/farm`} leftSection={<Building size={16} />}>
              Ma ferme
            </Menu.Item>
          )}
          <Menu.Item leftSection={<KeyRound size={16} />} onClick={() => setPassword(true)}>
            Changer de mot de passe
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<LogOut size={16} />} onClick={logout}>
            Se déconnecter
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <ChangePasswordModal opened={password} onClose={() => setPassword(false)} />
    </>
  );
}

/** 10 caractères au moins, comme à l'invitation (minPasswordLength de l'API). */
const MIN_PASSWORD = 10;

/**
 * Changement de mot de passe (§3.3) : les sessions ouvertes sur les autres
 * appareils sont fermées, celle-ci reste ouverte.
 */
function ChangePasswordModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const close = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    setSaving(true);
    setError(null);
    const { error: e } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setSaving(false);
    if (!e) {
      notifications.show({ color: "lichen", message: "Mot de passe modifié. Les sessions ouvertes sur d'autres appareils sont fermées." });
      close();
      return;
    }
    if (e.code === "INVALID_PASSWORD" || e.status === 400 || e.status === 401) setError("Mot de passe actuel incorrect.");
    else if (e.status === 429) setError("Trop de tentatives : réessayez dans un instant.");
    else setError(e.message ?? "Modification impossible.");
  };

  return (
    <Modal opened={opened} onClose={close} title="Changer de mot de passe">
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        <Stack>
          <PasswordInput label="Mot de passe actuel" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} autoComplete="current-password" required />
          <PasswordInput
            label="Nouveau mot de passe"
            description={`${MIN_PASSWORD} caractères au moins.`}
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
            error={tooShort ? `${MIN_PASSWORD} caractères au moins.` : null}
            autoComplete="new-password"
            required
          />
          <PasswordInput
            label="Confirmez le nouveau mot de passe"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            error={mismatch ? "Les deux saisies sont différentes." : null}
            autoComplete="new-password"
            required
          />
          {error && <Alert color="brique">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Annuler
            </Button>
            <Button type="submit" loading={saving} disabled={!current || next.length < MIN_PASSWORD || next !== confirm}>
              Enregistrer
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
