import type { Intervention } from "@fourmy/contracts";
import { TREATMENT_PURPOSE_LABELS } from "@fourmy/contracts";
import { procedureLabel } from "../../app/labels";
import { targetName, type Names } from "./presenters";

/**
 * Recherche rapide des interventions (exigence INT-UI-5) : intervention,
 * parcelle, produit (nom ou n° AMM), matériel, intervenant, motif, notes.
 * Insensible aux accents et à la casse ; tous les mots tapés doivent se
 * retrouver (« taille rouffiats » trouve la taille des Rouffiats).
 */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Texte indexé d'une intervention (calculé une fois par liste). */
export function searchText(i: Intervention, names: Names): string {
  const parts = [
    procedureLabel(i.procedure),
    ...i.targets.map((t) => targetName(names, t)),
    ...[...i.inputs, ...i.outputs].flatMap((q) => {
      const a = names.article.get(q.articleId);
      return a ? [a.name, a.amm ?? ""] : [];
    }),
    ...i.tools.map((t) => names.equipment.get(t.equipmentId) ?? ""),
    ...i.doers.map((d) => names.person.get(d.personId) ?? ""),
    ...i.purposes.map((p) => TREATMENT_PURPOSE_LABELS[p]),
    i.notes ?? "",
  ];
  return normalize(parts.join(" \u0001 "));
}

/** Filtre : chaque mot de la requête doit apparaître dans le texte indexé. */
export function makeMatcher(query: string): ((text: string) => boolean) | null {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return (text) => words.every((w) => text.includes(w));
}
