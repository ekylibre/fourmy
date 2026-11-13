import { expect, test } from "@playwright/test";
import { login } from "./shared";

/**
 * Saisie sur carte (exigence INT-UI-6) sur la ferme pilote viticole :
 * plusieurs parcelles d'un coup (Maj + glisser), une zone partielle dessinée
 * dans l'une, la dose totale calculée sur la surface réellement traitée.
 * Date à l'écart des autres parcours (mai 2022).
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const ha = (text: string) => Number(text.replace(/\s/g, "").replace(",", "."));

test("choisir les parcelles sur la carte et dessiner une zone partielle", async ({ page }) => {
  test.setTimeout(90_000);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();
  await page.goto(`/f/${FARM}/interventions?at=2022-05-18`);

  await page.getByRole("button", { name: "Nouvelle intervention" }).click();
  const form = page.getByRole("form", { name: "Saisie de l'intervention" });
  await form.getByRole("combobox", { name: "Intervention" }).fill("avec fertilisation");
  await page.getByRole("option", { name: "Pulvérisation (avec fertilisation)" }).click();
  await form.getByText("Carte", { exact: true }).click();
  const map = form.getByTestId("parcel-picker-map");
  await expect(map).toBeVisible();
  await expect(form.getByRole("button", { name: "Zone partielle" })).toBeEnabled({ timeout: 30_000 });
  const box = (await map.boundingBox())!;

  // Maj + glisser sur toute la carte : toutes les parcelles visibles.
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(form.getByText(/9 parcelle\(s\)/)).toBeVisible();
  const full = ha((await form.getByText(/9 parcelle\(s\)/).textContent())!.match(/(\d[\d\s]*,\d+) ha traités/)![1]!);

  // Zone partielle dans la plus grande parcelle (Parcelle 008, ~2 ha).
  await form.getByRole("button", { name: "Voir Parcelle 008 sur la carte" }).click();
  await form.getByRole("button", { name: "Zone partielle" }).click();
  // Re-mesurer : cliquer « Voir… » sous la carte fait défiler la page, la
  // carte n'est plus là où elle était au Maj + glisser.
  await map.scrollIntoViewIfNeeded();
  const zbox = (await map.boundingBox())!;
  const cx = zbox.x + zbox.width / 2;
  const cy = zbox.y + zbox.height / 2;
  for (const [dx, dy] of [[-30, -25], [30, -25], [30, 25], [-30, 25], [-30, -25]] as const) await page.mouse.click(cx + dx, cy + dy);
  const zone = form.getByText(/^zone .* sur .* ha$/);
  await expect(zone).toBeVisible();
  const [zoneHa, parcelHa] = (await zone.textContent())!.match(/[\d,]+(?= ha)/g)!.map(ha) as [number, number];
  expect(zoneHa).toBeGreaterThan(0);
  expect(zoneHa).toBeLessThan(parcelHa);
  // La surface traitée tient compte de la zone.
  const treated = ha((await form.getByText(/9 parcelle\(s\)/).textContent())!.match(/(\d[\d\s]*,\d+) ha traités/)![1]!);
  expect(treated).toBeCloseTo(full - parcelHa + zoneHa, 1);

  // Produit, dose par hectare : le total affiché suit la surface traitée.
  await form.getByRole("combobox", { name: "Produit", exact: true }).first().click();
  await page.getByRole("option", { name: /AMM/ }).first().click();
  await form.getByRole("textbox", { name: "Quantité" }).first().fill("2");
  await expect(form.getByText(/≈ .* au total sur/)).toBeVisible();
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Intervention enregistrée.")).toBeVisible();

  // Après l'enregistrement, la fiche : surface travaillée de la parcelle 008.
  await expect(page.getByRole("heading", { name: "Historique" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Cibles" }).getByRole("row").filter({ hasText: "Parcelle 008" })).toContainText("surface travaillée");
  expect(crashes).toEqual([]);
});
