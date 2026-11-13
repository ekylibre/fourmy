import type { IgnCacheManifest } from "@fourmy/contracts";
import { api, farmPath } from "./api";

/**
 * Copie hors ligne d'une ferme dans le navigateur (« Ma ferme », lot F5,
 * claudedocs/conception_ma_ferme.md §6.4, E14, N3 bis, R7). La page remplit
 * le cache `fourmy-ign-<ferme>` depuis le serveur Fourmy (jamais depuis
 * l'IGN) ; le service worker (sw/sw.ts) le sert ensuite aux cartes et à la 3D.
 * Une entrée d'index dans ce même cache garde la version (ETag) de chaque
 * tuile : une mise à jour ne télécharge que ce qui a changé.
 */

export const cacheName = (farmId: string) => `fourmy-ign-${farmId}`;
const INDEX_URL = "/__fourmy/offline-index";
const MARK = (farmId: string) => `fourmy-offline-${farmId}`;
const CONCURRENCY = 6;
/** Clés du cache en URL absolues, comme les requêtes que voit le service worker. */
const absolute = (path: string) => new URL(path, globalThis.location.origin).href;

interface OfflineIndex {
  at: string;
  bytes: number;
  entries: Record<string, string>;
}

export function offlineSupported(): boolean {
  return typeof caches !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** Enregistre le service worker (build de production seulement : en dev, Vite sert les sources). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !offlineSupported()) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("Service worker non enregistré :", e));
  });
}

// Marque locale : sait qu'une copie existait, pour dire si le navigateur l'a effacée.
function readMark(farmId: string): { at: string; count: number } | null {
  try {
    const raw = localStorage.getItem(MARK(farmId));
    return raw ? (JSON.parse(raw) as { at: string; count: number }) : null;
  } catch {
    return null;
  }
}
function writeMark(farmId: string, mark: { at: string; count: number } | null): void {
  try {
    if (mark) localStorage.setItem(MARK(farmId), JSON.stringify(mark));
    else localStorage.removeItem(MARK(farmId));
  } catch {
    // stockage local indisponible (navigation privée) : seul l'avertissement d'effacement est perdu
  }
}

/**
 * Déconnexion : efface les copies des fermes, les réponses gardées de l'API
 * et les marques (poste partagé). Le service worker le fait aussi.
 */
export async function forgetOffline(): Promise<void> {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("fourmy-offline-")) localStorage.removeItem(key);
  } catch {
    // rien à oublier
  }
  if (typeof caches === "undefined") return;
  for (const key of await caches.keys()) if (key.startsWith("fourmy-ign-") || key.startsWith("fourmy-api-")) await caches.delete(key);
}

async function readIndex(farmId: string): Promise<OfflineIndex | null> {
  if (!(await caches.has(cacheName(farmId)))) return null;
  const res = await (await caches.open(cacheName(farmId))).match(absolute(INDEX_URL));
  return res ? ((await res.json()) as OfflineIndex) : null;
}

export interface OfflineStatus {
  /** Copie présente sur ce poste. */
  copy: { at: string; tiles: number; bytes: number } | null;
  /** Une copie existait, mais le navigateur l'a effacée (Safari, place manquante…). */
  erased: boolean;
  /** Place occupée et disponible pour Fourmy sur ce poste (estimation du navigateur). */
  storage: { usage: number; quota: number } | null;
}

export async function offlineStatus(farmId: string): Promise<OfflineStatus> {
  const index = await readIndex(farmId);
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  const mark = readMark(farmId);
  return {
    copy: index ? { at: index.at, tiles: Object.keys(index.entries).length, bytes: index.bytes } : null,
    erased: !index && mark !== null,
    storage: estimate?.quota ? { usage: estimate.usage ?? 0, quota: estimate.quota } : null,
  };
}

export interface CopyPlan {
  manifest: IgnCacheManifest;
  toFetch: IgnCacheManifest["entries"];
  toDelete: string[];
  /** Octets à télécharger. */
  neededBytes: number;
  /** Place libre selon le navigateur ; null s'il ne le dit pas. */
  availableBytes: number | null;
}

/** Ce que la copie téléchargera et supprimera, et la place qu'il faut. */
export async function planCopy(farmId: string): Promise<CopyPlan> {
  const manifest = await api.get<IgnCacheManifest>(farmPath(farmId, "/ign/cache/manifest"));
  const current = (await readIndex(farmId))?.entries ?? {};
  const wanted = new Set(manifest.entries.map((e) => e.url));
  const toFetch = manifest.entries.filter((e) => current[e.url] !== e.etag);
  const toDelete = Object.keys(current).filter((url) => !wanted.has(url));
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  return {
    manifest,
    toFetch,
    toDelete,
    neededBytes: toFetch.reduce((n, e) => n + e.bytes, 0),
    availableBytes: estimate?.quota ? estimate.quota - (estimate.usage ?? 0) : null,
  };
}

export class NotEnoughSpace extends Error {
  constructor(
    readonly neededBytes: number,
    readonly availableBytes: number,
  ) {
    super("Place insuffisante sur ce poste.");
  }
}

/**
 * Fait la copie. Place insuffisante : rien n'est commencé (N3 bis). Échec en
 * route : la copie de la ferme est vidée, plutôt qu'à moitié faite.
 */
export async function runCopy(farmId: string, plan: CopyPlan, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  if (plan.availableBytes !== null && plan.neededBytes > plan.availableBytes) throw new NotEnoughSpace(plan.neededBytes, plan.availableBytes);
  // Stockage persistant : le navigateur ne l'effacera pas sans prévenir (sauf Safari, voir offlineStatus).
  await navigator.storage?.persist?.().catch(() => false);
  const cache = await caches.open(cacheName(farmId));
  const total = plan.toFetch.length;
  let done = 0;
  onProgress(0, total);
  try {
    let next = 0;
    const workerLoop = async () => {
      while (next < total) {
        if (signal?.aborted) throw new DOMException("Copie arrêtée", "AbortError");
        const entry = plan.toFetch[next++]!;
        const url = absolute(entry.url);
        const res = await fetch(url, { credentials: "same-origin", signal });
        if (!res.ok) throw new Error(`Tuile refusée par le serveur (${res.status}) : ${entry.url}`);
        await cache.put(url, res);
        onProgress(++done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, workerLoop));
    for (const url of plan.toDelete) await cache.delete(absolute(url));
    const index: OfflineIndex = {
      at: new Date().toISOString(),
      bytes: plan.manifest.bytes,
      entries: Object.fromEntries(plan.manifest.entries.map((e) => [e.url, e.etag])),
    };
    await cache.put(absolute(INDEX_URL), new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }));
    writeMark(farmId, { at: index.at, count: plan.manifest.entries.length });
  } catch (e) {
    await freeOffline(farmId);
    throw e;
  }
}

/** « Libérer l'espace » : supprime la copie de la ferme sur ce poste. */
export async function freeOffline(farmId: string): Promise<void> {
  await caches.delete(cacheName(farmId));
  writeMark(farmId, null);
}
