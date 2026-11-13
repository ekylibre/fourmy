# « Ma ferme » : expression des besoins

Brainstorm du 2026-11-13. Document de **besoins** : le modèle de données, les
contrats et l'API sont à concevoir ensuite (`/sc:design`).

## 1. Constat

- **La ferme n'a presque pas d'identité.** La table `farms` contient le nom,
  le SIRET et le PACAGE (14 et 9 chiffres, contrôlés en base). Il n'y a ni
  adresse, ni point GPS, ni coordonnées.
- **SIRET et PACAGE se saisissent dans le registre phyto.** Le formulaire est
  dans `OfficialRegister.tsx`, et l'API passe par `GET/PUT /settings/identity`,
  réservé au responsable. Rien ne permet de les trouver ailleurs.
- **Les réglages de la ferme sont éparpillés.** `farm_settings` contient
  l'entretien (`maintenance`) et les parcours (`tracks`), chacun avec sa route
  `/settings/...`. Les marques ont leur propre table (`farm_brands`).
- **Fond de carte** : `plan` (Plan IGN v2) ou `ortho` (orthophotos), choisi
  écran par écran. Aucune préférence n'est enregistrée pour la ferme.
- **Point de la ferme** : il n'existe pas. La météo prend le centre des
  parcelles (`weatherPoint`, `repos/weather.ts`). Sans parcelle, pas de point.
- **Données IGN** : le relief, la BD TOPO et l'hydrographie sont téléchargés
  à la demande (`@fourmy/geo-ign`, cache en mémoire `Lru`). Rien n'est
  préparé à l'avance et rien ne survit à un redémarrage de l'API.
- **Géocodage** : `https://data.geopf.fr/geocodage/search?q=…` renvoie un
  GeoJSON avec le point, `label`, `score`, `type` (numéro, rue, commune…),
  `postcode`, `city`, `citycode` (INSEE) et `depcode`. Le service est gratuit
  et sans clé, comme les autres services de la Géoplateforme déjà utilisés.

## 2. Décisions (2026-11-13)

1. **Une fiche par ferme.** « Ma ferme » est la fiche de la ferme ouverte
   (`/f/:farmId`), pas un réglage commun à toute l'instance. On reste dans le
   modèle multi-ferme actuel.
2. **Informations métier retenues** : identité légale, agréments et labels,
   filières, contacts (détail en §4).
3. **Point GPS** : il est géocodé automatiquement depuis l'adresse, puis on
   peut le **déplacer sur une carte**. Exemple : une adresse postale en
   centre-bourg alors que le siège est à 2 km.
4. **Données IGN** : on **télécharge à l'avance**, dans un rayon réglable
   autour du point de la ferme, les données IGN dont la carte et la 3D ont
   besoin. Le but est d'aller plus vite et de pouvoir travailler hors ligne.
5. **Cache IGN sur le serveur et dans le navigateur.** Le serveur garde les
   données pour toute la ferme. Le navigateur en garde une copie pour
   travailler sans réseau. Le mobile n'est pas concerné dans ce lot.
6. **Reprise depuis Ekylibre** : l'identité de la société (SIRET, TVA, NAF,
   forme juridique, adresse) est reprise à l'import.
7. **Tous les réglages de la ferme sont regroupés dans « Ma ferme »**, y
   compris l'entretien et les parcours, aujourd'hui dispersés.
8. **Un ou plusieurs sites**, chacun avec sa zone : le siège, plus d'autres
   corps de ferme si besoin. Chaque site a son point et son rayon de
   téléchargement IGN.
9. **Logo** : celui de la ferme s'il est fourni, sinon celui de Fourmy, sur
   les documents imprimés.
10. **Rayon IGN : 10 km par défaut**, réglable de 1 à 30 km.
11. **Niveaux de zoom** : zoom 18 seulement autour des parcelles, zoom 16
    au plus sur le reste de la zone.
12. **Hors ligne sur le mobile** : prévu dans un lot suivant.
13. **Unités de surface (ha ou a)** : nouveau réglage de la ferme. La date
    de début de campagne n'en fait pas partie : elle est déjà portée par
    chaque activité.

## 3. Accès

