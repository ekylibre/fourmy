import { IMPORT_FORMAT_LABELS } from "@fourmy/contracts";
import { detectFormat } from "./detect.js";
import { ImportFileError } from "./errors.js";
import type { ImportBundle, ImportFormat } from "./model.js";

/**
 * Un lecteur transforme les octets d'un fichier en `ImportBundle`, sans
 * accès à la base ni au réseau. Les lecteurs arrivent lot par lot (IM2
 * Geofolia, IM3 TelePAC, IM4 DAPLOS) ; tant qu'un format n'a pas le sien, le
 * fichier est reconnu mais ne peut pas être importé.
 */
export type Reader = (bytes: Uint8Array, name: string) => ImportBundle;

const READERS: Partial<Record<ImportFormat, Reader>> = {};

/**
 * Enregistre le lecteur d'un format (appelé par chaque module de lecteur) ;
 * renvoie de quoi rétablir le lecteur précédent (tests).
 */
export function registerReader(format: ImportFormat, reader: Reader): () => void {
  const previous = READERS[format];
  READERS[format] = reader;
  return () => {
    if (previous) READERS[format] = previous;
    else delete READERS[format];
  };
}

export function hasReader(format: ImportFormat): boolean {
  return READERS[format] !== undefined;
}

export interface FileAnalysis {
  format: ImportFormat;
  /** `null` tant que le format n'a pas de lecteur. */
  bundle: ImportBundle | null;
}

/** Reconnaît le format puis lit le fichier si un lecteur existe. */
export function analyzeFile(name: string, bytes: Uint8Array): FileAnalysis {
  const format = detectFormat(name, bytes);
  const reader = READERS[format];
  if (!reader) return { format, bundle: null };
  try {
    return { format, bundle: reader(bytes, name) };
  } catch (e) {
    if (e instanceof ImportFileError) throw e;
    throw new ImportFileError(
      `Fichier « ${name} » (${IMPORT_FORMAT_LABELS[format]}) illisible : ${e instanceof Error ? e.message : String(e)}`,
      "corrupt_file",
    );
  }
}
