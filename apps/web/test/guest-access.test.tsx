import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Invité restreint (lot AM3, conception_api_mcp.md §9) : menu réduit à ses
 * modules, pas de tableau de bord ni de « Ma ferme » ; le responsable invite
 * avec des droits.
 */
const asGuest = (modules: Record<string, string>) =>
  server.use(
    http.get("*/api/v1/me/farms", () =>
      HttpResponse.json({
        userId: "mock",
        items: [{ id: FARM, name: "Ferme de démonstration", role: "guest", grant: { modules, activities: "all" } }],
      }),
    ),
  );

describe("invité restreint", () => {
  it("le menu ne montre que ses modules ; l'accueil mène à sa première page", async () => {
    asGuest({ interventions: "read", phyto: "read" });
    const { router } = renderApp(`/f/${FARM}`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/f/${FARM}/interventions`));
    const nav = await screen.findByRole("navigation", { name: "Menu principal" });
    expect(within(nav).getByRole("link", { name: "Interventions" })).toBeInTheDocument();
    for (const hidden of ["Tableau de bord", "Activités", "Matériels", "Économique"]) {
      expect(within(nav).queryByRole("link", { name: hidden })).not.toBeInTheDocument();
    }
    // Groupe Cartes : aucune entrée ouverte (pas de parcellaire), donc absent.
    expect(within(nav).queryByRole("button", { name: "Cartes" })).not.toBeInTheDocument();
  });

  it("pas d'entrée « Ma ferme » dans le menu du compte", async () => {
    asGuest({ interventions: "read" });
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/interventions`);
    await user.click(await screen.findByRole("button", { name: "Compte de Démo" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Invité restreint")).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Ma ferme" })).not.toBeInTheDocument();
  });

  it("sans aucun module : un message, pas de page", async () => {
    asGuest({});
    renderApp(`/f/${FARM}`);
    expect(await screen.findByText(/n'ouvre aucun écran/)).toBeInTheDocument();
  });
});

describe("invitation d'un invité restreint", () => {
  it("le responsable choisit les modules ; la requête porte les droits", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(
      http.post("*/people/:id/invitations", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { status: "link", link: "http://localhost/invitation/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ", sentByEmail: false, expiresAt: "2026-07-07T10:00:00.000Z", email: "camille@exemple.test" },
          { status: 201 },
        );
      }),
    );
    renderApp(`/f/${FARM}/team/00000000-0000-7000-8000-000000000601?at=2026-06-30`);
    await user.click(await screen.findByRole("combobox", { name: "Rôle" }));
    await user.click(await screen.findByRole("option", { name: "Invité restreint" }));
    // Droits de départ : parcellaire, activités, interventions ; on ajoute le phyto.
    const phyto = await screen.findByRole("radiogroup", { name: "Accès au module Phytosanitaire et registres" });
    await user.click(within(phyto).getByText("Lecture"));
    await user.click(screen.getByRole("button", { name: "Inviter" }));
    await screen.findByRole("textbox", { name: "Lien d'invitation" });
    expect(body).toEqual({
      email: "camille@exemple.test",
      role: "guest",
      grant: { modules: { parcels: "read", activities: "read", interventions: "read", phyto: "read" }, activities: "all" },
    });
  });
});
