import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Chiffrement des secrets d'intégration (jetons, mots de passe) avant leur
 * stockage en base : AES-256-GCM, clé de 32 octets en base64 dans
 * FOURMY_SECRETS_KEY (`openssl rand -base64 32`). La clé ne va jamais en base
 * ni dans le dépôt ; la perdre rend les secrets illisibles (à ressaisir).
 * Format stocké : `v1:<iv>:<tag>:<texte chiffré>` (base64).
 */

export class SecretsNotConfigured extends Error {}

function isLocalDev(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(process.env.DATABASE_URL ?? "").hostname);
  } catch {
    return false;
  }
}

function key(): Buffer {
  const raw = process.env.FOURMY_SECRETS_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new SecretsNotConfigured("FOURMY_SECRETS_KEY doit faire 32 octets (base64).");
    return k;
  }
  // Développement local et tests seulement : clé dérivée, publique par construction.
  if (isLocalDev()) return createHash("sha256").update("fourmy-developpement-local-secrets").digest();
  throw new SecretsNotConfigured("FOURMY_SECRETS_KEY est requis pour enregistrer ou lire un secret d'intégration.");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Secret chiffré illisible (format inconnu).");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** Quatre derniers caractères, pour reconnaître un secret sans le révéler. */
export const secretHint = (plain: string) => (plain.length > 8 ? plain.slice(-4) : "");
