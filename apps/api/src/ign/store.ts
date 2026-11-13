import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { IgnLayer } from "@fourmy/contracts";
import type { Database } from "@fourmy/db";

/**
 * Cache des tuiles IGN sur le disque du serveur (« Ma ferme », lot F4,
 * claudedocs/conception_ma_ferme.md §5.3). Les fichiers sont rangés en
 * `{dossier}/{couche}/{z}/{x}/{y}.{ext}` et indexés dans `ign_tiles`, table
 * commune à toutes les fermes (données publiques). Utilisé par le relais de
 * l'API et par le préchargement du worker.
 */

export const IGN_LAYERS: Record<IgnLayer, { wmts: string; format: string; ext: string; contentType: string }> = {
  ortho: { wmts: "ORTHOIMAGERY.ORTHOPHOTOS", format: "image/jpeg", ext: "jpg", contentType: "image/jpeg" },
  plan: { wmts: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", format: "image/png", ext: "png", contentType: "image/png" },
};

export const ignStoreConfig = {
  dir: resolve(process.env.FOURMY_IGN_CACHE_DIR ?? ".cache/ign"),
  timeoutMs: 5000,
  /** Au-delà, la tuile est redemandée à l'IGN (If-None-Match). */
  maxAgeDays: 180,
};
/** Injection pour les tests : pas d'appel réseau vers l'IGN. */
export const ignStoreDeps = { fetch: (input: string, init?: RequestInit) => fetch(input, init) };

export class IgnUnavailable extends Error {}

export interface StoredTile {
  bytes: Buffer;
  sha1: string;
  fetchedAt: Date;
  cache: "HIT" | "MISS" | "STALE";
}

type Row = { bytes: number; sha1: string; ign_etag: string | null; fetched_at: Date; last_read_at: Date };

export const tilePath = (layer: IgnLayer, z: number, x: number, y: number) => join(ignStoreConfig.dir, layer, String(z), String(x), `${y}.${IGN_LAYERS[layer].ext}`);

export function wmtsUrl(layer: IgnLayer, z: number, x: number, y: number): string {
  const l = IGN_LAYERS[layer];
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${l.wmts}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=${encodeURIComponent(l.format)}`;
}

async function indexRow(db: Database, layer: IgnLayer, z: number, x: number, y: number): Promise<Row | null> {
  const [r] = (await db.execute(sql`
    SELECT bytes, sha1, ign_etag, fetched_at, last_read_at FROM ign_tiles WHERE layer = ${layer} AND z = ${z} AND x = ${x} AND y = ${y}`)) as unknown as Row[];
  return r ? { ...r, fetched_at: new Date(r.fetched_at), last_read_at: new Date(r.last_read_at) } : null;
}

/** Tableau Postgres en littéral : drizzle déplierait un tableau JS en paramètres séparés. */
export const pgArray = (values: (string | number)[]) => `{${values.join(",")}}`;

const fresh = (r: Row) => Date.now() - r.fetched_at.getTime() < ignStoreConfig.maxAgeDays * 86_400_000;

// --- Dernière lecture (quota LRU) : au plus une écriture par jour et par tuile, par lots.

const readBuffer = new Set<string>();
let flushTimer: NodeJS.Timeout | undefined;

function noteRead(db: Database, layer: IgnLayer, z: number, x: number, y: number, r: Row) {
  if (Date.now() - r.last_read_at.getTime() < 86_400_000) return;
  readBuffer.add(`${layer}/${z}/${x}/${y}`);
  flushTimer ??= setTimeout(() => void flushReads(db), 60_000).unref();
}

export async function flushReads(db: Database): Promise<void> {
  flushTimer = undefined;
  if (!readBuffer.size) return;
  const keys = [...readBuffer].map((k) => k.split("/"));
  readBuffer.clear();
  await db
    .execute(sql`
      UPDATE ign_tiles t SET last_read_at = now()
      FROM unnest(${pgArray(keys.map((k) => k[0]!))}::text[], ${pgArray(keys.map((k) => Number(k[1])))}::int[], ${pgArray(keys.map((k) => Number(k[2])))}::int[], ${pgArray(keys.map((k) => Number(k[3])))}::int[]) AS k(layer, z, x, y)
      WHERE t.layer = k.layer AND t.z = k.z AND t.x = k.x AND t.y = k.y`)
    .catch((e) => console.warn(`[ign] dernière lecture non enregistrée : ${(e as Error).message}`));
}

// --- Téléchargement

type Fetched = { status: 200; bytes: Buffer; etag: string | null } | { status: 304 } | { status: 404 };

async function fetchFromIgn(layer: IgnLayer, z: number, x: number, y: number, etag: string | null): Promise<Fetched> {
  let res: Response;
  try {
    res = await ignStoreDeps.fetch(wmtsUrl(layer, z, x, y), {
      headers: etag ? { "if-none-match": etag } : {},
      signal: AbortSignal.timeout(ignStoreConfig.timeoutMs),
    });
  } catch (e) {
    throw new IgnUnavailable(`IGN injoignable : ${(e as Error).message}`);
  }
  if (res.status === 304) return { status: 304 };
  // Hors couverture : l'IGN répond 400 ou 404 ; rien à mettre en cache.
  if (res.status === 404 || res.status === 400) return { status: 404 };
  if (!res.ok) throw new IgnUnavailable(`IGN : HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new IgnUnavailable(`IGN : réponse ${type || "sans type"} au lieu d'une image`);
  return { status: 200, bytes: Buffer.from(await res.arrayBuffer()), etag: res.headers.get("etag") };
}

/** Écriture atomique : fichier temporaire dans le même dossier, puis rename. */
async function writeTile(db: Database, layer: IgnLayer, z: number, x: number, y: number, bytes: Buffer, etag: string | null): Promise<string> {
  const path = tilePath(layer, z, x, y);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  await db.execute(sql`
    INSERT INTO ign_tiles (layer, z, x, y, bytes, sha1, ign_etag, fetched_at, last_read_at)
    VALUES (${layer}, ${z}, ${x}, ${y}, ${bytes.length}, ${sha1}, ${etag}, now(), now())
    ON CONFLICT (layer, z, x, y) DO UPDATE SET bytes = excluded.bytes, sha1 = excluded.sha1, ign_etag = excluded.ign_etag, fetched_at = now()`);
  return sha1;
}

async function readFileOrNull(path: string): Promise<Buffer | null> {
  return readFile(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
}

const inflight = new Map<string, Promise<StoredTile | null>>();

/**
 * Tuile depuis le cache, ou depuis l'IGN si elle manque ou a plus de
 * 180 jours. IGN indisponible : la tuile périmée si on l'a, sinon
 * IgnUnavailable. Null : hors couverture de l'IGN.
 */
export function getTile(db: Database, layer: IgnLayer, z: number, x: number, y: number): Promise<StoredTile | null> {
  const key = `${layer}/${z}/${x}/${y}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = loadTile(db, layer, z, x, y).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function loadTile(db: Database, layer: IgnLayer, z: number, x: number, y: number): Promise<StoredTile | null> {
  const row = await indexRow(db, layer, z, x, y);
  const onDisk = row ? await readFileOrNull(tilePath(layer, z, x, y)) : null;
  if (row && onDisk) {
    noteRead(db, layer, z, x, y, row);
    if (fresh(row)) return { bytes: onDisk, sha1: row.sha1, fetchedAt: row.fetched_at, cache: "HIT" };
  }
  let got: Fetched;
  try {
    got = await fetchFromIgn(layer, z, x, y, onDisk ? row!.ign_etag : null);
  } catch (e) {
    if (row && onDisk) return { bytes: onDisk, sha1: row.sha1, fetchedAt: row.fetched_at, cache: "STALE" };
    throw e;
  }
  if (got.status === 404) return null;
  if (got.status === 304) {
    await db.execute(sql`UPDATE ign_tiles SET fetched_at = now() WHERE layer = ${layer} AND z = ${z} AND x = ${x} AND y = ${y}`);
    return { bytes: onDisk!, sha1: row!.sha1, fetchedAt: new Date(), cache: "HIT" };
  }
  const sha1 = await writeTile(db, layer, z, x, y, got.bytes, got.etag);
  return { bytes: got.bytes, sha1, fetchedAt: new Date(), cache: "MISS" };
}

/**
 * Préchargement : s'assure qu'une tuile est en cache et récente, sans lire
 * le fichier si l'index dit qu'elle l'est. `present` : rien à faire ;
 * `fetched` : téléchargée ; `empty` : hors couverture de l'IGN.
 */
export async function ensureTile(db: Database, layer: IgnLayer, z: number, x: number, y: number): Promise<"present" | "fetched" | "empty"> {
  const row = await indexRow(db, layer, z, x, y);
  if (row && fresh(row)) return "present";
  const t = await getTile(db, layer, z, x, y);
  if (!t) return "empty";
  return t.cache === "MISS" ? "fetched" : "present";
}

/** Supprime des tuiles du disque et de l'index (purge du quota). */
export async function deleteTiles(db: Database, keys: { layer: IgnLayer; z: number; x: number; y: number }[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500);
    await db.execute(sql`
      DELETE FROM ign_tiles t
      USING unnest(${pgArray(batch.map((k) => k.layer))}::text[], ${pgArray(batch.map((k) => k.z))}::int[], ${pgArray(batch.map((k) => k.x))}::int[], ${pgArray(batch.map((k) => k.y))}::int[]) AS k(layer, z, x, y)
      WHERE t.layer = k.layer AND t.z = k.z AND t.x = k.x AND t.y = k.y`);
    for (const k of batch) await rm(tilePath(k.layer, k.z, k.x, k.y), { force: true });
  }
}
