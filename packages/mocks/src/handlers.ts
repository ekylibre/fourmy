import { http, HttpResponse } from "msw";
import {
  demoSnapshot,
  demoLandParcels,
  demoPlaces,
  demoContainers,
  demoContainerContents,
  demoTrackCoverage,
  DEMO_FARM_ID,
} from "./fixtures.js";

/**
 * Handlers MSW servant les fixtures de démo sur les routes de §5.1.
 * Permettent aux écrans web, au plan 3D et au mobile d'avancer sans l'API
 * réelle (agent 0, jour 1). Les routes non couvertes renvoient 501.
 */
const base = `/api/v1/farms/${DEMO_FARM_ID}`;

export const handlers = [
  http.get("*/health", () => HttpResponse.json({ status: "ok", service: "mock" })),
  http.get(`*${base}/snapshot`, () => HttpResponse.json(demoSnapshot)),
  http.get(`*${base}/land-parcels`, () => HttpResponse.json({ items: demoLandParcels, nextCursor: null })),
  http.get(`*${base}/places`, () => HttpResponse.json({ items: demoPlaces, nextCursor: null })),
  http.get(`*${base}/containers`, () => HttpResponse.json({ items: demoContainers, nextCursor: null })),
  http.get(`*${base}/containers/:id/contents`, () => HttpResponse.json(demoContainerContents)),
  http.get(`*${base}/tracks/coverage`, () => HttpResponse.json(demoTrackCoverage)),
];
