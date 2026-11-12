// 18 h 40 : « Réaliser » le semis prévu, déjà rattaché au parcours GPS ; la fiche réalisée.
import { OUT, open, shot, FARM, BASE } from "./session.mjs";
const ID = process.env.PLANNED;
const { browser, page } = await open("2026-04-16T18:40:00+02:00");
await page.goto(`${BASE}/f/${FARM}/interventions/${ID}/complete`);
const save = page.getByRole("button", { name: "Enregistrer la réalisation" });
await save.waitFor({ timeout: 30000 });
await page.waitForTimeout(6000);
await shot(page, "04-realiser-haut");
await save.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await shot(page, "04-realiser-bas");
await save.click();
await page.waitForURL((u) => !u.pathname.endsWith("/complete"), { timeout: 30000 });
await page.waitForTimeout(8000); // carte, trace, contrôles
await shot(page, "05-fiche-realisee");
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(1500);
await shot(page, "05-fiche-realisee-2");
await page.evaluate(() => window.scrollTo(0, 1800));
await page.waitForTimeout(1500);
await shot(page, "05-fiche-realisee-3");
await browser.close();
