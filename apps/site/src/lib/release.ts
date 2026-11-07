import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelease, findLeaks, parseDenylist, readGitHistory, readHistoryFile, type Release } from "@fourmy/release";

/**
 * Version et changelog publics, calculés à la construction depuis
 * l'historique Git du dépôt (ou depuis FOURMY_HISTORY_FILE quand la
 * construction n'a pas `.git`). Un terme de la liste noire dans une entrée
 * publique fait **échouer** la construction : rien n'est publié.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const releaseDir = dirname(createRequire(import.meta.url).resolve("@fourmy/release/package.json"));

function compute(): Release {
  const historyFile = process.env.FOURMY_HISTORY_FILE;
  const commits = historyFile ? readHistoryFile(historyFile) : readGitHistory(repoRoot);
  const overrides = JSON.parse(readFileSync(join(releaseDir, "public-overrides.json"), "utf8")) as Record<string, string | false>;
  delete overrides["//"];
  const release = buildRelease(commits, overrides);
  const leaks = findLeaks(release.entries, parseDenylist(readFileSync(join(releaseDir, "denylist.txt"), "utf8")));
  if (leaks.length > 0) {
    const detail = leaks.map((l) => `${l.sha} « ${l.term} »`).join(", ");
    throw new Error(`Changelog public refusé (termes interdits : ${detail}). Ajouter « Public: … » au commit.`);
  }
  return release;
}

export const release: Release = compute();

/** Entrées groupées par version, de la plus récente à la plus ancienne. */
export function releasesByVersion() {
  const groups = new Map<string, { version: string; date: string; entries: Release["entries"] }>();
  for (const e of release.entries) {
    const g = groups.get(e.version) ?? { version: e.version, date: e.date, entries: [] };
    g.entries.push(e);
    groups.set(e.version, g);
  }
  return [...groups.values()];
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
