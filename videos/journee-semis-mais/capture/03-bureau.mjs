// 18 h 30 : retour au bureau. Parcours du tracteur, rattaché au semis prévu, puis « Réaliser ».
import { open, shot, FARM, IDS, BASE } from "./session.mjs";
const PLANNED = process.env.PLANNED;
const { browser, page } = await open("2026-04-16T18:30:00+02:00");
// Horloge figée côté page seulement : sans « to », le serveur prend son heure (novembre) et refuse la fenêtre.
await page.route(/\/track-sessions\?/, (r) => {
  const u = new URL(r.request().url());
  if (!u.searchParams.has("to")) u.searchParams.set("to", "2026-04-17T00:00:00Z");
  return r.continue({ url: u.toString() });
});
await page.goto(`${BASE}/f/${FARM}/equipments/${IDS.arion}?tab=tracks`);
const row = page.getByRole("row", { name: /Parcours du .*16 avr/ }).first();
await row.waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await shot(page, "03-parcours-liste");
await row.getByLabel("Sélectionner le parcours").check();
await page.locator('[aria-label="Carte des parcours"]').waitFor();
await page.waitForTimeout(7000); // orthophoto et trace
await shot(page, "03-parcours-carte");
await page.locator('[aria-label="Carte des parcours"]').screenshot({ path: new URL("../assets/screens/03-trace.png", import.meta.url).pathname });
await page.getByRole("button", { name: "Ajouter à une intervention" }).click();
await page.getByRole("table", { name: "Interventions du jour" }).waitFor();
await page.waitForTimeout(800);
await shot(page, "03-choix-intervention");
await page.getByRole("table", { name: "Interventions du jour" }).getByRole("row", { name: /Semis/ }).getByRole("button", { name: "Ajouter ici" }).click();
await page.getByText(/parcours ajouté/).waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
await shot(page, "03-ajoute");
// La fiche, puis « Réaliser ».
await page.goto(`${BASE}/f/${FARM}/interventions/${PLANNED}`);
await page.getByRole("link", { name: "Réaliser" }).waitFor();
await page.waitForTimeout(5000);
await shot(page, "04-fiche-rattachee");
await page.getByRole("link", { name: "Réaliser" }).click();
await page.waitForTimeout(6000);
await shot(page, "04-realiser-form");
await browser.close();
