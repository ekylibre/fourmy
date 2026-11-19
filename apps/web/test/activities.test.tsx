import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { demoActivities, demoInterventions } from "@fourmy/mocks";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Activités (lot C) : page de gestion, activité des parcelles sur la fiche et dans le formulaire. */
describe("activités", () => {
  it("liste les activités par famille avec leurs parcelles de la campagne", async () => {
    renderApp(`/f/${FARM}/activities?at=2026-06-10`);
    expect(await screen.findByRole("heading", { name: "Activités 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Viticulture" })).toBeInTheDocument();
    const card = screen.getByLabelText("Activité Vignes AOP");
    expect(within(card).getByText(/Référence : Vigne · culture : Vigne/)).toBeInTheDocument();
    expect(within(card).getByText(/^1 parcelle\(s\) · 1,2/)).toBeInTheDocument();
  });

  it("« Actives uniquement » : seules les activités avec des parcelles pour la campagne", async () => {
    const user = userEvent.setup();
    // Une activité sans parcelle cette campagne, à côté de celles de la démonstration.
    const idle = { ...demoActivities[0]!, id: "00000000-0000-7000-8000-0000000ac710", name: "Colza (sans parcelle)", parcelIds: [], areaM2: 0 };
    server.use(http.get("*/activities", () => HttpResponse.json({ items: [...demoActivities, idle] })));
    const { router } = renderApp(`/f/${FARM}/activities?at=2026-06-10`);
    await screen.findByRole("heading", { name: "Activités 2026" });
    const before = screen.getAllByLabelText(/^Activité /);
    const empty = before.filter((c) => within(c).queryByText(/^0 parcelle\(s\)/));
    expect(empty.length).toBeGreaterThan(0);
    await user.click(screen.getByRole("switch", { name: "Actives uniquement" }));
    const after = screen.getAllByLabelText(/^Activité /);
    expect(after).toHaveLength(before.length - empty.length);
    expect(after.every((c) => !within(c).queryByText(/^0 parcelle\(s\)/))).toBe(true);
    expect(screen.queryByLabelText("Activité Colza (sans parcelle)")).toBeNull();
    expect(screen.getByRole("switch", { name: /Actives uniquement \(\d+ sur \d+\)/ })).toBeChecked();
    expect(router.state.location.search).toContain("actives=1");
  });

  it("crée une activité depuis une production de référence Lexicon", async () => {
    const user = userEvent.setup();
    let created: Record<string, unknown> | null = null;
    server.use(
      http.get("*/activities/references", () =>
        HttpResponse.json({
          items: [{ referenceName: "grain_corn", label: "Maïs grain", family: "plant_farming", specie: "zea_mays", specieLabel: "Maïs", color: "#F5D33D", pictureUrl: null }],
        }),
      ),
      http.post("*/activities", async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderApp(`/f/${FARM}/activities?at=2026-06-10`);
    await user.click(await screen.findByRole("button", { name: "Nouvelle activité" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle activité" });
    await user.click(within(dialog).getByRole("combobox", { name: /Production de référence/ }));
    await user.click(await screen.findByRole("option", { name: "Maïs grain (Maïs)" }));
    expect(within(dialog).getByRole("textbox", { name: "Nom" })).toHaveValue("Maïs grain");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Activité créée.")).toBeInTheDocument();
    expect(created).toMatchObject({ name: "Maïs grain", family: "plant_farming", reference: "grain_corn", cultivation: "zea_mays", color: "#F5D33D" });
  });

  it("récapitulatif des certifications par activité ; certification ajoutée à une parcelle", async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    server.use(
      http.post("*/land-parcels/:id/certifications", async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderApp(`/f/${FARM}/activities?at=2026-06-10`);
    const card = await screen.findByLabelText("Activité Vignes AOP");
    expect(await within(card).findByText("AB · 1/1")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Parcelles 2026" }));
    const dialog = await screen.findByRole("dialog", { name: /Vignes AOP : parcelles 2026/ });
    await user.click(await within(dialog).findByRole("button", { name: "Certifications" }));
    const certs = await screen.findByRole("dialog", { name: /Certifications :/ });
    expect(within(certs).getByText("Ecocert")).toBeInTheDocument();
    await user.click(within(certs).getByRole("button", { name: "Ajouter une certification" }));
    const form = within(certs).getByRole("form", { name: "Certification" });
    await user.click(within(form).getByRole("combobox", { name: "Certification" }));
    await user.click(await screen.findByRole("option", { name: "Haute Valeur Environnementale (HVE)" }));
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Certification ajoutée.")).toBeInTheDocument();
    expect(posted).toMatchObject({ kind: "hve", level: "3" });
  });

  it("la fiche d'une intervention montre l'activité de chaque parcelle", async () => {
    renderApp(`/f/${FARM}/interventions/${demoInterventions[0]!.id}?at=2026-06-10`);
    const targets = await screen.findByRole("table", { name: "Cibles" });
    expect(await within(targets).findByLabelText("Activité : Vignes AOP")).toBeInTheDocument();
  });
});
