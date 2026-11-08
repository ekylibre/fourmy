import { describe, it, expect } from "vitest";
import { tileBounds, samplingBbox, intersects, expand, decodeBil, elevationUrl, fetchHeightmap, parseBuildings, buildingsUrl, Lru } from "../src/index.js";

describe("tuiles géographiques (schéma Cesium)", () => {
  it("niveau 0 : deux tuiles de 180°, y depuis le nord", () => {
    expect(tileBounds(0, 0, 0)).toEqual({ west: -180, south: -90, east: 0, north: 90 });
    expect(tileBounds(0, 1, 0)).toEqual({ west: 0, south: -90, east: 180, north: 90 });
  });
  it("niveau 15 : contient la ferme de Frédéric", () => {
    const size = 180 / 2 ** 15;
    const x = Math.floor((-0.0728 + 180) / size);
    const y = Math.floor((90 - 44.626) / size);
    const b = tileBounds(15, x, y);
    expect(b.west).toBeLessThanOrEqual(-0.0728);
    expect(b.east).toBeGreaterThan(-0.0728);
    expect(b.north).toBeGreaterThanOrEqual(44.626);
    expect(b.south).toBeLessThan(44.626);
  });
  it("refuse les tuiles hors schéma", () => {
    expect(() => tileBounds(1, 4, 0)).toThrow(RangeError);
    expect(() => tileBounds(-1, 0, 0)).toThrow(RangeError);
  });
  it("élargit la BBOX d'un demi-pas pour échantillonner sur les bords", () => {
    const s = samplingBbox({ west: 0, south: 0, east: 64, north: 64 }, 65);
    expect(s).toEqual({ west: -0.5, south: -0.5, east: 64.5, north: 64.5 });
  });
  it("intersection et marge", () => {
    const farm = { west: -0.077, south: 44.623, east: -0.073, north: 44.628 };
    expect(intersects(expand(farm, 1000), { west: -0.08, south: 44.62, east: -0.06, north: 44.63 })).toBe(true);
    expect(intersects(farm, { west: 1, south: 44, east: 2, north: 45 })).toBe(false);
  });
});

describe("relief IGN", () => {
  it("URL WMS-R : axes latitude, longitude, grille BIL float32", () => {
    const url = new URL(elevationUrl({ west: 0, south: 44, east: 1, north: 45 }, 3));
    expect(url.searchParams.get("CRS")).toBe("EPSG:4326");
    expect(url.searchParams.get("BBOX")).toBe("43.75,-0.25,45.25,1.25");
    expect(url.searchParams.get("FORMAT")).toBe("image/x-bil;bits=32");
  });
  it("décode le BIL little-endian et ramène « pas de donnée » à 0", () => {
    const buf = new ArrayBuffer(4 * 4);
    const v = new DataView(buf);
    [12.5, -99999, 30, Number.NaN].forEach((x, i) => v.setFloat32(i * 4, x, true));
    expect([...decodeBil(buf, 2)]).toEqual([12.5, 0, 30, 0]);
    // Marqueur mélangé par le rééchantillonnage IGN (côte varoise, niveau 11).
    [-976.55, -7, 1, 2].forEach((x, i) => v.setFloat32(i * 4, x, true));
    expect([...decodeBil(buf, 2)]).toEqual([0, -7, 1, 2]);
    expect(() => decodeBil(new ArrayBuffer(12), 2)).toThrow(/inattendue/);
  });
  it("refuse une réponse qui n'est pas une grille (page d'erreur XML)", async () => {
    const fake = (async () => new Response("<ServiceException/>", { headers: { "content-type": "text/xml" } })) as typeof fetch;
    await expect(fetchHeightmap({ west: 0, south: 44, east: 1, north: 45 }, 2, fake)).rejects.toThrow(/indisponible/);
  });
});

