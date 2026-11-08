import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { EquipmentMaintenance, EquipmentSheet, FarmDueItem } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";
import { readBundle } from "../src/features/imports/EquipmentBundleImport";

/** Entretien, lot J : onglet Entretien (échéances, dernière fois connue), tableau de bord, lecture d'un dossier. */
const EQ = "0193a000-0000-7000-8000-00000000e001";
const op = (id: string, label: string, due: Partial<EquipmentMaintenance["operations"][number]["due"]>, extra: Partial<EquipmentMaintenance["operations"][number]> = {}) => ({
  id,
  code: id,
  label,
  kind: "replacement" as const,
  everyHours: 500,
  everyMonths: 12,
  firstHours: null,
  performer: "member" as const,
  requiresOption: null,
  condition: null,
  source: { id: "NOT-1445-003", page: 330 },
  baselineAt: null,
  baselineHours: null,
  archivedAt: null,
  archivedReason: null,
  fromModel: true,
  parts: [],
  ...extra,
  due: { operationId: id, status: "unknown" as const, last: null, nextUsage: null, nextDate: null, remainingHours: null, remainingDays: null, usageNow: 4321, reason: "Dernière réalisation à renseigner.", ...due },
});
const maintenance: EquipmentMaintenance = {
  equipmentId: EQ,
  at: "2026-11-08T12:00:00.000Z",
  settings: { soonHours: 50, soonMonths: 1, notify: [] },
  usageNow: 4321,
  usageEstimated: true,
  model: { id: "0193a000-0000-7000-8000-0000000000m1".replace("m", "a"), label: "CLAAS ARION 430", warning: "Notice valable à partir de A2111239", sources: [] },
  operations: [
    op("0193a000-0000-7000-8000-00000000c001", "Échange de l'huile moteur", { status: "soon", nextUsage: 4350, remainingHours: 29, nextDate: "2027-03-01T00:00:00.000Z", remainingDays: 113, last: { at: "2026-03-01T00:00:00.000Z", usage: 3850, source: "baseline" }, reason: null }, { parts: [{ articleId: "0193a000-0000-7000-8000-00000000d001", name: "Filtre à huile", reference: "60 0502 874 3", quantity: 1, unit: "Unité" }] }),
    op("0193a000-0000-7000-8000-00000000c002", "Échange des filtres à carburant", {}),
    op("0193a000-0000-7000-8000-00000000c003", "Huile du boîtier de prise de force avant", { status: "not_applicable", reason: "Option absente d'usine : prise de force avant." }, { archivedAt: "2026-11-08T00:00:00.000Z", archivedReason: "Option absente d'usine : prise de force avant." }),
  ],
  fluids: [{ id: "0193a000-0000-7000-8000-00000000f001", organ: "moteur", fluid: "CLAAS AGRIMOT SDX", standard: "ACEA E6/E7", viscosity: "15W40", capacity: "10 – 12,5", capacityMaxL: 12.5, note: "min/max", source: { id: "NOT-1445-003", page: 112 } }],
  parts: [],
};
const sheet = {
  id: EQ,
  name: "Claas Arion 430",
  kind: "tractor",
  state: "active",
  brand: "CLAAS",
  brandId: null,
  model: "ARION 430",
  serialNumber: "A2108967",
  year: null,
  meterUnit: "hours",
  logoAssetId: null,
  logoSource: null,
  lastReading: { readAt: "2026-11-02T08:00:00.000Z", value: 4321, origin: "manual" },
  tracked: false,
  due: { overdue: 0, soon: 1, unknown: 1 },
  manufacturerType: "A21",
  commissionedAt: null,
  aggregates: [],
  technical: null,
  externalIds: {},
  notes: null,
  brandInfo: null,
  options: [],
  readings: [],
  history: [],
  trackers: [],
} satisfies EquipmentSheet;

