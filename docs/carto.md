# Outils carto communs

Exigence CARTO-1 (`claudedocs/exigences_interventions.md`) : dessin, découpe,
mesure, fusion et déplacement de sommets, communs à tous les modules qui
éditent une carte (saisie des interventions sur carte, parcellaire, traces…).

## Découpage

| Où | Quoi |
|---|---|
| `packages/carto` | Géométrie **pure**, sans carte : surfaces, longueurs et périmètres géodésiques ; `splitArea`, `mergeAreas`, `clipToParcel`, `validateArea`. Réutilisable par le mobile. |
| `apps/web/src/carto/editor.ts` | `CartoEditor` : se branche sur n'importe quelle carte MapLibre, édite une collection de polygones ; outils Modifier, Dessiner, Découper, Fusionner, Distance, Surface ; supprimer, annuler. |
| `apps/web/src/carto/useCartoEditor.ts`, `CartoToolbar.tsx` | État React et barre d'outils (consigne, mesure, erreurs). |
| `apps/web/src/features/interventions/ParcelPicker.tsx` | Premier écran qui réutilise l'éditeur : choix des parcelles d'une intervention et zone partielle (outil `none` hors dessin, la carte reste à l'écran). |
| `/f/:ferme/map/tools` | Atelier d'essai sur les parcelles à la date de la frise (lien « Outils de dessin » de la carte). Rien n'est enregistré. |

## Bibliothèques (validées le 2026-11-08)

- **terra-draw** 1.38 + **terra-draw-maplibre-gl-adapter** 1.5 (MIT) : dessin,
  poignées, déplacement. Essayé sans erreur avec MapLibre 6.16.
- **turf** 7.4 (MIT) : intersection, différence, union, validité.
- **GeographicLib** 2.2 (MIT) : surfaces et distances sur l'ellipsoïde WGS84,
  le même algorithme que PostGIS `ST_Area(geography)`. Mesuré sur les 206
  parcelles des fermes locales : écart < 1 mm² avec la surface enregistrée ;
  turf (sphérique) s'en écarte jusqu'à 230 m² (0,2 %). Le serveur reste la
  référence et recalcule à l'enregistrement.

## Règles

- **Découper** : la ligne commence et finit hors de la surface et la traverse ;
  elle n'est jamais prolongée au-delà de ce qui est tracé (une ligne tracée
  à côté ne coupe rien). Plusieurs traversées donnent plusieurs morceaux.
  Les morceaux partagent exactement leur bord : refusionnés, ils redonnent la
  surface d'origine. Sans sélection, toutes les surfaces traversées sont
  découpées.
- **Fusionner** : des surfaces qui se touchent ou se chevauchent ; des
  surfaces séparées sont refusées.
- **Tout ou rien** : le résultat d'une découpe ou d'une fusion est ajouté et
  vérifié avant de retirer les surfaces d'origine ; un refus n'en perd
  aucune. Coordonnées arrondies à 1e-9° (≈ 0,1 mm) pour terra-draw.
- **Contours invalides** (qui se croisent, plats) refusés au dessin et au
  déplacement d'un sommet (retour à la forme d'avant).
- **Trous** : terra-draw n'édite pas les polygones à trous ; une telle surface
  est signalée comme non modifiable (aucune dans les fermes actuelles).

## Tests

- `packages/carto/test` : surfaces et longueurs comparées à PostGIS, découpes
  (simple, en zigzag, ligne dehors, ligne qui s'arrête dedans, prolongement qui
  retraverse), fusion, zone ramenée à sa parcelle, validité.
- `apps/web/e2e/carto.spec.ts` : découper, fusionner, annuler, dessiner,
  mesurer sur la ferme pilote viticole.
