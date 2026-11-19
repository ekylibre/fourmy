import { inflateRawSync } from "node:zlib";
import { crc32 } from "./zip.js";

/**
 * Lecture d'un TaskData ISO 11783-10 reçu d'une console (agrirouter, lot
 * AR4) : archive zip, TASKDATA.XML et ses fichiers externes (XFR), tâches,
 * parcelles, produits, matériels, valeurs totales et enregistrements de
 * travail binaires (TLG). Sans dépendance : un analyseur XML réduit suffit,
 * ISO-XML n'ayant que des éléments à attributs.
 */

// --- Archive zip -----------------------------------------------------------------

/** Entrée du répertoire central d'une archive zip. */
export interface ZipEntry {
  name: string;
  method: number;
  /** Taille compressée et taille annoncée une fois décompressée (octets). */
  compressedSize: number;
  size: number;
  crc: number;
  encrypted: boolean;
  /** Position de l'en-tête local. */
  local: number;
}

/**
 * Limites de décompression : une archive déposée par un utilisateur peut
 * être une « bombe » (quelques Ko qui en font des Go) ou mentir sur ses
 * tailles. Défauts larges (TaskData agrirouter) ; les imports de fichiers
 * passent des limites strictes (claudedocs/conception_import_onboarding.md §10).
 */
export interface UnzipOptions {
  /** Ne décompresser que ces entrées (les autres sont ignorées). */
  only?: (name: string) => boolean;
  /** Taille maximale d'une entrée décompressée. */
  maxEntryBytes?: number;
  /** Taille maximale de l'ensemble décompressé (entrées retenues). */
  maxTotalBytes?: number;
  /** Rapport maximal taille décompressée / compressée d'une entrée. */
  maxRatio?: number;
}

const UNZIP_DEFAULTS: Required<Omit<UnzipOptions, "only">> = {
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxRatio: 1_000,
};

/** Liste des entrées (répertoire central), sans rien décompresser. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 22) throw new IsoxmlReadError("Archive zip illisible (trop courte).");
  // Fin du répertoire central : cherchée depuis la fin (commentaire éventuel).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new IsoxmlReadError("Archive zip illisible (répertoire central absent).");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new IsoxmlReadError("Archive zip64 non prise en charge.");
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) {
      throw new IsoxmlReadError("Archive zip illisible (entrée du répertoire central).");
    }
    const flags = buf.readUInt16LE(at + 8);
    const compressedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new IsoxmlReadError("Archive zip64 non prise en charge.");
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    entries.push({
      name: buf.toString("utf8", at + 46, at + 46 + nameLength),
      method: buf.readUInt16LE(at + 10),
      compressedSize,
      size,
      crc: buf.readUInt32LE(at + 16),
      encrypted: (flags & 0x1) !== 0,
      local: buf.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Chemin sûr : relatif, sans remontée (`..`), sans lecteur ni racine. */
function safeName(name: string): boolean {
  if (!name || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) return false;
  return !name.split(/[\\/]/).some((part) => part === "..");
}

/** Fichiers d'une archive zip (stockés ou deflate), par chemin. */
export function unzip(bytes: Uint8Array, options: UnzipOptions = {}): Map<string, Uint8Array> {
  const { maxEntryBytes, maxTotalBytes, maxRatio } = { ...UNZIP_DEFAULTS, ...options };
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of zipEntries(bytes)) {
    const { name } = entry;
    if (name.endsWith("/")) continue;
    if (!safeName(name)) throw new IsoxmlReadError(`Archive zip : chemin refusé (${name}).`);
    if (options.only && !options.only(name)) continue;
    if (entry.encrypted) throw new IsoxmlReadError(`Archive zip : entrée chiffrée (${name}).`);
    if (entry.size > maxEntryBytes) throw new IsoxmlReadError(`Archive zip : ${name} dépasse la taille autorisée une fois décompressé.`);
    total += entry.size;
    if (total > maxTotalBytes) throw new IsoxmlReadError("Archive zip : contenu décompressé trop volumineux.");
    if (entry.compressedSize > 0 && entry.size / entry.compressedSize > maxRatio) {
      throw new IsoxmlReadError(`Archive zip : taux de compression suspect pour ${name}.`);
    }
    const local = entry.local;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) {
      throw new IsoxmlReadError(`Archive zip illisible (en-tête local de ${name}).`);
    }
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataAt + entry.compressedSize > buf.length) throw new IsoxmlReadError(`Archive zip tronquée (${name}).`);
    const raw = buf.subarray(dataAt, dataAt + entry.compressedSize);
    let data: Uint8Array;
    if (entry.method === 0) data = new Uint8Array(raw);
    else if (entry.method === 8) {
      try {
        // La taille annoncée borne la sortie : une archive qui ment ne dépasse pas la limite.
        data = new Uint8Array(inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) }));
      } catch {
        throw new IsoxmlReadError(`Archive zip : ${name} ne se décompresse pas à la taille annoncée.`);
      }
    } else throw new IsoxmlReadError(`Archive zip : méthode de compression ${entry.method} non prise en charge.`);
    if (data.length !== entry.size || crc32(data) !== entry.crc) {
      throw new IsoxmlReadError(`Archive zip : ${name} est corrompu (taille ou somme de contrôle).`);
    }
    files.set(name, data);
  }
  return files;
}

