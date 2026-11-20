import type { RefSource } from "../source.js";

/**
 * Infrastructures agro-écologiques (IAE) de l'indicateur biodiversité HVE
 * (item 4.1) : unité, coefficient de conversion en surface équivalente,
 * famille, prise en compte au socle (terres arables) et au poids (toute
 * l'exploitation). Plan de contrôle V4.4 annexe 2 ; grille, onglet
 * Paramètres B5:H25.
 */
export const IAE_SOURCE: RefSource = {
  text: "Plan de contrôle HVE niveau 3 V4.4 (2024), annexe 2 ; grille d'audit v1.15",
  version: "2024 ; v1.15",
  at: "annexe 2 p. 89-91 ; onglet Paramètres, B5:H25",
};

export type IaeFamily = "ligneux" | "aquatique" | "herbager" | "rocheux";
export type IaeUnit = "m" | "m2" | "tree";

export interface IaeType {
  code: string;
  label: string;
  unit: IaeUnit;
  /** m² équivalents par mètre linéaire, par arbre, ou par m². */
  coefficient: number;
  family: IaeFamily;
  /** Compte au socle (terres arables) ; toutes comptent au poids. */
  base: boolean;
  condition?: string;
}

export const IAE_TYPES: IaeType[] = [
  { code: "hedge", label: "Haie", unit: "m", coefficient: 20, family: "ligneux", base: true, condition: "largeur ≤ 20 m, arbustes ; maintien ; pas de taille du 16/03 au 15/08" },
  { code: "tree_row", label: "Alignement d'arbres", unit: "m", coefficient: 10, family: "ligneux", base: true, condition: "couronnes espacées de moins de 5 m" },
  { code: "tree", label: "Arbre isolé", unit: "tree", coefficient: 30, family: "ligneux", base: true },
  { code: "grove", label: "Bosquet", unit: "m2", coefficient: 1.5, family: "ligneux", base: true, condition: "50 ares au plus" },
  { code: "pond", label: "Mare", unit: "m2", coefficient: 1.5, family: "aquatique", base: true, condition: "50 ares au plus ; ni bassin plastique ou béton, ni retenue d'irrigation" },
  { code: "ditch", label: "Fossé non maçonné", unit: "m", coefficient: 10, family: "aquatique", base: true, condition: "10 m de large au plus ; non entretenu par la collectivité" },
  { code: "stone_wall", label: "Mur traditionnel en pierres", unit: "m", coefficient: 1, family: "rocheux", base: true, condition: "largeur 0,1-2 m, hauteur 0,5-2 m" },
  { code: "border", label: "Bordure non productive", unit: "m", coefficient: 9, family: "herbager", base: true, condition: "5 m de large au moins (1 m en lisière de forêt)" },
  { code: "fallow", label: "Jachère", unit: "m2", coefficient: 1, family: "herbager", base: true, condition: "sans production du 1/03 au 31/08, sans traitement phytosanitaire" },
  { code: "melliferous_fallow", label: "Jachère mellifère", unit: "m2", coefficient: 1.5, family: "herbager", base: true, condition: "du 15/04 au 15/10" },
  { code: "wetland", label: "Zone humide (tourbière, roselière)", unit: "m2", coefficient: 2, family: "aquatique", base: false },
  { code: "high_orchard", label: "Verger haute-tige", unit: "m2", coefficient: 3, family: "ligneux", base: false, condition: "moins de 100 arbres/ha, sans traitement phytosanitaire" },
  { code: "grass_strip", label: "Bande enherbée intra-parcellaire", unit: "m", coefficient: 9, family: "herbager", base: false, condition: "1 m de large au moins" },
  { code: "natura2000_grassland", label: "Prairie permanente, lande, parcours en Natura 2000", unit: "m2", coefficient: 1.5, family: "herbager", base: false },
  { code: "fenced_grass", label: "Zone herbacée mise en défens", unit: "m", coefficient: 9, family: "herbager", base: false, condition: "5 à 10 m de large" },
  { code: "other_surface", label: "Autre milieu surfacique", unit: "m2", coefficient: 1, family: "herbager", base: false, condition: "sans intrant ni labour depuis 5 ans" },
  { code: "other_linear", label: "Autre milieu linéaire (ruines…)", unit: "m", coefficient: 5, family: "rocheux", base: false },
];

export const IAE_BY_CODE: Record<string, IaeType> = Object.fromEntries(IAE_TYPES.map((t) => [t.code, t]));

/** Type SNA de TelePAC → type HVE proposé (à valider) ; bois (V5) et zones de densification (ZDH) ne sont pas des IAE. */
export const IAE_OF_CAP_TYPE: Record<string, string> = { V1: "tree", V2: "tree_row", V3: "grove", V4: "hedge", B2: "ditch", B3: "pond", A2: "stone_wall" };

/** Surface équivalente (m²) d'une quantité d'IAE (m, m² ou nombre d'arbres). */
export const iaeEquivalentM2 = (type: IaeType, quantity: number) => quantity * type.coefficient;
