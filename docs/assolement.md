# Assolement prévisionnel

Fourmy prépare l'assolement de la campagne à venir : répartition des cultures
sur les parcelles, découpes et fusions, contrôles en direct (PAC,
agronomie, certifications, réglementaire), puis validation qui crée les
productions. La campagne est l'année de récolte : un blé semé en
octobre 2026 appartient à l'assolement 2027.

Besoins, conception et plan : [`claudedocs/besoins_assolement.md`](../claudedocs/besoins_assolement.md),
[`claudedocs/conception_assolement.md`](../claudedocs/conception_assolement.md),
[`claudedocs/workflow_assolement.md`](../claudedocs/workflow_assolement.md).
Lecture de la fiche de conditionnalité BCAE 7 : [`docs/pac/rapport_pac.md`](pac/rapport_pac.md).

## Où le trouver

- **Activités** → bouton **Assolement** : la campagne de la frise et la suivante. « Préparer l'assolement » si la campagne n'a encore rien ; « Modifier l'assolement » si elle a déjà des cultures saisies ou importées, ou un assolement validé ; « Reprendre » un brouillon.
- Une campagne qui a déjà des cultures mais pas d'assolement s'affiche telle quelle (« cultures saisies ») ; « Modifier l'assolement » ouvre un brouillon à partir d'elles.
- Page `/f/:ferme/crop-plan/:année` ; flèches vers les années voisines.
- Le responsable prépare et valide ; les autres membres consultent.

## Parcellaire repris de l'an passé

Les fermes reprises d'Ekylibre ont une parcelle par culture et par campagne (« Braquet Maïs 2026 »), close à la fin de l'année. Quand une parcelle de l'an passé se termine en décembre et que rien ne la remplace, l'assolement la **reprend** :

- sous un nom sans culture ni année (« Braquet » ; « Cazala 2 » si deux parcelles reprises donnent le même nom) ;
- deux parcelles de l'an passé qui se recouvrent à 90 % : la plus grande seule ;
- « Ne pas reconduire » écarte une parcelle qui n'est plus cultivée ; « Les reconduire » la reprend ;
- la validation crée la parcelle de la campagne, à la suite de l'ancienne (filiation, certifications reprises) ; une découpe ou une fusion attend que la reprise soit validée.

L'historique d'une parcelle se retrouve aussi par **recoupement géographique** : pour une année sans culture connue, la culture de la parcelle qui en recouvre au moins la moitié cette année-là.

## Mode plein écran

Un brouillon s'ouvre en plein écran : la carte occupe tout l'écran sous une barre de commande (titre, enregistrement, annuler et rétablir, abandonner, valider, quitter).

- En haut à gauche, la légende ; au centre, découper et fusionner ; à droite, le panneau Parcelles, Récapitulatif, Contrôles, Historique, Réglages, repliable ; les boutons de zoom passent en bas à gauche.
- La feuille d'affectation monte du bas dès qu'une parcelle est choisie ; dérobée et couvert sont repliés derrière « Dérobée, couvert… ».
- « Quitter » revient à l'interface classique, le brouillon gardé (« Reprendre en plein écran ») ; valider ou abandonner y revient aussi.
- Le message « parcellaire repris » se ferme et reste fermé pour la campagne (mémorisé dans le navigateur).

## Préparer

1. **Préparer l'assolement** : le brouillon part des cultures déjà saisies ou importées pour l'année. Rien ne change dans les productions avant la validation.
2. **Choisir des parcelles** : clic sur la carte, Maj + glisser, ou cases de l'onglet **Parcelles** (culture de l'an passé et culture prévue). Le filtre « Sans culture prévue » ne garde que celles-là, sur la liste comme sur la carte.
3. **Affecter** (formulaire sous la carte) une activité avec ses dates prévues, pré-remplies d'après les dates types de Lexicon pour une culture annuelle, et son **itinéraire technique** (proposé quand l'activité n'en a qu'un ; voir `docs/itineraires-techniques.md`), avec son **rendement** (q/ha) et son **prix de vente** (€/t) prévus : laissés vides, les valeurs par défaut affichées sous les champs s'appliquent (voir `docs/economie.md`) ; ajouter une **culture dérobée** ; marquer **sans culture** (jachère) ; **retirer**. La sélection se vide après le geste : les parcelles prennent la couleur de leur activité.