export class IsoxmlReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsoxmlReadError";
  }
}

// --- XML réduit -----------------------------------------------------------------

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Texte de l'élément (hors enfants), décodé et sans espaces de bord ; absent s'il n'y en a pas. */
  text?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()]!,
  );

/**
 * Éléments, attributs et texte d'un document XML (commentaires, instructions
 * et DTD ignorés : aucune entité externe n'est jamais résolue). Les noms
 * d'attributs peuvent être accentués (TelePAC).
 */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: "#document", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>"']+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
  const attr = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let last = 0;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    // Texte entre deux balises : rattaché à l'élément ouvert.
    const between = text.slice(last, m.index).trim();
    last = m.index + m[0].length;
    if (between && stack.length > 1) {
      const top = stack[stack.length - 1]!;
      top.text = (top.text ? `${top.text} ` : "") + decode(between);
    }
    if (!m[2]) continue; // commentaire, déclaration
    const [, closing, name, rawAttrs = "", selfClosing] = m;
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1]!.tag === name) stack.pop();
      else throw new IsoxmlReadError(`XML mal formé : </${name}> inattendu.`);
      continue;
    }
    const node: XmlNode = { tag: name!, attrs: {}, children: [] };
    for (let a = attr.exec(rawAttrs); a; a = attr.exec(rawAttrs)) node.attrs[a[1]!] = decode(a[2] ?? a[3] ?? "");
    attr.lastIndex = 0;
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length > 1) throw new IsoxmlReadError(`XML mal formé : <${stack[stack.length - 1]!.tag}> non fermé.`);
  return root;
}

const all = (n: XmlNode, tag: string): XmlNode[] => n.children.filter((c) => c.tag === tag);

// --- Enregistrements de travail (TLG) ------------------------------------------

export interface LogRecord {
  /** Heure de l'enregistrement, heure locale de la console (sans fuseau), `AAAA-MM-JJTHH:MM:SS.sss`. */
  time: string | null;
  lat: number | null;
  lon: number | null;
  /** État de la position (ISO 11783-10) : 1 GNSS, 2 DGNSS, 3 précis, 4 RTK fixe, 5 RTK flottant ; 0 ou 15 : pas de position. */
  status: number | null;
  /** Valeurs relevées, par DDI (entier) et élément de matériel : `"<ddi>@<DET>"`. */
  values: Record<string, number>;
}

const PTN_LAYOUT: [key: string, size: 1 | 2 | 4, signed: boolean][] = [
  ["A", 4, true], // nord, 1e-7 degré
  ["B", 4, true], // est, 1e-7 degré
  ["C", 4, true], // altitude, mm
  ["D", 1, false], // état de la position
  ["E", 2, false], // PDOP
  ["F", 2, false], // HDOP
  ["G", 1, false], // satellites
  ["H", 4, false], // heure GPS UTC (ms)
  ["I", 2, false], // date GPS (jours depuis 1980)
];

const EPOCH_1980 = Date.UTC(1980, 0, 1);
/** Heure locale (sans fuseau) d'après les ms depuis minuit et les jours depuis le 01/01/1980. */
const localStamp = (ms: number, days: number) => new Date(EPOCH_1980 + days * 86_400_000 + ms).toISOString().slice(0, 23);

/**
 * Enregistrements binaires d'un TLG d'après son en-tête XML : un attribut vide
 * dans l'en-tête veut dire « valeur dans chaque enregistrement », une valeur
 * renseignée est constante (ISO 11783-10, annexe sur les journaux).
 */
