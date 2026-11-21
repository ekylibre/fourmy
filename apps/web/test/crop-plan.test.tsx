import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { CropPlanContext, CropPlanDraft, CropPlanValidation, CropPlanView } from "@fourmy/contracts";
import { checkCropPlan, cropPlanCheckInput, diffCropPlan, emptyDraft, resolveParcels } from "@fourmy/domain";
import { demoLandParcelsAt } from "@fourmy/mocks";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Écran d'assolement (lot AS2b) : préparer, affecter, contrôles en direct, valider. */

const WHEAT = "00000000-0000-7000-8000-0000000000c1";
const MAIZE = "00000000-0000-7000-8000-0000000000c2";
const [R, G] = demoLandParcelsAt;

const context: CropPlanContext = {
  year: 2027,
  parcels: demoLandParcelsAt.map((p) => ({ id: p.id, name: p.name, areaM2: p.version.areaM2, shape: p.version.shape, validFrom: "2020-01-01", lastStoppedOn: "2026-07-20" })),
  activities: [
    { id: WHEAT, name: "Blé tendre", family: "plant_farming", color: "#E8B500", capCode: "BTH", species: "triticum_aestivum", cycle: "annual", legume: false, vegetable: false, pictureUrl: null, defaultStartedOn: "2026-10-01", defaultStoppedOn: "2027-08-31" },
    { id: MAIZE, name: "Maïs", family: "plant_farming", color: "#6A994E", capCode: "MIS", species: "zea_mays", cycle: "annual", legume: false, vegetable: false, pictureUrl: null, defaultStartedOn: null, defaultStoppedOn: null },
  ],
  // 2026 : blé sur Les Rouffiats ; un blé en 2027 revient au bout d'un an.
  history: { [R!.id]: { "2026": { main: "BTH", secondary: false, label: "Blé tendre" } } },
  previousByActivity: { [WHEAT]: R!.version.areaM2 },
  zones: {},
  certification: { abParcels: {}, hve: false, abRotation: { years: 5, sameSpeciesMax: 2 } },
  settings: { bcae7Preferred: "rotation", alsaceRhinePlain: false, returnIntervals: {} },
  refsVersion: "test",
};

