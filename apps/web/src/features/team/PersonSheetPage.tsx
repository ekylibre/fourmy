import { useState, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { Badge, Button, FileButton, Grid, Group, Paper, Stack, Table, Tabs, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImageUp, Pencil, Trash2 } from "lucide-react";
import { CERTIPHYTO_CATEGORY_LABELS, CONTRACT_TYPE_LABELS, type PersonSheet } from "@fourmy/contracts";
import { farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { usePersonSheet } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { PersonAvatar } from "./PersonAvatar";
import { PersonFormModal } from "./PersonForm";
import { PersonWorkTab } from "./PersonWorkTab";
import { AccountPanel, ErasePerson } from "./AccountPanel";
import { accountLabel, CERTIPHYTO_BADGE } from "./TeamPage";

/** Photo carrée de 256 px (JPEG), recadrée au centre dans le navigateur. */
export async function squarePhoto(file: File, size = 256): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d")?.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("Image illisible.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function putPhoto(farmId: string, id: string, blob: Blob | null) {
  const res = await fetch(`${globalThis.location?.origin ?? ""}/api/v1${farmPath(farmId, `/people/${id}/photo`)}`, {
    method: blob ? "PUT" : "DELETE",
    body: blob,
    headers: blob ? { "content-type": blob.type } : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.detail ?? b.title ?? `Erreur ${res.status}`);
  }
}

/** Fiche d'une personne (docs/equipe-personnes-design.md §6) : en-tête, onglet Général. */
export function PersonSheetPage() {
  const farm = useFarm();
  const { day } = useAt();
  const { personId = "" } = useParams();
  const location = useLocation();
  const sheet = usePersonSheet(farm.id, personId, day);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "work" ? "work" : "general";
  const back = new URLSearchParams(location.search);
  back.delete("tab");

  const photo = useMutation({
    mutationFn: async (file: File | null) => putPhoto(farm.id, personId, file ? await squarePhoto(file) : null),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Photo enregistrée." });
      void queryClient.invalidateQueries({ queryKey: ["people", farm.id] });
    },
    onError: (e) =>
      notifications.show({
        color: "brique",
        title: "Photo refusée",
        message: e instanceof Error ? e.message : String(e),
      }),
  });

  if (sheet.error) return <ErrorAlert error={sheet.error} />;
  if (!sheet.data) return <Loading />;
  const s = sheet.data;
  const owner = farm.role === "owner";
  const cert = s.certiphyto.status === "expired" || s.certiphyto.status === "expiring" ? CERTIPHYTO_BADGE[s.certiphyto.status] : null;

  return (
    <Stack>
      <Button
        component={Link}
        to={`/f/${farm.id}/team${back.size ? `?${back}` : ""}`}
        variant="subtle"
        size="compact-sm"
        leftSection={<ArrowLeft size={14} />}
        w="fit-content"
      >
        Équipe
      </Button>
      <Group justify="space-between" align="flex-start">
        <Group gap="md" wrap="nowrap">
          <PersonAvatar farmId={farm.id} person={s} size={72} />
          <Stack gap={4}>
            <Title order={1}>{s.name}</Title>
            <Group gap="xs">
              <Badge variant="light" color={s.account.status === "active" ? "lichen" : "gray"}>
                {accountLabel(s)}
              </Badge>
              {!s.active && (
                <Badge variant="outline" color="gray">
                  Inactive
                </Badge>
              )}
              {cert && (
                <Badge variant="light" color={cert.color}>
                  {cert.label}
                </Badge>
              )}
              {s.external.ekylibre && (
                <Badge variant="outline" color="ardoise">
                  Reprise d'Ekylibre
                </Badge>
              )}
            </Group>
          </Stack>
        </Group>
        {s.canEditContact && (
          <Group>
            <FileButton accept="image/png,image/jpeg" onChange={(f) => f && photo.mutate(f)}>
              {(props) => (
                <Button {...props} variant="light" leftSection={<ImageUp size={16} />} loading={photo.isPending}>
                  {s.photo ? "Changer la photo" : "Ajouter une photo"}
                </Button>
              )}
            </FileButton>
            {s.photo && (
              <Button variant="subtle" color="brique" leftSection={<Trash2 size={16} />} onClick={() => photo.mutate(null)}>
                Retirer la photo
              </Button>
            )}
            <Button variant="default" leftSection={<Pencil size={16} />} onClick={() => setEditing(true)}>
              Modifier
            </Button>
            {owner && <ErasePerson farmId={farm.id} sheet={s} />}
          </Group>
        )}
      </Group>

      <Tabs
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams(params);
          if (v && v !== "general") next.set("tab", v);
          else next.delete("tab");
          setParams(next, { replace: true });
        }}
        keepMounted={false}
      >
        <Tabs.List>
          <Tabs.Tab value="general">Général</Tabs.Tab>
          <Tabs.Tab value="work">Temps de travaux</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="work" pt="md">
          <PersonWorkTab farmId={farm.id} personId={s.id} day={day} />
        </Tabs.Panel>
        <Tabs.Panel value="general" pt="md">
          <Grid>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Stack>
                <Identity sheet={s} />
                {s.private && <Contact sheet={s} />}
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack>
                <Certiphyto sheet={s} />
                {owner && <AccountPanel farmId={farm.id} sheet={s} />}
              </Stack>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
      </Tabs>
      {editing && <PersonFormModal farmId={farm.id} sheet={s} full={owner} onClose={() => setEditing(false)} />}
    </Stack>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Table.Tr>
      <Table.Th w="40%" fw={500} c="dimmed">
        {label}
      </Table.Th>
      <Table.Td>{children ?? "—"}</Table.Td>
    </Table.Tr>
  );
}

