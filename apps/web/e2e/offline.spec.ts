import { expect, test } from "@playwright/test";
import { login, navTo } from "./shared";

/**
 * « Ma ferme », lot F5 (R7) : la ferme gardée hors ligne s'ouvre sans réseau.
 * Vérifie le point laissé ouvert par la conception (§6.4) : le service worker
 * sert bien à MapLibre (qui charge ses tuiles depuis son worker) les tuiles
 * de la copie. Prérequis : build de production (`vite preview`), où le
 * service worker est enregistré.
 */
test("copie hors ligne : la carte des parcelles s'ouvre réseau coupé", async ({ page, context }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.getByRole("link", { name: /Ferme pilote — viticulture/ }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  const farmId = new URL(page.url()).pathname.split("/")[2]!;
  const api = `/api/v1/farms/${farmId}`;
  await page.evaluate(() => navigator.serviceWorker.ready);

  // Siège au centre des parcelles, zone de 1 km, fonds seulement : un plan court.
  const profile = await (await page.request.get(`${api}/farm`)).json();
  const hq = profile.sites.find((s: { isHeadquarters: boolean }) => s.isHeadquarters);
  const [lon, lat] = (await (await page.request.get(`${api}/plan3d`)).json()).center as [number, number];
  const put = (body: unknown) => page.request.put(`${api}/farm/sites/${hq.id}`, { data: body });
  const settings = (await (await page.request.get(`${api}/ign/cache`)).json()).settings;
  try {
    expect((await put({ ...hq, location: { lat, lon }, locationSource: "manual", geocode: null, radiusM: 1000 })).ok()).toBe(true);
    expect((await page.request.put(`${api}/settings/ign`, { data: { layers: ["ortho", "plan"], detailMarginM: 0, autoRefresh: false } })).ok()).toBe(true);

    // En ligne : la carte passe par le relais, qui remplit le cache du serveur.
    await navTo(page, "Plan 2D", "Cartes");
    await page.waitForResponse((r) => r.url().includes(`${api}/ign/tiles/`) && r.status() === 200, { timeout: 60_000 });
    await expect(page.getByText(/\d+ parcelles/)).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Garder pour le hors ligne (onglet Données IGN).
    await page.goto(`/f/${farmId}/farm?tab=ign`);
    const started = Date.now();
    await page.getByRole("button", { name: "Garder pour le hors ligne" }).click();
    const done = page.getByText(/^Copie du .* tuiles/);
    await expect(done).toBeVisible({ timeout: 120_000 });
    const tiles = Number((await done.textContent())!.match(/: ([\d\s]+) tuiles/)![1]!.replace(/\D/g, ""));
    console.log(`[hors ligne] ${tiles} tuiles copiées en ${Date.now() - started} ms`);
    expect(tiles).toBeGreaterThan(0);

    // Encore en ligne : un passage sur la carte garde la coquille, le code de la page et les réponses de l'API.
    await page.goto(`/f/${farmId}/map`);
    await expect(page.getByText(/\d+ parcelles/)).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Réseau coupé : rechargement complet de la page.
    await context.setOffline(true);
    const fromCopy: number[] = [];
    const failed: string[] = [];
    page.on("response", (r) => r.url().includes("/ign/tiles/") && r.fromServiceWorker() && fromCopy.push(r.status()));
    page.on("requestfailed", (r) => r.url().includes("/ign/tiles/") && failed.push(r.url()));
    await page.reload();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\d+ parcelles/)).toBeVisible();
    await expect.poll(() => fromCopy.filter((s) => s === 200).length, { timeout: 30_000 }).toBeGreaterThan(0);
    console.log(`[hors ligne] ${fromCopy.length} tuiles servies par le service worker, ${failed.length} hors copie`);
  } finally {
    await context.setOffline(false);
    // Remise en état de la ferme pilote pour les autres parcours.
    await put({ ...hq });
    await page.request.put(`${api}/settings/ign`, { data: settings });
  }
});
