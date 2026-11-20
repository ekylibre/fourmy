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

  it("entrée active par segment de chemin", () => {
    expect(isActivePath("", "")).toBe(true);
    expect(isActivePath("/map", "")).toBe(false);
    expect(isActivePath("/equipments/crew-templates", "/equipments")).toBe(true);
    expect(isActivePath("/phytosanitary", "/phyto")).toBe(false);
  });
});
