import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { Validator } from "@seriousme/openapi-schema-validator";
import { accessModules } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { openApiDocument } from "../src/external/openapi.js";
import { OPEN_ROUTES } from "../src/external/routes.js";
import { pendingImports } from "../src/routes/imports.js";
import { addGuest, setupFarm, teardown } from "./helpers.js";

/**
 * Documentation OpenAPI (lot AM7, conception_api_mcp.md §6.3) : document
 * valide, une entrée par route ouverte, et des réponses réelles conformes à
 * leur schéma. La ferme de test est remplie par l'import Geofolia anonymisé
 * (packages/importers/test/fixtures/geofolia-pilote.zip).
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const fixture = readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "importers", "test", "fixtures", "geofolia-pilote.zip"));

type Doc = { openapi: string; paths: Record<string, Record<string, Record<string, unknown>>> };
const openApiPath = (p: string) => `/farms/{farmId}${p.replace(/:([a-zA-Z]+)/g, "{$1}")}`;

describe("document OpenAPI", () => {
  const doc = openApiDocument() as unknown as Doc;

  it("est un document OpenAPI 3.1 valide", async () => {
    const result = await new Validator().validate(doc as never);
    expect(result.errors ?? [], JSON.stringify(result.errors, null, 1)?.slice(0, 2000)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(doc.openapi).toBe("3.1.0");
  });

  it("décrit chaque route ouverte, et seulement elles", () => {
    expect(Object.keys(doc.paths).sort()).toEqual([...new Set(OPEN_ROUTES.map((r) => openApiPath(r.path)))].sort());
    for (const r of OPEN_ROUTES) {
      const op = doc.paths[openApiPath(r.path)]![r.method.toLowerCase()];
      expect(op["x-fourmy-module"], r.path).toBe(r.module);
      expect(op.summary, r.path).toBe(r.summary);
    }
  });

  it("est servi sans authentification, lisible depuis un autre site", async () => {
    const res = await app.request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as Doc;
    expect(Object.keys(body.paths)).toHaveLength(new Set(OPEN_ROUTES.map((r) => r.path)).size);
  });
});

describe.skipIf(!url)("conformité des réponses (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  const users: string[] = [];

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme test OpenAPI");
    users.push(farm.userId);
    const form = new FormData();
    form.set("file", new File([fixture], "export.zip"));
    const base = `/api/v1/farms/${farm.farmId}`;
    const run = (await (await app.request(`${base}/imports/files`, { method: "POST", headers: { authorization: farm.headers.authorization! }, body: form })).json()) as { id: string };
    const res = await app.request(`${base}/imports/${run.id}/apply`, { method: "POST", headers: farm.headers });
    expect(res.status, await res.clone().text()).toBe(202);
    await Promise.all([...pendingImports]);
  }, 180_000);
  afterAll(async () => {
    await sql`DELETE FROM import_runs WHERE farm_id = ${farm.farmId}`;
    await teardown(sql, farm.farmId, users);
    await sql.end();
  });

  /** Premiers identifiants d'une liste (tableau `items`, ou tableau à la racine). */
  const firstIds = (body: unknown): string[] => {
    const items = Array.isArray(body) ? body : ((body as { items?: unknown[] })?.items ?? []);
    return items.flatMap((x) => (x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" ? [(x as { id: string }).id] : [])).slice(0, 3);
  };

  it("chaque réponse réelle d'une route ouverte passe par son schéma", { timeout: 300_000 }, async () => {
    const guest = await addGuest(sql, farm.farmId, { modules: Object.fromEntries(accessModules.map((m) => [m, "read"])), activities: "all" });
    users.push(guest.userId);
    const get = (p: string) => app.request(`/api/v1/farms/${farm.farmId}${p}`, { headers: guest.headers });

    // Identifiants réels pour les routes `/…/:id/…`.
    const lists: Record<string, string> = {
      "land-parcels": "/land-parcels",
      activities: "/activities?year=2026",
      "technical-itineraries": "/technical-itineraries",
      interventions: "/interventions?campaign=2026",
      "fertilization/plans": "/fertilization/plans?campaign=2026",
      prescriptions: "/prescriptions",
      articles: "/articles",
      containers: "/containers",
      equipments: "/equipments",
      people: "/people",
    };
    const ids: Record<string, string[]> = {};
    for (const [k, p] of Object.entries(lists)) ids[k] = firstIds(await (await get(p)).json());
    expect(ids["land-parcels"]!.length, "parcelles importées").toBeGreaterThan(0);
    expect(ids.interventions!.length, "interventions importées").toBeGreaterThan(0);

    const owner = (path: string) =>
      path.startsWith("/phyto/parcels/:id") ? "land-parcels" : path.startsWith("/fertilization/plans/:id") ? "fertilization/plans" : path.match(/^\/([a-z-]+)\/:id/)?.[1];
    const extra: Record<string, string> = {
      "/technical-itineraries/history": `?activityId=${ids.activities![0] ?? "00000000-0000-4000-8000-000000000000"}`,
      "/reference/bbch": "?crop=ZEA_MAYS",
      "/people/:id/interventions": "?from=2025-09-01&to=2026-08-31",
      "/interventions": "?campaign=2026",
      "/phyto/ift": "?campaign=2026",
    };

    const failures: string[] = [];
    const checked = new Set<string>();
    for (const r of OPEN_ROUTES) {
      if (!r.response || r.method !== "GET") continue;
      const concrete: string[] = [];
      if (r.path.includes(":id")) for (const id of ids[owner(r.path)!] ?? []) concrete.push(r.path.replace(":id", id));
      else if (r.path === "/control/:kind") concrete.push("/control/hve", "/control/ab");
      else if (r.path === "/crop-plans/:year") concrete.push("/crop-plans/2026");
      else concrete.push(r.path);
      for (const p of concrete) {
        const res = await get(p + (extra[r.path] ?? ""));
        if (res.status !== 200 || !res.headers.get("content-type")?.includes("json")) continue;
        const parsed = r.response.safeParse(await res.json());
        checked.add(r.path);
        if (!parsed.success) failures.push(`${p} : ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ")}`);
      }
    }
    expect(failures, "réponses non conformes à leur schéma").toEqual([]);
    // La plupart des routes répondent sur une ferme importée ; les autres (sans matériel, sans personne…) restent couvertes ailleurs.
    expect(checked.size).toBeGreaterThan(OPEN_ROUTES.length * 0.6);
  });
});
