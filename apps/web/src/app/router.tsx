import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import { RouteError } from "../components/RouteError";
import { MapBoundary } from "../components/MapBoundary";
import { Alert, Button, Center, Stack } from "@mantine/core";
import { Layout } from "../components/Layout";
import { Loading } from "../components/states";
import { CellarPage } from "../features/cellar/CellarPage";
import { FarmHome } from "../components/FarmHome";
import { FarmsPage } from "../features/farms/FarmsPage";
import { OnboardingFarmPage } from "../features/onboarding/OnboardingFarmPage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { FarmProfilePage } from "../features/farm/FarmProfilePage";
import { ImportsPage } from "../features/imports/ImportsPage";
import { InterventionsPage } from "../features/interventions/InterventionsPage";
import { InterventionCompletePage, InterventionEditPage, InterventionNewPage } from "../features/interventions/InterventionEditPage";
import { PhytoProductsPage } from "../features/phyto/PhytoProductsPage";
import { FertilizersPage } from "../features/fertilization/FertilizersPage";
import { SeedsPage } from "../features/seeds/SeedsPage";
import { FertilizationPage } from "../features/fertilization/FertilizationPage";
import { ActivitiesPage } from "../features/activities/ActivitiesPage";
import { CropPlanPage } from "../features/crop-plan/CropPlanPage";
import { ItinerariesPage } from "../features/itk/ItinerariesPage";
import { ItineraryEditorPage } from "../features/itk/ItineraryEditorPage";
import { EconomicsPage } from "../features/economics/EconomicsPage";
import { EquipmentsPage } from "../features/equipments/EquipmentsPage";
import { EquipmentSheetPage } from "../features/equipments/EquipmentSheetPage";
import { CrewTemplatesPage } from "../features/equipments/CrewTemplatesPage";
import { MaintenancePage } from "../features/maintenance/MaintenancePage";
import { PartsPage } from "../features/maintenance/PartsPage";
import { ParcelCreatePage } from "../features/parcels/ParcelCreatePage";
import { ParcelSheetPage } from "../features/parcels/ParcelSheetPage";
import { LoginPage } from "../features/login/LoginPage";
import { InvitationPage } from "../features/invitation/InvitationPage";
import { RegisterPage } from "../features/register/RegisterPage";
import { StockPage } from "../features/stock/StockPage";
import { PersonSheetPage } from "../features/team/PersonSheetPage";
import { IntegrationsPage } from "../features/integrations/IntegrationsPage";
import { AgrirouterCallbackPage } from "../features/integrations/AgrirouterCallbackPage";
import { AgrirouterStartPage } from "../features/integrations/AgrirouterStartPage";
import { AgrirouterInboxPage } from "../features/integrations/AgrirouterInboxPage";
import { PrescriptionsPage } from "../features/modulation/PrescriptionsPage";
import { FarmProvider, useMyFarms } from "./farm";
import { UNAUTHORIZED_EVENT, useSession } from "./session";

