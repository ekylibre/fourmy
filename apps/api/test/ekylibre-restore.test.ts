import { describe, it, expect } from "vitest";
import { classify, dumpStatements } from "../src/ekylibre/restore.js";

/** Restauration d'un dump Ekylibre déposé : découpage et liste blanche (sans base). */
async function split(text: string) {
  async function* lines() {
    for (const l of text.split("\n")) yield l;
  }
  const out: { sql?: string; copy?: string[]; meta?: string }[] = [];
  for await (const s of dumpStatements(lines())) out.push(s);
  return out;
}

describe("découpage d'un dump", () => {
  it("instructions, chaînes, chaînes dollar, commentaires, COPY", async () => {
    const out = await split(
      [
        "-- en-tête",
        "SET client_encoding = 'UTF8';",
        "SELECT pg_catalog.set_config('search_path', '', false);",
        "CREATE FUNCTION \"t\".f() RETURNS trigger",
        "    LANGUAGE plpgsql",
        "    AS $$ BEGIN NEW.a := 'x;y'; -- pas une fin",
        "    RETURN NEW; END $$;",
        "CREATE TABLE \"t\".a (id integer, label text DEFAULT 'a;b'); /* bloc ; */",
        "COPY \"t\".a (id, label) FROM stdin;",
        "1\tun; deux",
        "2\t\\N",
        "\\.",
        "\\restrict abc",
        "SELECT pg_catalog.setval('\"t\".a_id_seq', 2, true);",
      ].join("\n"),
    );
    expect(out.map((o) => o.meta ?? (o.copy ? `COPY(${o.copy.length})` : o.sql!.split(/\s/).slice(0, 2).join(" ")))).toEqual([
      "SET client_encoding",
      "SELECT pg_catalog.set_config('search_path',",
      "CREATE FUNCTION",
      "CREATE TABLE",
      "COPY(2)",
      "\\restrict",
      "SELECT pg_catalog.setval('\"t\".a_id_seq',",
    ]);
    expect(out[2]!.sql).toContain("RETURN NEW; END $$;");
    expect(out[4]!.copy).toEqual(["1\tun; deux", "2\t\\N"]);
  });
});

describe("liste blanche", () => {
  const verdict = (s: string) => classify(s).verdict;
  it("exécute le schéma, les données et les réglages de session du dump", () => {
    for (const s of [
      'CREATE TABLE "t".a (id integer);',
      'ALTER TABLE ONLY "t".a ADD CONSTRAINT a_pkey PRIMARY KEY (id);',
      'CREATE UNIQUE INDEX i ON "t".a USING btree (id);',
      'CREATE SEQUENCE "t".a_id_seq START WITH 1;',
      "SELECT pg_catalog.setval('\"t\".a_id_seq', 2, true);",
      'COPY "t".a (id) FROM stdin;',
      'CREATE FUNCTION "t".f() RETURNS trigger\n LANGUAGE plpgsql\n AS $$ BEGIN RETURN NEW; END $$;',
      'CREATE VIEW "t".v AS SELECT 1;',
      "SET statement_timeout = 0;",
      "SELECT pg_catalog.set_config('search_path', '', false);",
    ]) {
      expect(verdict(s), s).toBe("run");
    }
  });
  it("ignore propriétaires, droits, commentaires, schéma et extensions", () => {
    for (const s of ['ALTER TABLE "t".a OWNER TO ekylibre;', "GRANT ALL ON SCHEMA t TO PUBLIC;", "COMMENT ON TABLE t.a IS 'x';", 'CREATE SCHEMA "t";', "CREATE EXTENSION postgis;", "SET work_mem = '1GB';"]) {
      expect(verdict(s), s).toBe("ignore");
    }
  });
  it("refuse ce qui sortirait du rôle restreint ou de la base", () => {
    for (const s of [
      "SET ROLE postgres;",
      "RESET ROLE;",
      "SET SESSION AUTHORIZATION postgres;",
      "COPY t.a TO PROGRAM 'rm -rf /';",
      "COPY t.a FROM PROGRAM 'curl http://x';",
      "COPY t.a FROM '/etc/passwd';",
      "DO $$ BEGIN PERFORM 1; END $$;",
      "CREATE FUNCTION t.g() RETURNS void LANGUAGE plpython3u AS $$ import os $$;",
      "CREATE FUNCTION t.h() RETURNS void LANGUAGE c AS 'libc', 'system';",
      "ALTER ROLE fourmy SUPERUSER;",
      "CREATE ROLE x LOGIN SUPERUSER;",
      "DROP DATABASE fourmy;",
      "SELECT dblink_exec('dbname=fourmy', 'DELETE FROM farms');",
      "CREATE RULE r AS ON INSERT TO t.a DO INSTEAD NOTHING;",
      "INSERT INTO t.a VALUES (1);",
    ]) {
      expect(verdict(s), s).toBe("refuse");
    }
  });
});
