import { describe, expect, it } from "vitest";
import { draftFromSessions, type DraftSession } from "../src/tracks.js";

const TRACTOR = "00000000-0000-4000-8000-000000000001";
const PLOUGH = "00000000-0000-4000-8000-000000000002";
const DRIVER = "00000000-0000-4000-8000-000000000003";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const settings = { stopMin: 15, parcelMinShare: 0.05, parcelMinAreaM2: 500 };

const session = (id: string, from: string, to: string, kind: "work" | "transit" = "work", parcels: DraftSession["parcels"] = []): DraftSession => ({
  id,
  equipmentId: TRACTOR,
  kind,
  startedAt: `2026-10-05T${from}:00.000Z`,
  stoppedAt: `2026-10-05T${to}:00.000Z`,
  coveredAreaM2: kind === "work" ? parcels.reduce((n, p) => n + p.areaM2, 0) : null,
  parcels,
});
const id = (n: number) => `00000000-0000-4000-8000-00000000100${n}`;

describe("draftFromSessions", () => {
  it("une session : attelage tracteur + outil + conducteur, une période, ses parcelles", () => {
    const d = draftFromSessions([session(id(1), "08:00", "10:00", "work", [{ landParcelId: A, name: "La Plaine", areaM2: 20_000, share: 0.8 }])], {
      settings,
      tool: { id: PLOUGH, name: "Charrue", source: "traccar" },
      driver: { id: DRIVER, name: "Pierre" },
      procedureSuggestions: ["plowing"],
    });
    expect(d.body.staffing).toBe("crews");
    expect(d.body.crews).toEqual([
      { tools: [{ equipmentId: TRACTOR }, { equipmentId: PLOUGH }], doers: [{ personId: DRIVER }], periods: [{ startedAt: "2026-10-05T08:00:00.000Z", stoppedAt: "2026-10-05T10:00:00.000Z" }] },
    ]);
    expect(d.body.targets).toEqual([{ kind: "land_parcel", id: A, workedAreaM2: 20_000 }]);
    expect(d.body.trackSessionIds).toEqual([id(1)]);
    expect(d.procedureSuggestions).toEqual(["plowing"]);
    expect(d.hints).toEqual([]);
    expect(d.parcelNames).toEqual({ [A]: "La Plaine" });
  });

  it("deux sessions proches fusionnées, une éloignée à part ; zones SQL prioritaires", () => {
    const d = draftFromSessions(
      [
        session(id(3), "13:00", "14:00", "work", [{ landParcelId: B, name: "Le Bas", areaM2: 4000, share: 0.2 }]),
        session(id(1), "08:00", "09:00", "work", [{ landParcelId: A, name: "La Plaine", areaM2: 9000, share: 0.3 }]),
        session(id(2), "09:10", "10:00", "work", [{ landParcelId: A, name: "La Plaine", areaM2: 6000, share: 0.2 }]),
      ],
      { settings, tool: { id: PLOUGH, name: "Charrue", source: "traccar" }, driver: { id: DRIVER, name: "Pierre" }, zones: { [A]: { areaM2: 14_321.4, geometry: { type: "Polygon", coordinates: [] } } }, procedureSuggestions: ["plowing"] },
    );
    expect(d.body.crews[0]!.periods).toEqual([
      { startedAt: "2026-10-05T08:00:00.000Z", stoppedAt: "2026-10-05T10:00:00.000Z" },
      { startedAt: "2026-10-05T13:00:00.000Z", stoppedAt: "2026-10-05T14:00:00.000Z" },
    ]);
    expect(d.body.targets).toEqual([
      { kind: "land_parcel", id: A, workedAreaM2: 14_321, workingZone: { type: "Polygon", coordinates: [] } },
      { kind: "land_parcel", id: B, workedAreaM2: 4000 },
    ]);
    expect(d.body.trackSessionIds).toEqual([id(1), id(2), id(3)]);
  });

  it("déplacement seul : pas de cible, indice de transport", () => {
    const d = draftFromSessions([session(id(1), "07:00", "07:30", "transit")], { settings, driver: { id: DRIVER, name: "Pierre" }, tool: { id: PLOUGH, name: "Charrue", source: "traccar" } });
    expect(d.body.targets).toEqual([]);
    expect(d.hints).toEqual(["Déplacements seuls : aucune parcelle cible, procédure de transport à choisir."]);
  });

  it("seuil de parcelle : part ou surface cumulées sur les sessions", () => {
    const d = draftFromSessions(
      [
        session(id(1), "08:00", "09:00", "work", [
          { landParcelId: A, name: "Grande", areaM2: 300, share: 0.03 },
          { landParcelId: B, name: "Bordure", areaM2: 100, share: 0.01 },
          { landParcelId: C, name: "Petite", areaM2: 200, share: 0.06 },
        ]),
        session(id(2), "08:30", "10:00", "work", [{ landParcelId: A, name: "Grande", areaM2: 300, share: 0.03 }]),
      ],
      { settings, tool: { id: PLOUGH, name: "Charrue", source: "traccar" }, driver: { id: DRIVER, name: "Pierre" }, procedureSuggestions: ["plowing"] },
    );
    expect(d.body.targets.map((t) => t.id)).toEqual([A, C]); // A : 6 % cumulés ; B écartée ; C : 6 %
  });

  it("outil et conducteur absents : indices ; outil d'habitude signalé", () => {
    const none = draftFromSessions([session(id(1), "08:00", "09:00", "work", [])], {
      settings,
      unlinkedToolHint: { hint: "Tigre", lookalike: "Maschio Tigre 300" },
    });
    expect(none.body.crews[0]!.tools).toEqual([{ equipmentId: TRACTOR }]);
    expect(none.body.crews[0]!.doers).toEqual([]);
    expect(none.hints).toEqual([
      "Aucune parcelle travaillée au-delà du seuil : cibles à choisir.",
      "Le boîtier annonce l'outil « Tigre », relié à aucun matériel (peut-être Maschio Tigre 300 : renseignez le lien Traccar sur sa fiche).",
      "Aucun conducteur connu : attelage sans intervenant, à compléter si besoin.",
      "Procédure à choisir.",
    ]);
    const habit = draftFromSessions([session(id(1), "08:00", "09:00")], { settings, tool: { id: PLOUGH, name: "Charrue", source: "habit" }, driver: { id: DRIVER, name: "P" }, procedureSuggestions: ["x"] });
    expect(habit.hints).toContain("Outil déduit de l'habitude : Charrue.");
    expect(draftFromSessions([session(id(1), "08:00", "09:00")], { settings, driver: { id: DRIVER, name: "P" }, procedureSuggestions: ["x"] }).hints).toEqual(["Aucune parcelle travaillée au-delà du seuil : cibles à choisir.", "Aucun outil détecté : à ajouter si besoin."]);
  });
});