describe("BD TOPO", () => {
  it("URL WFS : couche bâtiments, axes latitude, longitude", () => {
    const url = new URL(buildingsUrl({ west: -0.07, south: 44.62, east: -0.06, north: 44.63 }));
    expect(url.searchParams.get("TYPENAMES")).toBe("BDTOPO_V3:batiment");
    expect(url.searchParams.get("BBOX")).toBe("44.62,-0.07,44.63,-0.06,urn:ogc:def:crs:EPSG::4326");
  });
  it("lit hauteur, altitude au sol et RNB ; écarte les géométries non surfaciques", () => {
    const out = parseBuildings({
      features: [
        { geometry: { type: "MultiPolygon", coordinates: [] }, properties: { cleabs: "BATI1", hauteur: 6.5, altitude_minimale_sol: 28.1, identifiants_rnb: "RNB1" } },
        { geometry: { type: "Polygon", coordinates: [] }, properties: { cleabs: "BATI2", hauteur: null } },
        { geometry: null, properties: {} },
      ],
    });
    expect(out).toEqual([
      { id: "BATI1", geometry: { type: "MultiPolygon", coordinates: [] }, heightM: 6.5, groundAltitudeM: 28.1, rnbIds: "RNB1" },
      { id: "BATI2", geometry: { type: "Polygon", coordinates: [] }, heightM: null, groundAltitudeM: null, rnbIds: null },
    ]);
  });
});

describe("cache LRU", () => {
  it("évince le moins récemment utilisé", () => {
    const c = new Lru<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.size).toBe(2);
  });
});

import { ancestor, resampleChild, childFromAncestor } from "../src/index.js";

describe("tuiles fines interpolées depuis un ancêtre", () => {
  it("ancêtre d'une tuile", () => {
    expect(ancestor(18, 262038, 66079, 16)).toEqual({ z: 16, x: 65509, y: 16519 });
    expect(ancestor(15, 3, 4, 16)).toEqual({ z: 15, x: 3, y: 4 });
  });

  it("restitue exactement un plan incliné (l'interpolation bilinéaire est exacte sur un plan)", () => {
    const size = 5;
    const pb = { west: 0, south: 0, east: 4, north: 4 };
    const plane = (lon: number, lat: number) => 10 + 2 * lon + 3 * lat;
    const parent = new Float32Array(size * size);
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) parent[i * size + j] = plane(j, 4 - i);
    const child = { west: 1, south: 1, east: 3, north: 3 };
    const out = resampleChild(parent, pb, child, size);
    for (let i = 0; i < size; i++)
      for (let j = 0; j < size; j++) expect(out[i * size + j]).toBeCloseTo(plane(1 + j * 0.5, 3 - i * 0.5), 4);
  });

  it("une tuile fille couvre un quart de son parent et en reprend les coins", () => {
    const size = 65;
    const parent = Float32Array.from({ length: size * size }, (_, k) => k);
    const child = childFromAncestor(parent, { z: 16, x: 10, y: 10 }, 17, 20, 20, size);
    expect(child[0]).toBe(parent[0]); // coin nord-ouest commun
    expect(child[size * size - 1]).toBeCloseTo(parent[32 * size + 32]!, 3); // milieu du parent
  });
});

describe("eau de la BD TOPO", () => {
  it("lit tronçons et surfaces : nature, nom, permanence, fossé ; écarte le fictif", async () => {
    const { parseWater, waterUrl } = await import("../src/index.js");
    const items = parseWater(
      {
        features: [
          { geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { cleabs: "T1", nature: "Ecoulement naturel", persistance: "Permanent", fosse: false, cpx_toponyme_de_cours_d_eau: "Ruisseau Labésiau" } },
          { geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] }, properties: { cleabs: "T2", nature: "Ecoulement canalisé", persistance: "Intermittent", fosse: true } },
          { geometry: { type: "LineString", coordinates: [[0, 0], [0, 1]] }, properties: { cleabs: "T3", fictif: true } },
        ],
      },
      "line",
    );
    expect(items).toEqual([
      expect.objectContaining({ id: "T1", kind: "line", name: "Ruisseau Labésiau", permanent: true, ditch: false }),
      expect.objectContaining({ id: "T2", permanent: false, ditch: true, name: null }),
    ]);
    expect(waterUrl("BDTOPO_V3:troncon_hydrographique", { west: -0.2, south: 43.3, east: -0.1, north: 43.4 }, 1000)).toContain("STARTINDEX=1000");
  });
});
