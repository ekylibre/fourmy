import { screen, waitFor } from "@testing-library/react";
import { legacyUrl } from "../src/app/router";
import { FARM, renderApp } from "./render";

/** Adresses en anglais ; les anciennes, en français, redirigent (favoris, liens envoyés). */
describe("anciennes adresses en français", () => {
  it("traduit chemin et vue", () => {
    expect(legacyUrl("/connexion", "")).toBe("/login");
    expect(legacyUrl(`/f/${FARM}/carte/outils`, "?at=2026-06-15")).toBe(`/f/${FARM}/map/tools?at=2026-06-15`);
    expect(legacyUrl(`/f/${FARM}/interventions/abc/modifier`, "?at=2026-06-15&vue=calendrier")).toBe(
      `/f/${FARM}/interventions/abc/edit?at=2026-06-15&view=calendar`,
    );
  });

  it("redirige dans l'application en gardant la date", async () => {
    const { router } = renderApp(`/f/${FARM}/registre?at=2026-06-30`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/f/${FARM}/register`));
    expect(router.state.location.search).toBe("?at=2026-06-30");
  });

  it("accepte encore ?vue= sur les interventions", async () => {
    renderApp(`/f/${FARM}/interventions?at=2026-06-10&vue=kanban`);
    expect(await screen.findByRole("region", { name: "Planifiée" })).toBeInTheDocument();
  });
});
