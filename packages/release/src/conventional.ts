/**
 * Commits conventionnels (`type(portée)!: description`) et leurs lignes
 * spéciales. Le corps d'un commit n'est jamais publié : on n'y lit que
 * `BREAKING CHANGE:` et la ligne `Public:` (texte public, ou `non`).
 */

export interface RawCommit {
  sha: string;
  /** Date ISO de l'auteur. */
  date: string;
  subject: string;
  body: string;
}

export interface ParsedCommit extends RawCommit {
  type: string | null;
  scope: string | null;
  breaking: boolean;
  /** Description du titre, sans type ni portée. */
  description: string;
  /** Texte de la ligne `Public:` ; `false` si `Public: non`. */
  publicText: string | false | null;
}

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<description>.+)$/i;
const PUBLIC_LINE = /^public\s*:\s*(.*)$/im;

export function parseCommit(commit: RawCommit): ParsedCommit {
  const match = HEADER.exec(commit.subject.trim());
  const publicMatch = PUBLIC_LINE.exec(commit.body);
  const publicValue = publicMatch?.[1]?.trim() ?? null;
  return {
    ...commit,
    type: match?.groups?.type?.toLowerCase() ?? null,
    scope: match?.groups?.scope ?? null,
    breaking: Boolean(match?.groups?.bang) || /^BREAKING[ -]CHANGE:/m.test(commit.body),
    description: (match?.groups?.description ?? commit.subject).trim(),
    publicText: publicValue === null ? null : /^(non|no|false|-)$/i.test(publicValue) ? false : publicValue,
  };
}
