import { describe, it, expect } from "vitest";
import { TGW_REFERENCES, tgwReference } from "../src/index.js";

/** Repères de PMG (semences, lot SE2) : sources Arvalis et Terres Inovia. */
describe("repères de PMG", () => {
  it("chaque repère est sourcé et cohérent avec sa plage", () => {
    for (const r of TGW_REFERENCES) {
      expect(r.source.url).toMatch(/^https:\/\/www\.(arvalis|terresinovia)\.fr\//);
      expect(r.source.quote.length).toBeGreaterThan(5);
      expect(r.typicalG).toBeGreaterThan(0);
      if (r.minG !== null && r.maxG !== null) {
        expect(r.minG).toBeLessThanOrEqual(r.typicalG);
        expect(r.typicalG).toBeLessThanOrEqual(r.maxG);
      }
    }
    expect(new Set(TGW_REFERENCES.map((r) => r.species)).size).toBe(TGW_REFERENCES.length);
  });

  it("par taxon ou alias du catalogue, sans repli sur l'espèce parente", () => {
    expect(tgwReference("triticum_aestivum")).toMatchObject({ typicalG: 46, minG: 36, maxG: 56, source: { org: "Arvalis" } });
    expect(tgwReference("zea_mays")?.typicalG).toBe(320);
    expect(tgwReference("lupinus")?.label).toBe("Lupin");
    expect(tgwReference("sorghum")?.typicalG).toBe(30);
    expect(tgwReference("zea_mays_saccharata")).toBeNull();
    // Pas de repère publié par Arvalis ni Terres Inovia : le PMG se saisit.
    expect(tgwReference("avena_sativa")).toBeNull();
    expect(tgwReference("helianthus_annuus")).toBeNull();
    expect(tgwReference(null)).toBeNull();
  });
});
