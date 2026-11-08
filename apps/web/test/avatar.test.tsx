import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { AvatarInfo, EquipmentSheet } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Lot M : onglet 3D (provenance des valeurs, réglage enregistré). L'aperçu Cesium n'est pas rendu sous jsdom. */
vi.mock("../src/3d/AvatarPreview", () => ({ default: () => <div aria-label="Aperçu 3D" /> }));

const EQ = "0193a000-0000-7000-8000-00000000e001";
const sheet = {
  id: EQ,
  name: "Claas Arion 430",
  kind: "tractor",
  state: "active",
  brand: "CLAAS",
  brandId: null,
  model: "ARION 430",
  serialNumber: null,
  year: null,
  meterUnit: "hours",
  logoAssetId: null,
  logoSource: null,
  lastReading: null,
  tracked: false,
  manufacturerType: null,
  commissionedAt: null,
  aggregates: [],
  technical: { dimensions: { longueur: { valeur: 4895, unite: "mm" } } },
  externalIds: {},
  notes: null,
  brandInfo: null,
  options: [],
  readings: [],
  history: [],
  trackers: [],
} satisfies EquipmentSheet;

describe("avatar 3D", () => {
  it("montre la provenance de chaque valeur et n'enregistre que la saisie", async () => {
    let saved: unknown = null;
    const info: AvatarInfo = { params: {}, provenance: {}, saved: null, hash: "abc", imported: false, logoAssetId: null };
    server.use(
      http.get("*/equipments/:id/sheet", () => HttpResponse.json(sheet)),
      http.get("*/equipments/:id/avatar", () => HttpResponse.json(info)),
      http.put("*/equipments/:id/avatar", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(info);
      }),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/equipments/${EQ}?tab=3d`);
    expect(await screen.findByLabelText("Aperçu 3D", undefined, { timeout: 5000 })).toBeInTheDocument();
    const length = screen.getByRole("textbox", { name: "Longueur" });
    expect(length).toHaveAttribute("placeholder", "4,89"); // fiche technique (4 895 mm)
    expect(screen.getAllByText("Fiche technique").length).toBeGreaterThan(0);
    await user.type(screen.getByRole("textbox", { name: "Largeur" }), "2,4");
    expect(within(screen.getByRole("textbox", { name: "Largeur" }).closest("div[class*='Group']")!).getByText("Saisi")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await vi.waitFor(() => expect(saved).toEqual({ widthM: 2.4 }), { timeout: 5000 });
  });
});
