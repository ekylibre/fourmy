// Session de capture : navigateur figé à l'heure de la scène, connecté à la copie fourmy_video.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../../apps/site/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

export const FARM = "a94afd36-5aea-520f-b55f-60457f8a31e8";
export const BASE = "http://localhost:5180";
export const OUT = new URL("../assets/screens/", import.meta.url).pathname;
export const IDS = {
  lespourcy: "3a7cb748-4cbc-58b0-b7b7-2dac6d5afd0a",
  arion: "81e18bca-4578-5f8d-aba4-2ac4ce8541f6",
  monosem: "6a258567-3258-547a-b23b-0444195a36a3",
};
const env = Object.fromEntries(
  readFileSync(new URL("../../../.env.video.local", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")),
);

/** Ouvre un navigateur 1920 × 1080 (×2), horloge figée à `at` (heure de Paris), connecté. */
export async function open(at, { video, dpr } = {}) {
  const gpu = process.env.GPU_ARGS ? process.env.GPU_ARGS.split(" ") : ["--use-angle=gl", "--use-gl=angle"];
  const browser = await chromium.launch({ headless: process.env.HEADED ? false : true, args: [...gpu, "--ignore-gpu-blocklist"] });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: dpr ?? (video ? 1 : 2),
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    ...(video ? { recordVideo: { dir: video, size: { width: 1920, height: 1080 } } } : {}),
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(at) });
  await page.goto(`${BASE}/login`);
  await page.getByLabel("E-mail").fill(env.RECETTE_EMAIL);
  await page.getByLabel("Mot de passe").fill(env.RECETTE_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return { browser, context, page };
}
export const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}${name}.png`, ...opts });
