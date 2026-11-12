import { describe, it, expect } from "vitest";
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { AVATAR_TEMPLATES, buildAvatarGlb, inspectGlb, pngRatio, resolveAvatar, templateForKind, templateFromName, tyreDiameterM, widthFromName } from "../src/index.js";

// Extrait (anonyme) d'une fiche technique au format de la base matériel.
const technical = {
  dimensions: {
    longueur: { valeur: 4895, unite: "mm" },
    empattement: { valeur: 2564, unite: "mm" },
    largeur_min: { valeur: 2260, unite: "mm" },
    hauteur_cabine_depuis_axe_ar: { valeur: 1986, unite: "mm" },
  },
  pneumatiques: { avant_monte_base: { valeur: "13.6 R28 (340/85 R28) Marque" }, arriere_monte_base: { valeur: "16.9 R38 (420/85 R38) Marque" } },
};
// PNG 1×1 (transparent), 4:1 dans l'en-tête pour le test des proportions.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

describe("paramètres de l'avatar", () => {
  it("diamètre d'une roue depuis le pneu (métrique d'abord, sinon en pouces)", () => {
    expect(tyreDiameterM("540/65 R30")).toBe(1.46);
    expect(tyreDiameterM("16.9 R38 (420/85 R38) Trelleborg")).toBe(1.68);
    expect(tyreDiameterM("16.9 R38")).toBe(1.69);
    expect(tyreDiameterM("pneus d'origine")).toBeNull();
  });

  it("saisie > fiche technique > défaut, avec la provenance", () => {
    const r = resolveAvatar({ kind: "tractor", technical, brandColor: "#3F9A2B", saved: { widthM: 2.4, colors: { cab: "#111111" } } });
    expect(r.params).toMatchObject({ template: "tractor", lengthM: 4.89, wheelbaseM: 2.56, widthM: 2.4, rearWheelDiameterM: 1.68, frontWheelDiameterM: 1.29, heightM: 2.83 });
    expect(r.params.colors).toMatchObject({ body: "#3F9A2B", cab: "#111111" });
    // Sans saisie ni marque : les couleurs du dessin du kit.
    expect(resolveAvatar({ kind: "tractor" }).params.colors).toEqual({ body: "#3FBEE0", cab: "#5C2930", wheels: "#4F1F26", accent: "#E89E00" });
    expect(r.provenance).toMatchObject({ lengthM: "technical", widthM: "input", hitchOffsetM: "default", "colors.body": "technical", "colors.cab": "input" });
    expect(resolveAvatar({ kind: "tractor", technical }).hash).not.toBe(r.hash);
    expect(resolveAvatar({ kind: "tractor", technical, brandColor: "#3F9A2B", saved: { widthM: 2.4, colors: { cab: "#111111" } } }).hash).toBe(r.hash);
    expect(templateForKind("trailed_equipment")).toBe("trailed_tool");
  });
});

describe("modèle glTF", () => {
  it("tracteur à l'échelle, avec logo sur les flancs, relisible", async () => {
    const { params } = resolveAvatar({ kind: "tractor", technical });
    const a = await buildAvatarGlb(params, PNG);
    expect(new TextDecoder().decode(a.glb.subarray(0, 4))).toBe("glTF");
    expect(a.triangles).toBeGreaterThan(100);
    expect(a.triangles).toBeLessThan(10_000);
    // Hauteur et largeur à ± 15 cm de la fiche (roues, toit).
    expect(a.bounds.max[2]).toBeCloseTo(params.heightM, 0);
    expect(a.bounds.max[1] - a.bounds.min[1]).toBeGreaterThan(params.widthM - 0.15);
    const doc = await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(a.glb);
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain("KHR_materials_unlit");
    expect(doc.getRoot().listTextures()).toHaveLength(1);
    expect(doc.getRoot().listMaterials().map((m) => m.getName())).toContain("logo");
    expect(await inspectGlb(a.glb)).toEqual({ triangles: a.triangles });
  });

  it("outils et gabarits sans logo ; un faux GLB est refusé", async () => {
    for (const kind of ["trailed_equipment", "self_propelled_equipment", "fixed_equipment"]) {
      const a = await buildAvatarGlb(resolveAvatar({ kind }).params, null);
      expect(a.triangles).toBeGreaterThan(10);
    }
    const sprayer = resolveAvatar({ kind: "trailed_equipment", saved: { template: "trailed_sprayer", workingWidthM: 24 } }).params;
    const s = await buildAvatarGlb(sprayer);
    expect(s.bounds.max[1] - s.bounds.min[1]).toBeCloseTo(24, 0); // rampe dépliée
    await expect(inspectGlb(new TextEncoder().encode("pas un modèle"))).rejects.toThrow(/GLB/);
    expect(pngRatio(PNG)).toBe(1);
  });

  it("gabarit d'outil proposé d'après le nom ; la saisie l'emporte ; largeur lue dans le nom", () => {
    const cases: [string, string | null][] = [
      ["Monosem NG+3", "sower"],
      ["Maschio Tigre 300", "rotary_harrow"],
      ["Grégoire et Besson RB47", "plough"],
      ["Amazone UF1201", "mounted_sprayer"],
      ["Amazone ZAV 1700", "fertilizer_spreader"],
      ["Khun Discover XS32", "disc_harrow"],
      ["Rouleau Croskill 6 m", "roller"],
      ["Vibroculteur 4 m", "mounted_tool"],
      ["ETA", null],
    ];
    for (const [name, template] of cases) expect(templateFromName(name), name).toBe(template);
    expect(resolveAvatar({ kind: "trailed_equipment", name: "Monosem NG+3" }).params.template).toBe("sower");
    expect(resolveAvatar({ kind: "trailed_equipment", name: "Monosem NG+3", saved: { template: "trailed_tool" } }).params.template).toBe("trailed_tool");
    expect(resolveAvatar({ kind: "tractor", name: "Semoir ?" }).params.template).toBe("tractor"); // un tracteur reste un tracteur
    expect(widthFromName("Lansaman 4.5m")).toBe(4.5);
    expect(widthFromName("Rouleau 6,30 m")).toBe(6.3);
    expect(widthFromName("Maschio Tigre 300")).toBeNull();
    expect(resolveAvatar({ kind: "trailed_equipment", name: "Lansaman 4.5m" }).params).toMatchObject({ widthM: 4.5, workingWidthM: 4.5 });
  });

  it("chaque gabarit se construit, léger (moins de 20 000 triangles)", async () => {
    for (const template of AVATAR_TEMPLATES) {
      const { params } = resolveAvatar({ kind: "trailed_equipment", saved: { template } });
      const { glb } = await buildAvatarGlb(params, null);
      const { triangles } = await inspectGlb(glb);
      expect(triangles, template).toBeGreaterThan(10);
      expect(triangles, template).toBeLessThan(20_000);
    }
  });
});
