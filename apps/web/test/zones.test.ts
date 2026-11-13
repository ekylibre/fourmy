import type { MultiPolygon, Polygon } from "geojson";
import { areaM2 } from "@fourmy/carto";
import { parcelsInBox, treatedAreaM2, zonesFor, type ParcelShape } from "../src/features/interventions/zones";

const square = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});
const multi = (p: Polygon): MultiPolygon => ({ type: "MultiPolygon", coordinates: [p.coordinates] });
// Deux parcelles voisines (est / ouest), en multipolygones comme en base.
const west: ParcelShape = { id: "w", shape: multi(square(0.5, 44.8, 0.501, 44.801)), areaM2: areaM2(square(0.5, 44.8, 0.501, 44.801)) };
const east: ParcelShape = { id: "e", shape: multi(square(0.501, 44.8, 0.502, 44.801)), areaM2: areaM2(square(0.501, 44.8, 0.502, 44.801)) };
const far: ParcelShape = { id: "f", shape: multi(square(0.51, 44.8, 0.511, 44.801)), areaM2: 1 };

describe("zones de travail partielles", () => {
  it("une zone à cheval sur deux parcelles est découpée sur chacune, sans déborder", () => {
    const drawn = square(0.5005, 44.8002, 0.5015, 44.8004);
    const zones = zonesFor(drawn, [west, east, far]);
    expect(zones.map((z) => z.parcelId)).toEqual(["w", "e"]);
    const total = zones.reduce((t, z) => t + z.areaM2, 0);
    expect(total).toBeCloseTo(areaM2(drawn), 0);
    for (const z of zones) expect(z.areaM2).toBeLessThan(west.areaM2);
  });

  it("une zone qui couvre toute la parcelle donne la parcelle entière", () => {
    const zones = zonesFor(square(0.4995, 44.7995, 0.5012, 44.8015), [west]);
    expect(zones[0]!.areaM2).toBeCloseTo(west.areaM2, 0);
  });

  it("une zone hors des parcelles ne touche rien", () => {
    expect(zonesFor(square(0.52, 44.8, 0.521, 44.801), [west, east])).toEqual([]);
  });

  it("Maj + glisser : les parcelles touchées par le rectangle, même partiellement", () => {
    const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    expect(parcelsInBox(box(0.4999, 44.7999, 0.5015, 44.8011), [west, east, far])).toEqual(["w", "e"]);
    expect(parcelsInBox(box(0.4999, 44.7999, 0.512, 44.8011), [west, east, far])).toEqual(["w", "e", "f"]);
    expect(parcelsInBox(box(0.52, 44.8, 0.521, 44.801), [west, east, far])).toEqual([]);
  });

  it("surface traitée : la zone quand elle existe, sinon la parcelle", () => {
    const parcels = new Map([west, east].map((p) => [p.id, p]));
    expect(treatedAreaM2(["w", "e"], parcels, new Map())).toBeCloseTo(west.areaM2 + east.areaM2, 6);
    expect(treatedAreaM2(["w", "e"], parcels, new Map([["w", { workedAreaM2: 1000 }]]))).toBeCloseTo(1000 + east.areaM2, 6);
  });
});
