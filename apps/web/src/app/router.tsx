import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import { RouteError } from "../components/RouteError";
import { MapBoundary } from "../components/MapBoundary";
import { Alert, Button, Center, Stack } from "@mantine/core";
import { Layout } from "../components/Layout";
import { Loading } from "../components/states";
import { CellarPage } from "../features/cellar/CellarPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { FarmsPage } from "../features/farms/FarmsPage";
import { ImportsPage } from "../features/imports/ImportsPage";
import { InterventionsPage } from "../features/interventions/InterventionsPage";
import { InterventionCompletePage, InterventionEditPage, InterventionNewPage } from "../features/interventions/InterventionEditPage";
import { PhytoProductsPage } from "../features/phyto/PhytoProductsPage";
import { ActivitiesPage } from "../features/activities/ActivitiesPage";
import { EquipmentsPage } from "../features/equipments/EquipmentsPage";
import { EquipmentSheetPage } from "../features/equipments/EquipmentSheetPage";
import { CrewTemplatesPage } from "../features/equipments/CrewTemplatesPage";
import { MaintenancePage } from "../features/maintenance/MaintenancePage";
import { PartsPage } from "../features/maintenance/PartsPage";
import { ParcelCreatePage } from "../features/parcels/ParcelCreatePage";
import { ParcelSheetPage } from "../features/parcels/ParcelSheetPage";
import { LoginPage } from "../features/login/LoginPage";
import { RegisterPage } from "../features/register/RegisterPage";
import { StockPage } from "../features/stock/StockPage";
import { TeamPage } from "../features/team/TeamPage";
import { IntegrationsPage } from "../features/integrations/IntegrationsPage";
import { AgrirouterCallbackPage } from "../features/integrations/AgrirouterCallbackPage";
import { PrescriptionsPage } from "../features/modulation/PrescriptionsPage";
import { FarmProvider, useMyFarms } from "./farm";
import { UNAUTHORIZED_EVENT, useSession } from "./session";

