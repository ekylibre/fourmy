import { describe, expect, it } from "vitest";
import { efficiencyGrid, efficiencyMessage, mineralFormOf } from "../src/fertilization/index.js";

describe("grille d'efficacité des apports d'azote minéral (COMIFER 2022)", () => {
  const full = { ph: 6.5, cecMeq: 10, coverOver50: false, rain3dMm: 2, windKmh: 25, temperatureC: 15 };
  it("note : 0 + 2 + 0 + 4 + 2 + 6 = 14 ; qualité selon la forme", () => {
    expect(efficiencyGrid({ form: "uan", ...full })).toMatchObject({ score: [14, 14], quality: ["avoid", "avoid"] });
    expect(efficiencyGrid({ form: "urea", ...full }).quality).toEqual(["limit", "limit"]);
    expect(efficiencyGrid({ form: "ammonitrate", ...full }).quality).toEqual(["medium", "medium"]);
  });
  it("bonnes conditions : pluie prévue, couvert développé, frais", () => {
    expect(efficiencyGrid({ form: "uan", ph: 6.5, cecMeq: 15, coverOver50: true, rain3dMm: 15, windKmh: 10, temperatureC: 8 })).toMatchObject({ score: [1, 1], quality: ["good", "good"] });
  });
  it("donnée inconnue : fourchette de note et de qualité", () => {
    const r = efficiencyGrid({ form: "uan", ph: null, cecMeq: null, coverOver50: null, rain3dMm: 15, windKmh: 10, temperatureC: 8 });
    expect(r).toMatchObject({ score: [1, 8], quality: ["good", "medium"] });
    expect(efficiencyMessage(r)).toBe(
      "Efficacité de l'apport (solution azotée, grille COMIFER 2022) : note entre 1 et 8, de « bonnes conditions d'apport, efficacité optimale » à « conditions moyennes, pertes d'efficacité possibles ». D'après : pluie prévue à 3 jours 15 mm, vent 10 km/h, température du jour 8 °C. Inconnu : pH du sol, CEC, couverture du sol par la culture.",
    );
  });
  it("forme d'après le nom ; NPK et engrais hors grille : null", () => {
    const iii = { nitrateType: "III", basis: "mass_percent" };
    expect(mineralFormOf({ name: "Urée 46" }, iii)).toBe("urea");
    expect(mineralFormOf({ name: "Urée NBPT 46" }, iii)).toBe("urea_inhibitor");
    expect(mineralFormOf({ name: "Solution azotée 390" }, iii)).toBe("uan");
    expect(mineralFormOf({ name: "Ammonitrate 33,5" }, iii)).toBe("ammonitrate");
    expect(mineralFormOf({ name: "x", lexiconRef: "liquid_nitrogen_30_d1.3" }, iii)).toBe("uan");
    expect(mineralFormOf({ name: "9-23-30 S" }, iii)).toBeNull();
    expect(mineralFormOf({ name: "Lisier" }, { nitrateType: "II", basis: "kg_per_m3" })).toBeNull();
  });
});
