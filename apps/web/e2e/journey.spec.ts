import { expect, test } from "@playwright/test";
import { login, navTo } from "./shared";

/**
 * Parcours de la tranche (docs/workflow.md, agent E) sur la ferme pilote
 * viticole, données réelles anonymisées : connexion → ferme → cuverie dans le
 * passé → carte → saisie d'un traitement → registre phyto → annulation.
 */
test("connexion, cuverie dans le temps, carte, intervention jusqu'au registre", async ({ page }) => {
  const errors: string[] = [];
  // Les serveurs de tuiles de l'IGN (Géoplateforme) répondent par moments 400 puis servent
  // la tuile : ces erreurs-là ne disent rien de Fourmy et ne font pas échouer le parcours.
  const ign = (s: string) => s.includes("data.geopf.fr");
  page.on("pageerror", (e) => !ign(e.message) && errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && !ign(m.text()) && errors.push(m.text()));
  // Ressources en échec : on veut l'URL (la console ne la donne pas).
  page.on("response", (r) => r.status() >= 400 && !ign(r.url()) && errors.push(`HTTP ${r.status()} ${r.url()}`));

  // Connexion de développement puis choix de la ferme.
  await login(page);
  await page.getByRole("link", { name: /Ferme pilote — viticulture/ }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();

  // La frise ramène à fin 2021 : 6 cuves, Cuve 1 à 30 hL de Cabernet-Sauvignon.
  await page.getByLabel("Date de la frise").fill("2021-12-31");
  await navTo(page, "Cuverie", "Stocks");
  await expect(page).toHaveURL(/cellar\?at=2021-12-31/);
  await expect(page.getByRole("meter")).toHaveCount(6);
  await page.getByRole("button", { name: "Contenu de Cuve 1" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("30 hL", { exact: true })).toBeVisible();
  await expect(drawer.getByText("CABERNET-SAUVIGNON N").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Carte : MapLibre se charge (worker compris), parcelles affichées.
  await navTo(page, "Plan 2D", "Cartes");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByText(/9 parcelles/)).toBeVisible();

  // Saisie d'un traitement réalisé le 15 juin 2023, puis registre de 2023.
  await page.getByLabel("Date de la frise").fill("2023-06-15");
  await navTo(page, "Registre phyto", "Réglementaire");
  const before = Number((await page.getByText(/application\(s\) en 2023/).textContent())!.match(/\d+/)![0]);

  await page.getByRole("link", { name: "Interventions" }).click();
  await page.getByRole("button", { name: "Nouvelle intervention" }).click();
  const form = page.getByRole("form", { name: "Saisie de l'intervention" });
  // La forme « traitement » de la procédure guide la saisie (produits phyto, motifs).
  await form.getByRole("combobox", { name: "Intervention" }).fill("sans fertilisation");
  await page.getByRole("option", { name: "Pulvérisation (sans fertilisation)" }).click();
  await form.getByRole("combobox", { name: "Parcelles" }).click();
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape"); // ferme la liste, pas le formulaire
  await form.getByRole("combobox", { name: "Produit", exact: true }).click();
  await page.getByRole("option", { name: /AMM/ }).first().click();
  await form.getByRole("textbox", { name: "Quantité" }).fill("1,5");
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Intervention enregistrée.")).toBeVisible();

  await navTo(page, "Registre phyto", "Réglementaire");
  await expect(page.getByText(`${before + 1} application(s) en 2023.`)).toBeVisible();

  // Saisie erronée : on l'annule avec un motif, elle sort du registre.
  await page.getByRole("link", { name: "Interventions" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Pulvérisation (sans fertilisation)" })
    .filter({ hasText: "Réalisée" })
    .filter({ hasNotText: "Ekylibre" }) // celle saisie à l'instant, pas une reprise
    .getByRole("button", { name: /^Actions/ })
    .click();
  await page.getByRole("menuitem", { name: "Annuler…" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("textbox", { name: "Motif" }).fill("essai de bout en bout");
  await modal.getByRole("button", { name: "Annuler l'intervention" }).click();
  await expect(page.getByText("Intervention annulée.")).toBeVisible();
  await navTo(page, "Registre phyto", "Réglementaire");
  await expect(page.getByText(`${before} application(s) en 2023.`)).toBeVisible();

  expect(errors, `erreurs navigateur : ${errors.join(" | ")}`).toEqual([]);
});
