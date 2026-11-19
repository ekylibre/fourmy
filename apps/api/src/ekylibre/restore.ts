import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import postgres from "postgres";

/**
 * Restauration d'un dump SQL de tenant Ekylibre (pg_dump au format texte)
 * dans une base **jetable**, par le worker (lot IM6, reprise depuis
 * l'interface). Le dump vient d'un fichier déposé par un utilisateur : il
 * n'est pas exécuté tel quel.
 *
 * - Base dédiée, créée pour l'import et supprimée ensuite ; PostGIS et le
 *   schéma du tenant y sont créés par le serveur, pas par le dump.
 * - Instructions exécutées sous le rôle `fourmy_restore` (sans connexion,
 *   sans privilège hors du schéma du tenant) : pas de `COPY … TO PROGRAM`,
 *   pas de fonction en langage non sûr.
 * - **Liste blanche** : création de tables, séquences, index, vues, types,
 *   fonctions en `plpgsql` ou `sql`, déclencheurs, contraintes, `COPY … FROM
 *   stdin`, `setval`, réglages de session connus. Le reste est ignoré
 *   (propriétaires, droits, commentaires, schéma, extensions) ou refusé et
 *   compté (changement de rôle, tout autre ordre), comme les commandes psql.
 * - Une instruction en erreur est comptée et la suite continue (comme
 *   `psql -v ON_ERROR_STOP=0` de restore-source.sh).
 */

export const RESTORE_ROLE = "fourmy_restore";

const SESSION_SETTINGS = new Set([
  "statement_timeout",
  "lock_timeout",
  "idle_in_transaction_session_timeout",
  "client_encoding",
  "standard_conforming_strings",
  "check_function_bodies",
  "xmloption",
  "client_min_messages",
  "row_security",
  "default_tablespace",
  "default_table_access_method",
  "default_with_oids",
  "transaction_timeout",
]);

export type Verdict = "run" | "ignore" | "refuse";

