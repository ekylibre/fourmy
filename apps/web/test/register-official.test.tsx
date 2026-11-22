import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import type { OfficialRegister, OfficialRegisterLine } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Onglet « Format réglementaire » du registre phyto (lot X). */
const line = (over: Partial<OfficialRegisterLine>): OfficialRegisterLine => ({
  idTraitement: "in-1:tg-1",
  idIntervention: "int-1",
  siretApplicateur: "",
  siretBeneficiaire: "",
  nomProduit: "Fongicide X",
  numeroAMMProduit: "2100001",
  dateIntervention: "10/06/2026",
  heureDebut: "08:05",
  heureFin: "10:40",
  delaiRentree: "",
  doseProduitValeur: "2",
  doseProduitUnite: "L/ha",
  volumeDeBouillie: "",
  uniteBouillie: "",
  usageCible: "Mildiou",
  modeApplication: "Pulvérisation",
  surfaceTraitee: "1.20",
  surfaceUnite: "ha",
  numIlot: "",
  numParcelle: "",
  codeCommuneInsee: "",
  coordonneesGps: "44.80000 ; 0.50000",
  cultureOepp: "VITVI",
  codeBbch: "BBCH 57",
  modeDeConduite: "Non",
  commentaire: "",
  campagne: "2026",
  pacage: "",
  surfaceParcelle: "1.20",
  surfaceTotaleUnite: "ha",
  partSurfaceTraitee: "100",
  anomalies: ["siretApplicateur"],
  links: { interventionId: "int-1", landParcelId: "lp-1", parcelName: "Les Rouffiats", activityId: null },
  ...over,
});

describe("registre phyto : format réglementaire", () => {
  it("lignes, champs à compléter, détenteur saisi par le responsable, exports", async () => {
    const user = userEvent.setup();
    let identity = { siret: null as string | null, pacage: null as string | null };
    const puts: unknown[] = [];
    server.use(
      http.get("*/registers/phyto/official", ({ request }) => {
        const format = new URL(request.url).searchParams.get("format");
        if (format) return new HttpResponse("x", { headers: { "content-type": "text/csv" } });
        const anomalies = identity.siret ? [] : (["siretApplicateur"] as OfficialRegisterLine["anomalies"]);
        const body: OfficialRegister = {
          campaign: 2026,
          holder: { name: "Démo", ...identity },
          generatedAt: "2026-11-10T00:00:00Z",
          lines: [line({ anomalies, siretApplicateur: identity.siret ?? "" })],
        };
        return HttpResponse.json(body);
      }),
      http.put("*/settings/identity", async ({ request }) => {
        const b = (await request.json()) as typeof identity;
        puts.push(b);
        identity = b;
        return HttpResponse.json(b);
      }),
    );
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderApp(`/f/${FARM}/register?at=2026-06-30`);
    await user.click(await screen.findByRole("tab", { name: "Format réglementaire" }));
    expect(await screen.findByText("1 ligne(s) en 2026 · 0 complète(s) · à compléter : SIRET (1)")).toBeInTheDocument();
    expect(screen.getByText("SIRET non renseigné · PACAGE non renseigné")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Les Rouffiats")).toBeInTheDocument();
    expect(within(table).getByText("VITVI")).toBeInTheDocument();
    expect(within(table).getByText("BBCH 57")).toBeInTheDocument();
    expect(within(table).getByText("2 L/ha")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Modifier le détenteur" }));
    await user.type(screen.getByRole("textbox", { name: "SIRET" }), "123");
    expect(screen.getByRole("button", { name: "Valider" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "SIRET" }), "45678900011");
    await user.click(screen.getByRole("button", { name: "Valider" }));
    expect(await screen.findByText("1 ligne(s) en 2026 · 1 complète(s)")).toBeInTheDocument();
    expect(puts).toEqual([{ siret: "12345678900011", pacage: null }]);
    expect(screen.getByText("Complète")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "CSV réglementaire" }));
    await user.click(screen.getByRole("button", { name: "JSON complet" }));
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe("registre phyto : édition imprimable (issue #8)", () => {
  it("en-tête du détenteur, lignes au format réglementaire, champs manquants « à compléter »", async () => {
    vi.spyOn(window, "print").mockImplementation(() => {});
    server.use(
      http.get("*/registers/phyto/official", () =>
        HttpResponse.json({
          campaign: 2026,
          holder: { name: "Démo", siret: null, pacage: "032123456" },
          generatedAt: "2026-11-10T00:00:00Z",
          lines: [line({}), line({ idTraitement: "in-2:tg-1", nomProduit: "Herbicide Y", numeroAMMProduit: "", anomalies: ["numeroAMMProduit"], links: { interventionId: "int-2", landParcelId: "lp-2", parcelName: "Le Bourg", activityId: null } })],
        } satisfies OfficialRegister),
      ),
    );
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/print/register/phyto?campaign=2026`);
    expect(await screen.findByRole("heading", { name: "Registre d'utilisation des produits phytopharmaceutiques" })).toBeVisible();
    expect(screen.getByText(/PACAGE 032123456 · Campagne 2026/)).toBeVisible();
    expect(screen.getByText(/SIRET du détenteur non renseigné/)).toBeVisible();
    const table = screen.getByRole("table", { name: "Registre phytosanitaire 2026" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("Les Rouffiats")).toBeVisible();
    expect(within(rows[1]!).getByText("2 L/ha")).toBeVisible();
    expect(within(rows[1]!).getByText("1,20 ha")).toBeVisible();
    expect(within(rows[2]!).getByText("à compléter")).toBeVisible();
    expect(screen.getByText(/2 ligne\(s\) avec un champ obligatoire à compléter/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Imprimer ou enregistrer en PDF" }));
    expect(window.print).toHaveBeenCalled();
  });
});
