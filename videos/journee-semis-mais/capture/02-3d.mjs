// 8 h 15 – 10 h 45 : le semis de Lespourcy rejoué dans le plan 3D (tracteur suivi, ×300).
import { OUT, open, shot, FARM, IDS } from "./session.mjs";
const { browser, page } = await open("2026-04-16T19:00:00+02:00", { dpr: 1 });
await page.goto(`http://localhost:5180/f/${FARM}/3d-plan`);
await page.getByText("Rejeu du").waitFor({ timeout: 60000 });
await page.waitForTimeout(15000); // relief, orthophoto, bâtiments
await shot(page, "02-3d-avant");
await page.getByRole("combobox", { name: "Matériel" }).click();
await page.getByRole("option", { name: "Claas Arion 430" }).click();
await page.getByRole("button", { name: "Charger" }).click();
await page.getByText("Suivre le matériel").waitFor({ timeout: 60000 });
await page.getByLabel(/Suivre le matériel/).check({ force: true });
await page.waitForTimeout(8000);
await shot(page, "02-3d-page");
const view = page.locator("canvas").first();
await view.screenshot({ path: `${OUT}3d/f000.png` });
await page.getByRole("radio", { name: "×300" }).check({ force: true }).catch(() => page.getByText("×300").click());
await page.getByRole("button", { name: "Lecture" }).click();
for (let i = 1; i <= 40; i++) {
  await page.waitForTimeout(1000);
  await view.screenshot({ path: `${OUT}3d/f${String(i).padStart(3, "0")}.png` });
}
await shot(page, "02-3d-fin");
await browser.close();
