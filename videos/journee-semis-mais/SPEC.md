# SPEC : « Aujourd'hui, je sème mon maïs » (storyline A, la journée de Pierre)

GOAL:    l'agriculteur qui regarde se dit « je sème, et les papiers se font tout seuls » et va sur fourmy.org.
OUTPUT:  HyperFrames, 1920 × 1080, 30 fps.
TIME:    80 s × 30 = 2400 images. Pas de musique (pas de catalogue sans compte HeyGen) : les coupes suivent les phrases de Pierre.
LOOK:    charte Lyvre de l'application.
         - fond papier #F6F4EE uni, sans grain ; encre #1E2421 ; texte secondaire #4E5A54.
         - accent unique paille #D9A441 (heure du jour, surlignage de la ligne du cahier) ; lichen #2F6B4F seulement pour « Fourmy » et la fin.
         - voix de Pierre : Bricolage Grotesque 800, 120 px, interlettrage -2 %, au fer à gauche à 160 px ; heure en IBM Plex Sans 600, 56 px, chiffres tabulaires, paille foncé #6B4A0E.
         - phrases sous les écrans : Bricolage Grotesque 700, 44 px, encre, x = 120 px, haut à 948 px.
         - matière : les vrais écrans de Fourmy (captures 2×), dans un cadre blanc de 1680 × 840 px en (120, 64), rayon 18 px, ombre 0 8 24 px rgba(30,36,33,0.12). La 3D est plein cadre.
OBJECTS: l'intervention « Semis tout-en-un, Lespourcy » (formulaire, fiche, badge PLANIFIÉE puis RÉALISÉE) ; le tracteur Claas Arion 430 et son semoir Monosem dans le plan 3D ; la trace orange sur l'orthophoto ; le cahier de fertilisation, ligne du 16/04 ; un pointeur de souris noir à liseré blanc, 34 px.
MOTION:  caméra dans l'écran = une poussée par plan, 36 images, power2.inOut ; textes en balayage gauche→droite (clip-path) 14 images, power3.out ; clic = pointeur qui glisse 18 images (power2.out) puis s'enfonce à 0,85 en 4 images ; surlignage = scaleX 0→1 en 16 images. Rien ne bouge pendant qu'on lit.
SHOTS:
  0–4,5 s     titre « 7 h 10 / Aujourd'hui, je sème mon maïs. »
  4,5–19,5    formulaire planifié : moyens, puis météo et contrôles, clic « Planifier », fiche PLANIFIÉE.
  19,5–23     titre « 9 h 15 / Je pars semer Lespourcy. »
  23–34       rejeu 3D du semis (arrivée, puis passes), moteur diesel discret.
  34–37,5     titre « 18 h 30 / Au bureau, la trace m'attend. »
  37,5–53,5   parcours GPS → « Ajouter à une intervention » → le semis prévu → « Réaliser », heures du GPS.
  53,5–63,5   fiche réalisée : trace, contrôles, puis nitrates CONFORME et IFT 1,435 (pop sur chaque).
  63,5–71     cahier de fertilisation, ligne du 16/04 surlignée.
  71–75,5     « Je sème. / Fourmy fait les papiers. »
  75,5–80     fin : logo, fourmy.org, mention de la ferme et de la mise en scène.
BANNED:  fond sombre, lueurs, dégradés, cartes de verre ; tout centré ; tout qui apparaît en fondu et glisse vers le haut ; texte qui bouge pendant la lecture ; capture assombrie sous un titre ; logo dans un coin ; pastilles décoratives ; l'adresse du compte de démonstration lisible à l'écran.
QA:      2 s (titre lu), 9 s (moyens lisibles), 14 s (clic Planifier), 27 s (tracteur + semoir), 45 s (clic Semis), 50 s (heures 09:15–11:47), 60 s (CONFORME + IFT), 66 s (ligne 16/04 surlignée, pas de ligne de mai), 78 s (fin et mention).
