#!/usr/bin/env node
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { exportFixture } from "./fixtures.js";

/**
 * fourmy-export-fixture --farm <uuid> --label <libellé> --out <fichier.json> [--description <texte>]
 * Exporte une ferme migrée en fixture anonymisée (DATABASE_URL = base Fourmy).
 */
const { values } = parseArgs({
  options: {
    farm: { type: "string" },
    label: { type: "string" },
    out: { type: "string" },
    description: { type: "string" },
  },
});
const url = process.env.DATABASE_URL;
if (!url || !values.farm || !values.label || !values.out) {
  console.error("usage: fourmy-export-fixture --farm <uuid> --label <libellé> --out <fichier.json>");
  process.exit(2);
}
const fixture = await exportFixture(url, values.farm, values.label, values.description ?? values.label);
await writeFile(values.out, JSON.stringify(fixture) + "\n");
console.log(`✓ ${values.out}`);
console.table(fixture.meta.expected.counts);
console.log("Registre phyto attendu :", fixture.meta.expected.phytoRowsByYear);
