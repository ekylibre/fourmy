import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./render";

describe("connexion et choix de la ferme", () => {
  it("redirige vers la connexion sans session", async () => {
    const { router } = renderApp("/fermes", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/connexion");
  });

  it("refuse un identifiant invalide, puis connecte et liste les fermes", async () => {
    const user = userEvent.setup();
    renderApp("/connexion", { signedIn: false });
    const field = await screen.findByLabelText("Identifiant utilisateur");
    await user.clear(field);
    await user.type(field, "pas-un-uuid");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText(/un UUID est attendu/)).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "00000000-0000-7000-8000-00000000de00");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText("Ferme de démonstration")).toBeInTheDocument();
    expect(screen.getByText("Responsable")).toBeInTheDocument();
  });

  it("une ferme dont on n'est pas membre affiche un message, sans planter", async () => {
    renderApp("/f/00000000-0000-7000-8000-00000000ffff");
    expect(await screen.findByText("Ferme inaccessible")).toBeInTheDocument();
  });
});
