import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { demoCropModel, demoInterventions, demoParcelCropModel } from "@fourmy/mocks";
import { reserveRows } from "../src/features/crop-model/CropModelPanel";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Modèle de croissance (lot AB) : encadré de la fiche parcelle, sol modifiable,
 * widget du tableau de bord. Irrigation (lot AC) : saisie de la dose, fiche,
 * lien depuis le signalement « irrigation à prévoir ».
 */
const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const sheet = {
  id: PARCEL,
  name: "Les Rouffiats",
  shape: { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.501, 44.8], [0.501, 44.801], [0.5, 44.8]]]] },
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

describe("modèle de croissance", () => {
  it("courbe de réserve : observée puis prévue, raccordées au dernier jour observé", () => {
    const rows = reserveRows(demoParcelCropModel(PARCEL, "2026-06-20").days);
    const last = rows.findIndex((r) => r.date === "2026-06-20");
    expect(rows[last]!.observee).toBeDefined();
    expect(rows[last]!.prevue).toBeDefined(); // raccord
    expect(rows[last + 1]!.observee).toBeUndefined();
    expect(rows[0]!.prevue).toBeUndefined();
  });

  it("fiche parcelle : stade du jour, dates des stades, eau ; le responsable déclare la parcelle irriguée", async () => {
    const user = userEvent.setup();
    let saved: unknown = null;
    server.use(
      http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)),
      http.put("*/land-parcels/:id/soil", async ({ request }) => {
        saved = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2026-06-20&tab=vegetation`);
    const panel = await screen.findByLabelText("Modèle de croissance");
    expect(within(panel).getByRole("heading", { name: /Maïs, semé le 07\/04\/2026/ })).toBeInTheDocument();
    // 20/06 : 75 jours depuis le semis du 07/04 (13 °Cj par jour dans la démo), floraison atteinte.
    expect(within(panel).getByText(/^Floraison · \d+ °Cj$/)).toBeInTheDocument();
    const stages = within(panel).getByLabelText("Stades");
    expect(within(stages).getByText("Floraison")).toBeInTheDocument();
    expect(within(stages).getByText("20/06/2026")).toBeInTheDocument(); // floraison atteinte (météo observée)
    expect(within(stages).getAllByText(/^vers le \d\d\/\d\d\/2026$/)).toHaveLength(2); // maturité, récoltable : prévues
    expect(within(panel).getByText(/Eau disponible/)).toBeInTheDocument();
    expect(within(panel).getByText(/Réserve utile 100 mm · en sec/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Modifier le sol" }));
    const taw = within(panel).getByRole("textbox", { name: "Réserve utile (mm)" });
    await user.clear(taw);
    await user.type(taw, "150");
    await user.click(within(panel).getByRole("switch", { name: "Parcelle irriguée" }));
    await user.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    await vi.waitFor(() => expect(saved).toEqual({ tawMm: 150, irrigated: true }));
  });

  it("culture sans modèle : l'encadré l'explique", async () => {
    server.use(
      http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/land-parcels/:id/crop-model", () => HttpResponse.json({ at: "2026-06-20", state: null, days: [], reason: "no_model" })),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2026-06-20&tab=vegetation`);
    expect(await screen.findByText(/Pas encore de modèle pour cette culture/)).toBeInTheDocument();
  });

  it("tableau de bord : signalements regroupés par sorte, liens vers la fiche", async () => {
    const base = demoCropModel("2026-06-20");
    const [a] = base.items;
    const b = { parcelId: "00000000-0000-7000-8000-0000000000c0", parcelName: "Le Haut" };
    server.use(
      http.get("*/crop-model", () =>
        HttpResponse.json({
          ...base,
          alerts: [
            { parcelId: a!.parcelId, parcelName: a!.parcelName, kind: "flowering_soon", on: "2026-06-27", text: "vers le 27/06" },
            { parcelId: b.parcelId, parcelName: b.parcelName, kind: "flowering_soon", on: "2026-06-28", text: "vers le 28/06" },
            { parcelId: a!.parcelId, parcelName: a!.parcelName, kind: "water_stress", on: null, text: "réserve à 14 %" },
            { parcelId: b.parcelId, parcelName: b.parcelName, kind: "irrigation_due", on: "2026-06-22", depthMm: 32, text: "vers le 22/06, environ 32 mm" },
          ],
        }),
      ),
    );
    renderApp(`/f/${FARM}?at=2026-06-20`);
    const widget = await screen.findByLabelText("Modèle de croissance");
    expect(within(widget).getByText("Floraison dans les 10 jours")).toBeInTheDocument();
    expect(within(widget).getByText("Stress hydrique")).toBeInTheDocument();
    const irrigate = within(widget).getByRole("link", { name: "Saisir l'irrigation" }).getAttribute("href")!;
    expect(Object.fromEntries(new URL(irrigate, "http://x").searchParams)).toMatchObject({ at: "2026-06-22", procedure: "watering", parcels: b.parcelId, dose: "32" });
    expect(within(widget).getAllByRole("link", { name: a!.parcelName })[0]).toHaveAttribute("href", expect.stringContaining(`/land-parcels/${a!.parcelId}?`));
    expect(within(widget).getAllByRole("link", { name: a!.parcelName })[0]).toHaveAttribute("href", expect.stringContaining("tab=vegetation"));
  });
});

describe("irrigation (lot AC)", () => {
  it("saisie : dose proposée, volume calculé, dose obligatoire à la réalisation", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/crew-templates", () => HttpResponse.json({ items: [] })));
    renderApp(`/f/${FARM}/interventions/new?at=2026-06-20&procedure=watering&status=done&parcels=${PARCEL}&dose=30`);
    const form = await screen.findByRole("form", { name: "Saisie de l'intervention" });
    const dose = await within(form).findByRole("textbox", { name: /Dose d'eau/ });
    expect(dose).toHaveValue("30 mm");
    await vi.waitFor(() => expect(within(form).getByText(/^soit [\d\s\u202f]+ m³$/)).toBeInTheDocument());
    // Réalisation : dose obligatoire (le navigateur bloque l'envoi d'une dose vide).
    expect(dose).toBeRequired();
    await user.clear(dose);
    expect((dose as HTMLInputElement).validity.valueMissing).toBe(true);
  });

  it("fiche de l'intervention : dose, volume et matériel", async () => {
    const watering = { ...demoInterventions[0]!, procedure: "watering", inputs: [], purposes: [], irrigation: { depthMm: 30, method: "reel" } };
    server.use(http.get("*/interventions/:id", () => HttpResponse.json({ ...watering, history: [] })));
    renderApp(`/f/${FARM}/interventions/${watering.id}?at=2026-06-10`);
    const box = await screen.findByLabelText("Irrigation");
    expect(within(box).getByText(/30 mm/)).toBeInTheDocument();
    await vi.waitFor(() => expect(box).toHaveTextContent(/soit [\d\s\u202f]+ m³ sur .* · Enrouleur/));
  });
});
