import { expect, test } from "@playwright/test";
import { E2E_USER } from "./shared";

/**
 * Plan 3D (US-4, US-9) sur la ferme pilote viticole : la cuverie apparaît,
 * et son remplissage suit la frise. Le relief et l'imagerie viennent du vrai
 * IGN : une tuile manquante est tolérée (repli prévu), une exception non.
 */
test("plan 3D : cuverie placée, remplissage qui suit la frise", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));

  await page.goto("/connexion");
  await page.getByLabel("Identifiant utilisateur").fill(E2E_USER);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("link", { name: /Ferme pilote — viticulture/ }).click();

  await page.getByLabel("Date de la frise").fill("2021-12-31");
  await page.getByRole("link", { name: "Plan 3D" }).click();
  await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("5 cuve(s) placée(s) · 1 non localisée(s)")).toBeVisible({ timeout: 30_000 });
  const cuve1 = page.getByRole("button", { name: "Cuve 1", exact: true }).locator("xpath=../..");
  await expect(cuve1).toContainText("60 %");

  // Un an plus tôt : la Cuve 1 n'a pas encore reçu de vendange.
  await page.getByLabel("Date de la frise").fill("2020-12-31");
  await expect(page.getByRole("heading", { name: "Plan 3D au 31/12/2020" })).toBeVisible();
  await expect(cuve1).toContainText("0 %");

  // Clic sur une cuve dans le panneau : son contenu s'affiche.
  await page.getByLabel("Date de la frise").fill("2021-12-31");
  await page.getByRole("button", { name: "Cuve 1", exact: true }).click();
  await expect(page.getByText("30 hL", { exact: true })).toBeVisible();

  expect(crashes, `exceptions : ${crashes.join(" | ")}`).toEqual([]);
});
