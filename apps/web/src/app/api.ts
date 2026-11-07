import { getUserId } from "./session";

/**
 * Client de l'API Fourmy. Ajoute l'identité, convertit les réponses
 * `application/problem+json` en ApiError (titre + détail lisibles).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(detail ? `${title} — ${detail}` : title);
  }
}

// Même origine que la page (en dev, Vite relaie /api vers l'API). L'origine
// explicite sert aussi aux tests : le fetch de Node refuse les URL relatives.
const BASE = `${globalThis.location?.origin ?? ""}/api/v1`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const userId = getUserId();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(userId ? { "x-user-id": userId } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let title = `Erreur ${res.status}`;
    let detail: string | undefined;
    try {
      const body = await res.json();
      title = body.title ?? title;
      detail = body.detail;
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(res.status, title, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  /** Téléchargement (CSV…) : renvoie le contenu brut. */
  async download(path: string): Promise<Blob> {
    const userId = getUserId();
    const res = await fetch(`${BASE}${path}`, { headers: userId ? { "x-user-id": userId } : {} });
    if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`);
    return res.blob();
  },
};

/** Chemin d'une route de ferme. */
export const farmPath = (farmId: string, path: string) => `/farms/${farmId}${path}`;
