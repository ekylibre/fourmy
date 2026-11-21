import { Anchor, AppShell, Box as MBox, Burger, Group, NavLink, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Box, Boxes, Grid3x3, Leaf, ClipboardList, Database, Euro, FileText, LayoutDashboard, Map, Plug, Scale, Wine, FlaskConical, Sprout, Tractor, Wheat, type LucideIcon } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { useFarm } from "../app/farm";
import { useAt } from "../app/at";
import { useControlAvailability } from "../features/certification/controls";
import { Timeline } from "./Timeline";
import { UserMenu } from "./UserMenu";

/** `when` : entrée affichée seulement si une parcelle porte cette certification pendant la campagne de la frise (D2). */
type NavItem = { path: string; label: string; icon: LucideIcon; ownerOnly?: boolean; when?: "hve" | "ab" };
type NavGroup = { label: string; icon: LucideIcon; ownerOnly?: boolean; children: NavItem[] };
type NavEntry = NavItem | NavGroup;

/**
 * Menu (retours du 10/11/2026) : sections et sous-menus. Les routes ne
 * changent pas ; Entretien et Attelages types restent sous Matériels.
 * Équipe et Ma ferme sont passés dans le menu du compte (onglets de « Ma
 * ferme », claudedocs/besoins_navigation_compte.md).
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
  { path: "/economics", label: "Économique", icon: Euro },
  {
    label: "Stocks",
    icon: Boxes,
    children: [
      { path: "/stocks", label: "État des stocks", icon: Boxes },
      { path: "/seeds", label: "Semences", icon: Wheat },
      { path: "/phyto", label: "Produits phyto", icon: FlaskConical },
      { path: "/fertilizers", label: "Fertilisants", icon: Leaf },
      { path: "/cellar", label: "Cuverie", icon: Wine },
    ],
  },
  {
    label: "Réglementaire",
    icon: Scale,
    children: [
      { path: "/register", label: "Registre phyto", icon: FileText },
      { path: "/fertilization", label: "Fertilisation azotée", icon: Leaf },
      { path: "/control/hve", label: "Contrôle HVE", icon: BadgeCheck, when: "hve" },
      { path: "/control/ab", label: "Contrôle AB", icon: BadgeCheck, when: "ab" },
    ],
  },
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
  const { day } = useAt();
  const availability = useControlAvailability(farm.id, Number(day.slice(0, 4))).data;
  const visible = (e: NavItem) => (!e.ownerOnly || farm.role === "owner") && (!e.when || !!availability?.[e.when]);
  const location = useLocation();
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
            <MBox visibleFrom="xs">
              <Link to="/farms" style={{ textDecoration: "none" }}>
                <Wordmark />
              </Link>
            </MBox>
          </Group>
          <UserMenu />
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
                {entry.children.filter(visible).map(item)}
              </NavLink>
            );
          })}
        </Stack>
        <AppVersion />
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

/** Page des nouveautés du site public. */
export const CHANGELOG_URL = "https://fourmy.org/changelog";

/**
 * Version de l'application en pied de menu (besoins_navigation_compte.md
 * §3.4) : lue dans /version.json, publié par le site (même calcul, depuis
 * l'historique Git) et relayé par le nginx de l'application ; en local,
 * servi par Vite. Sans réponse : « Version de développement », sans lien.
 */
function AppVersion() {
  const version = useQuery({
    queryKey: ["app-version"],
    queryFn: async () => {
      const r = await fetch("/version.json");
      if (!r.ok) return null;
      const body = (await r.json().catch(() => null)) as { version?: unknown } | null;
      return typeof body?.version === "string" ? body.version : null;
    },
    retry: false,
    staleTime: Infinity,
  });
  return (
    <Text className="lv-nav-foot" mt="auto" pt="md">
      {version.data ? (
        <Anchor href={CHANGELOG_URL} target="_blank" rel="noopener" inherit c="inherit" aria-label={`Version ${version.data}, nouveautés sur fourmy.org`}>
          Version {version.data}
        </Anchor>
      ) : (
        "Version de développement"
      )}
    </Text>
  );
}
