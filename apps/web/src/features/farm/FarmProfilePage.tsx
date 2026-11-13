import { useSearchParams } from "react-router";
import { Badge, Group, Stack, Tabs, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { FarmProfile } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";
import { IdentityTab } from "./IdentityTab";
import { SitesTab } from "./SitesTab";

/**
 * « Ma ferme » (lot F1) : fiche de l'exploitation, `?tab=` pour ouvrir un
 * onglet précis (E22). Tous les membres la consultent, le responsable la
 * modifie (E3).
 */
const TABS = ["identity", "sites"] as const;
type Tab = (typeof TABS)[number];

export function useFarmProfile(farmId: string) {
  return useQuery({ queryKey: ["farm-profile", farmId], queryFn: () => api.get<FarmProfile>(farmPath(farmId, "/farm")) });
}

export function FarmProfilePage() {
  const farm = useFarm();
  const profile = useFarmProfile(farm.id);
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "identity";

  if (profile.isLoading) return <Loading />;
  if (profile.error) return <ErrorAlert error={profile.error} />;
  const p = profile.data!;
  return (
    <Stack>
      <Group gap="sm">
        <Title order={1}>Ma ferme</Title>
        {!p.canEdit && (
          <Badge variant="light" color="gray">
            Lecture seule
          </Badge>
        )}
      </Group>
      <Tabs
        value={tab}
        keepMounted={false}
        onChange={(v) =>
          setParams(
            (prev) => {
              const n = new URLSearchParams(prev);
              n.set("tab", v ?? "identity");
              return n;
            },
            { replace: true },
          )
        }
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="identity">Identité</Tabs.Tab>
          <Tabs.Tab value="sites">Sites</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="identity">
          <IdentityTab key={JSON.stringify(p.identity)} profile={p} />
        </Tabs.Panel>
        <Tabs.Panel value="sites">
          <SitesTab profile={p} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
