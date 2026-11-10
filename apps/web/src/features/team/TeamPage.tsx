import { useState } from "react";
import { Alert, Badge, Button, Group, Paper, Select, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FarmMember, Person } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { useMembers, usePeople } from "../../app/queries";
import { useSession } from "../../app/session";
import { useColumns, type ColumnDef } from "../../app/columns";
import { ColumnPicker } from "../../components/ColumnPicker";
import { ErrorAlert, Loading } from "../../components/states";

const MEMBER_COLUMNS: ColumnDef[] = [
  { key: "account", label: "Compte", required: true },
  { key: "role", label: "Rôle" },
  { key: "person", label: "Personne" },
  { key: "actions", label: "Actions", required: true },
];
const PEOPLE_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Nom", required: true },
  { key: "account", label: "Compte" },
  { key: "active", label: "Active" },
];

const ROLES = [
  { value: "owner", label: "Responsable" },
  { value: "worker", label: "Salarié" },
];

/**
 * Équipe (responsable) : les **membres** ont un compte et accèdent à la ferme ;
 * les **personnes** sont les intervenants des interventions, avec ou sans
 * compte. Rattacher une personne à un membre relie ses saisies mobiles.
 */
export function TeamPage() {
  const farm = useFarm();
  const me = useSession();
  const queryClient = useQueryClient();
  const members = useMembers(farm.id);
  const people = usePeople(farm.id);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string | null>("worker");
  const [personName, setPersonName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const useAction = <T,>(fn: (arg: T) => Promise<unknown>, message: string) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => {
        setError(null);
        notifications.show({ color: "lichen", message });
        for (const key of ["members", "people"]) void queryClient.invalidateQueries({ queryKey: [key] });
      },
      onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
    });

  const addMember = useAction(() => api.post(farmPath(farm.id, "/members"), { email, role }), "Membre ajouté.");
  const setMemberRole = useAction((m: { userId: string; role: string }) => api.patch(farmPath(farm.id, `/members/${m.userId}`), { role: m.role }), "Rôle modifié.");
  const removeMember = useAction((userId: string) => api.delete(farmPath(farm.id, `/members/${userId}`)), "Membre retiré.");
  const addPerson = useAction(() => api.post(farmPath(farm.id, "/people"), { name: personName }), "Personne ajoutée.");
  const patchPerson = useAction((p: { id: string; body: Partial<Pick<Person, "active" | "userId">> }) => api.patch(farmPath(farm.id, `/people/${p.id}`), p.body), "Personne mise à jour.");

  const memberColumns = useColumns("team-members", MEMBER_COLUMNS);
  const peopleColumns = useColumns("team-people", PEOPLE_COLUMNS);

  if (members.isLoading || people.isLoading) return <Loading />;
  if (members.error) return <ErrorAlert error={members.error} />;
  const memberList: FarmMember[] = members.data?.items ?? [];
  const personList: Person[] = people.data?.items ?? [];
  const linkable = (p: Person) =>
    memberList.filter((m) => !m.personId || m.personId === p.id).map((m) => ({ value: m.userId, label: m.name ? `${m.name} (${m.email})` : m.email }));

  return (
    <Stack>
      <Title order={1}>Équipe</Title>
      {error && (
        <Alert color="brique" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper p="md">
        <Stack>
          <Group justify="space-between">
            <Title order={2}>Membres</Title>
            <ColumnPicker columns={memberColumns} />
          </Group>
          <Text size="sm" c="dimmed">
            Comptes ayant accès à la ferme. Un compte est créé par l'administrateur de Fourmy ; ajoutez-le ici par son e-mail.
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Compte</Table.Th>
                {memberColumns.visible("role") && <Table.Th>Rôle</Table.Th>}
                {memberColumns.visible("person") && <Table.Th>Personne</Table.Th>}
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {memberList.map((m) => (
                <Table.Tr key={m.userId}>
                  <Table.Td>
                    {m.name ?? m.email}
                    {m.name && (
                      <Text size="xs" c="dimmed">
                        {m.email}
                      </Text>
                    )}
                  </Table.Td>
                  {memberColumns.visible("role") && (
                    <Table.Td>
                      <Select
                        aria-label={`Rôle de ${m.email}`}
                        size="xs"
                        w={150}
                        data={ROLES}
                        value={m.role}
                        allowDeselect={false}
                        onChange={(r) => r && r !== m.role && setMemberRole.mutate({ userId: m.userId, role: r })}
                      />
                    </Table.Td>
                  )}
                  {memberColumns.visible("person") && <Table.Td>{personList.find((p) => p.id === m.personId)?.name ?? <Text c="dimmed">—</Text>}</Table.Td>}
                  <Table.Td ta="right">
                    {m.userId !== me.data?.id && (
                      <Button size="xs" variant="subtle" color="brique" onClick={() => removeMember.mutate(m.userId)}>
                        Retirer
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addMember.mutate(undefined, { onSuccess: () => setEmail("") });
            }}
          >
            <Group align="flex-end">
              <TextInput label="E-mail du compte" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} style={{ flex: 1 }} />
              <Select label="Rôle" data={ROLES} value={role} onChange={setRole} allowDeselect={false} w={160} />
              <Button type="submit" loading={addMember.isPending}>
                Ajouter
              </Button>
            </Group>
          </form>
        </Stack>
      </Paper>

      <Paper p="md">
        <Stack>
          <Group justify="space-between">
            <Title order={2}>Personnes</Title>
            <ColumnPicker columns={peopleColumns} />
          </Group>
          <Text size="sm" c="dimmed">
            Intervenants proposés dans les interventions. Rattachez une personne à son compte pour relier ses saisies mobiles.
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nom</Table.Th>
                {peopleColumns.visible("account") && <Table.Th>Compte</Table.Th>}
                {peopleColumns.visible("active") && <Table.Th>Active</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {personList.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    {p.name} {p.role && <Badge color="gray" variant="light">{p.role}</Badge>}
                  </Table.Td>
                  {peopleColumns.visible("account") && (
                    <Table.Td>
                      <Select
                        aria-label={`Compte de ${p.name}`}
                        size="xs"
                        w={260}
                        placeholder="Sans compte"
                        data={linkable(p)}
                        value={p.userId}
                        // Détacher n'est pas proposé ici : retirer le membre détache sa personne.
                        allowDeselect={false}
                        onChange={(userId) => userId && patchPerson.mutate({ id: p.id, body: { userId } })}
                      />
                    </Table.Td>
                  )}
                  {peopleColumns.visible("active") && (
                    <Table.Td>
                      <Switch
                        aria-label={`${p.name} active`}
                        checked={p.active}
                        onChange={(e) => patchPerson.mutate({ id: p.id, body: { active: e.currentTarget.checked } })}
                      />
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addPerson.mutate(undefined, { onSuccess: () => setPersonName("") });
            }}
          >
            <Group align="flex-end">
              <TextInput label="Nom" required value={personName} onChange={(e) => setPersonName(e.currentTarget.value)} style={{ flex: 1 }} />
              <Button type="submit" loading={addPerson.isPending}>
                Ajouter une personne
              </Button>
            </Group>
          </form>
        </Stack>
      </Paper>
    </Stack>
  );
}
