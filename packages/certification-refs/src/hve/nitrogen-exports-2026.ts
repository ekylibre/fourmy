import type { RefSource } from "../source.js";

/**
 * Exportations d'azote par les productions végétales : table de référence
 * du bilan azoté HVE (item 6.1), mise à jour du 23/06/2026. Saisie
 * semi-manuelle depuis le PDF (pdftotext -layout), relue ligne à ligne.
 * Choix de lecture des cellules ambiguës (libellés centrés entre deux lignes) :
 * - « résidus de culture » appartient à la culture qui suit (Aubergine,
 *   Courgette, Melon, Poivron, Tomate), pas à l'asperge ;
 * - « plante entière ensilée » (11,5 kg/t MS) appartient au maïs, pas au
 *   sorgho fourrager ;
 * - la canne à sucre et le lin fibre n'ont que le bloc « tonnage exporté ».
 *
 * Teneur : kg N par t de matière à la MS de référence (`dm`, %), par t de MS,
 * de matière fraîche, ou par ha (jeunes vergers, parties pérennes).
 * `species` : espèces de la taxonomie Lexicon, pour reconnaître une culture
 * de Fourmy (une culture sans référence est « mineure »).
 */
export const NITROGEN_EXPORTS_SOURCE: RefSource = {
  text: "Exportations d'azote par les productions végétales, table de référence du bilan azoté HVE (ministère de l'Agriculture)",
  version: "mise à jour du 23/06/2026",
  at: "Exportations_azote_productions_vegetales-23062026.pdf, parties 1 à 6, p. 2 à 8",
};

export type ExportUnit = "kg/t" | "kg/t MS" | "kg/t MF" | "kg N/ha";

export interface NitrogenExport {
  part: 1 | 2 | 3 | 4 | 5 | 6;
  crop: string;
  organ: string | null;
  /** Type de récolte (fourrages) ou destination F/I (légumes). */
  harvest?: string;
  /** % de matière sèche de référence. */
  dm: number | null;
  /** Teneur ; null quand seul le bloc « tonnage de pailles exportées » est renseigné. */
  n: number | null;
  /** Unité ; null quand la table ne la donne pas (chanvre, oignon). */
  unit: ExportUnit | null;
  /** Paille : teneur en fonction du tonnage de pailles exportées. */
  exported?: { dm: number; n: number };
  /** Productions de référence Lexicon qui désignent cette ligne (prioritaires sur l'espèce). */
  productions?: string[];
  /** Parties pérennes (kg N/ha) et âge d'entrée en production (vergers). */
  perennial?: number;
  from?: string;
  species?: string[];
  note?: string;
}

const g = (crop: string, organ: string | null, dm: number | null, n: number | null, species: string[], exported?: { dm: number; n: number }, note?: string): NitrogenExport => ({
  part: 1,
  crop,
  organ,
  dm,
  n,
  unit: n === null ? null : "kg/t",
  ...(exported ? { exported } : {}),
  species,
  ...(note ? { note } : {}),
});
const f = (crop: string, organ: string | null, harvest: string | null, dm: number | null, n: number, unit: ExportUnit | null, species: string[], note?: string): NitrogenExport => ({
  part: 2,
  crop,
  organ,
  ...(harvest ? { harvest } : {}),
  dm,
  n,
  unit,
  species,
  ...(note ? { note } : {}),
});
const s = (crop: string, yieldKgHa: number, n: number, species: string[]): NitrogenExport => ({ part: 3, crop, organ: "graine", dm: null, n, unit: "kg/t", species, note: `rendement standard ${yieldKgHa} kg/ha` });
const v = (crop: string, organ: string | null, dest: "F" | "I" | null, dm: number | null, n: number, species: string[], unit: ExportUnit | null = "kg/t"): NitrogenExport => ({
  part: 4,
  crop,
  organ,
  ...(dest ? { harvest: dest } : {}),
  dm,
  n,
  unit,
  species,
});
const fr = (crop: string, n: number, species: string[]): NitrogenExport => ({ part: 5, crop, organ: "fruit", dm: null, n, unit: "kg/t", species });
const o = (crop: string, from: string | null, n: number, perennial: number, species: string[]): NitrogenExport => ({
  part: 6,
  crop,
  organ: "fruits",
  dm: null,
  n,
  unit: "kg/t",
  perennial,
  ...(from ? { from } : {}),
  species,
});

