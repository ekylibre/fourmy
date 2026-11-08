import { expect, test, type Page } from "@playwright/test";
import { login } from "./shared";

/**
 * Outils carto communs (exigence CARTO-1) sur la ferme pilote viticole :
 * découper une parcelle, refusionner les morceaux, annuler, dessiner, mesurer.
 * Les surfaces affichées viennent de @fourmy/carto (identiques à PostGIS).
 */
const surfaces = (page: Page) => page.getByRole("heading", { name: /^Surfaces \(\d+\)$/ });
const count = async (page: Page) => Number((await surfaces(page).textContent())!.match(/\d+/)![0]);
const hectares = (text: string) => {
  const n = Number(text.replace(/\s/g, "").replace(",", ".").replace(/(ha|m²)$/, ""));
  return text.includes("m²") ? n / 10_000 : n;
};

test("outils carto : découper, fusionner, annuler, dessiner, mesurer", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));

  await login(page);
  await page.getByRole("link", { name: /Ferme pilote — viticulture/ }).click();
  await page.getByLabel("Date de la frise").fill("2023-06-15");
  await page.getByRole("link", { name: "Carte" }).click();
  await page.getByRole("link", { name: /Outils de dessin/ }).click();
  await expect(surfaces(page)).toHaveText("Surfaces (9)", { timeout: 30_000 });

  // Choisir une parcelle dans la liste : la carte se centre dessus.
  const rows = page.getByRole("table", { name: "Surfaces" }).locator("tbody tr");
  const first = rows.first();
  const name = (await first.locator("td").first().textContent())!;
  const area = hectares((await first.locator("td").last().textContent())!);
  await first.click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  const box = (await page.getByTestId("carto-map").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Découper : une ligne d'un bord à l'autre de la carte traverse la parcelle centrée.
  await page.getByText("Découper", { exact: true }).click();
  await page.mouse.click(box.x + 15, cy);
  await page.mouse.click(box.x + box.width - 15, cy + 4);
  await page.mouse.click(box.x + box.width - 15, cy + 4);
  await expect(surfaces(page)).toHaveText("Surfaces (10)");
  const pieces = page.getByRole("table", { name: "Surfaces" }).locator("tbody tr", { hasText: name });
  await expect(pieces).toHaveCount(2);
  const total = hectares((await pieces.nth(0).locator("td").last().textContent())!) + hectares((await pieces.nth(1).locator("td").last().textContent())!);
  expect(Math.abs(total - area)).toBeLessThan(0.0002); // arrondi d'affichage

  // Fusionner : les deux morceaux sont encore sélectionnés.
  await page.getByText("Fusionner", { exact: true }).click();
  await page.getByRole("button", { name: "Fusionner la sélection (2)" }).click();
  await expect(surfaces(page)).toHaveText("Surfaces (9)");
  await expect(page.getByRole("table", { name: "Surfaces" }).locator("tbody tr", { hasText: name })).toHaveCount(1);

  // Annuler revient aux deux morceaux.
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(surfaces(page)).toHaveText("Surfaces (10)");

  // Dessiner une nouvelle surface (triangle), fermée sur son premier point.
  await page.getByText("Dessiner", { exact: true }).click();
  const before = await count(page);
  await page.mouse.click(cx - 120, cy - 120);
  await page.mouse.click(cx - 40, cy - 120);
  await page.mouse.click(cx - 80, cy - 60);
  await page.mouse.click(cx - 120, cy - 120);
  await expect(surfaces(page)).toHaveText(`Surfaces (${before + 1})`);
  await expect(page.getByText("Nouvelle surface")).toBeVisible();

  // Mesurer une distance pendant le tracé.
  await page.getByText("Distance", { exact: true }).click();
  await page.mouse.click(cx - 100, cy + 80);
  await page.mouse.move(cx + 100, cy + 80, { steps: 5 });
  await expect(page.getByRole("status", { name: "Mesure" })).toContainText(/Distance : [\d\s,]+ (m|km)/);

  expect(crashes).toEqual([]);
});
