import { createHash } from "node:crypto";

/**
 * Identifiants déterministes (UUID v5, RFC 4122) dérivés de
 * `(instance, table, id)` : rejouer la migration met à jour au lieu de
 * dupliquer (docs/architecture.md §6.1).
 */
const NAMESPACE = "6f2f2a3e-5b7c-4f0e-9d0a-7f6f6f726d79"; // espace « fourmy/ekylibre »

function parse(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

export function uuidv5(name: string, namespace = NAMESPACE): string {
  const hash = createHash("sha1").update(parse(namespace)).update(name, "utf8").digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Fabrique d'identifiants pour une instance Ekylibre donnée. */
export function idsFor(instance: string) {
  return (table: string, id: string | number) => uuidv5(`${instance}:${table}:${id}`);
}
