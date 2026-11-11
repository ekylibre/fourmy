/**
 * Annexe 6 du référentiel GREN Nouvelle-Aquitaine (arrêté du 29/07/2025) :
 * préconisations pour réaliser des campagnes de mesures de reliquat d'azote
 * en sortie d'hiver (RSH). Recommandations résumées en phrases courtes,
 * fidèles au texte.
 */

import type { Table } from "../types.js";

export type RshTopic = "timing" | "equipment" | "zone" | "sampling" | "storage";

export interface RshRow {
  key: string;
  topic: RshTopic;
  /** Section de l'annexe (« 1.a », « 4 »…). */
  section: string;
  text: string;
  /** Valeur numérique clé quand la règle en comporte une. */
  value?: number;
  unit?: string;
}

export const naRshRecommendations: Table<RshRow> = {
  id: "na-2025/rsh",
  source: {
    title: "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 6 : préconisations pour réaliser des campagnes de mesures de reliquat en sortie d’hiver (RSH)",
    organisation: "Préfecture de la région Nouvelle-Aquitaine (GREN)",
    date: "2025-07-29",
    url: "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/6_rsh_gren_na_vdef.pdf",
    ref: "Annexe 6, §1 à §5, pp. 1-2",
    licence: "Arrêté préfectoral publié (document administratif) ; valeurs citées de leurs organismes",
  },
  notes: [
    "Sources citées par l'annexe : Chambre d’agriculture d’Aquitaine (Julien Michau et Patrice Mahieu), Chambre d’agriculture de Bretagne, INRA et Arvalis.",
    "Le RSH est une des méthodes d’évaluation du poste Ri (azote minéral à l’ouverture du bilan).",
  ],
  rows: [
    { key: "timing_principle", topic: "timing", section: "1.a", text: "Mesurer à la fin du lessivage des pluies d'automne-hiver, généralement entre fin février et début mars, sur sol ressuyé." },
    { key: "timing_early_start", topic: "timing", section: "1.b", text: "Pour la fertilisation des céréales au tallage, les prélèvements peuvent commencer fin janvier ; corriger alors le RSH selon les pluies de fin janvier et de février." },
    { key: "timing_after_rain", topic: "timing", section: "1.b", text: "En période pluvieuse, intervenir seulement 2 à 3 jours (selon les sols) après un épisode pluvieux.", value: 2, unit: "jours (2 à 3)" },
    { key: "timing_spring_crops", topic: "timing", section: "1.b", text: "Cultures de printemps : prélever de préférence avant le travail du sol précédant l’implantation." },
    { key: "timing_never", topic: "timing", section: "1.b", text: "Ne jamais prélever sur sol gelé, enneigé ou sous la pluie." },
    { key: "timing_before_n", topic: "timing", section: "1.b", text: "Toujours prélever avant tout apport azoté." },
    { key: "equipment_auger", topic: "equipment", section: "2", text: "Tarière graduée tous les 30 cm (adhésif couleur ou marquage dans la masse).", value: 30, unit: "cm" },
    { key: "equipment_buckets", topic: "equipment", section: "2", text: "Un seau propre et différencié par horizon (0-30, 30-60, 60-90, 90-120 cm), n'ayant pas contenu d'engrais ou de concentré azoté." },
    { key: "equipment_sample", topic: "equipment", section: "2", text: "Récipient d’environ 100 g de terre pour l'échantillon ; couteau ; sachets ; glacière et pains de glace ; fiche de renseignements parcelle du laboratoire.", value: 100, unit: "g" },
    { key: "zone_area", topic: "zone", section: "3", text: "Zone homogène d’environ 2 000 m² (50 x 40 m), relativement plane et représentative de la parcelle.", value: 2000, unit: "m²" },
    { key: "zone_avoid", topic: "zone", section: "3", text: "Éviter bas de pente, anciens tas de fumier, talus et entrée du champ ; joindre un plan sommaire de la parcelle et de la zone." },
    { key: "depth_horizon", topic: "sampling", section: "4", text: "Prélever sur toute la profondeur d’enracinement, par horizons de 30 cm.", value: 30, unit: "cm" },
    { key: "depth_minimum", topic: "sampling", section: "4", text: "Au moins deux horizons (60 cm) ; sinon la mesure n’est pas pertinente et Ri est déterminé par des références locales annuelles (article 8).", value: 60, unit: "cm" },
    { key: "depth_deep_soils", topic: "sampling", section: "4", text: "Sols très profonds (plateaux limoneux) : prélever jusqu'à 120 cm (enracinement potentiel d'un blé).", value: 120, unit: "cm" },
    { key: "cores_per_horizon", topic: "sampling", section: "4", text: "Au minimum 12 à 16 sondages (carottes) par horizon.", value: 12, unit: "carottes (12 à 16)" },
    { key: "pattern_diagonal", topic: "sampling", section: "4", text: "Méthode 1 : sur une diagonale, un sondage tous les 5 m.", value: 5, unit: "m" },
    { key: "pattern_circle", topic: "sampling", section: "4", text: "Méthode 2 : dans un cercle de 15 à 20 m de diamètre autour d’un point de référence (coordonnées Lambert).", value: 15, unit: "m (15 à 20)" },
    { key: "core_cleaning", topic: "sampling", section: "4", text: "À chaque sondage : gratter l’extérieur de la carotte, supprimer les 2 cm ou plus du haut, nettoyer le trou et la tarière.", value: 2, unit: "cm" },
    { key: "storage_cool", topic: "storage", section: "5", text: "Placer impérativement les échantillons en glacière avec pains de glace dès leur constitution (évolution rapide en 24 h)." },
    { key: "storage_same_day", topic: "storage", section: "5", text: "Transport : soit au laboratoire le jour même du prélèvement," },
    { key: "storage_fridge", topic: "storage", section: "5", text: "soit au réfrigérateur à 4 °C, 48 heures maximum,", value: 48, unit: "h" },
    { key: "storage_frozen", topic: "storage", section: "5", text: "soit congelés 15 jours maximum ; congélation rapide, l'échantillon doit arriver congelé au laboratoire.", value: 15, unit: "jours" },
  ],
};
