import { accessModules, type AccessGrant, type AccessLevel, type AccessModule } from "@fourmy/contracts";

/**
 * Droits effectifs (claudedocs/conception_api_mcp.md §3.2, lot AM1) :
 * droits du membre ∩ droits de l'accès. Fonctions pures.
 */

export type MemberRole = "owner" | "worker" | "reader" | "guest";

/** Droits normalisés : chaque module a un niveau. */
export type EffectiveGrant = {
  modules: Record<AccessModule, AccessLevel>;
  activities: "all" | string[];
};

const RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2 };

const everyModule = (level: AccessLevel): Record<AccessModule, AccessLevel> =>
  Object.fromEntries(accessModules.map((m) => [m, level])) as Record<AccessModule, AccessLevel>;

/** Normalise des droits : un module absent vaut `none`. */
export function normalizeGrant(grant: AccessGrant): EffectiveGrant {
  const modules = everyModule("none");
  for (const m of accessModules) modules[m] = grant.modules[m] ?? "none";
  return { modules, activities: grant.activities === "all" ? "all" : [...new Set(grant.activities)].sort() };
}

/** Accès complet en écriture (et en lecture), toutes activités. */
export const FULL_GRANT: EffectiveGrant = { modules: everyModule("write"), activities: "all" };

/**
 * Droits d'un membre. `owner` et `worker` : tout en écriture ; `reader` : tout
 * en lecture ; `guest` : ses droits enregistrés (aucun s'ils manquent).
 */
export function memberGrant(role: MemberRole, grant?: AccessGrant | null): EffectiveGrant {
  if (role === "owner" || role === "worker") return FULL_GRANT;
  if (role === "reader") return { modules: everyModule("read"), activities: "all" };
  return grant ? normalizeGrant(grant) : { modules: everyModule("none"), activities: [] };
}

const lower = (a: AccessLevel, b: AccessLevel): AccessLevel => (RANK[a] <= RANK[b] ? a : b);

/** Intersection : le niveau le plus faible par module, les activités communes. */
export function intersectGrants(a: EffectiveGrant, b: EffectiveGrant): EffectiveGrant {
  const modules = everyModule("none");
  for (const m of accessModules) modules[m] = lower(a.modules[m], b.modules[m]);
  let activities: "all" | string[];
  if (a.activities === "all") activities = b.activities;
  else if (b.activities === "all") activities = a.activities;
  else {
    const other = new Set(b.activities);
    activities = a.activities.filter((id) => other.has(id));
  }
  return { modules, activities };
}

/** Le niveau suffit-il pour la méthode HTTP ? GET/HEAD : lecture ; le reste : écriture. */
export function levelAllows(level: AccessLevel, method: string): boolean {
  const read = method === "GET" || method === "HEAD";
  return read ? RANK[level] >= RANK.read : RANK[level] >= RANK.write;
}

/** Aucun module ouvert, ou aucune activité : l'accès ne donne rien. */
export function isEmptyGrant(g: EffectiveGrant): boolean {
  return accessModules.every((m) => g.modules[m] === "none") || (g.activities !== "all" && g.activities.length === 0);
}

/**
 * Plafond (API-4, Q4) : les droits demandés pour un accès, réduits à ceux de
 * son créateur. Renvoie aussi ce qui a été réduit, pour l'expliquer à l'écran.
 */
export function capGrant(creator: EffectiveGrant, requested: AccessGrant): { grant: EffectiveGrant; reduced: AccessModule[]; activitiesReduced: boolean } {
  const req = normalizeGrant(requested);
  const grant = intersectGrants(creator, req);
  const reduced = accessModules.filter((m) => grant.modules[m] !== req.modules[m]);
  const activitiesReduced =
    req.activities === "all" ? grant.activities !== "all" : grant.activities === "all" ? false : grant.activities.length < req.activities.length;
  return { grant, reduced, activitiesReduced };
}
