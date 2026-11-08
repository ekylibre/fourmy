import { createEvent, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Intervention } from "@fourmy/contracts";
import { demoInterventions } from "@fourmy/mocks";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Vues des interventions sur la semaine de la frise (exigence INT-UI-4). */
const base = demoInterventions[0]! as Intervention;
const id = (n: number) => `00000000-0000-7000-8000-0000000004${String(n).padStart(2, "0")}`;
// Semaine du lundi 8 au dimanche 14 juin 2026.
const done = { ...base, id: id(1) }; // pulvérisation du 10 juin
const planned: Intervention = {
  ...base,
  id: id(2),
  procedure: "plowing",
  status: "planned",
  periods: [],
  startedAt: "2026-06-12T07:00:00.000Z",
  stoppedAt: null,
  inputs: [],
  purposes: [],
};
const vine: Intervention = {
  ...base,
  id: id(3),
  procedure: "vine_pruning",
  inputs: [],
  purposes: [],
  periods: [
    { startedAt: "2026-06-08T06:00:00.000Z", stoppedAt: "2026-06-08T10:00:00.000Z" },
    { startedAt: "2026-06-09T06:00:00.000Z", stoppedAt: "2026-06-09T10:00:00.000Z" },
  ],
  startedAt: "2026-06-08T06:00:00.000Z",
  stoppedAt: "2026-06-09T10:00:00.000Z",
};
const otherWeek: Intervention = { ...base, id: id(4), procedure: "harvesting", inputs: [], purposes: [], periods: [{ startedAt: "2026-09-15T06:00:00.000Z", stoppedAt: "2026-09-15T12:00:00.000Z" }], startedAt: "2026-09-15T06:00:00.000Z", stoppedAt: "2026-09-15T12:00:00.000Z" };

beforeEach(() => {
  localStorage.clear();
  server.use(http.get("*/interventions", () => HttpResponse.json({ items: [done, planned, vine, otherWeek], nextCursor: null })));
});

describe("vues des interventions", () => {
  it("la liste montre la semaine de la frise, ou toute la campagne", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    expect(await screen.findByText("Semaine du 8 au 14 juin 2026")).toBeInTheDocument();
    expect(await screen.findByText("3 intervention(s) cette semaine.")).toBeInTheDocument();
    expect(screen.queryByText("Récolte")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Toute la campagne 2026" }));
    expect(await screen.findByText("Récolte")).toBeInTheDocument();
    expect(screen.getByText("4 intervention(s) sur la campagne 2026.")).toBeInTheDocument();
  });

  it("la vue choisie est gardée dans l'adresse et au changement de semaine", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/f/${FARM}/interventions?at=2026-06-10`);
    await user.click(await screen.findByText("Kanban"));
    expect(router.state.location.search).toContain("vue=kanban");
    await user.click(screen.getByRole("button", { name: "Semaine suivante" }));
    expect(await screen.findByText("Semaine du 15 au 21 juin 2026")).toBeInTheDocument();
    expect(router.state.location.search).toContain("vue=kanban");
    expect(screen.getByRole("region", { name: "Réalisée" })).toBeInTheDocument();
  });

  it("kanban : colonnes par statut, « en cours » calculé", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-06-12T09:00:00Z") });
    try {
      renderApp(`/f/${FARM}/interventions?at=2026-06-10&vue=kanban`);
      const inProgress = await screen.findByRole("region", { name: "En cours" });
      // Le labour prévu le 12 à 7 h : commencé à 9 h, il est « en cours ».
      expect(await within(inProgress).findByRole("article", { name: "Labour" })).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "Réalisée" })).getAllByRole("article")).toHaveLength(2);
      expect(within(screen.getByRole("region", { name: "Planifiée" })).queryAllByRole("article")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kanban : glisser une intervention planifiée vers « Réalisée » ouvre la réalisation ; un retour en arrière est refusé", async () => {
    renderApp(`/f/${FARM}/interventions?at=2026-06-10&vue=kanban`);
    const card = await screen.findByRole("article", { name: "Labour" });
    const drag = (target: HTMLElement) => {
      const data = new Map<string, string>();
      const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "" };
      fireEvent(card, Object.assign(createEvent.dragStart(card), { dataTransfer }));
      fireEvent(target, Object.assign(createEvent.dragOver(target), { dataTransfer }));
      fireEvent(target, Object.assign(createEvent.drop(target), { dataTransfer }));
    };
    drag(screen.getByRole("region", { name: "Réalisée" }));
    expect(await screen.findByRole("dialog", { name: "Réaliser l'intervention" })).toBeInTheDocument();
  });

  it("kanban : une carte réalisée ramenée vers « Planifiée » est refusée avec une explication", async () => {
    renderApp(`/f/${FARM}/interventions?at=2026-06-10&vue=kanban`);
    const card = await screen.findByRole("article", { name: "Taille" });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "" };
    const target = screen.getByRole("region", { name: "Planifiée" });
    fireEvent(card, Object.assign(createEvent.dragStart(card), { dataTransfer }));
    fireEvent(target, Object.assign(createEvent.drop(target), { dataTransfer }));
    expect(await screen.findByText(/se déduit de la date/)).toBeInTheDocument();
  });

  it("kanban au clavier : le menu d'une carte offre « Réaliser… »", async () => {
    const user = userEvent.setup();
    renderApp(`/f/${FARM}/interventions?at=2026-06-10&vue=kanban`);
    await user.click(await screen.findByRole("button", { name: "Actions : Labour" }));
    await user.click(await screen.findByRole("menuitem", { name: "Réaliser…" }));
    expect(await screen.findByRole("dialog", { name: "Réaliser l'intervention" })).toBeInTheDocument();
  });

  it("calendrier : une taille sur deux demi-journées apparaît chaque jour, avec ses heures", async () => {
    renderApp(`/f/${FARM}/interventions?at=2026-06-10&vue=calendrier`);
    const monday = await screen.findByRole("region", { name: /lundi 8 juin/i });
    const tuesday = screen.getByRole("region", { name: /mardi 9 juin/i });
    expect(within(monday).getByRole("article", { name: "Taille" })).toBeInTheDocument();
    expect(within(tuesday).getByRole("article", { name: "Taille" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /vendredi 12 juin/i })).getByText(/prévue/)).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Récolte" })).not.toBeInTheDocument();
  });
});
