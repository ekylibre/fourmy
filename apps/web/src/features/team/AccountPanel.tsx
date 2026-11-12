import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Alert, Button, CopyButton, Group, Modal, Paper, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, MailPlus, Trash2, UserMinus, X } from "lucide-react";
import { MEMBER_ROLE_LABELS, type InvitationResult, type MemberRole, type PersonSheet } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { formatDateTime } from "../../app/labels";

const ROLE_OPTIONS = (Object.keys(MEMBER_ROLE_LABELS) as MemberRole[]).map((value) => ({ value, label: MEMBER_ROLE_LABELS[value] }));
const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

/**
 * Compte Fourmy d'une personne (responsable) : rôle et retrait de l'accès ;
 * sans compte, invitation par email ou par lien à transmettre (lot P3).
 */
export function AccountPanel({ farmId, sheet: s }: { farmId: string; sheet: PersonSheet }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["people", farmId] });
  const fail = (e: unknown) => notifications.show({ color: "brique", title: "Refusé", message: message(e) });

  const changeRole = useMutation({
    mutationFn: (r: MemberRole) => api.patch(farmPath(farmId, `/people/${s.id}/account`), { role: r }),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Rôle modifié." });
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(farmPath(farmId, `/people/${s.id}/account`)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Accès retiré : la personne et son historique restent." });
      setConfirm(false);
      refresh();
    },
    onError: fail,
  });

  return (
    <Paper p="md">
      <Title order={4} mb="xs">
        Compte Fourmy
      </Title>
      {s.account.status === "active" && s.account.role ? (
        <Stack gap="sm">
          <Select label="Rôle sur la ferme" data={ROLE_OPTIONS} value={s.account.role} allowDeselect={false} onChange={(v) => v && changeRole.mutate(v as MemberRole)} />
          <Text size="xs" c="dimmed">
            Lecture seule : consulte la ferme et exporte les registres, sans rien saisir ni voir les coordonnées.
          </Text>
          <Button variant="subtle" color="brique" leftSection={<UserMinus size={16} />} onClick={() => setConfirm(true)} w="fit-content">
            Retirer l'accès
          </Button>
          <Modal opened={confirm} onClose={() => setConfirm(false)} title="Retirer l'accès">
            <Text size="sm">{s.name} ne pourra plus se connecter à cette ferme. Sa fiche et ses interventions restent.</Text>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setConfirm(false)}>
                Annuler
              </Button>
              <Button color="brique" loading={remove.isPending} onClick={() => remove.mutate()}>
                Retirer l'accès
              </Button>
            </Group>
          </Modal>
        </Stack>
      ) : (
        <Invite farmId={farmId} sheet={s} onChange={refresh} />
      )}
    </Paper>
  );
}

