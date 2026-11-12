# Plan de test global avant l'envoi à la ferme pilote

*Établi le 2026-11-12. Règles testées : `docs/specifications-metier.md` (identifiants `RG-…`). La recette fertilisation du 2026-11-11 (`claudedocs/recette_fertilisation_chrome.md`) est reprise ici sans être recopiée.*

## 0. Objet et critère d'envoi

Vérifier que l'application est utilisable par la ferme de grandes cultures sur ses propres données. Cela couvre tous les écrans, les deux rôles et les règles réglementaires.

**On envoie l'application si :**
1. les suites automatiques passent (§2) ;
2. aucun scénario **P1** n'est en échec ;
3. les échecs **P2** sont connus, notés dans le journal (§8) et ne touchent ni le registre phyto, ni le cahier, ni le stock ;
4. la ferme a été remise dans son état d'origine ;
5. le message d'envoi liste les limites connues (§9).

**Priorités :**
- **P1** : bloquant. Réglementaire faux, perte ou corruption de données, écran inutilisable, droit mal appliqué.
- **P2** : gênant. Calcul secondaire, affichage trompeur, lenteur.
- **P3** : confort.

## 1. Environnement de recette

| Élément | Valeur |
|---|---|
| Base | **copie** de la base locale : `fourmy_recette`, clonée de `fourmy` (port 5434). La ferme réelle n'est jamais touchée. |
| API | `DATABASE_URL=…/fourmy_recette`, port 3000, `BETTER_AUTH_URL` et `FOURMY_TRUSTED_ORIGINS` = `http://localhost:5180` |
| Web | Vite, http://localhost:5180 |
| Navigateur | Chrome, avec l'extension Claude in Chrome, dans un **nouvel onglet**. Fenêtre 1440 × 900, puis 390 × 844 (téléphone) pour §5. Firefox pour T-3D-6. |
| Ferme | `phaurigot` (a94afd36-…) : 162 parcelles, dont 11 en zone vulnérable ; 589 interventions réalisées ; 17 matériels ; Traccar, OpenWeather et Copernicus actifs. |
| Comptes | **Responsable** : le compte responsable de la ferme dans la copie. **Salarié** : un compte de test créé dans la copie (`user:create`), rattaché comme `worker` depuis Équipe. Identifiants dans `.env.recette.local` (ignoré par Git), jamais recopiés dans ce document. |
| Dates | La frise sert de date simulée (`?at=`). Les saisies de test sont datées d'avant le 12/11/2026 ou à venir, selon le scénario. |

**Préparation des données** (à faire une fois, dans la copie) :
- créer **2 interventions planifiées** (un semis à venir, un traitement à venir) pour le kanban et la planification ;
- créer **1 intervention annulée** ;
- créer **1 attelage type** ;
- placer **1 cuve** si la cuverie doit être montrée. La ferme n'en a pas : sinon, tester l'écran vide.

**Remise à zéro** : supprimer `fourmy_recette`, le compte salarié de test et `.env.recette.local`, puis relancer l'API sur `fourmy`.

## 2. Niveau 1 : suites automatiques (avant toute recette écran)

| ID | Commande | Attendu |
|---|---|---|
| T-AUTO-1 | `corepack pnpm turbo lint typecheck` | tout vert |
| T-AUTO-2 | `pnpm --filter @fourmy/domain test` et les paquets (`packages/*`) | tout vert (51 fichiers) |
| T-AUTO-3 | `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @fourmy/web test` | 36 fichiers, 156 tests au moins |
| T-AUTO-4 | `DATABASE_URL=…/fourmy_recette pnpm --filter @fourmy/api test` | 37 fichiers, 213 tests au moins |
| T-AUTO-5 | `pnpm --filter @fourmy/web e2e` (API et `vite preview` démarrés) | 10 specs Playwright vertes |

**Trous connus** de la couverture automatique, compensés par la recette écran :
- le plan 3D (e2e seulement) ;
- la création de parcelle sur la carte ;
- l'impression des plans ;
- la page Imports Ekylibre ;
- le retour du consentement agrirouter ;
- **le rôle salarié**, qu'aucun test web ne couvre (masquage, URL directes, boutons désactivés).

## 3. Niveau 2 : recette écran, responsable

Chaque scénario se lit ainsi : chemin, puis action → ce qu'on doit voir. La dernière colonne cite les règles vérifiées. Faire une capture à chaque échec.

### 3.1 Connexion, fermes, tableau de bord

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-ACC-1 | P1 | `/login` avec un mauvais mot de passe, puis le bon | refus lisible ; puis `/farms` avec la ferme et le badge « Responsable » | ACC-1/8 |
| T-ACC-2 | P1 | ouvrir l'URL d'une ferme dont on n'est pas membre (une autre ferme de la base) | « Ferme inaccessible » ; aucune donnée affichée | ACC-2, GEN-1 |
| T-DASH-1 | P2 | tableau de bord, frise au 16/04/2026 puis au 12/11/2026 | les cartes Parcelles, Productions, Entretien et Cuverie suivent la date | GEN-10 |
| T-DASH-2 | P2 | widget Parcours GPS : jour, puis 7 jours, au 28/10/2026 | Arion 430 : durée, distance, surface, parcours libres ; lien vers l'onglet Parcours | GPS-8 |
| T-DASH-3 | P2 | widget modèle de croissance et widget récoltes probables | signalements groupés ; « Saisir la récolte » ouvre une intervention pré-remplie (ne pas enregistrer) | CRO, IRR-4, SAT-7 |
| T-GEN-1 | P2 | copier une URL avec `?at=` et `?tab=`, l'ouvrir dans un nouvel onglet | même écran, même date | GEN-10 |
| T-GEN-2 | P3 | ouvrir `/f/…/carte`, `/registre` et `…/modifier` | redirection vers les adresses actuelles | GEN-10 |
| T-GEN-3 | P3 | choisir ses colonnes dans 2 listes, recharger la page | le choix est gardé | GEN-11 |

