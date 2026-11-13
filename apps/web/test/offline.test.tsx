import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import type { IgnCacheManifest, IgnCacheState } from "@fourmy/contracts";
import { cacheName, forgetOffline, freeOffline, NotEnoughSpace, offlineStatus, planCopy, runCopy } from "../src/app/offline";
import { installOfflineFakes } from "./fake-caches";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** « Ma ferme », lot F5 : copie hors ligne dans le navigateur (E14, N3 bis, R7). */
const base = `/api/v1/farms/${FARM}`;
const entry = (z: number, etag = '"a"') => ({ url: `${base}/ign/tiles/ortho/${z}/1/1`, etag, bytes: 1000 });
let manifest: IgnCacheManifest = { entries: [], bytes: 0 };
let tileRequests: string[] = [];
let failTile: string | null = null;

function serve(entries: IgnCacheManifest["entries"]) {
  manifest = { entries, bytes: entries.reduce((n, e) => n + e.bytes, 0) };
  tileRequests = [];
  server.use(
    http.get(`*${base}/ign/cache/manifest`, () => HttpResponse.json(manifest)),
    http.get(`*${base}/ign/tiles/:layer/:z/:x/:y`, ({ request }) => {
      const path = new URL(request.url).pathname;
      tileRequests.push(path);
      if (path === failTile) return new HttpResponse(null, { status: 502 });
      return new HttpResponse(new Uint8Array(1000), { headers: { "content-type": "image/jpeg" } });
    }),
  );
}

let fakes: ReturnType<typeof installOfflineFakes> | null = null;
afterEach(() => {
  fakes?.uninstall();
  fakes = null;
  failTile = null;
});

describe("copie hors ligne", () => {
  it("copie depuis le serveur, puis ne retélécharge que ce qui a changé", async () => {
    fakes = installOfflineFakes();
    serve([entry(14), entry(15), entry(16)]);
    await runCopy(FARM, await planCopy(FARM), () => {});
    expect(tileRequests).toHaveLength(3);
    expect(await offlineStatus(FARM)).toMatchObject({ copy: { tiles: 3, bytes: 3000 }, erased: false });

    // La 14 change de version, la 16 sort du plan, la 17 arrive.
    serve([entry(14, '"b"'), entry(15), entry(17)]);
    const plan = await planCopy(FARM);
    expect(plan.toFetch.map((e) => e.url)).toEqual([entry(14).url, entry(17).url]);
    expect(plan.toDelete).toEqual([entry(16).url]);
    await runCopy(FARM, plan, () => {});
    expect(tileRequests).toHaveLength(2);
    const urls = fakes.storage.urls(cacheName(FARM)).map((u) => new URL(u).pathname);
    expect(urls).toContain(entry(17).url);
    expect(urls).not.toContain(entry(16).url);
  });

  it("place insuffisante : rien n'est commencé (N3 bis)", async () => {
    fakes = installOfflineFakes({ quota: 2500, usage: 0 });
    serve([entry(14), entry(15), entry(16)]);
    const plan = await planCopy(FARM);
    await expect(runCopy(FARM, plan, () => {})).rejects.toBeInstanceOf(NotEnoughSpace);
    expect(tileRequests).toEqual([]);
    expect(await caches.has(cacheName(FARM))).toBe(false);
  });

  it("échec en route : la copie est vidée plutôt qu'à moitié faite", async () => {
    fakes = installOfflineFakes();
    serve([entry(14), entry(15), entry(16)]);
    failTile = entry(16).url;
    await expect(runCopy(FARM, await planCopy(FARM), () => {})).rejects.toThrow(/502/);
    expect(await caches.has(cacheName(FARM))).toBe(false);
    expect((await offlineStatus(FARM)).copy).toBeNull();
  });

  it("signale une copie effacée par le navigateur ; la déconnexion efface tout", async () => {
    fakes = installOfflineFakes();
    serve([entry(14)]);
    await runCopy(FARM, await planCopy(FARM), () => {});
    await caches.delete(cacheName(FARM)); // le navigateur purge
    expect(await offlineStatus(FARM)).toMatchObject({ copy: null, erased: true });

    await runCopy(FARM, await planCopy(FARM), () => {});
    await caches.open("fourmy-api-v1");
    await forgetOffline();
    expect(await caches.keys()).toEqual([]);
    expect(await offlineStatus(FARM)).toMatchObject({ copy: null, erased: false });
  });

  it("« Libérer l'espace » supprime la copie sans la signaler comme effacée", async () => {
    fakes = installOfflineFakes();
    serve([entry(14)]);
    await runCopy(FARM, await planCopy(FARM), () => {});
    await freeOffline(FARM);
    expect(await offlineStatus(FARM)).toMatchObject({ copy: null, erased: false });
  });
});

describe("onglet Données IGN : sur cet ordinateur", () => {
  const state: IgnCacheState = {
    settings: { layers: ["ortho"], detailMarginM: 200, autoRefresh: false },
    plan: { tiles: 3, estimateBytes: 75_000, layers: { ortho: 3 } },
    cached: { tiles: 3, bytes: 3000 },
    lastJob: null,
    confirmAboveBytes: 2e9,
    canEdit: false,
  };

  it("un salarié garde la ferme hors ligne, puis libère l'espace (R7)", async () => {
    fakes = installOfflineFakes();
    serve([entry(14), entry(15), entry(16)]);
    server.use(http.get(`*${base}/ign/cache`, () => HttpResponse.json(state)));
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/farm?tab=ign`);
    await user.click(await screen.findByRole("button", { name: "Garder pour le hors ligne" }, { timeout: 10_000 }));
    expect(await screen.findByText(/: 3 tuiles, 1 Mo\./)).toBeInTheDocument();
    expect(tileRequests).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Libérer l'espace" }));
    await waitFor(() => expect(screen.getByText(/Aucune copie sur cet ordinateur/)).toBeInTheDocument());
  });

  it("dit la place qui manque, sans rien copier", async () => {
    fakes = installOfflineFakes({ quota: 1500 });
    serve([entry(14), entry(15), entry(16)]);
    server.use(http.get(`*${base}/ign/cache`, () => HttpResponse.json(state)));
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/farm?tab=ign`);
    await user.click(await screen.findByRole("button", { name: "Garder pour le hors ligne" }, { timeout: 10_000 }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Il faut 1 Mo, il en reste 1 Mo/);
    expect(tileRequests).toEqual([]);
  });

  it("sans Cache Storage, le dit simplement", async () => {
    server.use(http.get(`*${base}/ign/cache`, () => HttpResponse.json(state)));
    renderApp(`/f/${FARM}/farm?tab=ign`);
    expect(await screen.findByText("Ce navigateur ne permet pas de garder la ferme hors ligne.", {}, { timeout: 10_000 })).toBeInTheDocument();
  });
});
