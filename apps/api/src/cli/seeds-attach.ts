#!/usr/bin/env node
import { parseArgs } from "node:util";
import { withFarm } from "@fourmy/db";
import { db } from "../db.js";
import { attachSeedsIn } from "../repos/seed-catalog.js";

/**
 * Rattache les semences d'une ferme au référentiel (lot SE4, FR-SE-12) :
 *   pnpm --filter @fourmy/api seeds:attach --farm <id> [--all] [--dry-run]
 * Par défaut, seulement les rattachements sûrs (code GNIS trouvé au
 * catalogue) ; `--all` ajoute les propositions à confirmer (espèce importée,
 * référence Lexicon, mélanges). `--dry-run` affiche sans rien écrire.
 */
const { values } = parseArgs({ options: { farm: { type: "string" }, all: { type: "boolean" }, "dry-run": { type: "boolean" } } });
if (!values.farm || !/^[0-9a-f-]{36}$/i.test(values.farm)) {
  console.error("usage: seeds:attach --farm <id> [--all] [--dry-run]");
  process.exit(2);
}
class DryRun extends Error {}
let done: Awaited<ReturnType<typeof attachSeedsIn>> = [];
try {
  await withFarm(db(), values.farm, async (tx) => {
    done = await attachSeedsIn(tx, values.farm!, null, undefined, values.all ? undefined : (p) => p.sure);
    if (values["dry-run"]) throw new DryRun();
  });
} catch (e) {
  if (!(e instanceof DryRun)) throw e;
}
for (const p of done) {
  const flag = p.sure ? "sûr     " : p.approximate ? "approché" : "à vérif.";
  const what = p.isMixture ? "mélange" : [p.speciesLabel ?? p.species, p.varietyName, p.gnisCode].filter(Boolean).join(" · ");
  console.log(`${flag}  ${p.name} → ${what}  (${p.reason})`);
}
console.log(`${done.length} semence(s) ${values["dry-run"] ? "à rattacher (aperçu, rien d'écrit)" : "rattachée(s)"}.`);
process.exit(0);
