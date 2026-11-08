import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FARM, renderApp } from "./render";

describe("cuverie", () => {
  it("affiche une jauge par cuve, groupées par bâtiment", async () => {
    renderApp(`/f/${FARM}/cellar`);
    expect(await screen.findByRole("heading", { name: "Chai" })).toBeInTheDocument();
    const gauges = screen.getAllByRole("meter");
    expect(gauges).toHaveLength(2);
    // Démo : cuves remplies à 60 % (300 hL sur 500 hL, 180 hL sur 300 hL).
    expect(gauges[0]).toHaveAccessibleName("60 % (300 hL sur 500 hL)");
  });

  it("ouvre le contenu d'une cuve : lot, millésime, cépage, mouvements", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/cellar`);
    await user.click(await screen.findByRole("button", { name: "Contenu de Cuve 1" }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("MERLOT-2025")).toBeInTheDocument();
    expect(within(drawer).getByText("Millésime 2025")).toBeInTheDocument();
    expect(within(drawer).getByText("Merlot")).toBeInTheDocument();
    expect(within(drawer).getByText("100 %")).toBeInTheDocument();
  });
});
