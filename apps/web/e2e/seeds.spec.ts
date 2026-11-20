import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "./shared";

/**
 * Semences (lot SE3) sur la ferme pilote : une semence de maïs ajoutée pour
 * le test apparaît dans Stocks → Semences avec « PMG inconnu » ; sa fiche
 * reçoit le nombre de grains par dose et le PMG de l'étiquette ; la liste
 * l'affiche. L'espèce n'est pas choisie : sa liste vient du référentiel
 * Lexicon, pas toujours chargé en CI (le repère de l'espèce est couvert par
 * les tests de l'API). La semence est effacée à la fin.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";

test("compléter la fiche d'une semence : dose et PMG", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const article = crypto.randomUUID();
  const name = `Maïs e2e ${article.slice(0, 6)}`;
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  try {
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${article}, ${FARM}, ${name}, 'seed', 'Sac de 50 000 grains')`;
    await login(page);
    await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();
    await page.goto(`/f/${FARM}/seeds`);
    await expect(page.getByRole("heading", { name: "Semences", level: 1 })).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText("doses de 50");
    await expect(row).toContainText("PMG inconnu");

    await row.getByText(name).click();
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    const drawer = page.locator(".mantine-Drawer-content");
    await drawer.getByRole("textbox", { name: "Grains par dose" }).fill("50000");
    await drawer.getByRole("textbox", { name: "PMG", exact: true }).fill("300");
    await drawer.getByRole("button", { name: "Enregistrer la fiche" }).click();
    await expect(page.getByText(`Fiche de ${name} enregistrée.`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row).toContainText("300 g (étiquette)");
    await expect(row).not.toContainText("PMG inconnu");
    await expect(row).toContainText("Espèce inconnue");
    expect(crashes).toEqual([]);
  } finally {
    await sql`DELETE FROM articles WHERE id = ${article}`;
    await sql.end();
  }
});
