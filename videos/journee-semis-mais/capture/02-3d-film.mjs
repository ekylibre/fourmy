// Rejeu du semis (×300) filmé en flux : la vue 3D de l'application agrandie en plein cadre.
import { mkdirSync, writeFileSync } from "node:fs";
import { open, FARM } from "./session.mjs";
const dir = new URL(`../assets/raw/${process.env.SHOT ?? "3d"}/`, import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const { browser, page } = await open("2026-04-16T19:00:00+02:00", { dpr: 1 });
await page.goto(`http://localhost:5180/f/${FARM}/3d-plan`);
await page.getByText("Rejeu du").waitFor({ timeout: 60000 });
await page.waitForTimeout(12000);
await page.getByRole("combobox", { name: "Matériel" }).click();
await page.getByRole("option", { name: "Claas Arion 430" }).click();
await page.getByRole("button", { name: "Charger" }).click();
// Caméra de l'application : drone en plongée sur toute la parcelle (ou CAMERA=Derrière…).
const cam = page.getByText(process.env.CAMERA ?? "Drone", { exact: true });
await cam.waitFor({ timeout: 60000 });
await cam.click();
await page.getByText(process.env.SPEED ?? "×300").click();
// Plein cadre : le conteneur Cesium recouvre la page (le rendu suit la taille du conteneur).
await page.evaluate(() => {
  const c = document.querySelector("canvas").closest("div[style*='72vh']");
  Object.assign(c.style, { position: "fixed", inset: "0", height: "100vh", width: "100vw", zIndex: 1000, borderRadius: "0" });
  document.querySelectorAll(".cesium-credit-lightbox-overlay").forEach((e) => e.remove());
});
await page.waitForTimeout(6000);
const N = Number(process.env.FRAMES ?? 60);
const FROM = Number(process.env.SKIP ?? 0); // secondes de rejeu à sauter (×300)
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Lecture"))?.click());
if (FROM) await page.waitForTimeout(FROM * 1000);
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
const view = { x: 0, y: 0, width: 1920, height: 1080 };
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  await page.clock.runFor(1000 / 30);
  await page.screenshot({ path: `${dir}f${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92, clip: view });
}
console.log("images", N, "en", ((Date.now() - t0) / 1000).toFixed(1), "s");
await browser.close();
