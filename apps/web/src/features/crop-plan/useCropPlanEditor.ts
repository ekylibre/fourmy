import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CropPlanContext, CropPlanDraft, CropPlanParcelKey, CropPlanView } from "@fourmy/contracts";
import { checkCropPlan, cropPlanCheckInput, summarizeCropPlan, type CropPlanActivity } from "@fourmy/domain";
import { api, ApiError, farmPath } from "../../app/api";
import { cropPlanKeys } from "./queries";

/**
 * Brouillon de l'assolement dans l'écran (conception §7) : gestes, annuler et
 * rétablir, sauvegarde au fil de l'eau (800 ms après le dernier geste), conflit
 * de révision (409), contrôles et récapitulatif recalculés à chaque geste.
 */

export type SaveState = "saved" | "pending" | "saving" | "conflict" | "error";

const SAVE_DELAY = 800;
const UNDO_LIMIT = 100;

export interface AssignOptions {
  startedOn: string | null;
  stoppedOn: string | null;
  /** Itinéraire technique (lot IT3) ; null ou absent : aucun. */
  itineraryId?: string | null;
}

let seq = 0;
const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Affecte une activité (culture principale) aux parcelles : l'affectation existante est modifiée (sa production est gardée). */
export function assignMain(draft: CropPlanDraft, keys: CropPlanParcelKey[], activityId: string, opts: AssignOptions): CropPlanDraft {
  const set = new Set<string>(keys);
  const assignments = [...draft.assignments];
  for (const key of keys) {
    const i = assignments.findIndex((a) => a.key === key && a.role === "main");
    const itk = opts.itineraryId ? { itineraryId: opts.itineraryId } : {};
    if (i >= 0) {
      const { itineraryId: _old, ...rest } = assignments[i]!;
      void _old;
      assignments[i] = { ...rest, activityId, startedOn: opts.startedOn, stoppedOn: opts.stoppedOn, ...itk };
    } else assignments.push({ id: newId(), key, role: "main", activityId, startedOn: opts.startedOn, stoppedOn: opts.stoppedOn, ...itk });
  }
  return { ...draft, assignments, fallow: draft.fallow.filter((f) => !set.has(f.key)) };
}

/** Ajoute une culture dérobée (après la principale) aux parcelles. */
export function addSecondary(draft: CropPlanDraft, keys: CropPlanParcelKey[], activityId: string, opts: AssignOptions): CropPlanDraft {
  const added = keys
    .filter((key) => !draft.assignments.some((a) => a.key === key && a.role === "secondary" && a.activityId === activityId))
    .map((key) => ({ id: newId(), key, role: "secondary" as const, activityId, startedOn: opts.startedOn, stoppedOn: opts.stoppedOn }));
  return { ...draft, assignments: [...draft.assignments, ...added] };
}

/** « Sans culture » (jachère) : retire les cultures principales. */
export function markFallow(draft: CropPlanDraft, keys: CropPlanParcelKey[]): CropPlanDraft {
  const set = new Set<string>(keys);
  return {
    ...draft,
    assignments: draft.assignments.filter((a) => !(set.has(a.key) && a.role === "main")),
    fallow: [...draft.fallow.filter((f) => !set.has(f.key)), ...keys.map((key) => ({ key, capCode: "JAC" }))],
  };
}

/** Retire toutes les cultures prévues des parcelles, couverts compris. */
export function clearParcels(draft: CropPlanDraft, keys: CropPlanParcelKey[]): CropPlanDraft {
  const set = new Set<string>(keys);
  return {
    ...draft,
    assignments: draft.assignments.filter((a) => !set.has(a.key)),
    fallow: draft.fallow.filter((f) => !set.has(f.key)),
    covers: draft.covers.filter((c) => !set.has(c.key)),
  };
}

export type CoverInput = Omit<CropPlanDraft["covers"][number], "id" | "key" | "coverId">;

/** Couvert d'interculture après la culture : un par parcelle, il remplace l'éventuel précédent (sa fiche du cahier est gardée). */
export function setCover(draft: CropPlanDraft, keys: CropPlanParcelKey[], cover: CoverInput): CropPlanDraft {
  const set = new Set<string>(keys);
  const kept = draft.covers.filter((c) => !set.has(c.key));
  const replaced = keys.map((key) => {
    const before = draft.covers.find((c) => c.key === key);
    return { ...cover, id: before?.id ?? newId(), key, ...(before?.coverId ? { coverId: before.coverId } : {}) };
  });
  return { ...draft, covers: [...kept, ...replaced] };
}

