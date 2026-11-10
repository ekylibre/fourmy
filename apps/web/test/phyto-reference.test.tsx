import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Registre phyto réglementaire (lot X) : culture OEPP des activités, stade BBCH des traitements. */
const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const FONGICIDE = "00000000-0000-7000-8000-000000000301";
const VIGNE = "00000000-0000-7000-8000-0000000000f1";

describe("registre réglementaire : culture et stade", () => {
  it("culture de l'activité : proposée, puis choisie dans le référentiel", async () => {
    const user = userEvent.setup();
    let saved: Record<string, unknown> | null = null;
    server.use(
      http.put(`*/activities/${VIGNE}`, async ({ request }) => {
        saved = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );
    renderApp(`/f/${FARM}/activities?at=2026-06-10`);
    const card = await screen.findByLabelText("Activité Vignes AOP");
    expect(within(card).getByText("Registre phyto : Vigne (VITVI) · proposée")).toBeInTheDocument();

    // Sans changement de culture : le champ n'est pas envoyé (l'API garde l'existant).
    await user.click(within(card).getByRole("button", { name: "Modifier" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Proposée d'après la production de référence.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Activité modifiée.");
    expect(saved).not.toHaveProperty("cropCode");

    await user.click(within(card).getByRole("button", { name: "Modifier" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /Culture \(registre phyto\)/ }));
    await user.click(await screen.findByRole("option", { name: "Ray Grass (LOLPE)" }));
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await vi.waitFor(() => expect(saved).toMatchObject({ cropCode: "53001" }));
  });

  it("stade BBCH : stades de la culture des parcelles, envoyé à l'enregistrement", async () => {
    const user = userEvent.setup();
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    server.use(
      http.post("*/interventions", async ({ request }) => {
        calls.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({}, { status: 201 });
      }),
      http.post("*/interventions/:id/complete", async ({ request }) => {
        calls.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ intervention: {}, movements: [], warnings: [] });
      }),
    );
    renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    const button = await screen.findByRole("button", { name: "Nouvelle intervention" });
    await vi.waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    const form = await screen.findByRole("form", { name: "Saisie de l'intervention" });
    await user.click(within(form).getByRole("combobox", { name: "Intervention" }));
    await user.click(await screen.findByRole("option", { name: "Pulvérisation" }));

    // Sans parcelle : culture inconnue, champ désactivé.
    expect(within(form).getByRole("combobox", { name: "Stade BBCH (facultatif)" })).toBeDisabled();
    await user.click(within(form).getByRole("combobox", { name: "Parcelles" }));
    await user.click(await screen.findByRole("option", { name: /Les Rouffiats/ }));
    const stage = within(form).getByRole("combobox", { name: "Stade BBCH (facultatif)" });
    await vi.waitFor(() => expect(stage).toBeEnabled());
    await user.click(stage);
    await user.click(await screen.findByRole("option", { name: /^BBCH 57 — / }));

    await user.click(within(form).getByRole("combobox", { name: "Produit" }));
    await user.click(await screen.findByRole("option", { name: /Fongicide X/ }));
    await user.type(within(form).getByRole("textbox", { name: "Quantité" }), "1,5");
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body).toMatchObject({ targets: [{ kind: "land_parcel", id: PARCEL }], inputs: [{ articleId: FONGICIDE }], bbch: "SP_27001_57" });
  });
});
