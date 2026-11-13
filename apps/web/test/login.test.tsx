import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MOCK_WRONG_PASSWORD } from "@fourmy/mocks";
import { FARM, renderApp } from "./render";

describe("connexion et choix de la ferme", () => {
  it("redirige vers la connexion sans session", async () => {
    const { router } = renderApp("/farms", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("refuse un mauvais mot de passe, puis connecte et liste les fermes", async () => {
    const user = userEvent.setup();
    renderApp("/login", { signedIn: false });
    const email = await screen.findByRole("textbox", { name: "E-mail" });
    await user.clear(email);
    await user.type(email, "demo@fourmy.local");
    const password = screen.getByLabelText(/^Mot de passe/);
    await user.type(password, MOCK_WRONG_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText("E-mail ou mot de passe incorrect.")).toBeInTheDocument();

    await user.clear(password);
    await user.type(password, "le-bon-mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText("Ferme de démonstration")).toBeInTheDocument();
    expect(screen.getByText("Responsable")).toBeInTheDocument();
  });

  it("se déconnecte : retour à la connexion", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}?at=2026-06-30`);
    await user.click(await screen.findByRole("button", { name: "Compte de Démo" }));
    await user.click(await screen.findByRole("menuitem", { name: "Se déconnecter" }));
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("une ferme dont on n'est pas membre affiche un message, sans planter", async () => {
    renderApp("/f/00000000-0000-7000-8000-00000000ffff");
    expect(await screen.findByText("Ferme inaccessible")).toBeInTheDocument();
  });
});

describe("intégrations (responsable)", () => {
  it("formulaire généré depuis le fournisseur ; le secret part une fois, puis n'est plus affiché", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./setup");
    server.use(
      http.put("*/integrations/traccar", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          integration: { id: "00000000-0000-7000-8000-000000000901", provider: "traccar", settings: { url: "https://traccar.osfarm.org" }, hasSecret: true, secretHint: "4242", enabled: true, status: "pending", running: false, lastSyncAt: null, lastError: null, lastReport: null },
          test: { devices: 2, matched: [{ device: "Tracteur", equipment: "Tracteur" }], unmatched: [{ device: "Quad", reason: "aucun matériel de ce nom" }] },
        });
      }),
    );
    renderApp(`/f/${FARM}/integrations?at=2026-06-30`);
    expect(await screen.findByRole("heading", { name: "Traccar — traceurs GPS" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Adresse du serveur Traccar/ }), "https://traccar.osfarm.org");
    await user.type(screen.getByLabelText(/^Jeton d'accès/), "jeton-secret-4242");
    // Trois fournisseurs (Traccar, OpenWeather, meteoblue) : on agit sur la carte Traccar.
    await user.click(within(screen.getByTestId("integration-traccar")).getByRole("button", { name: "Tester et activer" }));
    expect(await screen.findByText("Intégration enregistrée (connexion vérifiée).")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OpenWeather — météo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "meteoblue — météo agricole" })).toBeInTheDocument();
    expect(body).toEqual({ settings: { url: "https://traccar.osfarm.org" }, secret: "jeton-secret-4242" });
    expect(screen.getByText("Tracteur → Tracteur")).toBeInTheDocument();
    expect(screen.getByText(/Quad : aucun matériel de ce nom/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Jeton d'accès/)).toHaveValue("");
  });
});
