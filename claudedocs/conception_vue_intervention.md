# Conception : refonte de la fiche d'une intervention

*Conception du 2026-11-18, d'après `besoins_vue_intervention.md` (décisions
Q1 à Q4). Aucun code n'est écrit à ce stade.*

## 1. Vue d'ensemble

```
API                                                    Navigateur (InterventionPage)
 GET /interventions/:id ── targets[].workedAreaM2 (corrigé, §2) ─► ParcelsPanel (ha, %, total)
                       ── weather, compliance, ift ──────────────► WeatherPanel + SprayingConditions
                                                                   InputsPanel (feu de dose)
                                                                   ComplianceSection, IftSection (feux)
 GET /interventions/:id/track-sessions ─────────────────────────► MeansPanel (attelages + parcours)
                                                                   bouton « Revoir en 3D »
 GET|PUT /settings/spraying (nouveau) ──────────────────────────► seuils de la ferme
                                                                   Préférences de la ferme

packages/domain : sprayingConditions(weather, seuils) → feux (pur, testé)
apps/web/src/components/TrafficLight.tsx : feu unique (couleur, icône, mot)
Plan3DPage : lit equipment, t, replay dans l'adresse (§6)
```

## 2. Correctif préalable : surface travaillée

- **Constat** :
  - la lecture ne renvoie `workedAreaM2` que s'il a été enregistré dans les
    `attrs` de la cible ;
  - une modification envoyée sans ce champ (cas de la correction du 18/11,
    lot R0 du rejeu) l'efface, alors que la zone travaillée (`working_zone`)
    reste ;
  - sur le cas d'essai, les 6 cibles n'ont plus de surface travaillée.
- **Correctif** (`apps/api/src/repos/interventions.ts`) :
  - **à l'écriture** : si une cible a une `workingZone` sans `workedAreaM2`,
    on calcule la surface (`ST_Area(working_zone::geography)`) et on
    l'enregistre ;
  - **à la lecture** : `workedAreaM2 = attrs.workedAreaM2 ??
    round(ST_Area(working_zone::geography))` quand une zone existe ;
  - même règle dans les calculs de quantités (lignes 587 et 662) : la surface
    traitée reste juste.
- **Test d'intégration** : modifier une intervention sans `workedAreaM2` mais
  avec sa zone ; la surface travaillée est toujours lue.

## 3. Composant de feu (`TrafficLight`)

```ts
type Light = "ok" | "info" | "warning" | "danger" | "unknown";
<TrafficLight level="warning" label="À vérifier" detail="Hygrométrie 56 %" size="sm" />
```

- **Apparence** : pastille de 10 px dans la couleur Lyvre, icône Lucide et
  mot. Couleurs : `ok` lichen (CircleCheck), `info` ardoise (Info), `warning`
  paille (CircleAlert), `danger` brique (OctagonX), `unknown` gris
  (CircleDashed).
- **Variantes** : `inline` (pastille et mot, pour les lignes de tableau) et
  `badge` (pastille, mot et détail, pour les têtes de pavé).
- **Accessibilité** : `role="img"` et `aria-label="{label} : {detail}"` ;
  l'icône remplace la couleur pour qui ne la distingue pas.
- **Reprise de l'existant** : `LEVELS` (`CompliancePanel.tsx`) devient la
  source unique des couleurs, icônes et libellés, avec un niveau `unknown`
  en plus. Les feux du formulaire de saisie prennent le même composant.

## 4. Conditions de pulvérisation

### 4.1 Domaine (`packages/domain/src/spraying-conditions.ts`)

```ts
export interface SprayingThresholds {
  windKmh: { green: number; red: number };        // 15, 19 (19 = 3 Beaufort, réglementaire)
  temperatureC: { greenMin: number; greenMax: number; redMin: number; redMax: number }; // 8, 25, 5, 28
  humidityPct: { green: number; red: number };    // 60, 40
  rainMm: { green: number; red: number };         // 0, 0.5
}
export const DEFAULT_SPRAYING_THRESHOLDS: SprayingThresholds;
export const REGULATORY_WIND_KMH = 19;

export function sprayingConditions(weather: InterventionWeather | null, t: SprayingThresholds): {
  level: Light;                                   // le plus défavorable des critères connus
  criteria: { code: "wind" | "temperature" | "humidity" | "rain"; level: Light; value: number | null; message: string }[];
}
```

