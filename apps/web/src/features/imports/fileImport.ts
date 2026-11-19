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

/** Libellé d'un import : format du fichier, sauvegarde ou reprise Ekylibre. */
export function sourceLabel(run: Pick<ImportRunView, "source" | "format">): string {
  if (run.format) return IMPORT_FORMAT_LABELS[run.format as ImportFormat];
  if (run.source.startsWith(EKYLIBRE_FILE)) return `Sauvegarde Ekylibre (${run.source.slice(EKYLIBRE_FILE.length)})`;
  return run.source.startsWith("ekylibre:") ? "Reprise Ekylibre" : run.source;
}

/** Sauvegarde de tenant Ekylibre déposée (restaurée puis migrée par le worker). */
export const EKYLIBRE_FILE = "ekylibre-file:";
export const isEkylibreBackup = (run: Pick<ImportRunView, "source">) => run.source.startsWith(EKYLIBRE_FILE);
export const EKYLIBRE_MAX_BYTES = 2 * 1024 ** 3;

/** État d'une sauvegarde Ekylibre déposée, lisible. */
export function ekylibrePhase(run: ImportRunView): string | null {
  if (!isEkylibreBackup(run)) return null;
  const r = (run.report ?? {}) as { phase?: string; progress?: number; error?: string };
  if (run.status === "failed") return "Échec";
  switch (r.phase) {
    case "queued":
      return "En attente de restauration";
    case "restoring":
      return `Restauration${r.progress ? ` : ${r.progress} %` : "…"}`;
    case "restored":
      return "Prête à importer";
    case "migrate-queued":
    case "migrating":
      return "Reprise en cours…";
    default:
      return null;
  }
}

/**
 * Dépôt d'une sauvegarde de tenant Ekylibre (jusqu'à 2 Go), envoyée telle
 * quelle avec la progression de l'envoi (XMLHttpRequest : fetch ne la donne pas).
 */
export function uploadEkylibreBackup(farmId: string, file: File, onProgress: (pct: number) => void): Promise<ImportRunView> {
  if (file.size > EKYLIBRE_MAX_BYTES) return Promise.reject(new ApiError(413, "Sauvegarde trop volumineuse", "2 Go au plus."));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${farmPath(farmId, "/imports/ekylibre/upload")}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/zip");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* corps non JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as unknown as ImportRunView);
      else reject(new ApiError(xhr.status, String(body.title ?? `Erreur ${xhr.status}`), body.detail as string | undefined));
    };
    xhr.onerror = () => reject(new ApiError(0, "Envoi interrompu", "Vérifiez la connexion et recommencez."));
    xhr.send(file);
  });
}

/** Rapport d'un import de fichier terminé (et de son annulation). */
export interface FileImportReport {
  counts?: Record<string, Record<string, number> | number>;
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
