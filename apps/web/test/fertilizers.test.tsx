import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { demoInterventions } from "@fourmy/mocks";
import type { FertilizerArticle } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Fertilisants et azote apporté (lot AE) : données synthétiques. */
const UAN = "00000000-0000-7000-8000-00000000f101";
const MANURE = "00000000-0000-7000-8000-00000000f102";
const proposal = { basis: "kg_per_m3", nTotal: 390, nMineralShare: 1, p2o5: null, k2o: null, so3: null, density: 1.3, nitrateType: "III", foliar: false, source: "nom « Solution azotée 390 » (solution azotée)" } as const;
const items: FertilizerArticle[] = [
  { id: UAN, name: "Solution azotée 390", kind: "fertilizer", unit: "Tonne", lexiconRef: null, composition: null, origin: null, source: null, proposal, analyses: [], usage: 3 },
  { id: MANURE, name: "Fumier", kind: "fertilizer", unit: "Tonne", lexiconRef: null, composition: null, origin: null, source: null, proposal: null, analyses: [], usage: 2 },
];

describe("fertilisants", () => {
  it("liste les compositions proposées et à compléter ; le responsable confirme une proposition", async () => {
    let saved: unknown = null;
    server.use(
      http.get("*/fertilizers", () => HttpResponse.json({ items })),
      http.put("*/articles/:id/fertilizer", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ ...items[0], composition: proposal, origin: "confirmed" });
      }),
    );
    renderApp(`/f/${FARM}/fertilizers`);
    const table = await screen.findByRole("table", { name: "Fertilisants" });
    const uan = within(table).getByText("Solution azotée 390").closest("tr")!;
    expect(uan).toHaveTextContent("390 kg N/m³ · d 1,3 · type III");
    expect(within(uan).getByText("Proposée")).toBeInTheDocument();
    expect(within(within(table).getByText("Fumier").closest("tr")!).getByText("À compléter")).toBeInTheDocument();
    expect(screen.getByText(/2 fertilisants déjà utilisés sans composition/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(uan).getByRole("button", { name: "Vérifier" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Proposition de Fourmy d'après nom « Solution azotée 390 »/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(saved).toMatchObject({ basis: "kg_per_m3", nTotal: 390, density: 1.3, nitrateType: "III", source: "nom « Solution azotée 390 » (solution azotée)" }));
  });

  it("organique : référence APLSH du COMIFER et C/N (lot AK)", async () => {
    let saved: unknown = null;
    const slurry = { basis: "kg_per_m3", nTotal: 4, nMineralShare: 0.6, p2o5: null, k2o: null, so3: null, density: null, nitrateType: "II", foliar: false } as const;
    server.use(
      http.get("*/fertilizers", () => HttpResponse.json({ items: [{ ...items[1], name: "Lisier", composition: slurry, origin: "confirmed", source: "analyse" }] })),
      http.put("*/articles/:id/fertilizer", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(items[1]);
      }),
    );
    renderApp(`/f/${FARM}/fertilizers`);
    const table = await screen.findByRole("table", { name: "Fertilisants" });
    const user = userEvent.setup();
    await user.click(within(within(table).getByText("Lisier").closest("tr")!).getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getAllByLabelText("Référence APLSH (COMIFER)")[0]!);
    await user.click(await screen.findByRole("option", { name: "Lisier mixte de porc (type II)" }));
    await user.type(within(dialog).getByLabelText("Rapport C/N"), "4");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(saved).toMatchObject({ aplshProduct: "lisier_mixte_de_porc", cN: 4 }));
  });

  it("la fiche d'une intervention affiche l'azote apporté par hectare", async () => {
    const demo = demoInterventions[0]!;
    const article = demo.inputs[0]!.articleId;
    server.use(
      http.get("*/interventions/:id", () => HttpResponse.json({ ...demo, history: [] })),
      http.get("*/fertilizers", () =>
        HttpResponse.json({
          items: [{ ...items[0], id: article, composition: { ...proposal, basis: "mass_percent", nTotal: 30, density: 1 }, origin: "confirmed", proposal: null }],
        }),
      ),
    );
    renderApp(`/f/${FARM}/interventions/${demo.id}?at=2026-06-30`);
    const quantities = await screen.findByRole("table", { name: "Intrants et sorties" });
    // 2 L/ha × 1 kg/L × 30 % = 0,6 kg N/ha.
    expect(await within(quantities).findByLabelText("Azote de l'intrant")).toHaveTextContent("≈ 0,6 kg N/ha (confirmée)");
    expect(screen.getByLabelText("Azote apporté")).toHaveTextContent("Azote apporté : 0,6 kg N/ha");
  });
});