### 3.2 Activités, parcelles, carte

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-ACT-1 | P2 | Activités, campagne 2026 | 5 activités (Maïs, Jachère, Avoine, Triticale, Prairie temporaire), avec image, culture, parcelles et surface | ACT-1/4 |
| T-ACT-2 | P2 | créer une activité depuis une production Lexicon, la renommer, la supprimer | pré-remplissage ; suppression possible tant qu'elle n'a pas de production | ACT-2/3 |
| T-ACT-3 | P3 | certifications : ajouter AB sur une parcelle, voir le récapitulatif, retirer | « AB · 1/n » ; retrait | ACT-6 |
| T-PARC-1 | P1 | fiche parcelle (Lespourcy), tous les onglets un par un | chaque onglet s'affiche sans erreur ; les surfaces suivent la date de la frise | PARC-1/4 |
| T-PARC-2 | P2 | « Nouvelle parcelle sur la carte » depuis une activité : cliquer une parcelle PAC | PAC (culture déclarée), cadastre et parcelle existante proposés ; **annuler** sans créer | PARC-2 |
| T-PARC-3 | P3 | « Actualiser PAC et cadastre » | fin sans erreur ; onglet Cadastre à plus de 1 % | PARC-3 |
| T-CARTO-1 | P2 | Plan 2D : photo aérienne ou plan IGN, filtre matériel, délais en cours, « Fiche de la parcelle » | carte fluide ; liens justes | PARC |
| T-CARTO-2 | P3 | Outils de dessin (essai) : découper avec une ligne qui ne traverse pas, puis qui traverse ; fusionner deux surfaces séparées | la première ligne ne coupe rien ; la seconde coupe ; la fusion est refusée sans perte ; rien n'est enregistré | CARTO-1/4 |

### 3.3 Interventions (cœur de l'usage)

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-INT-1 | P1 | liste, campagne 2026, recherche « Lespourcy maïs » puis « ercole » | résultats immédiats, accents ignorés, `?q=` dans l'URL | INT-13 |
| T-INT-2 | P1 | vues liste, kanban et calendrier ; « Cette semaine », flèches | la vue est gardée dans `?view=` ; chaque période à son jour ; planifiées passées en « En cours » | INT-10/12 |
| T-INT-3 | P1 | kanban : glisser une planifiée vers « Réalisée », puis une réalisée vers « Planifiée » | ouverture de la réalisation ; retour refusé avec une explication | INT-12 |
| T-INT-4 | P1 | **nouveau semis planifié** à venir sur Lespourcy : Arion 430 + Monosem, semence, starter 14-48 en **L/ha** | ordre des blocs 1 à 5 ; « Habituels » en tête ; météo prévue ; encadrés phyto et nitrates ; azote = 120 L × 1,4 × 14 % ≈ **23,5 kg N/ha** ; enregistrer → statut planifiée | INT-1/4, INT-7, MET-2, CTL |
| T-INT-5 | P1 | unités : 14-48 en Kilogramme, puis en Tonne ; un phyto en Tonne ; un engrais sans densité en Litre | conversions affichées ; refus « se saisit dans son unité » et « densité » | INT-7 |
| T-INT-6 | P1 | **réaliser** ce semis (date passée) : sélection des parcelles sur carte, zone partielle dessinée | surfaces recalculées ; mouvements de stock créés dans l'unité de l'article ; fiche : doses par ha et totales, contrôles, météo observée | INT-5/6, STK-2 |
| T-INT-7 | P1 | **corriger** la dose du 14-48 sur la réalisée (120 → 100 L/ha) | correction tracée (avant/après) ; stock et cahier à 100 ; historique avec 120 | INT-15/17 |
| T-INT-8 | P1 | **annuler** une réalisée avec un motif | statut annulée, lecture seule ; mouvements contre-passés à leur date ; le registre et le cahier ne la montrent plus | INT-11 |
| T-INT-9 | P2 | supprimer une planifiée | supprimée ; aucun mouvement | INT-11 |
| T-INT-10 | P2 | intervention **à attelages** : 2 attelages qui se chevauchent (8 h-10 h et 9 h-12 h), même tracteur dans les deux | erreur bloquante ; avec deux tracteurs différents : chantier de 8 h à 12 h, temps de travail de 5 h | ATT-1/4 |
| T-INT-11 | P2 | passer de « attelages » à « libre » | confirmation avec la liste de ce qui est perdu | ATT-3 |
| T-INT-12 | P2 | « Reprendre un attelage type », puis « Enregistrer comme attelage type » | matériels et intervenants copiés, les périodes restent | ATT-5 |
| T-INT-13 | P2 | irrigation réalisée sans dose, puis à 120 mm, puis à 30 mm | refus, refus (> 100), accepté ; volume en m³ affiché | IRR-3 |
| T-INT-14 | P2 | modifier une campagne close (2024) | correction possible avec un avertissement | INT-16 |

