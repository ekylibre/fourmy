import { IMPORT_FORMAT_LABELS, type ImportFormat, type ImportRunStatus, type ImportRunView } from "@fourmy/contracts";
import { ApiError, farmPath } from "../../app/api";

const BASE = `${globalThis.location?.origin ?? ""}/api/v1`;

/** Taille maximale d'un fichier déposé (celle de l'API). */
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;

/** Dépôt d'un fichier (multipart) : l'API le reconnaît, le lit et rend l'import « analysé ». */
export async function uploadImportFile(farmId: string, file: File): Promise<ImportRunView> {
  if (file.size > IMPORT_MAX_BYTES) throw new ApiError(413, "Fichier trop gros", "50 Mo au plus.");
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`${BASE}${farmPath(farmId, "/imports/files")}`, { method: "POST", body: form, credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.title ?? `Erreur ${res.status}`, body.detail);
  }
  return res.json();
}

export const RUN_STATUS_LABELS: Record<ImportRunStatus, { label: string; color: string }> = {
  analyzed: { label: "À valider", color: "paille" },
  running: { label: "En cours", color: "paille" },
  completed: { label: "Terminé", color: "lichen" },
  failed: { label: "Échec", color: "brique" },
  discarded: { label: "Abandonné", color: "gray" },
  reverting: { label: "Annulation…", color: "paille" },
  reverted: { label: "Annulé", color: "gray" },
};

/** Libellé d'un import : format du fichier, ou reprise Ekylibre. */
export function sourceLabel(run: Pick<ImportRunView, "source" | "format">): string {
  if (run.format) return IMPORT_FORMAT_LABELS[run.format as ImportFormat];
  return run.source.startsWith("ekylibre:") ? "Reprise Ekylibre" : run.source;
}

/** Rapport d'un import de fichier terminé (et de son annulation). */
export interface FileImportReport {
  counts?: Record<string, Record<string, number>>;
  failures?: { label: string; on: string; reason: string }[];
  skipped?: { label: string; on: string; reason: string }[];
  compliance?: { phytoDanger: number; nitrateDanger: number };
  warnings?: { level: string; message: string }[];
  error?: string;
  revert?: RevertReport;
}

export interface RevertReport {
  deleted: Record<string, number>;
  kept: { entity: string; count: number; reason: string }[];
}

/** Noms des comptes du rapport. */
export const COUNT_LABELS: Record<string, string> = {
  parcels: "Parcelles",
  productions: "Cultures",
  history: "Cultures des campagnes passées",
  covers: "Couverts d'interculture",
  landscape: "Haies, arbres et autres éléments",
  activities: "Activités",
  articles: "Articles",
  people: "Personnes",
  campaigns: "Campagnes",
  capRefs: "Références PAC",
  interventions: "Interventions",
  intervention: "Interventions",
  landscape_feature: "Éléments du paysage",
  cover_crop: "Couverts",
  production: "Cultures",
  land_parcel: "Parcelles",
  activity: "Activités",
  article: "Articles",
  person: "Personnes",
  campaign: "Campagnes",
  parcel_reference: "Références PAC",
};
