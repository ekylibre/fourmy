import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { CLOSED_ROUTES, FARM_PREFIX, OPEN_ROUTES } from "../src/external/routes.js";

/**
 * Couverture des routes ouvertes (lot AM1, conception_api_mcp.md §6.1) :
 * chaque route GET de la ferme est classée ouverte ou fermée, et chaque
 * entrée de la liste correspond à une route réelle.
 */
const farmGets = () => {
  const out = new Set<string>();
  for (const r of createApp().routes) {
    if (r.method === "GET" && r.path.startsWith(`${FARM_PREFIX}/`)) out.add(r.path.slice(FARM_PREFIX.length));
  }
  return out;
};

describe("routes ouvertes aux accès restreints", () => {
  it("chaque route GET de la ferme est classée", () => {
    const open = new Set(OPEN_ROUTES.filter((r) => r.method === "GET").map((r) => r.path));
    const closed = new Set(Object.keys(CLOSED_ROUTES));
    const unclassified = [...farmGets()].filter((p) => !open.has(p) && !closed.has(p));
    expect(unclassified, "routes à classer dans src/external/routes.ts").toEqual([]);
  });

  it("chaque entrée correspond à une route réelle, une seule fois", () => {
    const real = farmGets();
    const listed = [...OPEN_ROUTES.filter((r) => r.method === "GET").map((r) => r.path), ...Object.keys(CLOSED_ROUTES)];
    expect(listed.filter((p) => !real.has(p)), "entrées sans route").toEqual([]);
    expect(listed.length, "entrée en double ou à la fois ouverte et fermée").toBe(new Set(listed).size);
  });

  it("une seule écriture : le dépôt d'une proposition (lot AM8)", () => {
    const writes = OPEN_ROUTES.filter((r) => r.method !== "GET");
    expect(writes.map((r) => `${r.method} ${r.path} ${r.module}`)).toEqual(["POST /proposals interventions"]);
    const real = createApp().routes.filter((r) => r.method === "POST").map((r) => r.path);
    expect(real).toContain(`${FARM_PREFIX}/proposals`);
  });
});
