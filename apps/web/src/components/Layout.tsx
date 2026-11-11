import { AppShell, Badge, Burger, Button, Group, NavLink, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { Box, Boxes, Grid3x3, Leaf, ClipboardList, Database, FileText, LayoutDashboard, Map, Plug, Scale, Users, Wine, FlaskConical, Sprout, Tractor, type LucideIcon } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { useFarm } from "../app/farm";
import { useSession, useSignOut } from "../app/session";
import { Timeline } from "./Timeline";

type NavItem = { path: string; label: string; icon: LucideIcon; ownerOnly?: boolean };
type NavGroup = { label: string; icon: LucideIcon; ownerOnly?: boolean; children: NavItem[] };
type NavEntry = NavItem | NavGroup;

/**
 * Menu (retours du 10/11/2026) : sections et sous-menus. Les routes ne
 * changent pas ; Entretien et Attelages types restent sous Matériels.
 */
export const NAVIGATION: NavEntry[] = [
  { path: "", label: "Tableau de bord", icon: LayoutDashboard },
  {
    label: "Cartes",
    icon: Map,
    children: [
      { path: "/map", label: "Plan 2D", icon: Map },
      { path: "/3d-plan", label: "Plan 3D", icon: Box },
      { path: "/prescriptions", label: "Modulation", icon: Grid3x3 },
    ],
  },
  { path: "/activities", label: "Activités", icon: Sprout },
  { path: "/interventions", label: "Interventions", icon: ClipboardList },
  { path: "/equipments", label: "Matériels", icon: Tractor },
  { path: "/team", label: "Équipe", icon: Users, ownerOnly: true },
  {
    label: "Stocks",
    icon: Boxes,
    children: [
      { path: "/stocks", label: "État des stocks", icon: Boxes },
      { path: "/phyto", label: "Produits phyto", icon: FlaskConical },
      { path: "/fertilizers", label: "Fertilisants", icon: Leaf },
      { path: "/cellar", label: "Cuverie", icon: Wine },
    ],
  },
  { label: "Réglementaire", icon: Scale, children: [{ path: "/register", label: "Registre phyto", icon: FileText }] },
  {
    label: "Interopérabilité",
    icon: Plug,
    ownerOnly: true,
    children: [
      { path: "/integrations", label: "Intégrations", icon: Plug },
      { path: "/imports", label: "Imports", icon: Database },
    ],
  },
];

const isGroup = (e: NavEntry): e is NavGroup => "children" in e;

/** Entrée active : égalité pour le tableau de bord, préfixe de segment sinon. */
export function isActivePath(current: string, path: string): boolean {
  return path === "" ? current === "" || current === "/" : current === path || current.startsWith(`${path}/`);
}

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
  // Sous-menus : ouverts sur la section active, sinon au clic.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const item = ({ path, label, icon: Icon }: NavItem) => (
    <NavLink
      key={path}
      component={Link}
      to={linkTo(path)}
      label={label}
      leftSection={<Icon size={18} />}
      active={isActivePath(current, path)}
      onClick={close}
    />
  );

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Link to="/farms" style={{ textDecoration: "none" }}>
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
                navigate("/login");
              }}
            >
              Se déconnecter
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="lv-nav" p="sm">
        <Stack gap={4} component="nav" aria-label="Menu principal">
          {NAVIGATION.filter((e) => !e.ownerOnly || farm.role === "owner").map((entry) => {
            if (!isGroup(entry)) return item(entry);
            const active = entry.children.some((c) => isActivePath(current, c.path));
            const Icon = entry.icon;
            return (
              <NavLink
                key={entry.label}
                component="button"
                type="button"
                aria-expanded={toggled[entry.label] ?? active}
                label={entry.label}
                leftSection={<Icon size={18} />}
                active={active && !(toggled[entry.label] ?? active)}
                opened={toggled[entry.label] ?? active}
                onChange={(o) => setToggled((t) => ({ ...t, [entry.label]: o }))}
                childrenOffset={18}
              >
                {entry.children.filter((c) => !c.ownerOnly || farm.role === "owner").map(item)}
              </NavLink>
            );
          })}
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
