/**
 * Lecture minimale d'un classeur xlsx pour les scripts d'extraction des
 * référentiels (archive zip de XML) : onglets, cellules (valeur brute ou
 * texte partagé), sans dépendance. Formules : seule la valeur calculée
 * enregistrée est lue.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("archive xlsx illisible");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, () => (method === 0 ? raw : inflateRawSync(raw)).toString("utf8"));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** Colonne « AB12 » → index 0-based de la colonne. */
export const colIndex = (ref) => {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Classeur : { sheets: [{ name, rows: Map<rowNumber, Map<colIndex, value>> }] }. */
export function readXlsx(path) {
  const files = unzip(readFileSync(path));
  const shared = [];
  if (files.has("xl/sharedStrings.xml")) {
    for (const si of files.get("xl/sharedStrings.xml")().matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(unescape([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
    }
  }
  const wb = files.get("xl/workbook.xml")();
  const rels = files.get("xl/_rels/workbook.xml.rels")();
  const target = new Map([...rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => {
    const file = `xl/${target.get(m[2]).replace(/^\/?xl\//, "")}`;
    const xml = files.get(file)();
    const rows = new Map();
    for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, row, attrs, inner = ""] = c;
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value;
      if (t === "s") value = shared[Number(v)];
      else if (t === "inlineStr") value = unescape([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (t === "str" || t === "e") value = v === undefined ? undefined : unescape(v);
      else if (t === "b") value = v === "1";
      else value = v === undefined ? undefined : Number(v);
      if (value === undefined || value === "") continue;
      const r = Number(row);
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r).set(colIndex(col), value);
    }
    return { name: unescape(m[1]), rows };
  });
  return { sheets };
}

/** Date série Excel → AAAA-MM-JJ. */
export const excelDate = (n) => (typeof n === "number" ? new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10) : null);
