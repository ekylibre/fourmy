#!/usr/bin/env node
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { LEXICON_PACKAGES_URL, syncLexicon } from "@fourmy/lexicon";
import { db } from "./db.js";
import { dueIntegrations, syncIntegration } from "./integrations/repo.js";
import { syncFarmWater } from "./repos/phyto.js";
import { computeInterventionIft, pendingIft } from "./repos/ift.js";
import { fillInterventionWeather, pendingWeather } from "./repos/weather.js";
import { computeUsageDays, farmsWithTraccar } from "./repos/usage.js";
import { computeTrackSessions } from "./repos/track-sessions.js";
import { farmsWithAlerts } from "./repos/maintenance.js";
import { sendMaintenanceAlerts } from "./repos/alerts.js";
import { appMailer } from "./mail.js";
import { flushReads } from "./ign/store.js";
import { purgeIgnCache, runIgnJob } from "./ign/preload.js";
import { agrirouterClient, agrirouterConfig } from "./integrations/agrirouter.js";
import { confirmAgrirouterInbox, runAgrirouterListener } from "./integrations/agrirouter-events.js";
import { drainAgrirouterOutbox } from "./integrations/agrirouter-outbox.js";

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

/** Météo des interventions réalisées sans météo (historique Open-Meteo), par lots. */
async function weatherTick(): Promise<void> {
  // 10 par minute, une demi-seconde entre deux appels : l'historique de toutes
  // les fermes se complète en quelques heures sans saturer Open-Meteo.
  for (const { id, farm_id } of await pendingWeather(db(), 10)) {
    if (stopping) return;
    await fillInterventionWeather(db(), farm_id, id);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// --- Matériels (lot L) ------------------------------------------------------------

const USAGE_EVERY_MS = 15 * 60_000;
let usageAt = 0;
/** Heures de fonctionnement estimées depuis les positions Traccar (un relevé estimé par jour d'activité). */
async function usageTick(): Promise<void> {
  if (Date.now() - usageAt < USAGE_EVERY_MS) return;
  usageAt = Date.now();
  for (const farmId of await farmsWithTraccar(db())) {
    if (stopping) return;
    const r = await computeUsageDays(db(), farmId);
    if (r.days) console.log(`[worker] heures estimées ferme ${farmId.slice(0, 8)} : ${r.days} jour(s), ${r.equipments} matériel(s)`);
  }
}

// --- Parcours GPS (lot O) ------------------------------------------------------

const TRACKS_EVERY_MS = 5 * 60_000;
let tracksAt = 0;
/** Parcours (sessions de travail et déplacements) des boîtiers Traccar, toutes les 5 minutes. */
async function trackSessionsTick(): Promise<void> {
  if (Date.now() - tracksAt < TRACKS_EVERY_MS) return;
  tracksAt = Date.now();
  for (const farmId of await farmsWithTraccar(db())) {
    if (stopping) return;
    const r = await computeTrackSessions(db(), farmId);
    if (r.inserted || r.deleted || r.drifted)
      console.log(`[worker] parcours ferme ${farmId.slice(0, 8)} : ${r.inserted} calculé(s), ${r.deleted} remplacé(s), ${r.drifted} rattaché(s) en dérive`);
  }
}

const ALERTS_EVERY_MS = 60 * 60_000;
let alertsAt = 0;
/** Alertes d'entretien par e-mail, au plus une fois par heure. */
async function alertsTick(): Promise<void> {
  if (Date.now() - alertsAt < ALERTS_EVERY_MS) return;
  alertsAt = Date.now();
  for (const farmId of await farmsWithAlerts(db())) {
    if (stopping) return;
    const r = await sendMaintenanceAlerts(db(), farmId, appMailer(), { appUrl: process.env.BETTER_AUTH_URL });
    if (r.items) console.log(`[worker] alertes entretien ferme ${farmId.slice(0, 8)} : ${r.items} échéance(s)${r.skipped ? ` non envoyées (${r.skipped})` : `, ${r.sent} destinataire(s)`}`);
  }
}

// --- Cache IGN (« Ma ferme », lot F4) ---------------------------------------------

/** Préchargement des tuiles IGN : une tâche par tour, menée au bout (ou jusqu'à l'arrêt). */
async function ignCacheTick(): Promise<void> {
  const r = await runIgnJob(db(), () => stopping);
  if (r) console.log(`[worker] cache IGN tâche ${r.jobId.slice(0, 8)} : ${r.status}, ${r.fetched} téléchargée(s), ${r.failed} en échec`);
}

const IGN_PURGE_EVERY_MS = 24 * 3_600_000;
let ignPurgedAt = 0;
/** Quota disque du cache IGN, une fois par jour. */
async function ignPurgeTick(): Promise<void> {
  await flushReads(db());
  if (Date.now() - ignPurgedAt < IGN_PURGE_EVERY_MS) return;
  ignPurgedAt = Date.now();
  const r = await purgeIgnCache(db());
  if (r.deleted) console.log(`[worker] cache IGN : ${r.deleted} tuile(s) purgée(s), ${Math.round(r.freedBytes / 1e6)} Mo libérés`);
  if (r.protectedDeleted) console.warn(`[worker] cache IGN : quota atteint, ${r.protectedDeleted} tuile(s) d'un plan de ferme supprimée(s)`);
}

/**
 * agrirouter : reprend les envois en attente (lot AR3), puis confirme les
 * fichiers rangés dans la boîte de réception (lot AR2).
 */
async function agrirouterTick(): Promise<void> {
  const out = await drainAgrirouterOutbox(db());
  if (out.sent || out.partial || out.failed || out.queued) {
    console.log(`[worker] agrirouter : envois ${out.sent} parti(s), ${out.queued} toujours en attente, ${out.partial} partiel(s), ${out.failed} abandonné(s)`);
  }
  if (!agrirouterConfig()) return;
  const r = await confirmAgrirouterInbox(db(), agrirouterClient());
  if (r.confirmed || r.failed) console.log(`[worker] agrirouter : ${r.confirmed} fichier(s) confirmé(s)${r.failed ? `, ${r.failed} en échec` : ""}`);
}

async function tick(): Promise<void> {
  for (const [name, job] of [
    ["lexicon", lexiconTick],
    ["eau", waterTick],
    ["ift", iftTick],
    ["météo", weatherTick],
    ["heures", usageTick],
    ["parcours", trackSessionsTick],
    ["alertes", alertsTick],
    ["cache IGN", ignCacheTick],
    ["quota IGN", ignPurgeTick],
    ["agrirouter", agrirouterTick],
  ] as const) {
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

// Écoute permanente des événements agrirouter (lot AR2), à côté de la boucle.
const listenerStop = new AbortController();
const listener = agrirouterConfig()
  ? runAgrirouterListener({
      db: db(),
      databaseUrl: process.env.DATABASE_URL!,
      client: agrirouterClient,
      signal: listenerStop.signal,
      log: (m) => console.log(`[worker] agrirouter : ${m}`),
    }).catch((e: unknown) => console.error("[worker] agrirouter, écoute arrêtée :", e))
  : Promise.resolve();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    listenerStop.abort();
  });
}

console.log(`[worker] synchro des intégrations toutes les ${EVERY_MS / 1000} s`);
while (!stopping) {
  await tick().catch((e) => console.error("[worker]", e));
  for (let waited = 0; waited < EVERY_MS && !stopping; waited += 1000) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await listener;
process.exit(0);
