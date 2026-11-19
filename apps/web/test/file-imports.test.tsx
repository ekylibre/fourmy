import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import type { ImportPreview, ImportRunView } from "@fourmy/contracts";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Page Imports, lot IM5 : dépôt d'un fichier, aperçu, import, rapport, annulation. */
const preview: ImportPreview = {
  format: "geofolia",
  fileName: "export.zip",
  readable: true,
  producedBy: "Geofolia 26.2",
  exportedAt: null,
  campaigns: [2026],
  farm: { identity: { siret: "40000000000003", pacage: null, name: "GAEC PILOTE TEST", email: null, address: null }, siretMatches: true },
  counts: { parcels: 6, productions: 13, areaHa: 40, history: 25, articles: 30, people: 0, workUnits: 215, capIslets: 0, capParcels: 0, landscape: 0 },
  operations: [],
  notImported: [],
  warnings: [],
  reconciliation: {
    parcels: { create: 6, link: 0, skip: 0 },
    productions: { create: 8, link: 0 },
    history: { create: 25, link: 0 },
    covers: { create: 5, link: 0, skip: 0 },
    capRefs: { islets: 0, parcels: 0, areaGaps: [] },
    landscape: { create: 0, link: 0, byKind: [] },
    campaigns: [2026],
    activities: [{ key: "blé", name: "Blé tendre d'hiver", action: "create", reference: "winter_common_wheat", referenceLabel: "Blé tendre d'hiver", via: "agroedi_species", productions: 2 }],
    articles: [],
    people: [],
    interventions: {
      create: 120,
      alreadyImported: 0,
      skipped: [{ label: "Semis direct", on: "2025-09-26", reason: "Un semis ou une plantation demande au moins une semence ou un plant." }],
      byProcedure: [{ procedure: "spraying", done: 40, planned: 0 }],
    },
  },
};

const run = (over: Partial<ImportRunView>): ImportRunView => ({
  id: "6f1d3c1e-9f0a-4a57-9a43-5a4e1f8b0c11",
  source: "file:geofolia",
  format: "geofolia",
  status: "analyzed",
  startedAt: "2026-11-19T10:00:00Z",
  finishedAt: null,
  file: { name: "export.zip", size: 1000, sha256: "x", uploadedAt: "2026-11-19T10:00:00Z", expiresAt: "2026-12-19T10:00:00Z" },
  preview,
  decisions: {},
  report: null,
  ...over,
});

describe("Imports de fichiers", () => {
  it("dépôt → aperçu → import → rapport → annulation", async () => {
    const user = userEvent.setup();
    let current = run({});
    const base = `*/api/v1/farms/${FARM}/imports`;
    server.use(
      http.get(base, () => HttpResponse.json({ items: [current] })),
      http.post(`${base}/files`, () => HttpResponse.json(current, { status: 201 })),
      http.get(`${base}/:id`, () => HttpResponse.json(current)),
      http.post(`${base}/:id/apply`, () => {
        current = run({
          status: "completed",
          report: {
            counts: { parcels: { created: 6, linked: 0, skipped: 0 }, history: { created: 25, linked: 0, skipped: 0 }, interventions: { created: 120, failed: 0, skipped: 1, alreadyImported: 0 } },
            failures: [],
            skipped: [],
            compliance: { phytoDanger: 0, nitrateDanger: 0 },
            warnings: [],
          },
        });
        return HttpResponse.json({ ...current, status: "running" }, { status: 202 });
      }),
      http.post(`${base}/:id/revert`, () => {
        current = run({ status: "reverted", report: { counts: {}, revert: { deleted: { land_parcel: 6, intervention: 120 }, kept: [] } } });
        return HttpResponse.json({ run: current, revert: { deleted: { land_parcel: 6 }, kept: [] } });
      }),
    );
    renderApp(`/f/${FARM}/imports`);
    expect(await screen.findByRole("heading", { name: "Imports", level: 1 }, { timeout: 10_000 })).toBeInTheDocument();

    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*=".dap"]')!;
    await user.upload(input, new File(["PK"], "export.zip", { type: "application/zip" }));

    const apercu = await screen.findByLabelText("Aperçu de l'import");
    expect(within(apercu).getByText("Blé tendre d'hiver · 2")).toBeInTheDocument();
    expect(within(apercu).getByText("Campagnes passées")).toBeInTheDocument();
    expect(within(apercu).getByText(/1 intervention\(s\) laissée\(s\) de côté/)).toBeInTheDocument();
    expect(within(apercu).getByText("votre ferme")).toBeInTheDocument();

    await user.click(within(apercu).getByRole("button", { name: "Importer" }));
    const rapport = await screen.findByLabelText("Rapport de l'import", {}, { timeout: 10_000 });
    expect(within(rapport).getByText("Cultures des campagnes passées")).toBeInTheDocument();
    expect(within(rapport).getByText("25 créés")).toBeInTheDocument();

    await user.click(within(rapport).getByRole("button", { name: "Annuler l'import" }));
    const dialog = await screen.findByRole("dialog", { name: "Annuler cet import ?" });
    await user.click(within(dialog).getByRole("button", { name: "Annuler l'import" }));
    await waitFor(() => expect(screen.getAllByText("Annulé").length).toBeGreaterThan(0));
    expect(screen.getByText(/Supprimé :/)).toBeInTheDocument();
  });

  it("sauvegarde Ekylibre : envoi avec progression, puis restauration en attente", async () => {
    const user = userEvent.setup();
    const queued = run({ source: "file-ekylibre", format: null, status: "running", preview: null, file: null });
    const ekylibre = { ...queued, source: "ekylibre-file:ferme-test", report: { phase: "queued", tenant: "ferme-test", file: { name: "ferme-test.zip", size: 10 } } };
    let received = "";
    server.use(
      http.get(`*/api/v1/farms/${FARM}/imports`, () => HttpResponse.json({ items: received ? [ekylibre] : [] })),
      http.get(`*/api/v1/farms/${FARM}/imports/:id`, () => HttpResponse.json(ekylibre)),
      http.post(`*/api/v1/farms/${FARM}/imports/ekylibre/upload`, async ({ request }) => {
        received = decodeURIComponent(request.headers.get("x-file-name") ?? "");
        return HttpResponse.json(ekylibre, { status: 201 });
      }),
    );
    renderApp(`/f/${FARM}/imports`);
    const section = await screen.findByLabelText("Reprise d'Ekylibre", {}, { timeout: 10_000 });
    await user.upload(section.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["PK"], "ferme-test.zip", { type: "application/zip" }));
    await waitFor(() => expect(received).toBe("ferme-test.zip"));
    expect((await screen.findAllByText("En attente de restauration")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sauvegarde Ekylibre (ferme-test)").length).toBeGreaterThan(0);
  });

  it("un fichier refusé est expliqué", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/farms/${FARM}/imports`, () => HttpResponse.json({ items: [] })),
      http.post(`*/api/v1/farms/${FARM}/imports/files`, () =>
        HttpResponse.json({ title: "Format non reconnu", detail: "Fichier « notes.txt » : format non reconnu (DAPLOS, Geofolia, TelePAC attendus)." }, { status: 422 }),
      ),
    );
    renderApp(`/f/${FARM}/imports`);
    await screen.findByRole("heading", { name: "Imports", level: 1 }, { timeout: 10_000 });
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"][accept*=".dap"]')!, new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByText(/format non reconnu/)).toBeInTheDocument();
  });
});
