import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { unzip, zip, zipEntries } from "../src/index.js";

/** Réécrit un entier 32 bits de l'archive (en-tête local et répertoire central). */
function patch32(bytes: Uint8Array, signature: number, offset: number, value: number): Uint8Array {
  const buf = Buffer.from(bytes);
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === signature) buf.writeUInt32LE(value >>> 0, i + offset);
  }
  return new Uint8Array(buf);
}

/** Archive d'une seule entrée au nom quelconque (le zip() de production les accepte tous). */
const single = (name: string, content: string | Uint8Array) => zip({ [name]: content });

describe("unzip : limites et contrôles", () => {
  it("lit une archive normale et liste ses entrées sans décompresser", () => {
    const archive = zip({ "Field.Json": "{}", "Action.Json": "[]" });
    expect(zipEntries(archive).map((e) => e.name)).toEqual(["Field.Json", "Action.Json"]);
    const files = unzip(archive);
    expect(Buffer.from(files.get("Field.Json")!).toString()).toBe("{}");
  });

  it("ne décompresse que les entrées demandées", () => {
    const files = unzip(zip({ "a.txt": "a", "b.txt": "b" }), { only: (n) => n === "b.txt" });
    expect([...files.keys()]).toEqual(["b.txt"]);
  });

  it("refuse les chemins qui sortent de l'archive", () => {
    for (const name of ["../evil.txt", "a/../../evil.txt", "/etc/passwd", "C:/evil.txt", "\\\\server\\x"]) {
      expect(() => unzip(single(name, "x")), name).toThrow(/chemin refusé/);
    }
  });

  it("refuse une bombe de décompression (taux suspect)", () => {
    const bomb = single("Field.Json", new Uint8Array(5_000_000));
    expect(() => unzip(bomb, { maxRatio: 100 })).toThrow(/taux de compression suspect/);
  });

  it("refuse une entrée ou un total trop volumineux une fois décompressé", () => {
    const archive = zip({ "a.bin": new Uint8Array(1000), "b.bin": new Uint8Array(1000) });
    expect(() => unzip(archive, { maxEntryBytes: 999 })).toThrow(/taille autorisée/);
    expect(() => unzip(archive, { maxTotalBytes: 1500, maxRatio: 1e9 })).toThrow(/trop volumineux/);
  });

  it("ne croit pas une taille annoncée trop petite", () => {
    // 1 Mo réel annoncé comme 10 octets : la sortie est bornée, l'entrée refusée.
    const archive = single("x.bin", new Uint8Array(1_000_000));
    const lying = patch32(patch32(archive, 0x02014b50, 24, 10), 0x04034b50, 22, 10);
    expect(() => unzip(lying, { maxRatio: 1e9 })).toThrow(/taille annoncée|corrompu/);
  });

  it("refuse une somme de contrôle fausse", () => {
    const archive = single("x.txt", "contenu");
    const bad = patch32(patch32(archive, 0x02014b50, 16, 0x12345678), 0x04034b50, 14, 0x12345678);
    expect(() => unzip(bad)).toThrow(/corrompu/);
  });

  it("refuse une entrée chiffrée", () => {
    const archive = Buffer.from(single("x.txt", "secret"));
    for (let i = 0; i + 4 <= archive.length; i++) {
      if (archive.readUInt32LE(i) === 0x02014b50) archive.writeUInt16LE(archive.readUInt16LE(i + 8) | 1, i + 8);
    }
    expect(() => unzip(new Uint8Array(archive))).toThrow(/chiffrée/);
  });

  it("refuse une archive tronquée", () => {
    const archive = single("x.txt", deflateRawSync(Buffer.alloc(10_000, 7)));
    const entries = zipEntries(archive);
    expect(entries).toHaveLength(1);
    // On coupe les données mais on garde le répertoire central : l'entrée déborde.
    const buf = Buffer.from(archive);
    const cut = Buffer.concat([buf.subarray(0, 40), Buffer.alloc(0)]);
    expect(() => unzip(new Uint8Array(cut))).toThrow(/illisible|tronquée/);
  });
});
