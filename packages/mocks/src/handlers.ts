import { http, HttpResponse } from "msw";
import { DEFAULT_TRACK_SETTINGS, INTEGRATION_PROVIDERS, VEGETATION_INDICES, type VegetationIndex } from "@fourmy/contracts";
import {
  demoSnapshot,
  demoActivities,
  demoLandParcelsAt,
  demoPlacesAt,
  demoContainersAt,
  demoContainerContents,
  demoTrackCoverage,
  demoMyFarms,
  demoArticles,
  demoInterventions,
  demoInterventionHistory,
  demoPeople,
  demoPersonSheet,
  demoProcedures,
  demoEquipments,
  demoStock,
  demoPhytoRegister,
  DEMO_FARM_ID,
  DEMO_USER_ID,
  demoParcelIndicesAt,
  demoParcelSeries,
  demoCropModel,
  demoParcelCropModel,
  demoVegetation3d,
} from "./fixtures.js";

/**
 * Handlers MSW servant les fixtures de démo sur les routes de l'API (§5.1).
 * Permettent aux écrans web, au plan 3D et au mobile d'avancer — et d'être
 * testés — sans l'API réelle. Les écritures renvoient des réponses plausibles.
 */
const base = `/api/v1/farms/${DEMO_FARM_ID}`;
const page = <T>(items: T[]) => HttpResponse.json({ items, nextCursor: null });
const demoIndexParam = (q: URLSearchParams): VegetationIndex => {
  const i = q.get("index") as VegetationIndex | null;
  return i && VEGETATION_INDICES.includes(i) ? i : "ndvi";
};

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

