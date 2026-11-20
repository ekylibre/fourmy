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
    await expect(page.getByLabel("Légende de la carte")).toContainText(activity);
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

/**
 * Fusion de deux parcelles voisines (Parcelle 002 et Parcelle 007) dans
 * l'assolement 2032 : la nouvelle parcelle existe à partir de la date
 * d'effet et porte la culture. Parcelles d'origine restaurées à la fin.
 */
test("fusionner deux parcelles voisines dans l'assolement 2032, puis valider", async ({ page }) => {
  const year = 2032;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const before = await sql<{ id: string; upper: string | null }[]>`
    SELECT v.id, upper(v.valid)::text AS upper FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id
    WHERE lp.farm_id = ${FARM} AND lp.name IN ('Parcelle 002', 'Parcelle 007')`;
  try {
    await login(page);
    await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();
    await page.goto(`/f/${FARM}/crop-plan/${year}`);
    await page.getByRole("button", { name: `Préparer l'assolement ${year}` }).click();
    const table = page.getByRole("table", { name: "Parcelles de l'assolement" });
    await expect(table.getByRole("row").nth(1)).toBeVisible();
    const parcels = (await table.getByRole("row").count()) - 1;

    await table.getByRole("checkbox", { name: "Choisir Parcelle 002" }).check();
    await table.getByRole("checkbox", { name: "Choisir Parcelle 007" }).check();
    await page.getByRole("button", { name: "Fusionner" }).click();
    const pending = page.getByLabel("Découpes et fusions");
    await expect(pending).toContainText("Parcelle 002, Parcelle 007 fusionnées");
    await expect(table.getByRole("row")).toHaveCount(parcels); // une parcelle de moins, plus l'en-tête
    await pending.getByLabel(/^Nom/).fill("Grande vigne");
    await pending.getByLabel(/^Nom/).blur();

    await page.getByRole("button", { name: "Tout choisir" }).click();
    await page.getByRole("combobox", { name: "Activité" }).click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "Affecter", exact: true }).click();
    await expect(page.getByText("Enregistré", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Valider…" }).click();
    const modal = page.getByRole("dialog", { name: `Valider l'assolement ${year}` });
    await expect(modal.getByLabel("Changements")).toContainText("Parcelle 002, Parcelle 007 fusionnées en Grande vigne");
    await modal.getByRole("button", { name: "Valider l'assolement" }).click();
    await expect(page.getByText(`Assolement ${year} validé (version 1).`)).toBeVisible();

    const [merged] = await sql<{ name: string; from_day: string }[]>`
      SELECT lp.name, lower(v.valid)::date::text AS from_day FROM land_parcels lp JOIN land_parcel_versions v ON v.land_parcel_id = lp.id
      WHERE lp.farm_id = ${FARM} AND lp.name = 'Grande vigne'`;
    expect(merged?.name).toBe("Grande vigne");
    // L'assolement validé montre la parcelle fusionnée.
    await page.reload();
    await expect(page.getByRole("table", { name: "Parcelles de l'assolement" })).toContainText("Grande vigne");
  } finally {
    try {
      const kids = await sql<{ id: string }[]>`SELECT DISTINCT child_id AS id FROM land_parcel_lineage l JOIN crop_plans p ON p.id = l.plan_id WHERE p.farm_id = ${FARM} AND p.year = ${year}`;
      if (kids.length) {
        await sql`DELETE FROM productions WHERE land_parcel_id IN ${sql(kids.map((k) => k.id))}`;
        await sql`DELETE FROM land_parcels WHERE id IN ${sql(kids.map((k) => k.id))}`;
      }
      for (const v of before) {
        await sql`UPDATE land_parcel_versions SET valid = tstzrange(lower(valid), ${v.upper}::timestamptz) WHERE id = ${v.id}`;
      }
      await sql`DELETE FROM crop_plans WHERE farm_id = ${FARM} AND year = ${year}`;
      await sql`DELETE FROM productions WHERE campaign_id IN (SELECT id FROM campaigns WHERE farm_id = ${FARM} AND year = ${year})`;
      await sql`DELETE FROM campaigns WHERE farm_id = ${FARM} AND year = ${year}`;
    } finally {
      await sql.end();
    }
  }
});
