# Besoins : unités des semences reprises et plants à la pièce

*Issue [#130](https://github.com/ekylibre/fourmy/issues/130), point 130 de `claudedocs/points_ouverts.md` (thème 18). Suite de `claudedocs/besoins_semences.md` (FR-SE-23, question ouverte 2, décision S8). Expression des besoins du 28/11/2026, avant conception.*

## 1. Contexte

- **Unités reprises.** Les semences reprises d'Ekylibre ou d'un import gardent leur unité écrite librement : « Sac de 50 000 grains », « Mille graines », « Kg »… Fourmy les reconnaît à la volée (FR-SE-23) et sait donc les convertir, mais il les affiche telles qu'elles ont été écrites.
- **Ce qu'en montre la base de développement** (5 fermes, 28/11) :

  | Unité de l'article | Articles | Fermes |
  |---|---|---|
  | `kilogram` (déjà canonique) | 41 | 1 |
  | « Sac de 50 000 grains », avec ses variantes de casse et d'espaces | 26 | 2 |
  | « Mille grains » ou « Mille graines » | 20 | 2 |
  | « Kg » ou « Kilogramme » | 10 | 4 |
  | « graines », « unity » | 3 | 3 |

  Les mouvements de stock de ces semences portent la même unité écrite que leur article (126 mouvements en « Sac de 50 000 grains »…).
- **Plants.** Un lot de plants achetés (arbres, PPAM, mottes de maraîchage) se compte à la pièce. Aujourd'hui, « Plant » est refusé (« Unité Plant non reconnue pour une semence ») et « unité » est pris pour un nombre de grains : l'écran affiche le lot en « grains ».

## 2. Décisions de l'utilisateur (28/11/2026)

| # | Question | Décision |
|---|---|---|
| U1 | Réécrire les unités reprises en unité canonique ? | **Oui, en bloc**, sur confirmation du responsable, depuis la page Semences, avec la liste avant et après. |
| U2 | Comment compter les plants ? | **À la pièce**, une unité de comptage à part : pas de PMG ni de grains/m². Cela lève en partie la décision S8 (« plants : plus tard ») pour le stock et la dose. |

## 3. Exigences fonctionnelles

### Réécriture des unités reprises (U1)

- **FR-SU-1.** La page *Stocks → Semences* signale les semences dont l'unité est reconnue mais pas canonique : « 12 semences ont une unité reprise d'un autre logiciel ». Le signalement n'apparaît que s'il y en a.
- **FR-SU-2.** Pour chacune, Fourmy propose l'unité canonique correspondante :
  - « Sac de 50 000 grains », quelle que soit sa casse ou ses espaces → dose de 50 000 grains (`dose`, avec 50 000 grains par dose) ;
  - « Mille grains », « Mille graines » → milliers de grains ;
  - « Kg », « Kilogramme » → kg ;
  - « graines », « unity », « unité » → grains.
- **FR-SU-3.** Avant de réécrire, le responsable voit la liste : la semence, l'unité actuelle, l'unité proposée et le stock du jour dans l'une et l'autre, qui doit être le même. Il peut retirer une semence de la liste, puis confirmer.
- **FR-SU-4.** La réécriture est réservée au responsable de la ferme (*owner*).
- **FR-SU-5.** Une semence dont l'unité n'est pas reconnue n'est jamais réécrite. Elle reste signalée comme aujourd'hui.
- **FR-SU-6.** Une dose dont le nombre de grains est déjà enregistré sur la fiche (`grains_per_dose`) garde ce nombre. S'il diffère de celui écrit dans l'unité (« Sac de 50 000 grains » avec une fiche à 80 000), la semence est montrée en conflit et n'est pas réécrite d'office.
- **FR-SU-7.** La réécriture est tracée (qui, quand, avant et après) dans le journal habituel de l'article.

### Plants à la pièce (U2)

- **FR-SU-8.** « plant », « plants », « pièce », « pièces », « motte », « mottes » sont reconnus comme une unité de comptage **plant**, distincte des grains.
- **FR-SU-9.** Une semence en plants se crée (`POST /seeds`), se reçoit en stock et se consomme à la pièce. L'écran affiche « plants », jamais « grains ».
- **FR-SU-10.** Dans une intervention de plantation, la quantité se saisit au total ou en **plants/ha**, convertie en nombre de plants avec la surface, comme une dose à l'hectare.
- **FR-SU-11.** Une semence en plants n'a ni PMG ni densité en grains/m². Ces champs, et leurs repères (Arvalis, Terres Inovia), ne s'affichent pas pour elle.
- **FR-SU-12.** Il n'y a pas de conversion entre plants et kg, ni entre plants et grains. Une saisie dans une autre dimension est refusée avec un message clair.
- **FR-SU-13.** La réécriture en bloc (FR-SU-2) propose aussi « plant » pour les articles reconnus comme tels.

## 4. Exigences non fonctionnelles

- **NF-SU-1. Le passé ne change pas.** Après la réécriture, le stock de chaque semence, à toute date passée, est le même qu'avant, dans sa nouvelle unité. Il en va de même pour les quantités du registre, des interventions passées et de l'utilisation par campagne (FR-SE export CSV).
- **NF-SU-2. Tout ou rien** pour chaque semence : son article et ses mouvements sont réécrits ensemble, ou pas du tout.
- **NF-SU-3. Pas de reprise qui défait le travail.** Une nouvelle reprise d'Ekylibre ou un nouvel import ne remet pas l'ancienne unité écrite sur une semence réécrite (FR-SE-29 reste vrai pour les nouvelles semences).
- **NF-SU-4.** L'application mobile et la synchronisation lisent les unités canoniques et l'unité plant sans erreur. Une version de l'application qui ne connaît pas « plant » affiche l'unité telle quelle.

## 5. Récits et critères d'acceptation

- **US-1, réécriture.** En tant que responsable, je vois sur la page Semences que 12 semences ont une unité reprise. J'ouvre la liste, je vérifie que les stocks avant et après sont égaux, je retire une semence et je confirme. Les 11 autres s'affichent désormais en « dose de 50 000 grains », « milliers de grains » ou « kg ».
  - *Critère* : stock du jour et stock au 01/01 identiques avant et après pour chaque semence réécrite ; registre et utilisation par campagne identiques ; l'encadré disparaît quand il ne reste rien à réécrire.
- **US-2, conflit.** Une semence « Sac de 50 000 grains » dont la fiche dit 80 000 grains par dose apparaît en conflit, sans réécriture proposée d'office.
- **US-3, plants.** En tant que maraîcher ou arboriculteur, je crée une semence « Plants de lavande » en plants, j'en reçois 2 000, et je plante 1,5 ha à 8 000 plants/ha. Le stock baisse de 12 000 plants, et nulle part on ne me parle de grains ou de PMG.
  - *Critère* : `POST /seeds` avec `unit: "Plant"` réussit ; la fiche et le stock affichent « plants » ; une conversion vers des kg est refusée.

## 6. Questions ouvertes

1. **Unité canonique d'une dose.** Faut-il garder le nombre de grains dans le libellé affiché (« dose de 50 000 grains ») ou seulement « dose », le nombre étant sur la fiche ? Il est proposé de le garder dans le libellé, plus lisible pour un ancien utilisateur d'Ekylibre.
2. **Plants dans le registre et le contrôle HVE et AB.** Les plants AB (semences et plants biologiques, règle de l'annexe II) sont-ils déjà couverts par le contrôle des semences ? C'est à vérifier à la conception.
3. **Plants ailleurs que dans les semences.** Les jeunes plants de vigne et les arbres d'un verger restent-ils hors de cette page (S8), ou y entrent-ils comme toute semence en plants ? Il est proposé de les y faire entrer : c'est la même unité, et rien de spécifique à la vigne n'est ajouté.

**Suite** : `/sc:design` pour la conception, puis `/sc:workflow` pour le plan des lots.
