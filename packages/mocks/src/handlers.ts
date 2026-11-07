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
  demoPeople,
  demoProcedures,
  demoStock,
  demoPhytoRegister,
  DEMO_FARM_ID,
  DEMO_USER_ID,
} from "./fixtures.js";

/**
 * Handlers MSW servant les fixtures de démo sur les routes de l'API (§5.1).
 * Permettent aux écrans web, au plan 3D et au mobile d'avancer — et d'être
 * testés — sans l'API réelle. Les écritures renvoient des réponses plausibles.
 */
const base = `/api/v1/farms/${DEMO_FARM_ID}`;
const page = <T>(items: T[]) => HttpResponse.json({ items, nextCursor: null });

/** Session simulée (better-auth) : connectée par défaut ; les tests la pilotent. */
let signedIn = true;
export function setMockSignedIn(value: boolean) {
  signedIn = value;
}
/** Mot de passe refusé par la connexion simulée. */
export const MOCK_WRONG_PASSWORD = "mauvais-mot-de-passe";
const demoUser = { id: DEMO_USER_ID, email: "demo@fourmy.local", name: "Démo", emailVerified: true, image: null, createdAt: now(), updatedAt: now() };
function now() {
  return "2026-06-01T00:00:00.000Z";
}
const demoSession = () => ({
  session: { id: "mock-session", userId: DEMO_USER_ID, token: "mock", expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now(), updatedAt: now() },
  user: demoUser,
});

export const handlers = [
  http.get("*/api/auth/get-session", () => HttpResponse.json(signedIn ? demoSession() : null)),
  http.post("*/api/auth/sign-in/email", async ({ request }) => {
    const body = (await request.json()) as { password?: string };
    if (body.password === MOCK_WRONG_PASSWORD) {
      return HttpResponse.json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, { status: 401 });
    }
    signedIn = true;
    return HttpResponse.json({ redirect: false, token: "mock", user: demoUser });
  }),
  http.post("*/api/auth/sign-out", () => {
    signedIn = false;
    return HttpResponse.json({ success: true });
  }),
  http.get(`*${base}/members`, () =>
    page([{ userId: DEMO_USER_ID, email: demoUser.email, name: demoUser.name, role: "owner", personId: null }]),
  ),
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
  http.post(`*${base}/interventions/:id/cancel`, ({ params }) =>
    HttpResponse.json({ ...demoInterventions[0], id: params.id, status: "cancelled" }),
  ),
  http.get(`*${base}/procedures`, () => HttpResponse.json(demoProcedures)),
  http.get(`*${base}/people`, () => page(demoPeople)),
  http.get(`*${base}/registers/phyto`, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "csv") {
      return new HttpResponse("Date;Parcelle\r\n2026-06-10;Les Rouffiats\r\n", { headers: { "content-type": "text/csv" } });
    }
    return HttpResponse.json({ campaign: Number(url.searchParams.get("campaign")), items: demoPhytoRegister });
  }),
];
