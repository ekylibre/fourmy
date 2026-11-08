import { render } from "@testing-library/react";
import { AGRIC_ICON_NAMES, getProcedure, PROCEDURES, SHAPE_ICONS, PROCEDURE_ICONS } from "@fourmy/contracts";
import { AGRIC_GLYPHS } from "../src/icons/agric";
import { ProcedureIcon } from "../src/components/ProcedureIcon";

/** Exigence INT-UI-1 : chaque procédure a une icône Agric dessinable. */
const USED_BY_PILOTS =
  "all_in_one_sowing raking spraying plowing harvesting equipment_maintenance fertilizing vine_spraying_without_fertilizing superficial_plowing vine_raking vine_soil_fertilizing vine_pruning vine_trunk_cleaning_debudding crop_residues_grinding vine_shearing vine_folding intervine_maintenance vine_spraying_with_fertilizing vine_shoot_extracting vine_lifting sowing vine_trimming generic_spraying vine_inter_row_grinding vine_trellising_construction vine_shoot_grinding vine_inter_row_sowing intervine_hill_removing vine_complanting intervine_hilling vine_plowing vine_wire_lifting_dropping hoeing installation_maintenance vine_grubbing vine_planting vine_stakes_replacing".split(" ");

describe("icônes des procédures", () => {
  it("toutes les icônes du catalogue ont leur dessin (sinon : node apps/web/scripts/agric-icons.mjs)", () => {
    const missing = AGRIC_ICON_NAMES.filter((n) => !AGRIC_GLYPHS[n]);
    expect(missing).toEqual([]);
  });

  it("les 37 procédures des fermes pilotes ont une icône propre", () => {
    expect(USED_BY_PILOTS).toHaveLength(37);
    for (const code of USED_BY_PILOTS) expect(PROCEDURE_ICONS[code], code).toBeDefined();
  });

  it("toute procédure du catalogue a une icône ; une procédure inconnue prend celle de sa forme", () => {
    for (const p of PROCEDURES) expect(AGRIC_GLYPHS[p.icon], p.code).toBeDefined();
    expect(getProcedure("grape_pressing").icon).toBe(SHAPE_ICONS.work);
  });

  it("décorative par défaut, annoncée avec un titre", () => {
    const { container, getByRole } = render(
      <>
        <ProcedureIcon procedure="spraying" />
        <ProcedureIcon procedure="vine_pruning" title="Taille" />
      </>,
    );
    const [decorative] = container.querySelectorAll("svg");
    expect(decorative).toHaveAttribute("aria-hidden", "true");
    expect(decorative).toHaveAttribute("data-icon", "sprayer");
    expect(getByRole("img", { name: "Taille" })).toHaveAttribute("data-icon", "cutter");
  });
});
