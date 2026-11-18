import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * Captures de la page d'accueil de fourmy.org, sur la ferme de grandes
 * cultures de Pierre (accord écrit pour des captures publiques, voir
 * docs/site-public-exigences.md §6.1) : interopérabilité, réglementaire,
 * parcellaire, équipe. À la demande :
 *   CAPTURES=1 CAPTURES_FARM=<ferme> E2E_BASE_URL=http://localhost:5180 \
 *     pnpm --filter @fourmy/web exec playwright test e2e/captures-accueil.spec.ts
 * Connexion avec le compte de développement de seed:dev (responsable de la ferme).
 */
test.skip(!process.env.CAPTURES || !process.env.CAPTURES_FARM, "Captures à la demande : CAPTURES=1 CAPTURES_FARM=<ferme>");
test.describe.configure({ mode: "serial" });

const FARM = process.env.CAPTURES_FARM!;
const DAY = "2026-10-05";
const out = (name: string) =>
  process.env.OUT_DIR ? `${process.env.OUT_DIR}/${name}.png` : fileURLToPath(new URL(`../../site/src/assets/captures/${name}.png`, import.meta.url));
const devPassword = () => /DEV_PASSWORD\s*=\s*"([^"]+)"/.exec(readFileSync(new URL("../../api/src/cli/seed-dev.ts", import.meta.url), "utf8"))![1]!;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/^E-mail/).fill("dev@fourmy.local");
  await page.getByLabel(/^Mot de passe/).fill(devPassword());
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/farms|\/f\//);
}
const snap = async (page: Page, name: string) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await page.screenshot({ path: out(name), animations: "disabled" });
};

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Le haut de page est une boucle vidéo du rejeu 3D avec ses incrustations, et son affiche
// (accueil-3d) : videos/accueil-rejeu (capture/film.mjs, capture/encode.sh).

test("interopérabilité : attelage et parcours tirés du GPS, trace sur la photo IGN", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/interventions/68e602b1-a7db-4efa-a5e3-97fc522684f1?at=${DAY}`);
  await expect(page.getByRole("heading", { name: "Parcours GPS rattachés (1)" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  await snap(page, "accueil-interoperabilite");
});

test("réglementaire : fiche d'un traitement, pictogrammes, ZNT, contrôle des doses et des usages", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/interventions/a30376ac-2355-5806-a857-cf57f1814328?at=2026-05-23`);
  await expect(page.getByRole("heading", { name: "Contrôle réglementaire" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  await snap(page, "accueil-reglementaire");
});

test("parcellaire : fiche d'une parcelle, culture, PAC et cadastre, photo IGN", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/land-parcels/74f04f4a-0b2c-57da-98ee-dd5a234a5602?at=${DAY}`);
  await expect(page.getByRole("heading", { name: "Monassut Maïs 2026" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  await snap(page, "accueil-parcellaire");
});

test("équipe : temps de travaux d'une personne, d'après les interventions", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/team/024e1cc6-fc53-5ad7-977a-3e22bca6df6c?at=${DAY}&tab=work`);
  await expect(page.getByRole("heading", { name: "Heures par mois" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(4000);
  await snap(page, "equipe-temps");
});
