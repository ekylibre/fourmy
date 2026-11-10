import { screen, within } from "@testing-library/react";
import { FARM, renderApp } from "./render";

/** Page Intégrations : thèmes (lot S), stations Weenat et Sencrop (lot W). */
describe("intégrations", () => {
  it("groupées par thème ; Weenat et Sencrop en Météo, avec leurs champs ; stations de la ferme", async () => {
    renderApp(`/f/${FARM}/integrations`);
    const weather = await screen.findByRole("region", { name: "Météo" });
    expect(within(weather).getByRole("heading", { name: "Weenat — stations météo" })).toBeInTheDocument();
    expect(within(weather).getByRole("heading", { name: "Sencrop — stations météo" })).toBeInTheDocument();
    const weenat = within(weather).getByTestId("integration-weenat");
    expect(within(weenat).getByLabelText(/E-mail du compte Weenat/)).toBeInTheDocument();
    expect(within(weenat).getByLabelText(/Mot de passe Weenat/)).toBeInTheDocument();
    const sencrop = within(weather).getByTestId("integration-sencrop");
    expect(within(sencrop).getByLabelText(/Identifiant d'application/)).toBeInTheDocument();
    expect(within(sencrop).getByLabelText(/Secret d'application/)).toBeInTheDocument();
    const stations = await within(weather).findByRole("table", { name: "Stations météo" });
    expect(within(stations).getByText("Sencrop vigne")).toBeInTheDocument();
    expect(within(stations).getByText("744")).toBeInTheDocument();
    const gps = screen.getByRole("region", { name: "Suivi GPS – Matériels" });
    expect(within(gps).getByRole("heading", { name: "Traccar — traceurs GPS" })).toBeInTheDocument();
  });
});