export const NITROGEN_EXPORTS: NitrogenExport[] = [
  // 1. Grandes cultures — céréales (p. 2)
  g("Avoine", "grain", 85, 16, ["avena"]),
  g("Avoine", "paille", 85, 4, ["avena"], { dm: 88, n: 5.7 }),
  g("Blé améliorant", "grain", 85, 22, []),
  g("Blé améliorant", "paille", 85, 5, [], { dm: 88, n: 5.9 }),
  g("Blé dur", "grain", 85, 21, ["triticum_durum"]),
  g("Blé dur", "paille", 85, 5, ["triticum_durum"], { dm: 88, n: 5.9 }),
  g("Blé tendre", "grain", 85, 18, ["triticum_aestivum", "triticum"]),
  g("Blé tendre", "paille", 85, 4, ["triticum_aestivum", "triticum"], { dm: 88, n: 5.7 }),
  g("Maïs", "grain", 85, 12, ["zea_mays", "zea"]),
  g("Maïs", "épi entier", 81, 11, ["zea_mays", "zea"]),
  g("Maïs", "paille", null, null, ["zea_mays", "zea"], { dm: 88, n: 8.1 }),
  g("Millet", "grain", 85, 19, ["panicum_miliaceum", "panicum"]),
  g("Orge brassicole", "grain", 85, 15, ["hordeum_vulgare", "hordeum"]),
  g("Riz", "grain", 87, 12, ["oryza_sativa", "oryza"]),
  g("Riz", "paille", 87, 3, ["oryza_sativa", "oryza"], { dm: 88, n: 4.2 }),
  g("Sarrasin", "grain", 85, 19, ["fagopyrum_esculentum", "fagopyrum"], { dm: 100, n: 18.2 }, "le bloc « tonnage exporté » est sur la ligne du grain dans la table"),
  g("Seigle", "grain", 85, 18, ["secale_cereale", "secale"]),
  g("Seigle", "paille", 85, 4, ["secale_cereale", "secale"], { dm: 88, n: 5.7 }),
  g("Sorgho", "grain", 85, 15, ["sorghum"]),
  g("Triticale", "grain", 85, 16, ["x_triticosecale"]),
  g("Triticale", "paille", 85, 3, ["x_triticosecale"], { dm: 88, n: 4.1 }),
  g("Autres céréales", "grain", 85, 19, ["poaceae"]),
  // Oléagineux
  g("Colza", "grain", 91, 29, ["brassica_napus", "brassica_napus_napus"]),
  g("Colza", "paille", null, null, ["brassica_napus", "brassica_napus_napus"], { dm: 80, n: 13.8 }),
  g("Lin oléagineux", "grain", 91, 32, ["linum_usitatissimum", "linum"]),
  g("Lin oléagineux", "paille", null, null, ["linum_usitatissimum", "linum"], { dm: 90, n: 16.1 }),
  g("Navette", "grain", 91, 29, ["brassica_rapa_oleifera"]),
  g("Soja", "grain", 91, 56.5, ["glycine_max", "glycine"]),
  g("Soja", "paille", 91, 10, ["glycine_max", "glycine"]),
  g("Tournesol", "grain", 91, 24, ["helianthus_annuus", "helianthus"]),
  g("Tournesol", "paille", null, null, ["helianthus_annuus", "helianthus"], { dm: 80, n: 11.6 }),
  g("Autres oléagineux", "grain", 91, 35, []),
  // Protéagineux
  g("Fève, Féverole", "grain", 85, 38, ["vicia_faba"]),
  g("Fève, Féverole", "paille", null, null, ["vicia_faba"], { dm: 88, n: 9.7 }),
  g("Lupin", "hiver - grain", 85, 31, ["lupinus"]),
  g("Lupin", "print. - grain", 85, 31, ["lupinus"]),
  g("Pois protéagineux", "grain", 86, 31, ["pisum_sativum", "pisum"]),
  g("Pois protéagineux", "paille", null, null, ["pisum_sativum", "pisum"], { dm: 88, n: 11.9 }),
  // Cultures industrielles (p. 3)
  g("Betterave sucrière", "racine", null, 1.1, [], undefined, "MS de référence : « 16 % sucre » (unité conventionnelle des rendements)"),
  g("Canne à sucre", "tige", null, null, ["saccharum_officinarum", "saccharum"], { dm: 40, n: 1 }),
  { ...g("Lin fibre", "paille verte non battue", null, null, [], { dm: 88, n: 5.6 }), productions: ["fiber_flax"] },
  g("Houblon", null, 20, 25, ["humulus_lupulus", "humulus"]),
  g("Pomme de terre conso.", "tubercule", 22, 3.4, ["solanum_tuberosum"]),
  { ...g("Pomme de terre fécule", "tubercule", 26, 4.3, []), productions: ["potato_starch"] },
  g("Tabac Burley", "feuilles", 73, 60, ["nicotiana_tabacum"]),
  g("Tabac brun", "feuilles", 73, 60, []),
  g("Tabac Virginie", "feuilles", 87, 15, []),

  // 2. Fourrages et cultures fourragères (p. 3-4)
  { ...f("Betterave fourragère", "plante entière", null, 16, 2.5, "kg/t MF", []), productions: ["fodder_beetroot"] },
  f("Céréales immatures ensilage", null, null, null, 15, "kg/t MS", []),
  f("Céréales protéagineux immatures ensilage", null, null, null, 12, "kg/t MS", []),
  f("Chanvre", null, null, null, 14, null, ["cannabis_sativa", "cannabis"], "unité absente dans la table"),
  f("Choux fourrager", null, null, 13, 25, "kg/t MF", []),
  f("Colza fourrager", null, null, null, 8, "kg/t MS", []),
  f("Dactyle + luzerne foin", null, null, null, 20, "kg/t MS", []),
  f("Dérobée avoine + vesce", null, null, null, 25, "kg/t MS", []),
  f("Dérobée RGI + trèfles", null, null, null, 28, "kg/t MS", []),
  f("Sorgho fourrager", null, null, null, 24, "kg/t MS", []),
  f("Maïs", "plante entière ensilée", null, null, 11.5, "kg/t MS", ["zea_mays", "zea"], "libellé centré entre sorgho fourrager et maïs : rattaché au maïs"),
  f("Maïs", null, "ensilage", null, 12.5, "kg/t MS", ["zea_mays", "zea"]),
  f("Maïs", null, "ensilage irrigué", null, 12.5, "kg/t MS", ["zea_mays", "zea"]),
  f("Trèfle (violet et blanc)", null, "pâture", null, 31, "kg/t MS", ["trifolium"]),
  f("Trèfle (violet et blanc)", null, "ensilage", null, 28, "kg/t MS", ["trifolium"]),
  f("Trèfle (violet et blanc)", null, "foin", null, 29, "kg/t MS", ["trifolium"]),
  f("Luzerne", null, "déshydratée", null, 35, "kg/t MS", ["medicago_sativa", "medicago"]),
  f("Luzerne", null, "ensilage", null, 30, "kg/t MS", ["medicago_sativa", "medicago"]),
  f("Luzerne", null, "foin", null, 28, "kg/t MS", ["medicago_sativa", "medicago"]),
  f("Luzerne", null, "récoltée", null, 25, "kg/t MS", ["medicago_sativa", "medicago"]),
  f("Légumineuses avec fleurs", null, null, null, 32, "kg/t MS", ["fabaceae"]),
  f("Légumineuses sans fleurs", null, null, null, 46, "kg/t MS", []),
  // Prairies : aussi par production de référence (prairie, ray-grass, dactyle, fétuque, pâturin).
  f("Prairie permanente ou temporaire, graminée ou multi-espèces", null, "pâturage à rotation rapide (retour toutes les 3 semaines) ou continu", null, 30, "kg/t MS", ["lolium", "lolium_multiflorum", "lolium_perenne", "dactylis", "festuca", "poa_trivialis"]),
  f("Prairie permanente ou temporaire, graminée ou multi-espèces", null, "pâturage à rotation lente (retour toutes les 5 semaines)", null, 25, "kg/t MS", ["lolium", "lolium_multiflorum", "lolium_perenne", "dactylis", "festuca", "poa_trivialis"]),
  f("Prairie permanente ou temporaire, graminée ou multi-espèces", null, "ensilage, enrubannage", null, 25, "kg/t MS", ["lolium", "lolium_multiflorum", "lolium_perenne", "dactylis", "festuca", "poa_trivialis"]),
  f("Prairie permanente ou temporaire, graminée ou multi-espèces", null, "foin précoce", null, 20, "kg/t MS", ["lolium", "lolium_multiflorum", "lolium_perenne", "dactylis", "festuca", "poa_trivialis"]),
  f("Prairie permanente ou temporaire, graminée ou multi-espèces", null, "foin tardif", null, 15, "kg/t MS", ["lolium", "lolium_multiflorum", "lolium_perenne", "dactylis", "festuca", "poa_trivialis"]),
  f("Prairie permanente ou temporaire, graminée ou multi-espèces", null, "regain", null, 19, "kg/t MS", ["lolium", "lolium_multiflorum", "lolium_perenne", "dactylis", "festuca", "poa_trivialis"]),

  // 3. Cultures porte-graines (p. 4)
  s("Betterave sucrière", 3000, 17, []),
  s("Brome", 2000, 25, []),
  s("Carotte type « Nantaise » (hyb.)", 300, 34, []),
  s("Carotte type « Nantaise » (pop.)", 600, 34, []),
  s("Dactyle", 900, 23, []),
  s("Fétuque élevée (gazon)", 1400, 25, []),
  s("Fétuque élevée (fourrage)", 1000, 25, []),
  s("Fétuque rouge", 1100, 23, []),
  s("Laitue", 500, 40, []),
  s("Mâche", 1100, 23, []),
  s("Oignon (plantation automne) (hyb.)", 350, 43, []),
  s("Oignon (plantation automne) (pop.)", 600, 42, []),
  s("Radis type « Rond rouge » (hyb.)", 400, 50, []),
  s("Radis type « Rond rouge » (pop.)", 850, 42, []),
  s("Ray-grass anglais (gazon et fourrage)", 1300, 27, []),
  s("Ray-grass italien", 1500, 20, []),

  // 4. Légumes (p. 5-6)
  v("Ail", "tête", null, null, 12.6, ["allium_sativum"]),
  v("Artichaut violet", "tête", "F", null, 3.7, ["cynara_scolymus"]),
  v("Artichaut globuleux", "tête", "F", null, 4.5, []),
  v("Asperge", "turion", "F", null, 4, ["asparagus_officianalis", "asparagus"]),
  v("Aubergine", "résidus de culture", "F", null, 3, ["solanum_melongena"]),
  v("Aubergine", "fruit", "F", null, 1.4, ["solanum_melongena"]),
  v("Bette", null, null, null, 3.3, ["beta_vulgaris_cicla"]),
  { ...v("Betterave maraichère", null, null, null, 3.7, []), productions: ["beetroot"] },
  v("Brocoli", "tête 17 cm", "F", null, 4.5, ["brassica_oleracea_italica"]),
  v("Brocoli", "tête", "F", null, 4, ["brassica_oleracea_italica"]),
  v("Cardon", null, null, null, 1, []),
  v("Carotte", "fanes", "F", null, 2.3, ["daucus_carota", "daucus"]),
  v("Carotte", "racine", "F", null, 1.2, ["daucus_carota", "daucus"]),
  v("Carotte jeune « Amsterdam »", "racine", "I", 10, 1.1, []),
  v("Carotte grosse « Flakkee »", "racine", "I", 12, 1.7, []),
  v("Céleri branche", "paré 22 cm", "I", null, 1.1, ["apium_graveolens_dulce"]),
  v("Céleri branche", "paré 28 cm", "I", null, 1.3, ["apium_graveolens_dulce"]),
  v("Céleri rave", "racine", "F", null, 2, ["apium_graveolens_rapaceum"]),
  v("Cerfeuil", null, null, null, 5.3, ["anthriscus_cerefolium"]),
  v("Champignon", null, null, null, 4.9, ["agaricus_bisporus"]),
  v("Chicorée, frisée, scarole", "feuilles", "F", null, 3.3, ["cichorium_endivia"]),
  v("Chioggia", "feuilles", "F", null, 2.2, []),
  v("Choux de Bruxelles", null, null, null, 3.3, ["brassica_oleracea_gemmifera"]),
  v("Choux à choucroute", null, null, null, 3.3, ["brassica_oleracea_capitata"]),
  v("Chou-fleur d'hiver", "tête", "F", null, 4.3, ["brassica_oleracea_botrytis"]),
  v("Chou-fleur d'été et d'automne", "tête", "F", null, 2.5, []),
  v("Citrouille", null, null, null, 1.1, ["cucurbita_maxima", "cucurbita_pepo_pepo"]),
  v("Concombre", "fruit", null, null, 1, ["cucumis_sativus"]),
  v("Cornichon", "fruit", null, null, 1.2, []),
  v("Courgette", "résidus de culture", "F", null, 2.5, ["cucurbita_pepo"]),
  v("Courgette", "fruit", "F", null, 2.2, ["cucurbita_pepo"]),
  v("Cresson", null, null, null, 2.6, ["nasturtium_officinale"]),
  v("Crosnes", null, null, null, 1.2, []),
  v("Échalote", "bulbe", "F", null, 2.3, ["allium_cepa_aggregatum"]),
  v("Endive", "racine", null, null, 2.5, ["cichorium_intybus_foliosum"]),
  v("Épinard", "feuilles", "I", 7, 3.7, ["spinacia_oleracea"]),
  v("Estragon", null, null, null, 4.7, ["artemisia_dracunculus"]),
  v("Fenouil", "bulbe", "F", null, 1.8, ["foeniculum_vulgare"]),
  v("Fève verte", null, null, null, 8.2, []),
  v("Fèverole (conso. humaine)", null, null, null, 10.9, []),
  v("Haricot extra fin ou très fin (vert)", "gousse", "I", 10, 3.4, ["phaseolus_vulgaris"]),
  v("Haricot flageolet (demi-sec)", "grain", "I", 42, 15, []),
  v("Haricot sec", null, null, null, 12.9, []),
  v("Laitue", "tête", "F", null, 1.8, ["lactuca_sativa", "lactuca"]),
  v("Lentille", null, null, null, 11.4, ["lens_culinaris", "lens"]),
  v("Mâche", "feuilles", "F", null, 4.5, ["valerianella_locusta"]),
  v("Maïs frais", null, null, null, 5.1, []),
  v("Melon", "résidus de culture", "F", null, 3.6, ["cucumis_melo"]),
  v("Melon", "fruit", "F", null, 1.4, ["cucumis_melo"]),
  v("Navet", null, null, null, 1.5, ["brassica_rapa_rapa"]),
  v("Oignon", null, null, null, 2, ["allium_cepa"], null),
  v("Pastèque", "fruit", null, null, 1, ["citrullus_lanatus"]),
  v("Piment", null, null, null, 3.3, ["capsicum_frutescens"]),
  v("Pissenlit", null, null, null, 4.6, []),
  v("Persil", null, null, null, 4.8, ["petroselinum_crispum"]),
  v("Poireau", "fût et feuilles", "F", null, 3.3, ["allium_porrum", "allium_ampeloprasum"]),
  v("Pois cassé", null, null, null, 13.6, []),
  v("Pois chiche", null, null, null, 14.2, ["cicer_arietinum"]),
  v("Pois potager", "grain", "I", null, 9.8, []),
  v("Poivron", "résidus de culture", "F", null, 2.7, ["capsicum_annuum"]),
  v("Poivron", "fruit", "F", null, 1.4, ["capsicum_annuum"]),
  v("Pomme de terre primeur", "fanes", "F", null, 2.6, []),
  v("Pomme de terre primeur", "tubercule", "F", null, 2.8, []),
  v("Radis", null, null, null, 1.2, ["raphanus_sativus"]),
  v("Radis noir", null, null, null, 4.5, []),
  v("Rhubarbe", null, null, null, 3.3, ["rheum"]),
  v("Salsifis", null, null, null, 4.9, ["tragopogon_porrifolius"]),
  v("Scorsonère", "racine", "I", 26, 4.9, []),
  v("Thym", null, null, null, 9.7, ["thymus"]),
  v("Tomate", "résidus de culture", "F", null, 3, ["solanum_lycopersicum"]),
  v("Tomate", "fruit", "F", null, 1.5, ["solanum_lycopersicum"]),
  v("Tomate sous abri", "résidus de culture", null, null, 3, []),
  v("Tomate sous abri", "fruit", null, null, 2.1, []),

  // 5. Fruits (p. 7)
  fr("Fraise", 1.2, ["fragaria"]),
  fr("Fraise saison ex ELSANTA", 3.7, []),
  fr("FRAISE précoce ex GARIGUETTE", 6, []),
  fr("FRAISE remontante ex SELVA", 4.5, []),
  fr("Ananas", 0.8, ["ananas_comosus"]),
  fr("Cassis", 3.33, ["ribes_nigrum"]),
  fr("Framboise", 3, ["rubus_idaeus"]),
  fr("Groseille / Myrtille", 3, ["ribes_rubrum", "vaccinium"]),

  // 6. Arbres fruitiers et vignes (p. 7-8) : jeunes vergers (kg N/ha), vergers en production.
  { part: 6, crop: "Jeune verger", organ: null, harvest: "1re année", dm: null, n: 20, unit: "kg N/ha" },
  { part: 6, crop: "Jeune verger", organ: null, harvest: "2e année", dm: null, n: 40, unit: "kg N/ha" },
  { part: 6, crop: "Jeune verger", organ: null, harvest: "3e année et avant l'entrée en production", dm: null, n: 60, unit: "kg N/ha" },
  o("Bananier", null, 1.7, 100, ["musa"]),
  o("Pommier", "3e feuille", 0.6, 80, ["malus_domestica", "malus"]),
  o("Pommier à cidre", null, 1.2, 90, []),
  o("Poirier", "4e feuille", 0.7, 80, ["pyrus_communis", "pyrus"]),
  o("Actinidia (kiwi)", "5e feuille", 1.4, 90, ["actinidia"]),
  o("Citronnier", "4 ans", 1.3, 75, ["citrus_x_limon"]),
  o("Oranger", "4 ans", 1.3, 75, ["citrus_sinensis"]),
  o("Pamplemoussier", "4 ans", 1.3, 75, ["citrus_maxima"]),
  o("Raisin", "3e feuille", 2, 20, ["vitis"]),
  o("Abricotier", "4e feuille", 1.2, 90, ["prunus_armeniaca"]),
  o("Avocatier", "4 ans", 2.8, 125, ["persea_americana"]),
  o("Cerisier", "5e feuille", 1.3, 90, ["prunus_avium", "prunus_cerasus"]),
  o("Pêcher", "4e feuille", 1.3, 90, ["prunus_persica"]),
  o("Prunier", "5e feuille", 0.9, 90, ["prunus_domestica"]),
  o("Prune d'Ente", "5e feuille", 0.9, 90, []),
  o("Olivier", "4e feuille", 10, 30, ["olea_europaea", "olea"]),
  o("Manguier", "4 ans", 1.22, 50, []),
  o("Amandier", "5e feuille", 15, 40, ["prunus_dulcis"]),
  o("Châtaignier", "7e feuille", 5, 90, ["castanea"]),
  o("Noisetier", "6e feuille", 13.5, 70, ["corylus_avellana", "corylus"]),
  o("Noyer", "6e feuille", 10, 90, ["juglans_regia", "juglans"]),
];