**Sources de chaque critère :**
- **Vent** : maximum des rafales horaires (`windMaxKmh`), sinon de la
  moyenne horaire. Au-delà de 19 km/h, le message cite l'arrêté du
  4 mai 2017.
- **Température** : maximum et minimum horaires, sinon la moyenne.
- **Hygrométrie** : la moyenne (les heures ne la donnent pas).
- **Pluie** : cumul des précipitations horaires sur la période.

**Règles :**
- **Valeur absente** : `unknown`. Le feu global ignore les `unknown`, mais il
  vaut `unknown` si tous les critères le sont.
- **Seuils de la ferme** : ils s'appliquent, mais le seuil réglementaire du
  vent est un plafond : `red` ne peut pas dépasser 19.

### 4.2 Seuils par ferme (Q1)

- **Base** : migration 0060, `farm_settings.spraying jsonb`, nul par défaut,
  ce qui revient aux valeurs par défaut.
- **Contrat** : `farmSpraying` (zod), soit les `SprayingThresholds` validés
  (vert ≤ rouge, vent rouge ≤ 19, bornes plausibles).
- **Routes** :
  - `GET /settings/spraying` : `{ thresholds, isDefault }` ;
  - `PUT /settings/spraying` : réservé au responsable ;
  - `DELETE /settings/spraying` : retour aux valeurs par défaut.
- **Écran** : « Ma ferme », onglet Préférences (`SettingsTabs.tsx`), bloc
  « Conditions de pulvérisation ». Une ligne par critère, avec deux champs
  numériques (vert jusqu'à, rouge au-delà de) et une échelle colorée
  d'aperçu. Bouton « Revenir aux valeurs par défaut ».
- **Lecture sur la fiche** : `useQuery(["settings-spraying", farmId])`, mise
  en cache 10 min ; seulement pour une pulvérisation.

### 4.3 Écran (pavé Météo)

- **Bandeau en tête du pavé** :
  - titre « Conditions de pulvérisation » et `TrafficLight` global (badge) ;
  - grille 2 × 2 des quatre critères, chacun avec son feu, sa valeur et son
    seuil en petit (« vert ≤ 15, interdit > 19 km/h ») ;
  - fond teinté à 6 % de la couleur du feu global et bordure gauche de 3 px.
    C'est le seul pavé teinté de la page.
- **Dessous** : le `WeatherSummary` actuel, sans changement.
- **Pulvérisation** : procédure de forme `treatment` (`getProcedure(code).shape`).

## 5. Pavés de la colonne gauche

| Ordre | Pavé | Composant | Changements |
|---|---|---|---|
| 1 | Météo | `WeatherPanel` (nouveau, extrait) | conditions de pulvérisation (§4) ; sans météo, « Pas de données météo » et des feux gris |
| 2 | Parcelles | `ParcelsPanel` (extrait) | colonnes : parcelle, activité et certifications, travaillé, surface, part (barre fine `Progress`, 4 px) ; ligne de total ; titre « Parcelles · 9,02 ha travaillés » |
| 3 | Moyens | `MeansPanel` (fusion) | attelages ou périodes, puis matériels, intervenants, motifs, stade, notes ; puis « Parcours GPS rattachés (n) » si n > 0 (le pavé `LinkedTrackSessions` devient une sous-partie) |
| 4 | Intrants et sorties | `InputsPanel` (extrait) | feu de dose par intrant phyto (§5.1) |
| 5 | Entretien, irrigation | inchangés | — |

### 5.1 Feu de dose (pulvérisation)

Pour l'article, on lit la ligne `compliance.checks` correspondante :

| Situation | Feu | Texte |
|---|---|---|
| pas de ligne de contrôle | `unknown` | « Non contrôlé » |
| `usageId` nul et plusieurs usages possibles (Q2) | `warning` | « À vérifier : cible à préciser », lien « Préciser la cible » vers `edit` |
| indicateur `dose` | son niveau | message de l'indicateur (« Dose 1,5 L/ha, maximum 3 L/ha ») |

- Le feu se place à droite du nom du produit, et le message apparaît au survol
  ou au toucher.
- **Cas d'essai** : orange (usage non choisi, quatre usages possibles).

## 6. « Revoir en 3D »

- **Fiche** :
  - le bouton se place dans le groupe d'actions, avant « Modifier » (variante
    `default`, icône `Box`) ;
  - il s'affiche quand la requête des parcours rattachés renvoie au moins un
    parcours (Q4 : le premier, trié par début) ;
  - lien : `3d-plan?at={jour}&equipment={equipmentId}&t={début ISO}&replay=1`.
