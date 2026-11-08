import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { demoInterventions } from "@fourmy/mocks";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Activités (lot C) : page de gestion, activité des parcelles sur la fiche et dans le formulaire. */
describe("activités", () => {
  it("liste les activités par famille avec leurs parcelles de la campagne", async () => {
    renderApp(`/f/${FARM}/activities?at=2026-06-10`);
    expect(await screen.findByRole("heading", { name: "Activités 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Viticulture" })).toBeInTheDocument();
    const card = screen.getByLabelText("Activité Vignes AOP");
    expect(within(card).getByText(/Référence : Vigne · culture : Vigne/)).toBeInTheDocument();
    expect(within(card).getByText(/^1 parcelle\(s\) · 1,2/)).toBeInTheDocument();
  });

  it("crée une activité depuis une production de référence Lexicon", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | null = null;
    server.use(
      http.get("*/activities/references", () =>
        HttpResponse.json({
          items: [{ referenceName: "grain_corn", label: "Maïs grain", family: "plant_farming", specie: "zea_mays", specieLabel: "Maïs", color: "#F5D33D", pictureUrl: null }],
        }),
      ),
      http.post("*/activities", async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderApp(`/f/${FARM}/activities?at=2026-06-10`);
    await user.click(await screen.findByRole("button", { name: "Nouvelle activité" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle activité" });
    await user.click(within(dialog).getByRole("combobox", { name: /Production de référence/ }));
    await user.click(await screen.findByRole("option", { name: "Maïs grain (Maïs)" }));
    expect(within(dialog).getByRole("textbox", { name: "Nom" })).toHaveValue("Maïs grain");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Activité créée.")).toBeInTheDocument();
    expect(created).toMatchObject({ name: "Maïs grain", family: "plant_farming", reference: "grain_corn", cultivation: "zea_mays", color: "#F5D33D" });
  });

  it("la fiche d'une intervention montre l'activité de chaque parcelle", async () => {
    renderApp(`/f/${FARM}/interventions/${demoInterventions[0]!.id}?at=2026-06-10`);
    const targets = await screen.findByRole("table", { name: "Cibles" });
    expect(await within(targets).findByLabelText("Activité : Vignes AOP")).toBeInTheDocument();
  });
});
