import { useState } from "react";
import { ActionIcon, Alert, Anchor, Button, Divider, Group, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  FARM_CERTIFICATION_LABELS,
  LEGAL_FORM_LABELS,
  farmCertificationKind,
  legalForm,
  siretKeyValid,
  vatFromSiren,
  type FarmCertification,
  type FarmCertificationKind,
  type FarmCertificationWrite,
  type FarmProfile,
  type FarmProfileIdentity,
  type LegalForm,
} from "@fourmy/contracts";
import { certificationAlerts } from "@fourmy/domain";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { usePeople } from "../../app/queries";
import { FarmLogoField } from "./FarmLogo";

/**
 * Identité de l'exploitation (E1 à E8) : identité légale, informations
 * métier, contacts, certificats. Un salarié voit les champs en lecture seule.
 */

/** Champs texte de l'identité, saisis tels quels puis normalisés par l'API. */
type TextKey = "legalName" | "siret" | "vatNumber" | "nafCode" | "pacage" | "cvi" | "ede" | "phone" | "email";
const FREE_NAME = "__free";

export function IdentityTab({ profile }: { profile: FarmProfile }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const people = usePeople(farm.id);
  const [form, setForm] = useState<FarmProfileIdentity>(profile.identity);
  const [error, setError] = useState<string | null>(null);
  const ro = !profile.canEdit;
  const set = (patch: Partial<FarmProfileIdentity>) => setForm((f) => ({ ...f, ...patch }));
  const field = (key: TextKey, label: string, props: { placeholder?: string; description?: string } = {}) => (
    <TextInput label={label} readOnly={ro} value={form[key] ?? ""} onChange={(e) => set({ [key]: e.currentTarget.value || null })} {...props} />
  );

  const save = useMutation({
    mutationFn: () => api.put<FarmProfileIdentity>(farmPath(farm.id, "/farm/identity"), form),
    onSuccess: (saved) => {
      setForm(saved);
      setError(null);
      notifications.show({ color: "lichen", message: "Identité enregistrée." });
      void queryClient.invalidateQueries({ queryKey: ["farm-profile", farm.id] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  // SIRET : contrôle immédiat (R4) ; TVA proposée depuis le SIREN si elle est vide.
  const siret = (form.siret ?? "").replace(/\s/g, "");
  const siretError = siret && !siretKeyValid(siret) ? (siret.length === 14 ? "SIRET invalide : la clé de contrôle ne correspond pas." : "Le SIRET compte 14 chiffres.") : null;
  const vat = !siretError && siret && !form.vatNumber ? vatFromSiren(siret.slice(0, 9)) : null;

  const rep = form.legalRep;
  const repValue = rep === null ? null : "personId" in rep ? rep.personId : FREE_NAME;
  const hq = profile.sites.find((s) => s.isHeadquarters);
  const hqAddress = hq ? [hq.address.line1, hq.address.line2, [hq.address.postalCode, hq.address.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";

  return (
    <Stack>
      <form
        aria-label="Identité de la ferme"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Stack gap="sm">
          <Title order={4}>Identité</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Nom de la ferme" required readOnly={ro} value={form.name} onChange={(e) => set({ name: e.currentTarget.value })} />
            {field("legalName", "Raison sociale", { description: "Si elle diffère du nom d'usage" })}
            <Select
              label="Forme juridique"
              readOnly={ro}
              clearable={!ro}
              data={legalForm.options.map((v) => ({ value: v, label: LEGAL_FORM_LABELS[v] }))}
              value={form.legalForm}
              onChange={(v) => set({ legalForm: v as LegalForm | null })}
            />
            <TextInput
              label="SIRET"
              readOnly={ro}
              value={form.siret ?? ""}
              error={siretError}
              onChange={(e) => set({ siret: e.currentTarget.value || null })}
            />
            <TextInput
              label="N° de TVA intracommunautaire"
              readOnly={ro}
              value={form.vatNumber ?? ""}
              onChange={(e) => set({ vatNumber: e.currentTarget.value || null })}
              description={
                vat && !ro ? (
                  <Anchor component="button" type="button" size="xs" onClick={() => set({ vatNumber: vat })}>
                    Utiliser {vat} (déduit du SIREN)
                  </Anchor>
                ) : undefined
              }
            />
            {field("nafCode", "Code NAF", { placeholder: "01.21Z" })}
          </SimpleGrid>
          <Text size="sm" c="dimmed">
            Adresse du siège : {hqAddress || "non renseignée"} (onglet Sites).
          </Text>

          <Divider />
          <Title order={4}>Informations métier</Title>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            {field("pacage", "N° PACAGE", { description: "Repris sur le registre phyto officiel" })}
            {field("cvi", "CVI (viticulture)")}
            {field("ede", "N° EDE (élevage)")}
          </SimpleGrid>

          <Divider />
          <Title order={4}>Contacts</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {field("phone", "Téléphone")}
            {field("email", "E-mail")}
            <Select
              label="Responsable légal"
              readOnly={ro}
              clearable={!ro}
              searchable
              data={[
                ...(people.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
                { value: FREE_NAME, label: "Autre personne (saisir le nom)" },
              ]}
              value={repValue}
              onChange={(v) => set({ legalRep: v === null ? null : v === FREE_NAME ? { name: rep && "name" in rep ? rep.name : "" } : { personId: v } })}
            />
            {rep && "name" in rep && (
              <TextInput label="Nom du responsable légal" required readOnly={ro} value={rep.name} onChange={(e) => set({ legalRep: { name: e.currentTarget.value } })} />
            )}
          </SimpleGrid>

          {error && <Alert color="brique">{error}</Alert>}
          {!ro && (
            <Group justify="flex-end">
              <Button type="submit" loading={save.isPending} disabled={!!siretError}>
                Enregistrer l'identité
              </Button>
            </Group>
          )}
        </Stack>
      </form>

      <Divider />
      <FarmLogoField logoAssetId={profile.logoAssetId} canEdit={profile.canEdit} />
      <Divider />
      <FarmCertifications certs={profile.certifications} canEdit={profile.canEdit} />
    </Stack>
  );
}

function FarmCertifications({ certs, canEdit }: { certs: FarmCertification[]; canEdit: boolean }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<FarmCertification | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(farmPath(farm.id, `/farm/certifications/${id}`)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Certificat supprimé." });
      void queryClient.invalidateQueries({ queryKey: ["farm-profile", farm.id] });
    },
  });
  const soon = new Map(certificationAlerts(certs, new Date().toISOString().slice(0, 10)).map((c) => [c.id, c.daysLeft]));
  return (
    <Stack gap="sm">
      <Title order={4}>Agréments et certificats</Title>
      <Text size="sm" c="dimmed">
        Les certificats de l'exploitation. Les parcelles concernées par le bio ou la HVE se déclarent sur chaque parcelle.
      </Text>
      {certs.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun certificat.
        </Text>
      ) : (
        <Table aria-label="Certificats de l'exploitation">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certificat</Table.Th>
              <Table.Th>Organisme, n°</Table.Th>
              <Table.Th>Échéance</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {certs.map((c) => {
              const left = soon.get(c.id);
              return (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    {FARM_CERTIFICATION_LABELS[c.kind]}
                    {c.level ? ` (niveau ${c.level})` : ""}
                  </Table.Td>
                  <Table.Td>{[c.body, c.number].filter(Boolean).join(", ") || "—"}</Table.Td>
                  <Table.Td className="lv-num">
                    {c.expiresOn ?? "—"}
                    {left !== undefined && (
                      <Text span size="xs" c="brique" ml="xs">
                        {left < 0 ? "expiré" : `dans ${left} j`}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {canEdit && (
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon variant="subtle" aria-label="Modifier le certificat" onClick={() => setEditing(c)}>
                          <Pencil size={14} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="brique" aria-label="Supprimer le certificat" onClick={() => remove.mutate(c.id)}>
                          <Trash2 size={14} />
                        </ActionIcon>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
      {canEdit && editing === null && (
        <Button variant="light" w="fit-content" leftSection={<Plus size={14} />} onClick={() => setEditing("new")}>
          Ajouter un certificat
        </Button>
      )}
      {editing !== null && <CertificationForm key={editing === "new" ? "new" : editing.id} cert={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
    </Stack>
  );
}

function CertificationForm({ cert, onDone }: { cert: FarmCertification | null; onDone: () => void }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FarmCertificationWrite>(cert ?? { kind: "organic", body: null, number: null, level: null, expiresOn: null });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FarmCertificationWrite>) => setForm((f) => ({ ...f, ...patch }));
  const save = useMutation({
    mutationFn: () => (cert ? api.put(farmPath(farm.id, `/farm/certifications/${cert.id}`), form) : api.post(farmPath(farm.id, "/farm/certifications"), form)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: cert ? "Certificat modifié." : "Certificat ajouté." });
      void queryClient.invalidateQueries({ queryKey: ["farm-profile", farm.id] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  return (
    <form
      aria-label="Certificat"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Stack gap="xs">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label="Certificat"
            allowDeselect={false}
            data={farmCertificationKind.options.map((k) => ({ value: k, label: FARM_CERTIFICATION_LABELS[k] }))}
            value={form.kind}
            onChange={(v) => v && set({ kind: v as FarmCertificationKind, level: v === "hve" ? (form.level ?? "3") : null })}
          />
          {form.kind === "hve" && <Select label="Niveau" data={["1", "2", "3"]} value={form.level} onChange={(v) => set({ level: v as FarmCertificationWrite["level"] })} />}
          <TextInput label="Organisme" value={form.body ?? ""} onChange={(e) => set({ body: e.currentTarget.value || null })} />
          <TextInput label="N° de certificat ou d'agrément" value={form.number ?? ""} onChange={(e) => set({ number: e.currentTarget.value || null })} />
          <TextInput label="Échéance" type="date" value={form.expiresOn ?? ""} onChange={(e) => set({ expiresOn: e.currentTarget.value || null })} />
        </SimpleGrid>
        {error && <Alert color="brique">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            Annuler
          </Button>
          <Button type="submit" loading={save.isPending}>
            Enregistrer le certificat
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
