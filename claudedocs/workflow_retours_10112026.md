# Plan — retours de test du 10/11/2026

Source : `claudedocs/retour_test_10112026.md`. Branche proposée : `feat/retours-1011`
(depuis `feat/parcours-attelages`, non encore fusionnée). Exécution lot par
lot avec `/sc:implement <lot>`, un commit par lot, mêmes règles que le plan
parcours/attelages (tests verts, e2e, `Public:` sans nom de pilote).

## État des lieux (10/11/2026)

| Sujet | Aujourd'hui |
|---|---|
| Menu | `components/Layout.tsx` : liste plate `SECTIONS` (11 entrées), aucun sous-menu ; Équipe, Intégrations, Imports réservés au responsable. |
| Tableau de bord | `DashboardPage.tsx`, disposition fixe : 4 KPI, conditions de traitement, 10 dernières interventions. Date commune par `useAt()` (`?at=`). |
| Parcours | API par matériel seulement (`GET /equipments/:id/track-sessions`) ; pas de liste à l'échelle de la ferme. Le web ne sait pas si Traccar est activé (route intégrations réservée au responsable). |
| Listes | 3 `mantine-datatable` (interventions, stocks, registre), ~9 `Table` Mantine brutes ; aucun composant commun, aucun choix de colonnes ; seule préférence : vue des interventions en localStorage. |
| Intégrations | `traccar`, `openweather`, `meteoblue` ; aucune notion de thème ; la météo n'est jamais stockée hors `interventions.weather` ; contrainte SQL `integrations_provider_check` à étendre par fournisseur. |
| Formulaire d'intervention | Ordre actuel : procédure → statut → périodes → parcelles → intrants → sorties → motifs → météo → moyens (libre/attelages, matériels, intervenants) → notes. |
| Registre phyto | Vue `phyto_register` : date, parcelle, surface (de la parcelle, pas traitée), culture (`species` brute), produit, AMM, quantité, unité, applicateurs. Pas de SIRET, pas de code OEPP, pas de BBCH ; RPG (`parcel_references` kind `cap`) et bio (`parcel_certifications` kind `organic`) existent. |

## Lots

### S — Menus et thèmes des intégrations (petit, web seul)

- S1. `Layout.tsx` : sections à sous-menus (NavLink imbriqués, ouverts sur la
  section active) :
  - Tableau de bord
  - Cartes › Plan 2D (`/map`), Plan 3D (`/3d-plan`)
  - Activités · Interventions · Matériels (Entretien et Attelages types restent
    accessibles depuis la page Matériels) · Équipe
  - Stocks › Produits phyto (`/phyto`), Cuverie (`/cellar`) — la page
    `/stocks` (état des stocks) devient l'entrée « Stocks » elle-même ou un
    3ᵉ sous-menu « Inventaire » (**décision D1**)
  - Réglementaire › Registre phyto
  - Interopérabilité › Intégrations, Imports (responsable seulement)
  - Les routes ne changent pas ; `?at=` conservé ; menu mobile (burger) idem.
- S2. Contrat : `category: "weather" | "gps_equipment" | "decision_support"`
  sur chaque fournisseur ; page Intégrations groupée par thème (Météo, Suivi
  GPS – Matériels, OAD — vide pour l'instant, affiché « bientôt » ou masqué).
  Open-Meteo rangé dans Météo.
- Tests : unitaire du menu (section active), e2e navigation existants adaptés.

### T — Ordre du formulaire d'intervention (moyen, web seul)

Nouvel ordre, création et modification :
1. Type d'intervention + notifications/infos (bandeau parcours, correction,
   conformité résumée)
2. Réalisé / Planifié, puis Libre / Attelages avec périodes et durées,
   matériels, intervenants (le bloc « Moyens » remonte et absorbe les périodes)
3. Parcelles (liste/carte) — puis intrants, sorties, motifs, qui dépendent des
   parcelles (**décision D2** : les garder juste après les parcelles)
4. Météo
5. Notes (sortent du bloc Moyens)

- Découper `InterventionForm.tsx` (1 013 lignes) en sections nommées pour
  rendre l'ordre lisible ; aucune modification du contrat.
- Tests : e2e interventions/attelages/parcours inchangés fonctionnellement
  (adapter les sélecteurs si besoin) ; test de rendu vérifiant l'ordre.

### U — Choix des colonnes sur toutes les listes (moyen, web seul)

- Hook `useColumnPrefs(listKey, columns)` : colonnes visibles + ordre,
  stockés en localStorage par liste (préférence de confort, par poste ;
  **décision D3** : ou côté serveur, par utilisateur, pour suivre sur
  plusieurs appareils → table `user_preferences`).
- Composant `ColumnPicker` (menu à cases, « Réinitialiser »), branché :
  - sur les `mantine-datatable` (`hidden` par colonne) ;
  - sur les `Table` Mantine via un petit composant `DataTableLite` commun
    (colonnes déclaratives), migré liste par liste : matériels, équipe,
    produits phyto, cuverie, entretien, pièces, attelages types, imports,
    parcours, IFT.