- **`Plan3DPage`** :
  - au montage, il lit `equipment`, `t` et `replay` (`useSearchParams`) ;
  - avec `replay=1` et un `equipment`, il choisit le matériel, lance
    `loadTrack.mutate()` une fois la scène prête, puis appelle `seek(t)` ;
  - les paramètres sont retirés de l'adresse ensuite (`replace`), pour qu'un
    rechargement ne relance pas le rejeu.
- **Test** : `Plan3DPage` lit les paramètres et appelle le chargement (scène
  simulée, comme les tests 3D existants).

## 7. Colonne droite

- **Carte** : inchangée.
- **Contrôle réglementaire** :
  - `TrafficLight` badge en tête, à la place du `Badge` ;
  - liste des indicateurs par produit, chacun avec son feu `inline` et son
    message. Le contenu existe déjà dans `CompliancePanel` ; il reprend le
    composant de feu.
- **Nitrates** : inchangé.
- **IFT** (Q3) :
  - **total** : `TrafficLight` badge à côté du nombre ;
  - **feu global** : `ok` si toutes les lignes sont ≤ 1, `warning` si la plus
    haute est entre 1 et 1,2, `danger` au-delà, `unknown` si non calculé ou
    non calculable ;
  - **lignes** : feu `inline` par ligne, avec la même règle ;
  - **règle** : pure, dans `RegulatorySections.tsx` (`iftLevel`), testée.
- **Historique** :
  - `Paper` avec un en-tête bouton (`UnstyledButton`, `aria-expanded`,
    chevron) : « Historique · 50 modifications » ;
  - `Collapse` fermé par défaut ;
  - une fois ouvert, 10 entrées puis « Afficher tout » ; aucun calcul tant
    qu'il est fermé (rendu paresseux).

## 8. Disposition et responsive

- **Colonnes** : `Grid` 7/5 au-delà de `md`. En dessous, une colonne, avec la
  carte remontée sous les parcelles (`order` Mantine sur les `Grid.Col`, ou
  deux rendus) ; l'ordre est décrit dans le document de besoins (FR-IV-1).
- **En-tête** : sur mobile, les actions passent sous le titre, et « Revoir en
  3D » devient une icône avec une infobulle.
- **Typographie et espacements** : ceux de Lyvre (`Title order={4}`,
  `lv-num`), sans nouvelle police. Seule audace : le bandeau des conditions.

## 9. Tests

| Partie | Tests |
|---|---|
| domaine | `sprayingConditions` : chaque seuil (vert, orange, rouge), valeurs absentes, plafond réglementaire du vent, cas d'essai (global orange) |
| API | `GET`, `PUT` et `DELETE /settings/spraying` (droits, validation) ; surface travaillée relue depuis la zone |
| web | ordre des pavés ; bandeau seulement pour une pulvérisation ; colonnes ha et % avec le total ; feu de dose orange quand la cible manque ; feux IFT ; historique replié puis déplié ; lien « Revoir en 3D » et ses paramètres ; `Plan3DPage` lit les paramètres |
| visuel | cas d'essai sous Chromium, en largeur de bureau et de mobile |

## 10. Lots

1. **V0** : correctif de la surface travaillée (§2).
2. **V1** : `TrafficLight` et règles (conditions, IFT, dose), sans l'écran.
3. **V2** : seuils par ferme (migration, routes, préférences).
4. **V3** : réorganisation de la fiche (ordre, parcelles, moyens, intrants,
   historique, feux).
