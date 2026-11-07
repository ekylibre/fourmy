import { AppShell, Badge, Burger, Button, Group, NavLink, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Box, Boxes, ClipboardList, Database, FileText, LayoutDashboard, Map, Plug, Users, Wine } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { useFarm } from "../app/farm";
import { useSession, useSignOut } from "../app/session";
import { Timeline } from "./Timeline";

const SECTIONS = [
  { path: "", label: "Tableau de bord", icon: LayoutDashboard },
  { path: "/carte", label: "Carte", icon: Map },
  { path: "/plan-3d", label: "Plan 3D", icon: Box },
  { path: "/interventions", label: "Interventions", icon: ClipboardList },
  { path: "/stocks", label: "Stocks", icon: Boxes },
  { path: "/cuverie", label: "Cuverie", icon: Wine },
  { path: "/registre", label: "Registre phyto", icon: FileText },
] as const;

/** Coquille : en-tête, navigation (night), frise temporelle, contenu. */
export function Layout() {
  const farm = useFarm();
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const signOut = useSignOut();
  const base = `/f/${farm.id}`;
  const current = location.pathname.slice(base.length);
  const linkTo = (path: string) => `${base}${path}${location.search}`; // garde ?at=

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Link to="/fermes" style={{ textDecoration: "none" }}>
              <Wordmark />
            </Link>
            <Text fw={600} truncate maw={260}>
              {farm.name}
            </Text>
            <Badge color={farm.role === "owner" ? "lichen" : "ardoise"}>{farm.role === "owner" ? "Responsable" : "Salarié"}</Badge>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {session.data && (
              <Text size="sm" c="dimmed" visibleFrom="sm" truncate maw={220}>
                {session.data.name ?? session.data.email}
              </Text>
            )}
            <Button
              variant="subtle"
              size="xs"
              onClick={async () => {
                await signOut();
                navigate("/connexion");
              }}
            >
              Se déconnecter
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="lv-nav" p="sm">
        <Stack gap={4}>
          {SECTIONS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              component={Link}
              to={linkTo(path)}
              label={label}
              leftSection={<Icon size={18} />}
              active={current === path || (path !== "" && current.startsWith(path))}
              onClick={close}
            />
          ))}
          {farm.role === "owner" && (
            <NavLink
              component={Link}
              to={linkTo("/equipe")}
              label="Équipe"
              leftSection={<Users size={18} />}
              active={current.startsWith("/equipe")}
              onClick={close}
            />
          )}
          {farm.role === "owner" && (
            <NavLink
              component={Link}
              to={linkTo("/integrations")}
              label="Intégrations"
              leftSection={<Plug size={18} />}
              active={current.startsWith("/integrations")}
              onClick={close}
            />
          )}
          {farm.role === "owner" && (
            <NavLink
              component={Link}
              to={linkTo("/imports")}
              label="Imports Ekylibre"
              leftSection={<Database size={18} />}
              active={current.startsWith("/imports")}
              onClick={close}
            />
          )}
        </Stack>
        <Text className="lv-nav-foot" mt="auto" pt="md">
          FOURMY · JUMEAU NUMÉRIQUE
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        <Timeline />
        <div style={{ padding: "var(--mantine-spacing-lg)" }}>
          <Outlet />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
