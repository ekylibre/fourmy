import { expect, test } from "@playwright/test";
import { login } from "./shared";

/**
 * Vues des interventions (exigence INT-UI-4) sur la ferme pilote viticole :
 * une intervention de vigne travaillée sur plusieurs jours apparaît chaque
 * jour au calendrier ; la vue est gardée au changement de semaine.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("calendrier, kanban et liste sur la semaine de la frise", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();

  // Une intervention de 2021 sur deux jours d'une même semaine (lundi → dimanche).
  const items = (await (await page.request.get(`/api/v1/farms/${FARM}/interventions?campaign=2021`)).json()).items as {
    id: string;
    procedure: string;
    status: string;
    periods: { startedAt: string; stoppedAt: string }[];
  }[];
  const weekStart = (day: string) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localDay(d.toISOString());
  };
  const multi = items.find((i) => {
    if (i.status !== "done") return false;
    const days = [...new Set(i.periods.map((p) => localDay(p.startedAt)))];
    return days.length >= 2 && new Set(days.map(weekStart)).size === 1;
  })!;
  expect(multi, "intervention sur plusieurs jours dans la ferme pilote").toBeTruthy();
  const days = [...new Set(multi.periods.map((p) => localDay(p.startedAt)))];

  await page.goto(`/f/${FARM}/interventions?at=${days[0]}&view=calendar`);
  for (const day of days) {
    const label = new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
    const column = page.getByRole("region", { name: new RegExp(`^${label}$`, "i") });
    await expect(column.getByRole("article").first()).toBeVisible();
  }

  // Kanban : gardé au changement de semaine.
  await page.getByText("Kanban", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Réalisée" }).getByRole("article").first()).toBeVisible();
  await page.getByRole("button", { name: "Semaine précédente" }).click();
  await expect(page).toHaveURL(/view=kanban/);
  await expect(page.getByRole("region", { name: "Planifiée" })).toBeVisible();

  // Liste : un clic ouvre la fiche.
  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await page.getByText("Liste", { exact: true }).click();
  await page.getByRole("row").nth(1).click();
  await expect(page.getByRole("heading", { name: "Historique" })).toBeVisible();
  expect(crashes).toEqual([]);
});
