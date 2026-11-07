import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/fonctionnalites/", "/roadmap/", "/changelog/", "/contact/", "/mentions-legales/", "/donnees-personnelles/"];

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
  await expect(page.getByRole("heading", { name: /^Version \d+\.\d+\.\d+$/ }).first()).toBeVisible();
  await expect(page.locator(".release li").first()).toBeVisible();
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
