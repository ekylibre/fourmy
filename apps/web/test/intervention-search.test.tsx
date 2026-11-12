import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Intervention } from "@fourmy/contracts";
import { demoInterventions } from "@fourmy/mocks";
import { makeMatcher, normalize, searchText } from "../src/features/interventions/search";
import type { Names } from "../src/features/interventions/presenters";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Recherche rapide des interventions (exigence INT-UI-5). */
const base = demoInterventions[0]! as Intervention;
const PARCEL = "00000000-0000-7000-8000-0000000000a0";
const FONGICIDE = "00000000-0000-7000-8000-000000000301";
const names: Names = {
  parcel: new Map([[PARCEL, "Les Rouffiats"]]),
  equipment: new Map([["e1", "Pulvérisateur Berthoud"]]),
  article: new Map([[FONGICIDE, { name: "Fongicide X", unit: "liter", amm: "2100001" }]]),
  person: new Map([["00000000-0000-7000-8000-000000000601", "Camille Lefèvre"]]),
};
const spraying = { ...base, tools: [{ equipmentId: "e1" }], notes: "Vent faible, rosée matinale" };

describe("recherche : texte indexé", () => {
  it("ignore accents et majuscules", () => {
    expect(normalize("Écimage Rognage")).toBe("ecimage rognage");
  });

  it("trouve par intervention, parcelle, produit, AMM, matériel, personne, motif et notes", () => {
    const text = searchText(spraying, names);
    for (const q of ["pulverisation", "rouffiats", "fongicide", "2100001", "berthoud", "lefevre", "fongicide", "rosee"]) {
      expect(makeMatcher(q)!(text), q).toBe(true);
    }
  });

  it("tous les mots doivent se retrouver ; une requête vide ne filtre pas", () => {
    const text = searchText(spraying, names);
    expect(makeMatcher("pulvé rouff")!(text)).toBe(true);
    expect(makeMatcher("pulvé labour")!(text)).toBe(false);
    expect(makeMatcher("   ")).toBeNull();
  });

  it("reste rapide sur une grosse campagne (2 000 interventions)", () => {
    const many = Array.from({ length: 2000 }, (_, k) => ({ ...spraying, id: String(k), notes: `note ${k}` }));
    const t0 = performance.now();
    const texts = many.map((i) => searchText(i, names));
    const m = makeMatcher("fongicide rouffiats 1999")!;
    const found = texts.filter(m);
    expect(found).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("recherche dans la liste", () => {
  const harvest: Intervention = {
    ...base,
    id: "00000000-0000-7000-8000-000000000499",
    procedure: "harvesting",
    inputs: [],
    purposes: [],
    periods: [{ startedAt: "2026-09-15T06:00:00.000Z", stoppedAt: "2026-09-15T12:00:00.000Z" }],
    startedAt: "2026-09-15T06:00:00.000Z",
    stoppedAt: "2026-09-15T12:00:00.000Z",
    notes: "Rendement décevant",
  };
  beforeEach(() => {
    localStorage.clear();
    server.use(http.get("*/interventions", () => HttpResponse.json({ items: [base, harvest], nextCursor: null })));
  });

  it("cherche dans toute la campagne, pas seulement la semaine ; la requête est dans l'adresse", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    expect(await screen.findByText("Pulvérisation")).toBeInTheDocument();
    expect(screen.queryByText("Récolte")).not.toBeInTheDocument(); // autre semaine
    await user.type(screen.getByRole("textbox", { name: "Rechercher dans la campagne" }), "decevant");
    expect(await screen.findByText("Récolte")).toBeInTheDocument();
    expect(screen.queryByText("Pulvérisation")).not.toBeInTheDocument();
    expect(screen.getByText("1 intervention(s) trouvée(s) sur la campagne 2026.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toContain("q=decevant"));

    await user.click(screen.getByRole("button", { name: "Effacer la recherche" }));
    expect(await screen.findByText("Pulvérisation")).toBeInTheDocument();
    expect(screen.queryByText("Récolte")).not.toBeInTheDocument();
  });

  it("une frappe rapide ne perd aucune lettre ; l'adresse suit après la pause", async () => {
    const user = userEvent.setup({ delay: null });
    const { router } = renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    expect(await screen.findByText("Pulvérisation")).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Rechercher dans la campagne" });
    await user.type(box, "rendement decevant");
    expect(box).toHaveValue("rendement decevant");
    expect(await screen.findByText("Récolte")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toContain("q=rendement+decevant"));
  });

  it("par n° AMM du produit", async () => {
    renderApp(`/f/${FARM}/interventions?at=2026-06-10&q=2100001`);
    expect(await screen.findByText("Pulvérisation")).toBeInTheDocument();
    expect(screen.queryByText("Récolte")).not.toBeInTheDocument();
  });
});