describe("entretien", () => {
  it("onglet Entretien : à faire, pièces et sources, dernière fois connue", async () => {
    let baseline: unknown = null;
    server.use(
      http.get("*/equipments/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/equipments/:id/maintenance", () => HttpResponse.json(maintenance)),
      http.put("*/plan-operations/:id/baseline", async ({ request }) => {
        baseline = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/equipments/${EQ}?tab=maintenance`);
    const plan = await screen.findByRole("table", { name: "Plan d'entretien" });
    expect(screen.getByRole("tab", { name: "Entretien (1)" })).toBeInTheDocument();
    expect(screen.getByText("Notice valable à partir de A2111239")).toBeInTheDocument();
    expect(screen.getByText(/Compteur : ≈ 4\s321 h .* \(estimé avec Traccar\)/)).toBeInTheDocument();
    expect(within(plan).getByText(/dans 29 h ou le 01\/03\/2027/)).toBeInTheDocument();
    expect(within(plan).getByText(/Pièces : 60 0502 874 3/)).toBeInTheDocument();
    expect(within(plan).getAllByText(/Remplacement · NOT-1445-003 p. 330/)).toHaveLength(2);
    expect(within(plan).queryByText("Huile du boîtier de prise de force avant")).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Fluides préconisés" })).toHaveTextContent("CLAAS AGRIMOT SDX");
    await user.click(within(plan).getByRole("button", { name: "Dernière fois : Échange des filtres à carburant" }));
    const dialog = await screen.findByRole("dialog", { name: /Dernière fois/ });
    await user.type(within(dialog).getByLabelText(/^Date/), "2026-04-15");
    await user.type(within(dialog).getByRole("textbox", { name: "Heures au compteur" }), "3900");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Dernière réalisation enregistrée.")).toBeInTheDocument();
    expect(baseline).toMatchObject({ hours: 3900 });
    await user.click(screen.getByRole("radio", { name: /Non applicables/ }));
    expect(await within(plan).findByText("Huile du boîtier de prise de force avant")).toBeInTheDocument();
  });

  it("tableau de bord de l'entretien : en retard et bientôt, matériels à renseigner", async () => {
    const items: FarmDueItem[] = [
      { equipmentId: EQ, equipmentName: "Claas Arion 430", equipmentKind: "tractor", operationId: maintenance.operations[0]!.id, label: "Échange de l'huile moteur", kind: "replacement", performer: "member", due: maintenance.operations[0]!.due },
    ];
    server.use(
      http.get("*/maintenance/due", () => HttpResponse.json({ items, byEquipment: { [EQ]: { overdue: 0, soon: 1, unknown: 40 } } })),
      http.get("*/equipments", () => HttpResponse.json({ items: [sheet] })),
      http.get("*/settings/maintenance", () => HttpResponse.json({ soonHours: 50, soonMonths: 1 })),
    );
    renderApp(`/f/${FARM}/maintenance`);
    const table = await screen.findByRole("table", { name: "Échéances d'entretien" });
    expect(within(table).getByText("Échange de l'huile moteur")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Claas Arion 430" })).toHaveAttribute("href", expect.stringContaining("tab=maintenance"));
    expect(await screen.findByText(/40 opération\(s\)/)).toBeInTheDocument();
  });

  it("lit seulement les fichiers utiles d'un dossier", async () => {
    const f = (path: string, text: string) => Object.defineProperty(new File([text], path.split("/").pop()!), "webkitRelativePath", { value: path });
    const files = await readBundle([f("Arion/machine.json", "{}"), f("Arion/entretien/plan_entretien.json", "[]"), f("Arion/notice.pdf", "%PDF")]);
    expect(Object.keys(files).sort()).toEqual(["entretien/plan_entretien.json", "machine.json"]);
  });
});

describe("intervention d'entretien (lot K)", () => {
  const TRACTOR = "00000000-0000-7000-8000-000000000101"; // matériel de démonstration
  const OIL = "0193a000-0000-7000-8000-00000000c101";
  const BRAKES = "0193a000-0000-7000-8000-00000000c102";
  const PART = "00000000-0000-7000-8000-000000000301"; // article de démonstration servant de pièce

  it("depuis une échéance : opération cochée, pièce ajoutée, compteur, contrôle avec anomalie", async () => {
    const plan: EquipmentMaintenance = {
      ...maintenance,
      equipmentId: TRACTOR,
      model: null,
      operations: [
        op(OIL, "Échange de l'huile moteur", { status: "overdue", remainingHours: -12 }, { parts: [{ articleId: PART, name: "Filtre", reference: "60 0502 874 3", quantity: 1, unit: "Unité" }] }),
        op(BRAKES, "Contrôle des freins", { status: "soon", remainingHours: 20 }, { kind: "inspection" }),
      ],
    };
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    server.use(
      http.get("*/equipments/:id/maintenance", () => HttpResponse.json(plan)),
      http.post("*/interventions", async ({ request }) => {
        calls.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ id: "0193a000-0000-7000-8000-00000000aaaa" }, { status: 201 });
      }),
      http.post("*/interventions/:id/complete", async ({ request }) => {
        calls.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ intervention: { id: "0193a000-0000-7000-8000-00000000aaaa" }, movements: [], warnings: [] });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/interventions/new?procedure=equipment_maintenance&equipment=${TRACTOR}&operations=${OIL}&status=done&at=2026-06-10`);
    const card = await screen.findByLabelText("Entretien de Tracteur Claas Arion 430");
    expect(await within(card).findByRole("checkbox", { name: "Échange de l'huile moteur" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Préventif (plan)" })).toBeChecked();
    // Le contrôle des freins : coché, résultat « anomalie » avec une note.
    await user.click(within(card).getByRole("checkbox", { name: "Contrôle des freins" }));
    await user.click(within(card).getByRole("radio", { name: "Anomalie" }));
    await user.type(within(card).getByRole("textbox", { name: "Anomalie : Contrôle des freins" }), "plaquettes usées");
    await user.type(within(card).getByRole("textbox", { name: "Compteur de Tracteur Claas Arion 430" }), "4330");
    await user.type(screen.getByRole("textbox", { name: "Atelier externe" }), "Garage du Lot");
    // La vidange, cochée par l'adresse, a apporté sa pièce dans les intrants (une seule fois).
    expect(screen.getAllByRole("combobox", { name: "Produit" })).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Matériels" })).not.toBeInTheDocument(); // pas d'outils pour un entretien
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body).toMatchObject({
      targets: [{ kind: "equipment", id: TRACTOR, meter: { value: 4330 } }],
      inputs: [{ articleId: PART, quantity: 1, per: "total", equipmentId: TRACTOR }],
      tools: [],
      maintenance: {
        nature: "preventive",
        workshop: { name: "Garage du Lot", reference: null },
        operations: [
          { equipmentId: TRACTOR, operationId: OIL, result: "done" },
          { equipmentId: TRACTOR, operationId: BRAKES, result: "anomaly", note: "plaquettes usées" },
        ],
      },
    });
  });

  it("réparation : le problème est exigé avant l'envoi", async () => {
    server.use(http.get("*/equipments/:id/maintenance", () => HttpResponse.json({ ...maintenance, equipmentId: TRACTOR, operations: [], model: null })));
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/interventions/new?procedure=equipment_maintenance&equipment=${TRACTOR}&nature=corrective&status=done&at=2026-06-10`);
    await screen.findByLabelText("Entretien de Tracteur Claas Arion 430");
    expect(screen.getByRole("radio", { name: "Curatif (panne, réparation)" })).toBeChecked();
    // Champ obligatoire : le navigateur bloque l'envoi tant qu'il est vide.
    const problem = screen.getByRole("textbox", { name: /Problème constaté/ });
    expect(problem).toBeRequired();
    let sent = false;
    server.use(http.post("*/interventions", () => ((sent = true), HttpResponse.json({}, { status: 201 }))));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(sent).toBe(false);
  });

  it("fiche : bloc entretien et réparation à planifier depuis une anomalie", async () => {
    const { demoInterventions } = await import("@fourmy/mocks");
    const base = demoInterventions[0]!;
    const i = {
      ...base,
      procedure: "equipment_maintenance",
      targets: [{ kind: "equipment", id: TRACTOR, meter: { value: 4330 } }],
      inputs: [],
      outputs: [],
      compliance: null,
      maintenance: {
        nature: "preventive",
        problem: null,
        workshop: { name: "Garage du Lot", reference: "BL-42" },
        operations: [{ equipmentId: TRACTOR, operationId: BRAKES, label: "Contrôle des freins", kind: "inspection", result: "anomaly", note: "plaquettes usées" }],
      },
      history: [],
    };
    server.use(http.get(`*/interventions/${base.id}`, () => HttpResponse.json(i)));
    renderApp(`/f/${FARM}/interventions/${base.id}?at=2026-06-10`);
    const block = await screen.findByLabelText("Entretien");
    expect(within(block).getByText(/Garage du Lot/)).toHaveTextContent("Garage du Lot (bon BL-42)");
    expect(within(block).getByText(/4\s330 h/)).toBeInTheDocument();
    const link = within(block).getByRole("link", { name: "Planifier une réparation" });
    expect(link.getAttribute("href")).toContain("nature=corrective");
    expect(decodeURIComponent(link.getAttribute("href")!.replace(/\+/g, " "))).toContain("Contrôle des freins : plaquettes usées");
  });
});

describe("pièces à commander (lot L)", () => {
  it("horizon en heures ou en mois, stock et quantité à commander", async () => {
    const queries: string[] = [];
    server.use(
      http.get("*/maintenance/parts", ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({
          at: "2026-11-08T12:00:00.000Z",
          horizon: { hours: 200, months: null },
          items: [
            { articleId: "0193a000-0000-7000-8000-00000000d001", name: "Filtre à huile CLAAS 60 0502 874 3", reference: "60 0502 874 3", family: "filtre_huile_moteur", unit: "Unité", needed: 2, inStock: 1, toOrder: 1, operations: ["Échange de l'huile moteur"], equipments: ["Claas Arion 430"] },
          ],
        });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/maintenance/parts`);
    const table = await screen.findByRole("table", { name: "Pièces à commander" });
    expect(within(table).getByText("60 0502 874 3")).toBeInTheDocument();
    expect(within(table).getByText("Claas Arion 430")).toBeInTheDocument();
    expect(queries[0]).toContain("hours=200");
    await user.click(screen.getByRole("radio", { name: "6 mois" }));
    await vi.waitFor(() => expect(queries.at(-1)).toContain("months=6"));
  });
});
