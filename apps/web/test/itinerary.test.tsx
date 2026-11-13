import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import type { TechnicalItinerary } from "@fourmy/contracts";
import type { TikaSystemJson } from "@fourmy/domain";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/**
 * Itinéraire technique de la fiche parcelle (lot T2). TIKA dessine sur un
 * canvas que jsdom n'a pas : il est simulé, et l'on vérifie ce qu'il reçoit,
 * le rappel au clic et la libération au démontage.
 */
const tika = vi.hoisted(() => ({
  renders: [] as { system: TikaSystemJson; click: (i: { ref: unknown }) => void }[],
  disposed: 0,
}));
vi.mock("@osfarm/itineraire-technique", () => ({
  RotationRenderer: class {
    constructor(el: HTMLElement, system: TikaSystemJson, settings: { onInterventionClick: (i: { ref: unknown }) => void }) {
      el.innerHTML = `<div class="mainITKContainer">${system.steps.map((s) => `<h4>${s.name}</h4>`).join("")}</div>`;
      tika.renders.push({ system, click: settings.onInterventionClick });
    }
    render() {}
    dispose() {
      tika.disposed++;
    }
  },
}));

const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const INTERVENTION = "00000000-0000-7000-8000-000000000401";
const sheet = {
  id: PARCEL,
  name: "Les Rouffiats",
  shape: { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.501, 44.8], [0.501, 44.801], [0.5, 44.8]]]] },
  areaM2: 12000,
  center: [0.5005, 44.8005],
  pacIslet: null,
  since: "2020-01-01T00:00:00Z",
  until: null,
  productions: [],
  cadastre: [],
  cap: [],
  referencesFetchedAt: null,
  water: [],
  interventions: [],
};
const itinerary = (campaigns: number[]): TechnicalItinerary => ({
  title: "Les Rouffiats",
  campaigns,
  steps: campaigns.map((year) => ({
    kind: "crop",
    campaign: year,
    name: `Vigne ${year}`,
    color: "#7a3b5c",
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    datesFrom: "campaign",
    attributes: [{ label: "Surface", value: "1,2 ha" }],
    marks: [
      {
        interventionIds: [INTERVENTION],
        procedure: "vine_spraying_without_fertilizing",
        label: "Pulvérisation · Karaté K",
        lane: "inputs",
        status: "done",
        at: `${year}-06-10`,
        from: `${year}-06-10`,
        to: `${year}-06-10`,
        day: 160,
        details: [{ label: "Intrants", value: "Karaté K 1,5 L/ha" }],
        parcels: [{ id: PARCEL, name: "Les Rouffiats" }],
      },
    ],
  })),
});

