import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./shared";

/**
 * Captures des fonctionnalités pour le site fourmy.org (docs/site-public-
 * exigences.md, AU-6), sur la ferme de test viticole (données anonymisées).
 * Lancées à la demande, pas en CI :
 *   CAPTURES=1 DATABASE_URL=… pnpm --filter @fourmy/web exec playwright test e2e/captures.spec.ts
 * (API et application démarrées, comme pour le parcours e2e). Les images vont
 * dans apps/site/src/assets/captures/<nom>.png ; le site les convertit en WebP.
 */
test.skip(!process.env.CAPTURES, "Captures à la demande : CAPTURES=1");
test.describe.configure({ mode: "serial" });

const out = (name: string) => fileURLToPath(new URL(`../../site/src/assets/captures/${name}.png`, import.meta.url));
const snap = async (page: Page, name: string) => {
  // Pas de champ en cours de saisie sur les captures (date de la frise surlignée).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: out(name), animations: "disabled" });
};

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: /Ferme pilote — viticulture/ }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
});

test("tableau de bord (pleine saison), cuverie, stocks, registre (fin 2021)", async ({ page }) => {
  await page.getByLabel("Date de la frise").fill("2023-06-15");
  await expect(page.getByText(/Interventions des 30 derniers jours/)).toBeVisible();
  await snap(page, "tableau-de-bord");
  await page.getByLabel("Date de la frise").fill("2021-12-31");

  await page.getByRole("link", { name: "Cuverie" }).click();
  await expect(page.getByRole("meter")).toHaveCount(6);
  await page.getByRole("button", { name: "Contenu de Cuve 1" }).click();
  await expect(page.getByRole("dialog").getByText("30 hL", { exact: true })).toBeVisible();
  await snap(page, "cuverie");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Stocks" }).click();
  await expect(page.locator("table").first()).toBeVisible();
  await snap(page, "stocks");

  await page.getByRole("link", { name: "Registre phyto" }).click();
  await expect(page.getByText(/application\(s\) en 2021/)).toBeVisible();
  await snap(page, "registre");
});

test("carte et parcellaire", async ({ page }) => {
  await page.getByLabel("Date de la frise").fill("2023-06-15");
  await page.getByRole("link", { name: "Carte" }).click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByText(/9 parcelles/)).toBeVisible();
  // Tuiles IGN : laisser la photo aérienne se charger.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(2500);
  await snap(page, "carte");
});

test("formulaire d'intervention piloté par la forme (vendange)", async ({ page }) => {
  await page.getByLabel("Date de la frise").fill("2023-09-20");
  await page.getByRole("link", { name: "Interventions" }).click();
  await page.getByRole("button", { name: "Nouvelle intervention" }).click();
  const form = page.getByRole("dialog");
  await form.getByRole("combobox", { name: "Intervention" }).fill("Vendange manuelle");
  await page.getByRole("option", { name: "Vendange manuelle" }).click();
  await expect(form.getByPlaceholder(/Rangée où/).first()).toBeVisible();
  await snap(page, "intervention");
  await page.keyboard.press("Escape");
});

test("équipe et intégrations", async ({ page }) => {
  await page.getByRole("link", { name: "Équipe" }).click();
  await expect(page.getByRole("heading", { name: "Personnes" })).toBeVisible();
  await snap(page, "equipe");
  await page.getByRole("link", { name: "Intégrations" }).click();
  await expect(page.getByRole("heading", { name: /Traccar/ })).toBeVisible();
  await snap(page, "integrations");
});

test("plan 3D (relief et photo IGN, cuverie)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.getByLabel("Date de la frise").fill("2021-12-31");
  await page.getByRole("link", { name: "Plan 3D" }).click();
  await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/cuve\(s\) placée\(s\)/)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(6000);
  await snap(page, "plan-3d");
});
