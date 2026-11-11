import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { INTEGRATION_PROVIDERS, type Integration, type Prescription, type Zoning } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

// La carte MapLibre n'a pas de WebGL sous jsdom : on vérifie les zones qu'on lui passe.
vi.mock("../src/features/map/ParcelMap", () => ({
  ParcelMap: ({ parcels }: { parcels: { features: { properties: { name: string; color: string } }[] } }) => (
    <ul aria-label="Carte des zones">
      {parcels.features.map((f) => (
        <li key={f.properties.name} data-color={f.properties.color}>
          {f.properties.name}
        </li>
      ))}
    </ul>
  ),
}));

/** Cartes de modulation et agrirouter (lot AD) : données synthétiques. */
const PARCEL = "00000000-0000-7000-8000-0000000000a1";
const square = (x: number) => ({ type: "MultiPolygon" as const, coordinates: [[[[x, 45], [x + 0.001, 45], [x + 0.001, 45.001], [x, 45.001], [x, 45]]]] });
const zoning: Zoning = {
  parcelId: PARCEL,
  parcelName: "Grand Champ",
  parcelAreaM2: 90_000,
  date: "2026-06-10",
  index: "ndvi",
  zoneCount: 3,
  validRatio: 0.98,
  zones: [
    { code: 1, meanIndex: 0.31, minIndex: 0.2, maxIndex: 0.4, areaM2: 30_000, geometry: square(0) },
    { code: 2, meanIndex: 0.5, minIndex: 0.4, maxIndex: 0.6, areaM2: 30_000, geometry: square(0.001) },
    { code: 3, meanIndex: 0.7, minIndex: 0.6, maxIndex: 0.8, areaM2: 30_000, geometry: square(0.002) },
  ],
};
const prescription: Prescription = {
  id: "00000000-0000-7000-8000-00000000d001",
  name: "Azote 3e apport",
  parcelId: PARCEL,
  parcelName: "Grand Champ",
  parcelAreaM2: 90_000,
  date: "2026-06-10",
  index: "ndvi",
  zoneCount: 3,
  product: "Ammonitrate 33,5",
  unit: "kg_ha",
  strategy: "compensate",
  baseRate: 100,
  modulationPct: 30,
  minRate: 80,
  maxRate: 200,
  widthM: 24,
  totalQuantity: 930,
  createdAt: "2026-06-11T08:00:00Z",
  zones: zoning.zones.map((z, k) => ({ ...z, rate: [130, 100, 80][k]! })),
  sends: [],
};
const TRACTOR = "00000000-0000-7000-8000-00000000e001";
const recipients = {
  companyName: "EARL Essai",
  recipients: [
    { id: TRACTOR, name: "Fendt 724 terminal", endpointType: "virtual_communication_unit", formats: ["isoxml", "shape"] },
    { id: "00000000-0000-7000-8000-00000000e002", name: "Pulvé Amazone", endpointType: "virtual_communication_unit", formats: ["shape"] },
  ],
};

