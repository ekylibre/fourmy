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

