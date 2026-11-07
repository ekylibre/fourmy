import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { api } from "./api";

export type Role = "owner" | "worker";
export interface MyFarm {
  id: string;
  name: string;
  role: Role;
}

export function useMyFarms() {
  return useQuery({
    queryKey: ["me", "farms"],
    queryFn: () => api.get<{ userId: string; items: MyFarm[] }>("/me/farms"),
  });
}

const FarmContext = createContext<MyFarm | null>(null);

/** Ferme courante (d'après l'URL /f/:farmId), avec le rôle de l'utilisateur. */
export function FarmProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { farmId } = useParams();
  const farms = useMyFarms();
  const farm = farms.data?.items.find((f) => f.id === farmId) ?? null;
  if (!farm) return <>{fallback}</>;
  return <FarmContext.Provider value={farm}>{children}</FarmContext.Provider>;
}

export function useFarm(): MyFarm {
  const farm = useContext(FarmContext);
  if (!farm) throw new Error("useFarm hors d'une ferme");
  return farm;
}
