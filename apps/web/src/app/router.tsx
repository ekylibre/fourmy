import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Alert, Button, Center, Stack } from "@mantine/core";
import { Layout } from "../components/Layout";
import { Loading } from "../components/states";
import { CellarPage } from "../features/cellar/CellarPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { FarmsPage } from "../features/farms/FarmsPage";
import { ImportsPage } from "../features/imports/ImportsPage";
import { InterventionsPage } from "../features/interventions/InterventionsPage";
import { LoginPage } from "../features/login/LoginPage";
import { RegisterPage } from "../features/register/RegisterPage";
import { StockPage } from "../features/stock/StockPage";
import { TeamPage } from "../features/team/TeamPage";
import { FarmProvider, useMyFarms } from "./farm";
import { UNAUTHORIZED_EVENT, useSession } from "./session";

// MapLibre est lourd : la carte est chargée à la demande, pas avec l'application.
const MapPage = lazy(() => import("../features/map/MapPage").then((m) => ({ default: m.MapPage })));
// Cesium (plusieurs Mo) : le plan 3D n'est chargé que s'il est ouvert.
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
  return session.data ? <>{children}</> : <Navigate to="/connexion" replace />;
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
        <Button component="a" href="/fermes">
          Vos fermes
        </Button>
      </Stack>
    </Center>
  );
}

export const routes = [
  { path: "/", element: <Navigate to="/fermes" replace /> },
  { path: "/connexion", element: <LoginPage /> },
  { path: "/fermes", element: <RequireAuth><FarmsPage /></RequireAuth> },
  {
    path: "/f/:farmId",
    element: (
      <RequireAuth>
        <FarmProvider fallback={<FarmFallback />}>
          <Layout />
        </FarmProvider>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "carte", element: <Suspense fallback={<Loading />}><MapPage /></Suspense> },
      { path: "plan-3d", element: <Suspense fallback={<Loading />}><Plan3DPage /></Suspense> },
      { path: "interventions", element: <InterventionsPage /> },
      { path: "stocks", element: <StockPage /> },
      { path: "cuverie", element: <CellarPage /> },
      { path: "registre", element: <RegisterPage /> },
      { path: "imports", element: <ImportsPage /> },
      { path: "equipe", element: <TeamPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/fermes" replace /> },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
