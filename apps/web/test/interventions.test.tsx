import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const FONGICIDE = "00000000-0000-7000-8000-000000000301";
const CAMILLE = "00000000-0000-7000-8000-000000000601";

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
  const button = await screen.findByRole("button", { name: "Nouvelle intervention" });
  await vi.waitFor(() => expect(button).toBeEnabled()); // catalogue chargé
  await user.click(button);
  const form = await screen.findByRole("dialog");
  await user.click(within(form).getByRole("combobox", { name: "Intervention" }));
  await user.click(await screen.findByRole("option", { name: "Pulvérisation" }));
  return form;
}

describe("interventions", () => {
  it("liste les interventions de la campagne avec libellés, intervenants et origine", async () => {
    renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    expect(await screen.findByText("Pulvérisation")).toBeInTheDocument();
    expect(screen.getByText("Les Rouffiats")).toBeInTheDocument();
    expect(screen.getByText(/Fongicide X 2 L\/ha/)).toBeInTheDocument();
    expect(await screen.findByText("Camille")).toBeInTheDocument();
    expect(screen.getByText("Mobile")).toBeInTheDocument();
  });

  it("enregistre un traitement réalisé : la forme guide la saisie, les habitudes sont proposées", async () => {
    const user = userEvent.setup();
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    server.use(
      http.post("*/interventions", async ({ request }) => {
        calls.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({}, { status: 201 });
      }),
      http.post("*/interventions/:id/complete", async ({ request }) => {
        calls.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ intervention: {}, movements: [], warnings: ["Fongicide X : stock négatif"] });
      }),
    );
    const form = await openForm(user);

    // Traitement : motifs proposés, pas de bloc récolte.
    expect(within(form).getByRole("combobox", { name: "Motifs (facultatif)" })).toBeInTheDocument();
    expect(within(form).queryByRole("button", { name: "Ajouter une sortie" })).not.toBeInTheDocument();

    await user.click(within(form).getByRole("combobox", { name: "Parcelles" }));
    await user.click(await screen.findByRole("option", { name: /Les Rouffiats/ }));
    await user.click(within(form).getByRole("combobox", { name: "Produit" }));
    expect((await screen.findAllByText("Habituels")).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole("option", { name: /Fongicide X/ }));
    await user.type(within(form).getByRole("textbox", { name: "Quantité" }), "1,5");
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Fongicide X : stock négatif")).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    const [plan, complete] = calls as [(typeof calls)[0], (typeof calls)[0]];
    expect(plan.body).toEqual({ id: expect.any(String), procedure: "spraying" }); // réalisée : le contenu va à la réalisation
    expect(complete.url).toMatch(/\/complete$/);
    expect(complete.body).toMatchObject({
      targets: [{ kind: "land_parcel", id: PARCEL }],
      inputs: [{ articleId: FONGICIDE, quantity: 1.5, per: "hectare" }],
      doers: [{ personId: CAMILLE }], // intervenant habituel prérempli
      tools: [],
      purposes: [],
    });
    expect(complete.body.periods).toHaveLength(1);
  });

  it("la surface choisie donne le total de la dose ; la carte se choisit sans casser le formulaire", async () => {
    const user = userEvent.setup();
    const form = await openForm(user);
    await user.click(within(form).getByRole("combobox", { name: "Parcelles" }));
    await user.click(await screen.findByRole("option", { name: /Les Rouffiats/ }));
    await user.click(within(form).getByRole("combobox", { name: "Produit" }));
    await user.click(await screen.findByRole("option", { name: /Fongicide X/ }));
    await user.type(within(form).getByRole("textbox", { name: "Quantité" }), "2");
    expect(within(form).getByText(/1 parcelle\(s\), .* ha traités/)).toBeInTheDocument();
    expect(within(form).getByText(/≈ .* L au total sur/)).toBeInTheDocument();
    // Mode carte : sans WebGL (jsdom), un message remplace la carte ; la sélection reste.
    await user.click(within(form).getByText("Carte"));
    expect(await within(form).findByText(/Carte indisponible/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(form).getByText(/1 parcelle\(s\)/)).toBeInTheDocument();
  });

  it("affiche le refus du serveur sans fermer le formulaire", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/interventions/:id/complete", () =>
        HttpResponse.json({ title: "Règle métier", status: 422, detail: "Un traitement réalisé demande au moins un produit phytosanitaire." }, { status: 422 }),
      ),
    );
    const form = await openForm(user);
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    expect(await within(form).findByText(/au moins un produit phytosanitaire/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("annule une intervention réalisée avec un motif", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(
      http.post("*/interventions/:id/cancel", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    await user.click(await screen.findByRole("button", { name: "Actions : Pulvérisation" }));
    await user.click(await screen.findByRole("menuitem", { name: "Annuler…" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText(/contre-passés/)).toBeInTheDocument();
    const confirm = within(modal).getByRole("button", { name: "Annuler l'intervention" });
    expect(confirm).toBeDisabled();
    await user.type(within(modal).getByRole("textbox", { name: "Motif" }), "saisie en double");
    await user.click(confirm);
    expect(await screen.findByText("Intervention annulée.")).toBeInTheDocument();
    expect(body).toEqual({ reason: "saisie en double" });
  });
});
