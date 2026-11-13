import { useSearchParams } from "react-router";
import { Badge, Group, Stack, Tabs, Title } from "@mantine/core";
import { useFarm } from "../../app/farm";
import { useFarmProfile } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { IdentityTab } from "./IdentityTab";
import { SitesTab } from "./SitesTab";
import { IgnTab } from "./IgnTab";
import { BrandsTab, DisplaySettings, MaintenanceTab, TracksTab } from "./SettingsTabs";

/**
 * « Ma ferme » (lot F1) : fiche de l'exploitation, `?tab=` pour ouvrir un
 * onglet précis (E22). Tous les membres la consultent, le responsable la
 * modifie (E3).
 */
const TABS = ["identity", "sites", "ign", "maintenance", "tracks", "brands"] as const;
type Tab = (typeof TABS)[number];

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
          <Tabs.Tab value="sites">Sites et cartes</Tabs.Tab>
          <Tabs.Tab value="ign">Données IGN</Tabs.Tab>
          {p.canEdit && <Tabs.Tab value="maintenance">Entretien</Tabs.Tab>}
          {p.canEdit && <Tabs.Tab value="tracks">Parcours</Tabs.Tab>}
          <Tabs.Tab value="brands">Marques</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="ign">{tab === "ign" && <IgnTab />}</Tabs.Panel>
        <Tabs.Panel value="identity">
          <IdentityTab key={JSON.stringify(p.identity)} profile={p} />
        </Tabs.Panel>
        <Tabs.Panel value="sites">
          <Stack>
            <DisplaySettings key={JSON.stringify(p.display)} profile={p} />
            <SitesTab profile={p} />
          </Stack>
        </Tabs.Panel>
        {p.canEdit && (
          <Tabs.Panel value="maintenance">
            <MaintenanceTab />
          </Tabs.Panel>
        )}
        {p.canEdit && (
          <Tabs.Panel value="tracks">
            <TracksTab />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="brands">
          <BrandsTab canEdit={p.canEdit} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
