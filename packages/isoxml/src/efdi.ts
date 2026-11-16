/**
 * EFDI (ISO 11783-10 en protobuf, messages agrirouter
 * `iso:11783:-10:time_log:protobuf` et `…:device_description:protobuf`),
 * lot AR5. Décodeur réduit sans dépendance : seuls les champs utiles à Fourmy
 * sont lus. Numéros de champs d'après `efdi.proto` de DKE-Data
 * (github.com/DKE-Data/agrirouter-tmt-protobuf-definitions, Apache 2.0).
 *
 * - journal (TimeLog) : TimeLog { repeated Time time = 4 } ; chaque Time porte
 *   sa date, sa position (position_start) et ses valeurs (DataLogValue) ;
 * - description de machine : ISO11783_TaskData { repeated Device device = 17 }.
 */

// --- Format protobuf ----------------------------------------------------------------

type Field = { no: number; wire: number; varint?: bigint; bytes?: Uint8Array; fixed64?: DataView; fixed32?: DataView };

export class EfdiReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EfdiReadError";
  }
}

/** Champs d'un message protobuf, dans l'ordre. */
function fields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let at = 0;
  const varint = (): bigint => {
    let v = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (at >= buf.length) throw new EfdiReadError("Message EFDI tronqué.");
      const b = buf[at++]!;
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
      if (shift > 63n) throw new EfdiReadError("Message EFDI mal formé (entier trop long).");
    }
  };
  while (at < buf.length) {
    const key = Number(varint());
    const no = key >>> 3;
    const wire = key & 7;
    if (wire === 0) out.push({ no, wire, varint: varint() });
    else if (wire === 2) {
      const len = Number(varint());
      if (at + len > buf.length) throw new EfdiReadError("Message EFDI tronqué.");
      out.push({ no, wire, bytes: buf.subarray(at, at + len) });
      at += len;
    } else if (wire === 1) {
      if (at + 8 > buf.length) throw new EfdiReadError("Message EFDI tronqué.");
      out.push({ no, wire, fixed64: new DataView(buf.buffer, buf.byteOffset + at, 8) });
      at += 8;
    } else if (wire === 5) {
      if (at + 4 > buf.length) throw new EfdiReadError("Message EFDI tronqué.");
      out.push({ no, wire, fixed32: new DataView(buf.buffer, buf.byteOffset + at, 4) });
      at += 4;
    } else throw new EfdiReadError(`Message EFDI mal formé (type de champ ${wire}).`);
  }
  return out;
}

const pick = (f: Field[], no: number) => f.filter((x) => x.no === no);
const one = (f: Field[], no: number) => f.find((x) => x.no === no);
const uint = (f: Field[], no: number) => Number(one(f, no)?.varint ?? 0n);
/** sint64 : codage zigzag. */
const sint = (f: Field[], no: number) => {
  const v = one(f, no)?.varint ?? 0n;
  return Number((v >> 1n) ^ -(v & 1n));
};
const double = (f: Field[], no: number) => {
  const x = one(f, no)?.fixed64;
  return x ? x.getFloat64(0, true) : 0;
};
const text = (f: Field[], no: number) => {
  const b = one(f, no)?.bytes;
  return b ? new TextDecoder("utf-8").decode(b) : "";
};
const sub = (f: Field[], no: number) => {
  const b = one(f, no)?.bytes;
  return b ? fields(b) : null;
};

/** google.protobuf.Timestamp → ISO UTC. */
const timestamp = (f: Field[] | null) => (f ? new Date(Number(one(f, 1)?.varint ?? 0n) * 1000 + Math.floor(uint(f, 2) / 1e6)).toISOString() : null);

/** UID { sint64 number = 1 } : numéro de l'élément de matériel. */
const uid = (f: Field[] | null) => (f && one(f, 1) ? sint(f, 1) : null);

/**
 * Contenu éventuellement enveloppé dans un google.protobuf.Any
 * (`types.agrirouter.com/efdi.TimeLog`), comme dans l'ancienne API : déballé.
 */
export function unwrapAny(buf: Uint8Array): Uint8Array {
  try {
    const f = fields(buf);
    const type = text(f, 1);
    const value = one(f, 2)?.bytes;
    if (f.length === 2 && value && /^(types\.agrirouter\.com|type\.googleapis\.com)\/efdi\./.test(type)) return value;
  } catch {
    // pas un Any
  }
  return buf;
}

// --- Journal (TimeLog) ----------------------------------------------------------

export interface EfdiPosition {
  lat: number;
  lon: number;
  /** État de la position : 1 GNSS … 5 RTK flottant ; 0 ou 15 : pas de position. */
  status: number;
  /** Heure GPS UTC de la position, si donnée. */
  gpsTime: string | null;
}

export interface EfdiTime {
  start: string | null;
  stop: string | null;
  /** 4 : travail effectif, 5 : non effectif… */
  type: number;
  position: EfdiPosition | null;
  /** Valeurs relevées : DDI, valeur brute, élément de matériel (numéro d'UID). */
  values: { ddi: number; value: number; element: number | null }[];
}

function position(f: Field[] | null): EfdiPosition | null {
  if (!f) return null;
  return { lat: double(f, 1), lon: double(f, 2), status: uint(f, 4), gpsTime: timestamp(sub(f, 8)) };
}

/** Lit un journal EFDI (TimeLog). */
export function decodeTimeLog(payload: Uint8Array): { filename: string; times: EfdiTime[] } {
  const f = fields(unwrapAny(payload));
  return {
    filename: text(f, 2),
    times: pick(f, 4).map((t) => {
      const tf = fields(t.bytes!);
      return {
        start: timestamp(sub(tf, 1)),
        stop: timestamp(sub(tf, 2)),
        type: uint(tf, 4),
        position: position(sub(tf, 5)),
        values: pick(tf, 7).map((v) => {
          const vf = fields(v.bytes!);
          return { ddi: uint(vf, 1), value: sint(vf, 2), element: uid(sub(vf, 3)) };
        }),
      };
    }),
  };
}

// --- Description de machine -------------------------------------------------------

export interface EfdiDevice {
  id: number | null;
  designator: string;
  serial: string | null;
  elements: { id: number | null; objectId: number; type: number; designator: string; number: number; parent: number }[];
  /** Propriétés fixes (DPT) : largeur de travail par défaut, décalages… */
  properties: { objectId: number; ddi: number; value: number; designator: string }[];
}

/** DeviceElement.type : 4 = section. */
export const EFDI_SECTION = 4;

/** Lit une description de machine EFDI (ISO11783_TaskData, ses Device). */
export function decodeDeviceDescription(payload: Uint8Array): { devices: EfdiDevice[]; taskController: string | null } {
  const f = fields(unwrapAny(payload));
  return {
    taskController: text(f, 5) || null,
    devices: pick(f, 17).map((d) => {
      const df = fields(d.bytes!);
      return {
        id: uid(sub(df, 1)),
        designator: text(df, 2),
        serial: text(df, 5) || null,
        elements: pick(df, 8).map((e) => {
          const ef = fields(e.bytes!);
          return { id: uid(sub(ef, 1)), objectId: uint(ef, 2), type: uint(ef, 3), designator: text(ef, 4), number: uint(ef, 5), parent: uint(ef, 6) };
        }),
        properties: pick(df, 10).map((p) => {
          const pf = fields(p.bytes!);
          return { objectId: uint(pf, 1), ddi: uint(pf, 2), value: sint(pf, 3), designator: text(pf, 4) };
        }),
      };
    }),
  };
}
