import { expect, test } from "@playwright/test";
import { login } from "./shared";

/**
 * Chantier à deux attelages (US-ATT-A, lot N4) sur la ferme pilote viticole :
 * Tractor 4 + Equipment 1 de 8 h à 10 h ; Equipment 2 + Equipment 5 de 9 h
 * à 12 h, sans conducteur connu. La fiche montre les deux attelages, un
 * chantier de 4 h et 5 h de travail.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const DAY = "2022-05-10";

test("saisir une intervention à deux attelages : chantier 4 h, travail 5 h", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();

  await page.goto(`/f/${FARM}/interventions/new?at=${DAY}`);
  const form = page.getByRole("form", { name: "Saisie de l'intervention" });
  await form.getByRole("combobox", { name: "Intervention" }).fill("Labour");
  await page.getByRole("group", { name: "Cultures" }).getByRole("option", { name: "Labour", exact: true }).click();
  await form.getByRole("combobox", { name: "Parcelles" }).click();
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");

  // Moyens en attelages : le premier reprend les moyens et la période du mode libre.
  await form.getByText("Attelages", { exact: true }).click();
  const pick = async (crew: string, field: "Matériels" | "Intervenants", name: string) => {
    await form.getByRole("group", { name: crew }).getByRole("combobox", { name: field }).click();
    await page.getByRole("option", { name, exact: true }).click();
    await page.keyboard.press("Escape");
  };
  const when = async (crew: string, from: string, to: string) => {
    const g = form.getByRole("group", { name: crew });
    await g.getByLabel("Début").fill(`${DAY}T${from}`);
    await g.getByLabel("Fin").fill(`${DAY}T${to}`);
  };
  await pick("Attelage 1", "Matériels", "Tractor 4");
  await pick("Attelage 1", "Matériels", "Equipment 1");
  await when("Attelage 1", "08:00", "10:00");

  await form.getByRole("button", { name: "Ajouter un attelage" }).click();
  await pick("Attelage 2", "Matériels", "Equipment 2");
  await pick("Attelage 2", "Matériels", "Equipment 5");
  await when("Attelage 2", "09:00", "12:00");

  // Synthèse en direct, puis enregistrement.
  await expect(form.getByLabel("Durées du chantier").first()).toContainText("temps de travail : 5 h");
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Intervention enregistrée.")).toBeVisible();

  // La fiche : un bloc par attelage, chantier de 4 h, 5 h de travail.
  await expect(page.getByRole("heading", { name: "Attelages", level: 4 })).toBeVisible();
  await expect(page.getByRole("group", { name: "Attelage 1" })).toContainText("Tractor 4");
  await expect(page.getByRole("group", { name: "Attelage 2" })).toContainText("conducteur inconnu");
  const summary = page.getByLabel("Durées du chantier");
  await expect(summary).toContainText("(4 h)");
  await expect(summary).toContainText("temps de travail : 5 h");
  expect(crashes).toEqual([]);
});
