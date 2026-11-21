import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "./shared";

/**
 * Temps 3 de l'assolement de bout en bout (lot E6) sur la ferme pilote
 * viticole, campagne 2034 (sans donnée) : un itinéraire (pulvérisation et
 * vendange, sans matériel de la ferme), l'assolement qui l'affecte avec un
 * rendement et un prix prévus, l'onglet Économie qui liste ce qui manque, la
 * saisie des prix dans le module Économique (coût horaire, prestations), puis
 * les marges complètes. Tout est effacé à la fin.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const YEAR = 2034;
const ITK = crypto.randomUUID();

test("prix → assolement avec prévisions → onglet Économie : manques, puis marges complètes", async ({ page }) => {
  test.setTimeout(180_000);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  const api = `/api/v1/farms/${FARM}`;
  try {
    await login(page);
    await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();
    await page.goto(`/f/${FARM}/activities?at=${YEAR - 1}-06-15`);
    await page.getByRole("button", { name: "Assolement" }).click();
    await page.getByRole("menuitem", { name: `Préparer l'assolement ${YEAR}` }).click();
    await page.getByRole("button", { name: `Préparer l'assolement ${YEAR}` }).click();
    await expect(page.getByRole("table", { name: "Parcelles de l'assolement" }).getByRole("row").nth(1)).toBeVisible();

    // Itinéraire : 2 pulvérisations (débit 3 ha/h, une personne), vendange (1 ha/h) ; aucun matériel de la ferme.
    const context = await (await page.request.get(`${api}/crop-plans/${YEAR}/context`)).json();
    const activity = context.activities[0] as { id: string; name: string };
    const created = await page.request.post(`${api}/technical-itineraries`, {
      data: {
        id: ITK,
        name: `${activity.name} — e2e éco ${ITK.slice(0, 6)}`,
        activityId: activity.id,
        content: {
          schema: 1,
          steps: [
            { id: crypto.randomUUID(), procedure: "vine_spraying_without_fertilizing", anchor: { kind: "date", monthDay: "05-15", yearOffset: 0 }, repeat: { count: 2, everyDays: 14 }, workRateHaH: 3, staffing: { equipmentIds: [], personIds: [], people: 1 } },
            { id: crypto.randomUUID(), procedure: "mecanical_vine_harvest", anchor: { kind: "date", monthDay: "09-20", yearOffset: 0 }, workRateHaH: 1, staffing: { equipmentIds: [], personIds: [], people: 1 } },
          ],
        },
      },
    });
    expect(created.status()).toBe(201);
    await page.reload();

    // Affecter avec un rendement et un prix prévus.
    await page.getByRole("button", { name: "Tout choisir" }).click();
    await page.getByRole("combobox", { name: "Activité" }).click();
    await page.getByRole("option", { name: activity.name, exact: true }).first().click();
    await expect(page.getByRole("combobox", { name: "Itinéraire technique" })).toHaveValue(new RegExp(`e2e éco ${ITK.slice(0, 6)}`));
    await page.getByLabel("Rendement prévu (q/ha)").fill("60");
    await page.getByLabel("Prix de vente prévu (€/t)").fill("1000");
    await page.getByRole("button", { name: "Affecter", exact: true }).click();
    await expect(page.getByText("Enregistré", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Onglet Économie : produit 60 q/ha × 100 €/q = 6 000 €/ha ; prestations et coût horaire manquent.
    await page.getByRole("tab", { name: "Économie" }).click();
    const margins = page.getByRole("table", { name: "Marges par activité" });
    await expect(margins.getByRole("row").nth(1)).toContainText(/6\s?000\s€/);
    const missing = page.getByLabel("À compléter");
    await expect(missing).toContainText("Matériel ou prestation : Pulvérisation (sans fertilisation)");
    await expect(missing).toContainText("Matériel ou prestation : Vendange mécanique");
    await expect(missing).toContainText("Coût horaire de la main-d'œuvre");

    // Module Économique : coût horaire, puis une prestation pour chaque étape.
    await page.goto(`/f/${FARM}/economics?tab=labour`);
    await page.getByRole("textbox", { name: "Prix de Coût horaire de la main-d'œuvre" }).fill("20");
    await page.getByRole("button", { name: "Enregistrer (1)" }).click();
    await expect(page.getByText(/1 prix enregistré/)).toBeVisible();
    await page.getByRole("tab", { name: "Services" }).click();
    await page.getByLabel("Filtrer Prestation").fill("Pulvérisation (sans");
    await page.getByRole("textbox", { name: "Prix de Pulvérisation (sans fertilisation)" }).fill("40");
    await page.getByLabel("Filtrer Prestation").fill("Vendange mécanique");
    await page.getByRole("textbox", { name: "Prix de Vendange mécanique" }).fill("400");
    await page.getByRole("button", { name: "Enregistrer (2)" }).click();
    await expect(page.getByText(/2 prix enregistré/)).toBeVisible();

    // Retour à l'assolement : rien ne manque ; mécanisation 2 × 40 + 400 = 480 €/ha, pas de main-d'œuvre propre (prestations).
    await page.goto(`/f/${FARM}/crop-plan/${YEAR}`);
    await page.getByRole("tab", { name: "Économie" }).click();
    const row = page.getByRole("table", { name: "Marges par activité" }).getByRole("row").nth(1);
    await expect(row).toContainText(/480\s€/);
    await expect(row).toContainText(/5\s?520\s€/);
    await expect(page.getByLabel("À compléter")).toHaveCount(0);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
    expect(crashes).toEqual([]);
  } finally {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await sql`DELETE FROM prices WHERE farm_id = ${FARM}`;
      await sql`DELETE FROM crop_plans WHERE farm_id = ${FARM} AND year = ${YEAR}`;
      await sql`DELETE FROM productions WHERE campaign_id IN (SELECT id FROM campaigns WHERE farm_id = ${FARM} AND year = ${YEAR})`;
      await sql`DELETE FROM campaigns WHERE farm_id = ${FARM} AND year = ${YEAR}`;
      await sql`DELETE FROM technical_itineraries WHERE id = ${ITK}`;
    } finally {
      await sql.end();
    }
  }
});
