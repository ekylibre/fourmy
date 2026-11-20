import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { SeedDetail, SeedListItem } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Page Semences (lot SE3) : données synthétiques. */
const MAIZE = "00000000-0000-7000-8000-00000000e101";
const MIX = "00000000-0000-7000-8000-00000000e102";
const year = new Date().getFullYear();

const maize: SeedListItem = {
  articleId: MAIZE,
  name: "Semence de maïs - P0573",
  unit: "Sac de 50 000 grains",
  unitDim: "dose",
  lexiconRef: null,
  organicStatus: "conventional",
  seedTreated: true,
  sheet: {
    articleId: MAIZE,
    species: "zea_mays",
    varietyName: "P0573",
    gnisCode: null,
    category: "certified",
    isMixture: false,
    grainsPerDose: 50000,
    bagKg: null,
    tgwG: null,
    tgwOrigin: null,
    tgwOn: null,
    updatedAt: "2026-11-20T10:00:00Z",
  },
  speciesLabel: "Maïs",
  importedSpecies: null,
  importedGnis: null,
  componentCount: 0,
  reference: { label: "Maïs", typicalG: 320, minG: 270, maxG: 346, typicalStated: false, org: "Arvalis", url: "https://www.arvalis.fr/x", note: null },
  tgw: { tgwG: 320, origin: "reference", from: "reference", estimated: true },
  flags: ["tgw_missing"],
  looksLikeMixture: false,
  stock: 12,
  usage: [{ campaign: year, interventions: 2 }],
};
const mixture: SeedListItem = {
  ...maize,
  articleId: MIX,
  name: "Avoine + TI + Radis + Phacélie",
  unit: "kilogram",
  unitDim: "mass",
  organicStatus: null,
  seedTreated: null,
  sheet: null,
  speciesLabel: null,
  importedSpecies: "Mélange",
  reference: null,
  tgw: null,
  flags: ["species_unknown", "tgw_missing"],
  looksLikeMixture: true,
  stock: 0,
  usage: [],
};
const detail: SeedDetail = {
  ...maize,
  components: [],
  lots: [{ id: "00000000-0000-7000-8000-00000000e201", code: "LOT-MAIS", stock: 12, seed: null }],
  interventions: [
    {
      interventionId: "00000000-0000-7000-8000-00000000e301",
      startedAt: `${year}-04-20T08:00:00Z`,
      status: "done",
      campaign: year,
      parcels: ["Grand champ"],
      quantity: 1.8,
      unit: "Sac de 50 000 grains_per_hectare",
      areaHa: 10,
      grainsPerM2: 9,
      kgPerHa: 28.8,
      estimated: true,
    },
  ],
};

describe("semences", () => {
  it("liste les semences avec leur PMG et ce qui manque ; filtre « Sans PMG » et « Mélanges »", async () => {
    server.use(http.get("*/seeds", () => HttpResponse.json({ items: [maize, mixture] })));
    renderApp(`/f/${FARM}/seeds`);
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Semence de maïs - P0573").closest("tr")!;
    expect(row).toHaveTextContent("Maïs");
    expect(row).toHaveTextContent("doses de 50 000 grains");
    expect(row).toHaveTextContent("320 g, repère Arvalis");
    expect(within(row).getByText("PMG inconnu")).toBeInTheDocument();
    expect(within(within(table).getByText("Avoine + TI + Radis + Phacélie").closest("tr")!).getByText("Mélange ?")).toBeInTheDocument();
    expect(screen.getByText(/1 semence utilisée en/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText(`Semées en ${year}`));
    expect(within(table).queryByText("Avoine + TI + Radis + Phacélie")).not.toBeInTheDocument();
    await user.click(screen.getByText(`Semées en ${year}`));
    await user.click(screen.getByText("Mélanges"));
    expect(within(table).queryByText("Semence de maïs - P0573")).not.toBeInTheDocument();
  });

  it("fiche : repère de l'espèce, densités des semis ; le responsable reprend le repère et enregistre", async () => {
    let saved: Record<string, unknown> | null = null;
    server.use(
      http.get("*/seeds", () => HttpResponse.json({ items: [maize] })),
      http.get("*/seeds/species", () => HttpResponse.json({ items: [{ species: "zea_mays", label: "Maïs", legume: false, hasReference: true }] })),
      http.get("*/articles/:id/seed", () => HttpResponse.json(detail)),
      http.put("*/articles/:id/seed", async ({ request }) => {
        saved = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(detail);
      }),
    );
    renderApp(`/f/${FARM}/seeds`);
    const user = userEvent.setup();
    await user.click(await screen.findByText("Semence de maïs - P0573"));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText(/Repère Arvalis pour maïs : 320 g \(de 270 à 346 g\), milieu de la plage publiée/)).toBeInTheDocument();
    const uses = within(drawer).getByRole("table", { name: `Semis de la campagne ${year}` });
    expect(uses).toHaveTextContent("Grand champ");
    expect(uses).toHaveTextContent("28,8 (estimée)");
    expect(within(drawer).getByRole("table", { name: "Lots de la semence" })).toHaveTextContent("LOT-MAIS");

    await user.click(within(drawer).getByRole("button", { name: "Reprendre le repère" }));
    await user.click(within(drawer).getByRole("button", { name: "Enregistrer la fiche" }));
    await waitFor(() => expect(saved).toMatchObject({ species: "zea_mays", grainsPerDose: 50000, tgwG: 320, tgwOrigin: "reference" }));
    expect(saved).not.toHaveProperty("unit");
  });
});
