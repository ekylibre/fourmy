import { expect, test } from "@playwright/test";
import { login } from "./shared";

/**
 * Fiche et correction tracée (exigences INT-UI-2, INT-UI-3) sur la ferme
 * pilote viticole : le parcours crée son propre traitement (le nettoyage
 * efface les interventions touchées par l'utilisateur e2e), le corrige à
 * l'écran, puis vérifie l'historique et le stock.
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const api = `/api/v1/farms/${FARM}`;

test("corriger la dose d'un traitement réalisé : fiche, historique, stock", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();

  // Un traitement de 1 L/ha sur une parcelle d'avril 2022 (hors des dates du parcours principal), créé par l'API (session du navigateur).
  const snapshot = await (await page.request.get(`${api}/snapshot?at=2022-04-12T12:00:00Z`)).json();
  const parcel = snapshot.landParcels[0] as { id: string; name: string; version: { areaM2: number } };
  const articles = (await (await page.request.get(`${api}/articles`)).json()).items as { id: string; name: string; kind: string }[];
  const phyto = articles.find((a) => a.kind === "phyto")!;
  const id = crypto.randomUUID();
  expect((await page.request.post(`${api}/interventions`, { data: { id, procedure: "vine_spraying_without_fertilizing" } })).ok()).toBe(true);
  const done = await page.request.post(`${api}/interventions/${id}/complete`, {
    data: {
      periods: [{ startedAt: "2022-04-12T06:00:00Z", stoppedAt: "2022-04-12T08:00:00Z" }],
      targets: [{ kind: "land_parcel", id: parcel.id }],
      inputs: [{ articleId: phyto.id, quantity: 1, per: "hectare" }],
    },
  });
  expect(done.ok()).toBe(true);
  const stockOf = async () => {
    const r = await (await page.request.get(`${api}/stock?at=2022-04-13T00:00:00Z&article=${phyto.id}`)).json();
    return (r.items as { quantity: number }[]).reduce((t, l) => t + l.quantity, 0);
  };
  const before = await stockOf();

  // La fiche : parcelle de la date, dose saisie, historique.
  await page.goto(`/f/${FARM}/interventions/${id}?at=2022-04-12`);
  await expect(page.getByRole("heading", { name: "Pulvérisation (sans fertilisation)", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Cibles" })).toContainText(parcel.name);
  await expect(page.getByRole("table", { name: "Intrants et sorties" })).toContainText(phyto.name);
  await expect(page.getByText("Réalisée", { exact: true }).first()).toBeVisible();

  // Corriger la dose : 1 → 1,5 /ha.
  await page.getByRole("link", { name: "Modifier" }).click();
  await expect(page.getByText("Correction tracée")).toBeVisible();
  const quantity = page.getByRole("textbox", { name: "Quantité" });
  await quantity.fill("1,5");
  await page.getByRole("textbox", { name: "Motif de la correction (facultatif)" }).fill("dose mal recopiée");
  await page.getByRole("button", { name: "Enregistrer la correction" }).click();

  // Retour à la fiche : la correction est dans l'historique, avec le motif et l'avant → après.
  await expect(page.getByText("Intervention corrigée.")).toBeVisible();
  await expect(page.getByText("Corrigée", { exact: true })).toBeVisible();
  await expect(page.getByText("« dose mal recopiée »")).toBeVisible();
  await expect(page.getByText(new RegExp(`${phyto.name} 1 .*/ha → ${phyto.name} 1,5 .*/ha`))).toBeVisible();

  // Le stock suit : 0,5 /ha de plus sur la surface de la parcelle.
  const after = await stockOf();
  expect(after - before).toBeCloseTo(-0.5 * (parcel.version.areaM2 / 10_000), 3);
  expect(crashes).toEqual([]);
});
