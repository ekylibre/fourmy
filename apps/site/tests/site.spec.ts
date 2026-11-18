import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/fonctionnalites/", "/comparatif/", "/changelog/", "/installer/", "/contact/", "/mentions-legales/", "/donnees-personnelles/"];

test("« Se connecter » en haut à droite mène à l'application", async ({ page }) => {
  await page.goto("/");
  const login = page.getByTestId("login");
  await expect(login).toBeVisible();
  await expect(login).toHaveAttribute("href", /^https:\/\/.+fourmy\.org/);
  const box = (await login.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x + box.width).toBeGreaterThan(viewport.width * 0.6);
  expect(box.y).toBeLessThan(120);
});

test("version et nouveautés calculées depuis l'historique", async ({ page }) => {
  await page.goto("/changelog/");
  const version = (await page.getByTestId("version").textContent())!.replace("Version ", "").trim();
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  // La version actuelle peut n'avoir aucune entrée publique (correctif masqué
  // par « Public: non ») : on vérifie seulement que des versions sont listées.
  await expect(page.getByRole("heading", { level: 2, name: /^\d+\.\d+\.\d+/ }).first()).toBeVisible();
  await expect(page.locator(".release li").first()).toBeVisible();
  // Chaque livraison a sa page, et le flux RSS la reprend.
  await page.getByRole("link", { name: /^Page de la version / }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^\d+\.\d+\.\d+/ })).toBeVisible();
  const rss = await page.request.get("/changelog/rss.xml");
  expect(rss.ok()).toBe(true);
  expect(await rss.text()).toContain("<item><title>");
  // Aucun jargon interne publié.
  await expect(page.locator("main")).not.toContainText(/agent [A-G0]\b|feat\(|sc:/);
});

test("formulaire de contact : champs, piège invisible, consentement", async ({ page }) => {
  await page.goto("/contact/");
  await expect(page.getByRole("textbox", { name: "Nom" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "E-mail" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeVisible();
  await expect(page.locator('input[name="website"]')).not.toBeInViewport();
  expect(Number(await page.locator("#startedAt").inputValue())).toBeGreaterThan(0);
});

for (const path of PAGES) {
  test(`accessibilité ${path}`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(violations.map((v) => `${v.id} : ${v.nodes.length}`)).toEqual([]);
  });
}

test("menu : comparatif, nouveautés et installer ; plus de roadmap", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link")).toHaveText(["Fonctionnalités", "Comparatif", "Nouveautés", "Installer", "Contact"]);
});

test("fonctionnalités rangées par module", async ({ page }) => {
  await page.goto("/fonctionnalites/");
  await expect(page.getByRole("navigation", { name: "Modules" }).getByRole("link").first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Réglementaire" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Contrôle réglementaire des traitements" })).toBeVisible();
});

test("comparatif : chaque case d'un autre logiciel renvoie à sa source", async ({ page }) => {
  await page.goto("/comparatif/");
  const table = page.getByRole("table");
  await expect(table.locator("thead").getByRole("columnheader")).toHaveText([/Critère/, /Fourmy/, /MesParcelles/, /Smag Farmer/, /Geofolia/]);
  await expect(table.getByRole("row").filter({ hasText: "Registre phytosanitaire" }).getByRole("link")).toHaveCount(4);
});
