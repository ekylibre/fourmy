import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

describe("interventions", () => {
  it("liste les interventions de la campagne avec libellés et origine", async () => {
    renderApp(`/f/${FARM}/interventions?at=2026-06-30`);
    expect(await screen.findByText("Pulvérisation")).toBeInTheDocument();
    expect(screen.getByText("Les Rouffiats")).toBeInTheDocument();
    expect(screen.getByText(/Fongicide X 2 L\/ha/)).toBeInTheDocument();
    expect(screen.getByText("Mobile")).toBeInTheDocument();
  });

  it("enregistre une intervention réalisée : planification puis réalisation, dose par hectare", async () => {
    const user = userEvent.setup();
    const calls: { url: string; body: unknown }[] = [];
    server.use(
      http.post("*/interventions", async ({ request }) => {
        calls.push({ url: request.url, body: await request.json() });
        return HttpResponse.json({}, { status: 201 });
      }),
      http.post("*/interventions/:id/complete", async ({ request }) => {
        calls.push({ url: request.url, body: await request.json() });
        return HttpResponse.json({ intervention: {}, movements: [], warnings: ["Fongicide X : stock négatif"] });
      }),
    );
    renderApp(`/f/${FARM}/interventions?at=2026-06-30`);
    await user.click(await screen.findByRole("button", { name: "Nouvelle intervention" }));
    const form = await screen.findByRole("dialog");

    await user.click(within(form).getByRole("combobox", { name: "Parcelles" }));
    await user.click(await screen.findByRole("option", { name: /Les Rouffiats/ }));
    await user.click(within(form).getByRole("combobox", { name: "Produit" }));
    await user.click(await screen.findByRole("option", { name: /Fongicide X/ }));
    await user.type(within(form).getByRole("textbox", { name: "Dose" }), "1,5");
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Fongicide X : stock négatif")).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    const [plan, complete] = calls as [{ body: { procedure: string; parameters: unknown[] } }, { url: string; body: { parameters: unknown[] } }];
    expect(plan.body.procedure).toBe("spraying");
    expect(plan.body.parameters).toEqual([]); // réalisée : les paramètres vont à la réalisation
    expect(complete.url).toMatch(/\/complete$/);
    expect(complete.body.parameters).toEqual([
      { role: "target", refType: "land_parcel", refId: "00000000-0000-7000-8000-0000000000a0", quantity: null, unit: null },
      { role: "input", refType: "article", refId: "00000000-0000-7000-8000-000000000301", quantity: 1.5, unit: "liter_per_hectare" },
    ]);
  });

  it("affiche le refus du serveur sans fermer le formulaire", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/interventions/:id/complete", () =>
        HttpResponse.json({ title: "Règle métier", status: 422, detail: "Dose en kilogram_per_hectare incompatible" }, { status: 422 }),
      ),
    );
    renderApp(`/f/${FARM}/interventions?at=2026-06-30`);
    await user.click(await screen.findByRole("button", { name: "Nouvelle intervention" }));
    const form = await screen.findByRole("dialog");
    await user.click(within(form).getByRole("combobox", { name: "Parcelles" }));
    await user.click(await screen.findByRole("option", { name: /Les Rouffiats/ }));
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    expect(await within(form).findByText(/incompatible/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
