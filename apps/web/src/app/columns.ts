import { useCallback, useMemo, useState } from "react";

/**
 * Colonnes affichées d'une liste (retours du 10/11/2026, décision D3) :
 * préférence de confort, par poste et par liste, gardée dans le navigateur.
 * On mémorise les colonnes **masquées** : une colonne ajoutée plus tard
 * apparaît d'elle-même. Stockage indisponible (navigation privée) : la
 * liste reste utilisable, le choix vaut pour la page ouverte.
 */
export interface ColumnDef {
  key: string;
  label: string;
  /** Toujours affichée (nom, actions) : absente du choix. */
  required?: boolean;
  /** Masquée tant que l'utilisateur ne l'a pas demandée. */
  defaultHidden?: boolean;
}

export interface Columns {
  defs: ColumnDef[];
  visible: (key: string) => boolean;
  toggle: (key: string) => void;
  reset: () => void;
  /** Nombre de colonnes affichées (pour un `colSpan`). */
  count: number;
}

const storageKey = (list: string) => `fourmy.columns.${list}`;

function read(list: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(list));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : null;
  } catch {
    return null;
  }
}

function write(list: string, hidden: string[] | null) {
  try {
    if (hidden === null) window.localStorage.removeItem(storageKey(list));
    else window.localStorage.setItem(storageKey(list), JSON.stringify(hidden));
  } catch {
    // stockage indisponible : choix limité à la page
  }
}

export function defaultHidden(defs: ColumnDef[]): string[] {
  return defs.filter((d) => d.defaultHidden && !d.required).map((d) => d.key);
}

export function useColumns(list: string, defs: ColumnDef[]): Columns {
  const [hidden, setHidden] = useState<string[]>(() => read(list) ?? defaultHidden(defs));
  const required = useMemo(() => new Set(defs.filter((d) => d.required).map((d) => d.key)), [defs]);
  const visible = useCallback((key: string) => required.has(key) || !hidden.includes(key), [hidden, required]);
  const toggle = useCallback(
    (key: string) => {
      if (required.has(key)) return;
      setHidden((h) => {
        const next = h.includes(key) ? h.filter((k) => k !== key) : [...h, key];
        write(list, next);
        return next;
      });
    },
    [list, required],
  );
  const reset = useCallback(() => {
    write(list, null);
    setHidden(defaultHidden(defs));
  }, [list, defs]);
  return { defs, visible, toggle, reset, count: defs.filter((d) => visible(d.key)).length };
}
