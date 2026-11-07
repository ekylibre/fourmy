import { UNAUTHORIZED_EVENT } from "./session";

/**
 * Client de l'API Fourmy (session par cookie, même origine). Convertit les réponses
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
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) globalThis.dispatchEvent?.(new Event(UNAUTHORIZED_EVENT));
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
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T | null>(path, { method: "DELETE" }),
  /** Téléchargement (CSV…) : renvoie le contenu brut. */
  async download(path: string): Promise<Blob> {
    const res = await fetch(`${BASE}${path}`, { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`);
    return res.blob();
  },
};

/** Chemin d'une route de ferme. */
export const farmPath = (farmId: string, path: string) => `/farms/${farmId}${path}`;
