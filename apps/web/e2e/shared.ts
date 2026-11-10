/** Utilisateur dédié au parcours de bout en bout (créé puis nettoyé). */
export const E2E_USER = "00000000-0000-7000-8000-0000000e2e00";
export const FIXTURE = new URL("../../../fixtures/pilote-viticulture.json", import.meta.url);
export const E2E_EMAIL = "e2e@fourmy.local";
/** Mot de passe du compte éphémère du parcours (créé puis supprimé). */
export const E2E_PASSWORD = "parcours-e2e-fourmy";

/** Connexion par le vrai formulaire (better-auth). */
export async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "E-mail" }).fill(E2E_EMAIL);
  await page.getByLabel(/^Mot de passe/).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

/**
 * Navigue par le menu principal ; ouvre le sous-menu `group` si l'entrée
 * n'est pas visible (sous-menus repliés hors de la section active).
 */
export async function navTo(page: import("@playwright/test").Page, item: string, group?: string): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  const link = nav.getByRole("link", { name: item, exact: true });
  if (group && !(await link.isVisible())) await nav.getByRole("button", { name: group, exact: true }).click();
  await link.click();
}
