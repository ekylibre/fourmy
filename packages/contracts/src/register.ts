/**
 * Registre d'utilisation des produits phytopharmaceutiques au format
 * réglementaire (lot X) : arrêté du 24/12/2025 (JORFTEXT000053228465) et
 * notice ministérielle du 22/09/2026. Une ligne par produit et par parcelle
 * traitée (cas A : traitement de surfaces). Les champs portent les intitulés
 * standard de la notice ; un champ ne contient qu'une information.
 */
export const OFFICIAL_REGISTER_FIELDS = [
  "idTraitement",
  "idIntervention",
  "siretApplicateur",
  "siretBeneficiaire",
  "nomProduit",
  "numeroAMMProduit",
  "dateIntervention",
  "heureDebut",
  "heureFin",
  "delaiRentree",
  "doseProduitValeur",
  "doseProduitUnite",
  "volumeDeBouillie",
  "uniteBouillie",
  "usageCible",
  "modeApplication",
  "surfaceTraitee",
  "surfaceUnite",
  "numIlot",
  "numParcelle",
  "codeCommuneInsee",
  "coordonneesGps",
  "cultureOepp",
  "codeBbch",
  "modeDeConduite",
  "commentaire",
] as const;
export type OfficialRegisterField = (typeof OFFICIAL_REGISTER_FIELDS)[number];

/** Champs obligatoires du cas A (« Oui » dans l'annexe de la notice). */
export const OFFICIAL_REGISTER_REQUIRED: OfficialRegisterField[] = [
  "idTraitement",
  "idIntervention",
  "siretApplicateur",
  "nomProduit",
  "numeroAMMProduit",
  "dateIntervention",
  "doseProduitValeur",
  "doseProduitUnite",
  "surfaceTraitee",
  "surfaceUnite",
  "cultureOepp",
  "modeDeConduite",
];

/** Champs ajoutés pour les enquêtes statistiques (SAIO), dans l'export JSON. */
export const OFFICIAL_REGISTER_SURVEY_FIELDS = ["campagne", "pacage", "surfaceParcelle", "surfaceTotaleUnite", "partSurfaceTraitee"] as const;
export type OfficialRegisterSurveyField = (typeof OFFICIAL_REGISTER_SURVEY_FIELDS)[number];

export type OfficialRegisterLine = Record<OfficialRegisterField, string> &
  Record<OfficialRegisterSurveyField, string> & {
    /** Champs obligatoires manquants (vide : ligne complète). */
    anomalies: OfficialRegisterField[];
    /** Liens Fourmy (non exportés en CSV). */
    links: { interventionId: string; landParcelId: string; parcelName: string; activityId: string | null };
  };

export interface OfficialRegister {
  campaign: number;
  holder: { name: string; siret: string | null; pacage: string | null };
  generatedAt: string;
  lines: OfficialRegisterLine[];
}

/** Réglages réglementaires de la ferme (détenteur du registre). */
export interface FarmIdentity {
  siret: string | null;
  pacage: string | null;
}

/** Culture du référentiel du ministère (codes culture/situation). */
export interface PhytoCrop {
  code: string;
  label: string;
  oepp: string | null;
  bbchRef: string | null;
}

/** Stade BBCH du référentiel du ministère. */
export interface BbchStage {
  code: string;
  label: string;
  description: string | null;
}
