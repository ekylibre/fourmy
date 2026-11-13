# Itinéraires techniques : expression des besoins

Version du 2026-11-13, issue d'un remue-méninges ; questions tranchées le
même jour (§10). Suite prévue : conception (`/sc:design`), puis découpage en
lots.

## 1. Constat

- Les interventions de Fourmy ne se lisent aujourd'hui qu'en liste ou en
  calendrier : liste des interventions, onglet « Interventions » de la fiche
  parcelle, vues calendrier et kanban. Rien ne montre **l'enchaînement** des
  travaux d'une culture, ni la succession des cultures d'une parcelle.
- Une activité (Maïs, Vignes AOP…) n'a qu'une page de liste : on ne voit pas
  comment ses parcelles ont été conduites.
- OSFarm publie **TIKA** (`@osfarm/itineraire-technique`, MIT,
  github.com/osfarm/itineraire-technique), un visualisateur d'itinéraires
  techniques fait pour Triple Performance. Deux rendus : une **frise**
  (zoom dans le temps, interventions au-dessus et au-dessous de la culture,
  liste textuelle à côté) et une **rotation** en cercle.
- Ce que la bibliothèque attend, et ce que Fourmy a :

| TIKA | Fourmy aujourd'hui |
|---|---|
| Étape (culture) avec date de début et de fin | Production = parcelle × campagne × activité, **sans dates** |
| Culture secondaire (`secondary_crop`) | Couverts d'interculture, avec dates de semis et de destruction |
| Intervention : jour relatif au début de l'étape, nom, description | Intervention datée, procédure (34 utilisées sur la ferme pilote), intrants, matériels, équipe, météo, IFT |
| Deux couloirs : au-dessus, au-dessous | Une forme par procédure : travail, semis, récolte, fertilisation, traitement, entretien |
| Attributs libres de l'étape (variété, densité…) | Variété de l'activité, intrants de semis |

- **Contraintes de la bibliothèque** (version 1.2.15, lue le 2026-11-13) :
  - JavaScript sans module : une classe globale `RotationRenderer` ;
  - dépend de jQuery, Underscore, Bootstrap (grille), Font Awesome et
    ECharts 6, chargés depuis un CDN ;
  - construit son HTML en concaténant les noms et les descriptions, sans
    échappement ;
  - pas de rappel au clic vers l'application hôte ;
  - pas de distinction entre une intervention réalisée et une prévue.

  Fourmy est en React avec Mantine, tout est empaqueté (aucun CDN), et les
  graphiques actuels sont en Recharts : ECharts serait une nouvelle
  dépendance.

## 2. Décisions (2026-11-13)

1. **Dans un premier temps, on visualise** les interventions existantes.
   La gestion (itinéraires prévisionnels, modèles, éditeur) vient ensuite
   (§8).
2. **Activité : deux vues.** Une frise **fusionnée** de toute l'activité par
   défaut, et le détail **parcelle par parcelle** en un clic.
3. **Parcelle : deux périodes.** La **campagne** choisie dans la frise de
   l'application par défaut, et un bouton pour élargir à la **rotation sur
   plusieurs années**.
4. **Couloirs** : au-dessus de la culture, les **travaux** (travail du sol,
   semis, récolte) ; au-dessous, les **intrants** (fertilisation,
   protection des cultures). Le partage suit la forme de la procédure.
5. **Bibliothèque : on contribue en amont.** Fourmy utilise le paquet npm
   publié par OSFarm. Ce qui manque à Fourmy est proposé à OSFarm, plutôt
   que de garder une copie modifiée : module ES, pas de jQuery ni de
   Bootstrap, textes échappés, rappel au clic, statut des interventions.
   Relecture et publication côté OSFarm : David et Bertrand. Pour ne pas
   attendre, les modifications se font dans un fork
   `ekylibre/itineraire-technique`, puis sont reversées à OSFarm (conception
   §7).
6. **Activités végétales seulement** : cultures végétales, viticulture et
   pépinière. L'élevage et les activités sans parcelle sont hors sujet.
7. **Web seulement** : pas d'itinéraire dans l'application mobile.

## 3. Accès

- **E1. Fiche parcelle** : un onglet « Itinéraire technique », à côté de
  l'onglet « Interventions ».
- **E2. Activité** : depuis la page Activités, un lien « Itinéraire » sur
  chaque activité végétale (familles cultures végétales, viticulture,
  pépinière). Il ouvre une page dédiée à l'activité, pour la campagne
  choisie.
- **E3. Droits** : tout membre de la ferme consulte, lecteur compris.
  Aucune écriture dans ce premier lot.

## 4. Vue parcelle

- **Couloirs** (décision 4) : au-dessus, travail du sol, semis, récolte et
  travaux de la vigne (taille, rognage, broyage) ; au-dessous,
  fertilisation, protection des cultures et irrigation.
- **E4. Campagne** : une étape pour la culture principale de la campagne
  choisie, une étape secondaire pour le couvert d'interculture s'il y en a
  un, et toutes les interventions de la parcelle sur la période.
- **E5. Rotation** : le bouton « Rotation » montre les campagnes
  successives de la parcelle, une étape par culture. On choisit le nombre
  d'années : 3 par défaut, toutes celles qui ont des données au plus. Les
  deux rendus de TIKA restent disponibles : frise et cercle.
- **E6. Dates d'une culture** : du premier semis ou de la première
  plantation au dernier chantier de récolte de la campagne. Sans semis ou
  sans récolte (vigne, prairie, culture en cours), on prend les bornes de la
  campagne, et la frise l'indique (« dates de la campagne »). Pas de
  correction à la main dans ce lot.