describe("cartes de modulation", () => {
  it("création : zonage d'une image, doses calculées par zone, quantité totale, enregistrement", async () => {
    let posted: Record<string, unknown> | null = null;
    server.use(
      http.get("*/land-parcels/:id/modulation-dates", () => HttpResponse.json({ items: [{ date: "2026-06-10", mean: 0.52, validRatio: 0.98 }] })),
      http.post("*/prescriptions/zoning", () => HttpResponse.json(zoning)),
      http.post("*/prescriptions", async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(prescription, { status: 201 });
      }),
      http.get("*/prescriptions/:id", () => HttpResponse.json(prescription)),
      http.get("*/prescriptions/recipients", () => HttpResponse.json(recipients)),
    );
    renderApp(`/f/${FARM}/prescriptions/new?parcel=${PARCEL}`);
    const user = userEvent.setup();
    expect(await screen.findByDisplayValue("10/06/2026 · NDVI 0,52")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Calculer les zones" }));

    const zones = await screen.findByRole("table", { name: "Zones" });
    expect(within(screen.getByRole("list", { name: "Carte des zones" })).getAllByRole("listitem")).toHaveLength(3);
    // Compenser 20 % autour de 150 kg/ha (valeurs proposées) : 180, 150, 120.
    expect(within(zones).getByRole("textbox", { name: "Dose zone 1" })).toHaveValue("180");
    expect(within(zones).getByRole("textbox", { name: "Dose zone 3" })).toHaveValue("120");
    expect(screen.getByText(/Quantité totale/)).toHaveTextContent("1 350 kg sur 9,00 ha, soit 150 kg/ha en moyenne");

    // Une dose corrigée à la main est envoyée telle quelle.
    const zone1 = within(zones).getByRole("textbox", { name: "Dose zone 1" });
    await user.clear(zone1);
    await user.type(zone1, "200");
    await user.type(screen.getByRole("textbox", { name: "Produit" }), "Ammonitrate 33,5");
    await user.click(screen.getByRole("button", { name: "Enregistrer la carte" }));
    await screen.findByRole("heading", { name: "Azote 3e apport" });
    expect(posted).toMatchObject({ parcelId: PARCEL, date: "2026-06-10", index: "ndvi", zoneCount: 3, unit: "kg_ha", strategy: "compensate", rates: [200, 150, 120] });
  });

  it("fiche : téléchargements, envoi par agrirouter aux seules machines qui acceptent le format", async () => {
    let sent: unknown = null;
    server.use(
      http.get("*/prescriptions/recipients", () => HttpResponse.json(recipients)),
      http.get("*/prescriptions/:id", () => HttpResponse.json(prescription)),
      http.post("*/prescriptions/:id/send", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ id: "s1", format: "isoxml", channel: "agrirouter", recipients: [], sentAt: "2026-06-11T09:00:00Z", sentBy: null, status: "sent", error: null });
      }),
    );
    renderApp(`/f/${FARM}/prescriptions/${prescription.id}`);
    expect(await screen.findByRole("heading", { name: "Azote 3e apport" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ISO-XML (TaskData ISOBUS)" })).toHaveAttribute("href", `/api/v1/farms/${FARM}/prescriptions/${prescription.id}/files/isoxml`);
    expect(screen.getByRole("link", { name: "Shapefile" })).toHaveAttribute("href", `/api/v1/farms/${FARM}/prescriptions/${prescription.id}/files/shape`);

    const panel = await screen.findByLabelText("Envoi par agrirouter");
    expect(within(panel).getByText("Envoyer par agrirouter (EARL Essai)")).toBeInTheDocument();
    // ISO-XML : seul le Fendt est joignable.
    expect(within(panel).getByRole("checkbox", { name: "Fendt 724 terminal · machine" })).toBeInTheDocument();
    expect(within(panel).queryByRole("checkbox", { name: /Pulvé Amazone/ })).not.toBeInTheDocument();
    const user = userEvent.setup();
    expect(within(panel).getByRole("button", { name: "Envoyer" })).toBeDisabled();
    await user.click(within(panel).getByRole("checkbox", { name: "Fendt 724 terminal · machine" }));
    await user.click(within(panel).getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(sent).toEqual({ format: "isoxml", recipients: [TRACTOR] }));
  });

  it("fiche d'une ferme non connectée à agrirouter : renvoi vers les intégrations", async () => {
    server.use(
      http.get("*/prescriptions/recipients", () => HttpResponse.json({ title: "Requête invalide", status: 400, detail: "Ferme non connectée à agrirouter (Intégrations)." }, { status: 400 })),
      http.get("*/prescriptions/:id", () => HttpResponse.json(prescription)),
    );
    renderApp(`/f/${FARM}/prescriptions/${prescription.id}`);
    expect(await screen.findByText(/connectez la ferme à agrirouter/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Intégrations" })).toHaveAttribute("href", `/f/${FARM}/integrations`);
  });
});

describe("agrirouter dans les intégrations", () => {
  const agrirouter = INTEGRATION_PROVIDERS.find((p) => p.provider === "agrirouter")!;

  it("non configuré sur le serveur : bouton inactif et explication", async () => {
    server.use(http.get("*/integrations", () => HttpResponse.json({ providers: [{ ...agrirouter, available: false }], items: [] })));
    renderApp(`/f/${FARM}/integrations`);
    const card = await screen.findByTestId("integration-agrirouter");
    expect(within(card).getByRole("button", { name: "Connecter à agrirouter" })).toBeDisabled();
    expect(within(card).getByText(/pas encore configuré sur ce serveur/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Échanges avec les machines" })).toContainElement(card);
  });

  it("connectée : compte, destinataires et formats", async () => {
    const integ: Integration = {
      id: "00000000-0000-7000-8000-00000000f001",
      provider: "agrirouter",
      settings: { endpointId: "e", companyName: "EARL Essai", connectedAt: "2026-06-01T08:00:00Z" },
      hasSecret: true,
      secretHint: null,
      enabled: true,
      status: "ok",
      running: false,
      lastSyncAt: "2026-06-11T08:00:00Z",
      lastError: null,
      lastReport: recipients,
    };
    server.use(http.get("*/integrations", () => HttpResponse.json({ providers: [{ ...agrirouter, available: true }], items: [integ] })));
    renderApp(`/f/${FARM}/integrations`);
    const card = await screen.findByTestId("integration-agrirouter");
    expect(within(card).getByText("Connectée")).toBeInTheDocument();
    expect(within(card).getByText("EARL Essai")).toBeInTheDocument();
    expect(within(card).getByText("Fendt 724 terminal (machine) : ISO-XML, Shapefile")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Déconnecter" })).toBeInTheDocument();
  });

  it("retour du consentement : termine la connexion de la ferme indiquée par l'état", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/integrations/agrirouter/complete", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ items: [] });
      }),
    );
    const state = `${FARM}.jeton-unique`;
    renderApp(`/agrirouter/callback?state=${encodeURIComponent(state)}&tenant_id=33333333-3333-4333-8333-333333333333`);
    expect(await screen.findByText("agrirouter connecté")).toBeInTheDocument();
    expect(body).toEqual({ state, tenantId: "33333333-3333-4333-8333-333333333333" });
    expect(screen.getByRole("link", { name: "Retour aux intégrations" })).toHaveAttribute("href", `/f/${FARM}/integrations`);
  });

  it("consentement refusé : rien n'est envoyé à l'API", async () => {
    renderApp(`/agrirouter/callback?state=${FARM}.x&error=access_denied`);
    expect(await screen.findByText("Connexion refusée dans agrirouter.")).toBeInTheDocument();
  });
});
