// 18 h 50 : les papiers se sont faits tout seuls. Cahier de fertilisation (Lespourcy), registre phyto et IFT.
import { OUT, open, shot, FARM, BASE } from "./session.mjs";
const { browser, page } = await open("2026-04-16T18:50:00+02:00");
await page.goto(`${BASE}/f/${FARM}/print/fertilization/record?campaign=2026`);
const block = page.locator('[aria-label="Cahier Lespourcy Maïs 2026"]');
await block.waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);
await block.screenshot({ path: `${OUT}06-cahier-lespourcy.png` });
await block.scrollIntoViewIfNeeded();
await shot(page, "06-cahier-page");
await page.goto(`${BASE}/f/${FARM}/register`);
await page.getByRole("heading", { name: "Registre phytosanitaire" }).waitFor({ timeout: 30000 });
await page.waitForTimeout(5000);
await shot(page, "07-registre");
const ift = page.locator('[aria-label="Bilan IFT"]');
if (await ift.count()) {
  await ift.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await ift.screenshot({ path: `${OUT}07-ift.png` });
}
await browser.close();
