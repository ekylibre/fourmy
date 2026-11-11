import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { FertilizationPlan, FertilizationPlanSummary } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Plan prévisionnel de fumure (lot AG) : données synthétiques. */
const PLAN = "00000000-0000-7000-8000-00000000c001";
const plan = (patch: Partial<FertilizationPlan> = {}): FertilizationPlan => ({
  id: PLAN,
  campaign: 2026,
  parcel: { id: "00000000-0000-7000-8000-0000000000a1", name: "Champ Maïs 2026", areaM2: 40000 },
  status: "draft",
  currentVersion: null,
  draft: {},
  context: {
    department: "64",
    crop: "maize_grain",
    cropLabel: "Maïs grain",
    variety: "DKC5432",
    soilType: "limoneux",
    irrigated: false,
    previous: { crop: "maize_grain", label: "Maïs grain", parcelName: "Champ Maïs 2025", yieldRealized: 120, xMineral: 92, strawReturned: null, uncounted: [] },
    yieldTarget: { value: 95, origin: "reference", detail: "référence départementale 64" },
    rain: { mm: 700, from: "2025-10-01", to: "2026-05-01", normalsFrom: null },
    rsh: null,
    water: { origin: null, no3MgL: null, name: null },
    irrigationMm: null,
    zone: "in",
    opening: { on: "2026-04-01", origin: "default" },
    sowing: { period: null, sownOn: null },
    cover: null,
  },
  result: {
    method: "bilan_cau_two_phase",
    annex: "2.2.b",
    equation: "X = [(Pf + Rf) − (Ri + Mh + Mhp + Mr + MrCi + Nirr + 0,6 × N avant 4 feuilles)] / 0,8 − Xa, plus l'apport avant 4 feuilles",
    terms: {
      Pf: { value: 219, origin: "reference", source: "Annexe 2.2.b, tableau 1, p. 2", detail: "95 × b 2.3" },
      Rf: { value: 30, origin: "reference", source: "Annexe 2.2.b, tableau 4, p. 3" },
      Ri: { value: 26, origin: "computed", source: "Annexe 2.2.b, tableau 8, p. 6", detail: "APL 0 kg, pluie 700 mm" },
      Mh: { value: 45, origin: "reference", source: "Annexe 2.2.b, tableau 12, p. 8", detail: "en sec" },
      CAU: { value: 0.8, origin: "reference", source: "Annexe 2.2.b, tableau 17, p. 12" },
    },
    dose: 223,
    ceiling: null,
    floor30: false,
    negative: false,
    warnings: [],
    missing: [],
  },
  proposedApplications: [
    { stage: "Avant 4 feuilles", plannedOn: null, articleId: null, nKgHa: 50, reservedForSteering: false },
    { stage: "4 à 8 feuilles", plannedOn: null, articleId: null, nKgHa: 173, reservedForSteering: false },
  ],
  versions: [],
  steering: { measurements: [], reservedKgNHa: 0, allowedDose: null },
  prescriptions: [],
  ...patch,
});

