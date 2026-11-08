#!/usr/bin/env node
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { LEXICON_PACKAGES_URL, syncLexicon } from "@fourmy/lexicon";
import { db } from "./db.js";
import { dueIntegrations, syncIntegration } from "./integrations/repo.js";
import { syncFarmWater } from "./repos/phyto.js";
import { computeInterventionIft, pendingIft } from "./repos/ift.js";

/**
 * Worker : synchronise les intégrations actives de toutes les fermes
 * (Traccar : toutes les minutes). Une intégration en erreur est retentée au
 * tour suivant ; le verrou en base évite deux synchros simultanées (worker et
 * « Synchroniser maintenant »). Se lance à côté de l'API (même image).
 */
const EVERY_MS = Number(process.env.FOURMY_SYNC_EVERY_MS ?? 60_000);
let stopping = false;

// --- Réglementation phyto (lot 2) ---------------------------------------------

// Serveur public par défaut ; « off » pour ne pas synchroniser (tests, hors ligne).
const LEXICON_URL = process.env.FOURMY_LEXICON_PACKAGES_URL === "off" ? null : process.env.FOURMY_LEXICON_PACKAGES_URL || LEXICON_PACKAGES_URL;
const LEXICON_EVERY_MS = 24 * 3_600_000;
let lexiconCheckedAt = 0;

/** Référentiel Lexicon : vérifié chaque jour, rechargé seulement si une version est publiée. */
async function lexiconTick(): Promise<void> {
  if (!LEXICON_URL || Date.now() - lexiconCheckedAt < LEXICON_EVERY_MS) return;
  lexiconCheckedAt = Date.now();
  const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    for (const r of await syncLexicon(client, { base: LEXICON_URL })) {
      if (r.status === "loaded") console.log(`[worker] Lexicon ${r.name} ${r.version} chargé (${r.rows} lignes)`);
    }
  } finally {
    await client.end();
  }
}

/** Eau autour des fermes (BD TOPO) : jamais chargée, ou de plus de 30 jours. */
async function waterTick(): Promise<void> {
  const due = (await db().execute(sql`SELECT farm_id FROM fourmy_water_due()`)) as unknown as { farm_id: string }[];
  for (const { farm_id } of due) {
    if (stopping) return;
    const r = await syncFarmWater(db(), farm_id);
    console.log(`[worker] eau ferme ${farm_id.slice(0, 8)} : ${r.error ?? `${r.items} élément(s)`}`);
  }
}

/** IFT des traitements réalisés (API du ministère), par lots. */
async function iftTick(): Promise<void> {
  for (const { id, farm_id } of await pendingIft(db(), 20)) {
    if (stopping) return;
    const r = await computeInterventionIft(db(), farm_id, id);
    if (r.status === "pending") {
      console.warn(`[worker] IFT ${id.slice(0, 8)} en attente : ${r.error}`);
      return; // API indisponible : on réessaiera au prochain tour
    }
  }
}

async function tick(): Promise<void> {
  for (const [name, job] of [["lexicon", lexiconTick], ["eau", waterTick], ["ift", iftTick]] as const) {
    if (stopping) return;
    await job().catch((e) => console.warn(`[worker] ${name} : ${e instanceof Error ? e.message : e}`));
  }
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