- **E7. Une intervention sur plusieurs parcelles** figure dans la frise de
  chaque parcelle concernée.

## 5. Vue activité

- **E8. Frise fusionnée** : une seule étape, la culture de l'activité pour
  la campagne. Les interventions de même procédure faites à **7 jours au
  plus** d'intervalle (**15 jours** pour la récolte) sont **regroupées** en
  une seule marque : « Semis, 5
  parcelles, du 12 au 18 avril ». La marque se place à la date médiane du
  groupe, et sa description donne les parcelles et les dates.
- **E9. Parcelle par parcelle** : on choisit une parcelle de l'activité
  (liste à côté de la frise, ou clic sur une marque regroupée) et l'on passe
  à sa vue campagne (E4).
- **E10. Parcelles sans intervention** : la frise donne leur nombre, pour
  que la vue fusionnée ne paraisse pas complète à tort.

## 6. Contenu des marques

- **E11. Nom** : la procédure (libellé français déjà utilisé dans
  l'application), avec le produit principal pour un intrant : « Pulvérisation
  · Karaté K ».
- **E12. Description** au clic ou dans la liste textuelle :
  - date et durée ;
  - parcelles et surface travaillée ;
  - intrants avec leur dose ;
  - matériels et équipe ;
  - stade BBCH, météo, IFT pour un traitement.
- **E13. Vers la fiche** : un clic sur une marque permet d'ouvrir la fiche
  de l'intervention dans Fourmy.
- **E14. Réalisé et prévu** : les interventions prévues se distinguent des
  réalisées (style différent). Les interventions annulées n'apparaissent
  pas.
- **E15. Entretien du matériel** et interventions sans parcelle : exclus de
  la frise.

## 7. Exigences non fonctionnelles

- **N1. Aucun appel externe.** Tout est empaqueté avec l'application : ni
  CDN, ni API d'OSFarm (l'éditeur de TIKA géocode et interroge
  `itk-info.tripleperformance.fr` ; le visualisateur seul n'en a pas besoin).
- **N2. Sûreté.** Les noms de parcelles, de produits et les notes saisies
  sont du texte : ils ne doivent jamais être interprétés comme du HTML.
- **N3. Intégration visuelle.** Ni Bootstrap ni Font Awesome dans la page :
  les styles de TIKA ne débordent pas sur le reste de l'application.
- **N4. Poids.** ECharts n'est chargé que sur les écrans d'itinéraire
  (chargement différé), pas dans le paquet principal.
- **N5. Volume.** Une parcelle sur dix ans (quelques centaines
  d'interventions) et une activité de 30 parcelles s'affichent en moins
  d'une seconde.
- **N6. Accessibilité.** La liste textuelle de TIKA reste affichée : elle
  donne la même information que le graphique, au clavier et au lecteur
  d'écran.
- **N7. Hors ligne.** Pour une ferme gardée hors ligne (« Ma ferme » F5),
  l'itinéraire se consulte sans réseau, comme les autres lectures.
- **N8. Échange.** Le JSON produit pour TIKA suit son format publié : il
  pourra s'exporter vers Triple Performance plus tard sans conversion.

## 8. Plus tard (gestion)

- Itinéraire **prévisionnel** d'une activité : un modèle d'interventions
  (dates relatives au semis), appliqué aux parcelles pour créer les
  interventions prévues.
- **Comparaison** prévu / réalisé (TIKA a une vue « avant / après »).
- **Éditeur** TIKA branché sur Fourmy, sur le modèle de ses chargeurs Wiki et
  Itinera.
- **Export** vers Triple Performance, et diagramme climatique (normales du
  point météo de la ferme).

## 9. Récits utilisateur

**R1. Revoir la conduite d'une parcelle.** *En tant que membre, j'ouvre la
fiche d'une parcelle et je vois l'itinéraire de sa culture cette année.*
- Les travaux sont au-dessus de la culture, les intrants au-dessous, à leur
  date.
- Un clic sur une marque montre le détail et mène à la fiche de
  l'intervention.

**R2. Comprendre une rotation.** *En tant que responsable, j'élargis la vue à
trois ans pour voir la succession des cultures et des couverts.*
- Chaque culture et chaque couvert est une étape à ses dates.
- Je passe de la frise au cercle.

**R3. Comparer les parcelles d'une activité.** *En tant que responsable,
j'ouvre l'itinéraire du maïs 2026 et je vois, en une frise, comment mes
parcelles ont été conduites.*
- Les chantiers proches sont regroupés, avec le nombre de parcelles.
- Je descends sur une parcelle en un clic.

**R4. Sans réseau.** *En tant que membre, je consulte sur mon ordinateur
l'itinéraire d'une parcelle d'une ferme gardée hors ligne.*

## 10. Questions tranchées (2026-11-13)

1. **Regroupement** de la vue fusionnée : 7 jours d'écart au plus, 15 jours
   pour la récolte (E8).
2. **Couloirs** : l'irrigation avec les intrants, les travaux de la vigne
   avec les travaux (§4).
3. **Dates d'une culture** : la règle « premier semis, dernière récolte,
   sinon bornes de la campagne » suffit ; pas de correction à la main (E6).
4. **Contributions à TIKA** : relues et publiées par David et Bertrand.
5. **Périmètre** : activités végétales seulement (décision 6).
6. **Mobile** : non (décision 7).
