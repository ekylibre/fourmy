import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "./shared";

/**
 * US-GPS-B (lot P) sur la ferme pilote viticole : deux passages au travail le
 * même matin sur « Tractor 7 » (positions synthétiques, coupés par 25 min
 * sans position). On coche les deux parcours, « Créer l'intervention » : le
 * formulaire arrive en attelages, avec deux périodes et la parcelle ; on
 * choisit la procédure et on enregistre. La fiche liste les deux parcours,
 * l'onglet les montre rattachés.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const binding = crypto.randomUUID();
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let created: string | null = null;

test.afterAll(async () => {
  if (created) await sql`DELETE FROM interventions WHERE id = ${created}`; // libère les parcours (déclencheur)
  await sql`DELETE FROM tracker_bindings WHERE id = ${binding}`; // positions et parcours suivent
  await sql.end();
});

test("deux parcours deviennent une intervention à attelage, rattachée", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));

  const [tractor] = await sql<{ id: string }[]>`SELECT id FROM equipments WHERE farm_id = ${FARM} AND name = 'Tractor 7'`;
  const [spot] = await sql<{ lon: number; lat: number }[]>`
    SELECT ST_X(ST_PointOnSurface(v.shape)) AS lon, ST_Y(ST_PointOnSurface(v.shape)) AS lat
    FROM land_parcel_versions v JOIN land_parcels p ON p.id = v.land_parcel_id
    WHERE p.farm_id = ${FARM} AND v.valid @> now() AND v.area_m2 > 5000 ORDER BY v.area_m2 DESC LIMIT 1`;
  expect(tractor && spot).toBeTruthy();
  await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid)
            VALUES (${binding}, ${FARM}, ${tractor!.id}, 'e2e-brouillon', tstzrange(now() - interval '10 days', NULL))`;
  const day = new Date(Date.now() - 3 * 86_400_000);
  day.setUTCHours(7, 0, 0, 0);
  const M_LAT = 1 / 111_320;
  const M_LON = M_LAT / Math.cos((spot!.lat * Math.PI) / 180);
  const point = (s: number, dx: number, dy: number) =>
    sql`INSERT INTO positions (farm_id, binding_id, time, point, speed, attrs)
        VALUES (${FARM}, ${binding}, ${new Date(day.getTime() + s * 1000).toISOString()},
                ST_SetSRID(ST_MakePoint(${spot!.lon + dx * M_LON}, ${spot!.lat + dy * M_LAT}), 4326), 6,
                ${sql.json({ working: true, widthM: 3 })})`;
  // Deux passages de 5 min (aller-retours de 40 m), séparés de 25 min sans position.
  for (const start of [0, 1800]) {
    for (let i = 0; i <= 60; i++) await point(start + i * 5, ((i % 10) - 5) * 4, Math.floor(i / 10) * 3 - 9 + start / 600);
  }

  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();
  expect((await page.request.post(`/api/v1/farms/${FARM}/track-sessions/recompute`)).ok()).toBe(true);

  const started = Date.now();
  await page.goto(`/f/${FARM}/equipments/${tractor!.id}?tab=tracks`);
  const table = page.getByRole("table", { name: "Parcours" });
  await expect(table.getByRole("row")).toHaveCount(3); // en-tête + deux parcours de travail
  for (const box of await table.getByRole("checkbox", { name: "Sélectionner le parcours" }).all()) await box.check();
  await expect(page.getByText("2 parcours sélectionnés")).toBeVisible();
  await page.getByRole("button", { name: "Créer l'intervention" }).click();

  // Formulaire pré-rempli : bandeau, mode attelages, deux périodes, la parcelle.
  const form = page.getByRole("form", { name: "Saisie de l'intervention" });
  await expect(form.getByLabel("Parcours GPS")).toContainText("2 parcours GPS seront rattachés");
  await form.getByRole("combobox", { name: "Intervention" }).fill("Labour");
  await page.getByRole("group", { name: "Cultures" }).getByRole("option", { name: "Labour", exact: true }).click();
  const crew = form.getByRole("group", { name: "Attelage 1" });
  await expect(crew.getByLabel("Début")).toHaveCount(2);
  await expect(crew).toContainText("Tractor 7");
  await expect(form.getByText(/traités|ha/).first()).toBeVisible();
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Intervention enregistrée.")).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);

  // Fiche : les deux parcours rattachés.
  await page.waitForURL(/\/interventions\/[0-9a-f-]{36}/);
  created = page.url().match(/interventions\/([0-9a-f-]{36})/)![1]!;
  await expect(page.getByRole("heading", { name: "Parcours GPS rattachés (2)" })).toBeVisible();

  // Onglet : rattachés, plus sélectionnables.
  await page.goto(`/f/${FARM}/equipments/${tractor!.id}?tab=tracks`);
  await expect(table.getByRole("link", { name: "Labour" })).toHaveCount(2);
  await expect(table.getByRole("checkbox", { name: "Sélectionner le parcours" }).first()).toBeDisabled();
  expect(crashes).toEqual([]);
});