describe("plan de fumure", () => {
  it("liste de la campagne sur la page Fertilisation azotée", async () => {
    const summary: FertilizationPlanSummary = { id: PLAN, campaign: 2026, parcel: plan().parcel, cropLabel: "Maïs grain", zone: "in", status: "draft", currentVersion: null, dose: 223, doseOrigin: "fourmy", missing: 0, establishedAt: null };
    server.use(
      http.get("*/fertilization/plans", () => HttpResponse.json({ items: [summary] })),
      http.get("*/fertilization/parcels", () => HttpResponse.json({ items: [] })),
      http.get("*/water-sources", () => HttpResponse.json({ items: [] })),
      http.get("*/fertilization/record", () =>
        HttpResponse.json({
          campaign: 2026,
          from: "2025-09-01",
          to: "2026-09-01",
          toComplete: 0,
          late: 0,
          forced: [],
          parcels: [{ parcelId: "x", name: "Champ Maïs 2026", areaHa: 4, soilType: null, zone: "in", crop: "Maïs grain", variety: null, sownOn: null, harvestedOn: [], yieldQHa: null, interculture: [], cover: null, soilCover: { level: "warning", situation: "long", messages: [] }, aplsh: { from: "2025-09-20", to: "2025-12-10", kgNHa: 90, ceiling: 70, over: true, missing: [] }, steering: [], noPlowing: null, applications: [], totalNKgHa: 230, plannedDose: 180, planVersion: 1 }],
        }),
      ),
    );
    renderApp(`/f/${FARM}/fertilization?at=2026-06-01`);
    const table = await screen.findByRole("table", { name: "Plans de la campagne" });
    expect(within(table).getByRole("link", { name: "Champ Maïs 2026" })).toHaveAttribute("href", expect.stringContaining(`/fertilization/plans/${PLAN}`));
    expect(within(table).getByText("223 kg N/ha")).toBeInTheDocument();
    expect(screen.getByText("1 plan à établir.")).toBeInTheDocument();
    expect(await within(screen.getByLabelText("Suivi de la campagne")).findByText("Couverture des sols à vérifier : Champ Maïs 2026.")).toBeInTheDocument();
    expect(screen.getByText("Champ Maïs 2026 : 230 kg N apportés pour 180 kg prévus, sans mesure de pilotage.")).toBeInTheDocument();
    expect(screen.getByText("Champ Maïs 2026 : 90 kg d'azote potentiellement libéré jusqu'en sortie d'hiver sur le couvert, pour un plafond de 70 kg.")).toBeInTheDocument();
    expect((await screen.findAllByLabelText("Zone climatique (APLSH)"))[0]).toHaveValue("D'après le département");
  });

  it("fiche : données, bilan sourcé, apports proposés ; établir le plan", async () => {
    let established = false;
    server.use(
      http.get("*/fertilization/plans/:id", () => HttpResponse.json(plan())),
      http.get("*/fertilizers", () => HttpResponse.json({ items: [] })),
      http.post("*/fertilization/plans/:id/establish", () => {
        established = true;
        return HttpResponse.json(plan({ status: "established", currentVersion: 1 }));
      }),
    );
    renderApp(`/f/${FARM}/fertilization/plans/${PLAN}`);
    expect(await screen.findByRole("heading", { name: "Plan de fumure 2026 : Champ Maïs 2026" })).toBeInTheDocument();
    const data = screen.getByLabelText("Données de la parcelle");
    expect(data).toHaveTextContent("Maïs grain (Champ Maïs 2025) : 120 q/ha récoltés, 92 kg N minéral apportés");
    expect(data).toHaveTextContent("700 mm jusqu'au 01/05/2026");
    expect(screen.getByLabelText("Dose calculée")).toHaveTextContent("Dose calculée : 223 kg N/ha");
    const ri = screen.getByRole("row", { name: "Reliquat à l'ouverture du bilan (Ri)" });
    expect(ri).toHaveTextContent("26 kg");
    expect(within(ri).getByText("calculé")).toBeInTheDocument();
    expect(ri).toHaveTextContent("APL 0 kg, pluie 700 mm");
    const apps = screen.getByLabelText("Apports prévus");
    expect(apps).toHaveTextContent("Total 223 kg N/ha pour une dose de 223 kg");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Établir le plan" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Établir" }));
    await waitFor(() => expect(established).toBe(true));
  });

  it("pilotage : mesure enregistrée, dose permise", async () => {
    let posted: unknown = null;
    const established = plan({
      status: "established",
      currentVersion: 1,
      versions: [{ version: 1, establishedAt: "2026-03-01T08:00:00Z", establishedBy: "Pierre", reason: null, referential: "NA 2025", method: "bilan_cau_two_phase", external: null, doseEfficient: 180, applications: [], snapshot: { context: plan().context, result: plan().result, draft: {} } }],
    });
    server.use(
      http.get("*/fertilization/plans/:id", () =>
        HttpResponse.json(
          posted
            ? { ...established, steering: { measurements: [{ id: "s1", planId: PLAN, measuredOn: "2026-06-10", stage: null, tool: "N-Tester", value: null, advisedKgNHa: 40, notes: null, createdAt: "2026-06-10T08:00:00Z" }], reservedKgNHa: 0, allowedDose: 220 } }
            : established,
        ),
      ),
      http.get("*/fertilizers", () => HttpResponse.json({ items: [] })),
      http.post("*/fertilization/plans/:id/steering", async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: "s1" }, { status: 201 });
      }),
    );
    renderApp(`/f/${FARM}/fertilization/plans/${PLAN}`);
    const section = await screen.findByLabelText("Pilotage");
    const user = userEvent.setup();
    await user.click(within(section).getByRole("button", { name: "Ajouter une mesure" }));
    await user.type(within(section).getByLabelText("Outil"), "N-Tester");
    const advised = within(section).getByLabelText("Dose conseillée (kg N/ha)");
    await user.clear(advised);
    await user.type(advised, "40");
    await user.click(within(section).getByRole("button", { name: "Enregistrer la mesure" }));
    await waitFor(() => expect(posted).toMatchObject({ tool: "N-Tester", advisedKgNHa: 40 }));
    expect(await within(section).findByText(/Dose permise après la dernière mesure : 220 kg N\/ha \(plan : 180 kg\)/)).toBeInTheDocument();
  });

  it("apport du plan : lien « Moduler » vers une carte de modulation, cartes liées (lot AN)", async () => {
    const UREA = "00000000-0000-7000-8000-00000000f201";
    server.use(
      http.get("*/fertilization/plans/:id", () =>
        HttpResponse.json(
          plan({
            draft: { applications: [{ stage: "6 feuilles", plannedOn: null, articleId: UREA, nKgHa: 69, reservedForSteering: false }] },
            prescriptions: [{ id: "m1", name: "Azote 6 feuilles", stage: "6 feuilles", product: "Urée 46", unit: "kg_ha", targetRate: 150, meanRate: 150.2, createdAt: "2026-05-01T08:00:00Z" }],
          }),
        ),
      ),
      http.get("*/fertilizers", () =>
        HttpResponse.json({
          items: [{ id: UREA, name: "Urée 46", kind: "fertilizer", unit: "Kilogramme", lexiconRef: null, composition: { basis: "mass_percent", nTotal: 46, nMineralShare: 1, p2o5: null, k2o: null, so3: null, density: null, nitrateType: "III", foliar: false }, origin: "confirmed", source: null, proposal: null, analyses: [], usage: 0 }],
        }),
      ),
    );
    renderApp(`/f/${FARM}/fertilization/plans/${PLAN}`);
    const link = await screen.findByRole("link", { name: "Moduler l'apport 6 feuilles" });
    // 69 kg N / 46 % = 150 kg d'urée par hectare.
    expect(link.getAttribute("href")).toBe(`/f/${FARM}/prescriptions/new?parcel=${plan().parcel.id}&plan=${PLAN}&stage=6+feuilles&product=Ur%C3%A9e+46&rate=150&unit=kg_ha`);
    expect(screen.getByLabelText("Cartes de modulation du plan")).toHaveTextContent("Carte Azote 6 feuilles (6 feuilles, Urée 46) : moyenne 150,2 kg/ha pour 150 prévus.");
  });

  it("ouverture du bilan, période d'implantation et couvert d'interculture", async () => {
    let draft: unknown = null;
    let cover: unknown = null;
    server.use(
      http.get("*/fertilization/plans/:id", () => HttpResponse.json(plan())),
      http.get("*/fertilizers", () => HttpResponse.json({ items: [] })),
      http.put("*/fertilization/plans/:id/draft", async ({ request }) => {
        draft = await request.json();
        return HttpResponse.json(plan({ draft: draft as FertilizationPlan["draft"] }));
      }),
      http.put("*/land-parcels/:id/cover-crop", async ({ request }) => {
        cover = await request.json();
        return HttpResponse.json({ id: "c1", parcelId: plan().parcel.id, ...(cover as object) });
      }),
    );
    renderApp(`/f/${FARM}/fertilization/plans/${PLAN}`);
    const data = await screen.findByLabelText("Données de la parcelle");
    expect(data).toHaveTextContent("Ouverture du bilan01/04/2026 (date par défaut)");
    expect(data).toHaveTextContent("période d'implantation à saisir");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Période d'implantation"), "15 avril – 10 mai");
    await user.tab();
    await waitFor(() => expect(draft).toMatchObject({ sowingPeriod: "15 avril – 10 mai" }));

    const section = screen.getByLabelText("Couvert d'interculture");
    await user.click(within(section).getByRole("button", { name: "Saisir un couvert" }));
    await user.type(within(section).getByLabelText("Espèces"), "Moutarde blanche");
    await user.click(within(section).getByRole("button", { name: "Enregistrer le couvert" }));
    await waitFor(() => expect(cover).toMatchObject({ campaign: 2026, kind: "sown", family: "cruciferes", species: "Moutarde blanche", sownOn: "2025-09-01" }));
  });
});