### 3.4 Phytosanitaire

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-PHY-1 | P1 | traitement planifié sur maïs avec un produit autorisé à dose normale | feux verts ; DAR « récolte possible à partir du … » ; DRE en information | PHY-2/4 |
| T-PHY-2 | P1 | même produit au double de la dose maximale, puis réaliser | feu **rouge** dose ; réalisation refusée sans motif (fenêtre « Feu rouge réglementaire ») ; motif saisi → enregistré et visible sur la fiche | PHY-4, GEN-7 |
| T-PHY-3 | P1 | mélange de deux produits de même catégorie 2/3/4 (ou catégorie 5 avec un autre) | feu rouge mélange | PHY tableau |
| T-PHY-4 | P2 | parcelle proche d'un cours d'eau : carte avec bande ZNT | bande affichée ; feu ZNT selon la distance | PHY tableau, PHY-5 |
| T-PHY-5 | P2 | Produits phyto : fiche, pictogrammes SGH, EPI ; « Ajouter depuis le référentiel » par n° AMM | pictogrammes cohérents ; article créé, rattaché à l'AMM | PHY-1/2 |
| T-PHY-6 | P1 | Registre phyto, campagne 2025 : onglet « Registre et IFT », export CSV | lignes = traitements réalisés ; CSV lisible dans un tableur | PHY-6 |
| T-PHY-7 | P1 | onglet « Format réglementaire » : anomalies, CSV réglementaire, JSON | SIRET et PACAGE signalés manquants ; CSV en « ; » avec BOM ; doses par ha à 4 décimales | PHY-7 |
| T-PHY-8 | P2 | « Modifier le détenteur » : SIRET à 13 chiffres, puis à 14 | refus, puis accepté | PHY-8 |
| T-PHY-9 | P2 | bilan IFT et « Calculer maintenant » sur une intervention | IFT pondéré par la surface ; pas de blocage si l'API ne répond pas | PHY-10/12 |
| T-PHY-10 | P2 | applicateur : traitement à attelages, pulvérisateur dans l'attelage 2 | applicateur = intervenant de l'attelage 2 | PHY-9 |

### 3.5 Fertilisation azotée

