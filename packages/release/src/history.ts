import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { RawCommit } from "./conventional.js";

const FIELD = "\x1f";
const RECORD = "\x1e";

/** Historique de la branche courante, du plus ancien au plus récent (Git requis). */
export function readGitHistory(cwd: string): RawCommit[] {
  if (execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd, encoding: "utf8" }).trim() === "true") {
    throw new Error("Historique Git superficiel : version et changelog seraient faux. Fournir un fichier d'historique (--history).");
  }
  const out = execFileSync("git", ["log", "--reverse", `--format=%H${FIELD}%aI${FIELD}%s${FIELD}%b${RECORD}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.trim())
    .map((r) => {
      const [sha, date, subject, body] = r.split(FIELD);
      return { sha: sha!, date: date!, subject: subject!, body: (body ?? "").trim() };
    });
}

/** Historique fourni en fichier (construction sans `.git`) : tableau de RawCommit. */
export function readHistoryFile(path: string): RawCommit[] {
  const data = JSON.parse(readFileSync(path, "utf8")) as RawCommit[];
  if (!Array.isArray(data)) throw new Error(`${path} : tableau de commits attendu.`);
  return data;
}
