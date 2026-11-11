import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ParcelFertilizationContext } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Contexte de la fertilisation (lot AF) : zonage, sol, analyses, points d'eau. Données synthétiques. */
const PARCEL = "00000000-0000-7000-8000-0000000000a1";
const sheet = {
  id: PARCEL,
  name: "Les Rouffiats",
  shape: { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.501, 44.8], [0.501, 44.801], [0.5, 44.8]]]] },
  areaM2: 60000,
  center: [0.5005, 44.8005],
  pacIslet: null,
  since: "2020-01-01T00:00:00Z",
  until: null,
  productions: [],
  cadastre: [],
  cap: [],
  referencesFetchedAt: null,
  water: [],
  interventions: [],
};
const context = (patch: Partial<ParcelFertilizationContext> = {}): ParcelFertilizationContext => ({
  parcelId: PARCEL,
  name: "Les Rouffiats",
  areaM2: 60000,
  soil: { soilType: null, soilTypeRegion: null, rootingDepthCm: null, waterSourceId: null, tawMm: 140, irrigated: true },
  zone: { status: "in", insee: "64389", commune: "Monassut-Audiracq", zones: ["ouest", "sud"], referential: "Zones vulnérables Adour-Garonne, arrêté du 24/08/2026", computedAt: "2026-11-11T10:00:00Z", confirmedAt: null, note: null },
  analyses: [
    {
      id: "00000000-0000-7000-8000-00000000a001",
      parcelId: PARCEL,
      sampledOn: "2026-02-10",
      kind: "rsh",
      horizons: [
        { fromCm: 0, toCm: 30, no3KgHa: 20, nh4KgHa: 9 },
        { fromCm: 30, toCm: 60, no3KgHa: 15, nh4KgHa: 6 },
      ],
      values: null,
      lab: "Labo",
      createdAt: "2026-02-12T08:00:00Z",
    },
  ],
  ...patch,
});
const water = { id: "00000000-0000-7000-8000-00000000b001", name: "Forage", origin: "groundwater", nitrateMgL: 18, measuredOn: "2026-07-01", method: "strip", parcels: 1 };

describe("fertilisation azotée", () => {
  it("onglet Sol : zonage, type de sol régional enregistré, reliquat", async () => {
    let saved: unknown = null;
    server.use(
      http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/land-parcels/:id/fertilization", () => HttpResponse.json(context())),
      http.get("*/water-sources", () => HttpResponse.json({ items: [water] })),
      http.put("*/land-parcels/:id/soil-profile", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(context({ soil: { ...context().soil, soilType: "limoneux", soilTypeRegion: "nouvelle-aquitaine" } }));
      }),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?tab=soil`);
    const zone = await screen.findByLabelText("Zonage nitrates");
    expect(within(zone).getByText("En zone vulnérable")).toBeInTheDocument();
    expect(zone).toHaveTextContent("Commune : Monassut-Audiracq (64389)");
    expect(zone).toHaveTextContent("plan prévisionnel de fumure et cahier d'enregistrement obligatoires");
    // 20 + 15 de nitrates, 9 + 6 × 1/3 d'ammonium.
    expect(within(screen.getByLabelText("Analyses de sol")).getByText("46 kg N/ha sur 60 cm")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getAllByLabelText("Type de sol (référentiel Nouvelle-Aquitaine)")[0]!);
    await user.click(await screen.findByRole("option", { name: /Sols limoneux/ }));
    await waitFor(() => expect(saved).toEqual({ soilType: "limoneux", rootingDepthCm: null, waterSourceId: null }));
  });

  it("page de la ferme : obligations, zonage par parcelle, points d'eau", async () => {
    server.use(
      http.get("*/fertilization/parcels", () => HttpResponse.json({ items: [context(), context({ parcelId: "p2", name: "Autre", areaM2: 20000, zone: null, analyses: [] })] })),
      http.get("*/water-sources", () => HttpResponse.json({ items: [water] })),
    );
    renderApp(`/f/${FARM}/fertilization?at=2026-06-01`);
    expect(await screen.findByLabelText("Obligations")).toHaveTextContent("1 parcelle en zone vulnérable (6,00 ha)");
    const table = screen.getByRole("table", { name: "Parcelles et zonage" });
    expect(within(table).getByText("46 kg N/ha (10/02/2026)")).toBeInTheDocument();
    expect(within(table).getAllByText("à renseigner")).toHaveLength(2);
    expect(await within(screen.getByLabelText("Points d'eau d'irrigation")).findByText(/18 mg\/L \(bandelette/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualiser le zonage" })).toBeInTheDocument();
    // 6 ha en zone vulnérable : analyse annuelle ; le reliquat du 10/02/2026 compte pour la campagne 2026.
    expect(await screen.findByLabelText("Analyse de sol annuelle")).toHaveTextContent("Analyse de sol de la campagne 2026 faite : reliquat sortie d'hiver le 10/02/2026 (Les Rouffiats).");
  });
});
