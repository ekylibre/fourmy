import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

/**
 * Lecture d'une archive zip **sur disque**, sans la charger en mémoire : une
 * sauvegarde de tenant Ekylibre fait jusqu'à 2 Go (dump SQL de plusieurs
 * centaines de Mo). Répertoire central lu à la fin du fichier, une entrée lue
 * en flux (stockée ou « deflate »). Zip64 non pris en charge (archives de
 * moins de 4 Go, constaté sur les sauvegardes Ekylibre).
 */

export interface ZipFileEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export class ZipFileError extends Error {}

export async function zipFileEntries(path: string): Promise<ZipFileEntry[]> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new ZipFileError("archive zip illisible (fin d'archive introuvable).");
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipFileError("archive zip64 non prise en charge.");
    if (cdOffset + cdSize > size) throw new ZipFileError("archive zip tronquée.");
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries: ZipFileEntry[] = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(at) !== 0x02014b50) throw new ZipFileError("répertoire de l'archive illisible.");
      const nameLen = cd.readUInt16LE(at + 28);
      const extraLen = cd.readUInt16LE(at + 30);
      const commentLen = cd.readUInt16LE(at + 32);
      entries.push({
        name: cd.toString("utf8", at + 46, at + 46 + nameLen),
        method: cd.readUInt16LE(at + 10),
        compressedSize: cd.readUInt32LE(at + 20),
        size: cd.readUInt32LE(at + 24),
        localHeaderOffset: cd.readUInt32LE(at + 42),
      });
      at += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** Contenu d'une entrée, en flux (décompressé). */
export async function zipEntryStream(path: string, entry: ZipFileEntry): Promise<Readable> {
  if (entry.method !== 0 && entry.method !== 8) throw new ZipFileError(`méthode de compression ${entry.method} non prise en charge.`);
  const fh = await open(path, "r");
  const header = Buffer.alloc(30);
  try {
    await fh.read(header, 0, 30, entry.localHeaderOffset);
  } finally {
    await fh.close();
  }
  if (header.readUInt32LE(0) !== 0x04034b50) throw new ZipFileError("entrée de l'archive illisible.");
  const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (entry.compressedSize === 0) return createReadStream(path, { start, end: start - 1 });
  const raw = createReadStream(path, { start, end: start + entry.compressedSize - 1, highWaterMark: 1 << 20 });
  return entry.method === 0 ? raw : raw.pipe(createInflateRaw());
}

/** Petite entrée lue entièrement (manifeste). */
export async function zipEntryText(path: string, entry: ZipFileEntry, maxBytes = 1 << 20): Promise<string> {
  if (entry.size > maxBytes) throw new ZipFileError(`${entry.name} trop volumineux.`);
  const chunks: Buffer[] = [];
  for await (const c of await zipEntryStream(path, entry)) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
