import { expect, test } from "@playwright/test";
import { login, navTo } from "./shared";

/**
 * Contrôle AB, lot CT2, sur la ferme pilote viticole : une parcelle certifiée
 * AB reçoit un engrais azoté minéral. La réalisation est refusée sans motif,
 * enregistrée avec ; le constat apparaît dans « Contrôle AB » (règles et
 * conversion redémarrée) et sur la fiche. La certification et la composition
 * de l'engrais sont retirées à la fin (l'intervention, par le nettoyage).
 */
const FARM = process.env.E2E_FARM_ID ?? "a3803fc8-5e47-589c-8d8b-266d5930080f";
const api = `/api/v1/farms/${FARM}`;
const DAY = "2023-06-15";

test("engrais azoté minéral sur une parcelle AB : feu rouge, motif, constat dans Contrôle AB", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await login(page);
  await expect(page.getByRole("link", { name: /Ferme pilote — viticulture/ })).toBeVisible();

  const snapshot = await (await page.request.get(`${api}/snapshot?at=${DAY}T12:00:00Z`)).json();
  const parcel = snapshot.landParcels[0] as { id: string; name: string };
  const articles = (await (await page.request.get(`${api}/articles`)).json()).items as { id: string; name: string; kind: string; unit: string }[];
  const fertilizer = articles.find((a) => a.kind === "fertilizer" && /tonne/i.test(a.unit))!;
  let certId: string | null = null;
  try {
    const cert = await page.request.post(`${api}/land-parcels/${parcel.id}/certifications`, { data: { kind: "organic", level: "certified", startedOn: "2019-01-01" } });
    expect(cert.status()).toBe(201);
    certId = (await cert.json()).id;
    // Composition d'un engrais azoté minéral (46 % N), le temps du test.
    expect((await page.request.put(`${api}/articles/${fertilizer.id}/fertilizer`, { data: { basis: "mass_percent", nTotal: 46, nMineralShare: 1, nitrateType: "III", foliar: false } })).ok()).toBe(true);

    const id = crypto.randomUUID();
    expect((await page.request.post(`${api}/interventions`, { data: { id, procedure: "fertilizing" } })).ok()).toBe(true);
    const body = {
      periods: [{ startedAt: `${DAY}T06:00:00Z`, stoppedAt: `${DAY}T08:00:00Z` }],
      targets: [{ kind: "land_parcel", id: parcel.id }],
      inputs: [{ articleId: fertilizer.id, quantity: 0.1, per: "hectare" }],
    };
    const refused = await page.request.post(`${api}/interventions/${id}/complete`, { data: body });
    expect(refused.status()).toBe(422);
    expect((await refused.json()).detail).toContain("engrais azoté minéral, interdit en AB");
    const done = await page.request.post(`${api}/interventions/${id}/complete`, { data: { ...body, compliance: { usages: {}, reason: "Erreur de produit signalée à l'OC" } } });
    expect(done.ok()).toBe(true);

    // Menu Réglementaire de la campagne 2023 : « Contrôle AB ».
    await page.goto(`/f/${FARM}?at=${DAY}`);
    await navTo(page, "Contrôle AB", "Réglementaire");
    await expect(page.getByRole("heading", { name: "Contrôle AB", level: 1 })).toBeVisible();
    const fertilization = page.getByLabel("Fertilisation", { exact: true });
    await expect(fertilization).toContainText("est un engrais azoté minéral, interdit en AB");
    await expect(fertilization).toContainText("Manquement INAO n° 4");
    await page.getByRole("tab", { name: "Parcelles" }).click();
    await expect(page.getByRole("table", { name: "Statut de conversion des parcelles" })).toContainText(`Redémarrée le 15/06/2023 : ${fertilizer.name}`);

    // Fiche : constat et motif enregistrés.
    await page.goto(`/f/${FARM}/interventions/${id}?at=${DAY}`);
    const section = page.getByLabel("Certification", { exact: true });
    await expect(section).toContainText("Non conforme");
    await expect(section).toContainText("« Erreur de produit signalée à l'OC »");
    expect(crashes).toEqual([]);
  } finally {
    if (certId) await page.request.delete(`${api}/certifications/${certId}`);
    await page.request.delete(`${api}/articles/${fertilizer.id}/fertilizer`);
  }
});
