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

| ID | Date | Résultat (OK / KO / N.A.) | Anomalie | Priorité | Correctif (commit) |
|---|---|---|---|---|---|
| | | | | | |

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
