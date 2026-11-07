#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildRelease } from "./changelog.js";
import { findLeaks, parseDenylist } from "./guard.js";
import { readGitHistory, readHistoryFile } from "./history.js";

/**
 * fourmy-release [--repo <dossier>] [--history <commits.json>] [--out <release.json>]
 *               [--dump-history <commits.json>]
 * Calcule version et changelog public ; échoue si une entrée publique contient
 * un terme de la liste noire (denylist.txt) ou une adresse e-mail.
 * --dump-history écrit l'historique brut (construction sans .git ensuite).
 */
const { values } = parseArgs({
  options: {
    repo: { type: "string", default: process.cwd() },
    history: { type: "string" },
    out: { type: "string" },
    "dump-history": { type: "string" },
  },
});

const commits = values.history ? readHistoryFile(values.history) : readGitHistory(values.repo!);
if (values["dump-history"]) {
  writeFileSync(values["dump-history"], JSON.stringify(commits));
  console.log(`historique : ${commits.length} commits → ${values["dump-history"]}`);
}
const overrides = JSON.parse(
  readFileSync(fileURLToPath(new URL("../public-overrides.json", import.meta.url)), "utf8"),
) as Record<string, string | false>;
delete overrides["//"];
const release = buildRelease(commits, overrides);
const denylist = parseDenylist(readFileSync(fileURLToPath(new URL("../denylist.txt", import.meta.url)), "utf8"));
const leaks = findLeaks(release.entries, denylist);
if (leaks.length > 0) {
  console.error("Changelog public refusé — termes interdits :");
  for (const l of leaks) console.error(`  ${l.sha} « ${l.term} » dans : ${l.text}`);
  console.error("Reformuler avec une ligne `Public: …` (ou `Public: non`) dans le message du commit.");
  process.exit(1);
}
if (values.out) writeFileSync(values.out, JSON.stringify(release, null, 2));
console.log(`version ${release.version} — ${release.entries.length} entrées publiques`);
