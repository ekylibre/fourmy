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
    { id: WHEAT, name: "Blé tendre", family: "plant_farming", color: "#E8B500", capCode: "BTH", species: "triticum_aestivum", cycle: "annual", legume: false, vegetable: false },
    { id: MAIZE, name: "Maïs", family: "plant_farming", color: "#6A994E", capCode: "MIS", species: "zea_mays", cycle: "annual", legume: false, vegetable: false },
  ],
  // 2026 : blé sur Les Rouffiats ; un blé en 2027 revient au bout d'un an.
  history: { [R!.id]: { "2026": { main: "BTH", secondary: false, label: "Blé tendre" } } },
  previousByActivity: { [WHEAT]: R!.version.areaM2 },
  certification: { abParcels: {}, hve: false, abRotation: { years: 5, sameSpeciesMax: 2 } },
  settings: { bcae7Preferred: "rotation", alsaceRhinePlain: false, returnIntervals: {} },
  refsVersion: "test",
};

/** Serveur de l'assolement en mémoire : création, sauvegarde, aperçu et validation (calculés par le domaine). */
function cropPlanServer() {
  let plan: CropPlanView | null = null;
  const saves: CropPlanDraft[] = [];
  const validations: { dryRun: boolean; body: unknown }[] = [];
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
    http.get("*/crop-plans/2027/context", () => HttpResponse.json(context)),
    http.put("*/crop-plans/2027/draft", async ({ request }) => {
      const body = (await request.json()) as { revision: number; draft: CropPlanDraft };
      if (!plan || body.revision !== plan.revision) return HttpResponse.json({ title: "Conflit" }, { status: 409 });
      saves.push(body.draft);
      plan = { ...plan, draft: body.draft, revision: plan.revision + 1 };
      return HttpResponse.json(plan);
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
  return { saves, validations };
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string, option: string) {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("assolement", () => {
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

  it("préparer 2027, affecter, voir les contrôles, valider", async () => {
    const user = userEvent.setup();
    const { saves, validations } = cropPlanServer();
    renderApp(`/f/${FARM}/crop-plan/2027`);
    await user.click(await screen.findByRole("button", { name: "Préparer l'assolement 2027" }));

    const table = await screen.findByRole("table", { name: "Parcelles de l'assolement" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    await user.click(within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }));
    await choose(user, "Activité", "Blé tendre");
    await user.click(screen.getByRole("button", { name: "Affecter" }));
    const row = within(table).getByRole("checkbox", { name: `Choisir ${R!.name}` }).closest("tr")!;
    const planned = () => row.cells[4]!.textContent;
    expect(planned()).toBe("Blé tendre");
    // Constat de la parcelle choisie : blé sur blé.
    expect(await screen.findByLabelText("Constats des parcelles choisies")).toHaveTextContent(/retour en 1 an, 2 conseillés/);
    // Sauvegarde au fil de l'eau.
    await vi.waitFor(() => expect(saves.at(-1)?.assignments.map((a) => a.activityId)).toEqual([WHEAT]), { timeout: 3000 });
    expect(screen.getByLabelText("Surfaces prévues")).toHaveTextContent(/Blé tendre/);
    expect(screen.getByLabelText("Surfaces prévues")).toHaveTextContent(/sans culture prévue : 1 parcelle/);

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
    await user.click(screen.getByRole("tab", { name: "Affecter" }));
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
  });
});
