import { describe, it, expect } from "vitest";
import { getProcedure } from "@fourmy/contracts";
import { crewDurations, crewRules, flattenCrews, mergePeriods, toCrews, toFree, validateIntervention } from "../src/index.js";

const TRACTOR = "00000000-0000-7000-8000-0000000000b1";
const TRACTOR2 = "00000000-0000-7000-8000-0000000000b2";
const SPRAYER = "00000000-0000-7000-8000-0000000000b3";
const PIERRE = "00000000-0000-7000-8000-0000000000c1";
const PAUL = "00000000-0000-7000-8000-0000000000c2";

const at = (h: number) => `2026-06-10T${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}:00.000Z`;
const p = (from: number, to: number) => ({ startedAt: at(from), stoppedAt: at(to) });
const crew = (tools: string[], doers: string[], periods: { startedAt: string; stoppedAt: string }[], label?: string) => ({
  ...(label ? { label } : {}),
  tools: tools.map((equipmentId) => ({ equipmentId })),
  doers: doers.map((personId) => ({ personId })),
  periods,
});
const crews = (...c: ReturnType<typeof crew>[]) => ({ staffing: "crews" as const, crews: c });

describe("crewRules", () => {
  it("cas US-ATT-A : deux attelages simultanés, valide", () => {
    expect(crewRules(crews(crew([TRACTOR], [PIERRE], [p(8, 10)]), crew([TRACTOR2, SPRAYER], [PAUL], [p(9, 12)])))).toEqual([]);
  });

  it("attelage sans matériel → erreur", () => {
    expect(crewRules(crews(crew([], [PIERRE], [p(8, 10)])))).toEqual(["Attelage 1 : au moins un matériel."]);
    expect(crewRules(crews(crew([TRACTOR], [], [p(8, 10)]), crew([], [], [p(8, 10)], "Désherbage")))).toEqual([
      "« Désherbage » : au moins un matériel.",
    ]);
  });

  it("attelage sans intervenant → accepté (conducteur inconnu)", () => {
    expect(crewRules(crews(crew([TRACTOR], [], [p(8, 10)])))).toEqual([]);
    expect(crewRules(crews({ tools: [{ equipmentId: TRACTOR }], periods: [p(8, 10)] }))).toEqual([]);
  });

  it("attelage sans période → erreur", () => {
    expect(crewRules(crews(crew([TRACTOR], [PIERRE], [])))).toEqual(["Attelage 1 : au moins une période de travail."]);
  });

  it("mode attelages sans attelage → erreur", () => {
    expect(crewRules({ staffing: "crews", crews: [] })).toEqual(["Au moins un attelage."]);
  });

  it("chevauchement dans un attelage → erreur", () => {
    expect(crewRules(crews(crew([TRACTOR], [PIERRE], [p(10, 12), p(8, 11)])))).toEqual(["Attelage 1 : deux périodes de travail se chevauchent."]);
  });

  it("périodes qui se touchent dans un attelage → acceptées", () => {
    expect(crewRules(crews(crew([TRACTOR], [PIERRE], [p(8, 10), p(10, 12)])))).toEqual([]);
  });

  it("fin avant le début → erreur", () => {
    expect(crewRules(crews(crew([TRACTOR], [], [p(8, 10), p(12, 11)])))).toEqual(["Attelage 1, période n° 2 : la fin doit suivre le début."]);
  });

  it("chevauchement entre deux attelages → permis", () => {
    expect(crewRules(crews(crew([TRACTOR], [PIERRE], [p(8, 12)]), crew([TRACTOR2], [PAUL], [p(8, 12)])))).toEqual([]);
  });

  it("même tracteur dans deux attelages qui se chevauchent → erreur", () => {
    const body = crews(crew([TRACTOR, SPRAYER], [PIERRE], [p(8, 10)]), crew([TRACTOR], [PAUL], [p(9, 12)]));
    expect(crewRules(body)).toEqual(["Un même matériel figure dans Attelage 1 et Attelage 2 sur des périodes qui se chevauchent."]);
    expect(crewRules(body, { equipment: (id) => (id === TRACTOR ? "Fendt 724" : undefined) })).toEqual([
      "Le matériel « Fendt 724 » figure dans Attelage 1 et Attelage 2 sur des périodes qui se chevauchent.",
    ]);
  });

  it("même intervenant dans deux attelages qui se chevauchent → erreur", () => {
    const body = crews(crew([TRACTOR], [PIERRE], [p(8, 10)]), crew([TRACTOR2], [PIERRE], [p(9, 12)]));
    expect(crewRules(body, { person: () => "Pierre Martin" })).toEqual([
      "Pierre Martin figure dans Attelage 1 et Attelage 2 sur des périodes qui se chevauchent.",
    ]);
  });

  it("même tracteur dans deux attelages successifs → permis", () => {
    expect(crewRules(crews(crew([TRACTOR, SPRAYER], [PIERRE], [p(8, 10)]), crew([TRACTOR], [PIERRE], [p(10, 12)])))).toEqual([]);
  });

  it("mode attelages : rien au premier niveau", () => {
    const body = { ...crews(crew([TRACTOR], [], [p(8, 10)])), tools: [{ equipmentId: SPRAYER }], periods: [p(8, 10)] };
    expect(crewRules(body)).toEqual(["En mode attelages, matériels, intervenants et périodes se saisissent dans chaque attelage."]);
  });

  it("mode libre : aucun attelage ; le reste relève de validateIntervention", () => {
    expect(crewRules({ staffing: "free", tools: [{ equipmentId: TRACTOR }], periods: [p(8, 10)] })).toEqual([]);
    expect(crewRules({ periods: [p(8, 10)] })).toEqual([]);
    expect(crewRules({ staffing: "free", crews: [crew([TRACTOR], [], [p(8, 10)])] })).toEqual(["En mode libre, l'intervention n'a pas d'attelage."]);
  });
});

