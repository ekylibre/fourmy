import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { api } from "./api";

export type Role = "owner" | "worker" | "reader";
export interface MyFarm {
  id: string;
  name: string;
  role: Role;
  /** Assistant de premier démarrage (lot IM6) : étape en cours, ou fini ; null hors assistant. */
  onboarding?: { step?: string; completedAt?: string | null } | null;
}

/** Ferme dont l'assistant de premier démarrage n'est pas fini (à reprendre). */
export const onboardingPending = (f: MyFarm) => f.role === "owner" && !!f.onboarding && !f.onboarding.completedAt;

export function useMyFarms() {
  return useQuery({
    queryKey: ["me", "farms"],
    queryFn: () => api.get<{ userId: string; canCreateFarm?: boolean; items: MyFarm[] }>("/me/farms"),
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

/** Identifiant de la ferme courante, ou null hors d'une ferme (sans lever d'erreur). */
export function useFarmId(): string | null {
  return useContext(FarmContext)?.id ?? null;
}

/** Le compte peut-il saisir sur la ferme ? Non en lecture seule (l'API le refuse de toute façon). */
export function useCanWrite(): boolean {
  return useFarm().role !== "reader";
}
