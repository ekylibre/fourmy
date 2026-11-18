import { describe, expect, it } from "vitest";
import { modePose, nodeTransforms } from "../src/3d/tool-nodes";
import { animatedAt, hitchSpan, shapeOfTemplate, stateChanges, SWATH_COLORS, swathStrips, toolPose, transitionMs } from "../src/3d/replay";
import { linearRgb, swathGlb, swathMesh } from "../src/3d/swath-glb";
import type { Sample } from "../src/3d/geometry";

// Une passe vers le nord (10 m toutes les 5 s), un bout de champ, une passe retour.
const LAT0 = 43.39;
const LON0 = -0.2;
const M_LAT = 1 / 111_320;
const at = (sec: number, y: number, working: boolean | null, width: number | null = 18): Sample => [
  new Date(Date.UTC(2026, 9, 5, 14, 30, 0) + sec * 1000).toISOString(),
  LON0,
  LAT0 + y * M_LAT,
  working,
  width,
];
const samples: Sample[] = [at(0, 0, true), at(5, 10, true), at(10, 20, true), at(15, 25, false, null), at(20, 20, true), at(25, 10, true)];
const ms = (s: Sample) => Date.parse(s[0]);

describe("état de l'outil au rejeu", () => {
  it("bout de champ dans un parcours de travail, transport en dehors", () => {
    const sessions = [{ kind: "work" as const, from: samples[0]![0], to: samples.at(-1)![0] }];
    expect(stateChanges(samples, sessions).map((c) => c.state)).toEqual(["work", "headland", "work"]);
    expect(stateChanges(samples, []).map((c) => c.state)).toEqual(["work", "transport", "work"]);
  });

  it("un trajet entre deux parcelles pendant un parcours de travail est un transport (rampe repliée)", () => {
    // Passe, puis 1,2 km sans travailler (route vers la parcelle suivante), puis passe.
    const trip: Sample[] = [at(0, 0, true), at(5, 10, true), at(60, 400, false, null), at(120, 1200, false, null), at(125, 1210, true), at(130, 1220, true)];
    const sessions = [{ kind: "work" as const, from: trip[0]![0], to: trip.at(-1)![0] }];
    expect(stateChanges(trip, sessions).map((c) => c.state)).toEqual(["work", "transport", "work"]);
    // Le bout de champ (25 m) reste un relevage.
    expect(stateChanges(samples, sessions).map((c) => c.state)).toEqual(["work", "headland", "work"]);
  });

  it("sans parcours : un arrêt court entre deux passes est un bout de champ", () => {
    expect(stateChanges(samples).map((c) => c.state)).toEqual(["work", "headland", "work"]);
  });

  it("animation lissée entre deux états, plancher de durée en lecture accélérée", () => {
    const changes = [
      { t: 0, state: "work" as const },
      { t: 10_000, state: "transport" as const },
    ];
    const v = (t: number) => animatedAt(changes, t, 2000, (s) => (s === "work" ? 0 : 1));
    expect(v(5_000)).toBe(0);
    expect(v(11_000)).toBeCloseTo(0.5);
    expect(v(12_000)).toBe(1);
    expect(transitionMs(1)).toBe(1500);
    expect(transitionMs(60)).toBe(24_000);
  });

  it("l'outil reste affiché sur les trajets qui encadrent l'intervention", () => {
    const sessions = [
      { kind: "transit" as const, from: "2026-10-05T14:21:27Z", to: "2026-10-05T14:24:38Z" },
      { kind: "work" as const, from: "2026-10-05T14:24:43Z", to: "2026-10-05T15:46:04Z" },
      { kind: "transit" as const, from: "2026-10-05T15:47:00Z", to: "2026-10-05T15:55:00Z" },
      { kind: "transit" as const, from: "2026-10-05T17:00:00Z", to: "2026-10-05T17:10:00Z" },
    ];
    expect(hitchSpan("2026-10-05T14:24:00Z", "2026-10-05T15:46:00Z", sessions)).toEqual({ from: "2026-10-05T14:21:27.000Z", to: "2026-10-05T15:55:00.000Z" });
    expect(hitchSpan("2026-10-05T14:24:00Z", "2026-10-05T15:46:00Z", undefined)).toEqual({ from: "2026-10-05T14:24:00.000Z", to: "2026-10-05T15:46:00.000Z" });
  });

  it("pulvérisateur porté : rampe repliée en transport, relevée en bout de champ", () => {
    const changes = [
      { t: 0, state: "work" as const },
      { t: 10_000, state: "headland" as const },
      { t: 20_000, state: "transport" as const },
    ];
    expect(toolPose("mounted_sprayer", changes, 5_000, 1)).toMatchObject({ liftM: 0, fold: 0 });
    const headland = toolPose("mounted_sprayer", changes, 15_000, 1)!;
    expect(headland.liftM).toBeCloseTo(0.3);
    expect(headland.fold).toBe(0);
    expect(toolPose("mounted_sprayer", changes, 25_000, 1)!.fold).toBe(1);
    expect(toolPose("trailer", changes, 25_000, 1)).toBeNull();
  });
});

