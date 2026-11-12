import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { Badge, Button, Card, Group, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { Plus, Search } from "lucide-react";
import { MEMBER_ROLE_LABELS, type PersonCard } from "@fourmy/contracts";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate, procedureLabel } from "../../app/labels";
import { useTeam } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { PersonAvatar } from "./PersonAvatar";
import { PersonFormModal } from "./PersonForm";

/** Rôle affiché sur le pavé : celui du compte, sinon « Sans compte ». */
export const accountLabel = (p: Pick<PersonCard, "account">) =>
  p.account.status === "active" && p.account.role ? MEMBER_ROLE_LABELS[p.account.role] : p.account.status === "invited" ? "Invitée" : "Sans compte";

export const CERTIPHYTO_BADGE = {
  expired: { label: "Certiphyto expiré", color: "brique" },
  expiring: { label: "Certiphyto à renouveler", color: "paille" },
} as const;

const hours = (h: number) => `${h.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

/**
 * Équipe (docs/equipe-personnes-design.md §6) : une grille de pavés, un par
 * personne (avec ou sans compte) ; un clic ouvre sa fiche.
 */
export function TeamPage() {
  const farm = useFarm();
  const { day } = useAt();
  const location = useLocation();
  const team = useTeam(farm.id, day);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [account, setAccount] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (team.data?.items ?? []).filter(
      (p) =>
        (status === "all" || (status === "active") === p.active) &&
        (!account || (account === "none" ? p.account.status !== "active" : p.account.role === account)) &&
        (!needle || p.name.toLowerCase().includes(needle)),
    );
  }, [team.data, q, status, account]);

  if (team.error) return <ErrorAlert error={team.error} />;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Équipe</Title>
        {farm.role === "owner" && (
          <Button leftSection={<Plus size={16} />} onClick={() => setCreating(true)}>
            Ajouter une personne
          </Button>
        )}
      </Group>
      <Group gap="sm" wrap="wrap">
        <TextInput aria-label="Rechercher une personne" placeholder="Rechercher" leftSection={<Search size={14} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={220} />
        <SegmentedControl
          aria-label="Personnes actives ou non"
          value={status}
          onChange={setStatus}
          data={[
            { value: "active", label: "Actives" },
            { value: "inactive", label: "Inactives" },
            { value: "all", label: "Toutes" },
          ]}
        />
        <Select
          aria-label="Compte"
          placeholder="Tous les comptes"
          clearable
          w={200}
          value={account}
          onChange={setAccount}
          data={[
            { value: "owner", label: "Responsables" },
            { value: "worker", label: "Salariés" },
            { value: "reader", label: "Lecture seule" },
            { value: "none", label: "Sans compte" },
          ]}
        />
      </Group>
      {!team.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Text c="dimmed">Personne ne correspond.</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, xl: 4 }} spacing="md">
          {items.map((p) => (
            <PersonTile key={p.id} farmId={farm.id} person={p} search={location.search} />
          ))}
        </SimpleGrid>
      )}
      {creating && <PersonFormModal farmId={farm.id} onClose={() => setCreating(false)} />}
    </Stack>
  );
}

/** Pavé d'une personne : un lien vers sa fiche (clavier compris). */
function PersonTile({ farmId, person: p, search }: { farmId: string; person: PersonCard; search: string }) {
  const cert = p.certiphyto.status === "expired" || p.certiphyto.status === "expiring" ? CERTIPHYTO_BADGE[p.certiphyto.status] : null;
  return (
    <Card component={Link} to={`/f/${farmId}/team/${p.id}${search}`} withBorder padding="md" radius="md" aria-label={p.name} style={{ opacity: p.active ? 1 : 0.65 }}>
      <Group wrap="nowrap" align="flex-start">
        <PersonAvatar farmId={farmId} person={p} />
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Text fw={600} truncate>
            {p.name}
          </Text>
          <Group gap={4}>
            <Badge size="sm" variant="light" color={p.account.status === "active" ? "lichen" : "gray"}>
              {accountLabel(p)}
            </Badge>
            {!p.active && (
              <Badge size="sm" variant="outline" color="gray">
                Inactive
              </Badge>
            )}
            {cert && (
              <Badge size="sm" variant="light" color={cert.color}>
                {cert.label}
              </Badge>
            )}
          </Group>
          {p.monthHours !== null && (
            <Text size="sm" c="dimmed" className="lv-num">
              {hours(p.monthHours)} ce mois-ci
            </Text>
          )}
          {p.lastIntervention && (
            <Text size="sm" c="dimmed" truncate>
              {procedureLabel(p.lastIntervention.procedure)} le {formatDate(p.lastIntervention.date)}
            </Text>
          )}
        </Stack>
      </Group>
    </Card>
  );
}
