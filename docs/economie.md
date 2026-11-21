# Économique

Le module **Économique** rassemble les prix de la ferme, hors taxes, qui
servent au calcul des marges de l'assolement (temps 3 de l'assolement,
`claudedocs/conception_assolement_eco.md`).

## Où

Menu **Économique** (`/f/:ferme/economics`), un onglet par nature de prix :

| Onglet | Prix | Unité habituelle |
|---|---|---|
| Intrants | semences, engrais, produits phyto, autres articles du stock | unité du stock (tonne, litre, dose…) |
| Matériels | prix propre d'un matériel, à la place du barème BCMA | hectare ou heure (tracteurs) |
| Main-d'œuvre | coût horaire (salaire et charges) | heure |
| Services | prestations (ETA, CUMA) par procédure | hectare ou heure |
| Produits | prix de vente du produit principal de chaque activité | tonne, quintal… |

## Prix datés

Un prix a une **date d'effet**. Enregistrer un nouveau prix l'ajoute à partir
de cette date ; l'ancien reste dans l'historique (bouton horloge de la ligne).
Un calcul fait pour une date passée reprend donc les prix de l'époque.

Chaque prix garde sa **source** : saisi, Lexicon, barème BCMA, Commission
européenne (agrifood) ou achat.

## Saisie et modification en masse

- Saisir le montant et l'unité sur une ligne, puis **Enregistrer** : seules les
  lignes modifiées sont enregistrées, à la date d'effet choisie (aujourd'hui
  par défaut).
- Pour plusieurs lignes : les cocher, puis **Prix à** (même montant pour
  toutes) ou **Variation (%)** (hausse ou baisse du prix en vigueur), puis
  **Enregistrer**.

Seul le responsable de la ferme modifie les prix ; les autres membres les
consultent.

## Matériels et barème BCMA

Sans prix propre, un matériel rattaché au barème BCMA (fiche du matériel ou
éditeur d'itinéraire) est compté à son coût « façons culturales » : coûts
fixe et variable, carburant compris. Le coût du barème s'affiche dans la
colonne **Repère** ; « Rattacher au barème… » ouvre la fiche du matériel.

## Repères Lexicon des produits

Dans l'onglet **Produits**, chaque production à grain (blé, orge, maïs grain,
colza, tournesol…) affiche des repères tirés du référentiel Lexicon :

- prix payé aux producteurs, du département de la ferme et de France (Agreste) ;
- cours **MATIF** ;
- prix de marché européens relevés en France (Commission européenne,
  places comme La Pallice, Rouen ou Bordeaux).

« Reprendre » remplit le prix avec ce repère ; la ligne garde sa source
(Lexicon), sa date et sa référence une fois enregistrée. Les repères de plus de
3 ans et les places de marché qui ne sont plus relevées (6 mois de retard sur
la plus récente) ne sont pas proposés. Les productions fourragères (maïs
fourrage, prairies) n'ont pas de repère de prix du grain.

Le département vient du code INSEE du siège de l'exploitation (profil de la
ferme). Le **rendement Agreste** du département pour la dernière campagne
s'affiche sous le nom de la production ; il servira de rendement par défaut
à l'assolement quand la ferme n'a pas d'historique de récolte.

Ces références sont chargées par la synchro Lexicon (jeux `productions` et
`eu_market_prices`, en accès libre).

## Prix de marché de la Commission européenne (agrifood)

Le worker interroge chaque semaine l'API agrifood de la Commission
européenne (prix des céréales relevés en France, en €/t, par place et par
semaine) et garde les prix en cache. Après un échec, il réessaie le
lendemain ; le cache et la copie Lexicon des mêmes prix restent utilisés.
Quand le cache a des prix pour une espèce, ils remplacent la copie Lexicon
dans les repères ; seul le débouché courant de la production est retenu s'il
est coté (blé panifiable pour le blé tendre, orge brassicole pour l'orge de
printemps, orge fourragère pour l'orge d'hiver…).

