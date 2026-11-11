import { inflateSync } from "node:zlib";

/**
 * Décodeur PNG minimal pour les rasters d'indice (lot AD) : niveaux de gris
 * 8 bits (type de couleur 0) ou gris + alpha 8 bits (type 4), non entrelacé.
 * Renvoie le canal gris, une valeur par pixel, ligne par ligne depuis le nord.
 */
export function decodeGrayPng(bytes: Uint8Array): { width: number; height: number; gray: Uint8Array } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) throw new Error("PNG attendu.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = data[8];
      const color = data[9];
      const interlace = data[12];
      if (depth !== 8 || (color !== 0 && color !== 4) || interlace !== 0) {
        throw new Error(`PNG non pris en charge (profondeur ${depth}, couleur ${color}, entrelacement ${interlace}).`);
      }
      channels = color === 0 ? 1 : 2;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  if (!width || !height || !channels) throw new Error("PNG sans en-tête.");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("PNG tronqué.");
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels]! : 0;
      const b = prev ? prev[x]! : 0;
      const c = prev && x >= channels ? prev[x - channels]! : 0;
      let v = src[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`Filtre PNG inconnu (${filter}).`);
      row[x] = v & 0xff;
    }
  }
  if (channels === 1) return { width, height, gray: out };
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = out[i * 2]!;
  return { width, height, gray };
}
