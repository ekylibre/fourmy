import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";

/**
 * Assistant de premier démarrage (lot IM6) : un compte « à embarquer » crée
 * sa ferme, dépose les trois jeux anonymisés (dossier PAC, Geofolia, DAPLOS),
 * ferme la page à l'étape « Rapprochements » et la reprend au même endroit,
 * importe, puis arrive au tableau de bord. Un compte sans droit voit le
 * message pour l'administrateur.
 */
const fixture = (name: string) => fileURLToPath(new URL(`../../../packages/importers/test/fixtures/${name}`, import.meta.url));
// Recette locale sur des fichiers réels (jamais dans le dépôt) : FOURMY_IMPORT_SAMPLES désigne leur dossier.
const samples = process.env.FOURMY_IMPORT_SAMPLES;
const real = (ext: string) => join(samples!, readdirSync(samples!).find((f) => f.toLowerCase().endsWith(ext))!);
const FILES = samples ? [real(".xml"), real(".zip"), real(".dap")] : [fixture("telepac-pilote.xml"), fixture("geofolia-pilote.zip"), fixture("daplos-pilote.dap")];
const PASSWORD = "assistant-e2e-fourmy";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const accounts = { onboarding: { id: randomUUID(), email: `onboarding-${Date.now()}@fourmy.local` }, plain: { id: randomUUID(), email: `sans-ferme-${Date.now()}@fourmy.local` } };

test.beforeAll(async () => {
  for (const [key, a] of Object.entries(accounts)) {
    await sql`INSERT INTO users (id, email, name, farm_creation_quota) VALUES (${a.id}, ${a.email}, 'Exploitant e2e', ${key === "onboarding" ? 1 : 0})`;
    await sql`INSERT INTO auth_accounts (user_id, account_id, provider_id, password) VALUES (${a.id}, ${a.id}, 'credential', ${await hashPassword(PASSWORD)})`;
  }
});
test.afterAll(async () => {
  const ids = [accounts.onboarding.id, accounts.plain.id];
  const farms = await sql<{ farm_id: string }[]>`SELECT farm_id FROM memberships WHERE user_id IN ${sql(ids)}`;
  if (farms.length) {
    await sql`DELETE FROM import_runs WHERE farm_id IN ${sql(farms.map((f) => f.farm_id))}`;
    await sql`DELETE FROM farms WHERE id IN ${sql(farms.map((f) => f.farm_id))}`;
  }
  await sql`DELETE FROM users WHERE id IN ${sql(ids)}`;
  await sql.end();
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "E-mail" }).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("compte neuf : sa ferme, ses trois fichiers, une reprise, puis le tableau de bord", async ({ page }) => {
  test.setTimeout(300_000);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await login(page, accounts.onboarding.email);

  // Étape 1 : la ferme, pré-remplie depuis le dossier PAC.
  await expect(page.getByRole("heading", { name: "Bienvenue dans Fourmy" })).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type="file"]').first().setInputFiles(FILES[0]!);
  await expect(page.getByRole("combobox", { name: "SIRET" })).toHaveValue(/^\d{14}$/, { timeout: 20_000 });
  if (!samples) await expect(page.getByRole("textbox", { name: "Nom de la ferme" })).toHaveValue("GAEC PILOTE TEST");
  // Saisie au clavier (et pas seulement le pré-remplissage) : nom et adresse.
  await page.getByRole("textbox", { name: "Nom de la ferme" }).fill("GAEC Pilote — essai");
  await page.getByRole("textbox", { name: "Adresse", exact: true }).fill("Le Bourg");
  await expect(page.getByRole("textbox", { name: "Nom de la ferme" })).toHaveValue("GAEC Pilote — essai");
  await page.getByRole("button", { name: "Créer ma ferme" }).click();

  // Étape 2 : les trois fichiers.
  await expect(page.getByRole("heading", { name: "Mes fichiers" })).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type="file"][multiple]').setInputFiles(FILES);
  const files = page.getByRole("table", { name: "Fichiers déposés" });
  await expect(files.getByText("Lu")).toHaveCount(3, { timeout: 60_000 });
  await page.getByRole("button", { name: "Voir l'aperçu" }).click();

  // Étape 3 : aperçu de chaque fichier ; étape 4 : rapprochements.
  await expect(page.getByLabel("Aperçu de l'import")).toHaveCount(3, { timeout: 20_000 });
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Rapprochements" })).toBeVisible();

  // Fermeture puis retour : l'assistant reprend à l'étape 4.
  await page.goto("/farms");
  await expect(page.getByRole("heading", { name: "Rapprochements" })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/onboarding\/matching$/);

  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Paramétrage" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();

  // Étape 6 : import des trois fichiers, dans l'ordre Geofolia, DAPLOS, dossier PAC.
  await expect(page.getByRole("heading", { name: "Import", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lancer l'import" }).click();
  await expect(page.getByLabel("Rapport de l'import")).toHaveCount(3, { timeout: 240_000 });
  await page.getByRole("button", { name: "Terminer" }).click();

  // Fin : le tableau de bord de la ferme, avec ses parcelles.
  await expect(page.getByRole("heading", { name: "Votre ferme est prête" })).toBeVisible();
  await page.getByRole("link", { name: "Tableau de bord" }).click();
  await expect(page).toHaveURL(/\/f\/[0-9a-f-]{36}$/);
  const [farm] = await sql<{ id: string; parcels: number; done: string | null }[]>`
    SELECT f.id, (SELECT count(*) FROM land_parcels lp WHERE lp.farm_id = f.id)::int AS parcels, s.onboarding->>'completedAt' AS done
    FROM memberships m JOIN farms f ON f.id = m.farm_id LEFT JOIN farm_settings s ON s.farm_id = f.id WHERE m.user_id = ${accounts.onboarding.id}`;
  // Jeux anonymisés : 6 parcelles Geofolia + 10 parcelles PAC sans culture Geofolia. Fichiers réels : 41.
  if (samples) console.log(`Ferme réelle : ${farm!.parcels} parcelles`);
  expect(farm!.parcels).toBe(samples ? 41 : 16);
  expect(farm!.done).toBeTruthy();
  expect(crashes).toEqual([]);
});

test("compte sans droit de créer : message pour l'administrateur", async ({ page }) => {
  await login(page, accounts.plain.email);
  await expect(page.getByText("Vous n'êtes membre d'aucune ferme pour le moment.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/demandez l'ouverture de votre compte/)).toBeVisible();
});
