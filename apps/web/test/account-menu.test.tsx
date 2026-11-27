import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { demoFarmProfileFor } from "./farm-fixtures";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Navigation et menu du compte (claudedocs/besoins_navigation_compte.md) :
 * menu rond, onglets Équipe et Préférences de « Ma ferme », version.
 */
const asWorker = () =>
  server.use(
    http.get("*/api/v1/me/farms", () => HttpResponse.json({ userId: "mock", items: [{ id: FARM, name: "Ferme de démonstration", role: "worker" }] })),
    http.get(`*/api/v1/farms/${FARM}/farm`, () => HttpResponse.json({ ...demoFarmProfileFor(), canEdit: false })),
  );

describe("menu du compte", () => {
  it("remplace les entrées Équipe et Ma ferme, le nom de la ferme et le rôle de l'en-tête", async () => {
    renderApp(`/f/${FARM}/register`);
    const nav = await screen.findByRole("navigation", { name: "Menu principal" });
    expect(within(nav).queryByRole("link", { name: "Équipe" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Ma ferme" })).not.toBeInTheDocument();
    const header = screen.getByRole("banner");
    expect(within(header).queryByText("Ferme de démonstration")).not.toBeInTheDocument();
    expect(within(header).queryByText("Responsable")).not.toBeInTheDocument();
    // Sans fiche personne (404) : les initiales du nom.
    expect(within(header).getByRole("button", { name: "Compte de Démo" })).toHaveTextContent("D");
  });

  it("montre le compte, le rôle et la ferme, et mène à Ma ferme", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}?at=2026-06-30`);
    await user.click(await screen.findByRole("button", { name: "Compte de Démo" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Démo")).toBeInTheDocument();
    expect(within(menu).getByText("demo@fourmy.local")).toBeInTheDocument();
    expect(within(menu).getByText("Responsable")).toBeInTheDocument();
    expect(within(menu).getByText("Ferme de démonstration")).toBeInTheDocument();
    // Une seule ferme : pas de « Changer de ferme ».
    expect(within(menu).queryByRole("menuitem", { name: "Changer de ferme" })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Ma ferme" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/f/${FARM}/farm`));
    expect(await screen.findByRole("tab", { name: "Identité", selected: true })).toBeInTheDocument();
  });

  it("propose de changer de ferme quand il y en a plusieurs ; rôle Lecture seule", async () => {
    server.use(
      http.get("*/api/v1/me/farms", () =>
        HttpResponse.json({
          userId: "mock",
          items: [
            { id: FARM, name: "Ferme de démonstration", role: "reader" },
            { id: "00000000-0000-7000-8000-00000000beef", name: "Ferme voisine", role: "owner" },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}`);
    await user.click(await screen.findByRole("button", { name: "Compte de Démo" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Lecture seule")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Changer de ferme" })).toHaveAttribute("href", "/farms");
  });

  it("affiche la photo de sa fiche personne", async () => {
    server.use(
      http.get(`*/api/v1/farms/${FARM}/people/me`, () =>
        HttpResponse.json({ sheet: { id: "00000000-0000-7000-8000-000000000601", name: "Démo", firstName: null, lastName: null, photo: { hash: "abc" } }, work: null }),
      ),
    );
    renderApp(`/f/${FARM}`);
    const button = await screen.findByRole("button", { name: "Compte de Démo" });
    await waitFor(() =>
      expect(within(button).getByRole("img", { name: "Photo de Démo" })).toHaveAttribute("src", `/api/v1/farms/${FARM}/people/00000000-0000-7000-8000-000000000601/photo?v=abc`),
    );
  });

  it("change le mot de passe et ferme les autres sessions", async () => {
    let body: unknown = null;
    let attempts = 0;
    server.use(
      http.post("*/api/auth/change-password", async ({ request }) => {
        attempts++;
        body = await request.json();
        if (attempts === 1) return HttpResponse.json({ code: "INVALID_PASSWORD", message: "Invalid password" }, { status: 400 });
        return HttpResponse.json({ token: null, user: {} });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}`);
    await user.click(await screen.findByRole("button", { name: "Compte de Démo" }));
    await user.click(await screen.findByRole("menuitem", { name: "Changer de mot de passe" }));
    const dialog = await screen.findByRole("dialog", { name: "Changer de mot de passe" });
    const save = within(dialog).getByRole("button", { name: "Enregistrer" });
    await user.type(within(dialog).getByLabelText(/^Mot de passe actuel/), "ancien-mot-de-passe");
    await user.type(within(dialog).getByLabelText(/^Nouveau mot de passe/), "court");
    expect(within(dialog).getAllByText("10 caractères au moins.").length).toBeGreaterThan(1);
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Nouveau mot de passe/), "-mais-plus-long");
    await user.type(within(dialog).getByLabelText(/^Confirmez/), "autre-chose-encore");
    expect(within(dialog).getByText("Les deux saisies sont différentes.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/^Confirmez/));
    await user.type(within(dialog).getByLabelText(/^Confirmez/), "court-mais-plus-long");
    await user.click(save);
    expect(await within(dialog).findByText("Mot de passe actuel incorrect.")).toBeInTheDocument();
    expect(body).toEqual({ currentPassword: "ancien-mot-de-passe", newPassword: "court-mais-plus-long", revokeOtherSessions: true });
    await user.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Changer de mot de passe" })).not.toBeInTheDocument());
    expect(attempts).toBe(2);
  });
});

describe("pied du menu", () => {
  it("affiche la version, avec un lien vers les nouveautés", async () => {
    renderApp(`/f/${FARM}`);
    const link = await screen.findByRole("link", { name: "Version 0.112.1, nouveautés sur fourmy.org" });
    expect(link).toHaveAttribute("href", "https://fourmy.org/changelog");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("sans version publiée : « Version de développement »", async () => {
    server.use(http.get("*/version.json", () => new HttpResponse(null, { status: 404 })));
    renderApp(`/f/${FARM}`);
    expect(await screen.findByText("Version de développement")).toBeInTheDocument();
  });
});

describe("onglets de « Ma ferme »", () => {
  it("dans l'ordre : Identité, Équipe, Sites et cartes, Données IGN, Accès externes, Préférences", async () => {
    renderApp(`/f/${FARM}/farm`);
    await screen.findByRole("tab", { name: "Identité", selected: true }, { timeout: 10_000 });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Identité", "Équipe", "Sites et cartes", "Données IGN", "Accès externes", "Préférences"]);
  });

  it("responsable : Préférences regroupe Entretien, Parcours et Marques ; un ancien lien y défile", async () => {
    renderApp(`/f/${FARM}/farm?tab=tracks`);
    expect(await screen.findByRole("tab", { name: "Préférences", selected: true }, { timeout: 10_000 })).toBeInTheDocument();
    for (const name of ["Entretien", "Parcours", "Marques"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
  });

  it("salarié : l'équipe sans bouton d'ajout, les préférences réduites aux marques", async () => {
    asWorker();
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/farm?tab=team&at=2026-06-30`);
    expect(await screen.findByRole("link", { name: "Camille" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter une personne" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Préférences" }));
    expect(await screen.findByRole("region", { name: "Marques" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Entretien" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Parcours" })).not.toBeInTheDocument();
  });
});
