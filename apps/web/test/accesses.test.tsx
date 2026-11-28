import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Accès externes (lot AM4) : liste des clés, création avec droits, clé
 * affichée une seule fois, journal, révocation.
 */
const ACCESS = {
  id: "00000000-0000-7000-8000-00000000a001",
  kind: "api_key",
  name: "Export compta",
  keyStart: "fmy_ab",
  user: { id: "00000000-0000-7000-8000-0000000000aa", name: "Démo" },
  grant: { modules: { stocks: "read", economics: "read" }, activities: "all" },
  createdAt: "2026-11-27T10:00:00.000Z",
  expiresAt: "2027-02-25T10:00:00.000Z",
  revokedAt: null,
  lastUsedAt: null,
};

describe("accès externes", () => {
  it("liste les clés avec leurs droits ; crée une clé et ne la montre qu'une fois", async () => {
    let body: unknown = null;
    server.use(
      http.get(`*/farms/${FARM}/accesses`, () => HttpResponse.json({ items: [ACCESS], nextCursor: null })),
      http.post(`*/farms/${FARM}/accesses`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ access: { ...ACCESS, id: "00000000-0000-7000-8000-00000000a002", name: "Conseiller vigne" }, key: "fmy_abcdefghijklmnopqrstuvwxyz0123456789" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/farm?tab=accesses`);
    const table = await screen.findByRole("table", { name: "Accès externes" });
    expect(screen.getByRole("textbox", { name: "Adresse du serveur MCP" })).toHaveValue(`${location.origin}/mcp`);
    expect(within(table).getByText("Export compta")).toBeInTheDocument();
    expect(within(table).getByText("Stocks et semences, Économique · toutes activités")).toBeInTheDocument();
    expect(within(table).getByText("fmy_ab…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Créer une clé" }));
    const dialog = await screen.findByRole("dialog", { name: "Créer une clé d'API" });
    await user.type(within(dialog).getByRole("textbox", { name: /Nom/ }), "Conseiller vigne");
    // Propositions (lot AM8) : seulement sur les interventions.
    expect(within(within(dialog).getByRole("radiogroup", { name: "Accès au module Stocks et semences" })).queryByText("Lecture et propositions")).toBeNull();
    await user.click(within(within(dialog).getByRole("radiogroup", { name: "Accès au module Interventions" })).getByText("Lecture et propositions"));
    await user.click(within(dialog).getByRole("button", { name: "Créer la clé" }));
    expect(await screen.findByRole("textbox", { name: "Clé d'API" })).toHaveValue("fmy_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(body).toEqual({ name: "Conseiller vigne", grant: { modules: { activities: "read", interventions: "write" }, activities: "all" }, expiresInDays: 90 });
  });

  it("journal d'une clé, puis révocation", async () => {
    let revoked = false;
    server.use(
      http.get(`*/farms/${FARM}/accesses`, () => HttpResponse.json({ items: [revoked ? { ...ACCESS, revokedAt: "2026-11-27T12:00:00.000Z" } : ACCESS], nextCursor: null })),
      http.get(`*/farms/${FARM}/accesses/:id/log`, () =>
        HttpResponse.json({ items: [{ at: "2026-11-27T11:00:00.000Z", channel: "rest", operation: "GET /stock", status: 200, durationMs: 12 }], nextCursor: null }),
      ),
      http.delete(`*/farms/${FARM}/accesses/:id`, () => {
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/farm?tab=accesses`);
    await user.click(await screen.findByRole("button", { name: "Journal" }));
    const log = await screen.findByRole("table", { name: "Journal des appels" });
    expect(within(log).getByText("GET /stock")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Révoquer" }));
    const dialog = await screen.findByRole("dialog", { name: "Révoquer la clé" });
    await user.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    expect(await screen.findByText("Révoquée")).toBeInTheDocument();
  });
});
