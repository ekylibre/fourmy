import { Alert } from "@mantine/core";
import { Navigate } from "react-router";
import { useFarm } from "../app/farm";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { guestHome } from "./Layout";

/**
 * Accueil de la ferme : le tableau de bord, ou, pour un invité restreint (lot
 * AM3), la première page que ses droits ouvrent — le tableau de bord repose
 * sur des routes fermées aux accès restreints.
 */
export function FarmHome() {
  const farm = useFarm();
  if (farm.role !== "guest") return <DashboardPage />;
  const home = guestHome(farm);
  if (home === null) return <Alert color="gray">Votre accès à cette ferme n'ouvre aucun écran. Voyez avec le responsable de la ferme.</Alert>;
  return <Navigate to={`/f/${farm.id}${home}`} replace />;
}