/** Sort d'une instruction du dump (sans ses commentaires de tête). */
export function classify(statement: string): { verdict: Verdict; kind: string } {
  const s = statement.replace(/^\s+/, "");
  const head = s.slice(0, 200).toUpperCase().replace(/\s+/g, " ");
  const kind = head.split(" ").slice(0, 2).join(" ");
  if (/^(SET|RESET) (ROLE|SESSION)/.test(head) || /^SET SESSION AUTHORIZATION/.test(head)) return { verdict: "refuse", kind };
  const set = /^SET (\w+) /.exec(head);
  if (set) return { verdict: SESSION_SETTINGS.has(set[1]!.toLowerCase()) ? "run" : "ignore", kind: `SET ${set[1]}` };
  if (/^SELECT PG_CATALOG\.SET_CONFIG\('SEARCH_PATH'/.test(head)) return { verdict: "run", kind: "SET search_path" };
  if (/^SELECT PG_CATALOG\.SETVAL\(/.test(head)) return { verdict: "run", kind: "SELECT setval" };
  if (/^ALTER\b/.test(head) && /\bOWNER TO\b/.test(head)) return { verdict: "ignore", kind: "OWNER" };
  if (/^(GRANT|REVOKE|COMMENT ON|CREATE SCHEMA|CREATE EXTENSION|ALTER DEFAULT PRIVILEGES|ALTER SCHEMA|ALTER EXTENSION)\b/.test(head)) return { verdict: "ignore", kind };
  if (/^CREATE (OR REPLACE )?FUNCTION /.test(head)) {
    const lang = /\bLANGUAGE\s+'?(\w+)'?/i.exec(s)?.[1]?.toLowerCase();
    return { verdict: lang === "plpgsql" || lang === "sql" ? "run" : "refuse", kind: `FUNCTION ${lang ?? "?"}` };
  }
  if (/^COPY\s[\s\S]+\sFROM\s+stdin;?$/i.test(s.trim())) return { verdict: "run", kind: "COPY" };
  if (
    /^(CREATE (UNLOGGED )?TABLE|CREATE SEQUENCE|ALTER SEQUENCE|ALTER TABLE|CREATE (UNIQUE )?INDEX|CREATE (OR REPLACE )?VIEW|CREATE MATERIALIZED VIEW|REFRESH MATERIALIZED VIEW|CREATE (CONSTRAINT )?TRIGGER|CREATE TYPE|CREATE DOMAIN|ALTER INDEX|CREATE STATISTICS)\b/.test(head)
  ) {
    return { verdict: "run", kind };
  }
  return { verdict: "refuse", kind };
}

/**
 * Découpe un dump en instructions, ligne à ligne : point-virgule hors des
 * chaînes, des identifiants entre guillemets, des chaînes dollar et des
 * commentaires. Les données d'un `COPY … FROM stdin` suivent jusqu'à `\.`.
 */
export async function* dumpStatements(lines: AsyncIterable<string>): AsyncGenerator<{ sql: string; copy?: string[] } | { meta: string }> {
  let buf = "";
  let quote: "'" | '"' | null = null;
  let dollar: string | null = null;
  let block = 0;
  let copy: { sql: string; rows: string[] } | null = null;
  for await (const line of lines) {
    if (copy) {
      if (line === "\\.") {
        yield { sql: copy.sql, copy: copy.rows };
        copy = null;
      } else {
        copy.rows.push(line);
        // Lots de lignes : la mémoire reste bornée sur les grosses tables.
        if (copy.rows.length >= 5000) {
          yield { sql: copy.sql, copy: copy.rows };
          copy.rows = [];
        }
      }
      continue;
    }
    // Commande psql en début d'instruction (\connect, \restrict…).
    if (!buf.trim() && !quote && !dollar && !block && line.startsWith("\\")) {
      yield { meta: line.split(/\s/)[0]! };
      continue;
    }
    let seg = 0; // début du morceau de ligne à garder
    let kept = ""; // texte gardé avant un commentaire /* … */ de la ligne
    let i = 0;
    let end = line.length; // fin du texte utile (avant un commentaire « -- »)
    while (i < line.length) {
      const c = line[i]!;
      const next = line[i + 1];
      if (block) {
        if (c === "*" && next === "/") {
          block--;
          i += 2;
          if (!block) seg = i;
        } else if (c === "/" && next === "*") {
          block++;
          i += 2;
        } else i++;
      } else if (quote) {
        if (c === quote && next === quote) i += 2;
        else {
          if (c === quote) quote = null;
          i++;
        }
      } else if (dollar) {
        if (line.startsWith(dollar, i)) {
          i += dollar.length;
          dollar = null;
        } else i++;
      } else if (c === "-" && next === "-") {
        end = i;
        break;
      } else if (c === "/" && next === "*") {
        kept += line.slice(seg, i);
        block = 1;
        i += 2;
      } else if (c === "'" || c === '"') {
        quote = c;
        i++;
      } else if (c === "$" && /^\$[A-Za-z_]*\$/.test(line.slice(i))) {
        dollar = /^\$[A-Za-z_]*\$/.exec(line.slice(i))![0];
        i += dollar.length;
      } else if (c === ";") {
        const statement = `${buf}${kept}${line.slice(seg, i + 1)}`.trim();
        buf = "";
        kept = "";
        seg = i + 1;
        i++;
        if (/^COPY\s[\s\S]+\sFROM\s+stdin;$/i.test(statement)) {
          copy = { sql: statement, rows: [] };
          break;
        }
        if (statement !== ";") yield { sql: statement };
      } else i++;
    }
    if (copy) continue;
    const rest = kept + (block ? "" : line.slice(seg, end));
    if (rest.trim() || buf) buf += `${rest}\n`;
  }
  if (buf.trim()) yield { sql: buf.trim() };
}

export interface RestoreReport {
  executed: number;
  ignored: number;
  refused: Record<string, number>;
  errors: number;
  errorSamples: string[];
  copiedRows: number;
}

/**
 * Crée la base jetable `database` sur le serveur `adminUrl` (rôle capable de
 * créer une base et PostGIS), y restaure le dump, puis la passe en lecture
 * seule. `onProgress` reçoit le nombre d'octets du dump déjà lus.
 */
export async function restoreDump(
  adminUrl: string,
  database: string,
  tenant: string,
  dump: Readable,
  onProgress?: (bytes: number) => void,
): Promise<RestoreReport> {
  if (!/^ekylibre_src_[a-z0-9_]{1,50}$/.test(database)) throw new Error(`Nom de base source invalide : ${database}`);
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RESTORE_ROLE}') THEN CREATE ROLE ${RESTORE_ROLE} NOLOGIN; END IF;
    END $$`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  const target = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const quoted = `"${tenant.replace(/"/g, "")}"`;
  const report: RestoreReport = { executed: 0, ignored: 0, refused: {}, errors: 0, errorSamples: [], copiedRows: 0 };
  try {
    await target.unsafe(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await target.unsafe(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await target.unsafe(`CREATE SCHEMA postgis`);
    await target.unsafe(`CREATE EXTENSION postgis SCHEMA postgis`);
    await target.unsafe(`CREATE SCHEMA ${quoted} AUTHORIZATION ${RESTORE_ROLE}`);
    await target.unsafe(`GRANT USAGE ON SCHEMA postgis TO ${RESTORE_ROLE}`);
    await target.unsafe(`GRANT CONNECT ON DATABASE "${database}" TO ${RESTORE_ROLE}`);
    // Toute la suite sous le rôle restreint ; le dump ne peut pas en sortir (SET ROLE refusé).
    await target.unsafe(`SET ROLE ${RESTORE_ROLE}`);

    let read = 0;
    dump.on("data", (c: Buffer) => {
      read += c.length;
      onProgress?.(read);
    });
    const lines = createInterface({ input: dump, crlfDelay: Infinity });
    for await (const item of dumpStatements(lines)) {
      if ("meta" in item) {
        // Commandes psql (\restrict, \connect…) : jamais exécutées.
        report.refused[item.meta] = (report.refused[item.meta] ?? 0) + 1;
        continue;
      }
      const { verdict, kind } = classify(item.sql);
      if (verdict === "ignore") {
        report.ignored++;
        continue;
      }
      if (verdict === "refuse") {
        report.refused[kind] = (report.refused[kind] ?? 0) + 1;
        continue;
      }
      try {
        if (item.copy) {
          if (!item.copy.length) continue;
          const stream = await target.unsafe(item.sql.replace(/;$/, "")).writable();
          await new Promise<void>((resolve, reject) => {
            stream.on("error", reject);
            stream.on("finish", resolve);
            stream.end(`${item.copy!.join("\n")}\n`);
          });
          report.copiedRows += item.copy.length;
        } else {
          await target.unsafe(item.sql);
          report.executed++;
        }
      } catch (e) {
        report.errors++;
        if (report.errorSamples.length < 10) report.errorSamples.push(`${kind} : ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }
    }
    await target.unsafe(`RESET ROLE`);
    // Lecture seule : la migration lit, rien d'autre.
    await target.unsafe(`ALTER DATABASE "${database}" SET default_transaction_read_only = on`);
    await target.unsafe(`COMMENT ON DATABASE "${database}" IS ${quoteLiteral(`ekylibre tenant=${tenant}`)}`);
    return report;
  } finally {
    await target.end();
  }
}

const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Suppression de la base jetable (après la migration, un abandon ou un échec). */
export async function dropSourceDatabase(adminUrl: string, database: string): Promise<void> {
  if (!/^ekylibre_src_[a-z0-9_]{1,50}$/.test(database)) return;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
