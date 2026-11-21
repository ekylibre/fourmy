import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "./shared";

/**
 * Temps 2 de l'assolement de bout en bout (lot IT6) sur la ferme pilote
 * viticole, campagne 2033 (sans donnée) : un itinéraire technique à dates
 * fixes pour l'activité, l'assolement qui l'affecte à toutes les parcelles,
 * les onglets Travaux et Intrants, la validation, puis « Préparer les
 * interventions prévues ». Tout est effacé à la fin.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const YEAR = 2033;
const ITK = crypto.randomUUID();

test("itinéraire → assolement → travaux et intrants → validation → interventions prévues", async ({ page }) => {
  test.setTimeout(180_000);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  const api = `/api/v1/farms/${FARM}`;
  try {
    await login(page);
    await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();

    await page.goto(`/f/${FARM}/activities?at=${YEAR - 1}-06-15`);
    await page.getByRole("button", { name: "Assolement" }).click();
    await page.getByRole("menuitem", { name: `Préparer l'assolement ${YEAR}` }).click();
    await page.getByRole("button", { name: `Préparer l'assolement ${YEAR}` }).click();
    await expect(page.getByRole("table", { name: "Parcelles de l'assolement" }).getByRole("row").nth(1)).toBeVisible();

    // L'activité proposée en premier, et son itinéraire : 3 traitements à partir du 15/05, vendange le 20/09.
    const context = await (await page.request.get(`${api}/crop-plans/${YEAR}/context`)).json();
    const activity = context.activities[0] as { id: string; name: string };
    const created = await page.request.post(`${api}/technical-itineraries`, {
      data: {
        id: ITK,
        name: `${activity.name} — e2e ${ITK.slice(0, 6)}`,
        activityId: activity.id,
        content: {
          schema: 1,
          steps: [
            { id: crypto.randomUUID(), procedure: "vine_spraying_without_fertilizing", anchor: { kind: "date", monthDay: "05-15", yearOffset: 0 }, repeat: { count: 3, everyDays: 14 }, workRateHaH: 3, staffing: { equipmentIds: [], personIds: [], people: 1 } },
            { id: crypto.randomUUID(), procedure: "mecanical_vine_harvest", anchor: { kind: "date", monthDay: "09-20", yearOffset: 0 }, workRateHaH: 1, inputs: [] },
          ],
        },
      },
    });
    expect(created.status()).toBe(201);
    await page.reload();

    // Affecter l'activité et son itinéraire (proposé d'office : le seul de l'activité).
    await page.getByRole("button", { name: "Tout choisir" }).click();
    await page.getByRole("combobox", { name: "Activité" }).click();
    await page.getByRole("option", { name: activity.name, exact: true }).first().click();
    await expect(page.getByRole("combobox", { name: "Itinéraire technique" })).toHaveValue(new RegExp(`e2e ${ITK.slice(0, 6)}`));
    await page.getByRole("button", { name: "Affecter", exact: true }).click();
    await expect(page.getByText("Enregistré", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Travaux : heures au champ et pointes ; Intrants : rien à prévoir (pas d'intrant dans l'itinéraire).
    await page.getByRole("tab", { name: "Travaux" }).click();
    const work = page.getByLabel("Temps de travaux");
    await expect(work).toContainText("Au champ");
    await expect(work).toContainText("2 débit(s) saisi");
    await expect(page.getByLabel("Heures de main-d'œuvre prévues par semaine")).toBeVisible();
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
    await page.getByRole("tab", { name: "Intrants" }).click();
    await expect(page.getByText(/Aucun besoin/)).toBeVisible();

    // Valider, puis préparer les interventions prévues.
    await page.getByRole("button", { name: "Valider…" }).click();
    const validate = page.getByRole("dialog", { name: `Valider l'assolement ${YEAR}` });
    await validate.getByRole("button", { name: "Valider l'assolement" }).click();
    await expect(page.getByText(`Assolement ${YEAR} validé (version 1).`)).toBeVisible();
    await page.getByRole("button", { name: "Préparer les interventions prévues" }).click();
    const planned = page.getByRole("dialog", { name: `Interventions prévues ${YEAR}` });
    const rows = planned.getByRole("table", { name: "Interventions proposées" });
    await expect(rows).toBeVisible();
    const parcels = context.parcels.length as number;
    await expect(planned.getByText(`${parcels * 4} à créer`)).toBeVisible();
    await planned.getByRole("button", { name: `Confirmer (${parcels * 4})` }).click();
    await expect(page.getByText(new RegExp(`Interventions prévues : ${parcels * 4} créée\\(s\\)`))).toBeVisible({ timeout: 30_000 });

    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM interventions WHERE farm_id = ${FARM} AND status = 'planned' AND (itinerary_ref->>'campaign')::int = ${YEAR}`;
      expect(n!.n).toBe(parcels * 4);
    } finally {
      await sql.end();
    }
    expect(crashes).toEqual([]);
  } finally {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const ids = (await sql<{ id: string }[]>`SELECT id FROM interventions WHERE farm_id = ${FARM} AND (itinerary_ref->>'campaign')::int = ${YEAR}`).map((r) => r.id);
      if (ids.length) {
        await sql`DELETE FROM outbox_events WHERE payload->'data'->>'interventionId' IN ${sql(ids)}`;
        await sql`DELETE FROM interventions WHERE id IN ${sql(ids)}`;
      }
      await sql`DELETE FROM crop_plans WHERE farm_id = ${FARM} AND year = ${YEAR}`;
      await sql`DELETE FROM productions WHERE campaign_id IN (SELECT id FROM campaigns WHERE farm_id = ${FARM} AND year = ${YEAR})`;
      await sql`DELETE FROM campaigns WHERE farm_id = ${FARM} AND year = ${YEAR}`;
      await sql`DELETE FROM technical_itineraries WHERE id = ${ITK}`;
    } finally {
      await sql.end();
    }
  }
});
