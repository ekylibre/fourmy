# Fertilisation azotée : plan de fumure et cahier d'enregistrement

Lots AE à AQ, réalisés le 2026-11-11, puis corrigés après la recette dans Chrome du même jour.

- **FR-REG-3** : plan prévisionnel de fumure (PPF) et cahier d'enregistrement des pratiques, obligatoires en zone vulnérable nitrates.
- Exigences : [`fertilisation-exigences.md`](fertilisation-exigences.md). Conception et réalisation lot par lot : [`fertilisation-design.md`](fertilisation-design.md).
- Région couverte : **Nouvelle-Aquitaine**. Textes suivis :
  - programme d'actions national (PAN 7) ;
  - programme régional (PAR 7, guide du 16/10/2026) ;
  - référentiel régional GREN du 29/07/2025 ;
  - zonage Adour-Garonne du 24/08/2026 ;
  - références du COMIFER (APLSH 2024, grille d'efficacité 2022).

Les tables du COMIFER sont reprises telles quelles, sources citées. L'accord du COMIFER est demandé (brouillon dans `claudedocs/demande_accord_COMIFER.md`). Le référentiel régional exige un outil de calcul labellisé COMIFER après le 8 août 2027.

## Ce que voit l'utilisateur

### Page Fertilisation azotée (Réglementaire → Fertilisation azotée)

- **Obligations** : le nombre de parcelles en zone vulnérable et leur surface, ce que cela impose (plan et cahier pour chacune, conservés 5 campagnes, analyse de sol annuelle au-delà de 3 ha).
- **Zone climatique (APLSH)** : « D'après le département » par défaut. Le responsable peut la changer.
- **Actualiser le zonage** : recalcule la commune et le statut de chaque parcelle (API Géo de l'État, arrêté de bassin).
- **À compléter pour la campagne** : la liste de ce qu'il manque pour que Fourmy calcule les plans et tienne le cahier. L'avancement s'affiche (« 2 sur 6 »). Chaque étape dit pourquoi elle compte et donne un lien vers chaque saisie :
  1. type de sol des parcelles en zone vulnérable, vers l'onglet Sol ;
  2. analyse de terre de la campagne, avec la période où la faire. Une fois faite, l'étape indique laquelle ;
  3. composition des fertilisants utilisés (teneur, type) ;
  4. références des produits organiques (ligne de l'annexe 5, dénomination COMIFER ou C/N) ;
  5. plans de la campagne à qui il manque une donnée ;
  6. couverture des sols après la récolte du précédent. Le lien « saisir le broyage des cannes » ouvre une intervention de broyage déjà remplie, sur la parcelle du précédent et à la date de sa récolte.

  Une fois tout saisi, l'encadré se réduit à une ligne.
- **Plans prévisionnels de fumure** :
  - le tableau de la campagne choisie (parcelle, culture, état, dose, données à compléter) ;
  - « Préparer les plans », qui crée un brouillon par parcelle cultivée et par couvert exporté ;
  - les liens d'impression des plans et du cahier.
- **Suivi de la campagne**, sous le tableau des plans : plans à établir, apports saisis plus de 30 jours après l'épandage, dépassements de dose (avec ou sans mesure de pilotage), épandages enregistrés en période d'interdiction, dépassements du plafond d'APLSH. Ce qui figure déjà dans « À compléter » n'y est pas répété.
- **Parcelles** (zonage, sol, dernier reliquat) et **points d'eau d'irrigation** (origine, teneur en nitrates mesurée, analyses jointes).

### Onglet Sol d'une parcelle

- **Zonage nitrates** : commune, statut, zones du calendrier (ouest, sud, montagne, ZAR). Une commune classée en partie se confirme parcelle par parcelle.
- **Sol** :
  - type de sol du référentiel régional ;
  - profondeur d'enracinement (le colza en dépend) ;
  - point d'eau d'irrigation.
- **Analyses** : reliquat sortie d'hiver, reliquat post-récolte (par horizons) ou analyse de terre. Une analyse de terre donne la matière organique, l'azote total, l'argile, le calcaire, le pH et la CEC. Un bulletin peut être joint à chaque analyse.

### Fertilisants (Stocks → Fertilisants)

- Composition de chaque engrais ou amendement : teneur en azote (% de la masse, kg/t ou kg/m³), part minérale, P2O5, K2O, SO3, densité, type du programme nitrates (0, Ia, Ib, II, III), apport foliaire.
- Fourmy propose une composition d'après le nom (« Urée 46 », « 9-23-30 ») ou le code Lexicon ; elle est à confirmer. Les compositions reprises d'Ekylibre sont marquées comme telles.
- Produits organiques :
  - la ligne de l'annexe 5 (Keq, équivalent minéral déduit de la dose) ;
  - la dénomination COMIFER (APLSH) ou le C/N ;
  - les analyses de produit, valables 5 ans, avec leur bulletin.

### Plan de fumure d'une parcelle

- **Ce que Fourmy sait** :
  - sol, irrigation ;
  - précédent (culture, rendement réalisé, azote apporté) ;
  - objectif de rendement (moyenne olympique des campagnes de la ferme, sinon référence départementale) ;
  - ouverture du bilan, implantation ;
  - reliquat (mesuré ou estimé) ;
  - pluie depuis le 1er octobre, eau d'irrigation.
- **Saisies** :
  - objectif de rendement, date d'ouverture du bilan, période d'implantation ;
  - pour le maïs, l'azote minéral avant 4 feuilles. Il est repris des apports réalisés du semis à 30 jours après, sauf saisie ; la case dit d'où vient la valeur ;
  - pailles du précédent, talles, conditions défavorables ;
  - pour le colza, les pesées de matière verte, les légumineuses associées et l'historique organique.
- **Bilan azoté** : l'équation de l'annexe du référentiel, chaque terme avec sa valeur, son origine (calculé, référentiel, mesuré, saisi, valeur de la ferme) et sa source (annexe, tableau, page). Un terme manquant est nommé : la dose n'est jamais calculée sur une supposition. Le responsable peut remplacer un terme par une valeur de la ferme, avec un motif.
- **Produits organiques** : apports réalisés et prévus sur la campagne, avec leur équivalent minéral (Xa) et leur part dans l'estimation du reliquat. Le bouton « Prévoir un apport » en ajoute.
- **Couvert d'interculture** : un couvert semé (famille, espèces, semis, destruction, biomasse, export) ou des repousses de céréales ou de colza. Le couvert compte dans le bilan (MrCi) et au cahier. Des photos ou des factures peuvent y être jointes.
- **Dose d'un outil ou d'un conseiller** : elle remplace celle de Fourmy, avec l'outil, le conseiller et la date. Leur sortie peut être jointe.
- **Apports prévus** : la proposition de fractionnement du programme régional, modifiable (stade, date, produit, azote, dose de produit). « Moduler » ouvre une carte de modulation à partir de l'apport (voir [`modulation.md`](modulation.md)). La liste des cartes ainsi créées s'affiche avec leur dose moyenne.
- **Établir le plan**, puis le réviser avec un motif. Chaque version reste figée avec ses données, ses termes et son référentiel.
- **Pilotage en cours de saison** : une mesure (N-Tester, Jubil, capteur, satellite) avec la dose conseillée et son bulletin. Elle fixe la dose permise et seule justifie un dépassement du plan.
- **Plan d'un couvert exporté** : un plan séparé, comme le demande le guide du PAR 7. Dose par défaut du tableau 4 (70 kg, moins en ZAR) ou dose d'un bilan saisie comme dose d'un outil ou d'un conseiller.

### Saisie d'une intervention de fertilisation

Un fertilisant se saisit dans l'unité de son choix : celle de l'article (souvent la tonne pour les fermes reprises d'Ekylibre), le kilogramme, ou le litre et le m³ quand la densité de sa composition est connue. Le stock est converti dans l'unité de l'article.

L'encadré **Directive nitrates** se met à jour pendant la saisie :
- azote apporté par hectare (total et efficace) ;
- calendrier d'interdiction d'épandage selon la culture, le type de fertilisant et les zones de la commune ;
- plan établi et dose restante, ou dépassement (justifié ou non par une mesure de pilotage) ;
- premier apport au-delà de 50 kg sur maïs et céréales ;
- conditions d'épandage : gel, forte pluie, distance au cours d'eau, pente ;
- couvert d'interculture : interdictions et plafonds du tableau 4 ;
- plafond d'APLSH de 70 kg sur un couvert ou une prairie ;
- efficacité de l'apport, selon la grille du COMIFER (sol, couverture, pluie à 3 jours, vent, température).

Une intervention réalisée pendant une période d'interdiction, ou interdite sur un couvert, ouvre la fenêtre **Feu rouge réglementaire** : elle ne s'enregistre qu'avec un motif. Le contrôle et le motif restent attachés à l'intervention et s'affichent sur sa fiche. Depuis le mobile, l'intervention est enregistrée et l'interdiction reste visible.

### Éditions

- **Plans prévisionnels de la campagne** : synthèse puis une page par plan (données, bilan sourcé, apports, version établie). On les imprime ou on les enregistre en PDF depuis le navigateur.
- **Cahier d'enregistrement** : pour chaque parcelle :
  - interculture et résidus, couvert et couverture des sols ;
  - semis, récolte, rendement ;
  - apports (date, surface, produit, teneur, type, dose, azote total et efficace, conditions d'apport) ;
  - APLSH du couvert, mesures de pilotage ;
  - total comparé à la dose du plan.

  Le cahier liste aussi les épandages enregistrés en période d'interdiction, avec leur motif. Il s'exporte en CSV.

### Suppressions

Avant de retirer un justificatif, un couvert, une mesure de pilotage, une analyse de sol ou de produit, ou de supprimer un point d'eau, une fenêtre dit ce qui va être supprimé et demande de confirmer.

## Droits

- **Responsable** : tout, dont établir et réviser les plans, forcer une interdiction avec un motif, modifier les références de la ferme, joindre et retirer les justificatifs.
- **Salarié** : il consulte les plans, le cahier et les justificatifs, et voit les contrôles pendant ses saisies d'interventions.

## Limites connues

- Une seule région (Nouvelle-Aquitaine). Les autres régions demandent de réunir leurs référentiels.
- Fourmy ne calcule pas le bilan d'un couvert exporté (objectif de rendement non défini) ; il passe par la dose d'un outil ou d'un conseiller.
- Les adaptations 2 à 11 du tableau 12 du PAR 7 (sols argileux, porte-graines, inondations…) et la limite de 20 % de la SAU en repousses et légumineuses pures ne sont pas vérifiées.
- Lectures choisies par Fourmy, à faire valider :
  - périodes d'apport de l'annexe 5 (fin d'été jusqu'au 15/09, automne ensuite, printemps après l'ouverture) ;
  - lectures de la grille d'efficacité (température moyenne du jour, pluie du jour et des deux suivants, vent maximal, couverture d'après le NDVI) ;
  - zone climatique APLSH par défaut.
- Pas de rôle conseiller, ni de contrôles sur le mobile hors ligne.

## Tests

- Moteur (`packages/domain`) : bilan, colza, Keq, APLSH, calendrier, conditions d'épandage, couverture des sols, couverts, efficacité, pilotage.
- Référentiels (`packages/fertilization-refs`) : tables recopiées et exemples des annexes recalculés.
- API : `apps/api/test/fertilization-*.integration.test.ts`, `fertilizers.integration.test.ts`, `modulation.integration.test.ts`.
- Web : `apps/web/test/fertilization*.test.tsx`, `fertilizers.test.tsx`, `modulation.test.tsx`.
- Recette manuelle dans Chrome sur la copie locale d'une ferme pilote : `claudedocs/recette_fertilisation_chrome.md`, hors suivi.
