#!/usr/bin/env node
import { parseArgs } from "node:util";
import { migrate } from "./migrate.js";

/**
 * fourmy-migrate-ekylibre --source <url> [--target <url>] [--tenant <schéma>] [--farm-name <nom>]
 * La base source est celle restaurée par scripts/restore-source.sh (lecture seule).
 */
const { values } = parseArgs({
  options: {
    source: { type: "string" },
    target: { type: "string" },
    tenant: { type: "string" },
    "farm-name": { type: "string" },
  },
});
const sourceUrl = values.source;
const targetUrl = values.target ?? process.env.DATABASE_URL;
if (!sourceUrl || !targetUrl) {
  console.error("usage: fourmy-migrate-ekylibre --source <url> [--target <url>] [--tenant <schéma>]");
  process.exit(2);
}

const t0 = Date.now();
migrate({ sourceUrl, targetUrl, tenant: values.tenant, farmName: values["farm-name"] })
  .then((r) => {
    console.log(`✓ ${r.tenant} (${r.ekylibreVersion ?? "?"}) → ferme ${r.farmId} en ${Date.now() - t0} ms`);
    console.table(r.counts);
    console.log(`Rejets : ${r.rejected.length}`);
    const byReason = new Map<string, number>();
    for (const x of r.rejected) {
      const k = `${x.entity} — ${x.reason}`;
      byReason.set(k, (byReason.get(k) ?? 0) + 1);
    }
    for (const [k, n] of byReason) console.log(`  ${n} × ${k}`);
    if (r.warnings.length) {
      console.log(`Avertissements : ${r.warnings.length}`);
      for (const w of r.warnings) console.log(`  ⚠ ${w.message}`);
    }
    console.log("Registre phyto (lignes par année) :");
    console.table(r.phyto.map((p) => ({ ...p, ecart: p.fourmy - p.ekylibre })));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