- Colonnes obligatoires non masquables (nom). Tests : hook + e2e sur 2 listes.

### V — Widget « Parcours » du tableau de bord (moyen)

- API : `GET /track-sessions?from&to&kind` à l'échelle de la ferme (lecture
  membres), + `GET /tracks/summary?day=` : par matériel suivi, nombre de
  parcours travail/déplacement, durée de travail, distance, surface couverte,
  parcelles touchées, parcours libres (non rattachés).
- `GET /integrations/status` lisible par tous les membres (activé oui/non par
  fournisseur, sans secret) pour savoir si Traccar est activé.
- Widget sur `DashboardPage` si Traccar activé : jour sélectionné (`useAt`),
  bascule jour/semaine (**décision D4**), lignes par matériel avec lien vers
  l'onglet Parcours filtré ; bouton « Transformer en intervention » pour les
  parcours libres.
- Vérification sur les données réelles de Pierre (Arion 430, 5–29 octobre).

### W — Stations météo Weenat et Sencrop (gros)

- W1. Modèle : `weather_stations` (fournisseur, external_id, nom, point,
  parcelle facultative, actif) et `weather_measures` (station, heure,
  température min/moy/max, pluie, humidité, vent moyen/rafale/direction,
  humectation, `raw jsonb`, UNIQUE (station, heure)), RLS ferme. Fournisseurs
  ajoutés à la contrainte et à `fourmy_due_integrations` (synchro horaire).