// MapLibre est lourd : la carte est chargée à la demande, pas avec l'application.
const MapPage = lazy(() => import("../features/map/MapPage").then((m) => ({ default: m.MapPage })));
// Cesium (plusieurs Mo) : le plan 3D n'est chargé que s'il est ouvert.
const InterventionPage = lazy(() => import("../features/interventions/InterventionPage").then((m) => ({ default: m.InterventionPage })));
// Itinéraire technique d'une activité (TIKA et ECharts) : chargé à la demande.
const ActivityItineraryPage = lazy(() => import("../features/itinerary/ActivityItineraryPage").then((m) => ({ default: m.ActivityItineraryPage })));
const CartoLabPage = lazy(() => import("../carto/CartoLabPage").then((m) => ({ default: m.CartoLabPage })));
const PrintPage = lazy(() => import("../features/fertilization/PrintPage").then((m) => ({ default: m.PrintPage })));
const RegisterPrintPage = lazy(() => import("../features/register/RegisterPrintPage").then((m) => ({ default: m.RegisterPrintPage })));
const PlanPage = lazy(() => import("../features/fertilization/PlanPage").then((m) => ({ default: m.PlanPage })));
const PrescriptionNewPage = lazy(() => import("../features/modulation/PrescriptionNewPage").then((m) => ({ default: m.PrescriptionNewPage })));
const PrescriptionPage = lazy(() => import("../features/modulation/PrescriptionPage").then((m) => ({ default: m.PrescriptionPage })));
const ControlPage = lazy(() => import("../features/certification/ControlPage").then((m) => ({ default: m.ControlPage })));
const Plan3DPage = lazy(() => import("../3d/Plan3DPage").then((m) => ({ default: m.Plan3DPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  const { refetch } = session;
  // Session expirée ou révoquée pendant l'usage : on la relit (→ connexion).
  useEffect(() => {
    const onUnauthorized = () => void refetch();
    globalThis.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => globalThis.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refetch]);
  // Pas de session en cache mais une relecture en cours (connexion qui vient d'aboutir) : on attend.
  if (session.isLoading || (!session.data && session.isFetching)) return <Loading />;
  // Retour à la page demandée après la connexion (lien venu d'agrirouter, favori…).
  const next = location.pathname === "/" ? "" : `?next=${encodeURIComponent(location.pathname + location.search)}`;
  return session.data ? <>{children}</> : <Navigate to={`/login${next}`} replace />;
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

/** /team → onglet Équipe de « Ma ferme », en gardant la date (?at=). */
function TeamRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("tab", "team");
  return <Navigate to={`${location.pathname.replace(/\/team\/?$/, "/farm")}?${params}`} replace />;
}

const pages = [
  { path: "/", element: <Navigate to="/farms" replace /> },
  { path: "/login", element: <LoginPage /> },
  // Invitation à rejoindre une ferme (lot P3) : publique, avant connexion.
  { path: "/invitation/:token", element: <InvitationPage /> },
  { path: "/farms", element: <RequireAuth><FarmsPage /></RequireAuth> },
  // Assistant de premier démarrage (lot IM6) : création de la ferme, puis étapes dans la ferme, sans le menu.
  { path: "/onboarding", element: <RequireAuth><OnboardingFarmPage /></RequireAuth> },
  {
    path: "/f/:farmId/onboarding/:step?",
    element: (
      <RequireAuth>
        <FarmProvider fallback={<FarmFallback />}>
          <OnboardingPage />
        </FarmProvider>
      </RequireAuth>
    ),
  },
  // Retour du consentement agrirouter (adresse enregistrée chez agrirouter, sans ferme dans le chemin).
  { path: "/agrirouter/callback", element: <RequireAuth><AgrirouterCallbackPage /></RequireAuth> },
  // Connexion lancée depuis agrirouter (Deep URL fourmy.org/agrirouter) : choix de la ferme et confirmation.
  { path: "/agrirouter/start", element: <RequireAuth><AgrirouterStartPage /></RequireAuth> },
  legacy("/connexion"),
  legacy("/fermes"),
  // Éditions imprimables (sans menu) : registre phytosanitaire au format réglementaire.
  {
    path: "/f/:farmId/print/register/phyto",
    element: (
      <RequireAuth>
        <FarmProvider fallback={<FarmFallback />}>
          <Suspense fallback={<Loading />}>
            <RegisterPrintPage />
          </Suspense>
        </FarmProvider>
      </RequireAuth>
    ),
  },
  // Éditions imprimables (sans menu) : cahier d'enregistrement, plans de fumure.
  {
    path: "/f/:farmId/print/fertilization/:doc",
    element: (
      <RequireAuth>
        <FarmProvider fallback={<FarmFallback />}>
          <Suspense fallback={<Loading />}>
            <PrintPage />
          </Suspense>
        </FarmProvider>
      </RequireAuth>
    ),
  },
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
      { index: true, element: <FarmHome /> },
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
      { path: "control/:kind", element: <Suspense fallback={<Loading />}><ControlPage /></Suspense> },
      { path: "seeds", element: <SeedsPage /> },
      { path: "phyto", element: <PhytoProductsPage /> },
      { path: "fertilizers", element: <FertilizersPage /> },
      { path: "fertilization", element: <FertilizationPage /> },
      { path: "fertilization/plans/:planId", element: <Suspense fallback={<Loading />}><PlanPage /></Suspense> },
      { path: "activities", element: <ActivitiesPage /> },
      { path: "crop-plan/:year", element: <CropPlanPage /> },
      { path: "itineraries", element: <ItinerariesPage /> },
      { path: "itineraries/:itineraryId", element: <ItineraryEditorPage /> },
      { path: "economics", element: <EconomicsPage /> },
      { path: "activities/:activityId/itinerary", element: <Suspense fallback={<Loading />}><ActivityItineraryPage /></Suspense> },
      { path: "equipments", element: <EquipmentsPage /> },
      { path: "equipments/crew-templates", element: <CrewTemplatesPage /> },
      { path: "equipments/:equipmentId", element: <EquipmentSheetPage /> },
      { path: "maintenance", element: <MaintenancePage /> },
      { path: "maintenance/parts", element: <PartsPage /> },
      { path: "land-parcels/new", element: <Suspense fallback={<Loading />}><ParcelCreatePage /></Suspense> },
      { path: "land-parcels/:parcelId", element: <Suspense fallback={<Loading />}><ParcelSheetPage /></Suspense> },
      { path: "imports", element: <ImportsPage /> },
      { path: "farm", element: <FarmProfilePage /> },
      // L'équipe est un onglet de « Ma ferme » (besoins_navigation_compte.md) : l'ancienne adresse y mène.
      { path: "team", element: <TeamRedirect /> },
      { path: "team/:personId", element: <PersonSheetPage /> },
      { path: "integrations", element: <IntegrationsPage /> },
      { path: "agrirouter/inbox", element: <AgrirouterInboxPage /> },
      { path: "prescriptions", element: <PrescriptionsPage /> },
      { path: "prescriptions/new", element: <Suspense fallback={<Loading />}><PrescriptionNewPage /></Suspense> },
      { path: "prescriptions/:prescriptionId", element: <Suspense fallback={<Loading />}><PrescriptionPage /></Suspense> },
      ...["carte", "carte/outils", "plan-3d", "interventions/:interventionId/modifier", "cuverie", "registre", "equipe"].map(legacy),
    ],
  },
  { path: "*", element: <Navigate to="/farms" replace /> },
];

/**
 * Toutes les pages sous une racine sans chemin qui porte l'écran d'erreur :
 * aucune page (connexion, fermes, assistant, éditions…) ne tombe sur l'écran
 * par défaut de React Router. Les pages de la ferme gardent le leur, dans le
 * menu.
 */
export const routes = [{ errorElement: <RouteError />, children: pages }];

export function createRouter() {
  return createBrowserRouter(routes);
}
