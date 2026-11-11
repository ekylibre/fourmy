import { ActionIcon, Anchor, FileButton, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { DOCUMENT_MAX_BYTES, type DocumentOwnerType, type RegulatoryDocument } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { formatDate } from "../../app/labels";

const BASE = `${globalThis.location?.origin ?? ""}/api/v1`;

/** Envoi d'un justificatif (multipart). */
export async function uploadDocument(farmId: string, ownerType: DocumentOwnerType, ownerId: string, file: File): Promise<RegulatoryDocument> {
  if (file.size > DOCUMENT_MAX_BYTES) throw new Error("Fichier trop gros : 10 Mio au plus.");
  const form = new FormData();
  form.set("ownerType", ownerType);
  form.set("ownerId", ownerId);
  form.set("file", file);
  const res = await fetch(`${BASE}${farmPath(farmId, "/fertilization/documents")}`, { method: "POST", body: form, credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? body.title ?? `Erreur ${res.status}`);
  }
  return res.json();
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`);

/**
 * Justificatifs joints (lot AI) : analyse, sortie d'un outil, avis d'un
 * conseiller, photo d'un couvert. PDF, JPEG ou PNG ; consultables par tous
 * les membres, ajoutés ou retirés par le responsable.
 */
export function Documents({ farmId, ownerType, ownerId, owner, label = "Justificatifs" }: { farmId: string; ownerType: DocumentOwnerType; ownerId: string; owner: boolean; label?: string }) {
  const client = useQueryClient();
  const key = ["fertilization-documents", farmId, ownerType, ownerId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ items: RegulatoryDocument[] }>(farmPath(farmId, `/fertilization/documents?ownerType=${ownerType}&ownerId=${ownerId}`)),
  });
  const add = useMutation({
    mutationFn: (file: File) => uploadDocument(farmId, ownerType, ownerId, file),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
    onError: (e) => notifications.show({ color: "brique", message: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(farmPath(farmId, `/fertilization/documents/${id}`)),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const items = q.data?.items ?? [];
  return (
    <Stack gap={4} aria-label={label}>
      <Group gap="xs">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {owner && (
          <FileButton onChange={(f) => f && add.mutate(f)} accept="application/pdf,image/jpeg,image/png">
            {(props) => (
              <Anchor component="button" size="sm" {...props} disabled={add.isPending}>
                <Group gap={4} wrap="nowrap">
                  <Paperclip size={13} />
                  {add.isPending ? "Envoi…" : "Joindre"}
                </Group>
              </Anchor>
            )}
          </FileButton>
        )}
      </Group>
      {items.length === 0 && (
        <Text size="xs" c="dimmed">
          Aucun justificatif joint (PDF, JPEG ou PNG, 10 Mo au plus).
        </Text>
      )}
      {items.map((d) => (
        <Group key={d.id} gap="xs" wrap="nowrap">
          <FileText size={14} />
          <Anchor size="sm" href={`${BASE}${farmPath(farmId, `/fertilization/documents/${d.id}`)}`} target="_blank" rel="noreferrer">
            {d.name}
          </Anchor>
          <Text size="xs" c="dimmed">
            {size(d.size)} · {formatDate(d.uploadedAt.slice(0, 10))}
          </Text>
          {owner && (
            <ActionIcon variant="subtle" size="sm" color="brique" aria-label={`Retirer ${d.name}`} onClick={() => remove.mutate(d.id)}>
              <Trash2 size={13} />
            </ActionIcon>
          )}
        </Group>
      ))}
    </Stack>
  );
}
