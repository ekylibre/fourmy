import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { demoInterventionHistory, demoInterventions } from "@fourmy/mocks";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Fiche et modification d'une intervention (exigences INT-UI-2, INT-UI-3). */
const DEMO = demoInterventions[0]!;
const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const FONGICIDE = "00000000-0000-7000-8000-000000000301";
const LOT = "00000000-0000-7000-8000-000000000501";

const detail = (patch: object = {}, history = demoInterventionHistory) =>
  http.get("*/interventions/:id", () => HttpResponse.json({ ...DEMO, history, ...patch }));

describe("fiche d'une intervention", () => {
  it("s'ouvre d'un clic dans la liste : parcelles, doses par ha et totales, moyens, historique", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    await user.click(await screen.findByText("Pulvérisation"));

    expect(await screen.findByRole("heading", { name: "Pulvérisation", level: 1 })).toBeInTheDocument();
    const targets = await screen.findByRole("table", { name: "Cibles" });
    expect(await within(targets).findByText("Les Rouffiats")).toBeInTheDocument();
    const quantities = screen.getByRole("table", { name: "Intrants et sorties" });
    expect(await within(quantities).findByText("Fongicide X")).toBeInTheDocument();
    expect(within(quantities).getByText(/2 L\/ha/)).toBeInTheDocument();
    expect(screen.getByText("Intervenants :").parentElement).toHaveTextContent("Intervenants : Camille");
    // Historique replié par défaut : il s'ouvre au clic.
    const history = screen.getByRole("button", { name: /Historique/ });
    expect(history).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Réalisée", { selector: ".mantine-Timeline-itemTitle" })).toBeNull();
    await user.click(history);
    expect(screen.getByText("Réalisée", { selector: ".mantine-Timeline-itemTitle" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Modifier" })).toHaveAttribute("href", expect.stringContaining(`/interventions/${DEMO.id}/edit`));
    // Sans WebGL (jsdom), la mini-carte est remplacée par un message ; la fiche reste lisible.
    expect(screen.getByText(/Carte indisponible/)).toBeInTheDocument();
  });

  it("périodes avec durée et intervenants ; pictogrammes réglementaires des intrants phyto", async () => {
    renderApp(`/f/${FARM}/interventions/${DEMO.id}?at=2026-06-30`);
    const period = (await screen.findAllByLabelText("Période de travail"))[0]!;
    expect(within(period).getByText(/\d+ h|\d+ min/)).toBeInTheDocument();
    // Intervenants : dans le pavé Moyens, avec les matériels.
    const means = screen.getAllByLabelText("Moyens")[0]!;
    expect(await within(means).findByText(/Camille/)).toBeInTheDocument();
    const quantities = await screen.findByRole("table", { name: "Intrants et sorties" });
    const pictos = await within(quantities).findByLabelText("Pictogrammes réglementaires");
    expect(within(pictos).getByRole("img", { name: /SGH09 : Dangereux pour l'environnement aquatique/ })).toBeInTheDocument();
    expect(within(pictos).getByRole("img", { name: /SGH07/ })).toBeInTheDocument();
    expect(within(pictos).getByText("DRE 6 h")).toBeInTheDocument();
  });

  it("l'historique montre une correction : motif, avant → après", async () => {
    server.use(
      detail({}, [
        ...demoInterventionHistory,
        {
          id: "00000000-0000-7000-8000-000000000702",
          at: "2026-06-12T10:00:00.000Z",
          action: "corrected",
          actor: "u",
          actorName: "Camille",
          origin: "web",
          reason: "dose mal recopiée",
          changes: { inputs: { before: [{ articleId: FONGICIDE, per: "hectare", quantity: 2 }], after: [{ articleId: FONGICIDE, per: "hectare", quantity: 1.5 }] } },
        },
      ]),
    );
    renderApp(`/f/${FARM}/interventions/${DEMO.id}?at=2026-06-30`);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Historique/ }));
    expect(await screen.findByText("Corrigée")).toBeInTheDocument();
    expect(screen.getByText("« dose mal recopiée »")).toBeInTheDocument();
    expect(await screen.findByText(/Fongicide X 2 L\/ha → Fongicide X 1,5 L\/ha/)).toBeInTheDocument();
  });

  it("une intervention reprise d'Ekylibre sans modification le dit", async () => {
    server.use(detail({ origin: "migration" }, []));
    renderApp(`/f/${FARM}/interventions/${DEMO.id}?at=2026-06-30`);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Historique/ }));
    expect(await screen.findByText(/Importée d'Ekylibre/)).toBeInTheDocument();
    expect(screen.getByText("Reprise d'Ekylibre")).toBeInTheDocument();
  });

  it("pulvérisation : conditions en tête, parcelles en %, feu de dose, IFT, rejeu 3D", async () => {
    const EQUIPMENT = "00000000-0000-7000-8000-0000000000e1";
    server.use(
      detail({
        weather: { kind: "observed", source: "open_meteo", icon: "03d", temperatureC: 24.9, humidityPct: 56.5, windKmh: 11.2, windMaxKmh: 11.4, precipitationMm: 0, fetchedAt: "2026-06-10T09:00:00.000Z", hours: [] },
        targets: [{ kind: "land_parcel", id: PARCEL, workedAreaM2: 5000 }],
        compliance: {
          level: "info",
          checkedAt: "2026-06-10T09:00:00.000Z",
          referential: "2026.11.07.1",
          reason: null,
          checks: [
            {
              articleId: FONGICIDE,
              articleName: "Fongicide X",
              level: "ok",
              usageId: null,
              usages: [
                { id: "u1", label: "Céréales*Oïdium", doseLabel: "2 L/ha" },
                { id: "u2", label: "Céréales*Rouille", doseLabel: "3 L/ha" },
              ],
              indicators: [{ code: "dose", level: "ok", message: "Dose 2 L/ha, maximum 3 L/ha (cible non précisée)." }],
              harvestAllowedFrom: null,
              reentryAllowedFrom: null,
            },
          ],
        },
        ift: { status: "ok", total: 1.1, computedAt: "2026-06-10T10:00:00.000Z", error: null, lines: [{ articleId: FONGICIDE, parcelId: PARCEL, ift: 1.1, segment: null, warning: null }] },
      }),
      http.get("*/interventions/:id/track-sessions", () =>
        HttpResponse.json({
          items: [
            { id: "00000000-0000-7000-8000-0000000000f1", equipmentId: EQUIPMENT, kind: "work", startedAt: "2026-06-10T08:00:00.000Z", stoppedAt: "2026-06-10T09:00:00.000Z", durationS: 3600, distanceM: 5000, coveredAreaM2: 5000, parcels: [], toolHint: null, widthM: 18, tool: null, tracker: null, intervention: null, drift: null },
          ],
        }),
      ),
    );
    renderApp(`/f/${FARM}/interventions/${DEMO.id}?at=2026-06-30`);
    // Météo en une ligne, sans doublon ; frise horaire du jour, heures de l'intervention soulignées.
    const weather = await screen.findByLabelText("Météo de l'intervention");
    expect(within(weather).getByLabelText("Hygrométrie : 57 %")).toBeInTheDocument();
    expect(within(weather).getByLabelText("Vent : 11 km/h")).toBeInTheDocument(); // rafales égales : pas répétées
    const strip = await within(weather).findByRole("group", { name: "Conditions de pulvérisation" });
    // Créneaux du jour (démo) : 08:00 UTC vent 22 km/h, 09:00 favorable ; l'intervention couvre 08:00–09:00.
    expect(within(strip).getByRole("img", { name: "défavorable" })).toBeInTheDocument();
    expect(within(strip).getByText(/Pendant l'intervention \(.+\) : défavorable — vent 22 km\/h\./)).toBeInTheDocument();
    expect(strip.querySelectorAll("[data-period]")).toHaveLength(1);
    // Météo avant les parcelles, parcelles avant les moyens et les intrants.
    const order = ["Météo de l'intervention", "Parcelles", "Moyens", "Intrants et sorties"].map((n) => screen.getAllByLabelText(n)[0]!);
    for (let k = 1; k < order.length; k++) expect(order[k - 1]!.compareDocumentPosition(order[k]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Parcelle : 0,50 ha travaillés sur 1,25 ha, soit 40 %.
    expect(await screen.findByLabelText("Part travaillée : 40 %")).toBeInTheDocument();
    // Dose : cible non choisie, feu orange et lien pour la préciser.
    const quantities = screen.getByRole("table", { name: "Intrants et sorties" });
    expect(within(quantities).getByRole("img", { name: /Cible à préciser/ })).toBeInTheDocument();
    expect(within(quantities).getByRole("link", { name: "Préciser la cible" })).toBeInTheDocument();
    // IFT 1,1 : au-dessus de la dose de référence, orange.
    // Feu global (en tête) et feu de la ligne.
    expect(within(screen.getByLabelText("IFT")).getAllByRole("img", { name: /Au-dessus de la dose de référence/ })).toHaveLength(2);
    // Rejeu 3D : premier matériel suivi, au début de l'intervention.
    const replay = await screen.findByRole("link", { name: "Revoir l'intervention en 3D" });
    const url = new URL(replay.getAttribute("href")!, "http://x");
    expect(url.pathname).toBe(`/f/${FARM}/3d-plan`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ at: "2026-06-10", equipment: EQUIPMENT, t: "2026-06-10T08:00:00.000Z", replay: "1" });
  });

  it("une intervention annulée ne propose ni modification ni annulation", async () => {
    server.use(detail({ status: "cancelled" }));
    renderApp(`/f/${FARM}/interventions/${DEMO.id}?at=2026-06-30`);
    expect(await screen.findByText("Annulée")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Modifier" })).not.toBeInTheDocument();
  });
});

describe("modification d'une intervention", () => {
  it("corrige la dose d'une intervention réalisée sans perdre surface travaillée, zone ni lot", async () => {
    const user = userEvent.setup();
    const zone = { type: "Polygon", coordinates: [[[0.5, 44.8], [0.501, 44.8], [0.501, 44.801], [0.5, 44.8]]] };
    server.use(
      detail({
        targets: [{ kind: "land_parcel", id: PARCEL, workedAreaM2: 5000, workingZone: zone }],
        inputs: [{ articleId: FONGICIDE, quantity: 2, per: "hectare", unit: "liter", lotId: LOT }],
      }),
    );
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put("*/interventions/:id", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ intervention: DEMO, warnings: ["Campagne 2026 close : la modification change un historique déjà clos."] });
      }),
    );
    renderApp(`/f/${FARM}/interventions/${DEMO.id}/edit?at=2026-06-30`);
    expect(await screen.findByText("Correction tracée")).toBeInTheDocument();
    const quantity = screen.getByRole("textbox", { name: "Quantité" });
    await user.clear(quantity);
    await user.type(quantity, "1,5");
    await user.type(screen.getByRole("textbox", { name: "Motif de la correction (facultatif)" }), "dose mal recopiée");
    await user.click(screen.getByRole("button", { name: "Enregistrer la correction" }));

    expect(await screen.findByText("Intervention corrigée.")).toBeInTheDocument();
    expect(screen.getByText(/Campagne 2026 close/)).toBeInTheDocument();
    expect(body).toMatchObject({
      procedure: "spraying",
      reason: "dose mal recopiée",
      correctionId: expect.any(String),
      targets: [{ kind: "land_parcel", id: PARCEL, workedAreaM2: 5000, workingZone: zone }],
      inputs: [{ articleId: FONGICIDE, quantity: 1.5, per: "hectare", lotId: LOT }],
      doers: [{ personId: "00000000-0000-7000-8000-000000000601" }],
      purposes: ["fungicide"],
    });
    expect((body as unknown as { periods: unknown[] }).periods).toHaveLength(1);
    // Retour à la fiche (chargée à la demande).
    expect(await screen.findByRole("heading", { name: "Pulvérisation", level: 1 }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("modifie une intervention planifiée : date prévue, sans période", async () => {
    const user = userEvent.setup();
    server.use(detail({ status: "planned", periods: [], stoppedAt: null, startedAt: "2026-07-01T08:00:00.000Z" }));
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put("*/interventions/:id", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ intervention: DEMO, warnings: [] });
      }),
    );
    renderApp(`/f/${FARM}/interventions/${DEMO.id}/edit?at=2026-06-30`);
    expect(await screen.findByRole("heading", { name: /Modifier : Pulvérisation/ })).toBeInTheDocument();
    expect(screen.queryByText("Correction tracée")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    expect(await screen.findByText("Intervention modifiée.")).toBeInTheDocument();
    expect(body).toMatchObject({ procedure: "spraying", periods: [], plannedAt: expect.stringMatching(/^2026-07-01/) });
  });
});
