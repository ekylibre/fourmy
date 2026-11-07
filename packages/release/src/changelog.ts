import { parseCommit, type RawCommit } from "./conventional.js";
import { applyBump, bumpOf, INITIAL_VERSION } from "./semver.js";

export interface ChangelogEntry {
  version: string;
  date: string;
  kind: "feature" | "fix";
  text: string;
  sha: string;
  breaking: boolean;
}

export interface Release {
  version: string;
  date: string | null;
  /** Du plus récent au plus ancien. */
  entries: ChangelogEntry[];
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase("fr-FR") + s.slice(1);

/**
 * Calcule version et changelog public depuis les commits, du plus ancien au
 * plus récent. Seuls `feat` et `fix` sont publiés ; la portée (« agent D »…)
 * et le corps ne le sont jamais ; `Public:` remplace le titre, `Public: non`
 * masque l'entrée (la version, elle, avance quand même). `overrides` (sha court
 * → texte ou false) reformule les commits antérieurs à la convention `Public:`.
 */
export function buildRelease(commits: RawCommit[], overrides: Record<string, string | false> = {}): Release {
  let version = INITIAL_VERSION;
  let date: string | null = null;
  const entries: ChangelogEntry[] = [];
  for (const raw of commits) {
    const commit = parseCommit(raw);
    const bump = bumpOf(commit);
    if (!bump) continue;
    version = applyBump(version, bump);
    date = commit.date;
    const override = overrides[commit.sha.slice(0, 7)];
    const publicText = override !== undefined ? override : commit.publicText;
    if (publicText === false) continue;
    entries.push({
      version,
      date: commit.date,
      kind: commit.type === "feat" ? "feature" : "fix",
      text: capitalize(publicText ?? commit.description),
      sha: commit.sha.slice(0, 7),
      breaking: commit.breaking,
    });
  }
  return { version, date, entries: entries.reverse() };
}