function Identity({ sheet: s }: { sheet: PersonSheet }) {
  return (
    <Paper p="md">
      <Title order={4} mb="xs">
        Identité
      </Title>
      <Table>
        <Table.Tbody>
          <Row label="Prénom">{s.firstName}</Row>
          <Row label="Nom">{s.lastName}</Row>
          {s.private && <Row label="Date de naissance">{s.private.birthDate ? formatDate(s.private.birthDate) : null}</Row>}
          {s.private && (
            <Row label="Contrat">
              {s.private.contract.type
                ? `${CONTRACT_TYPE_LABELS[s.private.contract.type]}${s.private.contract.startedOn ? ` depuis le ${formatDate(s.private.contract.startedOn)}` : ""}${s.private.contract.endedOn ? ` jusqu'au ${formatDate(s.private.contract.endedOn)}` : ""}`
                : null}
            </Row>
          )}
        </Table.Tbody>
      </Table>
      {!s.firstName && !s.lastName && s.canEditContact && (
        <Text size="sm" c="dimmed" mt="xs">
          Prénom et nom à saisir (« Modifier ») : le nom affiché vient de l'ancienne fiche.
        </Text>
      )}
    </Paper>
  );
}

function Contact({ sheet: s }: { sheet: PersonSheet }) {
  const p = s.private!;
  const address = [
    p.address.line1,
    p.address.line2,
    [p.address.postalCode, p.address.city].filter(Boolean).join(" "),
    p.address.country && p.address.country !== "FR" ? p.address.country : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Paper p="md" aria-label="Coordonnées">
      <Title order={4} mb="xs">
        Coordonnées
      </Title>
      <Text size="xs" c="dimmed" mb="xs">
        Visibles du responsable de la ferme et de la personne seulement.
      </Text>
      <Table>
        <Table.Tbody>
          <Row label="Email">{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : null}</Row>
          <Row label="Portable">{p.mobile ? <a href={`tel:${p.mobile.replace(/[^0-9+]/g, "")}`}>{p.mobile}</a> : null}</Row>
          <Row label="Adresse">{address || null}</Row>
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

function Certiphyto({ sheet: s }: { sheet: PersonSheet }) {
  const c = s.certiphyto;
  return (
    <Paper p="md">
      <Title order={4} mb="xs">
        Certiphyto
      </Title>
      {c.status === "none" && !c.number ? (
        <Text size="sm" c="dimmed">
          Non renseigné.
        </Text>
      ) : (
        <Table>
          <Table.Tbody>
            <Row label="Catégorie">{c.category ? CERTIPHYTO_CATEGORY_LABELS[c.category] : null}</Row>
            <Row label="Numéro">{c.number}</Row>
            <Row label="Valable jusqu'au">
              {c.validUntil ? (
                <Group gap="xs">
                  <span>{formatDate(c.validUntil)}</span>
                  {c.status !== "valid" && c.status !== "none" && (
                    <Badge size="sm" variant="light" color={CERTIPHYTO_BADGE[c.status].color}>
                      {c.status === "expired" ? "expiré" : "à renouveler"}
                    </Badge>
                  )}
                </Group>
              ) : null}
            </Row>
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}
