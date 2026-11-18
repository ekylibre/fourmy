// Session de capture : application de dev (Vite, port 5173), ferme de Pierre, compte de seed:dev.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../../apps/site/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

export const FARM = "a94afd36-5aea-520f-b55f-60457f8a31e8";
export const ARION = "81e18bca-4578-5f8d-aba4-2ac4ce8541f6";
export const BASE = process.env.BASE ?? "http://localhost:5173";
const devPassword = /DEV_PASSWORD\s*=\s*"([^"]+)"/.exec(readFileSync(new URL("../../../apps/api/src/cli/seed-dev.ts", import.meta.url), "utf8"))[1];

/** Navigateur 1920 × 1080 connecté, sur le rejeu 3D d'un matériel (`t` : instant ISO ; par défaut l'Arion au 05/10). */
export async function openReplay(t, { jour = "2026-10-05", equipment = ARION } = {}) {
  const gpu = process.env.GPU_ARGS ? process.env.GPU_ARGS.split(" ") : ["--use-angle=gl", "--use-gl=angle"];
  const browser = await chromium.launch({ headless: !process.env.HEADED, args: [...gpu, "--ignore-gpu-blocklist"] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/^E-mail/).fill("dev@fourmy.local");
  await page.getByLabel(/^Mot de passe/).fill(devPassword);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`${BASE}/f/${FARM}/3d-plan?at=${jour}&equipment=${equipment}&t=${encodeURIComponent(t)}&replay=1`);
  await page.waitForFunction(() => globalThis.fourmyScene?.viewer?.entities.getById("track:vehicle"), null, { timeout: 120000 });
  // Plein cadre : la coque du plan 3D recouvre la page, sans les crédits ni les commandes.
  await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="plan3d-shell"]');
    Object.assign(shell.style, { position: "fixed", inset: "0", zIndex: 1000, borderRadius: "0", height: "100vh" });
    for (const el of shell.children) if (!el.querySelector("canvas")) el.style.display = "none";
    document.querySelectorAll(".cesium-viewer-bottom, .cesium-credit-lightbox-overlay").forEach((e) => (e.style.display = "none"));
  });
  return { browser, page };
}

/** Attend que le relief, les photos et les modèles soient chargés à l'image courante. */
export async function settle(page, maxMs = 20000) {
  await page.evaluate(async (maxMs) => {
    const v = globalThis.fourmyScene.viewer;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const check = () => {
        v.scene.requestRender();
        if ((v.scene.globe.tilesLoaded && performance.now() - t0 > 300) || performance.now() - t0 > maxMs) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  }, maxMs);
}