5. **V4** : « Revoir en 3D » et paramètres du plan 3D.

## 11. Réalisation du 2026-11-18 (V0 à V4)

Branche `feat/vue-intervention`, partie de `feat/rejeu-3d` (PR #71), car V4
touche au plan 3D. Vérifié sur le cas d'essai, sous Chromium.

- **V0** : surface travaillée relue depuis la zone (`zone_area_m2`), et
  calculée à l'écriture quand la zone arrive seule. Test d'intégration : une
  modification sans surface, puis une ligne ancienne sans `attrs`. Le cas
  d'essai affiche de nouveau 9,02 ha travaillés sur 25,26 ha (36 %).
- **V1** :
  - `packages/domain/src/spraying-conditions.ts` : `sprayingConditions`,
    `effectiveThresholds`, `iftLight`, et leurs 6 tests ;
  - `apps/web/src/components/TrafficLight.tsx` : `LIGHTS` est la source
    unique ; `LEVELS` du contrôle réglementaire n'en est plus qu'un alias.
- **V2** :
  - migration 0060 (`farm_settings.spraying`) ;
  - `GET`, `PUT` et `DELETE /settings/spraying`, et le contrat
    `farmSpraying` : vert ≤ rouge, vent ≤ 19 km/h ;
  - bloc « Pulvérisation » des Préférences de la ferme
    (`SprayingSettingsPanel`), avec un retour aux valeurs par défaut.
- **V3** :
  - fiche réorganisée : météo et conditions, parcelles (travaillé, surface,
    part avec barre et total), moyens et attelages avec les parcours GPS en
    liste compacte, intrants avec feu de dose, puis le contrôle et l'IFT
    (feux) ;
  - historique replié (10 entrées, puis « Afficher les N modifications ») ;
  - en largeur mobile, la carte passe sous les parcelles (`useMediaQuery`,
    une seule carte montée).
- **V4** : « Revoir en 3D » prend le premier parcours rattaché. `Plan3DPage`
  lit `equipment`, `t` et `replay=1`, charge le rejeu, se place sur `t`,
  puis retire ces paramètres de l'adresse.
- **Tests web** : la fiche a un test de bout en bout (conditions, ordre des
  pavés, 40 %, feu de dose, feux IFT, lien 3D) ; les tests existants suivent
  l'historique replié.
- **Reste ouvert** : aucun test automatique du lien côté plan 3D (Cesium ne
  tourne pas dans jsdom) : il est vérifié à la main.

### Retours du 2026-11-18 (après essai) : pavé Météo simplifié

- **Une seule règle de pulvérisation** dans toute l'application (décision du
  18/11 : un seul jeu de seuils, réglable, aux valeurs d'Ekylibre par
  défaut) :
  - `sprayingHour` (domain) remplace `sprayCondition` (`@fourmy/weather`) et
    le calcul par critère de la fiche ;
  - le serveur (`GET /weather/spraying`) applique les seuils de la ferme ;
    la frise du tableau de bord, de la fiche parcelle et de la saisie en
    tient donc compte.
- **Modèle des seuils** : bornes basses et hautes pour l'hygrométrie
  (favorable de 75 à 95 %) et la température (5 à 25 °C), pluie par heure
  (0,1 et 0,3 mm/h), vent favorable jusqu'à 7,2 km/h et défavorable dès
  18 km/h, sans jamais dépasser 19 km/h. Le panneau des Préférences suit,
  avec « Revenir aux valeurs d'Ekylibre ».
- **Pavé Météo de la fiche** :
  - une ligne : temps, température, hygrométrie, vent (rafales seulement si
    elles diffèrent), pluie et source ;
  - pour une pulvérisation, la frise horaire du jour (même composant que la
    saisie) : heures de l'intervention soulignées, les autres estompées, et
    bilan « Pendant l'intervention (16:24–17:46) : à surveiller — vent
    11 km/h, hygrométrie 57 % » (`sprayingPeriod`) ;
  - le bandeau teinté et le résumé heure par heure (`WeatherSummary`) sont
    retirés.
