import type { FarmCertification, GeocodeType } from "@fourmy/contracts";

/**
 * « Ma ferme » (claudedocs/conception_ma_ferme.md §4.2) : qualité d'un point
 * géocodé, échéances des certificats.
 */

/** Précis : numéro ou rue avec un score d'au moins 0,7. Sinon à vérifier sur la carte (E7). */
export function geocodeQuality(score: number, type: GeocodeType): "precise" | "approximate" {
  return (type === "housenumber" || type === "street") && score >= 0.7 ? "precise" : "approximate";
}

/** Délai d'alerte avant l'échéance d'un certificat (E8). */
export const CERTIFICATION_ALERT_DAYS = 60;

/** Certificats expirés ou qui expirent dans moins de 60 jours, le plus proche d'abord. */
export function certificationAlerts(certs: FarmCertification[], today: string): (FarmCertification & { daysLeft: number })[] {
  const t0 = Date.parse(`${today}T00:00:00Z`);
  return certs
    .filter((c): c is FarmCertification & { expiresOn: string } => c.expiresOn !== null)
    .map((c) => ({ ...c, daysLeft: Math.round((Date.parse(`${c.expiresOn}T00:00:00Z`) - t0) / 86_400_000) }))
    .filter((c) => c.daysLeft < CERTIFICATION_ALERT_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
