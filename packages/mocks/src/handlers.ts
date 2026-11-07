import { http, HttpResponse } from "msw";
import {
  demoSnapshot,
  demoLandParcelsAt,
  demoPlacesAt,
  demoContainersAt,
  demoContainerContents,
  demoTrackCoverage,
  demoMyFarms,
  demoArticles,
  demoInterventions,
  demoStock,
  demoPhytoRegister,
  DEMO_FARM_ID,
} from "./fixtures.js";

/**
 * Handlers MSW servant les fixtures de démo sur les routes de l'API (§5.1).
 * Permettent aux écrans web, au plan 3D et au mobile d'avancer — et d'être
 * testés — sans l'API réelle. Les écritures renvoient des réponses plausibles.
 */
const base = `/api/v1/farms/${DEMO_FARM_ID}`;
const page = <T>(items: T[]) => HttpResponse.json({ items, nextCursor: null });

export const handlers = [
  http.get("*/health", () => HttpResponse.json({ status: "ok", service: "mock" })),
  http.get("*/api/v1/me/farms", () => HttpResponse.json({ userId: "mock", items: demoMyFarms })),
  http.get(`*${base}/snapshot`, () => HttpResponse.json(demoSnapshot)),
  http.get(`*${base}/land-parcels`, () => page(demoLandParcelsAt)),
  http.get(`*${base}/places`, () => page(demoPlacesAt)),
  http.get(`*${base}/containers`, () => page(demoContainersAt)),
  http.get(`*${base}/containers/:id/contents`, () => HttpResponse.json({ ...demoContainerContents, origins: {} })),
  http.get(`*${base}/tracks/coverage`, () => HttpResponse.json(demoTrackCoverage)),
  http.get(`*${base}/articles`, () => page(demoArticles)),
  http.get(`*${base}/stock`, () => page(demoStock)),
  http.get(`*${base}/interventions`, () => page(demoInterventions)),
  http.post(`*${base}/interventions`, async ({ request }) => {
    const body = (await request.json()) as { id: string; procedure: string };
    return HttpResponse.json({ ...demoInterventions[0], id: body.id, procedure: body.procedure, status: "planned" }, { status: 201 });
  }),
  http.post(`*${base}/interventions/:id/complete`, () =>
    HttpResponse.json({ intervention: { ...demoInterventions[0] }, movements: [], warnings: [] }),
  ),
  http.get(`*${base}/registers/phyto`, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "csv") {
      return new HttpResponse("Date;Parcelle\r\n2026-06-10;Les Rouffiats\r\n", { headers: { "content-type": "text/csv" } });
    }
    return HttpResponse.json({ campaign: Number(url.searchParams.get("campaign")), items: demoPhytoRegister });
  }),
];
