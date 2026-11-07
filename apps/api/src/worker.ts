#!/usr/bin/env node
import { db } from "./db.js";
import { dueIntegrations, syncIntegration } from "./integrations/repo.js";

/**
 * Worker : synchronise les intégrations actives de toutes les fermes
 * (Traccar : toutes les minutes). Une intégration en erreur est retentée au
 * tour suivant ; le verrou en base évite deux synchros simultanées (worker et
 * « Synchroniser maintenant »). Se lance à côté de l'API (même image).
 */
const EVERY_MS = Number(process.env.FOURMY_SYNC_EVERY_MS ?? 60_000);
let stopping = false;

async function tick(): Promise<void> {
  for (const due of await dueIntegrations(db(), `${Math.round(EVERY_MS / 1000)} seconds`)) {
    if (stopping) return;
    const started = Date.now();
    try {
      const result = await syncIntegration(db(), due.farm_id, due.id);
      console.log(
        `[worker] ${due.provider} ferme ${due.farm_id.slice(0, 8)} : ${result.status} en ${Date.now() - started} ms` +
          (result.lastError ? ` — ${result.lastError}` : ""),
      );
    } catch (e) {
      // Conflit (synchro manuelle en cours) ou erreur de base : tour suivant.
      console.warn(`[worker] ${due.provider} ferme ${due.farm_id.slice(0, 8)} : ${e instanceof Error ? e.message : e}`);
    }
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

console.log(`[worker] synchro des intégrations toutes les ${EVERY_MS / 1000} s`);
while (!stopping) {
  await tick().catch((e) => console.error("[worker]", e));
  for (let waited = 0; waited < EVERY_MS && !stopping; waited += 1000) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
process.exit(0);
