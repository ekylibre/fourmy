import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { login, navTo } from "./shared";

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

  await navTo(page, "Cuverie", "Stocks");
  await expect(page.getByRole("meter")).toHaveCount(6);
  await page.getByRole("button", { name: "Contenu de Cuve 1" }).click();
  await expect(page.getByRole("dialog").getByText("30 hL", { exact: true })).toBeVisible();
  await snap(page, "cuverie");
  await page.keyboard.press("Escape");

  await navTo(page, "État des stocks", "Stocks");
  await expect(page.locator("table").first()).toBeVisible();
  await snap(page, "stocks");

  await navTo(page, "Registre phyto", "Réglementaire");
  await expect(page.getByText(/application\(s\) en 2021/)).toBeVisible();
  await snap(page, "registre");
});

test("carte et parcellaire", async ({ page }) => {
  await page.getByLabel("Date de la frise").fill("2023-06-15");
  await navTo(page, "Plan 2D", "Cartes");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByText(/9 parcelles/)).toBeVisible();
  // Tuiles IGN : laisser la photo aérienne se charger.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await snap(page, "carte");
});

test("formulaire d'intervention piloté par la forme (vendange)", async ({ page }) => {
  await page.getByLabel("Date de la frise").fill("2023-09-20");
  await page.getByRole("link", { name: "Interventions" }).click();
  await page.getByRole("button", { name: "Nouvelle intervention" }).click();
  const form = page.getByRole("form", { name: "Saisie de l'intervention" });
  await form.getByRole("combobox", { name: "Intervention" }).fill("Vendange manuelle");
  await page.getByRole("option", { name: "Vendange manuelle" }).click();
  await expect(form.getByPlaceholder(/Rangée où/).first()).toBeVisible();
  await snap(page, "intervention");
  await page.keyboard.press("Escape");
});

test("semaine des travaux (calendrier) et fiche d'intervention", async ({ page }) => {
  await page.getByLabel("Date de la frise").fill("2021-06-30");
  await page.getByRole("link", { name: "Interventions" }).click();
  await page.getByText("Calendrier", { exact: true }).click();
  await expect(page.getByRole("region", { name: /Mardi 29 juin/ }).getByRole("article").first()).toBeVisible();
  await snap(page, "interventions-semaine");

  await page.getByText("Liste", { exact: true }).click();
  await page.getByRole("row").filter({ hasText: "Pulvérisation" }).first().click();
  await expect(page.getByRole("heading", { name: "Historique" })).toBeVisible();
  // Mini-carte : laisser la photo aérienne se charger.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await snap(page, "intervention-fiche");
});

test("parcelles choisies sur la carte, zone partielle", async ({ page }) => {
  test.setTimeout(90_000);
  await page.getByLabel("Date de la frise").fill("2023-06-15");
  await page.getByRole("link", { name: "Interventions" }).click();
  await page.getByRole("button", { name: "Nouvelle intervention" }).click();
  const form = page.getByRole("form", { name: "Saisie de l'intervention" });
  await form.getByRole("combobox", { name: "Intervention" }).fill("sans fertilisation");
  await page.getByRole("option", { name: "Pulvérisation (sans fertilisation)" }).click();
  await form.getByText("Carte", { exact: true }).click();
  const map = form.getByTestId("parcel-picker-map");
  await expect(form.getByRole("button", { name: "Zone partielle" })).toBeEnabled({ timeout: 30_000 });
  const box = (await map.boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await form.getByRole("button", { name: "Voir Parcelle 008 sur la carte" }).click();
  await form.getByRole("button", { name: "Zone partielle" }).click();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const [dx, dy] of [[-60, -40], [50, -55], [70, 35], [-45, 50], [-60, -40]] as const) await page.mouse.click(cx + dx, cy + dy);
  await expect(form.getByText(/^zone .* sur .* ha$/)).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await snap(page, "intervention-carte");
  await page.keyboard.press("Escape");
});

test("contrôle réglementaire d'un traitement (référentiel E-Phy chargé)", async ({ page }) => {
  await page.getByLabel("Date de la frise").fill("2023-06-15");
  await page.getByRole("link", { name: "Interventions" }).click();
  await page.getByRole("button", { name: "Nouvelle intervention" }).click();
  const form = page.getByRole("form", { name: "Saisie de l'intervention" });
  await form.getByRole("combobox", { name: "Intervention" }).fill("sans fertilisation");
  await page.getByRole("option", { name: "Pulvérisation (sans fertilisation)" }).click();
  await form.getByRole("combobox", { name: "Parcelles" }).click();
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await form.getByRole("combobox", { name: "Produit", exact: true }).click();
  await page.getByRole("option", { name: /AMM/ }).first().click();
  await form.getByRole("textbox", { name: "Quantité" }).fill("3");
  await expect(form.getByRole("list", { name: /^Contrôle de / }).getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });
  await form.getByRole("list", { name: /^Contrôle de / }).scrollIntoViewIfNeeded();
  await snap(page, "controle-phyto");
  await page.keyboard.press("Escape");
});

test("conditions de pulvérisation (tableau de bord du jour)", async ({ page }) => {
  await expect(page.getByLabel("Conditions de pulvérisation")).toBeVisible({ timeout: 20_000 });
  await snap(page, "meteo");
});

test("équipe et intégrations", async ({ page }) => {
  await page.getByRole("link", { name: "Équipe" }).click();
  await expect(page.getByRole("heading", { name: "Personnes" })).toBeVisible();
  await snap(page, "equipe");
  await navTo(page, "Intégrations", "Interopérabilité");
  await expect(page.getByRole("heading", { name: /Traccar/ })).toBeVisible();
  await snap(page, "integrations");
});

test("plan 3D (relief et photo IGN, cuverie)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.getByLabel("Date de la frise").fill("2021-12-31");
  await navTo(page, "Plan 3D", "Cartes");
  await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/cuve\(s\) placée\(s\)/)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(6000);
  await snap(page, "plan-3d");
});

test("matériels et avatar 3D d'un tracteur", async ({ page }) => {
  test.setTimeout(120_000);
  await page.getByRole("link", { name: "Matériels", exact: true }).click();
  await expect(page.getByRole("table", { name: "Matériels" })).toBeVisible();
  await snap(page, "materiels");
  // Premier tracteur de la liste : onglet 3D (avatar généré d'après le kit).
  const tractor = page.getByRole("row").filter({ hasText: "Tracteur" }).first().getByRole("link").first();
  await tractor.click();
  await page.getByRole("tab", { name: "3D" }).click();
  await expect(page.getByLabel("Aperçu 3D").locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  await snap(page, "avatar-3d");
});
