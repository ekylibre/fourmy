import { describe, it, expect } from "vitest";
import { EQUIPMENT_TYPES, avatarTemplate } from "@fourmy/contracts";
import { AVATAR_TEMPLATES, TEMPLATE_FOR_TYPE, resolveAvatar, typeFromName } from "@fourmy/equipment-3d";

/**
 * Garde-fou : chaque type de matériel porte un avatar 3D de base. Ajouter un
 * type dans EQUIPMENT_TYPES sans gabarit dans TEMPLATE_FOR_TYPE casse ce test.
 */
describe("types de matériel et avatars 3D", () => {
  it("chaque type a son gabarit, et rien d'autre", () => {
    expect(Object.keys(TEMPLATE_FOR_TYPE).sort()).toEqual(Object.keys(EQUIPMENT_TYPES).sort());
    for (const template of Object.values(TEMPLATE_FOR_TYPE)) expect(AVATAR_TEMPLATES).toContain(template);
  });

  it("le contrat accepte tous les gabarits du générateur", () => {
    expect([...avatarTemplate.options].sort()).toEqual([...AVATAR_TEMPLATES].sort());
  });

  it("le type, avec sa nature, donne l'avatar ; il l'emporte sur le nom", () => {
    for (const [type, t] of Object.entries(EQUIPMENT_TYPES)) {
      expect(resolveAvatar({ kind: t.kind, type }).params.template, type).toBe(TEMPLATE_FOR_TYPE[type]);
    }
    const a = resolveAvatar({ kind: "trailed_equipment", type: "roller", name: "Amazone UF1201" });
    expect(a.params.template).toBe("roller");
    expect(a.provenance.template).toBe("technical");
  });

  it("type proposé d'après le nom, connu du contrat", () => {
    for (const name of ["Monosem NG+3", "Maschio Tigre 300", "Amazone UF1201", "Delimbe T24", "Remorque MC18R"]) {
      const t = typeFromName(name);
      expect(t, name).not.toBeNull();
      expect(Object.keys(EQUIPMENT_TYPES), name).toContain(t);
    }
  });
});