Rejouer la recette du 2026-11-11 (`recette_fertilisation_chrome.md`, sections A à G) sur la copie, et ajouter :

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-FERT-1 | P1 | recette A à G complète | conforme au document de recette | NIT, SOL, PPF, CTL, CAH, MOD |
| T-FERT-2 | P1 | Fertilisants → 14-48 liquide | 14 % N, 48 % P2O5, densité 1,4, type III, confirmée ; stock en litres | FTZ-1, point ouvert 1 |
| T-FERT-3 | P1 | **établir** le plan Lespourcy Maïs 2026 (sol saisi), puis **réviser** avec un motif | v1 figée ; v2 avec motif ; v1 relisible à l'identique | PPF-9 |
| T-FERT-4 | P1 | apport réalisé en janvier (période d'interdiction), sur le web | refus sans motif ; motif enregistré ; ligne au cahier, dans « épandages interdits » | CTL-2, CAH-1 |
| T-FERT-5 | P1 | cahier 2026 après T-INT-6/7 | ligne du 14-48 en **L/ha**, azote total et efficace justes, total comparé au plan | CAH-1, INT-7 |
| T-FERT-6 | P2 | apport saisi aujourd'hui pour un épandage de plus de 30 jours | « en retard » au cahier | CAH-2 |
| T-FERT-7 | P2 | dose externe avec un justificatif PDF de plus de 10 Mio, puis de moins de 10 Mio, puis le retirer | refus ; accepté ; confirmation avant retrait | PPF-7/12, GEN-9 |
| T-FERT-8 | P2 | « Imprimer les plans » et « Cahier d'enregistrement » ; CSV | une page par plan, ouverture en moins de 2 s ; CSV avec les unités en clair | CAH-3 |

### 3.6 Modulation

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-MOD-1 | P2 | « Moduler » depuis un apport du plan | bandeau de l'apport ; image la plus proche avant la date ; case « moyenne » cochée ; zones et doses | MOD-4 |
| T-MOD-2 | P2 | nouvelle carte : 3 puis 5 zones, NDVI puis NDRE, stratégie « compenser » | zones de surfaces voisines ; zone 1 la plus faible ; doses bornées et arrondies ; total | MOD-1/3 |
| T-MOD-3 | P2 | enregistrer, télécharger ISO-XML et Shapefile | deux fichiers ; le Shapefile s'ouvre dans QGIS (attributs ZONE, DOSE…) | MOD-5 |
| T-MOD-4 | P3 | agrirouter dans Intégrations | « connexion désactivée » expliquée (pas de configuration serveur) | MOD-6 |

### 3.7 Matériels et entretien

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-MAT-1 | P2 | liste : « Tous », filtre Tracteurs, recherche « arion » | 4 tracteurs dont 1 réformé ; badge Traccar sur l'Arion 430 | MAT-1 |
| T-MAT-2 | P1 | « Relevé » de l'Arion 430 inférieur au dernier | refus avec le relevé voisin ; correction « saisie fausse » avec motif → acceptée, anciens relevés barrés | MAT-3/4 |
| T-MAT-3 | P2 | fiche : tous les onglets ; Technique avec sources ; Historique | chaque onglet s'affiche ; sources (document, page) visibles | MAT-2/7 |
| T-MAT-4 | P2 | onglet 3D : avatar de l'Arion 430, « Tout déduire », couleur saisie puis rétablie | proportions d'un tracteur standard ; provenance de chaque valeur | MAT-8 |
| T-MAT-5 | P2 | logo : PNG de 2 Mo, puis SVG valide | refus (> 1 Mo) ; SVG converti et affiché | MAT-5 |
| T-ENT-1 | P2 | Entretien : « Amorcer le plan » sur un matériel importé (sinon écran vide), états et tri | échéances en retard, puis bientôt, puis à renseigner, puis à jour | ENT-1/3 |
| T-ENT-2 | P2 | « Réaliser » une opération : intervention d'entretien préventive avec relevé | pièces ajoutées une fois ; échéance remise à zéro ; relevé créé | ENT-4/5 |
| T-ENT-3 | P3 | Pièces à commander, horizon 6 mois, CSV | besoin, stock et reste ; CSV en « ; » | ENT-7 |
| T-ENT-4 | P3 | réglages : seuil « bientôt » et e-mail | enregistrés ; sans SMTP, rien n'est envoyé | ENT-2/8 |

### 3.8 Parcours GPS et plan 3D

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-GPS-1 | P1 | Arion 430 → Parcours, du 05 au 29/10/2026 | 12 parcours (3 de travail, 9 déplacements), dont 1 rattaché avec lien ; filtres ; carte de la sélection | GPS-1/3 |
| T-GPS-2 | P1 | cocher un parcours libre de travail → « Créer l'intervention » | brouillon à attelages, périodes, parcelles, indices ; **rien enregistré avant validation** ; annuler | GPS-5 |
| T-GPS-3 | P1 | « Ajouter à une intervention » sur une intervention planifiée du même jour (créée pour le test) | périodes et parcelles ajoutées ; reste planifiée ; parcours rattaché | GPS-6 |
| T-GPS-4 | P2 | cocher un parcours déjà rattaché ; cocher 2 matériels | impossible ; refus | GPS-5/7 |
| T-GPS-5 | P2 | annuler l'intervention de T-GPS-3 | parcours libéré | GPS-7 |
| T-3D-1 | P1 | Plan 3D au 16/04/2026 : relief, orthophoto, bâtiments, parcelles, encadrés Jumeau et Satellite | chargement en moins de 15 s ; pas d'écran noir | 3D-1/2 |
| T-3D-2 | P1 | rejeu Arion 430 du 28/10 : caméra « Derrière », puis « Drone », puis « Libre » ; ×300 | avatar posé et orienté ; vue drone sur toute la parcelle ; le tracé se colore derrière le tracteur | 3D-6/7 |
| T-3D-3 | P2 | « Tous les matériels suivis » | dernière position des 3 tracteurs suivis | 3D-7 |
| T-3D-4 | P2 | Satellite : NDVI, Couleurs, Par parcelle ; badge de date | image à la date de la frise ; mention Copernicus | SAT-6 |
| T-3D-5 | P3 | rangs : modifier l'orientation d'une parcelle, revenir à l'automatique | rendu mis à jour | 3D-3 |
| T-3D-6 | P2 | T-3D-2 dans **Firefox** | pas d'arrêt de la vue (ancien défaut des lignes drapées) | — |

### 3.9 Télédétection, croissance, irrigation

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-SAT-1 | P2 | fiche parcelle → Végétation : NDVI, NDRE, NDMI (`?idx=`) | points, bande, courbe lissée, référence, interventions en repères ; dates nuageuses en gris | SAT-3/5 |
| T-SAT-2 | P2 | une petite parcelle (< 0,3 ha) | « trop petite pour Sentinel-2 » | SAT-3 |
| T-SAT-3 | P2 | widget des récoltes probables : « Ce n'est pas une récolte » | signalement écarté | SAT-7 |
| T-CRO-1 | P2 | Végétation → encadré « Modèle de croissance » d'un maïs 2026 | stades datés avec leur origine (observée, prévue, normales) ; courbe d'eau ; irrigations | CRO-2/3 |
| T-CRO-2 | P2 | « Modifier le sol » : réserve de 5 mm, puis 150 mm, déclarée irriguée | refus (< 10) ; accepté ; affichage « besoin d'irrigation » | IRR-1/2 |

### 3.10 Stocks, cuverie, équipe, intégrations, imports

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-STK-1 | P1 | État des stocks avant et après T-INT-6, T-INT-7, T-INT-8 | sortie, correction et contre-passation justes, dans l'unité de l'article | STK-1/2 |
| T-STK-2 | P3 | Cuverie | écran vide propre (aucune cuve) | 3D-5 |
| T-TEAM-1 | P1 | Équipe : ajouter le compte salarié de test en `worker`, changer son rôle, le remettre | membre listé, badge de rôle | ACC-1 |
| T-INTG-1 | P2 | Intégrations : sections par thème ; Traccar avec une adresse non HTTPS | refus ; aucun secret réaffiché | INTG-1/2 |
| T-INTG-2 | P3 | Copernicus : « Tester » | « n acquisitions, dont m exploitables » | SAT-1 |
| T-IMP-1 | P3 | Imports : page Ekylibre et import d'un dossier matériel (ne pas lancer de reprise) | formulaires présents ; seul un nom de base est demandé | MIG-5 |

## 4. Niveau 3 : recette écran, salarié

Se connecter avec le compte salarié de test (rattaché en T-TEAM-1).

| ID | P | Scénario | Attendu | RG |
|---|---|---|---|---|
| T-ROLE-1 | P1 | menu | ni **Équipe** ni **Interopérabilité** ; badge « Salarié » | ACC-6 |
| T-ROLE-2 | P1 | URL directes `/f/…/team`, `/integrations`, `/imports` | aucune donnée sensible ; message de refus (403 ou « Réservé au responsable ») | ACC-5 |
| T-ROLE-3 | P1 | créer, réaliser, corriger et annuler une intervention | tout est permis | ACC-4 |
| T-ROLE-4 | P1 | fiche parcelle → Sol ; plan de fumure ; fertilisant ; activité | champs désactivés, aucun bouton d'enregistrement actif | ACC-5 |
| T-ROLE-5 | P1 | matériel : relevé manuel (permis), relevé « référence » et suppression (refusés), avatar (lecture seule) | conforme | MAT-4, ACC-5 |
| T-ROLE-6 | P2 | modulation : télécharger ISO-XML (permis) ; modifier les doses ou supprimer (absents ou refusés) | conforme | MOD-5, ACC-5 |
| T-ROLE-7 | P2 | Registre : exports permis, « Modifier le détenteur » absent | conforme | PHY-8 |
| T-ROLE-8 | P2 | Parcours : « Créer l'intervention » (permis) ; réglages GPS (absents) | conforme | GPS-2/5 |
| T-ROLE-9 | P2 | récoltes probables : « Ce n'est pas une récolte » | permis (règle à confirmer : point ouvert 5) | SAT-7 |

## 5. Transverse

| ID | P | Scénario | Attendu |
|---|---|---|---|
| T-UX-1 | P2 | téléphone (390 × 844) : connexion, tableau de bord, liste des interventions, nouvelle intervention, fiche, cahier | pas de défilement horizontal ; boutons atteignables ; formulaire utilisable |
| T-UX-2 | P2 | fenêtre réduite à 1024 px | menu latéral repliable, contenu lisible |
| T-PERF-1 | P2 | recherche sur la campagne (589 interventions, toutes campagnes) | réponse immédiate (< 200 ms ressentis) |
| T-PERF-2 | P2 | Parcours sur 90 jours | affichage en moins de 2 s |
| T-ERR-1 | P2 | couper le réseau du navigateur (DevTools hors ligne), puis enregistrer | message d'erreur clair, pas de perte de la saisie à l'écran |
| T-ERR-2 | P2 | console du navigateur sur chaque écran visité | aucune erreur rouge non expliquée |
| T-SEC-1 | P1 | e-mail, jetons ou secrets dans l'interface, les URL, la console | aucun |

## 6. Ordre d'exécution conseillé (≈ 1 jour)

1. §1 : préparer la copie, les comptes et les données de test.
2. §2 : suites automatiques. Un échec P1 arrête tout.
3. §3.1 à §3.3 : connexion et interventions. C'est le parcours quotidien.
4. §3.4 à §3.5 : réglementaire. Rejouer la recette fertilisation.
5. §3.6 à §3.10 : modulation, matériels, GPS, 3D, satellite, stocks.
6. §4 : rôle salarié.
7. §5 : téléphone, performance, erreurs.
8. §8 : bilan, puis décision d'envoi. Remise à zéro (§1).

## 7. Exécution via Claude in Chrome

- Un **nouvel onglet** par session de recette ; les onglets ouverts de l'utilisateur ne sont pas touchés.
- Pas de fenêtre `alert` ou `confirm` du navigateur. Les confirmations de Fourmy sont des fenêtres Mantine, sans risque.
- Pour chaque échec : une capture, l'URL, la console filtrée (`pattern` sur l'erreur) et l'appel réseau en cause.
- Les saisies se font sur la copie `fourmy_recette`. Vérifier avant chaque série que l'API pointe sur la copie (journal de démarrage).
- Les identifiants des comptes de test viennent du fichier local ignoré par Git. Ils ne sont pas tapés dans la conversation.

