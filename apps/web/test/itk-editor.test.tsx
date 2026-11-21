import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import type { ItkDetail } from "@fourmy/contracts";
import type { TikaSystemJson } from "@fourmy/domain";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Éditeur d'itinéraire technique (lot IT1) : étapes et dates d'exemple,
 * aperçu TIKA, ajout d'une étape, enregistrement avec la révision, 409.
 */
const tika = vi.hoisted(() => ({ renders: [] as { system: TikaSystemJson }[] }));
vi.mock("@osfarm/itineraire-technique", () => ({
  RotationRenderer: class {
    constructor(el: HTMLElement, system: TikaSystemJson) {
      el.innerHTML = `<div class="mainITKContainer"></div>`;
      tika.renders.push({ system });
    }
    render() {}
    dispose() {}
  },
}));

const ITK = "00000000-0000-7000-8000-0000000000c1";
const detail: ItkDetail = {
  id: ITK,
  name: "Blé tendre — Le Champ",
  activityId: null,
  activityName: null,
  production: null,
  system: "conventional",
  cycle: "annual",
  origin: "manual",
  active: true,
  revision: 3,
  updatedAt: "2026-11-21T10:00:00Z",
  source: null,
  notes: null,
  missing: [],
  example: { sowingOn: "2026-10-15", harvestOn: "2027-07-10", year: 2027 },
  content: {
    schema: 1,
    steps: [
      { id: "00000000-0000-4000-8000-000000000001", procedure: "superficial_plowing", anchor: { kind: "sowing", offsetDays: -30 }, share: 1, optional: false, inputs: [], staffing: { equipmentIds: [], personIds: [] } },
      {
        id: "00000000-0000-4000-8000-000000000002",
        procedure: "sowing",
        anchor: { kind: "sowing", offsetDays: 0 },
        share: 1,
        optional: false,
        inputs: [{ kind: "seed", label: "Blé Chevignon", dose: 180, unit: "kilogram_per_hectare" }],
        staffing: { equipmentIds: [], personIds: [], people: 1 },
        workRateHaH: 2.5,
      },
    ],
  },
};

describe("éditeur d'itinéraire technique", () => {
  beforeEach(() => {
    tika.renders.length = 0;
  });

  it("affiche les étapes et l'aperçu, ajoute une étape, enregistre avec la révision ; 409 propose recharger ou écraser", async () => {
    const puts: { revision: number; steps: number }[] = [];
    let conflict = false;
    server.use(
      http.get("*/technical-itineraries/:id", () => HttpResponse.json(detail)),
      http.get("*/crew-templates", () => HttpResponse.json({ items: [] })),
      http.put("*/technical-itineraries/:id", async ({ request }) => {
        const body = (await request.json()) as { revision: number; content: { steps: unknown[] } };
        puts.push({ revision: body.revision, steps: body.content.steps.length });
        if (conflict) return HttpResponse.json({ title: "Conflit", detail: "modifié", current: detail }, { status: 409 });
        return HttpResponse.json({ ...detail, revision: body.revision + 1, content: body.content });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/itineraries/${ITK}`);

    const table = await screen.findByRole("table", { name: "Étapes de l'itinéraire" }, { timeout: 10_000 });
    expect(within(table).getByText("Déchaumage")).toBeInTheDocument();
    expect(within(table).getByText("semis J-30")).toBeInTheDocument();
    expect(within(table).getByText("Blé Chevignon 180 kg/ha")).toBeInTheDocument();
    expect(within(table).getByText("2,5 ha/h")).toBeInTheDocument();
    await waitFor(() => expect(tika.renders.length).toBeGreaterThan(0));
    expect(tika.renders.at(-1)!.system.steps[0]!.interventions.map((i) => i.day)).toEqual([0, 30]);

    // Ajout d'une récolte.
    await user.click(screen.getByRole("button", { name: "Ajouter une étape" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /Procédure/ }));
    await user.click(await screen.findByRole("option", { name: "Récolte" }));
    await user.click(within(dialog).getByRole("radio", { name: "Par rapport à la récolte" }));
    await user.click(within(dialog).getByRole("button", { name: "Ajouter l'étape" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(table).getByText("récolte J0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(puts).toEqual([{ revision: 3, steps: 3 }]));
    expect(await screen.findByText(/révision 4/)).toBeInTheDocument();

    // Conflit : l'éditeur propose de recharger ou d'écraser.
    conflict = true;
    await user.click(within(table).getAllByRole("button", { name: "Supprimer l'étape" })[0]!);
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Itinéraire modifié entre-temps")).toBeInTheDocument();
    conflict = false;
    await user.click(screen.getByRole("button", { name: "Écraser avec mes modifications" }));
    await waitFor(() => expect(puts.at(-1)).toEqual({ revision: 3, steps: 2 }));
  });
});