export function readTimeLog(header: XmlNode, bin: Uint8Array): LogRecord[] {
  const tim = header.tag === "TIM" ? header : header.children.find((c) => c.tag === "TIM");
  if (!tim) throw new IsoxmlReadError("En-tête de journal sans TIM.");
  const ptn = all(tim, "PTN")[0];
  const dlvs = all(tim, "DLV").map((d) => `${parseInt(d.attrs.A ?? "0", 16)}@${d.attrs.C ?? ""}`);
  const timeInRecord = tim.attrs.A === "";
  const buf = Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength);
  const records: LogRecord[] = [];
  let at = 0;
  const read = (size: 1 | 2 | 4, signed: boolean) => {
    if (at + size > buf.length) throw new RangeError("fin");
    const v = size === 1 ? buf.readUInt8(at) : size === 2 ? buf.readUInt16LE(at) : signed ? buf.readInt32LE(at) : buf.readUInt32LE(at);
    at += size;
    return v;
  };
  try {
    while (at < buf.length) {
      const start = at;
      let time: string | null = null;
      if (timeInRecord) {
        const ms = read(4, false);
        time = localStamp(ms, read(2, false));
      }
      const p: Record<string, number> = {};
      if (ptn) {
        for (const [key, size, signed] of PTN_LAYOUT) {
          if (!(key in ptn.attrs)) continue;
          if (ptn.attrs[key] === "") p[key] = read(size, signed);
          else p[key] = key === "A" || key === "B" ? Math.round(Number(ptn.attrs[key]) * 1e7) : Number(ptn.attrs[key]);
        }
      }
      const values: Record<string, number> = {};
      for (let n = read(1, false); n > 0; n--) {
        const index = read(1, false);
        const value = read(4, true);
        const key = dlvs[index];
        if (key !== undefined) values[key] = value;
      }
      if (at === start) break;
      records.push({
        time,
        lat: p.A !== undefined ? p.A / 1e7 : null,
        lon: p.B !== undefined ? p.B / 1e7 : null,
        status: p.D ?? null,
        values,
      });
    }
  } catch (e) {
    if (!(e instanceof RangeError)) throw e; // enregistrement tronqué en fin de fichier : ignoré
  }
  return records;
}

// --- Tâches ------------------------------------------------------------------------

export interface ReadTask {
  id: string;
  designator: string;
  /** TaskStatus : 1 prévue, 2 en cours, 3 en pause, 4 terminée, 5 modèle, 6 annulée. */
  status: number | null;
  /** Périodes (TIM) : heures telles qu'écrites (en général locales, sans fuseau) ; type 4 = travail effectif. */
  times: { start: string; stop: string | null; type: number | null }[];
  partfield: { id: string; name: string; areaM2: number | null; polygons: number[][][][] } | null;
  products: { id: string; name: string }[];
  devices: { id: string; designator: string; serial: string | null; elements: string[] }[];
  /** Valeurs totales de la tâche (DLV des TIM), par DDI. */
  totals: { ddi: number; value: number; element: string | null }[];
  log: LogRecord[];
}

export interface ReadTaskData {
  software: { manufacturer: string | null; version: string | null; taskController: string | null };
  tasks: ReadTask[];
  warnings: string[];
}

/** Polygones de limite (PLN de type 1) d'une parcelle, en [lon, lat]. */
function boundaries(pfd: XmlNode): number[][][][] {
  const polygons: number[][][][] = [];
  for (const pln of all(pfd, "PLN")) {
    if (pln.attrs.A !== "1") continue;
    const outer = all(pln, "LSG").filter((l) => l.attrs.A === "1");
    const inner = all(pln, "LSG").filter((l) => l.attrs.A === "2");
    const ring = (l: XmlNode) => all(l, "PNT").map((p) => [Number(p.attrs.D), Number(p.attrs.C)]);
    for (const o of outer) polygons.push([ring(o), ...inner.map(ring)]);
  }
  return polygons.filter((p) => p[0]!.length >= 3);
}

/**
 * Lit une archive TaskData : TASKDATA.XML (à la racine ou dans un dossier),
 * fichiers externes XFR, journaux TLG. Les chemins sont comparés sans tenir
 * compte de la casse (les consoles écrivent souvent en majuscules).
 */
