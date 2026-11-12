// 18 h 45 : la fiche du semis réalisé (trace, zone travaillée, contrôles, IFT).
import { open, shot, FARM, BASE } from "./session.mjs";
const ID = process.env.PLANNED;
const { browser, page } = await open("2026-04-16T18:45:00+02:00");
await page.goto(`${BASE}/f/${FARM}/interventions/${ID}`);
await page.getByText("Réalisée", { exact: true }).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(8000);
await shot(page, "05-fiche-realisee");
const h = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 900, k = 2; y < h; y += 900, k++) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(1500);
  await shot(page, `05-fiche-realisee-${k}`);
}
await browser.close();
