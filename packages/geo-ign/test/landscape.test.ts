import { describe, expect, it } from "vitest";
import { landscapeUrl, parseLandscape, voltageKv } from "../src/index.js";

describe("paysage BD TOPO (WFS)", () => {
  it("requête WFS par type, emprise en latitude puis longitude", () => {
    const url = new URL(landscapeUrl("pylon", { west: -0.24, south: 43.36, east: -0.15, north: 43.42 }, 500, 500));
    expect(url.searchParams.get("TYPENAMES")).toBe("BDTOPO_V3:pylone");
    expect(url.searchParams.get("BBOX")).toBe("43.36,-0.24,43.42,-0.15,urn:ogc:def:crs:EPSG::4326");
    expect(url.searchParams.get("STARTINDEX")).toBe("500");
  });

  it("garde les champs utiles, retire l'altitude et les objets hors service", () => {
    const lines = parseLandscape("power_line", {
      features: [
        { geometry: { type: "LineString", coordinates: [[-0.20049621, 43.09914726, 497.9], [-0.2049, 43.1004, 455.4]] }, properties: { cleabs: "L1", voltage: "225 kV", etat_de_l_objet: "En service" } },
        { geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { cleabs: "L2", voltage: "63 kV", etat_de_l_objet: "En projet" } },
      ],
    });
    expect(lines).toEqual([{ id: "L1", kind: "power_line", voltageKv: 225, geometry: { type: "LineString", coordinates: [[-0.2004962, 43.0991473], [-0.2049, 43.1004]] } }]);
    const [pylon] = parseLandscape("pylon", { features: [{ geometry: { type: "Point", coordinates: [-0.2, 43.4, 300] }, properties: { cleabs: "P1", hauteur: 51.1 } }] });
    expect(pylon).toMatchObject({ id: "P1", heightM: 51.1, geometry: { coordinates: [-0.2, 43.4] } });
    expect(parseLandscape("vegetation", { features: [{ geometry: { type: "Polygon", coordinates: [] }, properties: { cleabs: "V", nature: "Bois" } }] })[0]?.nature).toBe("Bois");
    expect(voltageKv("400 kV")).toBe(400);
    expect(voltageKv(null)).toBeUndefined();
  });
});