- **E1. Bouton « Ma ferme »** en haut à droite du tableau de bord, sur la
  ligne du titre (« Aujourd'hui » / « Au … »).
- **E2. Une page dédiée** `/f/:farmId/farm`, aussi accessible depuis le menu
  de navigation, pour qu'on puisse y aller sans passer par le tableau de bord.
- **E3. Droits.** Tous les membres peuvent consulter la fiche. Seul le
  **responsable** la modifie, comme les réglages actuels (`requireOwner`).
  Un salarié voit les champs en lecture seule, sans bouton d'enregistrement.

## 4. Contenu de la fiche

### 4.1 Identité

| Champ | Obligatoire | Contrôle |
|---|---|---|
| Nom de la ferme | oui | non vide, 120 caractères au plus |
| Raison sociale | non | si différente du nom d'usage |
| Forme juridique | non | liste : EI, EARL, GAEC, SCEA, SARL, SAS, autre |
| SIRET | non | 14 chiffres, clé de Luhn |
| N° de TVA intracommunautaire | non | format FR + 11 caractères ; proposé à partir du SIREN |
| Code NAF | non | format `01.11Z` |

### 4.2 Adresse et localisation

| Champ | Obligatoire | Contrôle |
|---|---|---|
| Adresse (ligne 1, ligne 2) | non | texte libre |
| Code postal | non | 5 chiffres |
| Ville | non | texte |
| Code INSEE de la commune | automatique | rempli par le géocodage, non saisi |
| Point GPS (latitude, longitude) | automatique, modifiable | en France métropolitaine ou dans les DROM |
| Origine du point | automatique | « géocodé » (avec le score) ou « placé à la main » |

L'adresse ci-dessus est celle du **siège**. C'est le premier site de la
ferme (§4.5).

- **E4. Saisie assistée.** Pendant qu'on tape l'adresse, une liste de
  suggestions s'affiche (géocodage IGN, à partir de 3 caractères, avec un
  délai). Choisir une suggestion remplit la rue, le code postal, la ville, le
  code INSEE et le point.
- **E5. Saisie libre possible.** On peut enregistrer une adresse que l'IGN ne
  trouve pas, par exemple un lieu-dit. Dans ce cas on géocode la commune, ou
  on place le point à la main.
- **E6. Carte de contrôle.** Une petite carte (fond IGN) montre une épingle
  sur le point. On peut la déplacer. Après un déplacement manuel, l'origine
  devient « placé à la main » et le point n'est plus recalculé quand
  l'adresse change, sauf si on clique sur « Recalculer depuis l'adresse ».
- **E7. Géocodage peu fiable.** Si le score est faible ou si le résultat
  n'est qu'une commune, on le signale (« point approximatif, vérifiez sur la
  carte »).

### 4.3 Informations métier

| Groupe | Champs |
|---|---|
| PAC | N° PACAGE (9 chiffres, existant) |
| Agréments et labels | N° d'agrément ou Certiphyto de l'exploitation (avec date d'échéance) ; agriculture biologique (organisme certificateur, n° de certificat, date d'échéance) ; HVE (niveau, date d'échéance) |
| Filières | CVI (viticulture) ; n° EDE (élevage) |
| Contacts | téléphone, e-mail, responsable légal (une personne de l'équipe ou un nom libre) |

- **E8. Échéances.** Les certifications qui expirent dans moins de 60 jours
  apparaissent dans les alertes du tableau de bord.
- **E8 bis. Logo.** Le responsable peut déposer un logo (PNG, JPEG ou SVG).
  Les documents imprimés (plan de fumure, registre phyto…) affichent le logo
  de la ferme, ou celui de Fourmy s'il n'y en a pas.
- **E8 ter. Reprise depuis Ekylibre.** À l'import, la fiche de la société
  Ekylibre remplit l'identité (raison sociale, forme juridique, SIRET, TVA,
  NAF) et l'adresse du siège, qui est ensuite géocodée. Si un champ est déjà
  rempli dans Fourmy, on n'écrase pas la saisie : on signale l'écart dans le
  compte rendu d'import.

### 4.4 Préférences de la ferme

- **E9. Fond de carte par défaut** : Plan IGN ou orthophotos. Chaque carte
  s'ouvre sur ce fond. On peut toujours en changer sur un écran, sans
  modifier la préférence.
- **E10. Centre des cartes.** Quand la ferme n'a pas encore de parcelle, les
  cartes s'ouvrent centrées sur le siège.
- **E11. Point météo de repli.** Le siège remplace le centre des parcelles
  quand il n'y a pas de parcelle (aujourd'hui, pas de météo du tout dans ce
  cas).
