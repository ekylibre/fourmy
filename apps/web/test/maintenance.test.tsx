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
  settings: { soonHours: 50, soonMonths: 1 },
  usageNow: 4321,
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
