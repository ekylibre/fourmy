/**
 * Session de développement : identité provisoire (UUID d'un utilisateur),
 * envoyée en `x-user-id`. Remplacée par better-auth (ADR-14) ; l'interface ne
 * dépend que de `getUserId()` et `signOut()`.
 */
const KEY = "fourmy.userId";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Utilisateur créé par `pnpm --filter @fourmy/db seed:dev`. */
export const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID ?? "00000000-0000-7000-8000-00000000de00";

export function getUserId(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && UUID.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function signIn(userId: string): boolean {
  if (!UUID.test(userId.trim())) return false;
  try {
    localStorage.setItem(KEY, userId.trim());
  } catch {
    /* stockage indisponible : la session ne survivra pas au rechargement */
  }
  return true;
}

export function signOut(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* rien à faire */
  }
}
