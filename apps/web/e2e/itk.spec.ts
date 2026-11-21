import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "./shared";

/**
 * Itinéraires techniques (lot IT1) : le responsable crée un ITK depuis
 * Activités › Itinéraires techniques, ajoute ses étapes, enregistre, et voit
 * l'aperçu sur la frise TIKA.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const tag = crypto.randomUUID().slice(0, 6);
const NAME = `Blé tendre — Le Champ — e2e ${tag}`;
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

test.afterAll(async () => {
  await sql`DELETE FROM technical_itineraries WHERE farm_id = ${FARM} AND name LIKE ${`%e2e ${tag}%`}`;
  await sql.end();
});

test("itinéraire technique : création, étapes, enregistrement, aperçu sur la frise", async ({ page }) => {
  test.setTimeout(120_000);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();

  await page.goto(`/f/${FARM}/activities`);
  await page.getByRole("link", { name: "Itinéraires techniques" }).click();
  await expect(page.getByRole("heading", { name: "Itinéraires techniques" })).toBeVisible();
  await page.getByRole("button", { name: "Nouvel itinéraire" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Nom").fill(NAME);
  await modal.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  const steps: { procedure: string; anchor: "Par rapport au semis" | "Par rapport à la récolte"; days: string }[] = [
    { procedure: "Déchaumage", anchor: "Par rapport au semis", days: "-30" },
    { procedure: "Labour", anchor: "Par rapport au semis", days: "-10" },
    { procedure: "Semis", anchor: "Par rapport au semis", days: "0" },
    { procedure: "Moisson", anchor: "Par rapport à la récolte", days: "0" },
    { procedure: "Broyage des résidus de culture", anchor: "Par rapport à la récolte", days: "5" },
  ];
  for (const s of steps) {
    await page.getByRole("button", { name: "Ajouter une étape" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: /Procédure/ }).fill(s.procedure);
    await page.getByRole("option", { name: s.procedure, exact: true }).first().click();
    await dialog.getByText(s.anchor, { exact: true }).click();
    await dialog.getByLabel("Jours (négatif : avant)").fill(s.days);
    await dialog.getByRole("button", { name: "Ajouter l'étape" }).click();
    await expect(dialog).toBeHidden();
  }
  const table = page.getByRole("table", { name: "Étapes de l'itinéraire" });
  await expect(table.getByRole("row")).toHaveCount(6); // en-tête + 5 étapes
  await expect(table).toContainText("semis J-30");
  await expect(table).toContainText("récolte J+5");

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Itinéraire enregistré.")).toBeVisible();
  await expect(page.getByText(/révision 1/)).toBeVisible();

  // Aperçu TIKA : frise dessinée.
  await expect(page.getByTestId("tika-chart").locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  // Relecture : l'ITK est enregistré avec ses 5 étapes.
  await page.reload();
  await expect(page.getByRole("table", { name: "Étapes de l'itinéraire" }).getByRole("row")).toHaveCount(6);
  await page.goto(`/f/${FARM}/itineraries`);
  await expect(page.getByRole("table", { name: "Itinéraires techniques" }).getByRole("row").filter({ hasText: NAME })).toContainText("5");
  expect(crashes).toEqual([]);
});
