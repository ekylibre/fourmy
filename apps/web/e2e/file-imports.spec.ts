import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { E2E_USER, login } from "./shared";

/**
 * Import d'un fichier de bout en bout (lot IM5) : dépôt de l'export Geofolia
 * anonymisé → aperçu → import → rapport → annulation. Sur une ferme créée
 * pour l'occasion (l'import remplit l'identité de la ferme), supprimée ensuite.
 */
const FILE = fileURLToPath(new URL("../../../packages/importers/test/fixtures/geofolia-pilote.zip", import.meta.url));
const farmId = randomUUID();
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

test.beforeAll(async () => {
  await sql`INSERT INTO farms (id, name) VALUES (${farmId}, 'Ferme e2e imports')`;
  await sql`INSERT INTO memberships (id, farm_id, user_id, role) VALUES (gen_random_uuid(), ${farmId}, ${E2E_USER}, 'owner')`;
});
test.afterAll(async () => {
  await sql`DELETE FROM import_runs WHERE farm_id = ${farmId}`;
  await sql`DELETE FROM farms WHERE id = ${farmId}`;
  await sql.end();
});

test("importer un export Geofolia, lire le rapport, annuler l'import", async ({ page }) => {
  test.setTimeout(180_000);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await login(page);
  await expect(page.getByRole("link", { name: /Ferme e2e imports/ })).toBeVisible();
  await page.goto(`/f/${farmId}/imports`);
  await expect(page.getByRole("heading", { name: "Imports", level: 1 })).toBeVisible();

  await page.locator('input[type="file"][accept*=".dap"]').setInputFiles(FILE);
  const apercu = page.getByLabel("Aperçu de l'import");
  await expect(apercu).toBeVisible({ timeout: 30_000 });
  await expect(apercu.getByText("Campagnes passées")).toBeVisible();

  await apercu.getByRole("button", { name: "Importer" }).click();
  const rapport = page.getByLabel("Rapport de l'import");
  await expect(rapport).toBeVisible({ timeout: 120_000 });
  await expect(rapport.getByText("Parcelles")).toBeVisible();
  const parcels = async () => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM land_parcels WHERE farm_id = ${farmId}`)[0]!.n;
  expect(await parcels()).toBe(6);

  await rapport.getByRole("button", { name: "Annuler l'import" }).click();
  await page.getByRole("dialog", { name: "Annuler cet import ?" }).getByRole("button", { name: "Annuler l'import" }).click();
  await expect(page.getByText(/Supprimé :/)).toBeVisible({ timeout: 30_000 });
  expect(await parcels()).toBe(0);
  expect(crashes).toEqual([]);
});
