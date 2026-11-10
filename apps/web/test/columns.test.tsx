import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FARM, renderApp } from "./render";

/** Choix des colonnes affichées (retours du 10/11/2026), gardé dans le navigateur. */
describe("colonnes affichées", () => {
  beforeEach(() => localStorage.clear());

  it("masque, affiche et réinitialise les colonnes de la liste des interventions", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    expect(await screen.findByRole("columnheader", { name: "Intervenants" })).toBeInTheDocument();
    // Colonnes facultatives masquées par défaut.
    expect(screen.queryByRole("columnheader", { name: "Matériels" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Colonnes affichées" }));
    const group = await screen.findByRole("group", { name: "Colonnes" });
    // Colonnes obligatoires absentes du choix.
    expect(within(group).queryByRole("checkbox", { name: "Date" })).toBeNull();
    await user.click(within(group).getByRole("checkbox", { name: "Intervenants" }));
    await user.click(within(group).getByRole("checkbox", { name: "Matériels" }));
    expect(screen.queryByRole("columnheader", { name: "Intervenants" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Matériels" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("fourmy.columns.interventions")!)).toEqual(["notes", "doers"]);

    await user.click(screen.getByRole("button", { name: "Réinitialiser" }));
    expect(screen.getByRole("columnheader", { name: "Intervenants" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Matériels" })).toBeNull();
    expect(localStorage.getItem("fourmy.columns.interventions")).toBeNull();
  });

  it("reprend le choix enregistré", async () => {
    localStorage.setItem("fourmy.columns.interventions", JSON.stringify(["targets"]));
    renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    expect(await screen.findByRole("columnheader", { name: "Matériels" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Cibles" })).toBeNull();
  });
});