describe("éditions de la directive nitrates", () => {
  it("cahier d'enregistrement imprimable : apports, total, plan ; lien CSV", async () => {
    server.use(
      http.get("*/fertilization/record", () =>
        HttpResponse.json({
          campaign: 2026,
          from: "2025-09-01",
          to: "2026-09-01",
          toComplete: 0,
          late: 0,
          forced: [{ interventionId: "i9", date: "2026-01-20", parcels: ["Champ Maïs 2026"], reason: "Dérogation préfectorale" }],
          parcels: [
            {
              parcelId: "00000000-0000-7000-8000-0000000000a1",
              name: "Champ Maïs 2026",
              areaHa: 4,
              soilType: "limoneux",
              zone: "in",
              crop: "Maïs grain",
              variety: "DKC5432",
              sownOn: "2026-04-09",
              harvestedOn: [],
              yieldQHa: null,
              interculture: [{ date: "2026-03-01", label: "Labour" }],
              noPlowing: false,
              applications: [
                { interventionId: "i1", date: "2026-05-12", recordedOn: "2026-05-12", late: false, procedure: "fertilizing", areaHa: 4, product: "Urée 46", content: "46 % N", nitrateType: "III", doseLabel: "150 kilogram/ha", nTotalKgHa: 69, nEfficientKgHa: 69, missing: null, efficiency: { level: "warning", message: "Efficacité de l'apport (urée solide, grille COMIFER 2022) : note 14, conditions limites, risque de pertes d'efficacité significatives. D'après : pH du sol 7,8." } },
              ],
              soilCover: { level: "warning", situation: "long", messages: ["Couverture implantée le 05/10/2025, après la date limite du 30/09/2025."] },
              aplsh: { from: "2025-09-20", to: "2025-12-10", kgNHa: 90, ceiling: 70, over: true, missing: [] },
              steering: [{ id: "s1", planId: "p", measuredOn: "2026-06-10", stage: "10 feuilles", tool: "N-Tester", value: "580", advisedKgNHa: 40, notes: null, createdAt: "2026-06-10T08:00:00Z" }],
              cover: { id: "c1", parcelId: "00000000-0000-7000-8000-0000000000a1", campaign: 2026, kind: "sown", family: "cruciferes", species: "Moutarde blanche", sownOn: "2025-09-05", destroyedOn: "2025-12-10", exported: false, biomass: "1_3", destructionMode: "mechanical", notes: null },
              totalNKgHa: 69,
              plannedDose: 180,
              planVersion: 3,
            },
          ],
        }),
      ),
    );
    renderApp(`/f/${FARM}/print/fertilization/record?campaign=2026`);
    expect(await screen.findByRole("heading", { name: "Cahier d'enregistrement des pratiques de fertilisation azotée" })).toBeInTheDocument();
    const block = screen.getByLabelText("Cahier Champ Maïs 2026");
    expect(block).toHaveTextContent("En zone vulnérable · sol : Sols limoneux · culture : Maïs grain (DKC5432) · semis 09/04/2026");
    expect(within(block).getByRole("row", { name: /Urée 46/ })).toHaveTextContent("12/05/2026");
    expect(within(block).getByRole("row", { name: /Urée 46/ })).toHaveTextContent("note 14, conditions limites, risque de pertes d'efficacité significatives");
    expect(block).toHaveTextContent("Couvert d'interculture : Moutarde blanche (Crucifères (moutarde, radis…)), semé le 05/09/2025, détruit le 10/12/2025 (mécanique (broyage, labour))");
    expect(block).toHaveTextContent("couverture des sols : à vérifier (Couverture implantée le 05/10/2025, après la date limite du 30/09/2025.)");
    expect(block).toHaveTextContent("Azote potentiellement libéré jusqu'en sortie d'hiver sur le couvert, du 20/09/2025 au 10/12/2025 : 90 kg N/ha pour un plafond de 70 kg (dépassé).");
    expect(block).toHaveTextContent("Pilotage : N-Tester 580 le 10/06/2026 (10 feuilles), 40 kg N/ha conseillés");
    expect(screen.getByLabelText("Épandages en période d'interdiction")).toHaveTextContent("20/01/2026 (Champ Maïs 2026) — motif : Dérogation préfectorale");
    expect(block).toHaveTextContent("Total : 69 kg N efficace/ha pour 180 kg prévus au plan (version 3).");
    expect(screen.getByRole("link", { name: "CSV" })).toHaveAttribute("href", expect.stringContaining("/fertilization/record?campaign=2026&format=csv"));
    expect(screen.getByRole("button", { name: "Imprimer ou enregistrer en PDF" })).toBeInTheDocument();
  });
});
