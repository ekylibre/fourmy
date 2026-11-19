import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zip } from "@fourmy/isoxml";
import { analyzeFile, detectFormat, ImportFileError, MAX_FILE_BYTES } from "../src/index.js";

const bytes = (text: string, encoding: BufferEncoding = "latin1") => new Uint8Array(Buffer.from(text, encoding));

const daplos = [
  "EI400000000000035  999999999999999  1   ",
  "DE                                    2026111800630.95",
  "DATF 40000000000003   107GAEC TEST",
].join("\r\n");

const telepac = `<?xml version="1.0" encoding="ISO-8859-1"?>
<producteurs xmlns="urn:x-telepac:fr.gouv.agriculture.telepac:echange-producteur" xmlns:gml="http://www.opengis.net/gml">
<producteur numero-pacage="044000000"></producteur></producteurs>`;

/** Rejette avec une ImportFileError du code donné. */
function failsWith(fn: () => unknown, code: ImportFileError["code"]) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ImportFileError);
    expect((e as ImportFileError).code).toBe(code);
    return e as ImportFileError;
  }
  throw new Error("aucune erreur levée");
}

describe("reconnaissance du format", () => {
  it("Geofolia : archive zip avec Field.Json et Action.Json, à la racine ou dans un dossier", () => {
    expect(detectFormat("export.zip", zip({ "Field.Json": "{}", "Action.Json": "{}", "IdentificationCodes.json": "[]" }))).toBe("geofolia");
    expect(detectFormat("x.zip", zip({ "export/field.json": "{}", "export/ACTION.JSON": "{}" }))).toBe("geofolia");
  });

  it("TelePAC : XML de racine producteurs, avec ou sans préfixe, encodé en Latin-1 ou UTF-8", () => {
    expect(detectFormat("dossier.xml", bytes(telepac))).toBe("telepac");
    expect(detectFormat("dossier.xml", bytes("\uFEFF" + telepac.replace(/producteurs/g, "tp:producteurs"), "utf8"))).toBe("telepac");
  });

  it("DAPLOS : première ligne EI + SIRET, quelle que soit l'extension", () => {
    expect(detectFormat("40000000000003.dap", bytes(daplos))).toBe("daplos");
    expect(detectFormat("EARL TEST_2023.edi", bytes("EI430406918000285  430406918000285  0001\r\nDE"))).toBe("daplos");
  });

  it("refuse un format inconnu en disant ce qui est attendu", () => {
    const e = failsWith(() => detectFormat("notes.txt", bytes("bonjour")), "unsupported_format");
    expect(e.message).toMatch(/DAPLOS.*Geofolia.*TelePAC/);
    failsWith(() => detectFormat("autre.zip", zip({ "TASKDATA.XML": "<ISO11783_TaskData/>" })), "unsupported_format");
    failsWith(() => detectFormat("autre.xml", bytes("<?xml version='1.0'?><ISO11783_TaskData/>")), "unsupported_format");
  });

  it("refuse un fichier vide, trop gros ou une archive illisible", () => {
    failsWith(() => detectFormat("vide.dap", new Uint8Array()), "corrupt_file");
    failsWith(() => detectFormat("gros.dap", new Uint8Array(MAX_FILE_BYTES + 1)), "too_large");
    failsWith(() => detectFormat("casse.zip", bytes("PK\u0003\u0004 pas une archive")), "corrupt_file");
  });

  it("un DAPLOS sans culture est reconnu puis refusé comme illisible", () => {
    failsWith(() => analyzeFile("x.dap", bytes(daplos)), "corrupt_file");
  });
});

/**
 * Fichiers réels (jamais dans le dépôt) : FOURMY_IMPORT_SAMPLES désigne un
 * dossier local qui les contient.
 */
const samples = process.env.FOURMY_IMPORT_SAMPLES;
describe.skipIf(!samples || !existsSync(samples))("fichiers réels", () => {
  it("reconnaît chaque fichier du dossier", () => {
    const formats = readdirSync(samples!)
      .filter((f) => /\.(dap|edi|zip|xml)$/i.test(f))
      .map((f) => detectFormat(f, new Uint8Array(readFileSync(join(samples!, f)))));
    expect(formats.length).toBeGreaterThan(0);
    expect(new Set(formats).size).toBeGreaterThan(0);
  });
});