Sur la carte : parcelles affectées à la couleur de leur activité, sans culture en gris, encore à affecter en pointillés rouges ; légende en haut à gauche (activités avec leur image et leur surface, parcelles à affecter).
4. **Couvert d'interculture** (après la culture) : nature, famille, espèces, dates. Il est enregistré à la validation dans le cahier de fertilisation de la campagne suivante (un couvert par parcelle).
5. **Découper** une parcelle (ligne tracée sur la carte) ou **fusionner** des parcelles qui se touchent. Les nouvelles parcelles existent à partir de la **date d'effet**, proposée le lendemain de la dernière récolte de la parcelle d'origine (sinon le 1er janvier de la campagne) et modifiable ; la parcelle d'origine reste telle quelle avant. Noms modifiables ; « Retirer la dernière » annule une opération en attente.

Le brouillon s'enregistre au fil de l'eau ; **Annuler** et **Rétablir** reviennent sur les gestes. Si l'assolement est modifié ailleurs (autre onglet, autre responsable), l'écran propose de recharger sa version ou de garder la sienne.

## Récapitulatif et contrôles

- **Récapitulatif** : surface par activité et par famille, part de la surface, écart avec l'an passé, parcelles à affecter.
- **Contrôles**, recalculés à chaque geste, par section repliée (feu et nombre de points à vérifier) ; « Voir » choisit les parcelles en cause :

| Section | Contrôles | Source |
|---|---|---|
| PAC | BCAE 7 : rotation annuelle (35 % des terres arables cultivées), rotation pluriannuelle par parcelle (4 ans), diversification ; exemptions ; le verdict retient le critère respecté | fiche de conditionnalité 2026 |
| Agronomie | délai de retour d'une culture (blé, crucifères, pois, soja, féverole, lentille, luzerne, lin, betterave, pomme de terre), précédent à éviter | wiki Triple Performance, phrase citée ; délais réglables |
| Certifications | AB : statut prévu de la récolte (C1, C2, AB), rotation, mixité, fusion AB / non AB ; HVE : projection des points 4.2 à 4.4 | contrôles HVE et AB (`docs/controles-hve-ab.md`) |
| Réglementaire | parcelle à moins de 5 m d'un point d'eau (ZNT), en aire d'alimentation de captage, en site Natura 2000 (prairie permanente retournée) | BD TOPO ; agences de l'eau et INPN via Lexicon |

Données manquantes (parcelle sans culture prévue, culture sans code PAC, historique incomplet) : jamais conforme d'office. Les constats agronomiques et réglementaires ne bloquent jamais la validation.

## Valider, réviser

- **Valider…** : aperçu des changements (campagne, productions, découpes et fusions, couverts), points bloquants avec « Voir », constats. Bloquent : une parcelle sans culture ni « sans culture », la suppression d'une culture qui porte des interventions réalisées, une date d'effet incohérente (avant la fin d'une culture, intervention réalisée après sur la parcelle d'origine), des formes qui ne recouvrent pas la parcelle d'origine, une fusion de surfaces AB et non AB.
- **Découpe et interventions prévues** : celles qu'un itinéraire a générées sur la parcelle d'origine après la date d'effet sont annulées (« Préparer les interventions prévues » les repropose sur les morceaux) ; pour celles saisies à la main, la fenêtre de validation demande de choisir le morceau qui la reçoit, ou de la **répartir sur chaque morceau** (quantités totales au prorata des surfaces, doses à l'hectare gardées).
- La validation crée les productions, les parcelles découpées ou fusionnées (avec leur filiation et leurs certifications) et les couverts, puis fige une **version** (changements, constats).
- **Préparer les interventions prévues** (assolement validé) : pour chaque culture qui a un itinéraire, les interventions de ses étapes, datées d'après le semis et la récolte prévus. Cochez ce qui est à créer, mettre à jour ou retirer, ajustez les dates, puis confirmez. Relancée après une révision ou une modification d'un itinéraire, elle ne refait que ce qui a changé ; une intervention modifiée à la main ou réalisée n'est jamais touchée. Les étapes sans date (semis ou récolte inconnus) restent « à préciser ».
- **Modifier** rouvre un assolement validé (le brouillon repart de l'état actuel) ; la nouvelle validation demande un motif (sortie d'hiver…). **Historique** : les versions et leurs changements. **Abandonner le brouillon** revient à la dernière version.

