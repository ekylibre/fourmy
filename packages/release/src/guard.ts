import type { ChangelogEntry } from "./changelog.js";

/**
 * Garde-fou du changelog public : un terme de la liste noire (noms des
 * pilotes, tenants, identifiants internes) ou une adresse e-mail dans une
 * entrée publique fait **échouer** la génération, plutôt que de publier.
 * Comparaison sans casse ni accents, sur des mots entiers.
 */
export interface Leak {
  sha: string;
  term: string;
  text: string;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function parseDenylist(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

export function findLeaks(entries: ChangelogEntry[], denylist: string[]): Leak[] {
  const terms = denylist.map((t) => ({ term: t, re: new RegExp(`(^|[^\\p{L}\\p{N}])${escape(fold(t))}($|[^\\p{L}\\p{N}])`, "u") }));
  const leaks: Leak[] = [];
  for (const entry of entries) {
    const text = fold(entry.text);
    for (const { term, re } of terms) if (re.test(text)) leaks.push({ sha: entry.sha, term, text: entry.text });
    if (EMAIL.test(entry.text)) leaks.push({ sha: entry.sha, term: "adresse e-mail", text: entry.text });
  }
  return leaks;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
