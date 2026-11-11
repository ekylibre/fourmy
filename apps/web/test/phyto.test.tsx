import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ComplianceResult } from "@fourmy/contracts";
import { demoInterventions } from "@fourmy/mocks";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Réglementation phyto (lot 2) dans le web : feux, motif, fiche, produits. */
const FONGICIDE = "00000000-0000-7000-8000-000000000301";
const DEMO = demoInterventions[0]!;

const result = (level: ComplianceResult["level"], indicators: ComplianceResult["checks"][number]["indicators"]): ComplianceResult => ({
  level,
  checkedAt: "2026-06-10T09:00:00.000Z",
  referential: "2026.11.07.1",
  reason: null,
  checks: [
    {
      articleId: FONGICIDE,
      articleName: "Fongicide X",
      level,
      indicators,
      usages: [
        { id: "u1", label: "Vigne — Mildiou", doseLabel: "2 L/ha" },
        { id: "u2", label: "Vigne — Oïdium", doseLabel: "3 L/ha" },
      ],
      usageId: null,
      harvestAllowedFrom: null,
      reentryAllowedFrom: null,
    },
  ],
});

async function treatmentForm(user: ReturnType<typeof userEvent.setup>) {
  renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
  const button = await screen.findByRole("button", { name: "Nouvelle intervention" });
  await vi.waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const form = await screen.findByRole("form", { name: "Saisie de l'intervention" });
  await user.click(within(form).getByRole("combobox", { name: "Intervention" }));
  await user.click(await screen.findByRole("option", { name: "Pulvérisation" }));
  await user.click(within(form).getByRole("combobox", { name: "Parcelles" }));
  await user.click(await screen.findByRole("option", { name: /Les Rouffiats/ }));
  await user.click(within(form).getByRole("combobox", { name: "Produit" }));
  await user.click(await screen.findByRole("option", { name: /Fongicide X/ }));
  await user.type(within(form).getByRole("textbox", { name: "Quantité" }), "4");
  return form;
}

describe("contrôle réglementaire dans le formulaire", () => {
  it("affiche les feux en direct et propose la cible du traitement", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("*/phyto/check", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json(
          result("danger", [
            { code: "authorization", level: "ok", message: "GUILD autorisé sur Vigne." },
            { code: "dose", level: "danger", message: "Dose 4 L/ha au-dessus du maximum autorisé (3 L/ha)." },
            { code: "reentry", level: "info", message: "Ré-entrée dans la parcelle possible le 10/06/2026 15:00 (délai de 6 h)." },
          ]),
        );
      }),
    );
    const form = await treatmentForm(user);
    // Détail sous l'intrant, synthèse de l'intervention à part.
    const detail = await within(form).findByRole("list", { name: "Contrôle de Fongicide X" }, { timeout: 3000 });
    expect(within(detail).getByText(/au-dessus du maximum autorisé/)).toBeInTheDocument();
    expect(within(form).getByRole("combobox", { name: "Cible de Fongicide X" })).toBeInTheDocument();
    const summary = within(form).getByLabelText("Contrôle réglementaire");
    expect(within(summary).getByText("Non conforme")).toBeInTheDocument();
    expect(within(summary).getByText(/1 point\(s\) non conforme\(s\)/)).toBeInTheDocument();
    // La dernière demande porte la dose saisie (les précédentes, la saisie en cours).
    await vi.waitFor(() => expect(bodies.at(-1)).toMatchObject({ procedure: "spraying", inputs: [{ articleId: FONGICIDE, quantity: 4, per: "hectare" }] }), { timeout: 3000 });
  });

  it("un seul usage possible : affiché d'office avec sa dose maximale", async () => {
    const user = userEvent.setup();
    const single = result("ok", [{ code: "authorization", level: "ok", message: "GUILD autorisé sur Vigne." }]);
    single.checks[0]!.usages = [{ id: "u1", label: "Vigne — Mildiou", doseLabel: "2 L/ha" }];
    single.checks[0]!.usageId = "u1";
    server.use(http.post("*/phyto/check", () => HttpResponse.json(single)));
    const form = await treatmentForm(user);
    expect(await within(form).findByLabelText("Usage de Fongicide X", {}, { timeout: 3000 })).toHaveTextContent("Usage : Vigne — Mildiou · dose max 2 L/ha");
    expect(within(form).queryByRole("combobox", { name: "Cible de Fongicide X" })).not.toBeInTheDocument();
  });

  it("précautions d'emploi à droite ; un mélange interdit est un feu rouge à motif", async () => {
    const user = userEvent.setup();
    const r = result("ok", [{ code: "authorization", level: "ok", message: "GUILD autorisé sur Vigne." }]);
    r.level = "danger";
    r.mixture = { level: "danger", issues: [{ articleIds: [FONGICIDE], message: "Mélange interdit : GUILD et AUTRE sont tous de catégorie 3." }] };
    server.use(http.post("*/phyto/check", () => HttpResponse.json(r)));
    const form = await treatmentForm(user);
    const precautions = await within(form).findByLabelText("Précautions : Fongicide X", {}, { timeout: 3000 });
    expect(within(precautions).getByText("Protection de l'opérateur (EPI)")).toBeInTheDocument();
    expect(within(precautions).getByText(/gants en nitrile/)).toBeInTheDocument();
    const summary = within(form).getByLabelText("Contrôle réglementaire");
    await vi.waitFor(() => expect(within(summary).getByText(/1 point\(s\) non conforme\(s\)/)).toBeInTheDocument());
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    const modal = await screen.findByRole("dialog", { name: "Feu rouge réglementaire" });
    expect(within(modal).getByText(/Mélange interdit/)).toBeInTheDocument();
  });

  it("un feu rouge demande un motif ; le motif part avec l'intervention", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/phyto/check", () => HttpResponse.json(result("danger", [{ code: "dose", level: "danger", message: "Dose 4 L/ha au-dessus du maximum autorisé (3 L/ha)." }]))),
    );
    let completeBody: Record<string, unknown> | null = null;
    server.use(
      http.post("*/interventions", () => HttpResponse.json({}, { status: 201 })),
      http.post("*/interventions/:id/complete", async ({ request }) => {
        completeBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ intervention: {}, movements: [], warnings: [] });
      }),
    );
    const form = await treatmentForm(user);
    await within(form).findByText(/au-dessus du maximum autorisé/, {}, { timeout: 3000 });
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    const modal = await screen.findByRole("dialog", { name: "Feu rouge réglementaire" });
    const go = within(modal).getByRole("button", { name: "Enregistrer malgré tout" });
    expect(go).toBeDisabled();
    expect(completeBody).toBeNull();
    await user.type(within(modal).getByRole("textbox", { name: "Motif" }), "Dose d'attaque validée");
    await user.click(go);
    expect(await screen.findByText("Intervention enregistrée.")).toBeInTheDocument();
    expect(completeBody).toMatchObject({ compliance: { reason: "Dose d'attaque validée", usages: {} } });
  });
});