/** Invitation : email (si le serveur en envoie), sinon lien à copier ; renvoi, annulation. */
function Invite({ farmId, sheet: s, onChange }: { farmId: string; sheet: PersonSheet; onChange: () => void }) {
  const [email, setEmail] = useState(s.invitation?.email ?? s.private?.email ?? "");
  const [role, setRole] = useState<MemberRole>(s.invitation?.role ?? "worker");
  const [result, setResult] = useState<InvitationResult | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<InvitationResult>(farmPath(farmId, `/people/${s.id}/invitations`), { email: email.trim() || undefined, role }),
    onSuccess: (r) => {
      setResult(r);
      notifications.show({ color: "lichen", message: r.sentByEmail ? `Invitation envoyée à ${r.email}.` : "Invitation créée : lien à transmettre." });
      onChange();
    },
  });
  const revoke = useMutation({
    mutationFn: () => api.delete(farmPath(farmId, `/people/${s.id}/invitations`)),
    onSuccess: () => {
      setResult(null);
      notifications.show({ color: "lichen", message: "Invitation annulée." });
      onChange();
    },
    onError: (e) => notifications.show({ color: "brique", title: "Refusé", message: message(e) }),
  });

  return (
    <Stack gap="sm">
      {s.invitation ? (
        <Alert color="ardoise" title="Invitation en cours">
          {s.invitation.sentByEmail ? `Envoyée par email à ${s.invitation.email}` : `Lien créé pour ${s.invitation.email}`}, rôle {MEMBER_ROLE_LABELS[s.invitation.role].toLowerCase()} ;
          valable jusqu'au {formatDateTime(s.invitation.expiresAt)}.
        </Alert>
      ) : (
        <Text size="sm" c="dimmed">
          Sans compte : la personne est intervenante, sans accès à Fourmy. Invitez-la pour qu'elle crée son compte ; elle garde son historique.
        </Text>
      )}
      {result?.link && (
        <Alert color="paille" title="Lien d'invitation à transmettre">
          <Text size="sm" mb="xs">
            Le serveur n'envoie pas d'email : copiez ce lien et envoyez-le à la personne (SMS, messagerie). Il ne sert qu'une fois et n'est plus affiché ensuite.
          </Text>
          <Group gap="xs" wrap="nowrap">
            <TextInput value={result.link} readOnly aria-label="Lien d'invitation" style={{ flex: 1 }} onFocus={(e) => e.currentTarget.select()} />
            <CopyButton value={result.link}>
              {({ copied, copy }) => (
                <Button variant="light" leftSection={<Copy size={14} />} onClick={copy}>
                  {copied ? "Copié" : "Copier"}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Alert>
      )}
      <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
      <Select label="Rôle" data={ROLE_OPTIONS} value={role} allowDeselect={false} onChange={(v) => v && setRole(v as MemberRole)} />
      <Group gap="xs">
        <Button leftSection={<MailPlus size={16} />} disabled={!email.trim()} loading={invite.isPending} onClick={() => invite.mutate()}>
          {s.invitation ? "Renvoyer une invitation" : "Inviter"}
        </Button>
        {s.invitation && (
          <Button variant="subtle" color="brique" leftSection={<X size={16} />} loading={revoke.isPending} onClick={() => revoke.mutate()}>
            Annuler l'invitation
          </Button>
        )}
      </Group>
      {invite.error && <Alert color="brique">{message(invite.error)}</Alert>}
    </Stack>
  );
}

/** Supprimer une personne : effacée sans historique, anonymisée sinon (design §4.4). */
export function ErasePerson({ farmId, sheet: s }: { farmId: string; sheet: PersonSheet }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const erase = useMutation({
    mutationFn: () => api.delete<{ result: "deleted" | "anonymized" }>(farmPath(farmId, `/people/${s.id}`)),
    onSuccess: (r) => {
      notifications.show({ color: "lichen", message: r?.result === "deleted" ? "Personne supprimée." : "Personne anonymisée : ses interventions restent." });
      void queryClient.invalidateQueries({ queryKey: ["people", farmId] });
      const back = new URLSearchParams(location.search);
      back.delete("tab");
      navigate(`/f/${farmId}/team${back.size ? `?${back}` : ""}`);
    },
  });
  return (
    <>
      <Button variant="subtle" color="brique" leftSection={<Trash2 size={16} />} onClick={() => setOpen(true)}>
        Supprimer
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={`Supprimer ${s.name}`}>
        <Stack gap="sm">
          <Text size="sm">
            Sans intervention ni attelage type, la fiche est supprimée. Sinon elle est <strong>anonymisée</strong> : nom remplacé, coordonnées, photo, contrat et Certiphyto effacés,
            accès retiré ; ses interventions et ses heures restent (registres).
          </Text>
          <Text size="sm">Cette action ne peut pas être annulée.</Text>
          {erase.error && <Alert color="brique">{message(erase.error)}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button color="brique" loading={erase.isPending} onClick={() => erase.mutate()}>
              Supprimer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