## 8. Journal de recette (à remplir)

### Passage du 2026-11-12 (copie `fourmy_recette`, Chrome + Playwright pour le téléphone)

**Niveau 1, suites automatiques** : tout vert.
- Lint et types : 56 tâches.
- Paquets : 16, dont domain 240.
- Web : 156 tests, puis 158 après les correctifs.
- API : 213 tests.
- e2e Playwright : 10 scénarios ; les 11 captures sont ignorées comme prévu.

**Niveaux 2 et 3, joués à l'écran**

| ID | Résultat | Constat | P | Correctif |
|---|---|---|---|---|
| T-ACC-1 | OK | refus lisible, puis `/farms` avec le badge Responsable | | |
| T-ACC-2 | OK | « Ferme inaccessible » sur une ferme dont on n'est pas membre | | |
| T-DASH-1/2/3 | OK | modèle de croissance (16/06), récoltes probables et parcours GPS (28/10) | | |
| T-GEN-2 | OK | `/registre` et `/carte` redirigés ; `?vue=kanban` accepté | | |
| T-INT-1 | **KO → corrigé** | la recherche perdait des lettres en frappe rapide (champ lu dans l'URL) | P2 | champ à état propre, URL écrite après 250 ms ; test ajouté |
| T-INT-4 | **KO → corrigé** | Entrée dans « Matériels » envoyait le formulaire : **deux interventions créées** (deux identifiants) | P1 | Entrée n'envoie plus depuis un champ ; un identifiant par formulaire ; garde contre le double envoi ; Entrée choisit la 1re proposition ; test ajouté |
| T-INT-4 | OK | 14-48 en L/ha : 120 L → 23,5 kg N/ha (densité 1,4) ; feu rouge nitrates (période d'interdiction) | | |
| T-INT-6 | OK | réalisation refusée sans semence ; feu rouge → motif → enregistré ; stock −941,4 L ; azote 23,5 enregistré | | |
| T-INT-6 | **KO → corrigé** | message « Un semis, plantation demande au moins un semence ou plant » | P3 | messages réécrits (genre, article) |
| T-INT-7 | OK | 120 → 100 L/ha : solde net −784,48 L, audit « corrected », 19,6 kg N/ha | | |
| T-INT-8 | OK | annulation motivée : solde 0, contre-passé au 10/11 | | |
| T-INT-9 | OK | planifiée annulée avec motif (pas de suppression proposée : annulation) | | |
| T-INT-2 | OK | calendrier (attelages repris) et kanban | | |
| — | non reproduit | « parcelle inconnue » sur la fiche juste après une modification, une fois, pendant un rechargement à chaud de Vite | P3 | à surveiller |
| — | observé | « La modification ne change rien » : refus voulu ; préfixe « Règle métier — » un peu technique | P3 | |
| T-PHY-1/2 | OK | autorisation, dose rouge à 30 kg/ha, 2e application rouge, DAR, DRE, créneaux de pulvérisation | | |
| T-PHY-6 | OK pour le registre | IFT 2025 « en attente » : le worker ne tourne pas dans cet environnement local (voulu, pour ne pas solliciter Copernicus et Traccar de la ferme) | | |
| T-PHY-7 | OK | 40 lignes, SIRET signalé ; CSV : BOM, « ; », 26 colonnes, GPS entre guillemets | | |
| T-PHY-8 | OK | 13 chiffres refusés, 14 acceptés : 40 lignes complètes | | |
| T-FERT-2 | OK | 14-48 absent des fertilisants à compléter | | |
| T-FERT-3 | OK (v1) | sol saisi → 247 kg N/ha → « Établi · version 1 » ; starter 17 kg repris ; révision non jouée (tests auto) | | |
| T-FERT-4 | OK | fenêtre « Feu rouge réglementaire », motif sur la fiche et au cahier | | |
| T-FERT-5 | **KO → corrigé** | un apport d'automne (10/11/2026), entre la récolte et la culture suivante non encore créée, n'apparaissait dans **aucun bloc de parcelle** du cahier (2026 ni 2027), seulement dans « épandages interdits » | P2 | la parcelle figure au cahier (« aucune culture saisie pour cette campagne ») ; vérifié : 50 L/ha le 15/10 → 9,8 kg N/ha au cahier 2027 ; test ajouté. Limite : si la parcelle de la campagne suivante existe déjà, l'apport reste compté au précédent (couvert, APLSH), pas en ligne d'apport |
| T-FERT-5 | à décider | l'apport historique du 16/04/2026 (14-48) est saisi en **kg/ha** : 120 kg → 16,8 kg N/ha ; s'il s'agissait de 120 L, il faut le passer en L/ha (23,5) | | donnée |
| — | **KO → corrigé** | en-tête du cahier « du 01/09/2026 au 01/09/2027 » (au lieu du 31/08) | P3 | affiché au 31/08 |
| T-MAT-2 | OK | 4 300 < 4 321 refusé avec le voisin ; correction motivée, ancien relevé barré | | |
| — | observé | le motif de correction n'apparaît pas dans la colonne Note ; cadre vide au-dessus du tableau des relevés | P3 | |
| T-GPS-1/2 | OK | 30 derniers jours par défaut ; brouillon à attelages, rien enregistré, indices ; outil « Tigre » non relié → procédure suggérée fausse (donnée à relier) | | |
| T-3D-2 | OK | rejeu du 28/10 en vue drone ×900, tracé progressif | | |
| T-TEAM-1 | OK | salarié rattaché | | |
| T-ROLE-1 | OK | menu sans Équipe ni Interopérabilité, badge Salarié | | |
| T-ROLE-2 | OK | URL directes refusées | | |
| — | observé | `/team` et `/integrations` affichent « Impossible de charger les données — Accès refusé … (owner) » au lieu d'un message comme `/imports` | P3 | |
| T-ROLE-3/4/5/7 | OK | salarié : crée et annule une intervention (201/200), exporte le registre ; 403 sur sol, suppression de relevé, SIRET, modulation, membres ; Sol et plan en lecture seule | | |
| T-UX-1 | **KO → corrigé** | téléphone (390 px) : pages à 422–656 px. Causes : frise (années superposées), « Se déconnecter », barre de semaine, créneaux de pulvérisation, boutons des récoltes probables, tableau des parcours | P2 | frise réduite à la date sur téléphone, icône de déconnexion, logo masqué, lignes qui passent à la ligne, tableau défilant ; écrans principaux à 390 px |
| — | observé | impression du cahier plus large que le téléphone (589 px) : acceptable pour un document à imprimer | P3 | |
| T-ERR-2 | OK | aucune erreur de Fourmy dans la console (une erreur d'extension du navigateur) | | |

**Second passage, le même jour, après les correctifs**

| ID | Résultat | Constat | P |
|---|---|---|---|
| T-MOD-2/3 | OK | 3 zones NDVI calculées et enregistrées (1 245 kg sur 7,85 ha, machine 50–400 kg/ha) ; ISO-XML et Shapefile : archives zip valides | |
| — | observé | sur une image de sol presque nu (NDVI 0,17–0,27), zones très inégales (4,75 / 0,62 / 2,48 ha) : rien ne prévient que l'image ne se prête pas à la modulation ; l'image proposée par défaut est la plus récente, même postérieure à la frise | P3 |
| T-MOD-4 | OK | « agrirouter n'est pas encore configuré sur ce serveur » | |
| T-INTG-1 / T-SEC-1 | OK | intégrations par thème ; aucun secret réaffiché (seul l'identifiant client Copernicus, qui n'est pas secret) | |
| T-IMP-1 | OK | seul un nom de base est demandé ; import de dossier matériel présent | |
| T-ENT-1 | N.A. | aucun plan d'entretien chez la ferme pilote : la base matériel de l'Arion n'est pas importée (à faire avec l'exploitant) | |
| T-STK-2 | OK | « Aucune cuve à cette date. » | |
| T-SAT-1 | OK | courbe, repères d'interventions, mention Copernicus, cartes de modulation de la parcelle | |
| T-CRO-1 | OK | stades datés (observés / « vers le … »), 13 % de réserve, 49 jours de stress dont 22 autour de la floraison, invitation à déclarer l'irrigation | |
| T-CRO-2 | OK (API) | réserve de 5 mm refusée (400), 150 mm acceptée, retour au défaut | |
| T-PHY-9 | OK | IFT recalculé à la demande : 0,917, en 0,5 s | |
| T-PERF-1/2 | OK | interventions de la campagne en 15 ms ; parcours sur 90 jours en 21 ms | |
| T-FERT-8 | OK | plans imprimables : 60 à 160 ms par plan ; plan établi de Lespourcy repris | |

**Troisième passage : scénarios restants**

| ID | Résultat | Constat | P | Correctif |
|---|---|---|---|---|
| T-PARC-2 | **KO → corrigé** | au clic, la parcelle de la ferme n'était pas trouvée : seules les versions sans fin comptaient, or les parcelles reprises d'Ekylibre en ont une (une par campagne) | P2 | version valide dans l'année d'abord ; test ajouté |
| T-PARC-2/3 | externe | API Carto de l'IGN injoignable (tout apicarto.ign.fr en 404 le 12/11) : PAC et cadastre indisponibles, message « injoignable en partie » affiché | | à revérifier |
| T-ACT-2 | OK | activité créée (couleur de la référence), doublon refusé (409), renommée, supprimée ; « Maïs » (116 productions) non supprimable (422) | | |
| T-ACT-3 / RG-ACT-7 | OK | certification AB sur Lespourcy → feu rouge « organic » sur un produit non bio ; certification retirée | | |
| T-PHY-3 | **KO → corrigé** | mélange Taste + Choriste (catégorie 3) bien interdit, mais le message citait « CARAKOL 3 et ELUMIS » (noms du référentiel pour le même AMM) | P2 | noms des articles de la ferme ; test mis à jour |
| T-PHY-4/5 | OK | « Recharger » l'eau : 135 éléments en 0,4 s ; ZNT de 5 m **rouge** sur Lespourcy (cours d'eau qui borde ou traverse la zone) — à faire confirmer par l'exploitant (fossé ou cours d'eau ?) | | donnée |
| T-PHY-10 | OK | applicateur « non renseigné » d'un attelage sans intervenant (registre 2025) | | |
| T-FERT-6 | OK | apport du 25/09 saisi le 12/11 : « en retard » | | |
| T-FERT-7 | OK | justificatif > 10 Mio refusé, faux PDF refusé, PDF accepté puis retiré | | |
| T-MAT-3 | OK | onglets Technique (vide avant import), Historique, Général ; marque et modèle de l'Arion non renseignés (donnée) | | |
| T-MAT-5 | OK | logo > 1 Mo refusé, GIF refusé, PNG accepté puis retiré | | |
| T-MAT-6 | OK | import de la base Arion 430 de la ferme : 59 opérations (3 non applicables), 11 fluides, 54 pièces, avertissement sur le n° de série | | |
| T-ENT-1 | OK | après import, **50 opérations en retard** (dernière réalisation = mise en service 2013, 0 h, compteur 4 300 h) : à amorcer avec l'exploitant | | |
| T-ENT-1 | OK | « Amorcer » à 4 250 h le 01/10 : contrôles des 10 h dépassés de 40 h | | |
| T-ENT-2 | OK | « Réaliser » : intervention préventive, relevé 4 305 h (origine intervention), opération à « bientôt » (prochaine à 4 315 h) | | |
| T-ENT-3 | OK | pièces à commander sur 6 mois : 22 références (besoin, stock, à commander) | | |
| T-GPS-3/5 | OK | parcours rattaché à une intervention planifiée : reste planifiée, attelage et période ajoutés ; second rattachement 409 ; annulation → parcours libéré | | |
| T-GPS-4 | OK | parcours rattaché 409, liste vide ou > 50 refusée ; « plusieurs matériels » non testable (un seul matériel suivi) | | |
| T-3D-1/4 | OK | 15/07 : « 6 en maturation · 5 en végétation · dont 2 d'après le modèle », météo, NDVI Sentinel-2 du 11/07, mention Copernicus, aucune erreur | | |
| T-3D-3 | OK | dernière position des 3 tracteurs suivis ; rien au-delà de 30 jours | | |
| T-3D-5 | OK | rangs à 190° acceptés (ramenés à 10°), inter-rang de 20 m refusé, retour à l'automatique | | |
| T-SAT-2 | OK | 2 parcelles « trop petites » | | |
| T-SAT-3 | OK | « Ce n'est pas une récolte » : 8 → 7 signalements | | |
| T-ROLE-6/8 | OK | salarié : fichiers de modulation (200), brouillon GPS (200) ; réglages GPS et doses (403) | | |
| T-UX-2 | OK | 1 024 px : aucune page ne déborde | | |
| T-ERR-1 | **KO → corrigé** | hors ligne, le bouton tournait sans rien dire (envoi mis en pause par React Query) | P2 | message « Pas de réseau : l'enregistrement partira dès le retour de la connexion » |
| — | observé | « Réalisée d'emblée » = création puis réalisation : une coupure entre les deux laisse une intervention planifiée (un nouvel envoi la complète, même identifiant) | P3 | |

