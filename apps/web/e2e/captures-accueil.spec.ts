import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * Captures de la page d'accueil de fourmy.org, sur la ferme de grandes
 * cultures de Pierre (accord écrit pour des captures publiques, voir
 * docs/site-public-exigences.md §6.1) : vue 3D d'un attelage au travail avec
 * le NDVI, interopérabilité, réglementaire, parcellaire. À la demande :
 *   CAPTURES=1 CAPTURES_FARM=<ferme> E2E_BASE_URL=http://localhost:5180 \
 *     pnpm --filter @fourmy/web exec playwright test e2e/captures-accueil.spec.ts
 * Connexion avec le compte de développement de seed:dev (responsable de la ferme).
 */
test.skip(!process.env.CAPTURES || !process.env.CAPTURES_FARM, "Captures à la demande : CAPTURES=1 CAPTURES_FARM=<ferme>");
test.describe.configure({ mode: "serial" });

const FARM = process.env.CAPTURES_FARM!;
const DAY = "2026-10-05";
const out = (name: string) =>
  process.env.OUT_DIR ? `${process.env.OUT_DIR}/${name}.png` : fileURLToPath(new URL(`../../site/src/assets/captures/${name}.png`, import.meta.url));
const devPassword = () => /DEV_PASSWORD\s*=\s*"([^"]+)"/.exec(readFileSync(new URL("../../api/src/cli/seed-dev.ts", import.meta.url), "utf8"))![1]!;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/^E-mail/).fill("dev@fourmy.local");
  await page.getByLabel(/^Mot de passe/).fill(devPassword());
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/farms|\/f\//);
}
const snap = async (page: Page, name: string) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await page.screenshot({ path: out(name), animations: "disabled" });
};

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("vue 3D : l'Arion 430 et sa herse dans le maïs, NDVI et couches du jumeau", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/f/${FARM}/3d-plan?at=${DAY}&sat=ndvi`);
  await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(8000);
  await page.getByRole("combobox", { name: "Matériel" }).click();
  await page.getByRole("combobox", { name: "Matériel" }).fill("Arion 430");
  await page.getByRole("option", { name: "Claas Arion 430" }).click();
  await page.getByRole("button", { name: "Charger" }).click();
  const replay = page.getByLabel(/^Rejeu du/);
  const slider = replay.getByRole("slider");
  await expect(slider).toBeVisible({ timeout: 30_000 });
  // 16 h 48 à Paris : la herse rotative travaille dans le maïs.
  const [min, max] = [Number(await slider.getAttribute("aria-valuemin")), Number(await slider.getAttribute("aria-valuemax"))];
  const target = Date.parse(`${DAY}T14:48:00Z`);
  const box = (await replay.locator(".mantine-Slider-root").boundingBox())!; // la piste entière, pas le curseur
  await page.mouse.click(box.x + ((target - min) / (max - min)) * box.width, box.y + box.height / 2);
  // Plein écran : la vue occupe toute la fenêtre (repli sans l'API plein écran).
  await page.getByRole("button", { name: "Plein écran" }).click();
  // Grand angle : le NDVI sur les parcelles, le trajet recalé sur la route, l'attelage.
  await page.getByText("Drone", { exact: true }).click();
  await page.waitForTimeout(12_000); // relief, photo, NDVI et modèles chargés
  await snap(page, "accueil-3d");
  // Au plus près : l'Arion 430 et sa herse rotative dans les rangs de chaumes.
  await page.getByText("Derrière", { exact: true }).click();
  await page.waitForTimeout(10_000);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: out("accueil-3d-attelage"), clip: { x: 500, y: 170, width: 600, height: 450 }, animations: "disabled" });
});

test("interopérabilité : attelage et parcours tirés du GPS, trace sur la photo IGN", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/interventions/68e602b1-a7db-4efa-a5e3-97fc522684f1?at=${DAY}`);
  await expect(page.getByRole("heading", { name: "Parcours GPS rattachés (1)" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  await snap(page, "accueil-interoperabilite");
});

test("réglementaire : fiche d'un traitement, pictogrammes, ZNT, contrôle des doses et des usages", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/interventions/a30376ac-2355-5806-a857-cf57f1814328?at=2026-05-23`);
  await expect(page.getByRole("heading", { name: "Contrôle réglementaire" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  await snap(page, "accueil-reglementaire");
});

test("parcellaire : fiche d'une parcelle, culture, PAC et cadastre, photo IGN", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/land-parcels/74f04f4a-0b2c-57da-98ee-dd5a234a5602?at=${DAY}`);
  await expect(page.getByRole("heading", { name: "Monassut Maïs 2026" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  await snap(page, "accueil-parcellaire");
});

test("équipe : temps de travaux d'une personne, d'après les interventions", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/team/024e1cc6-fc53-5ad7-977a-3e22bca6df6c?at=${DAY}&tab=work`);
  await expect(page.getByRole("heading", { name: "Heures par mois" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(4000);
  await snap(page, "equipe-temps");
});
