import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { Proposal } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * « À valider » (lot AM8) : compteur de la navigation, propositions avec
 * leurs contrôles, refus motivé, formulaire prérempli qui accepte la
 * proposition à l'enregistrement.
 */
const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const FONGICIDE = "00000000-0000-7000-8000-000000000301";
const ID = "00000000-0000-7000-8000-00000000ab01";

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: ID,
  kind: "intervention",
  status: "pending",
  channel: "mcp",
  accessName: "Assistant Claude",
  user: { id: "00000000-0000-7000-8000-00000000de00", name: "Camille" },
  payload: {
    procedure: "spraying",
    staffing: "free",
    crews: [],
    periods: [{ startedAt: "2026-06-12T05:30:00.000Z", stoppedAt: "2026-06-12T06:30:00.000Z" }],
    targets: [{ kind: "land_parcel", id: PARCEL }],
    inputs: [{ articleId: FONGICIDE, quantity: 1.5, per: "hectare" }],
    outputs: [],
    tools: [],
    doers: [],
    purposes: ["fungicide"],
    notes: "Mildiou en bordure",
  },
  message: "Dicté au bord de la vigne",
  checks: { level: "danger", messages: [{ level: "danger", message: "Fongicide X : ZNT de 20 m non respectée." }], phyto: null, fertilization: null, certification: null, checkedAt: "2026-06-12T07:00:00.000Z" },
  createdAt: "2026-06-12T07:00:00.000Z",
  decidedAt: null,
  decisionNote: null,
  resultId: null,
  corrected: false,
  ...over,
});

describe("propositions à valider", () => {
  it("compteur dans la navigation, contrôles, refus motivé", async () => {
    let rejected: unknown = null;
    server.use(
      http.get("*/proposals", () => HttpResponse.json({ items: rejected ? [] : [proposal()], pending: rejected ? 0 : 1 })),
      http.post(`*/proposals/${ID}/reject`, async ({ request }) => {
        rejected = await request.json();
        return HttpResponse.json(proposal({ status: "rejected", decidedAt: "2026-06-12T08:00:00.000Z" }));
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/interventions`);
    const nav = await screen.findByRole("navigation", { name: "Menu principal" });
    const entry = await within(nav).findByRole("link", { name: /À valider/ });
    expect(within(entry).getByLabelText("1 en attente")).toHaveTextContent("1");
    await user.click(entry);

    const card = await screen.findByLabelText(/Proposition : /);
    expect(within(card).getByText(/réalisée le 12\/06\/2026/)).toBeInTheDocument();
    expect(within(card).getByText("Les Rouffiats")).toBeInTheDocument();
    expect(within(card).getByText(/Fongicide X 1,5 L\/ha/)).toBeInTheDocument();
    expect(within(card).getByText(/Assistant Claude \(assistant IA, Camille\)/)).toBeInTheDocument();
    expect(within(card).getByText("« Dicté au bord de la vigne »")).toBeInTheDocument();
    expect(within(card).getByText("Feu rouge")).toBeInTheDocument();
    expect(within(card).getByText(/ZNT de 20 m non respectée/)).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Refuser" }));
    await user.type(screen.getByRole("textbox", { name: /Motif/ }), "Déjà traité");
    await user.click(screen.getByRole("button", { name: "Refuser la proposition" }));
    await waitFor(() => expect(rejected).toEqual({ note: "Déjà traité" }));
    expect(await screen.findByText("Aucune proposition en attente.")).toBeInTheDocument();
  });

  it("vérifier et enregistrer : formulaire prérempli, la proposition part avec l'enregistrement", async () => {
    const calls: Record<string, unknown>[] = [];
    server.use(
      http.get("*/proposals", () => HttpResponse.json({ items: [proposal()], pending: 1 })),
      http.get("*/crew-templates", () => HttpResponse.json({ items: [] })),
      http.post("*/interventions", async ({ request }) => HttpResponse.json(calls.push((await request.json()) as Record<string, unknown>) && {}, { status: 201 })),
      http.post("*/interventions/:id/complete", async ({ request }) => {
        calls.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ intervention: {}, movements: [], warnings: [] });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}/a-valider`);
    await user.click(await screen.findByRole("button", { name: "Vérifier et enregistrer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/f/${FARM}/interventions/new`));
    expect(router.state.location.search).toBe("?at=2026-06-12");
    expect(await screen.findByText(/Proposition de Assistant Claude \(assistant IA\)/)).toBeInTheDocument();
    expect(screen.getByText(/Au dépôt : Fongicide X : ZNT de 20 m non respectée/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Mildiou en bordure")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Quantité" })).toHaveValue("1,5");
    const form = screen.getByRole("form", { name: "Saisie de l'intervention" });
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    // Réalisée : création, puis réalisation avec le contenu et la proposition acceptée.
    expect(calls[0]).toMatchObject({ procedure: "spraying" });
    expect(calls[1]).toMatchObject({ proposal: ID, targets: [{ kind: "land_parcel", id: PARCEL }], inputs: [{ articleId: FONGICIDE, quantity: 1.5, per: "hectare" }] });
  });

  it("sans proposition en attente : pas d'entrée dans la navigation", async () => {
    renderApp(`/f/${FARM}/interventions`);
    const nav = await screen.findByRole("navigation", { name: "Menu principal" });
    await within(nav).findByRole("link", { name: "Interventions" });
    expect(within(nav).queryByRole("link", { name: /À valider/ })).toBeNull();
  });
});
