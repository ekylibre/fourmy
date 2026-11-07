#!/usr/bin/env node
import { parseArgs } from "node:util";
import { TraccarClient } from "./client.js";
import { syncTraccar } from "./sync.js";

/**
 * fourmy-traccar-sync --farm <uuid> [--since <ISO>] [--until <ISO>] [--full]
 * Environnement : DATABASE_URL, TRACCAR_URL, TRACCAR_TOKEN (ou BASIC).
 * Sans --since, un boîtier jamais synchronisé reprend 90 jours d'historique.
 */
const { values } = parseArgs({
  options: {
    farm: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    full: { type: "boolean", default: false },
  },
});
const url = process.env.DATABASE_URL;
if (!url || !values.farm) {
  console.error("usage: fourmy-traccar-sync --farm <uuid> [--since <ISO>] [--until <ISO>]");
  process.exit(2);
}
const since = values.since ? new Date(values.since) : new Date(Date.now() - 90 * 86_400_000);
const t0 = Date.now();
const report = await syncTraccar({
  targetUrl: url,
  farmId: values.farm,
  client: TraccarClient.fromEnv(),
  since,
  until: values.until ? new Date(values.until) : undefined,
  full: values.full,
});
console.log(`✓ ${report.inserted} positions insérées, ${report.updated} mises à jour en ${Math.round((Date.now() - t0) / 1000)} s`);
console.table(report.devices.map(({ deviceId, name, from, fetched, inserted, updated, invalid }) => ({
  deviceId, name, depuis: from.slice(0, 10), recues: fetched, inserees: inserted, maj: updated, invalides: invalid,
})));
for (const u of report.unmatched) console.log(`  ⚠ boîtier ${u.deviceId} « ${u.name} » non rattaché : ${u.reason}`);
