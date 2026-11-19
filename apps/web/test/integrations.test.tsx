import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { INTEGRATION_PROVIDERS } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Page Intégrations : thèmes (lot S), stations Weenat et Sencrop (lot W). */
describe("intégrations", () => {
  it("groupées par thème ; Weenat et Sencrop en Météo, avec leurs champs ; stations de la ferme", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/integrations`);
    const weather = await screen.findByRole("region", { name: "Météo" });
    expect(within(weather).getByRole("heading", { name: "Weenat — stations météo" })).toBeInTheDocument();
    expect(within(weather).getByRole("heading", { name: "Sencrop — stations météo" })).toBeInTheDocument();
    // Une tuile par service ; sa configuration s'ouvre dans une fenêtre.
    // Feu éteint (non configurée), logo officiel du service.
    const tile = within(within(weather).getByTestId("tile-weenat"));
    expect(tile.getByRole("img", { name: "Non configurée" })).toBeInTheDocument();
    expect(tile.getByRole("img", { name: "Logo Weenat" })).toHaveAttribute("src", "/integrations/weenat.webp");
    expect(within(within(weather).getByTestId("tile-open-meteo")).getByRole("img", { name: "Actif par défaut" })).toBeInTheDocument();
    await user.click(within(weather).getByRole("button", { name: "Configurer Weenat" }));
    const weenat = within(await screen.findByRole("dialog")).getByTestId("integration-weenat");
    expect(within(weenat).getByLabelText(/E-mail du compte Weenat/)).toBeInTheDocument();
    expect(within(weenat).getByLabelText(/Mot de passe Weenat/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(weather).getByRole("button", { name: "Configurer Sencrop" }));
    const sencrop = within(await screen.findByRole("dialog")).getByTestId("integration-sencrop");
    expect(within(sencrop).getByLabelText(/Identifiant d'application/)).toBeInTheDocument();
    expect(within(sencrop).getByLabelText(/Secret d'application/)).toBeInTheDocument();
    const stations = await within(weather).findByRole("table", { name: "Stations météo" });
    expect(within(stations).getByText("Sencrop vigne")).toBeInTheDocument();
    expect(within(stations).getByText("744")).toBeInTheDocument();
    const gps = screen.getByRole("region", { name: "Suivi GPS – Matériels" });
    expect(within(gps).getByRole("heading", { name: "Traccar — traceurs GPS" })).toBeInTheDocument();
  });

  it("Copernicus : secret enregistré conservé (champ vide), résultat du test affiché", async () => {
    const saved = {
      id: "00000000-0000-7000-8000-00000000c0be",
      provider: "copernicus",
      settings: { clientId: "sh-essai" },
      hasSecret: true,
      secretHint: "TdMy",
      enabled: true,
      status: "ok",
      running: false,
      lastSyncAt: null,
      lastError: null,
      lastReport: null,
    };
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.get("*/integrations", () => HttpResponse.json({ providers: INTEGRATION_PROVIDERS, items: [saved] })),
      http.put("*/integrations/copernicus", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ integration: saved, test: { token: "ok", acquisitions: 14, dates: ["2026-10-14", "2026-11-10"] } });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/integrations`);
    await user.click(await screen.findByRole("button", { name: /^Configurer Copernicus/ }));
    const card = within(await screen.findByRole("dialog")).getByTestId("integration-copernicus");
    expect(within(card).getByText(/Enregistré \(…TdMy\) — laisser vide pour le conserver/)).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Tester et enregistrer" }));
    expect(await within(card).findByText(/14 acquisition\(s\) Sentinel-2 au-dessus de la ferme sur les 30 derniers jours, la dernière le 10\/11\/2026/)).toBeInTheDocument();
    expect(sent).not.toHaveProperty("secret");
  });
});
