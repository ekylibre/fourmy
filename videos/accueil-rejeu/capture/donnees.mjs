// Données des incrustations : intervention du 05/10, conformité, matériels, parcelles, trace GPS.
//   node capture/donnees.mjs  → assets/data/intervention.json
//   INTERVENTION=<id> DAY=2026-10-28 DATA=broyage node capture/donnees.mjs  → assets/data/broyage.json
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { BASE, FARM } from "./session.mjs";
const require = createRequire(new URL("../../../apps/site/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const ID = process.env.INTERVENTION ?? "68e602b1-a7db-4efa-a5e3-97fc522684f1";
const DAY = process.env.DAY ?? "2026-10-05";
const OUT = process.env.DATA ?? "intervention";
const pwd = /DEV_PASSWORD\s*=\s*"([^"]+)"/.exec(readFileSync(new URL("../../../apps/api/src/cli/seed-dev.ts", import.meta.url), "utf8"))[1];
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel(/^E-mail/).fill("dev@fourmy.local");
await page.getByLabel(/^Mot de passe/).fill(pwd);
await page.getByRole("button", { name: "Se connecter" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
const data = await page.evaluate(async ({ FARM, ID, DAY }) => {
  const get = async (p) => { const r = await fetch(`/api/v1/farms/${FARM}${p}`); return r.ok ? r.json() : { error: r.status, p }; };
  const i = await get(`/interventions/${ID}`);
  const out = { intervention: i };
  out.compliance = await get(`/interventions/${ID}/compliance`);
  out.snapshot = await get(`/snapshot?at=${DAY}`);
  out.articles = await get(`/articles`);
  // Trace du tracteur de l'attelage, de 30 min avant le début à 10 min après la fin.
  const kinds = new Map(out.snapshot.equipments.map((e) => [e.id, e.kind]));
  const tools = (i.crews[0]?.tools ?? i.tools).map((t) => t.equipmentId);
  const tractor = tools.find((id) => kinds.get(id) === "tractor") ?? tools[0];
  const from = new Date(Date.parse(i.startedAt) - 30 * 60000).toISOString();
  const to = new Date(Date.parse(i.stoppedAt) + 10 * 60000).toISOString();
  out.tractor = tractor;
  out.track = await get(`/tracks?equipment=${tractor}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  return out;
}, { FARM, ID, DAY });
writeFileSync(new URL(`../assets/data/${OUT}.json`, import.meta.url), JSON.stringify(data, null, 1));
await browser.close();
for (const [k, v] of Object.entries(data)) console.log(k, JSON.stringify(v).length, v?.error ? JSON.stringify(v) : "");
