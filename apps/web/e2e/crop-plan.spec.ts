import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "./shared";

/**
 * Assolement (lot AS2b) sur la ferme pilote viticole, campagne 2031 (sans
 * donnée) : préparer depuis Activités, affecter une culture à toutes les
 * parcelles, valider, retrouver les parcelles dans Activités, rouvrir puis
 * abandonner le brouillon. Assolement, productions et campagne 2031 sont
 * effacés à la fin.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const YEAR = 2031;

test("préparer l'assolement 2031 depuis Activités, affecter, valider, rouvrir", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  try {
    await login(page);
    await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();

    await page.goto(`/f/${FARM}/activities?at=${YEAR - 1}-06-15`);
    await page.getByRole("button", { name: "Assolement" }).click();
    await page.getByRole("menuitem", { name: `Préparer l'assolement ${YEAR}` }).click();
    await page.getByRole("button", { name: `Préparer l'assolement ${YEAR}` }).click();

    const table = page.getByRole("table", { name: "Parcelles de l'assolement" });
    await expect(table.getByRole("row").nth(1)).toBeVisible();
    const parcels = (await table.getByRole("row").count()) - 1;
    await page.getByRole("button", { name: "Tout choisir" }).click();
    await page.getByRole("combobox", { name: "Activité" }).click();
    const option = page.getByRole("option").first();
    const activity = (await option.textContent())!.trim();
    await option.click();
    await page.getByRole("button", { name: "Affecter", exact: true }).click();
    await expect(page.getByLabel("Surfaces prévues")).toContainText(activity);
    await expect(page.getByText("Enregistré", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Valider…" }).click();
    const modal = page.getByRole("dialog", { name: `Valider l'assolement ${YEAR}` });
    await expect(modal.getByLabel("Changements")).toContainText(`Campagne ${YEAR} créée`);
    await modal.getByRole("button", { name: "Valider l'assolement" }).click();
    await expect(page.getByText(`Assolement ${YEAR} validé (version 1).`)).toBeVisible();
    await expect(page.getByText("validé · version 1")).toBeVisible();

    // Activités de la campagne : l'activité porte toutes les parcelles.
    await page.goto(`/f/${FARM}/activities?at=${YEAR}-06-15`);
    await expect(page.getByLabel(`Activité ${activity}`)).toContainText(`${parcels} parcelle(s)`);

    // Rouvrir, puis abandonner le brouillon : retour à la version 1.
    await page.goto(`/f/${FARM}/crop-plan/${YEAR}`);
    await page.getByRole("button", { name: "Modifier" }).click();
    await expect(page.getByText(/brouillon \(révision de la version 1\)/)).toBeVisible();
    await page.getByRole("button", { name: "Abandonner le brouillon" }).click();
    await page.getByRole("dialog", { name: "Abandonner le brouillon ?" }).getByRole("button", { name: "Abandonner" }).click();
    await expect(page.getByText("validé · version 1")).toBeVisible();
    expect(crashes).toEqual([]);
  } finally {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await sql`DELETE FROM crop_plans WHERE farm_id = ${FARM} AND year = ${YEAR}`;
      await sql`DELETE FROM productions WHERE campaign_id IN (SELECT id FROM campaigns WHERE farm_id = ${FARM} AND year = ${YEAR})`;
      await sql`DELETE FROM campaigns WHERE farm_id = ${FARM} AND year = ${YEAR}`;
    } finally {
      await sql.end();
    }
  }
});