describe("mergePeriods", () => {
  it("fusionne ce qui se chevauche, trie, garde distinct ce qui se touche", () => {
    expect(mergePeriods([p(14, 16), p(9, 12), p(8, 10), p(12, 13), p(15, 15.5)])).toEqual([p(8, 12), p(12, 13), p(14, 16)]);
  });
  it("période incluse dans une autre", () => {
    expect(mergePeriods([p(8, 12), p(9, 10)])).toEqual([p(8, 12)]);
  });
  it("vide", () => {
    expect(mergePeriods([])).toEqual([]);
  });
});

describe("flattenCrews", () => {
  it("réunit matériels et intervenants sans doublon et fusionne les périodes", () => {
    const flat = flattenCrews([crew([TRACTOR, SPRAYER], [PIERRE], [p(8, 10)]), crew([TRACTOR2], [PAUL, PIERRE], [p(9, 12), p(14, 15)]), crew([TRACTOR], [], [p(16, 17)])]);
    expect(flat).toEqual({
      tools: [{ equipmentId: TRACTOR }, { equipmentId: SPRAYER }, { equipmentId: TRACTOR2 }],
      doers: [{ personId: PIERRE }, { personId: PAUL }],
      periods: [p(8, 12), p(14, 15), p(16, 17)],
    });
  });

  it("matériel dans deux attelages : relevé de compteur de l'attelage qui finit le plus tard", () => {
    const late = { ...crew([], [], [p(14, 16)]), tools: [{ equipmentId: TRACTOR, meter: { value: 1210 } }] };
    const early = { ...crew([], [], [p(8, 10)]), tools: [{ equipmentId: TRACTOR, meter: { value: 1205 } }] };
    expect(flattenCrews([late, early]).tools).toEqual([{ equipmentId: TRACTOR, meter: { value: 1210 } }]);
  });

  it("la forme aplatie passe les règles existantes (périodes sans chevauchement)", () => {
    const flat = flattenCrews([crew([TRACTOR], [PIERRE], [p(8, 10)]), crew([TRACTOR2], [PAUL], [p(9, 12)])]);
    const body = { ...flat, targets: [], inputs: [], outputs: [], purposes: [] };
    expect(validateIntervention(getProcedure("plowing"), body, "plan", { articleKind: () => undefined })).toEqual([]);
  });
});