describe("itinéraire technique de la parcelle", () => {
  beforeEach(() => {
    tika.renders.length = 0;
    tika.disposed = 0;
  });

  it("campagne de la frise, puis rotation sur 3 et 5 ans ; frise ou cercle ; clic vers la fiche", async () => {
    const calls: string[] = [];
    const opened: string[] = [];
    server.use(
      // Page de l'intervention : on note seulement qu'elle a été demandée.
      http.get("*/interventions/:id", ({ params }) => {
        opened.push(String(params.id));
        return HttpResponse.json({ type: "about:blank", title: "Introuvable", status: 404 }, { status: 404 });
      }),
      http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/land-parcels/:id/itinerary", ({ request }) => {
        const u = new URL(request.url);
        calls.push(`${u.searchParams.get("year")}/${u.searchParams.get("years")}`);
        const year = Number(u.searchParams.get("year"));
        const years = Number(u.searchParams.get("years"));
        return HttpResponse.json(itinerary(Array.from({ length: years }, (_, k) => year - years + 1 + k)));
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2023-06-10&tab=itinerary`);

    expect(await screen.findByText("Vigne 2023", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(calls).toEqual(["2023/1"]);
    const first = tika.renders.at(-1)!.system;
    expect(first.options).toMatchObject({ view: "horizontal", show_transcript: true, title_top_interventions: "Travaux", title_bottom_interventions: "Intrants" });
    expect(first.steps[0]!.interventions[0]).toMatchObject({ name: "Pulvérisation · Karaté K", type: "intervention_bottom", day: 160 });
    expect(screen.getByText(/1 intervention : travaux au-dessus/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Rotation" }));
    expect(await screen.findByText("Vigne 2021")).toBeInTheDocument();
    expect(calls).toContain("2023/3");
    await user.click(screen.getByRole("combobox", { name: "Années de la rotation" }));
    await user.click(await screen.findByRole("option", { name: "5 ans" }));
    expect(await screen.findByText("Vigne 2019")).toBeInTheDocument();
    expect(calls).toContain("2023/5");

    const before = tika.disposed;
    await user.click(screen.getByRole("radio", { name: "Cercle" }));
    await waitFor(() => expect(tika.renders.at(-1)!.system.options.view).toBe("donut"));
    expect(tika.disposed).toBeGreaterThan(before); // l'ancien rendu est libéré

    // Clic sur une intervention dans TIKA : la fiche de l'intervention s'ouvre.
    tika.renders.at(-1)!.click({ ref: { interventionIds: [INTERVENTION], parcels: [] } });
    await waitFor(() => expect(opened).toEqual([INTERVENTION]), { timeout: 10_000 });
  });

  it("rien sur la période : un message, pas de frise vide", async () => {
    server.use(
      http.get("*/land-parcels/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/land-parcels/:id/itinerary", () => HttpResponse.json({ title: "Les Rouffiats", campaigns: [2023], steps: [] })),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2023-06-10&tab=itinerary`);
    expect(await screen.findByText("Aucune culture ni intervention sur cette période.", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(tika.renders).toHaveLength(0);
  });
});

describe("itinéraire technique d'une activité", () => {
  const ACTIVITY = "00000000-0000-7000-8000-0000000000f1";
  const P2 = "00000000-0000-7000-8000-0000000000a2";
  const I2 = "00000000-0000-7000-8000-000000000402";
  const merged = {
    title: "Vignes AOP 2023",
    campaigns: [2023],
    steps: [
      {
        kind: "crop",
        campaign: 2023,
        name: "Vignes AOP",
        color: null,
        from: "2023-01-01",
        to: "2023-12-31",
        datesFrom: "campaign",
        attributes: [],
        marks: [
          {
            interventionIds: [INTERVENTION, I2],
            procedure: "vine_pruning",
            label: "Taille, 2 parcelles",
            lane: "works",
            status: "done",
            at: "2023-01-22",
            from: "2023-01-20",
            to: "2023-01-24",
            day: 21,
            details: [],
            parcels: [{ id: PARCEL, name: "Les Rouffiats" }, { id: P2, name: "Le Coteau" }],
            members: [
              { interventionId: INTERVENTION, at: "2023-01-20", label: "Taille", status: "done", parcels: ["Les Rouffiats"] },
              { interventionId: I2, at: "2023-01-24", label: "Taille", status: "done", parcels: ["Le Coteau"] },
            ],
          },
        ],
      },
    ],
    parcels: [
      { id: P2, name: "Le Coteau", areaM2: 8000, interventions: 1 },
      { id: PARCEL, name: "Les Rouffiats", areaM2: 12000, interventions: 1 },
      { id: "00000000-0000-7000-8000-0000000000a3", name: "La Pente", areaM2: 5000, interventions: 0 },
    ],
  };

  beforeEach(() => {
    tika.renders.length = 0;
  });

  it("depuis Activités : vue fusionnée, parcelles sans intervention signalées, groupe ouvert, descente sur une parcelle", async () => {
    const parcelCalls: string[] = [];
    server.use(
      http.get("*/activities/:id/itinerary", ({ request }) => {
        expect(new URL(request.url).searchParams.get("year")).toBe("2023");
        return HttpResponse.json(merged);
      }),
      http.get("*/land-parcels/:id/itinerary", ({ params }) => {
        parcelCalls.push(String(params.id));
        return HttpResponse.json(itinerary([2023]));
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/activities?at=2023-06-10`);
    await user.click(await screen.findByRole("link", { name: "Itinéraire" }, { timeout: 10_000 }));

    expect(await screen.findByRole("heading", { name: "Itinéraire technique — Vignes AOP 2023" })).toBeInTheDocument();
    expect(screen.getByText("1 parcelle sans intervention enregistrée en 2023")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Parcelles de l'activité" })).toHaveTextContent("La Pente");
    await waitFor(() => expect(tika.renders.at(-1)!.system.steps[0]!.name).toBe("Vignes AOP"));

    // Clic sur la marque regroupée : la liste de ses interventions, chacune vers sa fiche.
    tika.renders.at(-1)!.click({ ref: merged.steps[0]!.marks[0] });
    const dialog = await screen.findByRole("dialog", { name: "2 interventions regroupées" });
    expect(within(dialog).getAllByRole("link", { name: "Taille" }).map((a) => a.getAttribute("href"))).toEqual([
      `/f/${FARM}/interventions/${INTERVENTION}`,
      `/f/${FARM}/interventions/${I2}`,
    ]);

    // Depuis le groupe, descente sur une parcelle ; puis retour à la vue fusionnée.
    await user.click(within(dialog).getByRole("button", { name: "Le Coteau" }));
    expect(await screen.findByText("Parcelle sélectionnée : Le Coteau")).toBeInTheDocument();
    expect(parcelCalls).toEqual([P2]);
    await waitFor(() => expect(tika.renders.at(-1)!.system.steps[0]!.name).toBe("Vigne 2023"));
    await user.click(screen.getByRole("button", { name: "Retour à la vue de l'activité" }));
    await waitFor(() => expect(tika.renders.at(-1)!.system.steps[0]!.name).toBe("Vignes AOP"));

    // Depuis la liste des parcelles aussi.
    await user.click(screen.getByRole("button", { name: "Itinéraire de Les Rouffiats" }));
    expect(await screen.findByText("Parcelle sélectionnée : Les Rouffiats")).toBeInTheDocument();
  });
});
