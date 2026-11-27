import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { FARM_PREFIX } from "./routes.js";

/**
 * Débit et journal des accès externes (lot AM4, conception_api_mcp.md §6.2,
 * NF-2, API-27) : clés d'API, puis applications OAuth (AM5). Pas pour un
 * invité restreint en session : son web charge des centaines de tuiles.
 */

export const RATE_LIMITS = { perMinute: 120, perDay: 10_000 };

type Window = { minuteStart: number; minute: number; dayStart: number; day: number };
const windows = new Map<string, Window>();
const lastUse = new Map<string, number>();

/** Compte un appel ; renvoie le délai d'attente (s) si une limite est atteinte. Une seule instance d'API (Dokploy). */
export function consume(accessId: string, now = Date.now()): number | null {
  const w = windows.get(accessId) ?? { minuteStart: now, minute: 0, dayStart: now, day: 0 };
  if (now - w.minuteStart >= 60_000) Object.assign(w, { minuteStart: now, minute: 0 });
  if (now - w.dayStart >= 86_400_000) Object.assign(w, { dayStart: now, day: 0 });
  windows.set(accessId, w);
  if (w.day >= RATE_LIMITS.perDay) return Math.ceil((w.dayStart + 86_400_000 - now) / 1000);
  if (w.minute >= RATE_LIMITS.perMinute) return Math.ceil((w.minuteStart + 60_000 - now) / 1000);
  w.minute++;
  w.day++;
  return null;
}

/** Remet les compteurs à zéro (tests). */
export function resetRateLimits() {
  windows.clear();
  lastUse.clear();
}

/** Écritures du journal en cours (attendues par les tests). */
export const pendingLogs = new Set<Promise<unknown>>();

export const externalAudit: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  const p = c.get("principal");
  if (!c.get("external") || p.kind === "session" || !p.accessId) return next();
  const accessId = p.accessId;
  const wait = consume(accessId);
  if (wait !== null) {
    return new Response(JSON.stringify({ type: "about:blank", title: "Trop de requêtes", status: 429, detail: `Limite de ${RATE_LIMITS.perMinute} appels par minute et ${RATE_LIMITS.perDay} par jour.` }), {
      status: 429,
      headers: { "content-type": "application/problem+json", "retry-after": String(wait) },
    });
  }
  const t0 = performance.now();
  await next();
  const route = matchedRoutes(c).find((r) => r.method !== "ALL")?.path ?? c.req.path;
  const operation = `${c.req.method} ${route.startsWith(FARM_PREFIX) ? route.slice(FARM_PREFIX.length) || "/" : route}`.slice(0, 200);
  const farmId = c.get("farmId");
  const now = Date.now();
  const touch = now - (lastUse.get(accessId) ?? 0) >= 60_000;
  if (touch) lastUse.set(accessId, now);
  const job = withFarm(db(), farmId, async (tx) => {
    await tx.execute(sql`INSERT INTO access_log (farm_id, access_id, user_id, channel, operation, status, duration_ms)
                         VALUES (${farmId}, ${accessId}, ${p.userId}, 'rest', ${operation}, ${c.res.status}, ${Math.round(performance.now() - t0)})`);
    // Dernière utilisation : au plus une écriture par minute et par accès.
    if (touch) await tx.execute(sql`UPDATE farm_accesses SET last_used_at = now() WHERE id = ${accessId}`);
  }).catch((e: unknown) => console.error("[accès externes] journal :", e));
  pendingLogs.add(job);
  void job.finally(() => pendingLogs.delete(job));
});
