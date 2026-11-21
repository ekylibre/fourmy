# Semences : espèces, PMG, doses de semis et utilisation

Lots SE1 à SE8, réalisés du 20 au 21/11/2026 (PR #121 à #127, puis la PR de SE8).

- Besoins : [`claudedocs/besoins_semences.md`](../claudedocs/besoins_semences.md).
- Conception : [`claudedocs/conception_semences.md`](../claudedocs/conception_semences.md).
- Plan et réalisation lot par lot : [`claudedocs/workflow_semences.md`](../claudedocs/workflow_semences.md).

Les semences restent des articles du stock (`kind = 'seed'`). Le module leur ajoute :
- une fiche : espèce, variété, code GNIS, conditionnement, PMG ;
- le PMG de chaque lot ;
- les espèces d'un mélange ;
- les conversions de dose au semis ;
- l'utilisation par campagne.

## Le PMG, et pourquoi il compte

Le **PMG** (poids de mille grains, en grammes) permet de passer d'une densité en grains/m² à une dose en kg/ha, ou à un nombre de doses.

Exemple d'un maïs :
- 9 grains/m² font 90 000 grains/ha ;
- avec des doses de 50 000 grains, c'est 1,8 dose/ha ;
- avec un PMG de 300 g, c'est 27 kg/ha.

Le PMG retenu pour un semis est, dans l'ordre :
1. celui du **lot** semé (étiquette du sac) ;
2. celui de la **fiche** de la semence ;
3. le **repère** de l'espèce. La quantité est alors dite **estimée**.

Les repères viennent d'Arvalis (céréales, maïs, sorgho) et de Terres Inovia (oléagineux, protéagineux, chanvre). Chaque repère est donné avec sa source. Leur reprise est acceptée depuis le 20/11/2026. Fourmy n'utilise jamais le PMG de 50 g par défaut de Lexicon : il vaut 50 g sur 203 fiches sur 210.

Un PMG saisi à plus de 30 % du repère de l'espèce est signalé, pour vérifier l'étiquette.

## Stocks → Semences

### Onglet Semences

La liste des semences de la ferme indique pour chacune :
- l'espèce ;
- l'unité de stock ;
- le PMG retenu ;
- le statut bio ;
- le stock à la date de la frise ;
- le nombre d'interventions de la campagne.

Elle signale aussi ce qui manque pour convertir les doses : PMG inconnu, unité non reconnue, espèce inconnue, mélange sans espèces.

Filtres :
- texte (nom, variété, code GNIS) ;
- espèce et campagne ;
- « Sans PMG », « Mélanges », « Non bio », « Semées en … ».

Les colonnes se choisissent. Un mélange probable (« + » dans le nom, espèce importée « Mélange ») porte le badge « Mélange ? ».

**Ajouter une semence** (responsable) se fait de deux façons :
- **Catalogue officiel** des variétés (SEMAE, base variétés GNIS, 21 592 variétés via Lexicon). La recherche ignore les accents. L'espèce, la variété et le code GNIS sont remplis. L'unité est proposée : des doses de 50 000 grains pour le maïs, des kg sinon.
- **Saisie libre**, pour une semence de ferme, un mélange ou une espèce absente du catalogue.

**Rattacher au référentiel** (responsable) : Fourmy propose l'espèce, la variété et le code GNIS des semences qui n'en ont pas. Il s'appuie, dans l'ordre :
1. sur le **code GNIS** lu dans un fichier importé, s'il est au catalogue : la proposition est **sûre** ;
2. sur l'**espèce** lue dans le fichier importé ;
3. sur la **référence Lexicon** d'une semence reprise d'Ekylibre (`triticale_seed` → triticale) ;
4. sur le **nom** de la semence.

Le nom d'une semence reprise d'Ekylibre suit souvent le modèle « Semence de maïs - DKC5065 ». Fourmy y lit l'espèce. Il lit aussi la variété, avec son code GNIS si le catalogue la connaît pour cette espèce.

Une proposition approchée (libellé proche, ou fichier et catalogue en désaccord) est décochée d'office ; elle n'est jamais appliquée sans confirmation. Le PMG n'est pas touché par le rattachement.

### Fiche d'une semence

- **Identité** : mélange ou non, catégorie (semence certifiée ou de ferme), espèce, variété, code GNIS.
- **Conditionnement** : unité de stock, grains par dose, poids d'un sac. Changer l'unité de stock ne change jamais les stocks passés. Une semence qui a des mouvements ne change d'unité que vers une unité équivalente, par exemple de « Sac de 50 000 grains » vers une dose de 50 000 grains.
- **PMG** : valeur, origine (étiquette, mesure, repère, fichier importé), date. Le repère de l'espèce s'affiche avec sa source et peut être repris.
- **Espèces du mélange** : une espèce du référentiel ou un libellé libre, avec la variété si elle est connue. Il n'y a pas de proportions, car la dose de chaque espèce se saisit au semis. Les légumineuses sont repérées : « 1 légumineuse sur 4 espèces ».
- **Agriculture biologique** : statut et traitement de la semence, qui servent au contrôle AB.
- **Lots** : stock et PMG de chaque lot.
- **Semis** : interventions de chaque campagne, avec la dose saisie, la densité en grains/m² et la dose en kg/ha.

### Onglet Utilisation

L'onglet donne l'utilisation des semences pour une campagne, **par semence** ou **par espèce**. Le regroupement par espèce compare les variétés d'une même culture. Le réalisé et le prévu sont distingués : les interventions prévues préparent les commandes.

Pour chaque ligne :
- la surface et le nombre d'interventions ;
- la quantité dans l'unité du stock, et en kg quand c'est convertible ;
- la dose en kg/ha et la densité en grains/m². Ce sont des moyennes pondérées par la surface, avec entre parenthèses l'écart entre parcelles ;
- « estimé » quand un PMG repère a servi ;
- « non convertible » pour une dose sans PMG ni unité lisible. Elle est comptée sans bloquer le reste ;
- les activités concernées.

**Exporter en CSV** : une ligne par semence (ou espèce) et par statut, avec le séparateur « ; » et des décimales françaises.

## Au semis (Interventions)

Une semence se saisit dans l'unité du métier. Le stock baisse dans l'unité de l'article, après conversion.

| Unité de saisie | Ce qu'il faut |
|---|---|
| unité de l'article (par ha ou au total) | rien : c'est le calcul d'avant, même pour une unité illisible |
| grains/m² | grains par dose (stock en doses) ou PMG (stock en kg) |
| kg, kg/ha | PMG si le stock est en grains ou en doses |
| milliers de grains, grains | PMG si le stock est en kg |
| doses | grains par dose |

Sous la ligne de l'intrant, Fourmy affiche par exemple « ≈ 9 grains/m² · 1,8 dose/ha · 27 kg/ha (PMG 300 g) ». Quand il manque une donnée, il affiche « PMG inconnu », avec un lien pour compléter la semence. Sans PMG, une conversion impossible est refusée, avec le motif : « PMG inconnu, à compléter dans Stocks → Semences ».

La **conversion est figée** sur l'intrant (PMG, origine, grains par dose). Corriger le PMG ensuite ne change pas les stocks passés.

### Mélanges

Pour un mélange stocké en kg, la dose de chaque espèce se saisit en kg/ha. La dose du mélange en est la somme ; c'est elle qui fait baisser le stock. Les doses du dernier semis du même mélange sont proposées. La densité de chaque espèce en grains/m² s'affiche quand son repère de PMG existe.

Fourmy refuse le semis d'un mélange si :
- la somme diffère de la dose saisie de plus de 0,01 kg/ha ;
- la dose n'est pas en kg/ha ;
- une espèce n'appartient pas au mélange.

## Couverts d'interculture

À la réalisation d'un semis, le couvert semé déjà saisi sur la parcelle est rattaché au semis, si sa date est à 15 jours près de celle du semis. Le couvert en reprend :
- les espèces et leur dose ;
- la date ;
- le libellé.

Sans couvert saisi, rien n'est créé. La section « Couvert d'interculture » du plan de fumure propose alors **« Reprendre le semis du … »** pour les semis réalisés de juin à décembre avant la campagne. La famille du couvert est déduite des espèces, par exemple « Mélange graminées-légumineuses ». Un mélange qui ne rentre dans aucune famille du référentiel (graminée, légumineuse, phacélie et crucifère ensemble) laisse le choix au responsable.

Les espèces semées servent :
- au **couvert à légumineuses** de la rotation AB (contrôle AB et contrôles de l'assolement), même si la famille saisie n'en dit rien ;
- à la **diversité des cultures HVE** : chaque espèce du couvert compte.

## Imports et reprises

- **Geofolia et DAPLOS** : le code GNIS et l'espèce du fichier sont gardés. Les rattachements sûrs, ou tirés tels quels de l'espèce du fichier, sont appliqués à l'import. Les autres attendent une confirmation.
- **Ekylibre** : l'unité d'origine est gardée et reconnue à la volée. Par exemple « Sac de 50 000 grains », « Sac  de 50 000 grains », « Mille graines » et « Kg » sont tous lus. La référence Lexicon et le nom servent au rattachement proposé.
- Commande en ligne de commande, pour rattacher en masse : `pnpm --filter @fourmy/api seeds:attach --farm <id> [--all] [--dry-run]`. `--dry-run` affiche les rattachements sans rien écrire.

## Application mobile

La synchronisation envoie, pour chaque semence, l'espèce, le mélange, les grains par dose et le PMG. Elle n'envoie pas encore les espèces d'un mélange. L'API accepte dès maintenant les unités de semence venues du mobile ; l'adaptation de l'application se fait dans son dépôt.

## Questions ouvertes

Voir `claudedocs/points_ouverts.md`, thème 18 :
- faculté germinative et pertes à la levée ;
- réécriture des unités existantes ;
- prix indicatifs ;
- semences de ferme (triage, CVO) ;
- espèces d'un mélange sur le mobile.
