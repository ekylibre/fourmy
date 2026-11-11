import { useState, type ReactNode } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";

interface ConfirmRequest {
  title: string;
  message: ReactNode;
  /** Libellé du bouton de confirmation (« Supprimer »…). */
  action: string;
  resolve: (ok: boolean) => void;
}

/**
 * Confirmation avant une suppression (recette du 11/11) : une fenêtre de
 * l'application, pas celle du navigateur. `confirm(...)` rend une promesse
 * vraie si l'utilisateur confirme ; `element` est à placer dans le rendu.
 */
export function useConfirm() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const confirm = (o: Omit<ConfirmRequest, "resolve">) => new Promise<boolean>((resolve) => setReq({ ...o, resolve }));
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  const element = req ? (
    <Modal opened onClose={() => close(false)} title={req.title} size="sm">
      <Stack>
        <Text size="sm">{req.message}</Text>
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={() => close(false)}>
            Annuler
          </Button>
          <Button color="brique" onClick={() => close(true)} data-autofocus>
            {req.action}
          </Button>
        </Group>
      </Stack>
    </Modal>
  ) : null;
  return { confirm, element };
}