describe("crewDurations", () => {
  it("US-ATT-A : chantier 8 h-12 h (4 h), temps de travail 5 h", () => {
    expect(crewDurations(crews(crew([TRACTOR], [], [p(8, 10)]), crew([TRACTOR2], [], [p(9, 12)])))).toEqual({ spanS: 4 * 3600, workDurationS: 5 * 3600 });
  });
  it("mode libre et intervention sans période", () => {
    expect(crewDurations({ periods: [p(8, 10), p(14, 15)] })).toEqual({ spanS: 7 * 3600, workDurationS: 3 * 3600 });
    expect(crewDurations({ staffing: "crews", crews: [] })).toEqual({ spanS: null, workDurationS: null });
  });
});

describe("changement de mode", () => {
  const free = {
    tools: [{ equipmentId: TRACTOR, meter: { value: 1200 } }, { equipmentId: SPRAYER }],
    doers: [{ personId: PIERRE }],
    periods: [p(8, 10), p(10, 12), p(14, 16)],
  };

  it("toCrews : un attelage avec tout, premier niveau vidé", () => {
    const c = toCrews(free);
    expect(c).toEqual({ staffing: "crews", crews: [free], tools: [], doers: [], periods: [] });
    expect(crewRules(c)).toEqual([]);
  });

  it("aller-retour libre → attelages → libre sans perte", () => {
    const back = toFree(toCrews(free));
    expect(back.losses).toEqual([]);
    expect(back.body).toEqual({ staffing: "free", crews: [], ...free });
  });

  it("toCrews trie les périodes ; sans matériel, l'attelage reste à compléter", () => {
    const c = toCrews({ periods: [p(14, 16), p(8, 10)] });
    expect(c.crews[0]!.periods).toEqual([p(8, 10), p(14, 16)]);
    expect(crewRules(c)).toEqual(["Attelage 1 : au moins un matériel."]);
  });

  it("toFree signale la perte d'information (US-ATT-A)", () => {
    const { body, losses } = toFree(crews(crew([TRACTOR], [PIERRE], [p(8, 10)], "Labour"), crew([TRACTOR2, SPRAYER], [PAUL], [p(9, 12)])));
    expect(body).toEqual({
      staffing: "free",
      crews: [],
      tools: [{ equipmentId: TRACTOR }, { equipmentId: TRACTOR2 }, { equipmentId: SPRAYER }],
      doers: [{ personId: PIERRE }, { personId: PAUL }],
      periods: [p(8, 12)],
    });
    expect(losses).toEqual([
      "Les 2 attelages sont réunis : on ne saura plus quel intervenant travaillait avec quel matériel.",
      "Les périodes propres à chaque attelage sont remplacées par celles de l'intervention.",
      "Le temps de travail passe de 5 h à 4 h : les périodes simultanées sont fusionnées.",
      "Les noms des attelages et les attelages types d'origine ne sont pas conservés.",
    ]);
  });

  it("toFree : même composition sur des périodes successives → rien de perdu", () => {
    expect(toFree(crews(crew([TRACTOR], [PIERRE], [p(8, 10)]), crew([TRACTOR], [PIERRE], [p(14, 15.5)]))).losses).toEqual([]);
  });

  it("toFree : compositions différentes aux mêmes périodes → seule l'affectation est perdue", () => {
    const { losses } = toFree(crews(crew([TRACTOR], [PIERRE], [p(8, 10)]), crew([TRACTOR2], [PAUL], [p(8, 10)])));
    expect(losses).toEqual([
      "Les 2 attelages sont réunis : on ne saura plus quel intervenant travaillait avec quel matériel.",
      "Le temps de travail passe de 4 h à 2 h : les périodes simultanées sont fusionnées.",
    ]);
  });

  it("toFree : temps de travail avec minutes", () => {
    const { losses } = toFree(crews(crew([TRACTOR], [], [p(8, 9.5)]), crew([TRACTOR], [], [p(13, 14)])));
    expect(losses).toEqual([]);
    const lost = toFree(crews(crew([TRACTOR], [], [p(8, 9.5)]), crew([TRACTOR2], [], [p(9, 10)]))).losses;
    expect(lost).toContain("Le temps de travail passe de 2 h 30 à 2 h : les périodes simultanées sont fusionnées.");
  });
});