export function useCropPlanEditor(farmId: string, year: number, plan: CropPlanView, context: CropPlanContext, editable: boolean) {
  const qc = useQueryClient();
  const [hist, setHist] = useState<{ draft: CropPlanDraft; past: CropPlanDraft[]; future: CropPlanDraft[] }>({ draft: plan.draft, past: [], future: [] });
  const draft = hist.draft;
  const [revision, setRevision] = useState(plan.revision);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = useRef(false);

  // Nouveau brouillon venu du serveur (création, réouverture, rechargement après conflit).
  useEffect(() => {
    setHist({ draft: plan.draft, past: [], future: [] });
    setRevision(plan.revision);
    setSaveState("saved");
    dirty.current = false;
  }, [plan]);

  const touched = () => {
    dirty.current = true;
    setSaveState("pending");
  };

  const apply = useCallback(
    (change: (d: CropPlanDraft) => CropPlanDraft) => {
      if (!editable) return;
      const next = change(hist.draft);
      if (next === hist.draft) return;
      setHist({ draft: next, past: [...hist.past.slice(-UNDO_LIMIT + 1), hist.draft], future: [] });
      touched();
    },
    [editable, hist],
  );

  const undo = useCallback(() => {
    const prev = hist.past.at(-1);
    if (!prev) return;
    setHist({ draft: prev, past: hist.past.slice(0, -1), future: [hist.draft, ...hist.future] });
    touched();
  }, [hist]);

  const redo = useCallback(() => {
    const next = hist.future[0];
    if (!next) return;
    setHist({ draft: next, past: [...hist.past, hist.draft], future: hist.future.slice(1) });
    touched();
  }, [hist]);

  // Sauvegarde au fil de l'eau.
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const save = useCallback(
    async (d: CropPlanDraft) => {
      setSaveState("saving");
      try {
        const saved = await api.put<CropPlanView>(farmPath(farmId, `/crop-plans/${year}/draft`), { revision: revisionRef.current, draft: d });
        setRevision(saved.revision);
        dirty.current = false;
        setSaveState((s) => (s === "saving" ? "saved" : s));
        setSaveError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setSaveState("conflict");
        } else {
          setSaveState("error");
          setSaveError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [farmId, year],
  );
  useEffect(() => {
    if (!editable || !dirty.current || saveState !== "pending") return;
    const t = setTimeout(() => void save(draft), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, editable, save, saveState]);

  /** Conflit : recharger l'assolement du serveur (les gestes locaux sont perdus). */
  const reload = useCallback(() => qc.invalidateQueries({ queryKey: cropPlanKeys.plan(farmId, year) }), [qc, farmId, year]);
  /** Conflit : garder mon brouillon et l'enregistrer sur la révision du serveur. */
  const overwrite = useCallback(async () => {
    const current = await api.get<CropPlanView>(farmPath(farmId, `/crop-plans/${year}`));
    revisionRef.current = current.revision;
    setRevision(current.revision);
    await save(draft);
  }, [farmId, year, draft, save]);
  /** Enregistre tout de suite (avant la validation). */
  const flush = useCallback(async () => {
    if (dirty.current) await save(draft);
    return revisionRef.current;
  }, [draft, save]);

  const activities = useMemo(() => new Map<string, CropPlanActivity>(context.activities.map((a) => [a.id, a])), [context]);
  const previous = useMemo(() => new Map(Object.entries(context.previousByActivity)), [context]);
  const result = useMemo(() => checkCropPlan(cropPlanCheckInput(context, draft)), [context, draft]);
  const summary = useMemo(() => summarizeCropPlan(result.plan.parcels, draft, activities, previous), [result, draft, activities, previous]);

  return {
    draft,
    revision,
    apply,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    saveState,
    saveError,
    reload,
    overwrite,
    flush,
    activities,
    plan: result.plan,
    sections: result.sections,
    summary,
  };
}

export type CropPlanEditor = ReturnType<typeof useCropPlanEditor>;
