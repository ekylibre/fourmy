import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { RATE_DDI, crc32, shapefile, signedArea, taskData, zip } from "../src/index.js";

/** Lecture d'une archive zip produite par `zip` (sans répertoire central). */
function unzip(bytes: Uint8Array): Record<string, Buffer> {
  const buf = Buffer.from(bytes);
  const out: Record<string, Buffer> = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const data = inflateRawSync(buf.subarray(at + 30 + nameLength, at + 30 + nameLength + size));
    expect(crc32(data)).toBe(buf.readUInt32LE(at + 14));
    out[name] = data;
    at += 30 + nameLength + size;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
  return out;
}

// Carré de 100 m environ, avec un trou (données synthétiques).
const square = [[[0, 45], [0.00127, 45], [0.00127, 45.0009], [0, 45.0009], [0, 45]]];
const withHole = [[...square, [[0.0004, 45.0003], [0.0004, 45.0006], [0.0008, 45.0006], [0.0008, 45.0003], [0.0004, 45.0003]]]];

describe("zip", () => {
  it("relit les fichiers avec leur CRC", () => {
    const files = unzip(zip({ "a.txt": "été", "dir/b.bin": new Uint8Array([1, 2, 3]) }));
    expect(files["a.txt"]!.toString("utf8")).toBe("été");
    expect([...files["dir/b.bin"]!]).toEqual([1, 2, 3]);
  });
});

describe("shapefile", () => {
  it("écrit des polygones orientés, un index et une table d'attributs", () => {
    const files = shapefile("zones", [{ name: "ZONE", type: "N", length: 3 }, { name: "DOSE", type: "N", length: 10, decimals: 1 }, { name: "PRODUIT", type: "C", length: 12 }], [
      { geometry: withHole, attributes: { ZONE: 1, DOSE: 120.5, PRODUIT: "Ammonitrate" } },
      { geometry: [square], attributes: { ZONE: 2, DOSE: 80, PRODUIT: "Azote liquide très long" } },
    ]);
    const shp = Buffer.from(files["zones.shp"] as Uint8Array);
    expect(shp.readInt32BE(0)).toBe(9994);
    expect(shp.readInt32BE(24) * 2).toBe(shp.length);
    expect(shp.readInt32LE(32)).toBe(5);
    // Premier enregistrement : 2 anneaux, extérieur horaire, trou trigonométrique.
    const parts = shp.readInt32LE(100 + 8 + 36);
    const count = shp.readInt32LE(100 + 8 + 40);
    expect(parts).toBe(2);
    const pts: [number, number][] = [];
    for (let i = 0; i < count; i++) pts.push([shp.readDoubleLE(100 + 8 + 44 + 8 + i * 16), shp.readDoubleLE(100 + 8 + 44 + 8 + i * 16 + 8)]);
    expect(signedArea(pts.slice(0, 5))).toBeLessThan(0);
    expect(signedArea(pts.slice(5))).toBeGreaterThan(0);

    const shx = Buffer.from(files["zones.shx"] as Uint8Array);
    expect(shx.length).toBe(100 + 16);
    expect(shx.readInt32BE(100) * 2).toBe(100);

    const dbf = Buffer.from(files["zones.dbf"] as Uint8Array);
    expect(dbf.readUInt32LE(4)).toBe(2);
    const headerLength = dbf.readUInt16LE(8);
    const recordLength = dbf.readUInt16LE(10);
    expect(recordLength).toBe(1 + 3 + 10 + 12);
    const first = dbf.subarray(headerLength, headerLength + recordLength).toString("utf8");
    expect(first).toBe("   1     120.5Ammonitrate ");
    const second = dbf.subarray(headerLength + recordLength, headerLength + 2 * recordLength).toString("utf8");
    expect(second.slice(14)).toBe("Azote liquid");
    expect(files["zones.prj"]).toContain("WGS_1984");
  });
});

describe("taskData", () => {
  const input = {
    software: { manufacturer: "Fourmy", version: "test" },
    customer: "Ferme d'essai & fils",
    farm: "Ferme d'essai",
    partfield: { name: "Le Grand Champ", areaM2: 10_000, boundary: withHole },
    task: "Azote zone",
    product: "Ammonitrate 33,5",
    unit: "kg_ha" as const,
    zones: [
      { code: 1, name: "Zone 1", rate: 150 },
      { code: 2, name: "Zone 2", rate: 120 },
    ],
    defaultRate: 135,
    grid: { minLat: 45, minLon: 0, cellLat: 0.0002, cellLon: 0.0003, columns: 3, rows: 2, cells: new Uint8Array([0, 1, 2, 1, 2, 0]) },
  };

  it("décrit la tâche, les zones et la grille de type 1", () => {
    const files = taskData(input);
    const xml = files["TASKDATA/TASKDATA.XML"];
    expect(xml).toContain('VersionMajor="4" VersionMinor="2"');
    expect(xml).toContain('<CTR A="CTR1" B="Ferme d&apos;essai &amp; fils"/>'.replace("&apos;", "'"));
    expect(xml).toContain('<TSK A="TSK1" B="Azote zone" C="CTR1" D="FRM1" E="PFD1" G="1" H="3" I="3" J="0">');
    expect(xml).toContain('<TZN A="1" B="Zone 1"><PDV A="0006" B="15000" C="PDT1" E="VPN1"/></TZN>');
    expect(xml).toContain('<TZN A="0" B="Hors parcelle"><PDV A="0006" B="0"');
    expect(xml).toContain('<TZN A="3" B="Dose par défaut"><PDV A="0006" B="13500"');
    expect(xml).toContain('E="3" F="2" G="GRD00001" H="6" I="1"');
    // Contour : un PLN, anneau extérieur puis trou, sans point de fermeture répété.
    expect(xml.match(/<LSG A="1">/g)).toHaveLength(1);
    expect(xml.match(/<LSG A="2">/g)).toHaveLength(1);
    expect(xml.match(/<PNT /g)).toHaveLength(8);
    expect(xml).toContain('<PNT A="2" C="45.000000000" D="0.000000000"/>');
    expect([...files["TASKDATA/GRD00001.bin"]]).toEqual([0, 1, 2, 1, 2, 0]);
  });

  it("convertit les doses dans l'unité du DDI", () => {
    expect(Math.round(30 * RATE_DDI.l_ha.factor)).toBe(300_000); // 30 L/ha = 3 000 mm³/m² au pas de 0,01
    expect(Math.round(90_000 * RATE_DDI.seeds_ha.factor)).toBe(9_000); // 9 grains/m² au pas de 0,001
    const xml = taskData({ ...input, unit: "seeds_ha", zones: [{ code: 1, name: "Z1", rate: 90_000 }], defaultRate: 90_000 })["TASKDATA/TASKDATA.XML"];
    expect(xml).toContain('<PDV A="000B" B="9000"');
    expect(xml).toContain('<VPN A="VPN1" B="0" C="10" D="0" E="grains/ha"/>');
  });
});