État au 21/11/2026 : l'API répond en erreur (point d'entrée suspendu) ; les
repères viennent de Lexicon.

## Rendement et prix prévus de l'assolement

Dans le panneau **Affecter** de l'assolement, le rendement (q/ha) et le prix
de vente (€/t) prévus se saisissent avec l'activité. Laissés vides, ces
valeurs par défaut s'appliquent, affichées sous les champs avec leur source :

| Valeur | Par défaut, dans l'ordre |
|---|---|
| Rendement | médiane des rendements de la ferme pour l'activité sur les trois campagnes précédentes (récoltes enregistrées, moyenne des parcelles par campagne) ; sinon médiane des trois dernières campagnes Agreste du département |
| Prix de vente | prix du produit principal saisi dans l'onglet Produits ; sinon place de marché (agrifood, puis Lexicon) ; sinon MATIF ; sinon prix producteur du département, puis de France |

Les valeurs saisies sont gardées avec la culture à la validation de
l'assolement (`productions.attrs.forecasts`).

Limite : le rendement de la ferme est calculé sur les récoltes en quintaux,
tonnes ou kilogrammes ; pour une culture fourragère, il dépend de la façon dont
les récoltes ont été saisies (matière brute ou sèche) et mérite d'être vérifié.

## Marges de l'assolement (onglet Économie)

L'onglet **Économie** de l'assolement estime les marges prévues de la
campagne, par activité et pour l'assolement, en €/ha ou en total, à partir du
brouillon (recalculées à chaque geste) :

| Poste | Calcul |
|---|---|
| Produit | rendement × surface × prix de vente (saisis à l'affectation, sinon par défaut) |
| Charges opérationnelles | besoins en intrants de l'onglet **Intrants** × prix de l'article (converti dans l'unité du stock) ; étapes « si besoin » non comptées |
| **Marge brute** | produit − charges opérationnelles |
| Mécanisation | pour chaque passage daté : prix propre du matériel (à l'hectare ou à l'heure), sinon son coût du barème BCMA (à l'hectare, ou à l'heure pour un tracteur) ; une étape sans matériel de la ferme : type du barème choisi dans l'ITK, sinon prestation de la procédure (onglet Services) |
| Main-d'œuvre | heures des passages (champ et trajets, comme l'onglet **Travaux**) × personnes × coût horaire ; rien pour une prestation |
| **Marge directe** | marge brute − mécanisation − main-d'œuvre |

Rien n'est compté pour zéro sans le dire : un prix, un rendement ou un débit
manquant rend le poste **incomplet** (montant en orange, suivi de « * ») et
figure dans **À compléter**, avec les hectares concernés et un lien vers
l'onglet du module Économique où saisir le prix. Une culture sans itinéraire
technique n'a que son produit.

### Comparaison avec la campagne précédente

Sous le tableau, les colonnes **Marge directe N-1** et **Écart** comparent
chaque activité au **réalisé** de la campagne précédente ; le détail du
réalisé (mêmes postes, ses propres manques) s'ouvre dessous. Réalisé
simplifié :

- produit : rendement des récoltes enregistrées × surface × prix de vente de
  la ferme à la fin de la campagne (sinon le prix par défaut) ;
- charges opérationnelles : intrants des interventions réalisées, convertis
  dans l'unité du stock, au prix en vigueur le jour de l'intervention ;
- mécanisation : matériels des interventions, à leur prix propre ou au barème
  BCMA (à l'hectare travaillé, ou à l'heure) ;
- main-d'œuvre : heures des interventions (périodes de plus de 24 h écartées)
  × intervenants × coût horaire du jour.

Une intervention saisie à la date seule, sans heures, rend la main-d'œuvre
(et la mécanisation à l'heure) incomplète ; une culture sans récolte
enregistrée, le produit. La jachère n'attend ni récolte ni prix.

Limite : la comparaison avec le **prévu** de la campagne précédente (son
assolement validé avec des itinéraires) n'est pas encore faite ; seule la
comparaison avec le réalisé l'est.

