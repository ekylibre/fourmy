import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coverFamily, coverOf, productionDates, readGeofolia } from "../src/index.js";

const bundle = readGeofolia(new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "geofolia-pilote.zip"))), "x.zip");

describe("couverts d'interculture", () => {
  it("famille d'après les espèces nommées : mélanges avec légumineuses, sinon la famille dominante", () => {
    expect(coverFamily(["Moutarde blanche"], null)).toBe("cruciferes");
    expect(coverFamily(["Mélange CINE", "Radis chinois", "Trèfle Micheli"], null)).toBe("melange_cruciferes_legumineuses");
    expect(coverFamily(["Nickel - vesce velue", "Avoine hiver"], null)).toBe("melange_graminees_legumineuses");
    expect(coverFamily(["avoine de printemps", "Phacelie"], null)).toBe("hydrophyllacees");
    expect(coverFamily(["Ray-grass italien"], null)).toBe("graminees_ray_grass");
    // Aucune espèce reconnue dans les libellés : code AgroEDI de la culture (ZDA, moutarde blanche).
    expect(coverFamily(["Mélange CINE", "Couvertsol novation 2"], "ZDA")).toBe("cruciferes");
    expect(coverFamily(["Mélange maison"], null)).toBeNull();
  });

  it("jeu anonymisé : les mélanges CINE sont des couverts, les dérobées restent des productions", () => {
    const secondary = bundle.parcels.filter((p) => p.secondary);
    const covers = secondary.filter((p) => coverOf(bundle, p));
    expect(covers).toHaveLength(5);
    expect(covers.every((p) => p.crop.label === "Mélange CINE")).toBe(true);
    for (const p of secondary.filter((x) => x.crop.label !== "Mélange CINE")) expect(coverOf(bundle, p), p.crop.label).toBeNull();
    // Une culture principale n'est jamais un couvert.
    expect(bundle.parcels.filter((p) => !p.secondary).some((p) => coverOf(bundle, p))).toBe(false);
    for (const p of covers) {
      const c = coverOf(bundle, p)!;
      expect(c.exported).toBe(false); // CINE : non exporté
      expect(c.sownOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (c.destroyedOn) expect(c.destroyedOn >= c.sownOn).toBe(true);
    }
  });

  it("dates d'une production : semis → récolte, fin ignorée si antérieure au début", () => {
    const p = bundle.parcels.find((x) => !x.secondary)!;
    const d = productionDates(p);
    expect(d.startedOn).toBe(p.crop.sownOn);
    expect(productionDates({ ...p, crop: { ...p.crop, sownOn: "2026-05-01", harvestedOn: "2026-04-01" } })).toEqual({ startedOn: "2026-05-01", stoppedOn: null });
  });
});
