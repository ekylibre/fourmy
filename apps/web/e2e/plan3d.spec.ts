import { expect, test } from "@playwright/test";
import { login } from "./shared";

/**
 * Plan 3D (US-4, US-9) sur la ferme pilote viticole : la cuverie apparaît,
 * et son remplissage suit la frise. Le relief et l'imagerie viennent du vrai
 * IGN : une tuile manquante est tolérée (repli prévu), une exception non.
 */
test("plan 3D : cuverie placée, remplissage qui suit la frise", async ({ page }) => {
  test.setTimeout(120_000); // Cesium en WebGL logiciel + zoom au plus près : ~60 s
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  // Cesium n'émet pas d'exception de page quand le rendu casse : il l'écrit.
  page.on("console", (m) => m.type() === "error" && /Rendering has stopped|DeveloperError/.test(m.text()) && crashes.push(m.text()));
  const badTiles: string[] = [];
  page.on("response", (r) => r.url().includes("/terrain/heightmap/") && r.status() >= 400 && badTiles.push(`${r.status()} ${r.url()}`));

  await login(page);
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
  await page.keyboard.press("Escape");

  // Zoom au plus près : le relief s'arrête au niveau 22 (au-delà, l'API
  // répond 400 ; lue comme une grille, l'erreur arrêtait le rendu Cesium).
  const canvas = page.locator(".cesium-widget canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(5000);
  expect(badTiles, `tuiles de relief refusées : ${badTiles.join(" | ")}`).toEqual([]);

  expect(crashes, `exceptions : ${crashes.join(" | ")}`).toEqual([]);
});
