import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import type { ItkDeriveResult } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * « Depuis l'historique » (lot IT2) : campagnes proposées, proposition
 * relue (rien n'est enregistré), puis création de l'ITK et ouverture de
 * l'éditeur.
 */
vi.mock("@osfarm/itineraire-technique", () => ({ RotationRenderer: class { render() {} dispose() {} } }));

const ACTIVITY = "00000000-0000-7000-8000-0000000000f1";
const CREATED = "00000000-0000-7000-8000-0000000000c9";
const proposal: ItkDeriveResult = {
  name: "Vignes AOP — d'après 2025, 2026",
  activityId: ACTIVITY,
  activityName: "Vignes AOP",
  production: "vine",
  system: "conventional",
  source: { activityId: ACTIVITY, campaigns: [2025, 2026], productions: 3 },
  stats: { productions: 3, excluded: 1, interventions: 24, unconvertedInputs: 0, toComplete: 1 },
  content: {
    schema: 1,
    steps: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        procedure: "vine_spraying_without_fertilizing",
        anchor: { kind: "date", monthDay: "05-15", yearOffset: 0 },
        share: 1,
        optional: false,
        repeat: { count: 6, everyDays: 12 },
        inputs: [{ articleId: "00000000-0000-4000-8000-0000000000a1", kind: "phyto", label: "Bouillie bordelaise", dose: 2.5, unit: "kilogram_per_hectare" }],
        staffing: { equipmentIds: [], personIds: [], people: 1 },
        evidence: { parcels: 3, ofParcels: 3, campaigns: [2025, 2026], observedRateHaH: 3.2, observedSamples: 9 },
      },
    ],
  },
};

describe("itinéraire depuis l'historique", () => {
  it("campagnes, proposition, création puis éditeur", async () => {
    const derived: unknown[] = [];
    const created: { origin: string; name: string }[] = [];
    server.use(
      http.get("*/technical-itineraries", () => HttpResponse.json({ items: [] })),
      http.get("*/technical-itineraries/history", () =>
        HttpResponse.json({ items: [{ year: 2026, productions: 3, interventions: 14 }, { year: 2025, productions: 3, interventions: 10 }, { year: 2024, productions: 2, interventions: 8 }] }),
      ),
      http.post("*/technical-itineraries/derive", async ({ request }) => {
        derived.push(await request.json());
        return HttpResponse.json(proposal);
      }),
      http.post("*/technical-itineraries", async ({ request }) => {
        const body = (await request.json()) as { origin: string; name: string };
        created.push(body);
        return HttpResponse.json({ id: CREATED }, { status: 201 });
      }),
      http.get("*/technical-itineraries/:id", () =>
        HttpResponse.json({ ...proposal, id: CREATED, origin: "history", active: true, revision: 0, cycle: "annual", updatedAt: "2026-11-21T10:00:00Z", notes: null, missing: [], example: { sowingOn: "2026-03-01", harvestOn: "2026-09-20", year: 2026 } }),
      ),
      http.get("*/crew-templates", () => HttpResponse.json({ items: [] })),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/itineraries?activityId=${ACTIVITY}&derive=1`);

    const dialog = await screen.findByRole("dialog", {}, { timeout: 10_000 });
    // Les deux dernières campagnes sont cochées par défaut.
    expect(await within(dialog).findByRole("checkbox", { name: /2026/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /2025/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /2024/ })).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Proposer" }));
    await waitFor(() => expect(derived).toEqual([{ activityId: ACTIVITY, campaigns: [2026, 2025] }]));

    const table = await within(dialog).findByRole("table", { name: "Étapes proposées" });
    expect(within(table).getByText(/6 passages tous les 12 j/)).toBeInTheDocument();
    expect(within(table).getByText("Bouillie bordelaise 2,5 kg/ha")).toBeInTheDocument();
    expect(within(table).getByText(/3,2 ha\/h observé/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 étape sans matériel : à compléter/)).toBeInTheDocument();
    expect(created).toEqual([]); // rien d'enregistré avant « Créer »

    await user.click(within(dialog).getByRole("button", { name: "Créer l'itinéraire" }));
    await waitFor(() => expect(created).toMatchObject([{ origin: "history", name: "Vignes AOP — d'après 2025, 2026" }]));
    expect(await screen.findByRole("table", { name: "Étapes de l'itinéraire" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText("3,2 ha/h observé")).toBeInTheDocument();
  });
});