- **E12. Données IGN autour de chaque site** :
  - un **rayon par site**, **10 km par défaut**, réglable de 1 à 30 km ;
  - le **niveau de détail** : orthophotos au zoom 18 autour des parcelles
    (avec une marge à préciser en conception), zoom 16 au plus sur le reste
    de la zone ;
  - les **couches** à préparer : orthophotos, Plan IGN, relief (pour la 3D),
    BD TOPO bâtiments, hydrographie (pour les ZNT) ;
  - un bouton **« Télécharger maintenant »** et l'état du cache : date,
    volume, couches à jour ou non ;
  - la **mise à jour** : manuelle, ou automatique quand un point ou un rayon
    change ;
  - quand les zones de deux sites se recouvrent, la partie commune n'est
    téléchargée qu'une fois.
- **E13. Téléchargement en tâche de fond.** La page reste utilisable pendant
  le téléchargement, qui affiche sa progression. Un échec partiel (réseau,
  quota IGN) est signalé couche par couche et peut être relancé.
- **E14. Copie dans le navigateur.** Sur un poste donné, l'utilisateur peut
  « Garder pour le hors ligne » : le navigateur copie depuis le serveur
  Fourmy (pas depuis l'IGN) les couches des zones de la ferme. Sans réseau,
  la carte et la 3D se chargent depuis cette copie. La page indique l'espace
  occupé sur le poste et permet de le libérer.
- **E15. Le serveur d'abord.** Les écrans demandent les données IGN au
  serveur Fourmy. Il répond depuis son cache, et ne va chercher à l'IGN que
  ce qui manque.

### 4.5 Sites

- **E16. Un ou plusieurs sites.** Le siège est le premier site, créé à
  partir de l'adresse de la ferme. On peut en ajouter d'autres : un autre
  corps de ferme, un bâtiment d'élevage, une parcelle isolée éloignée.
- **E17. Contenu d'un site** : un nom, une adresse facultative (géocodée
  comme celle du siège), un point déplaçable sur la carte et un rayon de
  zone (10 km par défaut).
- **E18. Carte des sites.** La page montre tous les sites et le cercle de
  leur zone. Cela permet de vérifier que les parcelles sont bien couvertes.
- **E19. Parcelles hors zone.** Si des parcelles tombent hors de toutes les
  zones, on le signale (« 3 parcelles hors des zones IGN ») et on propose
  d'agrandir un rayon ou d'ajouter un site.
- **E20. Le siège ne se supprime pas.** On peut le déplacer, mais il reste
  toujours au moins un site.

### 4.6 Réglages regroupés

- **E21. Tous les réglages au même endroit.** « Ma ferme » regroupe dans des
  onglets : Identité, Sites et cartes, Données IGN, Entretien (seuils
  « bientôt » de `farm_settings.maintenance`), Parcours (seuils de
  `farm_settings.tracks`), Marques (`farm_brands`).
- **E21 bis. Unités de surface.** Le responsable choisit l'hectare ou l'are
  pour l'affichage des surfaces de la ferme. Les calculs et le stockage ne
  changent pas (m² en base). Les documents réglementaires gardent l'unité
  qu'ils imposent.
- **E22. Les anciens accès renvoient ici.** Les réglages d'entretien et de
  parcours restent accessibles depuis leurs écrans, mais par un lien vers le
  bon onglet de « Ma ferme ». Il n'y a qu'un seul formulaire par réglage.

## 5. Exigences non fonctionnelles

- **N1. Géocodage depuis le serveur.** Le navigateur passe par l'API, qui
  appelle l'IGN. On garde ainsi un seul point de sortie, un cache et une
  limite de débit. Seule l'adresse est envoyée à l'IGN : ni nom, ni SIRET.
- **N2. Respect des limites de la Géoplateforme.** Le géocodage et le
  téléchargement des tuiles respectent les quotas publiés. Le cache évite de
  retélécharger ce qui est à jour.
- **N3. Volume maîtrisé.** Une estimation du volume s'affiche avant le
  téléchargement (nombre de tuiles × niveaux de zoom). Au-delà d'un seuil, on
  demande confirmation. Avec 10 km de rayon, le zoom maximal des orthophotos
  fait l'essentiel du volume (voir §7).
- **N3 bis. Stockage dans le navigateur.** La copie locale respecte le quota
  du navigateur. Elle demande un stockage persistant pour ne pas être
  effacée sans prévenir. Si l'espace manque, on le dit, au lieu de laisser
  une copie à moitié faite.
- **N3 ter. Cache serveur durable.** Le cache du serveur survit aux
  redémarrages de l'API : sur disque ou dans le stockage objet, pas seulement
  en mémoire.