**Restent non joués** :
- T-3D-6 (Firefox : la version pilotable n'est pas installée ; à vérifier à la main) ;
- T-INTG-2 (le test Copernicus redemande le secret, qui n'est jamais réaffiché ; non ressaisi) ;
- T-MOD-1 (« Moduler » depuis un apport du plan : vérifié par la recette du 11/11) ;
- T-FERT-1 (recette du 11/11).

**Non joués au premier passage** (couverts en partie par les tests automatiques ou la recette du 11/11) :
- T-PARC-2/3, T-CARTO-2 (e2e carto), T-ACT-2/3 ;
- T-PHY-3/4/5/10 ;
- T-FERT-1 (recette du 11/11), T-FERT-6/7 ;
- T-MOD-1 ;
- T-MAT-3/4/5, T-ENT-2 à 4 (aucun plan d'entretien) ;
- T-GPS-3/4/5 (« Ajouter à une intervention » vérifié le 12/11 pendant le tournage) ;
- T-3D-1/3/4/5, T-3D-6 (Firefox) ;
- T-SAT-2/3, T-INTG-2, T-ROLE-6/8/9 ;
- T-UX-2, T-ERR-1.

**Fiche d'anomalie** : ID du scénario, étapes, attendu, obtenu, capture, URL, console, priorité.

## 9. Limites à annoncer à la ferme pilote avec l'envoi

1. Le **mobile** ne montre pas encore les feux réglementaires ni les attelages : saisir les traitements et les apports sur le web, ou les vérifier sur le web.
2. Les données à compléter par l'exploitant :
   - SIRET et PACAGE ;
   - types de sol, analyses de terre et d'eau ;
   - parcelles irriguées ;
   - outils Traccar à relier ;
   - récoltes de maïs 2026 non saisies.
3. Le **14-48 liquide** est corrigé (litres, 14 % N, densité 1,4). Il faut aussi le corriger dans Ekylibre, sinon une nouvelle reprise le ramènerait en tonnes.
4. Les intégrations **Weenat, Sencrop et agrirouter** ne sont pas essayées avec de vrais comptes.
5. Le calcul de dose suit le référentiel de Nouvelle-Aquitaine. Les tables du COMIFER sont embarquées en attendant l'accord demandé. L'outil n'est pas encore labellisé (exigé après le 08/08/2027).
6. Les parcours GPS ne comptent comme « travail » que si le boîtier envoie l'état de travail.
7. Retours attendus : l'ordre des blocs, les libellés, les calculs du plan comparés à sa méthode actuelle, la vue drone et les vidéos.
