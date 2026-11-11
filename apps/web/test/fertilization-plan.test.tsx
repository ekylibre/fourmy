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
  ...patch,
});

describe("plan de fumure", () => {
  it("liste de la campagne sur la page Fertilisation azotée", async () => {
    const summary: FertilizationPlanSummary = { id: PLAN, campaign: 2026, parcel: plan().parcel, cropLabel: "Maïs grain", zone: "in", status: "draft", currentVersion: null, dose: 223, doseOrigin: "fourmy", missing: 0, establishedAt: null };
    server.use(
      http.get("*/fertilization/plans", () => HttpResponse.json({ items: [summary] })),
      http.get("*/fertilization/parcels", () => HttpResponse.json({ items: [] })),
      http.get("*/water-sources", () => HttpResponse.json({ items: [] })),
    );
    renderApp(`/f/${FARM}/fertilization?at=2026-06-01`);
    const table = await screen.findByRole("table", { name: "Plans de la campagne" });
    expect(within(table).getByRole("link", { name: "Champ Maïs 2026" })).toHaveAttribute("href", expect.stringContaining(`/fertilization/plans/${PLAN}`));
    expect(within(table).getByText("223 kg N/ha")).toBeInTheDocument();
    expect(screen.getByText("1 plan à établir.")).toBeInTheDocument();
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
});
