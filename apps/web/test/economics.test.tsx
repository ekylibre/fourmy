import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Price } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Module « Économique » (temps 3, lot E1) : prix en vigueur affiché avec sa
 * source, saisie d'un prix, modification en masse, date d'effet envoyée.
 */
const labour: Price = {
  id: "p1",
  kind: "labour",
  articleId: null,
  equipmentId: null,
  activityId: null,
  product: null,
  procedure: null,
  unit: "hour",
  amount: 20,
  validFrom: "2026-01-01",
  source: "farm",
  sourceRef: null,
  sourceDate: null,
  note: null,
  createdAt: "2026-01-01T10:00:00Z",
};

describe("module Économique", () => {
  it("saisie du coût horaire et modification en masse d'un intrant", async () => {
    const posted: { items: Record<string, unknown>[] }[] = [];
    server.use(
      http.get("*/prices", ({ request }) => HttpResponse.json({ items: new URL(request.url).searchParams.get("kind") === "labour" ? [labour] : [] })),
      http.post("*/prices", async ({ request }) => {
        posted.push((await request.json()) as (typeof posted)[number]);
        return HttpResponse.json({ items: [] }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/economics?tab=labour`);
    const table = await screen.findByRole("table", { name: "Main-d'œuvre" }, { timeout: 10_000 });
    expect(within(table).getByText(/depuis le 01\/01\/2026 · saisi/)).toBeInTheDocument();
    const input = within(table).getByLabelText("Prix de Coût horaire de la main-d'œuvre");
    await user.clear(input);
    await user.type(input, "22,5");
    await user.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.items).toEqual([expect.objectContaining({ kind: "labour", unit: "hour", amount: 22.5, source: "farm", validFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })]);

    await user.click(screen.getByRole("tab", { name: "Intrants" }));
    const inputs = await screen.findByRole("table", { name: "Intrant" });
    expect(within(inputs).getByText("à saisir")).toBeInTheDocument();
    await user.click(within(inputs).getByRole("checkbox", { name: "Choisir Fongicide X" }));
    await user.type(screen.getByLabelText("Prix à"), "8");
    await user.click(screen.getAllByRole("button", { name: "Appliquer" })[0]!);
    await user.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]!.items).toEqual([expect.objectContaining({ kind: "article", unit: "liter", amount: 8 })]);
  });
});
