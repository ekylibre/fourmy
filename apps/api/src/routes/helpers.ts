import type { Context } from "hono";
import type { DomainCtx } from "@fourmy/domain";
import { isUuid, type Env } from "../context.js";

/** Réponse d'erreur `application/problem+json` (RFC 9457). */
export const problem = (c: Context<Env>, status: number, title: string, detail?: string) =>
  c.json({ type: "about:blank", title, status, detail }, status as 400, {
    "content-type": "application/problem+json",
  });

/** Contexte de domaine de la requête (horloge, identifiants, acteur, origine). */
export function domainCtx(c: Context<Env>, origin: DomainCtx["origin"] = "web"): DomainCtx {
  return {
    now: new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    actor: c.get("userId"),
    origin,
  };
}

/** `?at=` validé (ISO-8601), sinon maintenant. */
export function atOrNow(c: Context<Env>): string {
  const at = c.req.query("at");
  if (!at) return new Date().toISOString();
  const t = Date.parse(at);
  if (Number.isNaN(t)) throw new BadRequest("at : date ISO-8601 attendue");
  return new Date(t).toISOString();
}

/** Fenêtre `from`/`to` validée, bornée à `maxDays`. */
export function window(c: Context<Env>, maxDays: number): { from: string; to: string } {
  const f = Date.parse(c.req.query("from") ?? "");
  const t = Date.parse(c.req.query("to") ?? "");
  if (Number.isNaN(f) || Number.isNaN(t) || t <= f) throw new BadRequest("from/to : dates ISO, from < to");
  if (t - f > maxDays * 86_400_000) throw new BadRequest(`fenêtre limitée à ${maxDays} jours`);
  return { from: new Date(f).toISOString(), to: new Date(t).toISOString() };
}

export function uuidParam(c: Context<Env>, name: string, source: "param" | "query" = "param"): string {
  const v = source === "param" ? c.req.param(name) : c.req.query(name);
  if (!isUuid(v)) throw new BadRequest(`${name} doit être un UUID`);
  return v;
}

/** Erreurs typées converties en problem+json par `onError` (app.ts). */
export class BadRequest extends Error {}
export class NotFound extends Error {}
export class Conflict extends Error {}
