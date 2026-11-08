import { useEffect, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import type { Measure } from "@fourmy/carto";
import { CartoEditor, type CartoTool } from "./editor";

/** État React d'un éditeur carto branché sur une carte prête (`load` reçu). */
export interface CartoState {
  editor: CartoEditor | null;
  tool: CartoTool;
  selection: string[];
  measure: Measure | null;
  error: string | null;
  features: Feature<Polygon>[];
  canUndo: boolean;
  setTool: (tool: CartoTool) => void;
  clearError: () => void;
}

export function useCartoEditor(map: MlMap | null, initial: Feature<Polygon>[] | null): CartoState {
  const [editor, setEditor] = useState<CartoEditor | null>(null);
  const [tool, setToolState] = useState<CartoTool>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<Feature<Polygon>[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    if (!map) return;
    const e = new CartoEditor(map, {
      onChange: (f) => {
        setFeatures(f);
        setCanUndo(e.canUndo());
        setError(null);
      },
      onSelection: setSelection,
      onMeasure: setMeasure,
      onError: setError,
    });
    setEditor(e);
    return () => {
      e.destroy();
      setEditor(null);
    };
  }, [map]);

  useEffect(() => {
    if (!editor || !initial) return;
    editor.load(initial);
    setFeatures(editor.features());
    setCanUndo(false);
  }, [editor, initial]);

  return {
    editor,
    tool,
    selection,
    measure,
    error,
    features,
    canUndo,
    setTool: (t) => {
      editor?.setTool(t);
      setToolState(t);
      setError(null);
    },
    clearError: () => setError(null),
  };
}
