import type { EfdiDevice, EfdiTime } from "./efdi.js";

/**
 * Écriture EFDI réduite (lot AR5) : les mêmes champs que le décodeur, pour
 * les tests et la simulation (aucun envoi de télémétrie par Fourmy).
 */

const varint = (v: bigint): number[] => {
  const out: number[] = [];
  let x = BigInt.asUintN(64, v);
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x) b |= 0x80;
    out.push(b);
  } while (x);
  return out;
};
const zigzag = (v: number) => (BigInt(v) << 1n) ^ (BigInt(v) >> 63n);
const key = (no: number, wire: number) => varint(BigInt((no << 3) | wire));

const fieldVarint = (no: number, v: bigint) => [...key(no, 0), ...varint(v)];
const fieldBytes = (no: number, b: number[] | Uint8Array) => [...key(no, 2), ...varint(BigInt(b.length)), ...b];
const fieldString = (no: number, s: string) => fieldBytes(no, [...new TextEncoder().encode(s)]);
const fieldDouble = (no: number, v: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...key(no, 1), ...b];
};
const ts = (iso: string) => {
  const ms = Date.parse(iso);
  return [...fieldVarint(1, BigInt(Math.floor(ms / 1000))), ...fieldVarint(2, BigInt((ms % 1000) * 1e6))];
};
const uidOf = (n: number) => fieldVarint(1, zigzag(n));

/** Journal EFDI (TimeLog) avec ses Time. */
export function encodeTimeLog(times: Omit<EfdiTime, "stop">[], filename = "TLG00001"): Uint8Array {
  const out = [...fieldString(2, filename), ...fieldVarint(1, 1n)];
  for (const t of times) {
    const tb: number[] = [];
    if (t.start) tb.push(...fieldBytes(1, ts(t.start)));
    tb.push(...fieldVarint(4, BigInt(t.type)));
    if (t.position) {
      const p = [...fieldDouble(1, t.position.lat), ...fieldDouble(2, t.position.lon), ...fieldVarint(4, BigInt(t.position.status))];
      if (t.position.gpsTime) p.push(...fieldBytes(8, ts(t.position.gpsTime)));
      tb.push(...fieldBytes(5, p));
    }
    for (const v of t.values) {
      tb.push(...fieldBytes(7, [...fieldVarint(1, BigInt(v.ddi)), ...fieldVarint(2, zigzag(v.value)), ...(v.element !== null ? fieldBytes(3, uidOf(v.element)) : [])]));
    }
    out.push(...fieldBytes(4, tb));
  }
  return new Uint8Array(out);
}

/** Description de machine EFDI (ISO11783_TaskData avec ses Device). */
export function encodeDeviceDescription(devices: EfdiDevice[], taskController = "Console"): Uint8Array {
  const out = [...fieldString(5, taskController)];
  for (const d of devices) {
    const db: number[] = [];
    if (d.id !== null) db.push(...fieldBytes(1, uidOf(d.id)));
    db.push(...fieldString(2, d.designator));
    if (d.serial) db.push(...fieldString(5, d.serial));
    for (const e of d.elements) {
      db.push(
        ...fieldBytes(8, [
          ...(e.id !== null ? fieldBytes(1, uidOf(e.id)) : []),
          ...fieldVarint(2, BigInt(e.objectId)),
          ...fieldVarint(3, BigInt(e.type)),
          ...fieldString(4, e.designator),
          ...fieldVarint(5, BigInt(e.number)),
          ...fieldVarint(6, BigInt(e.parent)),
        ]),
      );
    }
    for (const p of d.properties) {
      db.push(...fieldBytes(10, [...fieldVarint(1, BigInt(p.objectId)), ...fieldVarint(2, BigInt(p.ddi)), ...fieldVarint(3, zigzag(p.value)), ...fieldString(4, p.designator)]));
    }
    out.push(...fieldBytes(17, db));
  }
  return new Uint8Array(out);
}

/** Enveloppe google.protobuf.Any (ancienne API agrirouter). */
export function wrapAny(type: string, value: Uint8Array): Uint8Array {
  return new Uint8Array([...fieldString(1, `types.agrirouter.com/${type}`), ...fieldBytes(2, value)]);
}