/** Serveur de l'assolement en mémoire : création, sauvegarde, aperçu et validation (calculés par le domaine). */
function cropPlanServer(ctx: CropPlanContext = context) {
  let plan: CropPlanView | null = null;
  const saves: CropPlanDraft[] = [];
  const validations: { dryRun: boolean; body: unknown }[] = [];
  const settingsSaved: Record<string, unknown>[] = [];
  const result = (draft: CropPlanDraft, dryRun: boolean): CropPlanValidation => {
    const { changes, blockers } = diffCropPlan(draft, resolveParcels(context.parcels, draft), [], { campaignExists: false });
    return { dryRun, changes, blockers, sections: checkCropPlan(cropPlanCheckInput(context, draft)).sections, version: dryRun || blockers.length ? null : 1 };
  };
  server.use(
    http.get("*/crop-plans", () => HttpResponse.json(plan ? [{ year: 2027, status: plan.status, currentVersion: plan.currentVersion, updatedAt: plan.updatedAt }] : [])),
    http.get("*/crop-plans/2027", () => (plan ? HttpResponse.json(plan) : HttpResponse.json({ title: "Introuvable" }, { status: 404 }))),
    http.post("*/crop-plans/2027", () => {
      plan = { year: 2027, status: "draft", revision: 0, draft: emptyDraft(2027), currentVersion: null, versions: [], updatedAt: "2026-11-20T10:00:00Z" };
      return HttpResponse.json(plan, { status: 201 });
    }),
    http.get("*/crop-plans/2027/context", () => HttpResponse.json(ctx)),
    http.put("*/crop-plans/2027/draft", async ({ request }) => {
      const body = (await request.json()) as { revision: number; draft: CropPlanDraft };
      if (!plan || body.revision !== plan.revision) return HttpResponse.json({ title: "Conflit" }, { status: 409 });
      saves.push(body.draft);
      plan = { ...plan, draft: body.draft, revision: plan.revision + 1 };
      return HttpResponse.json(plan);
    }),
    http.put("*/settings/crop-plan", async ({ request }) => {
      settingsSaved.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(settingsSaved.at(-1));
    }),
    http.post("*/crop-plans/2027/validate", async ({ request }) => {
      const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
      const body = await request.json();
      validations.push({ dryRun, body });
      const r = result(plan!.draft, dryRun);
      if (r.version) plan = { ...plan!, status: "validated", currentVersion: 1, revision: plan!.revision + 1, versions: [{ version: 1, validatedAt: "2026-11-20T10:05:00Z", validatedBy: null, reason: null }] };
      return HttpResponse.json(r);
    }),
  );
  return { saves, validations, settingsSaved };
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string, option: string) {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("assolement", () => {
  it("brouillon en plein écran ; « Quitter » revient à la vue classique, « Reprendre » y retourne ; la validation en sort", async () => {
    const user = userEvent.setup();
    cropPlanServer();
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));
    const workspace = await screen.findByRole("region", { name: "Assolement 2027 en plein écran" });
    expect(within(workspace).getByRole("heading", { name: "Assolement 2027", level: 1 })).toBeInTheDocument();
    // Pas de feuille d'affectation tant qu'aucune parcelle n'est choisie.
    expect(screen.queryByLabelText("Affecter une culture")).not.toBeInTheDocument();
    // Panneau repliable.
    await user.click(within(workspace).getByRole("button", { name: "Replier le panneau" }));
    expect(within(workspace).queryByRole("table", { name: "Parcelles de l'assolement" })).not.toBeInTheDocument();
    await user.click(within(workspace).getByRole("button", { name: "Déplier le panneau" }));
    await user.click(within(workspace).getByRole("button", { name: "Quitter" }));
    expect(screen.queryByRole("region", { name: "Assolement 2027 en plein écran" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reprendre en plein écran" }));
    expect(await screen.findByRole("region", { name: "Assolement 2027 en plein écran" })).toBeInTheDocument();
  });

  it("campagne déjà saisie sans assolement : cultures affichées, « Modifier l'assolement »", async () => {
    const user = userEvent.setup();
    cropPlanServer();
    const current: CropPlanView = {
      year: 2027,
      status: "current",
      revision: 0,
      draft: { ...emptyDraft(2027), assignments: [{ id: "p1", key: `p:${R!.id}`, role: "main", activityId: MAIZE, startedOn: null, stoppedOn: null, productionId: "00000000-0000-7000-8000-0000000000d1" }] },
      currentVersion: null,
      versions: [],
      updatedAt: "2026-11-20T10:00:00Z",
    };
    server.use(http.get("*/crop-plans/2027", () => HttpResponse.json(current)));
    renderApp(`/f/${FARM}/crop-plan/2027`);
    expect(await screen.findByText("Cultures 2027 déjà saisies")).toBeInTheDocument();
    expect(screen.getByText("cultures saisies")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    expect(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }).closest("tr")!.cells[4]!.textContent).toBe("Maïs");
    expect(screen.queryByRole("button", { name: "Valider…" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Affecter une culture")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Modifier l'assolement 2027" }));
    expect(await screen.findByRole("button", { name: "Valider…" })).toBeInTheDocument();
  });

  it("filtre « Sans culture prévue » : la liste ne garde que ces parcelles", async () => {
    const user = userEvent.setup();
    cropPlanServer();
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));
    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }));
    await choose(user, "Activité", "Maïs");
    await user.click(screen.getByRole("button", { name: "Affecter" }));
    await user.click(screen.getByText(/^Sans culture prévue \(/));
    expect(within(table).queryByRole("checkbox", { name: `Choisir ${R!.name}` })).not.toBeInTheDocument();
    expect(within(table).getByRole("checkbox", { name: `Choisir ${G!.name}` })).toBeInTheDocument();
  });

  it("prévisions : défauts affichés avec leur source, rendement saisi enregistré avec l'affectation", async () => {
    const user = userEvent.setup();
    const { saves } = cropPlanServer();
    server.use(
      http.get("*/crop-plans/2027/eco-context", () =>
        HttpResponse.json({
          year: 2027,
          department: "64",
          labour: null,
          activities: [
            {
              activityId: WHEAT,
              production: "winter_common_wheat",
              specie: "triticum_aestivum",
              farmYields: [],
              agreste: [],
              suggestions: [],
              farmPrice: null,
              yield: { value: 68, unit: "quintal_per_hectare", source: "agreste", label: "médiane Agreste 64 2023-2025" },
              price: { value: 196.37, unit: "ton", source: "lexicon", label: "Milling wheat La Pallice, avr. 2026", date: "2026-04-27" },
            },
          ],
        }),
      ),
    );
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));
    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }));
    await choose(user, "Activité", "Blé tendre");
    expect(await screen.findByText("Par défaut : médiane Agreste 64 2023-2025")).toBeInTheDocument();
    expect(screen.getByText("Par défaut : Milling wheat La Pallice, avr. 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Rendement prévu (q/ha)")).toHaveAttribute("placeholder", "68");
    await user.type(screen.getByLabelText("Rendement prévu (q/ha)"), "75,5");
    await user.click(screen.getByRole("button", { name: "Affecter" }));
    await vi.waitFor(
      () => expect(saves.at(-1)?.assignments.map((a) => a.forecasts)).toEqual([[{ product: "principal", unit: "quintal_per_hectare", priceUnit: "ton", yield: 75.5 }]]),
      { timeout: 3000 },
    );
  });

  it("onglet Économie : marges par activité à l'hectare, culture sans itinéraire signalée, écart avec le réalisé 2026", async () => {
    const user = userEvent.setup();
    cropPlanServer();
    server.use(
      http.get("*/crop-plans/2027/itk-context", () =>
        HttpResponse.json({
          year: 2027,
          itineraries: {},
          equipments: [],
          people: [],
          crewTemplates: {},
          observed: [],
          machineryRates: {},
          familyPerMeter: {},
          routes: {},
          site: null,
          settings: { workdayHours: 8, weeklyHoursPerPerson: 45, defaultSiteId: null },
          rateSource: "test",
        }),
      ),
      http.get("*/crop-plans/2027/inputs-context", () => HttpResponse.json({ year: 2027, at: "2026-11-21", articles: {}, stock: {}, reserved: {}, plans: {} })),
      // Réalisé 2026 : 60 q/ha récoltés, valorisés au prix par défaut ; aucune intervention.
      http.get("*/crop-plans/2027/eco-previous", () =>
        HttpResponse.json({ year: 2026, productions: [{ productionId: "pr", activityId: WHEAT, areaHa: 2, yieldQHa: 60 }], works: [], articles: {} }),
      ),
      http.get("*/crop-plans/2027/eco-context", () =>
        HttpResponse.json({
          year: 2027,
          department: "44",
          labour: null,
          activities: [
            {
              activityId: WHEAT,
              production: "winter_common_wheat",
              specie: "triticum_aestivum",
              farmYields: [],
              agreste: [],
              suggestions: [],
              farmPrice: null,
              yield: { value: 68, unit: "quintal_per_hectare", source: "agreste", label: "médiane Agreste 44 2023-2025" },
              price: { value: 196.37, unit: "ton", source: "lexicon", label: "Milling wheat La Pallice, avr. 2026" },
            },
          ],
        }),
      ),
    );
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));
    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }));
    await choose(user, "Activité", "Blé tendre");
    await user.click(screen.getByRole("button", { name: "Affecter" }));
    await user.click(screen.getByRole("tab", { name: "Économie" }));
    const margins = await screen.findByRole("table", { name: "Marges par activité" }, { timeout: 10_000 });
    const wheat = within(margins).getByText("Blé tendre").closest("tr")!;
    // 68 q/ha × 19,637 €/q = 1 335 €/ha ; sans itinéraire, la marge directe vaut le produit.
    expect(wheat.cells[2]!.textContent).toMatch(/^1\s?335\s€$/);
    expect(wheat.cells[7]!.textContent).toMatch(/^1\s?335\s€$/);
    expect(screen.getByText(/1 culture\(s\) sans itinéraire technique/)).toBeInTheDocument();
    // 60 × 19,637 = 1 178 €/ha en 2026 ; écart + 157 €/ha.
    expect(within(margins).getByText("Marge directe 2026")).toBeInTheDocument();
    expect(wheat.cells[8]!.textContent).toMatch(/^1\s?178\s€$/);
    expect(wheat.cells[9]!.textContent).toMatch(/^\+157\s€$/);
    expect(screen.getByText(/^Réalisé 2026 : marge directe/)).toBeInTheDocument();
    expect(screen.queryByLabelText("À compléter")).not.toBeInTheDocument();
  });

  it("Activités : le menu Assolement propose la campagne et la suivante", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/activities?at=2026-06-10`);
    await user.click(await screen.findByRole("button", { name: "Assolement" }));
    expect(await screen.findByRole("menuitem", { name: "Préparer l'assolement 2026" })).toHaveAttribute("href", `/f/${FARM}/crop-plan/2026`);
    expect(screen.getByRole("menuitem", { name: "Préparer l'assolement 2027" })).toBeInTheDocument();
  });

  it("fusion de parcelles qui ne se touchent pas : refusée, rien ne change ; découpe d'une seule parcelle", async () => {
    const user = userEvent.setup();
    cropPlanServer();
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));
    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    expect(screen.getByRole("button", { name: "Découper" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fusionner" })).toBeDisabled();
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }));
    expect(screen.getByRole("button", { name: "Découper" })).toBeEnabled();
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${G!.name}` }));
    expect(screen.getByRole("button", { name: "Découper" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Fusionner" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ne se touchent pas");
    expect(screen.queryByLabelText("Découpes et fusions")).not.toBeInTheDocument();
    // Découper : consigne de tracé, puis abandon.
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${G!.name}` }));
    await user.click(screen.getByRole("button", { name: "Découper" }));
    expect(screen.getByText(/Tracez une ligne qui commence et finit hors de la parcelle/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Annuler la découpe" }));
    expect(screen.getByRole("button", { name: "Découper" })).toBeInTheDocument();
  });

  it("couvert d'interculture et réglages de l'assolement", async () => {
    const user = userEvent.setup();
    const { saves, settingsSaved } = cropPlanServer();
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));
    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }));
    await user.click(screen.getByRole("button", { name: "Dérobée, couvert…" }));
    const cover = screen.getByLabelText("Couvert d'interculture");
    expect(within(cover).getByRole("button", { name: "Ajouter le couvert" })).toBeDisabled();
    await user.click(within(cover).getByRole("combobox", { name: "Famille" }));
    await user.click(await screen.findByRole("option", { name: /Crucifères/ }));
    await user.type(within(cover).getByRole("textbox", { name: "Espèces" }), "moutarde");
    await user.type(within(cover).getByLabelText("Semis"), "2027-08-20");
    await user.click(within(cover).getByRole("button", { name: "Ajouter le couvert" }));
    const row = within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }).closest("tr")!;
    expect(row.cells[4]!.textContent).toBe("— + couvert moutarde");
    await vi.waitFor(() => expect(saves.at(-1)?.covers).toEqual([expect.objectContaining({ key: `p:${R!.id}`, kind: "sown", family: "cruciferes", species: "moutarde", sownOn: "2027-08-20", destroyedOn: null })]), { timeout: 3000 });

    await user.click(screen.getByRole("tab", { name: "Réglages" }));
    await user.type(screen.getByRole("spinbutton", { name: "Délai de retour : Blé" }), "3");
    await user.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await vi.waitFor(() => expect(settingsSaved).toEqual([{ bcae7Preferred: "rotation", alsaceRhinePlain: false, returnIntervals: { ble: 3 } }]));
  });

  it("parcelle de l'an passé reprise : repère, « Ne pas reconduire », « Les reconduire »", async () => {
    const user = userEvent.setup();
    const carried: CropPlanContext = {
      ...context,
      parcels: context.parcels.map((p) => (p.id === G!.id ? { ...p, name: "Grande", carryOver: true, sourceName: "Grande Maïs 2026" } : p)),
    };
    const { saves } = cropPlanServer(carried);
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));
    expect(await screen.findByText("Parcellaire 2026 repris")).toBeInTheDocument();
    // Le message se ferme, et reste fermé pour cette campagne.
    await user.click(screen.getByRole("button", { name: "Fermer le message" }));
    expect(screen.queryByText("Parcellaire 2026 repris")).not.toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    expect(within(table).getByText("reprise de 2026").closest("[title]")).toHaveAttribute("title", "Parcelle 2026 : Grande Maïs 2026");
    await user.click(within(table).getByRole("checkbox", { name: "Choisir Grande" }));
    await user.click(screen.getByRole("button", { name: "Ne pas reconduire" }));
    expect(within(table).queryByRole("checkbox", { name: "Choisir Grande" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Parcelles non reconduites")).toHaveTextContent("Non reconduites de 2026 : Grande");
    await vi.waitFor(() => expect(saves.at(-1)?.excluded).toEqual([`p:${G!.id}`]), { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Les reconduire" }));
    expect(within(table).getByRole("checkbox", { name: "Choisir Grande" })).toBeInTheDocument();
  });

  it("préparer 2027, affecter, voir les contrôles, valider", async () => {
    const user = userEvent.setup();
    const { saves, validations } = cropPlanServer();
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));

    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }));
    await choose(user, "Activité", "Blé tendre");
    // Dates types de Lexicon pré-remplies.
    expect(screen.getByLabelText("Semis (prévu)")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Récolte (prévue)")).toHaveValue("2027-08-31");
    await user.click(screen.getByRole("button", { name: "Affecter" }));
    const row = within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }).closest("tr")!;
    const planned = () => row.cells[4]!.textContent;
    expect(planned()).toBe("Blé tendre");
    // Sélection vidée après l'affectation (la parcelle prend sa couleur sur la carte).
    expect(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` })).not.toBeChecked();
    // Constat de la parcelle, de nouveau choisie : blé sur blé.
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }));
    expect(await screen.findByLabelText("Constats des parcelles choisies")).toHaveTextContent(/retour en 1 an, 2 conseillés/);
    // Sauvegarde au fil de l'eau, avec les dates.
    await vi.waitFor(() => expect(saves.at(-1)?.assignments.map((a) => [a.activityId, a.startedOn, a.stoppedOn])).toEqual([[WHEAT, "2026-10-01", "2027-08-31"]]), { timeout: 3000 });
    // Légende de la carte.
    expect(screen.getByLabelText("Légende de la carte")).toHaveTextContent(/Blé tendre/);
    expect(screen.getByLabelText("Légende de la carte")).toHaveTextContent(/Sans culture prévue : 1/);
    expect(screen.queryByLabelText("Surfaces prévues")).not.toBeInTheDocument();

    // Annuler puis rétablir.
    await user.click(screen.getByRole("button", { name: "Annuler le dernier geste" }));
    expect(planned()).toBe("—");
    await user.click(screen.getByRole("button", { name: "Rétablir" }));
    expect(planned()).toBe("Blé tendre");

    // Onglet Contrôles : sections PAC et Agronomie.
    await user.click(screen.getByRole("tab", { name: /Contrôles/ }));
    expect(screen.getByLabelText("Contrôles Agronomie")).toHaveTextContent(/blé en 2027, déjà en 2026/);
    expect(screen.getByLabelText("Contrôles PAC")).toBeInTheDocument();

    // Valider : une parcelle sans culture bloque.
    await user.click(screen.getByRole("button", { name: "Valider…" }));
    const modal = await screen.findByRole("dialog", { name: "Valider l'assolement 2027" });
    expect(await within(modal).findByText(/1 parcelle\(s\) sans culture prévue : Grande pièce/)).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "Valider l'assolement" })).toBeDisabled();
    // « Voir » ramène sur la parcelle en cause, choisie.
    await user.click(within(modal).getByRole("button", { name: "Voir" }));
    await user.click(screen.getByRole("tab", { name: "Parcelles" }));
    expect(screen.getByRole("checkbox", { name: `Choisir ${G!.name}` })).toBeChecked();
    // La sélection est remplacée par la parcelle en cause.
    expect(screen.getByRole("checkbox", { name: `Choisir ${R!.name}` })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Sans culture" }));

    await user.click(screen.getByRole("button", { name: "Valider…" }));
    const modal2 = await screen.findByRole("dialog", { name: "Valider l'assolement 2027" });
    expect(await within(modal2).findByLabelText("Changements")).toHaveTextContent(`${R!.name} : Blé tendre`);
    await user.click(within(modal2).getByRole("button", { name: "Valider l'assolement" }));
    expect(await screen.findByText("Assolement 2027 validé (version 1).")).toBeInTheDocument();
    expect(validations.filter((v) => !v.dryRun)).toHaveLength(1);
    expect(saves.at(-1)!.fallow).toEqual([{ key: `p:${G!.id}`, capCode: "JAC" }]);
    expect(await screen.findByText(/validé · version 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument();
    // Validé : retour à l'interface classique.
    expect(screen.queryByRole("region", { name: "Assolement 2027 en plein écran" })).not.toBeInTheDocument();
  });
});
