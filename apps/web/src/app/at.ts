import { useCallback } from "react";
import { useSearchParams } from "react-router";

/**
 * Date de la frise, portée par l'URL (`?at=AAAA-MM-JJ`) : toutes les pages
 * montrent la ferme au même instant, et un lien partagé garde la date.
 * L'instant envoyé à l'API est la fin de la journée (heure de Paris ≈ 22 h UTC
 * en été, 23 h en hiver : on prend 23:59:59 locale).
 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function endOfDay(day: string): string {
  return new Date(`${day}T23:59:59`).toISOString();
}

export function useAt(): { day: string; at: string; setDay: (day: string) => void; isToday: boolean } {
  const [params, setParams] = useSearchParams();
  const raw = params.get("at");
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayIso();
  const setDay = useCallback(
    (next: string) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (next === todayIso()) n.delete("at");
          else n.set("at", next);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { day, at: endOfDay(day), setDay, isToday: day === todayIso() };
}
