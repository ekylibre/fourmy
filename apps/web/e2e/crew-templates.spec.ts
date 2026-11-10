import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "./shared";

/**
 * Attelages types (US-ATT-C, lot Q2) sur la ferme pilote viticole : le
 * responsable enregistre « Tractor 4 + Equipment 1 » avec un conducteur ; à
 * la saisie suivante, un clic remplit l'attelage ; un second attelage saisi
 * à la main est enregistré comme attelage type depuis le formulaire.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const DAY = "2022-05-11";
const tag = crypto.randomUUID().slice(0, 6);
const NAME = `Tractor 4 + Equipment 1 — e2e ${tag}`;
const BIS = `Equipment 2 — e2e ${tag}`;
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let interventionId: string | undefined;

test.afterAll(async () => {
  if (interventionId) await sql`DELETE FROM interventions WHERE id = ${interventionId}`;
  await sql`DELETE FROM crew_templates WHERE farm_id = ${FARM} AND name LIKE ${`%e2e ${tag}`}`;
  await sql.end();
});

test("attelage type : enregistré, repris en un clic, créé depuis la saisie", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  const [person] = await sql<{ name: string }[]>`SELECT name FROM people WHERE farm_id = ${FARM} AND active ORDER BY name LIMIT 1`;
  expect(person).toBeTruthy();

  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();

  // Matériels › Attelages types : création par le responsable.
  await page.goto(`/f/${FARM}/equipments`);
  await page.getByRole("link", { name: "Attelages types" }).click();
  await expect(page.getByRole("heading", { name: "Attelages types" })).toBeVisible();
  await page.getByRole("button", { name: "Nouvel attelage type" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Nom").fill(NAME);
  for (const name of ["Tractor 4", "Equipment 1"]) {
    await modal.getByRole("combobox", { name: "Matériels" }).click();
    await page.getByRole("option", { name, exact: true }).click();
  }
  await page.keyboard.press("Escape");
  await modal.getByRole("combobox", { name: "Intervenants" }).click();
  await page.getByRole("option", { name: person!.name, exact: true }).click();
  await page.keyboard.press("Escape");
  await modal.getByRole("button", { name: "Enregistrer" }).click();
  const table = page.getByRole("table", { name: "Attelages types" });
  const row = table.getByRole("row").filter({ hasText: NAME });
  await expect(row).toContainText("Tractor 4 + Equipment 1");
  await expect(row).toContainText(person!.name);

  // Saisie : un clic remplit l'attelage, il ne reste que la période.
  await page.goto(`/f/${FARM}/interventions/new?at=${DAY}`);
  const form = page.getByRole("form", { name: "Saisie de l'intervention" });
  await form.getByRole("combobox", { name: "Intervention" }).fill("Labour");
  await page.getByRole("group", { name: "Cultures" }).getByRole("option", { name: "Labour", exact: true }).click();
  await form.getByRole("combobox", { name: "Parcelles" }).click();
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await form.getByText("Attelages", { exact: true }).click();
  const crew1 = form.getByRole("group", { name: "Attelage 1" });
  await crew1.getByRole("combobox", { name: "Attelage type" }).click();
  await page.getByRole("option", { name: NAME, exact: true }).click();
  await expect(crew1.getByLabel("Nom de l'attelage")).toHaveValue(NAME);
  await expect(crew1).toContainText("Tractor 4");
  await expect(crew1).toContainText("Equipment 1");
  await expect(crew1).toContainText(person!.name);
  await crew1.getByLabel("Début").fill(`${DAY}T08:00`);
  await crew1.getByLabel("Fin").fill(`${DAY}T10:00`);

  // Un second attelage saisi à la main, enregistré comme attelage type.
  await form.getByRole("button", { name: "Ajouter un attelage" }).click();
  const crew2 = form.getByRole("group", { name: "Attelage 2" });
  await crew2.getByRole("combobox", { name: "Matériels" }).click();
  await page.getByRole("option", { name: "Equipment 2", exact: true }).click();
  await page.keyboard.press("Escape");
  await crew2.getByRole("button", { name: "Créer un attelage type depuis cet attelage" }).click();
  const save = page.getByRole("dialog");
  await save.getByLabel("Nom").fill(BIS);
  await save.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Attelage type enregistré.")).toBeVisible();
  await expect(crew2.getByLabel("Nom de l'attelage")).toHaveValue(BIS);

  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Intervention enregistrée.")).toBeVisible();
  interventionId = /interventions\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(interventionId).toBeTruthy();
  await expect(page.getByRole("group", { name: NAME })).toContainText("Tractor 4");
  await expect(page.getByRole("group", { name: NAME })).toContainText(person!.name);

  // L'origine est gardée en base ; le second modèle est dans la liste.
  const origins = await sql<{ name: string }[]>`
    SELECT t.name FROM intervention_crews c JOIN crew_templates t ON t.id = c.template_id
    WHERE c.intervention_id = ${interventionId!} ORDER BY c.rank`;
  expect(origins.map((o) => o.name)).toEqual([NAME, BIS]);
  expect(crashes).toEqual([]);
});
