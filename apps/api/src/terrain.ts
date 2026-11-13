import { ancestor, childFromAncestor, IgnHttpError, Lru } from "@fourmy/geo-ign";
import { db } from "./db.js";
import { getTile, HEIGHTMAP_SIZE, IgnUnavailable } from "./ign/store.js";

/**
 * Service de relief (ADR-9 révisée). La Géoplateforme limite le débit (429
 * constatés le 2026-11-07 dès qu'on zoome : Cesium demande des dizaines de
 * tuiles d'un coup). D'où :
 *  - finesse plafonnée au niveau 16 (~4,7 m entre échantillons, assez pour
 *    une ferme) : les tuiles plus fines sont interpolées dans leur ancêtre,
 *    une requête IGN en sert 4, 16 ou 64 ;
 *  - requêtes simultanées pour une même tuile regroupées, 4 appels IGN au plus
 *    en parallèle, nouvelles tentatives espacées sur 429 / 503 ;
 *  - en dernier recours, relief plat à l'altitude de référence de la ferme
 *    (et non au niveau de la mer, qui creuserait des trous de 30 m).
 * Depuis « Ma ferme » F4 bis, les grilles passent par le cache disque du
 * serveur (ign/store.ts) : préchargées par le worker, elles survivent aux
 * redémarrages, et une grille périmée sert encore si l'IGN ne répond pas.
 */
export { HEIGHTMAP_SIZE };
export const MAX_IGN_LEVEL = 16;
const MAX_CONCURRENT = 4;

const grids = new Lru<string, Float32Array>(4000);
const inflight = new Map<string, Promise<Float32Array>>();
const referenceAltitude = new Lru<string, number>(500);

let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts: number, baseDelayMs: number): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e) {
      const status = e instanceof IgnHttpError || e instanceof IgnUnavailable ? e.status : null;
      const retryable = status !== null && (status === 429 || status >= 500);
      if (!retryable || n >= attempts - 1) throw e;
      const retryAfterS = (e as IgnHttpError | IgnUnavailable).retryAfterS;
      const wait = retryAfterS ? retryAfterS * 1000 : baseDelayMs * 2 ** n + Math.random() * baseDelayMs;
      await sleep(Math.min(wait, 5000));
    }
  }
}

export const terrainConfig = { retryBaseDelayMs: 400, attempts: 3 };

/** Grille depuis le cache disque, ou l'IGN (copie alignée : le Buffer lu peut ne pas l'être). */
async function storedGrid(z: number, x: number, y: number, fetchImpl: typeof fetch): Promise<Float32Array> {
  const tile = await getTile(db(), "elevation", z, x, y, fetchImpl);
  if (!tile || tile.bytes.length !== HEIGHTMAP_SIZE * HEIGHTMAP_SIZE * 4) throw new IgnUnavailable(`Relief IGN : grille absente pour ${z}/${x}/${y}`);
  const grid = new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE);
  new Uint8Array(grid.buffer).set(tile.bytes);
  return grid;
}

/** Grille IGN d'une tuile de niveau ≤ 16 : cache, regroupement, limite, reprises. */
function ignGrid(z: number, x: number, y: number, fetchImpl: typeof fetch): Promise<Float32Array> {
  const key = `${z}/${x}/${y}`;
  const cached = grids.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = limited(() => withRetry(() => storedGrid(z, x, y, fetchImpl), terrainConfig.attempts, terrainConfig.retryBaseDelayMs))
    .then((grid) => {
      grids.set(key, grid);
      return grid;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function meanAltitude(grid: Float32Array): number | null {
  let sum = 0;
  let n = 0;
  for (const h of grid) {
    if (h !== 0) {
      sum += h;
      n++;
    }
  }
  return n ? sum / n : null;
}

export async function terrainTile(
  farmId: string,
  z: number,
  x: number,
  y: number,
  fetchImpl: typeof fetch,
): Promise<{ grid: Float32Array; source: "ign" | "fallback" }> {
  try {
    let grid: Float32Array;
    if (z <= MAX_IGN_LEVEL) grid = await ignGrid(z, x, y, fetchImpl);
    else {
      const a = ancestor(z, x, y, MAX_IGN_LEVEL);
      grid = childFromAncestor(await ignGrid(a.z, a.x, a.y, fetchImpl), a, z, x, y, HEIGHTMAP_SIZE);
    }
    if (referenceAltitude.get(farmId) === undefined) {
      const m = meanAltitude(grid);
      if (m !== null) referenceAltitude.set(farmId, m);
    }
    return { grid, source: "ign" };
  } catch (e) {
    console.warn(`relief IGN indisponible pour ${z}/${x}/${y} : ${(e as Error).message}`);
    return { grid: new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE).fill(referenceAltitude.get(farmId) ?? 0), source: "fallback" };
  }
}
