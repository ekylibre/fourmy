import { forgetOffline } from "./offline";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";

/**
 * Session (better-auth, ADR-14) : cookie HttpOnly posé par l'API, même
 * origine que la page — le code web ne voit jamais le jeton. La session est
 * lue via TanStack Query (clé `session`).
 */
export const authClient = createAuthClient({
  baseURL: globalThis.location?.origin ?? "",
  // fetch résolu à l'appel (et non capturé au chargement) : intercepteurs de test, polyfills.
  fetchOptions: { customFetchImpl: (input, init) => globalThis.fetch(input, init) },
});

/** Compte de `pnpm --filter @fourmy/api seed:dev`, prérempli en développement seulement. */
export const DEV_EMAIL = import.meta.env.DEV ? (import.meta.env.VITE_DEV_EMAIL ?? "dev@fourmy.local") : "";

export type SessionUser = { id: string; email: string; name: string | null };

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionUser | null> => {
      const { data } = await authClient.getSession();
      return data ? { id: data.user.id, email: data.user.email, name: data.user.name || null } : null;
    },
    staleTime: 5 * 60_000,
  });
}

/** Connexion ; renvoie un message d'erreur lisible, ou null si réussie. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await authClient.signIn.email({ email: email.trim(), password });
  if (!error) return null;
  if (error.status === 401) return "E-mail ou mot de passe incorrect.";
  if (error.status === 429) return "Trop de tentatives : réessayez dans un instant.";
  return error.message ?? "Connexion impossible.";
}

export function useSignOut() {
  const client = useQueryClient();
  return async () => {
    await authClient.signOut();
    client.clear(); // aucune donnée de ferme ne survit à la déconnexion
    await forgetOffline().catch(() => {}); // ni sur ce poste (copies hors ligne)
  };
}

/** Émis par le client d'API sur un 401 : la session a expiré ou a été révoquée. */
export const UNAUTHORIZED_EVENT = "fourmy:unauthorized";