/** Lignes par partie, comptées sur le PDF à la relecture (contrôle de saisie). */
export const NITROGEN_EXPORTS_ROWS: Record<NitrogenExport["part"], number> = { 1: 47, 2: 28, 3: 16, 4: 73, 5: 8, 6: 24 };

const MEADOWS = ["meadow", "ryegrass", "annual_ryegrass", "cocksfoot", "fescue", "rough_bluegrass"];
const SILAGE = ["silage_corn"];

/**
 * Lignes d'une culture de Fourmy : par production de référence Lexicon
 * (prairies, maïs ensilage, betteraves, pomme de terre fécule, lin fibre),
 * sinon par espèce puis par ses ancêtres dans la taxonomie. Vide : culture
 * « mineure » (sans référence d'exportation).
 */
export function nitrogenExportsOf(species: string | null | undefined, ancestors: string[] = [], production?: string | null): NitrogenExport[] {
  if (production) {
    if (MEADOWS.includes(production)) return NITROGEN_EXPORTS.filter((e) => e.crop.startsWith("Prairie"));
    if (SILAGE.includes(production)) return NITROGEN_EXPORTS.filter((e) => e.part === 2 && e.crop === "Maïs");
    const byProduction = NITROGEN_EXPORTS.filter((e) => e.productions?.includes(production));
    if (byProduction.length) return byProduction;
  }
  if (!species) return [];
  for (const sp of [species, ...ancestors]) {
    const hit = NITROGEN_EXPORTS.filter((e) => e.species?.includes(sp));
    // Une espèce présente en grandes cultures et en fourrages (maïs) : la culture de grain, sauf production ensilage.
    if (hit.length) return hit.some((e) => e.part === 1) ? hit.filter((e) => e.part === 1) : hit;
  }
  return [];
}