export function readTaskData(archive: Uint8Array): ReadTaskData {
  const files = unzip(archive);
  const byName = new Map([...files].map(([k, v]) => [k.toUpperCase(), v]));
  const main = [...byName.keys()].find((k) => k === "TASKDATA.XML" || k.endsWith("/TASKDATA.XML"));
  if (!main) throw new IsoxmlReadError("TASKDATA.XML absent de l'archive.");
  const dir = main.slice(0, main.length - "TASKDATA.XML".length);
  const text = (name: string) => {
    const f = byName.get(`${dir}${name}`.toUpperCase());
    return f ? new TextDecoder("utf-8").decode(f) : null;
  };
  const warnings: string[] = [];
  const root = all(parseXml(text("TASKDATA.XML")!), "ISO11783_TaskData")[0];
  if (!root) throw new IsoxmlReadError("TASKDATA.XML sans élément ISO11783_TaskData.");

  // Fichiers externes : leurs éléments (sous XFC) rejoignent la racine.
  const elements = [...root.children];
  for (const xfr of all(root, "XFR")) {
    const t = text(`${xfr.attrs.A}.XML`);
    if (t === null) {
      warnings.push(`Fichier externe ${xfr.attrs.A}.XML absent.`);
      continue;
    }
    const doc = parseXml(t);
    for (const c of doc.children) elements.push(...(c.tag === "XFC" ? c.children : [c]));
  }
  const pfds = new Map(elements.filter((e) => e.tag === "PFD").map((e) => [e.attrs.A!, e]));
  const pdts = new Map(elements.filter((e) => e.tag === "PDT").map((e) => [e.attrs.A!, e]));
  const dvcs = elements.filter((e) => e.tag === "DVC");
  const deviceOf = (det: string) => dvcs.find((d) => all(d, "DET").some((x) => x.attrs.A === det));

  const tasks: ReadTask[] = elements
    .filter((e) => e.tag === "TSK")
    .map((tsk) => {
      const log: LogRecord[] = [];
      for (const tlg of all(tsk, "TLG")) {
        const header = text(`${tlg.attrs.A}.XML`);
        const bin = byName.get(`${dir}${tlg.attrs.A}.BIN`.toUpperCase());
        if (header === null || !bin) {
          warnings.push(`Journal ${tlg.attrs.A} incomplet (XML ou BIN absent).`);
          continue;
        }
        const h = parseXml(header).children[0];
        if (h) log.push(...readTimeLog(h, bin));
      }
      const tims = all(tsk, "TIM");
      const totals = tims.flatMap((tim) =>
        all(tim, "DLV")
          .filter((d) => d.attrs.B !== undefined && d.attrs.B !== "")
          .map((d) => ({ ddi: parseInt(d.attrs.A ?? "0", 16), value: Number(d.attrs.B), element: d.attrs.C ?? null })),
      );
      // Matériels : ceux dont un élément apparaît dans les valeurs ou le journal, sinon les allocations (DAN).
      const used = new Set<string>([
        ...totals.map((t) => t.element).filter((e): e is string => !!e),
        ...log.flatMap((r) => Object.keys(r.values).map((k) => k.split("@")[1]!)).filter(Boolean),
      ]);
      const devices = [...new Set([...used].map(deviceOf).filter((d): d is XmlNode => !!d))].map((d) => ({
        id: d.attrs.A!,
        designator: d.attrs.B ?? "",
        serial: d.attrs.E || null,
        elements: all(d, "DET").map((x) => x.attrs.A!),
      }));
      const pfd = tsk.attrs.E ? pfds.get(tsk.attrs.E) : undefined;
      if (tsk.attrs.E && !pfd) warnings.push(`Tâche ${tsk.attrs.A} : parcelle ${tsk.attrs.E} absente.`);
      const productIds = [...new Set(all(tsk, "PAN").map((p) => p.attrs.A!).filter(Boolean))];
      return {
        id: tsk.attrs.A ?? "",
        designator: tsk.attrs.B ?? "",
        status: tsk.attrs.G ? Number(tsk.attrs.G) : null,
        times: tims.map((t) => ({ start: t.attrs.A ?? "", stop: t.attrs.B || null, type: t.attrs.D ? Number(t.attrs.D) : null })),
        partfield: pfd
          ? { id: pfd.attrs.A!, name: pfd.attrs.C ?? "", areaM2: pfd.attrs.D ? Number(pfd.attrs.D) : null, polygons: boundaries(pfd) }
          : null,
        products: productIds.map((id) => ({ id, name: pdts.get(id)?.attrs.B ?? id })),
        devices,
        totals,
        log,
      };
    });
  return {
    software: {
      manufacturer: root.attrs.ManagementSoftwareManufacturer ?? null,
      version: root.attrs.ManagementSoftwareVersion ?? null,
      taskController: root.attrs.TaskControllerManufacturer ?? null,
    },
    tasks,
    warnings,
  };
}
