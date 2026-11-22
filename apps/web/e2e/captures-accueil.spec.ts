import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * Captures de la page d'accueil de fourmy.org, sur la ferme de grandes
 * cultures de Pierre (accord écrit pour des captures publiques, voir
 * docs/site-public-exigences.md §6.1) : interopérabilité, réglementaire,
 * parcellaire, équipe. À la demande :
 *   CAPTURES=1 CAPTURES_FARM=<ferme> [CAPTURES_HIDE=<nom à masquer>] E2E_BASE_URL=http://localhost:5180 \
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
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    // Pas de photo ni de nom du compte de capture sur le site public.
    for (const b of document.querySelectorAll<HTMLElement>('button[aria-label^="Compte de"]')) b.style.visibility = "hidden";
  });
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

// Assolement prévisionnel, temps 1 à 3 (fonctionnalités du site, mise à jour du 22/11/2026).
// Assolement 2027 de la ferme validé avec ses itinéraires ; prix de référence publics seulement
// (Lexicon, marchés européens) repris dans le module Économique, aucun prix propre à la ferme.
const PLAN = `/f/${FARM}/crop-plan/2027`;
/**
 * Personnes nommées dans les étapes et les heures, remplacées par « Exploitant » sur les captures
 * publiques : CAPTURES_HIDE=<nom affiché> (le nom n'est pas écrit dans le dépôt).
 */
const anonymize = (page: Page) =>
  page.evaluate((hide) => {
    if (!hide) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue?.includes(hide)) n.nodeValue = n.nodeValue.split(hide).join("Exploitant");
    }
  }, process.env.CAPTURES_HIDE ?? "");

test("assolement prévisionnel : carte et parcelles de la campagne suivante", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(PLAN);
  await expect(page.getByText(/Assolement 2027/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Parcelles" }).click();
  await page.waitForTimeout(6000);
  await snap(page, "assolement");
});

test("temps de travaux : heures par semaine et pointes de la campagne", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(PLAN);
  await page.getByRole("tab", { name: "Travaux" }).click();
  await page.waitForTimeout(6000);
  await anonymize(page);
  await snap(page, "temps-travaux");
});

test("marges prévisionnelles : onglet Économie de l'assolement", async ({ page }) => {
  test.setTimeout(120_000);
  // Plus large : toutes les colonnes jusqu'à la marge directe et l'écart à la campagne passée.
  await page.setViewportSize({ width: 2100, height: 1000 });
  await page.goto(PLAN);
  await page.getByRole("tab", { name: "Économie" }).click();
  await expect(page.getByText(/Marges prévues/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(4000);
  await snap(page, "marges");
});

test("itinéraire technique de la ferme, tiré de l'historique", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/itineraries`);
  await page.getByRole("link", { name: /^Maïs — d'après/ }).first().click();
  await page.waitForTimeout(6000);
  await anonymize(page);
  await snap(page, "itk");
});

test("semences : utilisation des semences de la campagne", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/f/${FARM}/seeds`);
  await expect(page.getByRole("heading", { name: /Semences/ }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Utilisation" }).click();
  // Campagne 2027 : semis prévus de l'assolement (doses en kg/ha converties en grains/m²).
  await page.waitForTimeout(3000);
  await snap(page, "semences");
});
