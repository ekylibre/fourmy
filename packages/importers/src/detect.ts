import { IsoxmlReadError, zipEntries } from "@fourmy/isoxml";
import { corruptFile, ImportFileError, unsupportedFormat } from "./errors.js";
import type { ImportFormat } from "./model.js";

/** Taille maximale d'un fichier déposé (le relais nginx accepte 50 Mo). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Entrées attendues d'un export Geofolia « Parcelles et Interventions complet ». */
export const GEOFOLIA_ENTRIES = ["Field.Json", "Action.Json", "IdentificationCodes.json"] as const;

/** Nom de fichier sans dossier, comparé sans tenir compte de la casse. */
const baseName = (path: string) => path.split(/[\\/]/).pop()!.toLowerCase();

/** Entrée Geofolia de ce nom dans l'archive (à la racine ou dans un dossier). */
export function geofoliaEntry(names: string[], wanted: (typeof GEOFOLIA_ENTRIES)[number]): string | undefined {
  return names.find((n) => baseName(n) === wanted.toLowerCase());
}

/** Marque d'ordre des octets en tête de fichier (UTF-8 lu en Latin-1, ou déjà décodée). */
const BOM = /^(?:\uFEFF|\u00EF\u00BB\u00BF)/;

/** Nom de l'élément racine d'un document XML (prologue, commentaires et DTD sautés). */
function xmlRoot(head: string): string | null {
  const text = head.replace(BOM, "").replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<![^>]*>/g, "");
  const m = text.match(/^\s*<([A-Za-z_][\w.:-]*)[\s/>]/);
  return m ? m[1]! : null;
}

/**
 * Format d'un fichier déposé, d'après son contenu (le nom ne sert qu'aux
 * messages) : archive zip avec `Field.Json` et `Action.Json` → Geofolia ;
 * XML de racine `producteurs` → TelePAC ; texte dont la première ligne est
 * un en-tête d'échange `EI` → DAPLOS. Sinon, refus explicite.
 */
export function detectFormat(name: string, bytes: Uint8Array): ImportFormat {
  if (bytes.length === 0) throw corruptFile(name, "le fichier est vide.");
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ImportFileError(`Fichier « ${name} » trop volumineux (50 Mo au plus).`, "too_large");
  }

  // Archive zip : signature « PK\x03\x04 » (ou archive vide « PK\x05\x06 »).
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let names: string[];
    try {
      names = zipEntries(bytes).map((e) => e.name);
    } catch (e) {
      throw corruptFile(name, e instanceof IsoxmlReadError ? e.message : "archive zip illisible.");
    }
    if (geofoliaEntry(names, "Field.Json") && geofoliaEntry(names, "Action.Json")) return "geofolia";
    throw unsupportedFormat(name);
  }

  // Début du fichier en Latin-1 : suffisant pour reconnaître XML et DAPLOS
  // (les deux sont en ISO-8859-1 / Windows-1252 dans les exports réels ; l'UTF-8 passe aussi).
  const head = Buffer.from(bytes.subarray(0, 4096)).toString("latin1");
  const root = xmlRoot(head);
  if (root) {
    if (root.split(":").pop() === "producteurs") return "telepac";
    throw unsupportedFormat(name);
  }
  const firstLine = head.replace(BOM, "").split(/\r?\n/, 1)[0] ?? "";
  // EI + SIRET de l'émetteur (14 chiffres, parfois moins dans les vieux exports).
  if (/^EI\d{9,14}/.test(firstLine)) return "daplos";
  throw unsupportedFormat(name);
}
