import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeFile, buildPreview, decodeXml, ImportFileError, readTelepac, SNA_TYPES } from "../src/index.js";

/** Jeu anonymisé tiré d'un dossier PAC réel (scripts/anonymize-telepac.mjs). */
const fixture = new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "telepac-pilote.xml")));
const bundle = readTelepac(fixture, "Dossier-PAC-2026.xml");

describe("lecteur TelePAC", () => {
  it("est enregistré ; identité du demandeur et campagne du schéma d'échange", () => {
    const a = analyzeFile("Dossier-PAC-2026.xml", fixture);
    expect(a.format).toBe("telepac");
    expect(bundle.campaigns).toEqual([2026]);
    expect(bundle.farm).toEqual({ siret: "40000000000003", pacage: "040000003", name: "GAEC PILOTE TEST", email: "pilote@exemple.test", address: null });
    expect(buildPreview(a, { fileName: "x.xml", farmSiret: "40000000000003", decisions: {} }).farm.siretMatches).toBe(true);
  });

  it("îlots et parcelles PAC : code culture, surface admissible (ares → m²), contours", () => {
    const islets = bundle.capRefs.filter((r) => r.kind === "islet");
    const parcels = bundle.capRefs.filter((r) => r.kind === "parcel");
    expect(islets).toHaveLength(4);
    expect(parcels).toHaveLength(16);
    for (const p of parcels) {
      expect(p.ref).toMatch(/^\d{12}\/\d+$/);
      expect(p.shape?.type).toBe("MultiPolygon");
    }
    expect(parcels.some((p) => p.capCode && p.admissibleAreaM2 && p.admissibleAreaM2 % 100 === 0)).toBe(true);
    // Une parcelle Fourmy proposée par parcelle PAC (créée seulement si la ferme n'en a pas à cet endroit).
    expect(bundle.parcels).toHaveLength(16);
    expect(bundle.parcels.every((p) => p.sourceIds["telepac.parcel"]?.startsWith("2026:"))).toBe(true);
  });

  it("SNA et ZDH : type, largeur, surface ; arbres isolés en points", () => {
    expect(bundle.landscape).toHaveLength(134);
    const byKind = bundle.landscape.reduce<Record<string, number>>((acc, l) => ((acc[String(l.attrs.kind)] = (acc[String(l.attrs.kind)] ?? 0) + 1), acc), {});
    expect(byKind).toMatchObject({ hedge: 47, tree: 54, tree_row: 20, hedge_densification: 6 });
    expect(bundle.landscape.filter((l) => l.capType === "V1").every((l) => l.geometry.type === "Point")).toBe(true);
    const hedge = bundle.landscape.find((l) => l.capType === "V4")!;
    expect(hedge.widthM).toBeGreaterThan(0);
    expect(hedge.areaM2).toBeGreaterThan(0);
    expect(SNA_TYPES.V4!.kind).toBe("hedge");
    // A1 n'a pas de correspondance : « autre élément », signalé.
    expect(bundle.landscape.find((l) => l.capType === "A1")?.attrs.kind).toBe("other");
    expect(bundle.warnings.some((w) => /A1/.test(w.message))).toBe(true);
  });

  it("effectifs animaux : mentionnés, non importés", () => {
    expect(bundle.notImported).toEqual([{ kind: "animals", label: "Animaux déclarés (AV)", count: 1000 }]);
  });

  it("encodage déclaré (ISO-8859-1 ou UTF-8) ; XML illisible refusé", () => {
    expect(decodeXml(new Uint8Array(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>é</a>', "latin1")))).toContain("é");
    expect(decodeXml(new Uint8Array(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><a>é</a>', "utf8")))).toContain("é");
    expect(() => readTelepac(new Uint8Array(Buffer.from("<producteurs><producteur>")), "x.xml")).toThrow(ImportFileError);
    expect(() => readTelepac(new Uint8Array(Buffer.from("<producteurs/>")), "x.xml")).toThrow(/producteur/);
  });
});
