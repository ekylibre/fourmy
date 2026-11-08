import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Intervention } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { formatDate, procedureLabel } from "../../app/labels";
import { invalidateAfterIntervention } from "../../app/queries";

/** Annulation avec motif : une intervention réalisée voit ses mouvements de stock contre-passés. */
export function CancelModal({ farmId, intervention, onClose }: { farmId: string; intervention: Intervention | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setReason("");
    setError(null);
    onClose();
  };
  const cancel = useMutation({
    mutationFn: () => api.post<Intervention>(farmPath(farmId, `/interventions/${intervention!.id}/cancel`), { reason }),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Intervention annulée." });
      invalidateAfterIntervention(queryClient);
      close();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  return (
    <Modal opened={intervention !== null} onClose={close} title="Annuler l'intervention">
      {intervention && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate();
          }}
        >
          <Stack>
            <Text size="sm">
              {procedureLabel(intervention.procedure)} du {formatDate(intervention.stoppedAt ?? intervention.startedAt)}.
              {intervention.status === "done" &&
                " Ses mouvements de stock seront contre-passés et elle sortira du registre phyto ; l'historique garde la trace de l'annulation."}
            </Text>
            <TextInput label="Motif" required minLength={3} value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-autofocus />
            {error && <Alert color="brique">{error}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Garder
              </Button>
              <Button type="submit" color="brique" loading={cancel.isPending} disabled={reason.trim().length < 3}>
                Annuler l'intervention
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