describe("rampe repliée en accordéon", () => {
  // Rotation d'un vecteur (x, z) autour de l'axe Y du glTF, puis direction en clair.
  const rotY = ([x, z]: [number, number], a: number): [number, number] => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
  const dir = ([x, z]: [number, number]) => (Math.abs(z) > Math.abs(x) ? (z > 0 ? "avant" : "arrière") : x > 0 ? "gauche" : "droite");

  it("route : tronçons vers l'avant, l'arrière, l'avant, de chaque côté ; travail : dépliée", () => {
    const road = nodeTransforms(modePose("mounted_sprayer", "road")!, true);
    for (const [side, out] of [["left", [1, 0]], ["right", [-1, 0]]] as const) {
      let total = 0;
      const dirs = [0, 1, 2].map((k) => {
        total += road[`boom_${side}${k ? `_${k + 1}` : ""}`]!.angle;
        return dir(rotY(out as [number, number], total));
      });
      expect(dirs).toEqual(["avant", "arrière", "avant"]);
    }
    const work = nodeTransforms(modePose("mounted_sprayer", "work")!, true);
    expect(Object.values(work).every((n) => n.angle === 0 && n.translation.every((v) => v === 0))).toBe(true);
    expect(modePose("mounted_sprayer", "road")!.liftM).toBeGreaterThan(0);
    expect(modePose("trailer", "road")).toBeNull();
    expect(Object.keys(nodeTransforms(modePose("sower", "road")!, false))).toEqual(["lift"]);
  });
});

describe("bande travaillée", () => {
  const tools = [{ from: samples[0]![0], to: samples.at(-1)![0], offsetM: 0, workingWidthM: 12, shape: "treatment" as const, template: "mounted_sprayer" }];

  it("une bande par passe, de la largeur du boîtier, derrière l'outil", () => {
    const strips = swathStrips(samples, tools, { extraOffsetM: 0 });
    expect(strips).toHaveLength(2);
    const first = strips[0]!;
    expect(first.color).toBe(SWATH_COLORS.treatment);
    expect(first.widthM).toBe(18);
    expect(first.times).toEqual([ms(samples[0]!), ms(samples[1]!), ms(samples[2]!)]);
    // Cap au nord : gauche à l'ouest, droite à l'est, 18 m d'écart.
    const mPerLon = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
    expect((first.right[1]![0] - first.left[1]![0]) * mPerLon).toBeCloseTo(18, 1);
    expect(first.left[1]![0]).toBeLessThan(LON0);
  });

  it("largeur : boîtier, sinon fiche de l'outil, sinon défaut ; couleur d'après le gabarit sans intervention", () => {
    const noWidth = samples.map((s) => [s[0], s[1], s[2], s[3], null] as Sample);
    expect(swathStrips(noWidth, tools)[0]!.widthM).toBe(12);
    const bare = swathStrips(noWidth, [{ ...tools[0]!, workingWidthM: null, shape: null }], { defaultWidthM: 4 })[0]!;
    expect(bare.widthM).toBe(4);
    expect(bare.color).toBe(SWATH_COLORS.treatment);
    expect(shapeOfTemplate("sower")).toBe("sowing");
    expect(shapeOfTemplate(null)).toBe("work");
  });

  it("plafond : les points sont espacés, les bouts de passe gardés", () => {
    const long = Array.from({ length: 101 }, (_, i) => at(i * 5, i * 10, true));
    const strip = swathStrips(long, tools, { maxPairs: 20 })[0]!;
    expect(strip.times.length).toBeLessThanOrEqual(22);
    expect(strip.times.at(-1)).toBe(ms(long.at(-1)!));
  });

  it("maillage et glTF : deux sommets par paire, deux triangles par intervalle, instant en secondes", () => {
    const strips = swathStrips(samples, tools, { extraOffsetM: 0 });
    const mesh = swathMesh(strips, ([lon, lat]) => [lon, lat, 0], ms(samples[0]!));
    expect(mesh.times.length).toBe(10); // 3 + 2 paires
    expect(mesh.indices.length).toBe((2 + 1) * 6);
    expect(Array.from(mesh.times.slice(0, 2))).toEqual([0, 0]);
    expect(mesh.times[2]).toBe(5);
    expect(Array.from(mesh.colors.slice(0, 3))).toEqual(linearRgb(SWATH_COLORS.treatment).map((c) => Math.fround(c)));
    const glb = swathGlb(mesh);
    const dv = new DataView(glb.buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + dv.getUint32(12, true))));
    expect(json.meshes[0].primitives[0].attributes).toEqual({ POSITION: 0, COLOR_0: 1, _TIME: 2 });
    expect(json.materials[0].alphaMode).toBe("BLEND");
  });
});
