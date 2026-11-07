import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyBump, buildRelease, findLeaks, parseCommit, parseDenylist, readGitHistory, type RawCommit } from "../src/index.js";

let n = 0;
const commit = (subject: string, body = ""): RawCommit => ({
  sha: `${(n++).toString(16).padStart(7, "0")}abcdef`,
  date: `2026-11-${String(1 + (n % 28)).padStart(2, "0")}T10:00:00+01:00`,
  subject,
  body,
});

describe("commits conventionnels", () => {
  it("type, portée, rupture, ligne Public:", () => {
    expect(parseCommit(commit("feat(agent D): carte des parcelles"))).toMatchObject({
      type: "feat",
      scope: "agent D",
      description: "carte des parcelles",
      breaking: false,
      publicText: null,
    });
    expect(parseCommit(commit("feat!: nouveau format", "BREAKING CHANGE: x")).breaking).toBe(true);
    expect(parseCommit(commit("fix: x", "détail\nPublic: Correction de la carte")).publicText).toBe("Correction de la carte");
    expect(parseCommit(commit("fix: x", "Public: non")).publicText).toBe(false);
    expect(parseCommit(commit("Merge branch 'main'")).type).toBeNull();
  });
});

describe("version", () => {
  it("feat → mineure, fix → correctif, rupture → majeure dès 1.0", () => {
    expect(applyBump("0.4.2", "minor")).toBe("0.5.0");
    expect(applyBump("0.4.2", "patch")).toBe("0.4.3");
    expect(applyBump("0.4.2", "major")).toBe("0.5.0"); // avant 1.0
    expect(applyBump("1.4.2", "major")).toBe("2.0.0");
  });

  it("docs et chore ne changent ni la version ni le changelog", () => {
    const r = buildRelease([commit("feat: a"), commit("docs: b"), commit("chore: c"), commit("fix: d")]);
    expect(r.version).toBe("0.2.1");
    expect(r.entries.map((e) => [e.version, e.kind, e.text])).toEqual([
      ["0.2.1", "fix", "D"],
      ["0.2.0", "feature", "A"],
    ]);
  });
});

describe("changelog public", () => {
  it("jamais la portée ni le corps ; Public: reformule ou masque", () => {
    const r = buildRelease([
      commit("feat(agent F): plan 3D", "corps interne avec un nom de pilote"),
      commit("feat: refonte", "Public: Nouvelle carte, plus rapide"),
      commit("fix: bricolage interne", "Public: non"),
    ]);
    expect(r.version).toBe("0.3.1"); // la version avance même pour l'entrée masquée
    expect(r.entries.map((e) => e.text)).toEqual(["Nouvelle carte, plus rapide", "Plan 3D"]);
    expect(JSON.stringify(r)).not.toContain("corps interne");
    expect(JSON.stringify(r)).not.toContain("agent F");
  });

  it("les reformulations par sha s'appliquent aux commits passés", () => {
    const old = commit("feat(agent0): mocks MSW");
    const kept = commit("feat: technique");
    const r = buildRelease([old, kept], { [old.sha.slice(0, 7)]: false, [kept.sha.slice(0, 7)]: "Lisible" });
    expect(r.entries.map((e) => e.text)).toEqual(["Lisible"]);
  });
});

describe("garde-fou", () => {
  const denylist = parseDenylist("# commentaire\nfrédéric\nentre deux terres\n\nloubes  # ferme\n");

  it("liste noire : mots entiers, sans casse ni accents", () => {
    expect(denylist).toEqual(["frédéric", "entre deux terres", "loubes"]);
    const r = buildRelease([
      commit("feat: traces de Frederic"),
      commit("feat: ferme ENTRE DEUX TERRES"),
      commit("feat: les Loubes"),
      commit("feat: ploubeski n'est pas visé"),
      commit("fix: écrire à jean@exemple.fr"),
    ]);
    expect(findLeaks(r.entries, denylist).map((l) => l.term).sort()).toEqual(
      ["adresse e-mail", "entre deux terres", "frédéric", "loubes"].sort(),
    );
  });

  it("historique réel du dépôt : aucune fuite, version cohérente", () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim();
    if (shallow === "true") return; // CI : checkout complet requis (fetch-depth: 0)
    const overrides = JSON.parse(readFileSync(new URL("../public-overrides.json", import.meta.url), "utf8"));
    delete overrides["//"];
    const release = buildRelease(readGitHistory(root), overrides);
    const realDenylist = parseDenylist(readFileSync(new URL("../denylist.txt", import.meta.url), "utf8"));
    expect(findLeaks(release.entries, realDenylist)).toEqual([]);
    expect(release.version).toMatch(/^0\.\d+\.\d+$/);
    expect(Number(release.version.split(".")[1])).toBeGreaterThanOrEqual(22);
  });
});
