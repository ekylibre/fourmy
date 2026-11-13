import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import type { IgnCacheState } from "@fourmy/contracts";
import { ignTiles } from "../src/features/map/ParcelMap";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** « Ma ferme », lot F4 : onglet « Données IGN » (E12, E13, N3, R6) et relais des tuiles. */
const state = (over: Partial<IgnCacheState> = {}): IgnCacheState => ({
  settings: { layers: ["ortho", "plan"], detailMarginM: 200, autoRefresh: false },
  plan: { tiles: 4200, estimateBytes: 84e6, layers: { ortho: 2600, plan: 1600 } },
  cached: { tiles: 1050, bytes: 21e6 },
  lastJob: null,
  confirmAboveBytes: 2e9,
  canEdit: true,
  ...over,
});
const cacheRoute = `*/api/v1/farms/${FARM}/ign/cache`;

describe("Données IGN", () => {
  it("sans siège placé, renvoie vers les sites", async () => {
    renderApp(`/f/${FARM}/farm?tab=ign`);
    expect(await screen.findByText("Aucune zone à préparer", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Placez d'abord le siège sur la carte" })).toBeInTheDocument();
  });

  it("affiche l'estimation et lance le téléchargement (R6)", async () => {
    let posted: unknown = null;
    server.use(
      http.get(cacheRoute, () => HttpResponse.json(state())),
      http.post(`${cacheRoute}/jobs`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: "j1", status: "pending" }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/farm?tab=ign`);
    expect(await screen.findByText(/4 200 tuiles, environ 84 Mo\. 1 050 déjà en cache \(25 %\)/, {}, { timeout: 10_000 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Télécharger maintenant" }));
    await waitFor(() => expect(posted).toEqual({ confirm: false }));
  });

  it("demande confirmation au-delà du seuil (N3)", async () => {
    let posted: unknown = null;
    server.use(
      http.get(cacheRoute, () => HttpResponse.json(state({ plan: { tiles: 120_000, estimateBytes: 2.6e9, layers: { ortho: 120_000 } } }))),
      http.post(`${cacheRoute}/jobs`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: "j1", status: "pending" }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/farm?tab=ign`);
    await user.click(await screen.findByRole("button", { name: "Télécharger maintenant" }, { timeout: 10_000 }));
    expect(posted).toBeNull();
    expect(screen.getByText(/Environ 2,6 Go seront téléchargés/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(posted).toEqual({ confirm: true }));
  });

  it("montre la progression par couche et un échec partiel (E13)", async () => {
    server.use(
      http.get(cacheRoute, () =>
        HttpResponse.json(
          state({
            lastJob: {
              id: "j1",
              status: "partial",
              layers: ["ortho", "plan"],
              tileCount: 4200,
              estimateBytes: 84e6,
              progress: { ortho: { total: 2600, done: 2600, fetched: 2500, failed: 12 }, plan: { total: 1600, done: 1600, fetched: 1600, failed: 0 } },
              error: "12 tuile(s) non téléchargée(s) : IGN : HTTP 503",
              createdAt: "2026-11-13T10:00:00Z",
              startedAt: "2026-11-13T10:00:05Z",
              finishedAt: "2026-11-13T10:12:00Z",
              waitingSeconds: null,
            },
          }),
        ),
      ),
    );
    renderApp(`/f/${FARM}/farm?tab=ign`);
    expect(await screen.findByText("Incomplet", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(/2 600 \/ 2 600, 12 en échec/)).toBeInTheDocument();
    expect(screen.getByText(/seules les tuiles manquantes seront demandées/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Télécharger maintenant" })).toBeInTheDocument();
  });

  it("tâche en attente du worker : délai normal, puis avertissement s'il semble arrêté", async () => {
    const pending = (waitingSeconds: number) =>
      state({
        lastJob: {
          id: "j1",
          status: "pending",
          layers: ["ortho"],
          tileCount: 2600,
          estimateBytes: 52e6,
          progress: { ortho: { total: 2600, done: 0, fetched: 0, failed: 0 } },
          error: null,
          createdAt: "2026-11-13T10:00:00Z",
          startedAt: null,
          finishedAt: null,
          waitingSeconds,
        },
      });
    let waiting = 20;
    server.use(http.get(cacheRoute, () => HttpResponse.json(pending(waiting))));
    const { unmount } = renderApp(`/f/${FARM}/farm?tab=ign`);
    expect(await screen.findByText("En attente : le téléchargement commence dans la minute.", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByText("Le téléchargement ne démarre pas")).not.toBeInTheDocument();
    unmount();
    waiting = 420;
    renderApp(`/f/${FARM}/farm?tab=ign`);
    expect(await screen.findByText("Le téléchargement ne démarre pas", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(/La demande attend depuis 7 min/)).toBeInTheDocument();
  });

  it("en lecture seule pour un salarié : ni réglage ni lancement", async () => {
    server.use(http.get(cacheRoute, () => HttpResponse.json(state({ canEdit: false }))));
    renderApp(`/f/${FARM}/farm?tab=ign`);
    expect(await screen.findByRole("checkbox", { name: "Photos aériennes" }, { timeout: 10_000 })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Télécharger maintenant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
  });
});

describe("tuiles IGN", () => {
  it("passent par le relais de l'API dans une ferme, directement par l'IGN sinon (E15)", () => {
    expect(ignTiles(FARM, "ortho")).toMatch(new RegExp(`/api/v1/farms/${FARM}/ign/tiles/ortho/\\{z\\}/\\{x\\}/\\{y\\}$`));
    expect(ignTiles(null, "plan")).toContain("https://data.geopf.fr/wmts?");
    expect(ignTiles(null, "plan")).toContain("LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2");
  });
});
