# Boucles du rejeu 3D pour fourmy.org

Boucles muettes de 19 s, en 1600 × 900, tirées du rejeu 3D de la ferme de Pierre et
accélérées dix fois. La caméra suit l'attelage par l'arrière. La dernière seconde se fond
dans la première, pour que la boucle ne saute pas. Chaque boucle est décrite dans
`capture/videos.mjs` et choisie par la variable `VIDEO`.

| `VIDEO`         | Intervention                                                   | Fenêtre filmée     | Sortie                  |
| --------------- | -------------------------------------------------------------- | ------------------ | ----------------------- |
| `pulverisation` | Pulvérisation du 05/10/2026, Arion 430 + Amazone UF1201 (18 m) | 16 h 46 à 16 h 50  | `accueil-pulverisation` |
| `broyage`       | Broyage du 28/10/2026, Arion 430 + Maschio Tigre 300 (2,8 m)   | 14 h 07 à 14 h 10  | `accueil-broyage`       |

Pour le broyage, 14 h 07 est l'entrée du tracteur dans la prairie Monassut-Audiracq :
avant, il travaille sur une surface qui n'est pas enregistrée comme parcelle.

Deux incrustations sont dessinées dans la page au-dessus de la scène, donc dans chaque image :
- en haut à droite, la fiche de l'intervention et l'heure du rejeu. Pour une pulvérisation :
  la dose (le nom commercial est remplacé par « Produit 1 », variable `PRODUIT`), l'IFT et la
  météo, chacun avec son voyant ; le voyant météo applique les seuils de pulvérisation par
  défaut de la ferme. Pour une autre intervention : la météo, la durée de travail et le
  contrôle réglementaire ;
- en bas à gauche, la surface travaillée qui avance avec le rejeu et sa barre de
  progression, puis la carte 2D de la parcelle où travaille le tracteur, nord en haut : les
  passes en bandes de la largeur de l'outil, les trajets outil fermé en trait fin, le
  tracteur ; enfin le matériel.

La surface travaillée est la surface réellement couverte par l'outil dans les parcelles de
l'intervention, calculée sur une grille de 0,5 à 1 m : les recouvrements ne comptent qu'une
fois. Elle finit à 9,03 ha pour la pulvérisation (9,02 sur la fiche) et à 0,42 ha pour le
broyage (0,43 sur la fiche).

Toutes les valeurs viennent de l'application (`capture/donnees.mjs`).

## Prérequis

- La pile de développement tourne : la base sur le port 5434, l'API, le worker et Vite sur
  le port 5173. Le cache IGN de la ferme est préchargé.
- L'Amazone UF1201 porte `external_ids.traccarTool = "Arion UF1201"`. Sans ce lien, les
  passes de la pulvérisation du début d'après-midi s'affichent comme un travail du sol, en orange.

## Étapes

```sh
node capture/donnees.mjs                      # données de la pulvérisation → assets/data/intervention.json
INTERVENTION=e92d6478-7d7a-46a9-bba6-66ba16d509b6 DAY=2026-10-28 DATA=broyage node capture/donnees.mjs
node capture/repere.mjs                       # repérage : quelques images, pour choisir le moment
VIDEO=broyage node capture/film.mjs           # 600 images dans assets/raw/accueil-broyage
capture/encode.sh accueil-broyage accueil-broyage   # WebM, MP4 et affiche, écrits dans apps/site
node capture/film.mjs && capture/encode.sh    # la pulvérisation (réglages par défaut)
```

`film.mjs` pilote l'horloge du rejeu image par image et attend que le relief et les photos
soient chargés avant chaque image. `INCRUST=0` tourne sans les incrustations. Il masque les
rangs de végétation, la teinte des parcelles et les traits de la trace. La bande travaillée
n'apparaît qu'à partir du début de l'intervention, pour ne montrer qu'elle. Les données et
les images brutes, dans `assets/`, ne sont pas versionnées.
