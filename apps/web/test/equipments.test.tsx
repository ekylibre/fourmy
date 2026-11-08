import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { EquipmentSheet, EquipmentSummary } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Matériels, lot I : liste, relevé rapide (refus puis correction motivée), fiche en onglets. */
const TRACTOR = "0193a000-0000-7000-8000-00000000e001";
const PLOUGH = "0193a000-0000-7000-8000-00000000e002";

const tractor: EquipmentSummary = {
  id: TRACTOR,
  name: "Claas Arion 430",
  kind: "tractor",
  state: "active",
  brand: "CLAAS",
  brandId: null,
  model: "ARION 430",
  serialNumber: "A2108967",
  year: 2012,
  meterUnit: "hours",
  logoAssetId: null,
  logoSource: null,
  lastReading: { readAt: "2026-11-02T08:00:00.000Z", value: 4321, origin: "manual" },
  tracked: true,
};
const plough: EquipmentSummary = { ...tractor, id: PLOUGH, name: "Charrue RB47", kind: "trailed_equipment", brand: null, model: null, serialNumber: null, meterUnit: null, lastReading: null, tracked: false };
const retired: EquipmentSummary = { ...plough, id: "0193a000-0000-7000-8000-00000000e003", name: "Vicon", state: "retired" };

const sheet: EquipmentSheet = {
  ...tractor,
  manufacturerType: "A21",
  commissionedAt: null,
  aggregates: [{ organ: "moteur", designation: "4045HRT83D", serial: "CD4045L210528" }],
  technical: {
    avertissement: "Notice valable à partir de A2111239",
    moteur: { puissance_max: { valeur: 105, unite: "ch", source: { id: "NOT-1445-003", page: 85 }, alternatives: [], note: null } },
  },
  externalIds: { traccar: "12" },
  notes: null,
  brandInfo: null,
  options: [{ id: "0193a000-0000-7000-8000-00000000f001", code: "front_linkage", label: "Relevage avant", from: "2012-01-01T00:00:00.000Z", to: null }],
  readings: [
    { id: "0193a000-0000-7000-8000-00000000a001", equipmentId: TRACTOR, readAt: "2026-10-01T08:00:00.000Z", value: 4300, usage: 4300, status: "valid", origin: "manual", correction: null, correctionReason: null, interventionId: null, authorName: "Pierre", note: null },
    { id: "0193a000-0000-7000-8000-00000000a002", equipmentId: TRACTOR, readAt: "2026-11-02T08:00:00.000Z", value: 4321, usage: 4321, status: "valid", origin: "manual", correction: null, correctionReason: null, interventionId: null, authorName: "Pierre", note: "vidange" },
  ],
  history: [],
  trackers: [{ deviceId: "12", from: "2026-01-01T00:00:00.000Z", to: null }],
};

function useEquipmentApi() {
  server.use(
    http.get("*/equipments", () => HttpResponse.json({ items: [tractor, plough, retired] })),
    http.get("*/equipments/:id/sheet", () => HttpResponse.json(sheet)),
  );
}

describe("matériels", () => {
  it("liste les matériels en service, avec leur dernier relevé", async () => {
    useEquipmentApi();
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/equipments`);
    const table = await screen.findByRole("table", { name: "Matériels" });
    expect(within(table).getByRole("link", { name: "Claas Arion 430" })).toBeInTheDocument();
    expect(within(table).getByText(/4\s321 h/)).toBeInTheDocument();
    expect(within(table).getByText("Sans compteur")).toBeInTheDocument();
    expect(within(table).queryByText("Vicon")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Tous" }));
    expect(within(table).getByText("Vicon")).toBeInTheDocument();
  });

  it("relevé refusé sous le précédent, puis accepté comme correction motivée", async () => {
    useEquipmentApi();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("*/equipments/:id/readings", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        if (!body.correction) {
          return HttpResponse.json({ title: "Conflit", status: 409, detail: "Valeur inférieure au relevé du 02/11/2026 (4 321 h)." }, { status: 409 });
        }
        return HttpResponse.json({ reading: { ...sheet.readings[1], value: 12 }, warning: null }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/equipments`);
    await user.click(await screen.findByRole("button", { name: "Relevé de Claas Arion 430" }));
    const dialog = await screen.findByRole("dialog", { name: /Relevé du compteur/ });
    expect(within(dialog).getByText(/Dernier relevé/)).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Heures moteur" }), "12");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText(/Valeur inférieure/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "C'est une correction" }));
    await user.click(within(dialog).getByRole("radio", { name: "Compteur remplacé" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Motif" }), "compteur neuf");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText(/Relevé enregistré/)).toBeInTheDocument();
    expect(bodies[1]).toMatchObject({ value: 12, correction: "replacement", correctionReason: "compteur neuf" });
  });

  it("fiche en onglets : identité, valeurs techniques sourcées, relevés", async () => {
    useEquipmentApi();
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/equipments/${TRACTOR}`);
    expect(await screen.findByRole("heading", { name: "Claas Arion 430" })).toBeInTheDocument();
    const identity = screen.getByRole("table", { name: "Identité" });
    expect(within(identity).getByText("A2108967")).toBeInTheDocument();
    expect(screen.getByText("Relevage avant")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Technique" }));
    expect(await screen.findByText("Notice valable à partir de A2111239")).toBeInTheDocument();
    expect(screen.getByText("105 ch")).toBeInTheDocument();
    expect(screen.getByText("NOT-1445-003 p. 85")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Relevés (2)" }));
    const readings = await screen.findByRole("table", { name: "Relevés" });
    expect(within(readings).getByText("vidange")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Heures d'usage/ })).toBeInTheDocument();
  });
});
