import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { demoParcelSeries } from "@fourmy/mocks";
import { chartRows } from "../src/features/remote-sensing/VegetationTab";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Télédétection (lot Y) : onglet Végétation de la fiche parcelle (graphique,
 * parcelle trop petite, intégration absente). Récoltes probables non saisies
 * (lot Z) : widget du tableau de bord, bandeau, saisie pré-remplie.
 */
const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const shape = { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.501, 44.8], [0.501, 44.801], [0.5, 44.8]]]] };
const sheet = {
  id: PARCEL,
  name: "Les Rouffiats",
  shape,
  areaM2: 12000,
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

describe("télédétection", () => {
  it("lignes du graphique : mesures, dates nuageuses écartées, courbes et repères d'intervention", () => {
    const rows = chartRows(demoParcelSeries(PARCEL, "2025-06-02", "2026-06-01"));
    const dates = rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
    expect(rows.some((r) => r.mesure !== undefined && r.bande !== undefined)).toBe(true);
    expect(rows.some((r) => r.nuageux !== undefined && r.mesure === undefined)).toBe(true);
    expect(rows.find((r) => r.date === "2026-04-12")).toBeDefined(); // semis : repère vertical
  });

  it("onglet Végétation : série NDVI de la parcelle avec sa légende et la mention Copernicus", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)));
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2026-06-10`);
    await user.click(await screen.findByRole("tab", { name: "Végétation" }));
    expect(await screen.findByRole("heading", { name: /NDVI du 11\/06\/2025 au 10\/06\/2026/ })).toBeInTheDocument();
    expect(screen.getByText(/mesures exploitables sur \d+ passages/)).toBeInTheDocument();
    expect(screen.getByLabelText("Légende du NDVI")).toBeInTheDocument();
    expect(screen.getByText(/Contient des données Copernicus Sentinel modifiées/)).toBeInTheDocument();
  });

  it("parcelle trop petite : explique pourquoi il n'y a pas de mesure", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/land-parcels/:id/indices", () =>
        HttpResponse.json({ ...demoParcelSeries(PARCEL, "2025-06-11", "2026-06-10"), tooSmall: true, parcelPixels: 3, points: [], smoothed: [], reference: [] }),
      ),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2026-06-10`);
    await user.click(await screen.findByRole("tab", { name: "Végétation" }));
    expect(await screen.findByText("Parcelle trop petite pour Sentinel-2")).toBeInTheDocument();
    expect(screen.getByText(/ne compte que 3 pixels de 10 m/)).toBeInTheDocument();
  });

  it("sans intégration Copernicus : renvoie vers sa configuration", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/remote-sensing/status", () => HttpResponse.json({ enabled: false, lastSceneOn: null, usage: { month: "2026-06-01", requests: 0, pu: 0, budget: 3000 } })),
      http.get("*/land-parcels/:id/indices", () => HttpResponse.json({ ...demoParcelSeries(PARCEL, "2025-06-11", "2026-06-10"), points: [], smoothed: [], reference: [] })),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2026-06-10`);
    await user.click(await screen.findByRole("tab", { name: "Végétation" }));
    expect(await screen.findByRole("link", { name: "Configurer Copernicus" })).toHaveAttribute("href", expect.stringContaining("/integrations"));
  });
});

const anomaly = {
  parcelId: PARCEL,
  parcelName: "Les Rouffiats",
  from: "2026-07-28",
  to: "2026-08-19",
  high: 0.56,
  low: 0.27,
  confirmed: true,
  dueSince: "2026-09-18",
  suggestedProcedure: "harvesting",
};

describe("récoltes probables non saisies", () => {
  it("tableau de bord : signale la parcelle, propose la saisie pré-remplie et permet d'écarter", async () => {
    const user = userEvent.setup();
    let dismissed: unknown = null;
    server.use(
      http.get("*/remote-sensing/anomalies", () => HttpResponse.json({ items: dismissed ? [] : [anomaly] })),
      http.post("*/remote-sensing/anomalies/dismiss", async ({ request }) => {
        dismissed = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp(`/f/${FARM}?at=2026-10-10`);
    const table = await screen.findByRole("table", { name: "Récoltes probables non saisies" });
    expect(within(table).getByRole("link", { name: "Les Rouffiats" })).toHaveAttribute("href", expect.stringContaining(`/land-parcels/${PARCEL}?`));
    expect(within(table).getByRole("link", { name: "Les Rouffiats" }).getAttribute("href")).toContain("tab=vegetation");
    const saisir = within(table).getByRole("link", { name: "Saisir la récolte" }).getAttribute("href")!;
    const params = new URL(saisir, "http://x").searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ at: "2026-08-19", procedure: "harvesting", status: "done", parcels: PARCEL });
    expect(within(table).getByText(/NDVI 0,56 le 28\/07\/2026, 0,27 le 19\/08\/2026/)).toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: "Ce n'est pas une récolte" }));
    await vi.waitFor(() => expect(dismissed).toEqual({ parcelId: PARCEL, to: "2026-08-19", reason: "Pas une récolte" }));
    await vi.waitFor(() => expect(screen.queryByRole("table", { name: "Récoltes probables non saisies" })).not.toBeInTheDocument());
  });

  it("onglet Végétation : bandeau de la parcelle", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/remote-sensing/anomalies", () => HttpResponse.json({ items: [anomaly, { ...anomaly, parcelId: "autre", parcelName: "Ailleurs" }] })),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2026-10-10&tab=vegetation`);
    expect(await screen.findByText("Récolte probable non saisie")).toBeInTheDocument();
    expect(screen.getAllByText("Récolte probable non saisie")).toHaveLength(1);
    expect(screen.getByText(/aucune récolte, broyage, fauche ni labour n'est saisi entre le 21\/07\/2026 et le 18\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Végétation" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Général" }));
  });

  it("la saisie pré-remplie cible la parcelle", async () => {
    server.use(http.get("*/crew-templates", () => HttpResponse.json({ items: [] })));
    renderApp(`/f/${FARM}/interventions/new?at=2026-08-19&procedure=harvesting&status=done&parcels=${PARCEL}`);
    const form = await screen.findByRole("form", { name: "Saisie de l'intervention" });
    // Pastille du sélecteur de parcelles (l'option cachée du menu porte aussi le nom).
    await vi.waitFor(() => expect([...form.querySelectorAll(".mantine-Pill-label")].map((e) => e.textContent)).toContainEqual(expect.stringMatching(/^Les Rouffiats \(/)));
  });
});