- **N4. Isolation.** Les données de la fiche suivent la règle des autres
  tables : une ferme ne voit que les siennes (RLS `farm_isolation`).
- **N5. Historique.** Les modifications de la fiche passent par le journal
  d'audit (`audit_log`), comme les autres écritures.
- **N6. Compatibilité.** Le formulaire SIRET/PACAGE du registre phyto reste
  utilisable, ou renvoie vers « Ma ferme ». La route `/settings/identity`
  continue de fonctionner tant que le mobile l'utilise.
- **N7. Téléphone.** La page s'utilise sur un écran de 390 px de large.

## 6. Récits utilisateur et critères d'acceptation

**R1. Ouvrir la fiche.** *En tant que membre de la ferme, je clique sur
« Ma ferme » depuis le tableau de bord pour voir l'identité de
l'exploitation.*
- Le bouton est en haut à droite du tableau de bord, et la page
  `/f/:farmId/farm` s'ouvre.
- Un salarié voit les informations sans pouvoir les modifier.

**R2. Saisir l'adresse.** *En tant que responsable, je tape l'adresse et je
choisis une suggestion.*
- Les suggestions viennent du géocodage IGN.
- Le code postal, la ville, le code INSEE et le point sont remplis, et
  l'épingle s'affiche sur la carte.
- Un résultat approximatif (commune seule, score faible) est signalé.

**R3. Corriger le point.** *En tant que responsable, je déplace l'épingle sur
le vrai siège de l'exploitation.*
- Le point est enregistré avec l'origine « placé à la main ».
- Une modification ultérieure de l'adresse ne déplace plus le point, sauf
  si je clique sur « Recalculer depuis l'adresse ».

**R4. Compléter les informations métier.** *En tant que responsable, je
saisis le SIRET, le n° de TVA, le PACAGE et le certificat bio.*
- Un SIRET invalide (longueur ou clé) est refusé avec un message clair.
- Le SIRET et le PACAGE saisis ici sont ceux du registre phyto officiel.
- Un certificat qui expire dans moins de 60 jours apparaît dans les alertes.

**R5. Choisir le fond de carte.** *En tant que responsable, je choisis
« orthophotos » par défaut.*
- La carte des parcelles, la création de parcelle et les prescriptions
  s'ouvrent sur les orthophotos.

**R6. Préparer les données IGN.** *En tant que responsable, je lance le
téléchargement autour du siège (10 km par défaut).*
- Le volume estimé s'affiche avant le lancement.
- La progression est visible, et l'état final indique la date et les couches
  téléchargées.
- La vue 3D et la carte autour de la ferme se chargent depuis le cache, même
  si l'IGN est momentanément indisponible.

**R7. Travailler sans réseau.** *En tant que membre, je garde les données de
la ferme sur mon ordinateur pour m'en servir sans connexion.*
- Le navigateur copie les couches depuis le serveur Fourmy, et l'espace
  occupé s'affiche.
- Réseau coupé, la carte des parcelles et la 3D s'affichent depuis la copie.

**R8. Ajouter un site.** *En tant que responsable, j'ajoute un second corps
de ferme à 25 km du siège.*
- Le site apparaît sur la carte avec sa zone de 10 km.
- Les parcelles proches de ce site ne sont plus signalées « hors zone ».
- Le téléchargement IGN couvre les deux zones, sans doublon.

**R9. Reprendre l'identité d'Ekylibre.** *En tant que responsable, j'importe
ma ferme Ekylibre.*
- La raison sociale, le SIRET, la TVA, le NAF et l'adresse du siège sont
  remplis et géocodés.
- Un champ déjà saisi dans Fourmy n'est pas écrasé, et l'écart apparaît
  dans le compte rendu.

**R10. Imprimer avec le logo.** *En tant que responsable, j'imprime mon plan
de fumure.*
- L'en-tête porte le logo de la ferme s'il a été déposé, sinon celui de
  Fourmy.

## 7. Points ouverts

Aucun : tous les points ont été tranchés le 2026-11-13 (décisions 1 à 13,
§2). Restent à préciser en conception :

- la marge autour des parcelles pour le zoom 18 (E12) ;
- le seuil de volume qui déclenche une confirmation (N3) ;
- le lot suivant pour le hors-ligne sur le mobile (décision 12).

## 8. Suite

`/sc:design` sur ce document : modèle (`farms` enrichie ou table
`farm_profile`, préférences dans `farm_settings`), contrats zod, routes,
service de géocodage et de cache IGN, puis découpage en lots avec
`/sc:workflow`.
