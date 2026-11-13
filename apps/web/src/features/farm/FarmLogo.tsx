import { Button, FileButton, Group, Image, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp } from "lucide-react";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { assetUrl, uploadLogo } from "../equipments/EquipmentLogo";

/** Logo de la ferme, ou celui de Fourmy s'il n'y en a pas (E8 bis, R10). */
export function farmLogoSrc(farmId: string, logoAssetId: string | null): string {
  return logoAssetId ? assetUrl(farmId, logoAssetId) : "/favicon.svg";
}

/** Dépôt du logo (onglet Identité). Affiché seulement en <img> : un SVG n'y exécute aucun script. */
export function FarmLogoField({ logoAssetId, canEdit }: { logoAssetId: string | null; canEdit: boolean }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: (file: File | null) => (file ? uploadLogo(farmPath(farm.id, "/farm/logo"), file) : api.delete(farmPath(farm.id, "/farm/logo"))),
    onSuccess: (_, file) => {
      notifications.show({ color: "lichen", message: file ? "Logo enregistré." : "Logo retiré." });
      void queryClient.invalidateQueries({ queryKey: ["farm-profile", farm.id] });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof Error ? e.message : String(e) }),
  });
  return (
    <Stack gap="xs">
      <Title order={4}>Logo</Title>
      <Group align="center">
        <Image src={farmLogoSrc(farm.id, logoAssetId)} alt={logoAssetId ? "Logo de la ferme" : "Logo de Fourmy (par défaut)"} h={64} w={64} fit="contain" radius="sm" />
        {canEdit && (
          <Stack gap={4}>
            <Group gap="xs">
              <FileButton accept="image/png,image/jpeg,image/svg+xml" onChange={(f) => f && send.mutate(f)}>
                {(props) => (
                  <Button {...props} size="compact-sm" variant="light" leftSection={<ImageUp size={14} />} loading={send.isPending}>
                    {logoAssetId ? "Changer le logo" : "Déposer un logo"}
                  </Button>
                )}
              </FileButton>
              {logoAssetId && (
                <Button size="compact-sm" variant="subtle" color="brique" onClick={() => send.mutate(null)}>
                  Retirer
                </Button>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              PNG, JPEG ou SVG, 1 Mo au plus. Imprimé en tête des documents ; sans logo, celui de Fourmy.
            </Text>
          </Stack>
        )}
      </Group>
    </Stack>
  );
}
