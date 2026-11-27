import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import type { AccessLevel, AccessModule } from "@fourmy/contracts";
import { api } from "./api";

/** `guest` : invité restreint (conseiller…), droits par module et activité (lot AM3). */
export type Role = "owner" | "worker" | "reader" | "guest";
export interface MyFarm {
  id: string;
  name: string;
  role: Role;
  /** Droits effectifs sur la ferme (GET /me/farms) : tous les modules sauf pour un invité restreint. */
  grant?: { modules: Partial<Record<AccessModule, AccessLevel>>; activities: "all" | string[] };
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

/**
 * Le compte peut-il saisir sur la ferme ? Non en lecture seule, ni pour un
 * invité restreint, qui ne fait que consulter (l'API le refuse de toute façon).
 */
export function useCanWrite(): boolean {
  const { role } = useFarm();
  return role !== "reader" && role !== "guest";
}

/** Le module est-il ouvert au compte ? Toujours, sauf pour un invité restreint dont les droits le ferment. */
export function moduleOpen(farm: MyFarm, module: AccessModule): boolean {
  if (farm.role !== "guest") return true;
  return (farm.grant?.modules[module] ?? "none") !== "none";
}
