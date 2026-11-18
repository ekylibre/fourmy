import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import titlesRaw from "../content/nouveautes.yaml?raw";
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

const titles = (parse(titlesRaw) as { livraisons?: Record<string, string> }).livraisons ?? {};

/** Une livraison : les versions publiées le même jour, sous la plus récente. */
export interface Delivery {
  /** Version la plus récente de la livraison (adresse de sa page). */
  version: string;
  /** Version la plus ancienne. */
  first: string;
  /** Jour de livraison (AAAA-MM-JJ). */
  day: string;
  title: string | null;
  required: Release["entries"];
  features: Release["entries"];
  fixes: Release["entries"];
  count: number;
}

/** Livraisons, de la plus récente à la plus ancienne (page Nouveautés, flux RSS). */
export function deliveries(): Delivery[] {
  const byDay = new Map<string, Release["entries"]>();
  for (const e of release.entries) {
    const day = e.date.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  return [...byDay].map(([day, entries]) => ({
    version: entries[0]!.version,
    first: entries.at(-1)!.version,
    day,
    title: titles[day] ?? null,
    required: entries.filter((e) => e.breaking),
    features: entries.filter((e) => !e.breaking && e.kind === "feature"),
    fixes: entries.filter((e) => !e.breaking && e.kind === "fix"),
    count: entries.length,
  }));
}

export const formatDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
