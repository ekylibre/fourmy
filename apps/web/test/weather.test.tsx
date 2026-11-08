import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { demoInterventions } from "@fourmy/mocks";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Météo (lot 3) dans le web : pré-remplissage, saisie à la main, widget, fiche. */
const DEMO = demoInterventions[0]!;

async function openTreatment(user: ReturnType<typeof userEvent.setup>) {
  renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
  const button = await screen.findByRole("button", { name: "Nouvelle intervention" });
  await vi.waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const form = await screen.findByRole("dialog");
  await user.click(within(form).getByRole("combobox", { name: "Intervention" }));
  await user.click(await screen.findByRole("option", { name: "Pulvérisation" }));
  await user.click(within(form).getByRole("combobox", { name: "Parcelles" }));
  await user.click(await screen.findByRole("option", { name: /Les Rouffiats/ }));
  return form;
}

describe("météo de l'intervention", () => {
  it("pré-remplie pour le lieu et les dates, envoyée avec l'intervention", async () => {
    const user = userEvent.setup();
    let requested: Record<string, unknown> | null = null;
    let completed: Record<string, unknown> | null = null;
    server.use(
      http.post("*/weather/intervention", async ({ request }) => {
        requested = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ weather: { source: "open_meteo", kind: "observed", temperatureC: 14.2, humidityPct: 82, windKmh: 6.5, windMaxKmh: 11, precipitationMm: 0, fetchedAt: null } });
      }),
      http.post("*/interventions", () => HttpResponse.json({}, { status: 201 })),
      http.post("*/interventions/:id/complete", async ({ request }) => {
        completed = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ intervention: {}, movements: [], warnings: [] });
      }),
    );
    const form = await openTreatment(user);
    const meteo = within(form).getByLabelText("Météo");
    await vi.waitFor(() => expect(within(meteo).getByRole("textbox", { name: "Température" })).toHaveValue("14,2 °C"), { timeout: 3000 });
    expect(within(meteo).getByText("Open-Meteo, observée")).toBeInTheDocument();
    // Redemandée quand la parcelle change : la dernière requête porte sur elle.
    await vi.waitFor(() => expect((requested as { targets?: unknown[] } | null)?.targets).toHaveLength(1), { timeout: 3000 });
    expect(requested).toMatchObject({ targets: [{ kind: "land_parcel" }], periods: [expect.objectContaining({ startedAt: expect.any(String) })] });
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Intervention enregistrée.")).toBeInTheDocument();
    expect(completed).toMatchObject({ weather: { source: "open_meteo", kind: "observed", temperatureC: 14.2, humidityPct: 82 } });
  });

  it("une valeur modifiée à la main passe en saisie et n'est plus écrasée", async () => {
    const user = userEvent.setup();
    const form = await openTreatment(user);
    const meteo = within(form).getByLabelText("Météo");
    const wind = within(meteo).getByRole("textbox", { name: "Vent moyen" });
    await vi.waitFor(() => expect(wind).toHaveValue("6,5 km/h"), { timeout: 3000 });
    await user.clear(wind);
    await user.type(wind, "12");
    expect(within(meteo).getByText("saisie à la main")).toBeInTheDocument();
    expect(within(meteo).getByRole("button", { name: "Reprendre la météo du fournisseur" })).toBeInTheDocument();
    expect(within(meteo).getByRole("textbox", { name: "Température" })).toHaveValue("14,2 °C");
  });

  it("le formulaire d'un traitement à planifier montre les conditions de pulvérisation", async () => {
    const user = userEvent.setup();
    const form = await openTreatment(user);
    // Traitement passé (10/06/2026) : pas de prévisions ; à planifier : oui.
    expect(within(form).queryByLabelText("Conditions de pulvérisation")).not.toBeInTheDocument();
    await user.click(within(form).getByText("À planifier"));
    const widget = await within(form).findByLabelText("Conditions de pulvérisation");
    expect(within(widget).getByText(/Prochain créneau favorable/)).toBeInTheDocument();
    expect(within(widget).getByRole("img", { name: /défavorable : vent 22 km\/h/ })).toBeInTheDocument();
  });
});

describe("fiche et tableau de bord", () => {
  it("la fiche montre la météo enregistrée et sa source", async () => {
    server.use(
      http.get("*/interventions/:id", () =>
        HttpResponse.json({ ...DEMO, history: [], weather: { source: "openweather", kind: "forecast", temperatureC: 18, humidityPct: 70, windKmh: 9, windMaxKmh: 14, precipitationMm: 0.6 } }),
      ),
    );
    renderApp(`/f/${FARM}/interventions/${DEMO.id}?at=2026-06-10`);
    const meteo = await screen.findByLabelText("Météo de l'intervention");
    expect(within(meteo).getByText("18 °C")).toBeInTheDocument();
    expect(within(meteo).getByText("9 km/h (max 14)")).toBeInTheDocument();
    expect(within(meteo).getByText("OpenWeather, prévision")).toBeInTheDocument();
  });

  it("le tableau de bord du jour affiche les conditions de pulvérisation", async () => {
    renderApp(`/f/${FARM}`);
    expect(await screen.findByLabelText("Conditions de pulvérisation")).toBeInTheDocument();
  });
});