// MapLibre est lourd : la carte est chargée à la demande, pas avec l'application.
const MapPage = lazy(() => import("../features/map/MapPage").then((m) => ({ default: m.MapPage })));
// Cesium (plusieurs Mo) : le plan 3D n'est chargé que s'il est ouvert.
const InterventionPage = lazy(() => import("../features/interventions/InterventionPage").then((m) => ({ default: m.InterventionPage })));
const CartoLabPage = lazy(() => import("../carto/CartoLabPage").then((m) => ({ default: m.CartoLabPage })));
const PrescriptionNewPage = lazy(() => import("../features/modulation/PrescriptionNewPage").then((m) => ({ default: m.PrescriptionNewPage })));
const PrescriptionPage = lazy(() => import("../features/modulation/PrescriptionPage").then((m) => ({ default: m.PrescriptionPage })));
const Plan3DPage = lazy(() => import("../3d/Plan3DPage").then((m) => ({ default: m.Plan3DPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const { refetch } = session;
  // Session expirée ou révoquée pendant l'usage : on la relit (→ connexion).
  useEffect(() => {
    const onUnauthorized = () => void refetch();
    globalThis.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => globalThis.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refetch]);
  if (session.isLoading) return <Loading />;
  return session.data ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Ferme inconnue ou non autorisée : on le dit, sans fuite d'information. */
function FarmFallback() {
  const farms = useMyFarms();
  if (farms.isLoading) return <Loading />;
  return (
    <Center mih="60vh">
      <Stack align="center">
        <Alert color="brique" title="Ferme inaccessible">
          Cette ferme n'existe pas ou vous n'en êtes pas membre.
        </Alert>
        <Button component="a" href="/farms">
          Vos fermes
        </Button>
      </Stack>
    </Center>
  );
}

/** Anciennes adresses en français (favoris, liens déjà envoyés) → adresses en anglais. */
const LEGACY_SEGMENTS: Record<string, string> = {
  connexion: "login",
  fermes: "farms",
  carte: "map",
  outils: "tools",
  "plan-3d": "3d-plan",
  modifier: "edit",
  cuverie: "cellar",
  registre: "register",
  equipe: "team",
};
const LEGACY_VIEWS: Record<string, string> = { liste: "list", kanban: "kanban", calendrier: "calendar" };

export function legacyUrl(pathname: string, search: string): string {
  const path = pathname
    .split("/")
    .map((s) => LEGACY_SEGMENTS[s] ?? s)
    .join("/");
  const params = new URLSearchParams(search);
  const vue = params.get("vue");
  if (vue !== null) {
    params.delete("vue");
    params.set("view", LEGACY_VIEWS[vue] ?? vue);
  }
  const q = params.toString();
  return `${path}${q ? `?${q}` : ""}`;
}

function LegacyRedirect() {
  const location = useLocation();
  return <Navigate to={legacyUrl(location.pathname, location.search)} replace />;
}

const legacy = (path: string) => ({ path, element: <LegacyRedirect /> });

export const routes = [
  { path: "/", element: <Navigate to="/farms" replace /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/farms", element: <RequireAuth><FarmsPage /></RequireAuth> },
  // Retour du consentement agrirouter (adresse enregistrée chez agrirouter, sans ferme dans le chemin).
  { path: "/agrirouter/callback", element: <RequireAuth><AgrirouterCallbackPage /></RequireAuth> },
  legacy("/connexion"),
  legacy("/fermes"),
  {
    path: "/f/:farmId",
    element: (
      <RequireAuth>
        <FarmProvider fallback={<FarmFallback />}>
          <Layout />
        </FarmProvider>
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "map", element: <Suspense fallback={<Loading />}><MapPage /></Suspense> },
      { path: "map/tools", element: <Suspense fallback={<Loading />}><CartoLabPage /></Suspense> },
      { path: "3d-plan", element: <MapBoundary what="la vue 3D"><Suspense fallback={<Loading />}><Plan3DPage /></Suspense></MapBoundary> },
      { path: "interventions", element: <InterventionsPage /> },
      { path: "interventions/new", element: <InterventionNewPage /> },
      { path: "interventions/:interventionId/complete", element: <InterventionCompletePage /> },
      { path: "interventions/:interventionId", element: <Suspense fallback={<Loading />}><InterventionPage /></Suspense> },
      { path: "interventions/:interventionId/edit", element: <InterventionEditPage /> },
      { path: "stocks", element: <StockPage /> },
      { path: "cellar", element: <CellarPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "phyto", element: <PhytoProductsPage /> },
      { path: "activities", element: <ActivitiesPage /> },
      { path: "equipments", element: <EquipmentsPage /> },
      { path: "equipments/crew-templates", element: <CrewTemplatesPage /> },
      { path: "equipments/:equipmentId", element: <EquipmentSheetPage /> },
      { path: "maintenance", element: <MaintenancePage /> },
      { path: "maintenance/parts", element: <PartsPage /> },
      { path: "land-parcels/new", element: <Suspense fallback={<Loading />}><ParcelCreatePage /></Suspense> },
      { path: "land-parcels/:parcelId", element: <Suspense fallback={<Loading />}><ParcelSheetPage /></Suspense> },
      { path: "imports", element: <ImportsPage /> },
      { path: "team", element: <TeamPage /> },
      { path: "integrations", element: <IntegrationsPage /> },
      { path: "prescriptions", element: <PrescriptionsPage /> },
      { path: "prescriptions/new", element: <Suspense fallback={<Loading />}><PrescriptionNewPage /></Suspense> },
      { path: "prescriptions/:prescriptionId", element: <Suspense fallback={<Loading />}><PrescriptionPage /></Suspense> },
      ...["carte", "carte/outils", "plan-3d", "interventions/:interventionId/modifier", "cuverie", "registre", "equipe"].map(legacy),
    ],
  },
  { path: "*", element: <Navigate to="/farms" replace /> },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
