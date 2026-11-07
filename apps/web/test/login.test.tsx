import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MOCK_WRONG_PASSWORD } from "@fourmy/mocks";
import { FARM, renderApp } from "./render";

describe("connexion et choix de la ferme", () => {
  it("redirige vers la connexion sans session", async () => {
    const { router } = renderApp("/fermes", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/connexion");
  });

  it("refuse un mauvais mot de passe, puis connecte et liste les fermes", async () => {
    const user = userEvent.setup();
    renderApp("/connexion", { signedIn: false });
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
    await user.click(await screen.findByRole("button", { name: "Se déconnecter" }));
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/connexion");
  });

  it("une ferme dont on n'est pas membre affiche un message, sans planter", async () => {
    renderApp("/f/00000000-0000-7000-8000-00000000ffff");
    expect(await screen.findByText("Ferme inaccessible")).toBeInTheDocument();
  });
});

describe("équipe (responsable)", () => {
  it("liste les membres et les personnes ; ajoute un membre par e-mail", async () => {
    const user = userEvent.setup();
    let added: unknown = null;
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./setup");
    server.use(
      http.post("*/members", async ({ request }) => {
        added = await request.json();
        return HttpResponse.json({ items: [], nextCursor: null }, { status: 201 });
      }),
    );
    renderApp(`/f/${FARM}/equipe?at=2026-06-30`);
    expect(await screen.findByRole("heading", { name: "Membres" })).toBeInTheDocument();
    expect(await screen.findByText("Camille")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "E-mail du compte" }), "salarie@ferme.fr");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByText("Membre ajouté.")).toBeInTheDocument();
    expect(added).toEqual({ email: "salarie@ferme.fr", role: "worker" });
  });
});
