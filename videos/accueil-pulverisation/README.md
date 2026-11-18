# Boucle du haut de page : la pulvérisation du 5 octobre

Boucle muette de 19 s pour le haut de fourmy.org. Elle montre le rejeu 3D de l'Arion 430
et de l'Amazone UF1201 (rampe de 18 m) sur la ferme de Pierre, le 05/10/2026 de 16 h 46 à
16 h 50, accéléré dix fois. La caméra suit l'attelage par l'arrière. On voit la bande
traitée se colorer derrière la rampe, la rampe se relever au bout du champ, puis la passe
suivante. La dernière seconde se fond dans la première, pour que la boucle ne saute pas.

## Prérequis

- La pile de développement tourne : la base sur le port 5434, l'API, le worker et Vite sur
  le port 5173. Le cache IGN de la ferme est préchargé.
- L'intervention du 05/10 est une pulvérisation (Barbarian ST à 1,5 l/ha, Amazone UF1201).
- L'Amazone UF1201 porte `external_ids.traccarTool = "Arion UF1201"`. Sans ce lien, les
  passes du début d'après-midi s'affichent comme un travail du sol, en orange.

## Étapes

```sh
node capture/repere.mjs                       # repérage : quelques images, pour choisir le moment
FROM=16:46:20 SECONDS=200 DURATION=20 FPS=30 RANGE=56 PITCH=-0.40 DH=0.45 node capture/film.mjs
capture/encode.sh                             # WebM, MP4 et affiche, écrits dans apps/site
node capture/fiche.mjs                        # incrustation : le pavé IFT de la fiche
```

`film.mjs` pilote l'horloge du rejeu image par image et attend que le relief et les photos
soient chargés avant chaque image. Il masque les rangs de végétation, la teinte des
parcelles et les traits de la trace. La bande traitée n'apparaît qu'à partir de 16 h 24,
pour ne montrer que cette intervention. Les images brutes, dans `assets/`, ne sont pas
versionnées.
