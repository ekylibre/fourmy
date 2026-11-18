import { parse } from "yaml";
import raw from "../content/comparatif.yaml?raw";
import { features } from "./site";

export type Status = "oui" | "partiel" | "non" | "nt";
export interface Cell {
  s: Status;
  /** Justification courte. */
  t?: string;
  /** Page de l'éditeur qui la justifie. */
  u?: string;
  /** Fonctionnalité de Fourmy (id de features.yaml). */
  f?: string;
}
export interface Product {
  id: string;
  nom: string;
  url: string;
  base: string;
}
export interface Criterion {
  nom: string;
  fourmy: Cell;
  [product: string]: Cell | string;
}
export interface Price {
  id: string;
  prix: string;
  detail: string;
  u?: string;
}
export interface Comparison {
  date: string;
  tarifs: Price[];
  logiciels: Product[];
  groupes: { titre: string; criteres: Criterion[] }[];
}

const STATUSES: Status[] = ["oui", "partiel", "non", "nt"];
export const comparison = parse(raw) as Comparison;
for (const g of comparison.groupes)
  for (const c of g.criteres)
    for (const id of ["fourmy", ...comparison.logiciels.map((l) => l.id)]) {
      const cell = c[id] as Cell | undefined;
      if (!cell || !STATUSES.includes(cell.s)) throw new Error(`comparatif.yaml : case invalide (${c.nom}, ${id})`);
      if (id !== "fourmy" && cell.s !== "nt" && !cell.u) throw new Error(`comparatif.yaml : source manquante (${c.nom}, ${id})`);
      if (cell.f && !features.some((f) => f.id === cell.f)) throw new Error(`comparatif.yaml : fonctionnalité inconnue (${cell.f})`);
    }

for (const t of comparison.tarifs)
  if (t.id !== "fourmy" && !t.u) throw new Error(`comparatif.yaml : source du prix manquante (${t.id})`);

export const STATUS_TEXT: Record<Status, string> = { oui: "oui", partiel: "en partie", non: "non", nt: "non trouvé chez l'éditeur" };
export const STATUS_MARK: Record<Status, string> = { oui: "✓", partiel: "", non: "✕", nt: "·" };
