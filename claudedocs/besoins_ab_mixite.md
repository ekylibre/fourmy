# Besoins : mixité AB (R7) et cultures génériques

*Issue [#166](https://github.com/ekylibre/fourmy/issues/166) (bug). Contrôle AB, règle R7 (règlement (UE) 2018/848, art. 9.7 et 9.8). Suite de `docs/controles-hve-ab.md`. Expression des besoins du 28/11/2026.*

## 1. Constat

Une exploitation cultive des PPAM pérennes en conversion et une prairie permanente non certifiée. Le contrôle 2026 signale à tort : « Plantes médicinales pérennes cultivé(e) en AB et hors AB : variétés à renseigner ».

**Cause.** La mixité compare l'« espèce » de chaque production. C'est la culture de l'activité, sinon l'espèce Lexicon, sinon la culture de la production (`coalesce(a.cultivation, lp.specie, p.cultivation)`). Les deux activités ont la culture générique `plant`, et R7 les prend pour une même espèce.

**Ampleur dans la base de développement (5 fermes, 28/11) :**

| Culture de l'activité | Rang | Activités |
|---|---|---|
| `plant` (absente de la taxonomie) | générique | 7 (prairies, jachères, bandes enherbées) |
| `fabaceae` | famille | 1 (mélange graminées et légumineuses) |
| `equipment` | hors taxonomie | 2 (activités sans culture) |
| aucune | — | 6 |
| `vitis`, `avena`, `sorghum`, `x_triticosecale` | genre | 10 |
| espèces et sous-espèces (`zea_mays`, `avena_sativa`…) | espèce | le reste |

L'avoine est présente à deux niveaux : `avena` (genre) et `avena_sativa` (espèce).

## 2. Décisions de l'utilisateur (28/11/2026)

| # | Question | Décision |
|---|---|---|
| M1 | Que faire d'une culture générique (`plant`, une famille, une valeur hors taxonomie) ? | **L'ignorer pour la mixité**, avec une note « espèce à préciser sur l'activité pour contrôler la mixité », qui ne pénalise pas le verdict. |
| M2 | Un genre (Avoine, `avena`) et une espèce de ce genre (Avoine noire, `avena_sativa`), l'un en AB et l'autre non, la même campagne ? | **Mixité à vérifier** : le genre englobe l'espèce, et le contrôle demande les variétés comme aujourd'hui. |

## 3. Exigences fonctionnelles

- **FR-MX-1. Culture précise.** Une culture compte pour la mixité si elle est connue de la taxonomie au rang du genre ou plus fin (genre, espèce, sous-espèce, variété). Toute autre culture est générique : `plant`, une famille ou un rang supérieur, une valeur absente de la taxonomie (`equipment`), ou aucune culture.
- **FR-MX-2. Cultures génériques ignorées.** Une production dont la culture est générique n'est comparée à aucune autre pour R7, qu'elle soit en AB ou hors AB. Le cas de l'issue (PPAM en `plant` en AB, prairie en `plant` hors AB) ne signale plus de mixité.
- **FR-MX-3. Note « à préciser ».** Une production **en AB** dont la culture est générique fait apparaître une note par activité, par exemple : « Plantes médicinales pérennes : espèce à préciser sur l'activité pour contrôler la mixité (R7). »
  - La note renvoie à l'activité.
  - Elle ne change pas le verdict du contrôle et ne compte pas comme une donnée manquante bloquante.
  - Il n'y a pas de note pour une production hors AB, car seule une production AB peut être en mixité.
- **FR-MX-4. Genre et espèce.** Deux cultures précises sont « la même espèce » pour R7 si l'une est l'autre ou l'un de ses ancêtres dans la taxonomie, au rang du genre au plus haut.
  - `avena` (AB) et `avena_sativa` (hors AB) : mixité à vérifier.
  - `avena_sativa` et `avena_strigosa` : deux espèces différentes, pas de mixité.
  - `brassica_napus_napus` (sous-espèce) et `brassica_napus` (espèce) : la même.
- **FR-MX-5. Variétés inchangées.** Une fois deux productions jugées de même espèce, la suite de R7 ne change pas :
  - une variété inconnue : variétés à renseigner ;
  - une même variété : non conforme ;
  - des variétés différentes : conforme, avec la séparation et le registre à tenir.
- **FR-MX-6. Libellé.** Le message nomme les deux cultures quand elles diffèrent, par exemple « Avoine (AB) et Avoine noire d'hiver (hors AB) ». Aujourd'hui, seul le libellé de la production AB apparaît.
- **FR-MX-7. Assolement prévisionnel.** Les mêmes règles s'appliquent au contrôle de mixité de l'assolement (`crop-plan/checks/certification.ts`), qui prévient aujourd'hui sur la même espèce prévue en AB et hors AB :
  - une culture générique est ignorée, sans note, car l'écran de l'assolement est déjà chargé ;
  - un genre englobe ses espèces.

## 4. Exigences non fonctionnelles

- **NF-MX-1.** Une seule définition de « même espèce » sert au contrôle AB et à l'assolement. Le domaine la porte, avec ses tests.
- **NF-MX-2.** Les contrôles déjà justes ne changent pas : deux productions de même espèce précise, ou deux espèces différentes, donnent le même résultat qu'avant.
- **NF-MX-3.** Le calcul reste sans requête par production : la taxonomie utile est lue une fois par contrôle.

## 5. Récits et critères d'acceptation

- **US-1 (l'issue).** Des PPAM en `plant` en conversion AB et une prairie permanente en `plant` hors AB, la même campagne. Le contrôle 2026 ne signale plus de mixité ; il affiche la note « Plantes médicinales pérennes : espèce à préciser… », et le verdict est le même que sans les deux productions.
- **US-2.** De l'avoine en AB (`avena`, variété « Une de Mai ») et de l'avoine noire hors AB (`avena_sativa`, variété « Une de Mai »). Le contrôle signale la même variété en AB et hors AB : non conforme (n° 31).
- **US-3.** Le même cas avec des variétés différentes : conforme, avec la séparation et le registre à tenir. Avec une variété manquante : variétés à renseigner.
- **US-4.** Du maïs grain (`zea_mays`) en AB et du maïs fourrage (`zea_mays`) hors AB : comportement inchangé.
- **US-5.** Dans l'assolement prévisionnel, les mêmes PPAM et la même prairie ne déclenchent pas d'alerte de mixité.

## 6. Questions ouvertes (pour la conception)

1. **Niveau de la note FR-MX-3.** Le contrôle a les niveaux `ok`, `warning`, `danger`, `missing` et `na`. Il faut vérifier qu'un niveau existe sans effet sur le verdict (`na` ou un `ok` informatif), sinon en prévoir un.
2. **Espèce Lexicon.** L'option « espèce Lexicon d'abord », pour une activité à culture générique, n'a pas été retenue. Elle reste possible plus tard, si la note FR-MX-3 revient souvent.

**Suite** : `/sc:design` pour la conception (courte, c'est un correctif), puis `/sc:implement`.
