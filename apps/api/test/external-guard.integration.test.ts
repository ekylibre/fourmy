import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { accessModules } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { CLOSED_ROUTES, OPEN_ROUTES } from "../src/external/routes.js";
import { addGuest, addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Garde des accès restreints (lot AM1, conception_api_mcp.md §6.1) avec de
 * vrais membres `guest` : route fermée → 404, module non ouvert → 403,
 * écriture → 404 ; rien ne change pour owner, worker et reader.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const ID = "00000000-0000-4000-8000-0000000000aa";

/** Chemin concret d'une route : identifiants inconnus, campagne 2026, contrôle HVE. */
const concrete = (path: string) =>
  path.replace(":year", "2026").replace(":kind", "hve").replace(":version", "1").replace(":date", "2026-06-01").replace(/:[a-zA-Z]+/g, ID);

/** Réponse de la garde (et non de la route) : 404 sans détail, ou 403 « Accès refusé ». */
const guardDenied = async (res: Response) => {
  if (res.status !== 403 && res.status !== 404) return null;
  const body = (await res.clone().json().catch(() => ({}))) as { title?: string; detail?: string };
  if (res.status === 404 && body.title === "Not Found" && !body.detail) return "404";
  if (res.status === 403 && body.title === "Accès refusé") return "403";
  return null;
};

describe.skipIf(!url)("garde des accès restreints (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  const users: string[] = [];
  const allRead = Object.fromEntries(accessModules.map((m) => [m, "read"]));

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme test garde AM1");
    users.push(farm.userId);
  });
  afterAll(async () => {
    await teardown(sql, farm.farmId, users);
    await sql.end();
  });

  const get = (headers: Record<string, string>, path: string) => app.request(`/api/v1/farms/${farm.farmId}${path}`, { headers });

  it("invité en lecture sur tous les modules : toutes les routes ouvertes passent la garde", { timeout: 120_000 }, async () => {
    const guest = await addGuest(sql, farm.farmId, { modules: allRead, activities: "all" });
    users.push(guest.userId);
    const denied: string[] = [];
    const errors: string[] = [];
    for (const r of OPEN_ROUTES) {
      const res = await get(guest.headers, concrete(r.path));
      if (await guardDenied(res)) denied.push(r.path);
      if (res.status >= 500) errors.push(`${r.path} → ${res.status}`);
    }
    expect(denied, "routes ouvertes refusées par la garde").toEqual([]);
    expect(errors, "routes ouvertes en erreur serveur").toEqual([]);
  });

  it("route fermée : 404, comme si elle n'existait pas", async () => {
    const guest = await addGuest(sql, farm.farmId, { modules: allRead, activities: "all" });
    users.push(guest.userId);
    for (const path of Object.keys(CLOSED_ROUTES)) {
      const res = await get(guest.headers, concrete(path));
      expect(await guardDenied(res), path).toBe("404");
    }
  });

  it("module non ouvert : 403 qui nomme le module ; écriture : 404", async () => {
    const guest = await addGuest(sql, farm.farmId, { modules: { interventions: "read" }, activities: "all" });
    users.push(guest.userId);
    expect((await get(guest.headers, "/interventions?campaign=2026")).status).toBe(200);
    const stock = await get(guest.headers, "/stock");
    expect(stock.status).toBe(403);
    expect((await stock.json()).detail).toContain("Stocks et semences");
    const post = await app.request(`/api/v1/farms/${farm.farmId}/interventions`, { method: "POST", headers: guest.headers, body: "{}" });
    expect(await guardDenied(post)).toBe("404");
  });

  it("invité « écriture » : toujours aucune écriture directe (B6)", async () => {
    const guest = await addGuest(sql, farm.farmId, { modules: { interventions: "write" }, activities: "all" });
    users.push(guest.userId);
    const post = await app.request(`/api/v1/farms/${farm.farmId}/interventions`, { method: "POST", headers: guest.headers, body: "{}" });
    expect(await guardDenied(post)).toBe("404");
  });

  it("invité sans module : refusé ; limité à des activités : admis (périmètre AM2)", async () => {
    const none = await addGuest(sql, farm.farmId, { modules: {}, activities: "all" });
    const scoped = await addGuest(sql, farm.farmId, { modules: allRead, activities: [ID] });
    users.push(none.userId, scoped.userId);
    expect((await get(none.headers, "/interventions?campaign=2026")).status).toBe(403);
    expect((await get(scoped.headers, "/interventions?campaign=2026")).status).toBe(200);
  });

  it("owner, worker et reader : rien ne change", async () => {
    const worker = await addMember(sql, farm.farmId, "worker");
    const reader = await addMember(sql, farm.farmId, "reader");
    users.push(worker.userId, reader.userId);
    expect((await get(farm.headers, "/members")).status).toBe(200);
    expect((await get(worker.headers, "/settings/spraying")).status).toBe(200);
    expect((await get(reader.headers, "/stock")).status).toBe(200);
    const post = await app.request(`/api/v1/farms/${farm.farmId}/people`, { method: "POST", headers: reader.headers, body: "{}" });
    expect(post.status).toBe(403); // règle reader d'avant AM1
  });
});