## Travaux

Onglet **Travaux** (cultures qui ont un itinéraire technique) :
- heures au champ et sur la route, kilomètres ;
- débits par source (saisi, observé, barème) et ce qui est inconnu (débit, date, trajet) ;
- heures de main-d'œuvre par semaine, avec la capacité de la ferme (personnes actives × heures par semaine des réglages) et les semaines en pointe ;
- cumuls par personne, matériel, activité et intervention.

Trajets : du siège (Ma ferme) à chaque parcelle, par la route (calcul d'itinéraire tracteur), un aller-retour par journée de chantier ; sans calcul d'itinéraire, distance à vol d'oiseau × 1,3 à 25 km/h, signalée.

## Intrants

Onglet **Intrants** : pour chaque semence, engrais, produit phyto ou autre intrant des itinéraires, la quantité à prévoir (dose × surface × part × passages, dans l'unité du stock), comparée au stock du jour moins ce que réservent les interventions prévues saisies à la main ; la colonne « À acheter » donne le manque. Les étapes « si besoin » sont comptées à part.
- **Plan de fumure** établi : ses apports remplacent les engrais minéraux de l'itinéraire de la parcelle (quantité de produit calculée d'après la teneur en azote) ; un apport sans engrais choisi est compté en kg d'azote.
- Une dose qui ne se convertit pas (PMG, densité ou unité à compléter) reste dans l'unité de la dose, signalée.

## Réglages (responsable)

Onglet **Réglages** : critère BCAE 7 mis en avant, ferme en plaine du Rhin (diversification à points, non calculée : « à vérifier »), délais de retour propres à la ferme, journée de travail et heures par personne et par semaine (onglet Travaux).

## Limites connues

- Repères agronomiques à relire par un agronome ; soja : pages divergentes (2 ans retenus).
- BCAE 7 : barème à points de la plaine du Rhin non calculé ; liste des légumineuses de l'exemption reconstituée (à vérifier sur la notice Télépac).
- Découpe : pas d'annulation d'une découpe validée (fusionner les morceaux) ; mobile mis à jour à la première synchronisation complète après la date d'effet ; une intervention prévue en attelages ou sur plusieurs parcelles se reporte sur un seul morceau.
- Interventions prévues : une par parcelle et par étape (pas encore de chantier multi-parcelles) ; un intrant générique (« Azote 40 u ») est noté dans l'intervention, à préciser.
- Travaux : la capacité des pointes compte toutes les personnes actives de la ferme ; un aller-retour par journée de chantier et par parcelle (pas de tournée entre parcelles) ; un morceau de découpe reprend le trajet de sa parcelle d'origine.
- Zonages : chargés avec le référentiel Lexicon (jeux `protected_water_zones`, `protected_natural_zones`) ; sans eux, la section Réglementaire ne voit que les points d'eau.

## Suite

Temps 2 : itinéraires techniques, interventions prévues, temps de travaux et besoins en intrants faits. Temps 3 (module économique : prix, rendements, marges) : `claudedocs/besoins_assolement.md` §5 et §6.
