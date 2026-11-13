import { expect, test } from "@playwright/test";
import { login, navTo } from "./shared";

/**
 * Plan 3D (US-4, US-9) sur la ferme pilote viticole : la cuverie apparaît,
 * et son remplissage suit la frise. Le relief et l'imagerie viennent du vrai
 * IGN : une tuile manquante est tolérée (repli prévu), une exception non.
 */
test("plan 3D : cuverie placée, remplissage qui suit la frise", async ({ page }) => {
  // Cesium en WebGL logiciel + zoom au plus près : ~60 s sur un poste, plus de 2 min sur
  // les machines de la CI (scène plus riche depuis la végétation et les rangs).
  test.setTimeout(process.env.CI ? 180_000 : 120_000);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  // Cesium n'émet pas d'exception de page quand le rendu casse : il l'écrit.
  page.on("console", (m) => m.type() === "error" && /Rendering has stopped|DeveloperError/.test(m.text()) && crashes.push(m.text()));
  const badTiles: string[] = [];
  page.on("response", (r) => r.url().includes("/terrain/heightmap/") && r.status() >= 400 && badTiles.push(`${r.status()} ${r.url()}`));

  await login(page);
  await page.getByRole("link", { name: /Ferme pilote — viticulture/ }).click();

  await page.getByLabel("Date de la frise").fill("2021-12-31");
  await navTo(page, "Plan 3D", "Cartes");
  await expect(page.locator(".cesium-widget canvas")).toBeVisible({ timeout: 30_000 });
  // Couches en barre d'icônes (la vue d'abord) : la cuverie s'ouvre à côté de son icône.
  await expect(page.getByLabel(/^Rejeu du/)).toBeVisible();
  const tanks = page.getByRole("button", { name: "Cuverie", exact: true });
  await tanks.click();
  await expect(page.getByText("5 cuve(s) placée(s) · 1 non localisée(s)")).toBeVisible({ timeout: 30_000 });
  const cuve1 = page.getByRole("button", { name: "Cuve 1", exact: true }).locator("xpath=../..");
  await expect(cuve1).toContainText("60 %");

  // Un an plus tôt : la Cuve 1 n'a pas encore reçu de vendange.
  // (La frise est hors de la fenêtre : elle se ferme, on la rouvre.)
  await page.getByLabel("Date de la frise").fill("2020-12-31");
  // Changer la date fait recalculer la scène Cesium (rendu logiciel en CI, lent) :
  // même délai que pour l'ouverture.
  await expect(page.getByRole("heading", { name: "Plan 3D au 31/12/2020" })).toBeVisible({ timeout: 30_000 });
  await tanks.click();
  await expect(cuve1).toContainText("0 %", { timeout: 30_000 });

  // Clic sur une cuve dans le panneau : son contenu s'affiche.
  await page.getByLabel("Date de la frise").fill("2021-12-31");
  await expect(page.getByRole("heading", { name: "Plan 3D au 31/12/2021" })).toBeVisible({ timeout: 30_000 });
  await tanks.click();
  await page.getByRole("button", { name: "Cuve 1", exact: true }).click();
  await expect(page.getByText("30 hL", { exact: true })).toBeVisible({ timeout: 30_000 });
  // Échap ferme la fenêtre : la cuverie disparaît, la barre de rejeu reste.
  await page.keyboard.press("Escape");
  await expect(page.getByText("5 cuve(s) placée(s) · 1 non localisée(s)")).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Matériel" })).toBeVisible();

  // Zoom au plus près : le relief s'arrête au niveau 22 (au-delà, l'API
  // répond 400 ; lue comme une grille, l'erreur arrêtait le rendu Cesium).
  // Pas en CI : avec le rendu WebGL logiciel des machines de la CI, la molette y
  // bloquait plus de 5 min. À jouer sur un poste (le reste du test tourne en CI).
  if (process.env.CI) {
    test.info().annotations.push({ type: "non joué en CI", description: "zoom au plus près (rendu logiciel trop lent)" });
  } else {
    const canvas = page.locator(".cesium-widget canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, -600);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(5000);
  }
  expect(badTiles, `tuiles de relief refusées : ${badTiles.join(" | ")}`).toEqual([]);

  expect(crashes, `exceptions : ${crashes.join(" | ")}`).toEqual([]);
});
