import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import type { PlannedItem, PlannedPreview } from "@fourmy/contracts";
import { setMockSignedIn } from "@fourmy/mocks";
import { Providers, createQueryClient } from "../src/app/providers";
import { PlannedInterventionsModal } from "../src/features/itk/PlannedInterventionsModal";
import { server } from "./setup";
import { FARM } from "./render";

/**
 * « Préparer les interventions prévues » (lot IT3) : états, cases cochées par
 * défaut, date modifiée, confirmation avec l'empreinte de l'aperçu, refus
 * rapportés sans tout perdre.
 */
const item = (key: string, state: PlannedItem["state"], over: Partial<PlannedItem> = {}): PlannedItem => ({
  key,
  state,
  productionId: "p1",
  parcelId: "lp1",
  parcelName: "Le Champ",
  activityName: "Blé tendre",
  itineraryId: "itk",
  itineraryName: "Blé tendre — Le Champ",
  procedure: "sowing",
  label: key,
  day: "2026-10-15",
  areaM2: 100_000,
  optional: false,
  inputs: [],
  interventionId: null,
  itineraryChanged: false,
  ...over,
});
const preview: PlannedPreview = {
  year: 2027,
  previewHash: "h1",
  withoutItinerary: 2,
  items: [
    item("Semis", "create", { inputs: [{ articleId: "a", label: "Blé Chevignon", dose: 180, unit: "kilogram_per_hectare" }] }),
    item("Désherbage", "create", { optional: true, procedure: "spraying", day: "2026-11-09" }),
    item("Apport", "update", { itineraryChanged: true, procedure: "mineral_fertilizing", day: "2027-02-15" }),
    item("Ancien traitement", "remove", { procedure: "spraying", day: "2027-04-01" }),
    item("Déplacée", "modified", { day: "2027-03-01" }),
    item("Récolte", "undated", { procedure: "harvesting", day: null }),
  ],
};

describe("interventions prévues d'une campagne", () => {
  it("cases par défaut, date modifiée, confirmation avec l'empreinte ; refus rapportés", async () => {
    setMockSignedIn(true);
    const bodies: { previewHash: string; accepted: string[]; dateEdits: Record<string, string> }[] = [];
    server.use(
      http.post("*/planned-interventions/2027/preview", () => HttpResponse.json(preview)),
      http.post("*/planned-interventions/2027", async ({ request }) => {
        bodies.push((await request.json()) as (typeof bodies)[number]);
        return HttpResponse.json({ created: 1, updated: 1, removed: 1, failed: [{ key: "Apport", message: "Le Champ · Apport : unité incompatible" }] });
      }),
    );
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    render(
      <Providers client={client} env="test">
        <MemoryRouter>
          <PlannedInterventionsModal farmId={FARM} year={2027} onClose={() => {}} />
        </MemoryRouter>
      </Providers>,
    );
    const table = await screen.findByRole("table", { name: "Interventions proposées" }, { timeout: 10_000 });
    expect(screen.getByText("2 culture(s) sans itinéraire")).toBeInTheDocument();
    expect(within(table).getByText("Blé Chevignon 180 kg/ha")).toBeInTheDocument();
    expect(within(table).getByText("itinéraire modifié")).toBeInTheDocument();
    expect(within(table).getByText("à préciser")).toBeInTheDocument();
    // Cochées : création (pas l'étape « si besoin »), mise à jour, retrait ; pas de case pour la modifiée.
    expect(within(table).getByRole("checkbox", { name: "Le Champ · Semis" })).toBeChecked();
    expect(within(table).getByRole("checkbox", { name: "Le Champ · Désherbage" })).not.toBeChecked();
    expect(within(table).getByRole("checkbox", { name: "Le Champ · Apport" })).toBeChecked();
    expect(within(table).getByRole("checkbox", { name: "Le Champ · Ancien traitement" })).toBeChecked();
    expect(within(table).queryByRole("checkbox", { name: "Le Champ · Déplacée" })).toBeNull();

    const user = userEvent.setup();
    const date = within(table).getByLabelText("Date de Semis");
    await user.clear(date);
    await user.type(date, "2026-10-20");
    await user.click(screen.getByRole("button", { name: "Confirmer (3)" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ previewHash: "h1", accepted: ["Semis", "Apport", "Ancien traitement"], dateEdits: { Semis: "2026-10-20" } });
    expect(await screen.findByText("Le Champ · Apport : unité incompatible")).toBeInTheDocument();
  });
});
