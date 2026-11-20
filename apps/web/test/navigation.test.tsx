import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isActivePath } from "../src/components/Layout";
import { FARM, renderApp } from "./render";

describe("menu principal", () => {
  it("sections et sous-menus, ouverts sur la section active", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}/register`);
    const nav = await screen.findByRole("navigation", { name: "Menu principal" });
    // Ordre des sections (retours du 10/11/2026).
    const top = ["Tableau de bord", "Cartes", "Activités", "Interventions", "Matériels", "Stocks", "Réglementaire"];
    const labels = within(nav)
      .getAllByText(new RegExp(`^(${top.join("|")})$`))
      .map((e) => e.textContent);
    expect(labels).toEqual(top);
    // Section active ouverte : le registre est visible.
    expect(within(nav).getByRole("link", { name: "Registre phyto" })).toBeVisible();
    // Sous-menu Cartes : ouvert au clic.
    await user.click(within(nav).getByRole("button", { name: "Cartes" }));
    await user.click(await within(nav).findByRole("link", { name: "Plan 2D" }));
    expect(router.state.location.pathname).toBe(`/f/${FARM}/map`);
  });

  it("contrôle AB affiché quand une parcelle est certifiée pendant la campagne, pas le contrôle HVE", async () => {
    renderApp(`/f/${FARM}/control/ab`);
    const nav = await screen.findByRole("navigation", { name: "Menu principal" });
    expect(await within(nav).findByRole("link", { name: "Contrôle AB" })).toBeVisible();
    expect(within(nav).queryByRole("link", { name: "Contrôle HVE" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Contrôle AB" })).toBeInTheDocument();
    expect(await screen.findByText(/1 parcelle\(s\) en conversion ou certifiée\(s\) AB/)).toBeInTheDocument();
  });

  it("contrôle AB : onglet Parcelles, statut de conversion déduit de chaque récolte", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/control/ab`);
    await user.click(await screen.findByRole("tab", { name: "Parcelles" }));
    const table = await screen.findByRole("table", { name: "Statut de conversion des parcelles" });
    expect(within(table).getByText("Les Rouffiats")).toBeInTheDocument();
    expect(within(table).getAllByLabelText("Agriculture biologique")).toHaveLength(2);
    expect(within(table).getByRole("button", { name: "Modifier Vigne" })).toBeInTheDocument();
  });

  it("contrôle HVE : points de l'indicateur phytosanitaire, réglages du responsable", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/control/hve`);
    expect(await screen.findByText("Stratégie phytosanitaire — 16 / 30 points (minimum 10)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exporter la liasse HVE" })).toBeInTheDocument();
    expect(screen.getByText(/Surveillance active des bioagresseurs/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réglages" }));
    expect(await screen.findByRole("textbox", { name: /Début de la période/ })).toHaveValue("01/01");
  });

  it("contrôle HVE : onglet Parcelles irriguées, données à renseigner", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/control/hve`);
    await user.click(await screen.findByRole("tab", { name: "Parcelles irriguées" }));
    const table = await screen.findByRole("table", { name: "Parcelles irriguées" });
    expect(within(table).getByText("Les Rouffiats")).toBeInTheDocument();
    expect(within(table).getAllByText("À renseigner")).toHaveLength(2);
    await user.click(within(table).getByRole("button", { name: "Modifier Les Rouffiats" }));
    expect(await screen.findByRole("textbox", { name: /Autres pratiques économes en eau/ })).toBeInTheDocument();
  });

  it("contrôle HVE : onglet IAE, type proposé d'après TelePAC, validation par le responsable", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/control/hve`);
    await user.click(await screen.findByRole("tab", { name: "IAE" }));
    const table = await screen.findByRole("table", { name: "Infrastructures agro-écologiques" });
    expect(within(table).getByText("Proposé")).toBeInTheDocument();
    expect(within(table).getByText("8 400 m²")).toBeInTheDocument();
    await user.click(within(table).getByRole("checkbox", { name: "Valider Haie" }));
  });

  it("contrôle HVE : questionnaire annuel, réponses enregistrées par le responsable", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/control/hve`);
    await user.click(await screen.findByRole("tab", { name: "Questionnaire" }));
    const species = await screen.findByRole("textbox", { name: /4\.5 Espèces animales élevées/ });
    await user.type(species, "3");
    await user.click(screen.getByRole("button", { name: "Enregistrer le questionnaire" }));
    expect(await screen.findByText(/^Questionnaire \d{4} enregistré\.$/)).toBeInTheDocument();
  });

  it("contrôle AB : onglet Semences, statut et dérogation", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/control/ab`);
    await user.click(await screen.findByRole("tab", { name: "Semences" }));
    const table = await screen.findByRole("table", { name: "Semences des parcelles AB" });
    expect(within(table).getByText("Blé Renan")).toBeInTheDocument();
    expect(within(table).getByDisplayValue("Non biologique")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /^Espèce/ }), "Blé tendre");
    expect(screen.getByRole("button", { name: "Ajouter la dérogation" })).toBeDisabled();
  });

  it("entrée active par segment de chemin", () => {
    expect(isActivePath("", "")).toBe(true);
    expect(isActivePath("/map", "")).toBe(false);
    expect(isActivePath("/equipments/crew-templates", "/equipments")).toBe(true);
    expect(isActivePath("/phytosanitary", "/phyto")).toBe(false);
  });
});
