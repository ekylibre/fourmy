import { useEffect, useRef, useState } from "react";
import type { TikaRef, TikaSystemJson } from "@fourmy/domain";
import "@osfarm/itineraire-technique/styles.css";
import "./tika.css";
import { ErrorAlert, Loading } from "../../components/states";

/**
 * Enveloppe React du rendu TIKA (@osfarm/itineraire-technique, fork ekylibre ;
 * conception des itinéraires techniques §6.2). Le module de TIKA, et ECharts
 * avec lui, n'est chargé qu'à l'affichage d'un itinéraire (N4). Le rendu est
 * libéré au démontage et à chaque changement de données (double montage de
 * StrictMode compris).
 */
export function TikaChart({ system, onIntervention }: { system: TikaSystemJson; onIntervention?: (ref: TikaRef) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onIntervention);
  callback.current = onIntervention;
  const [state, setState] = useState<"loading" | "ready" | Error>("loading");

  useEffect(() => {
    let cancelled = false;
    let renderer: { render(): void; dispose(): void } | null = null;
    const el = host.current;
    setState("loading");
    import("@osfarm/itineraire-technique")
      .then(({ RotationRenderer }) => {
        if (cancelled || !el) return;
        el.replaceChildren();
        // TIKA convertit et modifie les données reçues : on lui en donne une copie.
        const r = new RotationRenderer(el, structuredClone(system), {
          onInterventionClick: (intervention) => callback.current?.(intervention.ref as TikaRef),
        });
        r.render();
        renderer = r;
        setState("ready");
      })
      .catch((e: unknown) => !cancelled && setState(e instanceof Error ? e : new Error(String(e))));
    return () => {
      cancelled = true;
      renderer?.dispose();
      el?.replaceChildren();
    };
  }, [system]);

  return (
    <>
      {state === "loading" && <Loading />}
      {state instanceof Error && <ErrorAlert error={state} />}
      <div ref={host} className="fourmy-tika" data-testid="tika-chart" />
    </>
  );
}
