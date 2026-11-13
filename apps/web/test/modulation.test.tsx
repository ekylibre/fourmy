import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { INTEGRATION_PROVIDERS, type Integration, type Prescription, type Zoning } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

// Pages chargées à la demande (React.lazy) : les compiler avant les tests. Sinon
// la première navigation vers la fiche peut dépasser le délai des findBy sur
// une CI chargée (échec aléatoire « Azote 3e apport » introuvable, 12/11/2026).
beforeAll(async () => {
  await Promise.all([import("../src/features/modulation/PrescriptionNewPage"), import("../src/features/modulation/PrescriptionPage")]);
}, 30_000);

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
  plan: null,
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

  it("depuis un apport du plan de fumure : dose du plan gardée en moyenne pondérée (lot AN)", async () => {
    let posted: Record<string, unknown> | null = null;
    // Zones inégales : la zone 3 (la plus forte) couvre la moitié de la parcelle.
    const unequal: Zoning = { ...zoning, zones: zoning.zones.map((z, k) => ({ ...z, areaM2: [22_500, 22_500, 45_000][k]! })) };
    server.use(
      http.get("*/land-parcels/:id/modulation-dates", () => HttpResponse.json({ items: [{ date: "2026-06-10", mean: 0.52, validRatio: 0.98 }] })),
      http.post("*/prescriptions/zoning", () => HttpResponse.json(unequal)),
      http.post("*/prescriptions", async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...prescription, plan: { planId: "p1", stage: "6 feuilles", targetRate: 300 } }, { status: 201 });
      }),
      http.get("*/prescriptions/:id", () => HttpResponse.json({ ...prescription, plan: { planId: "p1", stage: "6 feuilles", targetRate: 300 } })),
      http.get("*/prescriptions/recipients", () => HttpResponse.json(recipients)),
    );
    renderApp(`/f/${FARM}/prescriptions/new?parcel=${PARCEL}&plan=p1&stage=6+feuilles&product=Ammonitrate+33%2C5&rate=150&unit=kg_ha`);
    expect(await screen.findByLabelText("Apport du plan de fumure")).toHaveTextContent("Carte partie de l'apport « 6 feuilles » du plan de fumure : 150 kg/ha de Ammonitrate 33,5.");
    const user = userEvent.setup();
    await screen.findByDisplayValue("10/06/2026 · NDVI 0,52");
    await user.click(screen.getByRole("button", { name: "Calculer les zones" }));
    const zones = await screen.findByRole("table", { name: "Zones" });
    // 180, 150, 120 donneraient 142,5 en moyenne ; décalées de 7,5 → arrondies : 188, 158, 128 (ou à 1 kg près).
    expect(screen.getByText(/Quantité totale/)).toHaveTextContent("soit 150 kg/ha en moyenne");
    // Bornes de la machine autour de la dose du plan (recette du 11/11 : 400 kg/ha par défaut bornait un apport de 643 kg/ha).
    expect(screen.getByRole("textbox", { name: "Dose minimale de la machine (kg/ha)" })).toHaveValue("75");
    expect(screen.getByRole("textbox", { name: "Dose maximale de la machine (kg/ha)" })).toHaveValue("225");
    expect(screen.queryByLabelText("Écart à la dose du plan")).not.toBeInTheDocument();
    expect(within(zones).getByRole("textbox", { name: "Dose zone 1" })).not.toHaveValue("180");
    await user.click(screen.getByRole("button", { name: "Enregistrer la carte" }));
    await waitFor(() => expect(posted).toMatchObject({ planLink: { planId: "p1", stage: "6 feuilles", targetRate: 150 }, product: "Ammonitrate 33,5", baseRate: 150 }));
    expect(posted!.rates).toBeUndefined();
    await screen.findByRole("heading", { name: "Azote 3e apport" });
    expect(screen.getByLabelText("Apport du plan de fumure")).toHaveTextContent("300 kg/ha prévus, 103 kg/ha en moyenne sur la carte");
  });

  it("depuis un apport daté : l'image proposée est celle qui précède la date prévue (recette du 11/11)", async () => {
    server.use(
      http.get("*/land-parcels/:id/modulation-dates", () =>
        HttpResponse.json({
          items: [
            { date: "2026-11-08", mean: 0.3, validRatio: 1 },
            { date: "2026-06-10", mean: 0.52, validRatio: 0.98 },
            { date: "2026-05-20", mean: 0.41, validRatio: 0.95 },
          ],
        }),
      ),
    );
    renderApp(`/f/${FARM}/prescriptions/new?parcel=${PARCEL}&plan=p1&stage=6+feuilles&product=Ur%C3%A9e&rate=150&unit=kg_ha&on=2026-06-15`);
    expect(await screen.findByDisplayValue("10/06/2026 · NDVI 0,52")).toBeInTheDocument();
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
