import { parse } from "yaml";
import featuresRaw from "../content/features.yaml?raw";

/** Adresse de l'application (bouton « Se connecter »). */
export const APP_URL = import.meta.env.PUBLIC_APP_URL ?? "https://dev.fourmy.org";

/** Dépôt du code source. */
export const REPO_URL = "https://github.com/ekylibre/fourmy";

export type FeatureStatus = "disponible" | "en-test" | "a-venir";

export interface Module {
  id: string;
  title: string;
  text: string;
}

export interface Feature {
  id: string;
  /** Module de l'application (ordre du menu). */
  module: string;
  title: string;
  text: string;
  status: FeatureStatus;
  /** Nom de la capture (src/assets/captures/<capture>.png), facultatif. */
  capture?: string;
  /** Version d'arrivée (changelog). */
  since?: string;
}

const STATUSES: FeatureStatus[] = ["disponible", "en-test", "a-venir"];

function load<T>(raw: string, key: string): T[] {
  const data = parse(raw) as Record<string, T[]>;
  if (!Array.isArray(data?.[key])) throw new Error(`${key} : liste attendue`);
  return data[key]!;
}

export const modules = load<Module>(featuresRaw, "modules");
export const features = load<Feature>(featuresRaw, "features");
for (const f of features) {
  if (!f.id || !f.title || !f.text || !STATUSES.includes(f.status)) throw new Error(`features.yaml : entrée invalide (${f.id})`);
  if (!modules.some((m) => m.id === f.module)) throw new Error(`features.yaml : module inconnu pour ${f.id} (${f.module})`);
}

export const STATUS_LABELS: Record<string, string> = {
  disponible: "Disponible",
  "en-test": "En test",
  "a-venir": "À venir",
};
