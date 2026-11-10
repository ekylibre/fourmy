import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "./shared";

/**
 * Onglet Parcours d'un matériel (lot O4) sur la ferme pilote viticole : un
 * boîtier posé sur « Tractor 4 » et une trace synthétique d'avant-hier (un
 * passage au travail sur une parcelle, puis un déplacement). Le recalcul par
 * l'API produit les parcours ; l'onglet les liste, les filtre et les montre
 * sur la carte.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const api = `/api/v1/farms/${FARM}`;
const binding = crypto.randomUUID();
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

test.afterAll(async () => {
  await sql`DELETE FROM tracker_bindings WHERE id = ${binding}`; // positions et parcours suivent
  await sql.end();
});

test("parcours d'un tracteur : liste, filtres, carte de la sélection", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));

  const [tractor] = await sql<{ id: string }[]>`SELECT id FROM equipments WHERE farm_id = ${FARM} AND name = 'Tractor 4'`;
  // Un point à l'intérieur d'une parcelle valide aujourd'hui.
  const [spot] = await sql<{ lon: number; lat: number }[]>`
    SELECT ST_X(ST_PointOnSurface(v.shape)) AS lon, ST_Y(ST_PointOnSurface(v.shape)) AS lat
    FROM land_parcel_versions v JOIN land_parcels p ON p.id = v.land_parcel_id
    WHERE p.farm_id = ${FARM} AND v.valid @> now() AND v.area_m2 > 5000 ORDER BY v.area_m2 DESC LIMIT 1`;
  expect(tractor && spot).toBeTruthy();
  await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid)
            VALUES (${binding}, ${FARM}, ${tractor!.id}, 'e2e-parcours', tstzrange(now() - interval '10 days', NULL))`;
  const day = new Date(Date.now() - 2 * 86_400_000);
  day.setUTCHours(8, 0, 0, 0);
  const M_LAT = 1 / 111_320;
  const M_LON = M_LAT / Math.cos((spot!.lat * Math.PI) / 180);
  const point = (s: number, dx: number, dy: number, working: boolean) =>
    sql`INSERT INTO positions (farm_id, binding_id, time, point, speed, attrs)
        VALUES (${FARM}, ${binding}, ${new Date(day.getTime() + s * 1000).toISOString()},
                ST_SetSRID(ST_MakePoint(${spot!.lon + dx * M_LON}, ${spot!.lat + dy * M_LAT}), 4326), ${working ? 6 : 15},
                ${sql.json({ working, widthM: 3, tool: "Intercep" })})`;
  // Travail : 5 min d'aller-retours de 40 m autour du point ; puis 5 min de route vers le nord.
  for (let i = 0; i <= 60; i++) await point(i * 5, ((i % 10) - 5) * 4, Math.floor(i / 10) * 3 - 9, true);
  for (let i = 1; i <= 60; i++) await point(300 + i * 5, 0, 10 + i * 20, false);

  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();
  const r = await page.request.post(`${api}/track-sessions/recompute`);
  expect(r.ok()).toBe(true);

  await page.goto(`/f/${FARM}/equipments/${tractor!.id}?tab=tracks`);
  await expect(page.getByRole("tab", { name: "Parcours" })).toBeVisible();
  const table = page.getByRole("table", { name: "Parcours" });
  await expect(table.getByRole("row")).toHaveCount(3); // en-tête + travail + déplacement
  await expect(table).toContainText("Travail");
  await expect(table).toContainText("Déplacement");
  await expect(table).toContainText("Intercep");
  await expect(table).toContainText("Libre");

  // Filtre « Travail » : le déplacement disparaît.
  await page.getByLabel("Type de parcours").getByText("Travail", { exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).not.toContainText("Déplacement");

  // Sélection : la carte et la surface couverte apparaissent.
  await table.getByRole("checkbox", { name: "Sélectionner le parcours" }).check();
  await expect(page.getByLabel("Carte des parcours")).toBeVisible();
  await expect(page.getByText(/1 parcours · .* couverts/)).toBeVisible();
  expect(crashes).toEqual([]);
});
