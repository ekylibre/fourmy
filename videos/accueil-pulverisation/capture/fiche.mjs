// Incrustation du haut de page : le pavé IFT de la fiche de la pulvérisation (voyants), 600 × 450.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { BASE, FARM } from "./session.mjs";
const require = createRequire(new URL("../../../apps/site/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const out = new URL("../../../apps/site/src/assets/captures/accueil-fiche-pulverisation.png", import.meta.url).pathname;
const pwd = /DEV_PASSWORD\s*=\s*"([^"]+)"/.exec(readFileSync(new URL("../../../apps/api/src/cli/seed-dev.ts", import.meta.url), "utf8"))[1];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "fr-FR", timezoneId: "Europe/Paris" })).newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel(/^E-mail/).fill("dev@fourmy.local");
await page.getByLabel(/^Mot de passe/).fill(pwd);
await page.getByRole("button", { name: "Se connecter" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
await page.goto(`${BASE}/f/${FARM}/interventions/68e602b1-a7db-4efa-a5e3-97fc522684f1`);
const ift = page.getByLabel("IFT", { exact: true });
await ift.getByRole("table").waitFor();
await ift.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
const b = await ift.boundingBox();
// Cadre 4:3 depuis le haut du pavé : titre, total et ses voyants, premières lignes.
const w = b.width, h = Math.min(b.height, (w * 3) / 4);
await page.screenshot({ path: out, clip: { x: b.x, y: b.y, width: w, height: h }, animations: "disabled" });
await browser.close();
console.log(out, w, h);
