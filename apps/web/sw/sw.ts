/// <reference lib="webworker" />
/**
 * Service worker de Fourmy (« Ma ferme », lot F5, claudedocs/conception_ma_ferme.md
 * §6.4). Écrit à la main, sans dépendance. Il ne fait que trois choses :
 *  1. tuiles IGN et relief d'une ferme : d'abord la copie hors ligne
 *     (`fourmy-ign-<ferme>`, remplie par la page), puis le réseau ;
 *  2. coquille de l'application : page et fichiers versionnés, pour qu'elle
 *     s'ouvre sans réseau ;
 *  3. lectures de l'API utiles à la consultation : réseau d'abord, dernière
 *     réponse en secours, et seulement pour une ferme gardée hors ligne.
 * Hors ligne, on consulte ; on ne saisit pas (le mobile s'en charge).
 * À la déconnexion, tout ce qui a été gardé est effacé (poste partagé).
 */
declare const self: ServiceWorkerGlobalScope;
export {};

const SHELL = "fourmy-shell-v1";
const API = "fourmy-api-v1";
const IGN_PREFIX = "fourmy-ign-";

const FARM_TILES = /^\/api\/v1\/farms\/([0-9a-f-]{36})\/(?:ign\/tiles|terrain\/heightmap)\//;
const FARM_API = /^\/api\/v1\/farms\/([0-9a-f-]{36})\//;
/** Lectures hors ferme nécessaires pour ouvrir l'application. */
const GLOBAL_API = /^\/api\/(?:auth\/get-session|v1\/me(?:\/|$))/;
/** Fichiers versionnés par Vite (nom haché) : le cache d'abord. */
const HASHED = /^\/assets\//;
/** Fichiers non versionnés (Cesium, kit, icône) : le réseau d'abord. */
const STATIC = /^\/(?:cesium|kit)\/|^\/favicon\.svg$/;

self.addEventListener("install", () => void self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("fourmy-shell-") && key !== SHELL) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function hasOfflineFarm(farmId?: string): Promise<boolean> {
  if (farmId) return caches.has(IGN_PREFIX + farmId);
  return (await caches.keys()).some((k) => k.startsWith(IGN_PREFIX));
}

/** Efface tout ce qui a été gardé (déconnexion). */
async function forgetEverything(): Promise<void> {
  for (const key of await caches.keys()) if (key.startsWith(IGN_PREFIX) || key === API) await caches.delete(key);
}

const offlineProblem = () =>
  new Response(JSON.stringify({ type: "about:blank", title: "Hors ligne", status: 503, detail: "Pas de réseau, et rien de gardé pour cette page." }), {
    status: 503,
    headers: { "content-type": "application/problem+json" },
  });

async function farmTile(request: Request, farmId: string): Promise<Response> {
  const copy = await caches.open(IGN_PREFIX + farmId);
  const hit = await copy.match(request.url, { ignoreSearch: true });
  return hit ?? fetch(request);
}

async function navigation(request: Request): Promise<Response> {
  const shell = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) await shell.put("/", res.clone());
    return res;
  } catch {
    return (await shell.match("/")) ?? offlineProblem();
  }
}

async function hashedFile(request: Request): Promise<Response> {
  const shell = await caches.open(SHELL);
  const hit = await shell.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await shell.put(request, res.clone());
  return res;
}

async function staticFile(request: Request): Promise<Response> {
  const shell = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) await shell.put(request, res.clone());
    return res;
  } catch {
    return (await shell.match(request)) ?? offlineProblem();
  }
}

async function apiRead(request: Request, farmId: string | undefined): Promise<Response> {
  try {
    const res = await fetch(request);
    // JSON seulement : les exports (PDF, ZIP, images) ne s'accumulent pas sur le poste.
    const json = (res.headers.get("content-type") ?? "").includes("json");
    if (res.ok && json && (await hasOfflineFarm(farmId))) await (await caches.open(API)).put(request, res.clone());
    return res;
  } catch {
    return (await (await caches.open(API)).match(request)) ?? offlineProblem();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === "POST" && url.pathname === "/api/auth/sign-out") {
    event.respondWith(forgetEverything().then(() => fetch(request)));
    return;
  }
  if (request.method !== "GET") return;
  const tile = FARM_TILES.exec(url.pathname);
  if (tile) return event.respondWith(farmTile(request, tile[1]!));
  if (request.mode === "navigate") return event.respondWith(navigation(request));
  if (HASHED.test(url.pathname)) return event.respondWith(hashedFile(request));
  if (STATIC.test(url.pathname)) return event.respondWith(staticFile(request));
  const farm = FARM_API.exec(url.pathname);
  if (farm) return event.respondWith(apiRead(request, farm[1]));
  if (GLOBAL_API.test(url.pathname)) return event.respondWith(apiRead(request, undefined));
});
