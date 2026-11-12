import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FARM, renderApp } from "./render";

/** Équipe, lot P1 (docs/equipe-personnes-design.md §6) : pavés, fiche, ajout. */
describe("équipe (responsable)", () => {
  it("une grille de pavés, un par personne ; un clic ouvre la fiche", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/team?at=2026-06-30`);
    expect(await screen.findByRole("heading", { name: "Équipe" })).toBeInTheDocument();
    const camille = await screen.findByRole("link", { name: "Camille" });
    expect(within(camille).getByText("Sans compte")).toBeInTheDocument();
    expect(within(camille).getByText("Certiphyto à renouveler")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: "Dominique Martin" })).getByText("Responsable")).toBeInTheDocument();
    // Recherche.
    await user.type(screen.getByRole("textbox", { name: "Rechercher une personne" }), "domi");
    expect(screen.queryByRole("link", { name: "Camille" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Rechercher une personne" }));
    await user.click(screen.getByRole("link", { name: "Camille" }));
    expect(await screen.findByRole("heading", { name: "Camille", level: 1 })).toBeInTheDocument();
    // Le responsable voit les coordonnées et peut rattacher un compte.
    const contact = screen.getByLabelText("Coordonnées");
    expect(within(contact).getByText("camille@exemple.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inviter" })).toBeInTheDocument();
    // Retour à la grille, la date de la frise gardée (le lien du menu porte le même nom).
    expect(screen.getAllByRole("link", { name: "Équipe" }).map((a) => a.getAttribute("href"))).toContain(`/f/${FARM}/team?at=2026-06-30`);
  });

  it("ajoute une personne sans compte (prénom, nom, coordonnées)", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./setup");
    server.use(
      http.post("*/people", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "00000000-0000-7000-8000-000000000601" }, { status: 201 });
      }),
    );
    renderApp(`/f/${FARM}/team?at=2026-06-30`);
    await user.click(await screen.findByRole("button", { name: "Ajouter une personne" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle personne" });
    await user.type(within(dialog).getByRole("textbox", { name: "Prénom" }), "Léa");
    await user.type(within(dialog).getByRole("textbox", { name: "Nom" }), "Bernard");
    await user.type(within(dialog).getByRole("textbox", { name: "Portable" }), "06 11 22 33 44");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Personne ajoutée.")).toBeInTheDocument();
    expect(body).toMatchObject({ firstName: "Léa", lastName: "Bernard", private: { mobile: "06 11 22 33 44", email: null, address: { country: "FR" } } });
  });

  it("sans droit aux coordonnées (salarié), la fiche n'en montre pas", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./setup");
    const { demoPersonSheet } = await import("@fourmy/mocks");
    const { private: _hidden, ...sheet } = demoPersonSheet("00000000-0000-7000-8000-000000000601")!;
    server.use(http.get("*/people/:id", () => HttpResponse.json({ ...sheet, canEditContact: false })));
    renderApp(`/f/${FARM}/team/00000000-0000-7000-8000-000000000601?at=2026-06-30`);
    expect(await screen.findByRole("heading", { name: "Camille", level: 1 })).toBeInTheDocument();
    expect(screen.queryByLabelText("Coordonnées")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
  });
});

describe("temps de travaux d'une personne", () => {
  it("quatre totaux, barres par mois (et en texte), répartitions, interventions", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/team/00000000-0000-7000-8000-000000000601?at=2026-06-30`);
    await user.click(await screen.findByRole("tab", { name: "Temps de travaux" }));
    expect(await screen.findByText("21,5 h")).toBeInTheDocument();
    expect(screen.getByText("Campagne 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Heures par mois (texte)")).toHaveTextContent("juin 26 : 21,5 h");
    expect(screen.getByText("Vigne")).toBeInTheDocument();
    expect(screen.getByText("81 %")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Pulvérisation" })).toHaveAttribute("href", expect.stringContaining("/interventions/00000000-0000-7000-8000-000000000401"));
    expect(screen.getByText("Les Rouffiats")).toBeInTheDocument();
  });
});

describe("invitations", () => {
  it("le responsable invite : sans email du serveur, le lien s'affiche à copier", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./setup");
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
    await user.click(await screen.findByRole("button", { name: "Inviter" }));
    expect(await screen.findByRole("textbox", { name: "Lien d'invitation" })).toHaveValue("http://localhost/invitation/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ");
    expect(body).toEqual({ email: "camille@exemple.test", role: "worker" });
  });

  it("page publique : sans compte, choisir un mot de passe (confirmé) crée le compte", async () => {
    const user = userEvent.setup();
    let accepted: unknown = null;
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./setup");
    const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    server.use(
      http.get(`*/invitations/${token}`, () =>
        HttpResponse.json({ farmId: FARM, farmName: "Ferme de démo", firstName: "Léa", email: "lea@exemple.test", role: "worker", status: "open", accountExists: false }),
      ),
      http.post(`*/invitations/${token}/accept`, async ({ request }) => {
        accepted = await request.json();
        return HttpResponse.json({ farmId: FARM, created: true });
      }),
    );
    renderApp(`/invitation/${token}`, { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Rejoindre Ferme de démo" })).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Créer mon compte et rejoindre la ferme" });
    await user.type(screen.getByLabelText("Choisissez un mot de passe"), "un-mot-de-passe");
    await user.type(screen.getByLabelText("Confirmez le mot de passe"), "un-mot-de-pass");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Confirmez le mot de passe"), "e");
    await user.click(submit);
    await vi.waitFor(() => expect(accepted).toEqual({ password: "un-mot-de-passe" }));
  });

  it("page publique : invitation expirée", async () => {
    const { http, HttpResponse } = await import("msw");
    const { server } = await import("./setup");
    server.use(
      http.get("*/invitations/:token", () =>
        HttpResponse.json({ farmId: FARM, farmName: "Ferme de démo", firstName: "Léa", email: "lea@exemple.test", role: "worker", status: "expired", accountExists: false }),
      ),
    );
    renderApp(`/invitation/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ`, { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Invitation expirée" })).toBeInTheDocument();
  });
});
