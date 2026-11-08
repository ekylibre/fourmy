import type {
  ArticleKind,
  InterventionCompleteWrite,
  InterventionPlanWrite,
  ProcedureDefinition,
  TargetKind,
} from "@fourmy/contracts";
import { SHAPE_LABELS } from "@fourmy/contracts";

/**
 * Règles de forme d'une intervention (docs/interventions.md §4.3). Fonction
 * pure, partagée par l'API, le web et le mobile : ce que le mobile accepte
 * hors ligne, le serveur l'acceptera. Renvoie la liste des problèmes
 * (vide = valide). À la planification, seules les incompatibilités sont
 * vérifiées ; les minimums (au moins un phyto, une période…) le sont à la
 * réalisation.
 */
export interface RuleContext {
  /** Nature de chaque article référencé (intrants, sorties). */
  articleKind: (articleId: string) => ArticleKind | undefined;
}

type Body = Pick<InterventionCompleteWrite, "periods" | "targets" | "inputs" | "outputs" | "purposes"> &
  Partial<Pick<InterventionPlanWrite, "procedure">>;

const MIN_INPUT_KIND: Partial<Record<ProcedureDefinition["shape"], ArticleKind>> = {
  treatment: "phyto",
  fertilization: "fertilizer",
  sowing: "seed",
};

const KIND_LABELS: Record<ArticleKind, string> = {
  phyto: "produit phytosanitaire",
  fertilizer: "fertilisant",
  seed: "semence ou plant",
  harvest: "récolte",
  wine: "vin",
  part: "pièce",
  fluid: "fluide (huile, graisse…)",
  other: "fourniture",
};

export function validateIntervention(
  procedure: ProcedureDefinition,
  body: Body,
  mode: "plan" | "complete",
  ctx: RuleContext,
): string[] {
  const errors: string[] = [];
  const shape = SHAPE_LABELS[procedure.shape].toLowerCase();

  // Cibles : parcelles, ou matériel / bâtiment pour un entretien.
  const allowedTargets: TargetKind[] = procedure.shape === "maintenance" ? ["equipment", "place", "container"] : ["land_parcel"];
  for (const t of body.targets) {
    if (!allowedTargets.includes(t.kind)) {
      errors.push(
        procedure.shape === "maintenance"
          ? "Un entretien porte sur un matériel ou un bâtiment, pas sur une parcelle."
          : `« ${procedure.label} » porte sur des parcelles.`,
      );
      break;
    }
  }
  if (mode === "complete" && body.targets.length === 0) {
    errors.push(procedure.shape === "maintenance" ? "Choisissez le matériel ou le bâtiment entretenu." : "Choisissez au moins une parcelle.");
  }

  // Intrants : natures acceptées par la procédure.
  const inputKinds = body.inputs.map((i) => ctx.articleKind(i.articleId));
  inputKinds.forEach((k, idx) => {
    if (!k) errors.push(`Intrant n° ${idx + 1} : article inconnu.`);
    else if (!procedure.inputKinds.includes(k)) errors.push(`« ${procedure.label} » n'accepte pas de ${KIND_LABELS[k]} en intrant.`);
  });
  const required = MIN_INPUT_KIND[procedure.shape];
  if (mode === "complete" && required && !inputKinds.includes(required)) {
    errors.push(`Un ${shape} demande au moins un ${KIND_LABELS[required]}.`);
  }

  // Sorties : natures acceptées, destination à la réalisation.
  body.outputs.forEach((o, idx) => {
    const k = ctx.articleKind(o.articleId);
    if (!k) errors.push(`Sortie n° ${idx + 1} : article inconnu.`);
    else if (!procedure.outputKinds.includes(k)) errors.push(`« ${procedure.label} » ne produit pas de ${KIND_LABELS[k]}.`);
    if (mode === "complete" && !o.to?.placeId && !o.to?.containerId) {
      errors.push(`Sortie n° ${idx + 1} : précisez où elle est rangée (lieu ou cuve).`);
    }
  });
  if (mode === "complete" && procedure.shape === "harvest" && body.outputs.length === 0) {
    errors.push("Une récolte demande au moins un produit récolté.");
  }

  // Motifs : réservés aux traitements.
  if (body.purposes.length > 0 && procedure.shape !== "treatment") {
    errors.push("Les motifs (herbicide, fongicide…) ne concernent que les traitements.");
  }

  // Périodes : ordonnées, sans chevauchement ; au moins une à la réalisation.
  if (mode === "complete" && body.periods.length === 0) errors.push("Au moins une période de travail.");
  const sorted = [...body.periods].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  sorted.forEach((p, idx) => {
    if (Date.parse(p.stoppedAt) <= Date.parse(p.startedAt)) errors.push(`Période n° ${idx + 1} : la fin doit suivre le début.`);
    const next = sorted[idx + 1];
    if (next && Date.parse(next.startedAt) < Date.parse(p.stoppedAt)) errors.push("Deux périodes de travail se chevauchent.");
  });

  return [...new Set(errors)];
}

/** Début de la première période, fin de la dernière. */
export function periodBounds(periods: { startedAt: string; stoppedAt: string }[]): { startedAt: string | null; stoppedAt: string | null } {
  if (periods.length === 0) return { startedAt: null, stoppedAt: null };
  const starts = periods.map((p) => p.startedAt).sort();
  const stops = periods.map((p) => p.stoppedAt).sort();
  return { startedAt: starts[0]!, stoppedAt: stops.at(-1)! };
}

/** Unité stockée : unité de l'article, suffixée « _per_hectare » pour une dose. */
export function storedUnit(articleUnit: string, per: "total" | "hectare"): string {
  return per === "hectare" ? `${articleUnit}_per_hectare` : articleUnit;
}

/** Inverse de {@link storedUnit} (lecture, migration). */
export function splitUnit(unit: string | null): { unit: string; per: "total" | "hectare" } {
  if (!unit) return { unit: "", per: "total" };
  const m = /^(.+)_per_hectare$/.exec(unit);
  return m ? { unit: m[1]!, per: "hectare" } : { unit, per: "total" };
}