export const DEMO_HQ_ID = "00000000-0000-7000-8000-00000000f001";
const DEMO_GEOCODE = {
  label: "1 Place Pey Berland 33000 Bordeaux",
  line1: "1 Place Pey Berland",
  postalCode: "33000",
  city: "Bordeaux",
  inseeCode: "33063",
  location: { lat: 44.838168, lon: -0.578803 },
  score: 0.977,
  type: "housenumber",
};
const demoFarmProfile = () => ({
  identity: { name: "Ferme de démonstration", legalName: null, legalForm: null, siret: null, vatNumber: null, nafCode: null, pacage: null, cvi: null, ede: null, phone: null, email: null, legalRep: null },
  certifications: [],
  sites: [
    {
      id: DEMO_HQ_ID,
      name: "Siège",
      isHeadquarters: true,
      address: { line1: null, line2: null, postalCode: null, city: null, inseeCode: null },
      location: null,
      locationSource: null,
      geocode: null,
      radiusM: 10000,
    },
  ],
  parcelsOutside: null,
  display: { basemap: "ortho", areaUnit: "ha" },
  logoAssetId: null,
  canEdit: true,
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
  // Synthèse des parcours (tableau de bord) : Traccar inactif dans la démo.
  http.get(`*${base}/tracks/summary`, ({ request }) => {
    const u = new URL(request.url);
    return HttpResponse.json({ enabled: false, from: u.searchParams.get("from"), to: u.searchParams.get("to"), items: [] });
  }),
  http.get(`*${base}/integrations`, () => HttpResponse.json({ providers: INTEGRATION_PROVIDERS, items: [] })),
  // « Ma ferme » (lot F1) : siège sans point, aucune certification ; les écritures renvoient ce qu'elles reçoivent.
  http.get(`*${base}/farm`, () => HttpResponse.json(demoFarmProfile())),
  http.get(`*${base}/settings/maintenance`, () => HttpResponse.json({ soonHours: 50, soonMonths: 1, notify: [] })),
  http.get(`*${base}/settings/tracks`, () => HttpResponse.json(DEFAULT_TRACK_SETTINGS)),
  http.put(`*${base}/farm/identity`, async ({ request }) => HttpResponse.json(await request.json())),
  http.post(`*${base}/farm/certifications`, async ({ request }) => HttpResponse.json({ id: crypto.randomUUID(), ...((await request.json()) as object) }, { status: 201 })),
  http.put(`*${base}/farm/certifications/:id`, async ({ request, params }) => HttpResponse.json({ id: params.id, ...((await request.json()) as object) })),
  http.delete(`*${base}/farm/certifications/:id`, () => new HttpResponse(null, { status: 204 })),
  http.post(`*${base}/farm/sites`, async ({ request }) => HttpResponse.json({ id: crypto.randomUUID(), isHeadquarters: false, ...((await request.json()) as object) }, { status: 201 })),
  http.put(`*${base}/farm/sites/:id`, async ({ request, params }) => HttpResponse.json({ id: params.id, isHeadquarters: params.id === DEMO_HQ_ID, ...((await request.json()) as object) })),
  http.delete(`*${base}/farm/sites/:id`, () => new HttpResponse(null, { status: 204 })),
  http.get(`*${base}/geocode`, ({ request }) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return HttpResponse.json(q.trim().length < 3 ? [] : [DEMO_GEOCODE]);
  }),
  http.get(`*${base}/geocode/reverse`, () => HttpResponse.json(DEMO_GEOCODE)),
  // Données IGN (lot F4) : siège sans point, donc rien à précharger.
  http.get(`*${base}/ign/cache`, () =>
    HttpResponse.json({
      settings: { layers: ["ortho", "plan"], detailMarginM: 200, autoRefresh: false },
      plan: null,
      cached: { tiles: 0, bytes: 0 },
      lastJob: null,
      confirmAboveBytes: 2e9,
      canEdit: true,
    }),
  ),
  http.put(`*${base}/settings/ign`, async ({ request }) => HttpResponse.json(await request.json())),
  // Fertilisants (lot AE) : aucun dans la démo.
  http.get(`*${base}/fertilizers`, () => HttpResponse.json({ items: [] })),
  // Fertilisation azotée (lots AF, AI) : paramètres par défaut, aucun justificatif.
  http.get(`*${base}/fertilization/settings`, () => HttpResponse.json({ region: "nouvelle-aquitaine", campaignStartMmdd: "09-01", aplshZone: null })),
  http.get(`*${base}/fertilization/documents`, () => HttpResponse.json({ items: [] })),
  http.get(`*${base}/fertilization/record`, ({ request }) => {
    const campaign = Number(new URL(request.url).searchParams.get("campaign") ?? new Date().getFullYear());
    return HttpResponse.json({ campaign, from: `${campaign - 1}-09-01`, to: `${campaign}-09-01`, parcels: [], toComplete: 0, late: 0, forced: [] });
  }),
  // Cartes de modulation (lot AD) : aucune dans la démo, aucune image à zoner.
  http.get(`*${base}/prescriptions`, () => HttpResponse.json({ items: [] })),
  http.get(`*${base}/land-parcels/:id/modulation-dates`, () => HttpResponse.json({ items: [] })),
  http.get(`*${base}/members`, () =>
    page([{ userId: DEMO_USER_ID, email: demoUser.email, name: demoUser.name, role: "owner", personId: null }]),
  ),
  // Télédétection : Copernicus actif, séries synthétiques, pas d'image.
  http.get(`*${base}/remote-sensing/status`, () =>
    HttpResponse.json({ enabled: true, lastSceneOn: "2026-05-29", usage: { month: "2026-06-01", requests: 42, pu: 3.5, budget: 3000 } }),
  ),
  http.get(`*${base}/remote-sensing/parcels`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    return HttpResponse.json(demoParcelIndicesAt(q.get("at") ?? "2026-06-01", demoIndexParam(q)));
  }),
  http.get(`*${base}/remote-sensing/scenes`, () => HttpResponse.json({ items: [] })),
  http.get(`*${base}/remote-sensing/anomalies`, () => HttpResponse.json({ items: [] })),
  // Végétation et météo du plan 3D (lot AA).
  http.get(`*${base}/vegetation3d`, ({ request }) => HttpResponse.json(demoVegetation3d(new URL(request.url).searchParams.get("at") ?? "2026-06-01"))),
  http.put(`*${base}/land-parcels/:id/rows`, () => new HttpResponse(null, { status: 204 })),
  http.delete(`*${base}/land-parcels/:id/rows`, () => new HttpResponse(null, { status: 204 })),
  // Modèle de croissance (lot AB).
  http.get(`*${base}/crop-model`, ({ request }) => HttpResponse.json(demoCropModel(new URL(request.url).searchParams.get("at") ?? "2026-06-20"))),
  http.get(`*${base}/land-parcels/:id/crop-model`, ({ request, params }) =>
    HttpResponse.json(demoParcelCropModel(String(params.id), new URL(request.url).searchParams.get("at") ?? "2026-06-20")),
  ),
  http.put(`*${base}/land-parcels/:id/soil`, () => new HttpResponse(null, { status: 204 })),
  http.delete(`*${base}/land-parcels/:id/soil`, () => new HttpResponse(null, { status: 204 })),
  http.post(`*${base}/remote-sensing/anomalies/dismiss`, () => new HttpResponse(null, { status: 204 })),
  http.get(`*${base}/land-parcels/:id/indices`, ({ request, params }) => {
    const q = new URL(request.url).searchParams;
    return HttpResponse.json(demoParcelSeries(String(params.id), q.get("from") ?? "2025-06-02", q.get("to") ?? "2026-06-01", demoIndexParam(q)));
  }),
  http.get("*/health", () => HttpResponse.json({ status: "ok", service: "mock" })),
  // Version du pied de menu (servie par le site en production, par Vite en local).
  http.get("*/version.json", () => HttpResponse.json({ version: "0.112.1", date: "2026-11-13T18:00:00+01:00" })),
  http.get("*/api/v1/me/farms", () => HttpResponse.json({ userId: "mock", items: demoMyFarms })),
  http.get(`*${base}/snapshot`, () => HttpResponse.json(demoSnapshot)),
  http.get(`*${base}/land-parcels/names`, () => HttpResponse.json({ items: demoLandParcelsAt.map((p) => ({ id: p.id, name: p.name })) })),
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
  http.get(`*${base}/interventions/:id`, ({ params }) =>
    HttpResponse.json({ ...demoInterventions.find((i) => i.id === params.id) ?? demoInterventions[0], history: demoInterventionHistory }),
  ),
  http.put(`*${base}/interventions/:id`, () => HttpResponse.json({ intervention: demoInterventions[0], warnings: [] })),
  http.post(`*${base}/interventions/:id/complete`, () =>
    HttpResponse.json({ intervention: { ...demoInterventions[0] }, movements: [], warnings: [] }),
  ),
  http.post(`*${base}/interventions/:id/cancel`, ({ params }) =>
    HttpResponse.json({ ...demoInterventions[0], id: params.id, status: "cancelled" }),
  ),
  // Météo (lot 3).
  http.post(`*${base}/weather/intervention`, () =>
    HttpResponse.json({ weather: { source: "open_meteo", kind: "observed", temperatureC: 14.2, humidityPct: 82, windKmh: 6.5, windMaxKmh: 11, precipitationMm: 0, fetchedAt: "2026-06-10T09:00:00.000Z" } }),
  ),
  http.get(`*${base}/weather/stations`, () =>
    HttpResponse.json({
      items: [{ id: "00000000-0000-7000-8000-00000000c001", provider: "sencrop", name: "Sencrop vigne", lat: 44.8, lon: 0.5, lastMeasureAt: "2026-06-10T12:00:00Z", measures: 744 }],
    }),
  ),
  http.get(`*${base}/weather/spraying`, () =>
    HttpResponse.json({
      source: "open_meteo",
      latitude: 44.8,
      longitude: 0.5,
      slots: [
        { at: "2026-06-10T08:00:00.000Z", stepHours: 1, level: "stop", reasons: ["vent 22 km/h"], temperatureC: 15, humidityPct: 80, windKmh: 22, precipitationMm: 0 },
        { at: "2026-06-10T09:00:00.000Z", stepHours: 1, level: "go", reasons: [], temperatureC: 16, humidityPct: 82, windKmh: 6, precipitationMm: 0 },
      ],
    }),
  ),
  // Réglementation phyto (lot 2) : par défaut, rien à signaler.
  http.post(`*${base}/phyto/check`, () =>
    HttpResponse.json({ level: "ok", checkedAt: new Date().toISOString(), referential: "2026.11.07.1", checks: [], reason: null }),
  ),
  http.get(`*${base}/interventions/:id/compliance`, () =>
    HttpResponse.json({ level: "ok", checkedAt: new Date().toISOString(), referential: "2026.11.07.1", checks: [], reason: null }),
  ),
  http.get(`*${base}/phyto/ift`, () => HttpResponse.json({ campaign: 2026, total: 0, segments: {}, pendingInterventions: 0, parcels: [] })),
  http.get(`*${base}/phyto/parcels/:id/delays`, () => HttpResponse.json({ reentry: null, harvest: null })),
  http.get(`*${base}/activities`, () => HttpResponse.json({ items: demoActivities })),
  // Référentiels du ministère (registre phyto réglementaire, lot X).
  http.get(`*${base}/reference/phyto-crops`, () =>
    HttpResponse.json({
      items: [
        { code: "27001", label: "Vigne", oepp: "VITVI", bbchRef: "Vigne" },
        { code: "55501", label: "Maïs", oepp: "ZEAMX", bbchRef: "Maïs" },
        { code: "53001", label: "Ray Grass", oepp: "LOLPE", bbchRef: "Graminées" },
      ],
    }),
  ),
  http.get(`*${base}/reference/bbch`, ({ request }) =>
    HttpResponse.json({
      items:
        new URL(request.url).searchParams.get("crop") === "27001"
          ? [
              { code: "SP_27001_53", label: "BBCH 53", description: "les inflorescences sont clairement visibles" },
              { code: "SP_27001_57", label: "BBCH 57", description: "les inflorescences sont développées ; les fleurs se séparent" },
              { code: "SP_27001_65", label: "BBCH 65", description: "pleine floraison : 50 % des capuchons tombés" },
            ]
          : [],
    }),
  ),
  http.get(`*${base}/certifications`, () =>
    HttpResponse.json({
      items: [
        { id: "00000000-0000-7000-8000-0000000000f9", landParcelId: "00000000-0000-7000-8000-0000000000a0", kind: "organic", level: "certified", label: null, certifier: "Ecocert", reference: null, startedOn: "2020-01-01", stoppedOn: null },
      ],
    }),
  ),
  http.get(`*${base}/phyto/status`, () =>
    HttpResponse.json({
      referential: { phytosanitary: "2026.11.07.1", taxonomy: "2026.10.07.1", loadedAt: "2026-11-08T11:00:00.000Z" },
      water: { syncedAt: "2026-11-08T11:05:00.000Z", items: 12, lastError: null },
      articles: { phyto: 1, linked: 1, withoutAmm: 0, unknownAmm: 0 },
    }),
  ),
  http.get(`*${base}/phyto/articles`, () =>
    HttpResponse.json({ items: [{ id: demoArticles[0]!.id, name: demoArticles[0]!.name, unit: "liter", amm: "2100001", product: { name: "GUILD", state: "authorized", stoppedOn: null },
      hazards: ["SGH07", "SGH09"], risks: [{ code: "H319", phrase: "Provoque une sévère irritation des yeux" }, { code: "H410", phrase: "Très toxique pour les organismes aquatiques, entraîne des effets néfastes à long terme" }], reentryDelayHours: 6,
      operatorProtection: "Pendant le mélange/chargement : gants en nitrile.", restrictedMentions: null, mixCodes: [1, 3], organic: false, biocontrol: false }] }),
  ),
  http.get(`*${base}/procedures`, () => HttpResponse.json(demoProcedures)),
  // Matériels et entretien (lots I à K) : liste résumée, plan vide, aucune échéance.
  http.get(`*${base}/equipments`, () =>
    HttpResponse.json({
      items: demoEquipments.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        state: e.state ?? null,
        brand: null,
        brandId: null,
        model: null,
        serialNumber: null,
        year: null,
        meterUnit: e.kind === "tractor" ? "hours" : null,
        logoAssetId: null,
        logoSource: null,
        lastReading: null,
        tracked: false,
        due: null,
      })),
    }),
  ),
  http.get(`*${base}/equipments/:id/maintenance`, ({ params, request }) =>
    HttpResponse.json({
      equipmentId: params.id,
      at: new URL(request.url).searchParams.get("at") ?? new Date().toISOString(),
      settings: { soonHours: 50, soonMonths: 1 },
      usageNow: null,
      model: null,
      operations: [],
      fluids: [],
      parts: [],
    }),
  ),
  http.get(`*${base}/maintenance/due`, () => HttpResponse.json({ items: [], byEquipment: {} })),
  http.get(`*${base}/people`, () => page(demoPeople)),
  http.get(`*${base}/people/:id/work`, () =>
    HttpResponse.json({
      at: "2026-06-30",
      periods: {
        week: { from: "2026-06-29", to: "2026-07-06", hours: 4 },
        month: { from: "2026-06-01", to: "2026-07-01", hours: 21.5 },
        campaign: { from: "2026-01-01", to: "2027-01-01", hours: 64, label: "Campagne 2026" },
        last12: { from: "2025-07-01", to: "2026-07-01", hours: 120 },
      },
      byMonth: ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].map((month, i) => ({ month, hours: [12, 9, 14, 6, 0, 0, 2, 4, 8, 12, 16.5, 21.5][i]! })),
      byActivity: [
        { activityId: "00000000-0000-7000-8000-000000000701", name: "Vigne", hours: 52 },
        { activityId: null, name: "Sans activité", hours: 12 },
      ],
      byProcedure: [
        { procedure: "spraying", hours: 40 },
        { procedure: "plowing", hours: 24 },
      ],
    }),
  ),
  http.get(`*${base}/people/:id/interventions`, () =>
    HttpResponse.json({
      items: [{ id: "00000000-0000-7000-8000-000000000401", date: "2026-06-10", procedure: "spraying", hours: 3.5, parcels: ["Les Rouffiats"], equipments: ["Tracteur"] }],
      nextCursor: null,
    }),
  ),
  http.get(`*${base}/people/:id`, ({ params }) => {
    const sheet = demoPersonSheet(String(params.id));
    return sheet ? HttpResponse.json(sheet) : HttpResponse.json({ title: "Personne introuvable", status: 404 }, { status: 404 });
  }),
  // Contrôles HVE et AB (lot CT1) : une parcelle de démo est certifiée AB depuis 2020.
  http.get(`*${base}/control/availability`, () => HttpResponse.json({ hve: false, ab: true })),
  http.post(`*${base}/control/check`, () => HttpResponse.json({ check: null })),
  http.get(`*${base}/control/ab/parcels`, ({ request }) => {
    const campaign = Number(new URL(request.url).searchParams.get("campaign"));
    return HttpResponse.json({
      campaign,
      period: { from: `${campaign}-01-01`, to: `${campaign}-12-31` },
      items: [
        {
          parcelId: "00000000-0000-7000-8000-0000000000a0",
          name: "Les Rouffiats",
          areaM2: 25_000,
          declaredLevel: "certified",
          startedOn: "2020-01-01",
          conversionStart: "2020-01-01",
          resetBy: null,
          status: "AB",
          productions: [{ id: "00000000-0000-7000-8000-0000000000b0", label: "Vigne", cycle: "perennial", sownOn: "2005-03-01", harvestOn: `${campaign}-09-20`, status: "AB" }],
        },
      ],
    });
  }),
  http.get(`*${base}/control/:kind`, ({ request, params }) => {
    const campaign = Number(new URL(request.url).searchParams.get("campaign"));
    return HttpResponse.json({
      kind: params.kind,
      campaign,
      period: { from: `${campaign}-01-01`, to: `${campaign}-12-31` },
      verdict: "ok",
      sections: [
        {
          id: "perimeter",
          label: "Périmètre",
          level: "ok",
          findings: [{ ruleId: "ab.perimeter", level: "ok", message: "1 parcelle(s) en conversion ou certifiée(s) AB, 2,5 ha sur 12 ha.", refs: {}, source: "Règlement (UE) 2018/848, art. 9.2 et 9.7" }],
        },
      ],
      refsVersion: "2026-11-19.1",
      computedAt: "2026-11-19T08:00:00.000Z",
      exportedAt: null,
      changedSinceExport: false,
    });
  }),
  http.get(`*${base}/registers/phyto`, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "csv") {
      return new HttpResponse("Date;Parcelle\r\n2026-06-10;Les Rouffiats\r\n", { headers: { "content-type": "text/csv" } });
    }
    return HttpResponse.json({ campaign: Number(url.searchParams.get("campaign")), items: demoPhytoRegister });
  }),
];
