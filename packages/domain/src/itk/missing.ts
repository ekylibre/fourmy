import type { ItkContent, ItkMissing } from "@fourmy/contracts";

/**
 * Éléments d'un ITK qui n'existent plus (ou plus actifs) dans la ferme
 * (conception §4.3) : gardés dans le document, signalés « à remplacer ».
 */
export function itkMissing(
  content: Pick<ItkContent, "steps">,
  known: { articles: ReadonlySet<string>; equipments: ReadonlySet<string>; people: ReadonlySet<string>; crewTemplates: ReadonlySet<string> },
): ItkMissing[] {
  const out: ItkMissing[] = [];
  for (const s of content.steps) {
    for (const i of s.inputs) if (i.articleId && !known.articles.has(i.articleId)) out.push({ stepId: s.id, kind: "article", id: i.articleId, label: i.label });
    for (const id of s.staffing.equipmentIds) if (!known.equipments.has(id)) out.push({ stepId: s.id, kind: "equipment", id, label: null });
    for (const id of s.staffing.personIds) if (!known.people.has(id)) out.push({ stepId: s.id, kind: "person", id, label: null });
    const t = s.staffing.crewTemplateId;
    if (t && !known.crewTemplates.has(t)) out.push({ stepId: s.id, kind: "crew_template", id: t, label: null });
  }
  return out;
}

/** Identifiants référencés par un ITK, pour vérifier qu'ils sont de la ferme. */
export function itkReferences(content: Pick<ItkContent, "steps">) {
  const articles = new Set<string>();
  const equipments = new Set<string>();
  const people = new Set<string>();
  const crewTemplates = new Set<string>();
  for (const s of content.steps) {
    for (const i of s.inputs) if (i.articleId) articles.add(i.articleId);
    for (const id of s.staffing.equipmentIds) equipments.add(id);
    for (const id of s.staffing.personIds) people.add(id);
    if (s.staffing.crewTemplateId) crewTemplates.add(s.staffing.crewTemplateId);
  }
  return { articles, equipments, people, crewTemplates };
}
