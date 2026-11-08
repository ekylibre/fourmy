import { useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Modal, Select, Stack, Table, Text, TextInput, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  CERTIFICATION_KINDS,
  CERTIFICATION_LABELS,
  CERTIFICATION_LEVELS,
  certificationShortLabel,
  type CertificationKind,
  type ParcelCertification,
} from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { useCertifications } from "../../app/queries";

/**
 * Certifications et cahiers des charges des parcelles (lot G des retours du
 * 08/11/2026) : AB, HVE, AOP/AOC, IGP, Label Rouge, STG, GLOBALG.A.P.,
 * Rainforest Alliance…, avec début et fin. Une parcelle AB n'admet que des
 * produits phytosanitaires utilisables en agriculture biologique.
 */

/** Certification en vigueur pendant au moins un jour de [from, to] (AAAA-MM-JJ). */
export const activeDuring = (c: Pick<ParcelCertification, "startedOn" | "stoppedOn">, from: string, to: string) =>
  c.startedOn <= to && (!c.stoppedOn || c.stoppedOn >= from);

const COLORS: Partial<Record<CertificationKind, string>> = { organic: "lichen", hve: "ardoise", aop: "brique", igp: "paille", label_rouge: "brique" };

export function CertificationBadges({ certs }: { certs: ParcelCertification[] }) {
  if (certs.length === 0) return null;
  return (
    <Group gap={4} aria-label="Certifications">
      {certs.map((c) => (
        <Tooltip key={c.id} label={`${CERTIFICATION_LABELS[c.kind]} — depuis le ${c.startedOn}${c.stoppedOn ? ` jusqu'au ${c.stoppedOn}` : ""}`}>
          <Badge size="xs" variant="light" color={COLORS[c.kind] ?? "gray"}>
            {certificationShortLabel(c)}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

/** Récapitulatif d'une activité : par certification, nombre de parcelles certifiées pendant la campagne. */
export function CertificationRecap({ parcelIds, year }: { parcelIds: string[]; year: number }) {
  const farm = useFarm();
  const certs = useCertifications(farm.id);
  if (!certs.data || parcelIds.length === 0) return null;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const byLabel = new Map<string, Set<string>>();
  for (const c of certs.data.items) {
    if (!parcelIds.includes(c.landParcelId) || !activeDuring(c, from, to)) continue;
    const label = certificationShortLabel(c);
    byLabel.set(label, new Set([...(byLabel.get(label) ?? []), c.landParcelId]));
  }
  if (byLabel.size === 0) return null;
  return (
    <Group gap={4} aria-label="Récapitulatif des certifications">
      {[...byLabel].map(([label, parcels]) => (
        <Badge key={label} size="sm" variant="light" color={label.startsWith("AB") ? "lichen" : "ardoise"}>
          {label} · {parcels.size}/{parcelIds.length}
        </Badge>
      ))}
    </Group>
  );
}

/** Certifications d'une parcelle : liste, ajout, modification, suppression. */
export function ParcelCertificationsModal({ parcel, onClose }: { parcel: { id: string; name: string } | null; onClose: () => void }) {
  return (
    <Modal opened={parcel !== null} onClose={onClose} title={parcel ? `Certifications : ${parcel.name}` : ""} size="xl">
      {parcel && <ParcelCertifications parcelId={parcel.id} />}
    </Modal>
  );
}

function ParcelCertifications({ parcelId }: { parcelId: string }) {
  const farm = useFarm();
  const certs = useCertifications(farm.id);
  const [editing, setEditing] = useState<ParcelCertification | "new" | null>(null);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(farmPath(farm.id, `/certifications/${id}`)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Certification supprimée." });
      void queryClient.invalidateQueries({ queryKey: ["certifications"] });
    },
  });
  const list = (certs.data?.items ?? []).filter((c) => c.landParcelId === parcelId);
  const owner = farm.role === "owner";
  return (
    <Stack>
      {list.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucune certification pour cette parcelle.
        </Text>
      ) : (
        <Table aria-label="Certifications de la parcelle">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Certification</Table.Th>
              <Table.Th>Période</Table.Th>
              <Table.Th>Organisme, n°</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>
                  <CertificationBadges certs={[c]} />
                </Table.Td>
                <Table.Td className="lv-num">
                  {c.startedOn} → {c.stoppedOn ?? "…"}
                </Table.Td>
                <Table.Td>{[c.certifier, c.reference].filter(Boolean).join(", ") || "—"}</Table.Td>
                <Table.Td>
                  {owner && (
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <ActionIcon variant="subtle" aria-label="Modifier la certification" onClick={() => setEditing(c)}>
                        <Pencil size={14} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="brique" aria-label="Supprimer la certification" onClick={() => remove.mutate(c.id)}>
                        <Trash2 size={14} />
                      </ActionIcon>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {owner && editing === null && (
        <Button variant="light" leftSection={<Plus size={14} />} w="fit-content" onClick={() => setEditing("new")}>
          Ajouter une certification
        </Button>
      )}
      {editing !== null && (
        <CertificationForm key={editing === "new" ? "new" : editing.id} parcelId={parcelId} cert={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      )}
    </Stack>
  );
}

function CertificationForm({ parcelId, cert, onDone }: { parcelId: string; cert: ParcelCertification | null; onDone: () => void }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<CertificationKind>(cert?.kind ?? "organic");
  const [level, setLevel] = useState<string | null>(cert?.level ?? (cert ? null : "certified"));
  const [label, setLabel] = useState(cert?.label ?? "");
  const [certifier, setCertifier] = useState(cert?.certifier ?? "");
  const [reference, setReference] = useState(cert?.reference ?? "");
  const [startedOn, setStartedOn] = useState(cert?.startedOn ?? new Date().toISOString().slice(0, 10));
  const [stoppedOn, setStoppedOn] = useState(cert?.stoppedOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { kind, level: CERTIFICATION_LEVELS[kind] ? level : null, label: label || null, certifier: certifier || null, reference: reference || null, startedOn, stoppedOn: stoppedOn || null };
      return cert ? api.put(farmPath(farm.id, `/certifications/${cert.id}`), body) : api.post(farmPath(farm.id, `/land-parcels/${parcelId}/certifications`), body);
    },
    onSuccess: () => {
      notifications.show({ color: "lichen", message: cert ? "Certification modifiée." : "Certification ajoutée." });
      void queryClient.invalidateQueries({ queryKey: ["certifications"] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  const levels = CERTIFICATION_LEVELS[kind];
  return (
    <form
      aria-label="Certification"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Stack gap="xs">
        <Group grow align="flex-end">
          <Select
            label="Certification"
            data={CERTIFICATION_KINDS.map((k) => ({ value: k, label: CERTIFICATION_LABELS[k] }))}
            value={kind}
            allowDeselect={false}
            onChange={(v) => {
              if (!v) return;
              setKind(v as CertificationKind);
              setLevel(CERTIFICATION_LEVELS[v as CertificationKind]?.at(-1)?.value ?? null);
            }}
          />
          {levels ? (
            <Select label="Niveau" data={levels} value={level} onChange={setLevel} />
          ) : (
            <TextInput label="Nom (signe, cahier des charges)" placeholder="AOC Bordeaux" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
          )}
        </Group>
        <Group grow>
          <TextInput type="date" label="Début" required value={startedOn} onChange={(e) => setStartedOn(e.currentTarget.value)} />
          <TextInput type="date" label="Fin (facultative)" value={stoppedOn} onChange={(e) => setStoppedOn(e.currentTarget.value)} />
        </Group>
        <Group grow>
          <TextInput label="Organisme certificateur" value={certifier} onChange={(e) => setCertifier(e.currentTarget.value)} />
          <TextInput label="N° de certificat" value={reference} onChange={(e) => setReference(e.currentTarget.value)} />
        </Group>
        {kind === "organic" && (
          <Text size="xs" c="dimmed">
            Sur une parcelle AB (ou en conversion), le contrôle réglementaire n'admet que les produits utilisables en agriculture biologique.
          </Text>
        )}
        {error && <Alert color="brique">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            Annuler
          </Button>
          <Button type="submit" loading={save.isPending}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
