import type { ReactNode } from "react";
import { Group, Stack, Text, Title } from "@mantine/core";
import { useFarm } from "../app/farm";
import { useFarmProfile } from "../app/queries";
import { farmLogoSrc } from "../features/farm/FarmLogo";
import "./print.css";

/**
 * En-tête des éditions imprimables (plan de fumure, cahier d'enregistrement,
 * registre phytosanitaire ; « Ma ferme » E8 bis, R10) : titre, logo de la ferme
 * (sinon celui de Fourmy), exploitation, raison sociale et SIRET, puis la ligne
 * propre au document (`detail`) et sa mention réglementaire (`legal`).
 */
export function PrintHeader({ title, detail, legal }: { title: string; detail?: ReactNode; legal?: ReactNode }) {
  const farm = useFarm();
  const profile = useFarmProfile(farm.id).data;
  const legalName = profile?.identity.legalName;
  return (
    <Stack gap={2} mb="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Title order={1} size="h2">
          {title}
        </Title>
        <img src={farmLogoSrc(farm.id, profile?.logoAssetId ?? null)} alt="Logo" style={{ height: 56, maxWidth: 160, objectFit: "contain" }} />
      </Group>
      <Text size="sm">
        Exploitation : <b>{farm.name}</b>
        {legalName && legalName !== farm.name ? ` (${legalName})` : ""}
        {profile?.identity.siret ? ` · SIRET ${profile.identity.siret}` : ""}
        {detail}
      </Text>
      <Text size="xs" c="dimmed">
        {legal}
        {legal ? " " : ""}Édité le {new Date().toLocaleDateString("fr-FR")} par Fourmy.
      </Text>
    </Stack>
  );
}