- W2. Weenat — **décision D5** :
  - API « application » (celle d'Ekylibre) : e-mail + mot de passe de
    l'agriculteur, ses propres stations (`/api/v2/access/plots/`,
    mesures horaires par fenêtres de 30 jours) ; non documentée publiquement ;
  - API DSA (celle de Cropivia, swagger fourni) : données modélisées sur des
    points, contrat B2B Weenat (OAuth2 client credentials), 1 appel / 2 s.
  Recommandation : API application (stations réelles de l'agriculteur), DSA
  plus tard si un contrat existe.
- W3. Sencrop : `applicationId` + `applicationSecret` (OAuth2 client
  credentials, jeton ~1 h), `/v1/me`, `/devices`, `data/hourly` ; mesures
  pluie, températures, humidité, vent, humectation ; reprise sur 429.
- W4. Usage : la météo d'une intervention prend d'abord les mesures de la
  station la plus proche (< 5 km, sinon modèle actuel), source affichée ;
  page Météo/stations minimale (liste des stations, dernières mesures).
- Tests : clients avec `fetch` simulé (fixtures des réponses), synchro
  idempotente, choix de la station.
- Secret unique par intégration : identifiant en `settings`, secret chiffré
  pour le mot de passe / applicationSecret.

### X — Registre phyto au format réglementaire (gros)

Base : arrêté du 24/12/2025 (JORFTEXT000053228465) et notice ministérielle du
22/09/2026 (intitulés standard camelCase). Électronique obligatoire au
1/01/2027 ; pas de format imposé hors « lisible par machine », un champ = une
information ; JSON complet pour les enquêtes SAIO. Cas A (surfaces) en v1 ;
cas B (espaces fermés), C et D (semences) hors v1.

- X1. Modèle :
  - ferme : `siret` (14 chiffres, validé Luhn), `pacage` facultatif
    (réglages de la ferme) ;
  - référentiel cultures du ministère (377 lignes, code culture, OEPP, BBCH
    conseillé) et stades BBCH (2 370 lignes) chargés en table de référence
    (comme le Lexicon) ; correspondance espèce Fourmy → code OEPP
    (`zea_mays` → ZEAMX, `avena` → AVESA…), à compléter à la main pour les
    espèces non reconnues (variétés saisies comme espèce : DKC5196…) ;
  - intervention : `bbch` (stade, facultatif, par intervention ou par cible),
    heure de début/fin déjà présentes (périodes) ;
  - intrant : surface traitée = surface travaillée (`workedAreaM2`) sinon
    surface de la parcelle ; délai de rentrée anticipée et commentaire ;
    volume de bouillie facultatif ;
  - EPPO : codes OEPP des cultures depuis le référentiel ministériel (pas
    d'appel d'API) ; cible (`usageCible`) depuis l'usage E-phy retenu par le
    contrôle ; recherche EPPO (`/tools/search`, clé d'API) seulement pour
    compléter un code manquant (**décision D6** : utile en v1 ou non).
- X2. Vue `phyto_register_official` : une ligne par produit et par parcelle,
  champs `idTraitement`, `idIntervention`, `siretApplicateur`,
  `siretBeneficiaire`, `nomProduit`, `numeroAMMProduit`, `dateIntervention`,
  `heureDebut`, `heureFin`, `delaiRentree`, `doseProduitValeur`,
  `doseProduitUnite`, `volumeDeBouillie`, `uniteBouillie`, `usageCible`,
  `modeApplication`, `surfaceTraitee`, `surfaceUnite`, `numIlot`,
  `numParcelle`, `codeCommuneInsee`, `coordonneesGps` (si pas de RPG),
  `cultureOepp`, `codeBbch`, `modeDeConduite`, `commentaire` ; plus une
  colonne `anomalies` (champs obligatoires manquants).
- X3. Exports : CSV (`;`, UTF-8 BOM, intitulés standard), JSON complet
  (en-tête ferme + lignes, champs SAIO `campagne`, `pacage`,
  `surfaceParcelle`, `partSurfaceTraitee`), et vue lisible (écran + PDF,
  item déjà au README).
- X4. Écrans : saisie SIRET/PACAGE (réglages ferme), correspondance
  espèces → OEPP, champ BBCH dans le formulaire (proposé d'après le
  référentiel de la culture), Registre phyto avec onglet « Format
  réglementaire » et compteur d'anomalies par ligne ; contrôle réglementaire
  qui signale les champs manquants avant enregistrement.
- X5. Reprise Ekylibre : SIRET de l'entité, stades si présents.
- Points à trancher avec le texte : dose en kg/hL acceptée par la notice mais
  pas par l'arrêté (on exporte l'unité de l'AMM) ; séparateur GPS (`;` du
  tableur annexe) ; BBCH en 2 chiffres ou texte (on exporte « BBCH nn »).

## Ordre proposé

S → T → U → V → X → W

- S et T : rapides, visibles tout de suite par les pilotes.
- U : transverse, à faire avant d'ajouter de nouvelles listes (stations, registre).
- V : réutilise les parcours livrés.
- X avant W : échéance réglementaire au 1/01/2027.
- W : dépend d'identifiants Weenat/Sencrop de test (à fournir).

Parallélisables : S ∥ V (API) ; X1 (référentiels) ∥ W1.

## Décisions

Tranchées le 10/11/2026 : D2 oui (après les parcelles), D3 localStorage,
D4 jour + bascule semaine, D5 API application Weenat. D1 et D6 : options
proposées retenues par défaut, à confirmer au lot concerné.

Rappel des questions :

- D1. Stocks : entrée elle-même = état des stocks, avec sous-menus Produits
  phyto et Cuverie ? (proposé : oui, « Stocks » ouvre l'état des stocks).
- D2. Intrants/sorties/motifs juste après les parcelles ? (proposé : oui).
- D3. Préférences de colonnes : localStorage (proposé, v1) ou serveur.
- D4. Widget parcours : jour sélectionné seul, ou jour + 7 jours ?
- D5. Weenat : API application (proposé) ou DSA.
- D6. Recherche EPPO en ligne en v1 ? (proposé : non, référentiel ministériel).
- Identifiants de test Weenat et Sencrop, SIRET des fermes pilotes.

## État

- **S** (2026-11-10) : menu en sections et sous-menus (`NAVIGATION` dans
  `components/Layout.tsx`, sous-menus ouverts sur la section active, boutons
  `aria-expanded`), Stocks › État des stocks / Produits phyto / Cuverie
  (D1), Équipe et Interopérabilité réservés au responsable ; thème
  `category` sur chaque fournisseur (`INTEGRATION_CATEGORIES`), page
  Intégrations groupée Météo / Suivi GPS – Matériels / OAD (masqué tant
  qu'aucun fournisseur). e2e : utilitaire `navTo(page, entrée, groupe)`.
- **T** (2026-11-10) : formulaire en blocs numérotés (1 Intervention,
  2 Réalisation et moyens, 3 Parcelles et produits / Matériel entretenu,
  4 Météo, 5 Notes) ; périodes du mode libre, matériels et intervenants
  regroupés au bloc 2, synthèse des durées sous les attelages ; aucun
  changement de contrat. Test d'ordre dans `interventions.test.tsx`.
- **U** (2026-11-10) : `useColumns(liste, défs)` (`app/columns.ts`, colonnes
  masquées en localStorage `fourmy.columns.<liste>`, réinitialisables) et
  bouton « Colonnes affichées » (`components/ColumnPicker.tsx`,
  `pickColumns` pour mantine-datatable). Branché sur 12 listes :
  interventions (+ Matériels et Notes, masquées par défaut), stocks,
  registre phyto, bilan IFT, matériels, attelages types, équipe (membres,
  personnes), produits phyto, entretien, pièces, parcours. Cuverie (cartes)
  et Imports (rapport) n'ont pas de liste tabulaire : sans objet.
- **V** (2026-11-10) : `GET /tracks/summary?from&to` (membres, ≤ 31 jours,
  `enabled` = Traccar actif, lu sans exposer la configuration) ; widget
  « Parcours GPS » sur le tableau de bord (jour / 7 jours, D4), liens vers
  l'onglet Parcours filtré (paramètres `tracksFrom/To/Kind/State`).
  Vérifié sur Pierre, semaine du 2 au 8/10 : Arion 430, 2 parcours de
  travail (2 h 21, 17,3 ha couverts, 1 libre), 5 déplacements (21,4 km).
