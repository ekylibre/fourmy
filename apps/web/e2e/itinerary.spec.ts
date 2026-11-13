import { expect, test } from "@playwright/test";
import { login } from "./shared";

/**
 * Itinéraire technique (lot T2, R1) sur la ferme pilote viticole : l'onglet
 * de la fiche parcelle dessine la frise (TIKA, ECharts) avec sa liste, et un
 * clic sur une intervention ouvre sa fiche.
 */

/**
 * Liste textuelle de TIKA : masquée au départ (elle doublait l'infobulle),
 * ouverte par le bouton « Afficher la transcription » de la barre d'outils.
 * Ce bouton est dessiné dans le canvas d'ECharts : on fait ce qu'il fait.
 */
async function openTranscript(chart: import("@playwright/test").Locator) {
  await expect(chart.locator(".transcript .rotation_item").first()).toBeAttached({ timeout: 30_000 });
  await expect(chart.locator(".transcript:visible")).toHaveCount(0);
  await chart.locator(".mainITKContainer").evaluate((el) => el.classList.add("withTranscript"));
}

test("itinéraire technique d'une parcelle : frise, liste, clic vers la fiche", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByRole("link", { name: /Ferme pilote — viticulture/ }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  const farmId = new URL(page.url()).pathname.split("/")[2]!;
  const api = `/api/v1/farms/${farmId}`;

  // Une parcelle avec des interventions en 2023.
  const parcels = (await (await page.request.get(`${api}/land-parcels?at=2023-06-10T12:00:00Z`)).json()).items as { id: string }[];
  let parcelId = "";
  for (const p of parcels) {
    const it = await (await page.request.get(`${api}/land-parcels/${p.id}/itinerary?year=2023`)).json();
    if (it.steps.some((s: { marks: unknown[] }) => s.marks.length > 3)) {
      parcelId = p.id;
      break;
    }
  }
  expect(parcelId).not.toBe("");

  await page.goto(`/f/${farmId}/land-parcels/${parcelId}?at=2023-06-10&tab=itinerary`);
  const chart = page.getByTestId("tika-chart");
  await expect(chart.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/interventions? : travaux au-dessus/)).toBeVisible();
  // Liste textuelle (N6), ouverte à la demande : l'étape de la campagne, déroulée, puis une intervention.
  await openTranscript(chart);
  const step = chart.locator(".transcript .rotation_item:visible").first();
  await expect(step).toContainText("Vigne");
  await step.click();
  const intervention = step.locator(".intervention").first();
  await expect(intervention).toBeVisible();
  // Détails en lignes « Libellé : valeur » (libellé en gras), comme dans l'infobulle.
  await expect(intervention.locator(".intervention_description b").first()).toHaveText("Date :");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await intervention.click();
  await expect(page).toHaveURL(new RegExp(`/f/${farmId}/interventions/[0-9a-f-]{36}$`));

  // Retour, rotation sur 3 ans : trois campagnes dans la liste.
  await page.goBack();
  // Bouton de Mantine : la case radio est masquée, on clique son libellé.
  await page.getByText("Rotation", { exact: true }).click();
  await openTranscript(chart);
  await expect(chart.locator(".transcript:visible .rotation_item")).toHaveCount(3, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("itinéraire d'une activité : vue fusionnée, groupe, descente sur une parcelle", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByRole("link", { name: /Ferme pilote — viticulture/ }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  const farmId = new URL(page.url()).pathname.split("/")[2]!;

  // Depuis la page Activités, la campagne 2023.
  await page.goto(`/f/${farmId}/activities?at=2023-06-10`);
  const vigne = page.getByRole("region", { name: "Activité Vigne" }).or(page.locator('[aria-label="Activité Vigne"]'));
  await vigne.getByRole("link", { name: "Itinéraire" }).click();
  await expect(page.getByRole("heading", { name: /Itinéraire technique — Vigne 2023/ })).toBeVisible();
  const parcels = page.getByRole("table", { name: "Parcelles de l'activité" });
  await expect(parcels.locator("tr").first()).toBeVisible();

  // Frise fusionnée : une intervention regroupée de la liste ouvre la liste de ses interventions.
  const chart = page.getByTestId("tika-chart");
  await expect(chart.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await openTranscript(chart);
  const step = chart.locator(".transcript .rotation_item:visible").first();
  await step.click();
  await step.locator(".intervention", { hasText: /\d+ parcelles/ }).first().click();
  const dialog = page.getByRole("dialog", { name: /\d+ interventions regroupées/ });
  await expect(dialog).toBeVisible();
  if (process.env.SHOT_GROUP) await page.screenshot({ path: process.env.SHOT_GROUP });
  const links = dialog.getByRole("link");
  expect(await links.count()).toBeGreaterThan(1);

  // Descente sur une parcelle du groupe, puis retour.
  const first = dialog.getByRole("button").filter({ hasText: /^Parcelle/ }).first();
  const name = (await first.textContent())!;
  await first.click();
  await expect(page.getByText(`Parcelle sélectionnée : ${name}`, { exact: true })).toBeVisible();
  if (process.env.SHOT_ACTIVITY) await page.screenshot({ path: process.env.SHOT_ACTIVITY });
  await openTranscript(chart);
  await expect(chart.locator(".transcript .rotation_item:visible").first()).toContainText("Vigne");
  await page.getByRole("button", { name: "Retour à la vue de l'activité" }).click();
  await expect(page.getByText(`Parcelle sélectionnée : ${name}`, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
