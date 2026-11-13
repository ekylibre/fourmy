import { expect, test } from "@playwright/test";
import { login } from "./shared";

/**
 * Itinéraire technique (lot T2, R1) sur la ferme pilote viticole : l'onglet
 * de la fiche parcelle dessine la frise (TIKA, ECharts) avec sa liste, et un
 * clic sur une intervention ouvre sa fiche.
 */
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
  // Liste textuelle (N6) : l'étape de la campagne, déroulée, puis une intervention.
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
  await expect(chart.locator(".transcript:visible .rotation_item")).toHaveCount(3, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