describe("fiche : contrôle et IFT", () => {
  it("montre le contrôle enregistré avec son motif, et l'IFT par parcelle", async () => {
    server.use(
      http.get("*/interventions/:id", () =>
        HttpResponse.json({
          ...DEMO,
          history: [],
          compliance: { ...result("danger", [{ code: "znt", level: "danger", message: "ZNT de 20 m non respectée : Les Rouffiats à 8 m de « Ruisseau »." }]), reason: "Bande enherbée de 10 m" },
          ift: {
            status: "ok",
            total: 0.667,
            computedAt: "2026-06-10T10:00:00.000Z",
            error: null,
            lines: [{ articleId: FONGICIDE, parcelId: "00000000-0000-7000-8000-0000000000a0", ift: 0.667, segment: "Hors herbicides", doseReference: 3, warning: null }],
          },
        }),
      ),
    );
    renderApp(`/f/${FARM}/interventions/${DEMO.id}?at=2026-06-10`);
    const compliance = await screen.findByLabelText("Contrôle réglementaire");
    expect(within(compliance).getByText(/ZNT de 20 m non respectée/)).toBeInTheDocument();
    expect(within(compliance).getByText(/Bande enherbée de 10 m/)).toBeInTheDocument();
    const ift = screen.getByLabelText("IFT");
    expect(within(ift).getByLabelText("IFT de l'intervention")).toHaveTextContent("0,667");
    expect(await within(ift).findByText(/Fongicide X · Les Rouffiats/)).toBeInTheDocument();
  });

  it("montre le contrôle nitrates enregistré et le motif d'un épandage en période d'interdiction", async () => {
    server.use(
      http.get("*/interventions/:id", () =>
        HttpResponse.json({
          ...DEMO,
          history: [],
          nitrateCheck: {
            level: "danger",
            nitrogen: { totalKgHa: 46, efficientKgHa: 46 },
            indicators: [{ code: "fert_calendar", level: "danger", parcelName: "Les Rouffiats", message: "Période d'interdiction d'épandage : du 01/07 au 15/02 pour un fertilisant de type III sur cette culture." }],
            reason: "Dérogation préfectorale",
            checkedAt: "2026-01-12T10:00:00.000Z",
          },
        }),
      ),
    );
    renderApp(`/f/${FARM}/interventions/${DEMO.id}?at=2026-06-10`);
    const nitrates = await screen.findByLabelText("Directive nitrates");
    expect(within(nitrates).getByText("Interdit")).toBeInTheDocument();
    expect(nitrates).toHaveTextContent("Azote apporté : 46 kg N/ha.");
    expect(nitrates).toHaveTextContent("Les Rouffiats : Période d'interdiction d'épandage");
    expect(nitrates).toHaveTextContent("Motif : « Dérogation préfectorale »");
  });
});

describe("page Produits phyto", () => {
  it("état du référentiel, de l'eau et des produits de la ferme", async () => {
    renderApp(`/f/${FARM}/phyto`);
    expect(await screen.findByText("Version 2026.11.07.1")).toBeInTheDocument();
    expect(screen.getByText("12 cours d'eau et plans d'eau")).toBeInTheDocument();
    expect(screen.getByText("1 / 1 rattachés au référentiel")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Produits phyto de la ferme" });
    expect(within(table).getByText("Fongicide X")).toBeInTheDocument();
    expect(within(table).getByText("GUILD")).toBeInTheDocument();
  });
});
