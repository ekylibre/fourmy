/** Utilisateur dédié au parcours de bout en bout (créé puis nettoyé). */
export const E2E_USER = "00000000-0000-7000-8000-0000000e2e00";
export const FIXTURE = new URL("../../../fixtures/pilote-viticulture.json", import.meta.url);
export const E2E_EMAIL = "e2e@fourmy.local";
/** Mot de passe du compte éphémère du parcours (créé puis supprimé). */
export const E2E_PASSWORD = "parcours-e2e-fourmy";

/** Connexion par le vrai formulaire (better-auth). */
export async function login(page: import("@playwright/test").Page) {
  await page.goto("/connexion");
  await page.getByRole("textbox", { name: "E-mail" }).fill(E2E_EMAIL);
  await page.getByLabel(/^Mot de passe/).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}
