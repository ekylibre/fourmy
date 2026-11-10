import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { TrackSummary } from "@fourmy/contracts";
import { summaryRange } from "../src/features/dashboard/TrackSummaryWidget";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Widget « Parcours GPS » du tableau de bord (retours du 10/11/2026). */
const ARION = "00000000-0000-7000-8000-00000000a430";
const summary = (from: string, to: string): TrackSummary => ({
  enabled: true,
  from,
  to,
  items: [
    {
      equipment: { id: ARION, name: "Claas Arion 430" },
      work: { count: 3, durationS: 3 * 3600 + 30 * 60, distanceM: 21_400, coveredAreaM2: 52_000 },
      transit: { count: 2, durationS: 40 * 60, distanceM: 8_200 },
      freeWork: 2,
      parcels: [{ landParcelId: "00000000-0000-7000-8000-0000000000a0", name: "Les Rouffiats", areaM2: 52_000 }],
      firstAt: from,
      lastAt: to,
    },
  ],
});

describe("widget Parcours GPS", () => {
  it("jour de la frise, bascule 7 jours, liens vers l'onglet Parcours filtré", async () => {
    const user = userEvent.setup();
    const asked: { from: string; to: string }[] = [];
    server.use(
      http.get("*/tracks/summary", ({ request }) => {
        const u = new URL(request.url);
        const q = { from: u.searchParams.get("from")!, to: u.searchParams.get("to")! };
        asked.push(q);
        return HttpResponse.json(summary(q.from, q.to));
      }),
    );
    renderApp(`/f/${FARM}?at=2026-10-08`);
    const widget = await screen.findByRole("region", { name: "Parcours GPS" });
    expect(within(widget).getByText("Le 08/10/2026 · 3 h 30 de travail · 2 parcours de travail à transformer en intervention")).toBeInTheDocument();
    expect(within(widget).getByText("3 h 30 · 3 parcours")).toBeInTheDocument();
    expect(within(widget).getByText("40 min · 8,2 km")).toBeInTheDocument();
    expect(within(widget).getByText("Les Rouffiats")).toBeInTheDocument();
    expect(within(widget).getByRole("link", { name: "Claas Arion 430" })).toHaveAttribute(
      "href",
      `/f/${FARM}/equipments/${ARION}?at=2026-10-08&tab=tracks&tracksFrom=2026-10-08&tracksTo=2026-10-08`,
    );
    expect(within(widget).getByRole("link", { name: "2 libres" }).getAttribute("href")).toContain("tracksKind=work&tracksState=free");
    expect(asked[0]).toEqual({ from: new Date("2026-10-08T00:00:00").toISOString(), to: new Date("2026-10-09T00:00:00").toISOString() });

    await user.click(within(widget).getByRole("radio", { name: "7 jours" }));
    expect(await within(widget).findByText(/^Du 02\/10\/2026 au 08\/10\/2026/)).toBeInTheDocument();
    expect(asked.at(-1)!.from).toBe(new Date("2026-10-02T00:00:00").toISOString());
  });

  it("caché quand Traccar n'est pas actif", async () => {
    renderApp(`/f/${FARM}?at=2026-10-08`);
    expect(await screen.findByRole("heading", { name: "Au 08/10/2026" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Parcours GPS" })).toBeNull();
  });

  it("période : jours locaux, passage à l'heure d'hiver compris", () => {
    expect(summaryRange("2026-10-25", "day")).toMatchObject({ first: "2026-10-25", last: "2026-10-25" });
    const week = summaryRange("2026-10-28", "week");
    expect(week.first).toBe("2026-10-22");
    expect(week.to).toBe(new Date("2026-10-29T00:00:00").toISOString());
  });
});
