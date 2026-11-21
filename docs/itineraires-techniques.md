# Itinéraires techniques

Un itinéraire technique (ITK) décrit les interventions **prévues** d'une
culture : travail du sol, semis, fertilisation, traitements, récolte. Chaque
étape est datée par rapport au semis ou à la récolte (« semis J-30 »,
« récolte J+5 »), ou à une date fixe (« 15/02 »), avec ses intrants et leurs
doses à l'hectare, ses matériels et son débit de chantier.

Les ITK servent à préparer l'assolement : on en choisit un à l'affectation
d'une culture, puis « Préparer les interventions prévues » crée les
interventions de la campagne (voir `docs/assolement.md`), et l'onglet
**Travaux** de l'assolement estime les heures de chantier, les trajets et les
pointes de travail, et l'onglet **Intrants** les quantités à prévoir et à acheter.

## Où

**Activités → Itinéraires techniques**, ou depuis l'itinéraire d'une activité
(« Itinéraires prévus de l'activité »). Tous les membres consultent ; le
responsable crée et modifie.

## Créer un itinéraire

1. « Nouvel itinéraire » : activité, nom, conduite (conventionnelle ou
   biologique).
2. « Ajouter une étape » pour chaque intervention :
   - **procédure** (labour, semis, pulvérisation…) et libellé si besoin ;
   - **quand** : jours avant (négatif) ou après le semis ou la récolte, ou
     date fixe (cochez « année précédant la récolte » pour une date d'automne
     d'une culture d'hiver) ; plage ± jours ;
   - **passages** répétés (trois apports tous les 30 jours) ;
   - **part de la surface** concernée, et « si besoin » pour une étape
     facultative ;
   - **intrants** : un article de la ferme ou un intrant générique
     (« Azote 40 u »), avec une dose à l'hectare traité ;
   - **chantier** : attelage type, ou matériels et intervenants ; **débit**
     en ha/h si vous le connaissez.
3. **Enregistrer.**

Le tableau montre la date de chaque étape pour un semis et une récolte
d'exemple (dates types de la culture), modifiables au-dessus de la frise.
« Trier par date » remet les étapes dans l'ordre du temps.

## Créer un itinéraire depuis l'historique

« Depuis l'historique » (catalogue), ou « Créer un itinéraire depuis
l'historique » sur l'itinéraire d'une activité :

1. choisissez l'activité et les campagnes à reprendre (les deux dernières
   sont cochées) ;
2. « Proposer » : Fourmy regroupe les interventions réalisées en étapes,
   datées par rapport au semis (date de semis de la culture, sinon première
   intervention de semis) ou à la récolte. Pour chaque étape :
   - le **décalage médian** et la plage habituelle ;
   - la **part** de la surface concernée ; « si besoin » quand moins de la
     moitié des parcelles l'ont eue ;
   - la **dose médiane à l'hectare** de chaque intrant ;
   - les **matériels et intervenants habituels** ;
   - le **débit observé** quand les durées sont connues à l'heure près
     (pas pour les interventions importées au jour près) ;
3. relisez la proposition, nommez l'itinéraire, puis « Créer l'itinéraire ».

Une prairie ou une luzerne en place depuis plusieurs années est décrite à
**dates fixes** (« 15/10 de l'année précédente », « 18/03 »). Les étapes
sans matériel ni intervenant sont signalées « à compléter » ; dans la
fenêtre d'une étape, « Reprendre ce débit » recopie le débit observé.

## Aperçu sur la frise

La frise montre la culture du semis à la récolte d'exemple, les travaux
au-dessus, les intrants au-dessous, en pointillés (prévu). Un clic sur une
étape l'ouvre.

## Modifier, dupliquer, supprimer

- Deux personnes (ou deux onglets) modifient le même itinéraire : la
  seconde à enregistrer est prévenue et choisit de **recharger** (perdre ses
  modifications) ou d'**écraser**.
- Un article, un matériel ou un intervenant supprimé de la ferme reste dans
  l'itinéraire, signalé « à remplacer ».
- **Dupliquer** crée « … (copie) », à adapter (autre conduite, autre
  variété).
- **Supprimer** un itinéraire déjà utilisé par un assolement le désactive
  seulement : les assolements qui l'utilisent ne changent pas.

## Débit de chantier

Le temps passé au champ d'une étape est la surface (× part, × passages)
divisée par le débit de chantier, pris dans cet ordre :

1. **saisi** dans l'étape (ha/h) ;
2. **observé** sur vos chantiers : médiane des interventions réalisées de
   même procédure avec le même matériel, à l'heure près, sur au moins trois
   chantiers (pas les interventions importées au jour près) ;
3. **barème BCMA** : la ligne du barème rattachée au matériel (fiche du
   matériel, panneau « Débit de chantier »), ramenée à sa largeur ; ou, pour
   une étape sans matériel de la ferme, le « type de matériel » choisi dans
   le barème ;
4. **largeur × barème** : largeur de travail du matériel × débit par mètre
   de la famille du barème pour la procédure.

Sinon le débit est « inconnu » : l'étape n'est pas comptée, et c'est signalé.
La colonne Débit de l'éditeur montre la valeur retenue et sa source, et le
total d'heures par hectare de l'itinéraire.

Le barème BCMA (édition 2024, guides CEGARA « Coût des façons culturales »)
est repris avec l'accord du CEGARA et du BCMA ; il est cité avec chaque débit
qui en vient.
