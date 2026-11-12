import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Alert, Button, Divider, Group, Modal, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CERTIPHYTO_CATEGORY_LABELS,
  CONTRACT_TYPE_LABELS,
  type CertiphytoCategory,
  type ContractType,
  type PersonProfileWrite,
  type PersonSheet,
} from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";

type Draft = {
  firstName: string;
  lastName: string;
  name: string;
  active: boolean;
  certCategory: CertiphytoCategory | null;
  certNumber: string;
  certValidUntil: string;
  email: string;
  mobile: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  birthDate: string;
  contractType: ContractType | null;
  contractStartedOn: string;
  contractEndedOn: string;
};

const fromSheet = (s?: PersonSheet): Draft => ({
  firstName: s?.firstName ?? "",
  lastName: s?.lastName ?? "",
  name: s?.name ?? "",
  active: s?.active ?? true,
  certCategory: s?.certiphyto.category ?? null,
  certNumber: s?.certiphyto.number ?? "",
  certValidUntil: s?.certiphyto.validUntil ?? "",
  email: s?.private?.email ?? "",
  mobile: s?.private?.mobile ?? "",
  line1: s?.private?.address.line1 ?? "",
  line2: s?.private?.address.line2 ?? "",
  postalCode: s?.private?.address.postalCode ?? "",
  city: s?.private?.address.city ?? "",
  country: s?.private?.address.country ?? "FR",
  birthDate: s?.private?.birthDate ?? "",
  contractType: s?.private?.contract.type ?? null,
  contractStartedOn: s?.private?.contract.startedOn ?? "",
  contractEndedOn: s?.private?.contract.endedOn ?? "",
});

const orNull = (v: string) => (v.trim() ? v.trim() : null);

/** Corps envoyé : tout pour le responsable, les seules coordonnées pour la personne elle-même. */
function body(d: Draft, full: boolean, existing: boolean): PersonProfileWrite {
  const contact = {
    email: orNull(d.email),
    mobile: orNull(d.mobile),
    address: { line1: orNull(d.line1), line2: orNull(d.line2), postalCode: orNull(d.postalCode), city: orNull(d.city), country: orNull(d.country.toUpperCase()) },
  };
  if (!full) return { private: contact };
  return {
    firstName: orNull(d.firstName),
    lastName: orNull(d.lastName),
    ...(d.firstName.trim() || d.lastName.trim() ? {} : { name: d.name.trim() }),
    ...(existing ? { active: d.active } : {}),
    certiphyto: { category: d.certCategory, number: orNull(d.certNumber), validUntil: orNull(d.certValidUntil) },
    private: {
      ...contact,
      birthDate: orNull(d.birthDate),
      contract: { type: d.contractType, startedOn: orNull(d.contractStartedOn), endedOn: orNull(d.contractEndedOn) },
    },
  };
}

/**
 * Création (responsable) ou modification d'une fiche. `full` : identité,
 * Certiphyto, contrat (responsable) ; sinon les coordonnées seulement (la
 * personne elle-même).
 */
export function PersonFormModal({ farmId, sheet, full = true, onClose }: { farmId: string; sheet?: PersonSheet; full?: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [d, setD] = useState<Draft>(() => fromSheet(sheet));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const hasName = !!(d.firstName.trim() || d.lastName.trim() || d.name.trim());

  const save = useMutation({
    mutationFn: async () => {
      const b = body(d, full, !!sheet);
      if (sheet) {
        await api.patch(farmPath(farmId, `/people/${sheet.id}`), b);
        return sheet.id;
      }
      return (await api.post<{ id: string }>(farmPath(farmId, "/people"), b)).id;
    },
    onSuccess: (id) => {
      notifications.show({ color: "lichen", message: sheet ? "Fiche enregistrée." : "Personne ajoutée." });
      void queryClient.invalidateQueries({ queryKey: ["people", farmId] });
      onClose();
      if (!sheet) navigate(`/f/${farmId}/team/${id}${location.search}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  return (
    <Modal opened onClose={onClose} title={sheet ? `Fiche — ${sheet.name}` : "Nouvelle personne"} size="lg">
      <Stack>
        {full && (
          <>
            <Group grow>
              <TextInput label="Prénom" value={d.firstName} onChange={(e) => set("firstName", e.currentTarget.value)} data-autofocus />
              <TextInput label="Nom" value={d.lastName} onChange={(e) => set("lastName", e.currentTarget.value)} />
            </Group>
            {!d.firstName.trim() && !d.lastName.trim() && sheet && (
              <TextInput label="Nom affiché" description="Utilisé tant que le prénom et le nom ne sont pas saisis." value={d.name} onChange={(e) => set("name", e.currentTarget.value)} />
            )}
            {sheet && <Switch label="Personne active (proposée comme intervenant)" checked={d.active} onChange={(e) => set("active", e.currentTarget.checked)} />}
          </>
        )}
        <Divider label="Coordonnées (visibles du responsable et de la personne)" labelPosition="left" />
        <Group grow>
          <TextInput label="Email" type="email" value={d.email} onChange={(e) => set("email", e.currentTarget.value)} />
          <TextInput label="Portable" type="tel" value={d.mobile} onChange={(e) => set("mobile", e.currentTarget.value)} />
        </Group>
        <TextInput label="Adresse" placeholder="N° et rue" value={d.line1} onChange={(e) => set("line1", e.currentTarget.value)} />
        <TextInput aria-label="Complément d'adresse" placeholder="Complément" value={d.line2} onChange={(e) => set("line2", e.currentTarget.value)} />
        <Group grow>
          <TextInput label="Code postal" value={d.postalCode} onChange={(e) => set("postalCode", e.currentTarget.value)} />
          <TextInput label="Commune" value={d.city} onChange={(e) => set("city", e.currentTarget.value)} />
          <TextInput label="Pays" description="Code à 2 lettres" maxLength={2} value={d.country} onChange={(e) => set("country", e.currentTarget.value.toUpperCase())} />
        </Group>
        {full && (
          <>
            <TextInput type="date" label="Date de naissance" value={d.birthDate} onChange={(e) => set("birthDate", e.currentTarget.value)} w={220} />
            <Divider label="Contrat" labelPosition="left" />
            <Group grow>
              <Select
                label="Type de contrat"
                clearable
                data={Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                value={d.contractType}
                onChange={(v) => set("contractType", v as ContractType | null)}
              />
              <TextInput type="date" label="Entrée" value={d.contractStartedOn} onChange={(e) => set("contractStartedOn", e.currentTarget.value)} />
              <TextInput type="date" label="Sortie" value={d.contractEndedOn} onChange={(e) => set("contractEndedOn", e.currentTarget.value)} />
            </Group>
            <Divider label="Certiphyto" labelPosition="left" />
            <Select
              label="Catégorie"
              clearable
              data={Object.entries(CERTIPHYTO_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
              value={d.certCategory}
              onChange={(v) => set("certCategory", v as CertiphytoCategory | null)}
            />
            <Group grow>
              <TextInput label="Numéro" value={d.certNumber} onChange={(e) => set("certNumber", e.currentTarget.value)} />
              <TextInput type="date" label="Valable jusqu'au" value={d.certValidUntil} onChange={(e) => set("certValidUntil", e.currentTarget.value)} />
            </Group>
          </>
        )}
        {!full && (
          <Text size="sm" c="dimmed">
            Identité, contrat et Certiphyto sont tenus par le responsable de la ferme.
          </Text>
        )}
        {error && <Alert color="brique">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={full && !hasName}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

