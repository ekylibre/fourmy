# Navigation et menu du compte : expression des besoins

Brainstorm du 2026-11-13. Document de **besoins** : les composants, les routes
et le calcul de la version sont à concevoir ensuite (`/sc:design`), ou
directement au moment du découpage en lots, vu la taille du chantier.

## 1. Constat

- **Menu latéral** (`components/Layout.tsx`, `NAVIGATION`) :
  - « Équipe » (`/team`) est une entrée de premier niveau, **réservée au
    responsable**. Pourtant, la décision 4 du 2026-11-12
    (`besoins_equipe_personnes.md`) prévoit que les autres membres voient
    l'équipe, sans les coordonnées. L'API filtre déjà ces coordonnées.
  - « Ma ferme » (`/farm`) est une entrée de premier niveau, ouverte à tous.
- **Onglets de « Ma ferme »** (`FarmProfilePage.tsx`) : Identité, Sites et
  cartes, Données IGN, Entretien, Parcours et Marques.
  - Entretien et Parcours sont réservés au responsable.
  - Marques est ouvert à tous, mais modifiable par le responsable seulement.
  - L'onglet s'ouvre par `?tab=`. Des liens existent vers
    `?tab=maintenance` et `?tab=tracks`, depuis la page Entretien.
- **En-tête**, de gauche à droite :
  - logo Fourmy, avec un lien vers la liste des fermes ;
  - nom de la ferme ;
  - badge du rôle. Il affiche « Salarié » pour tout rôle autre que
    responsable, y compris pour la lecture seule ;
  - à droite, le nom de l'utilisateur et « Se déconnecter ».
- **Pied du menu** : le texte fixe « FOURMY · JUMEAU NUMÉRIQUE ».
- **Mot de passe** : il n'existe aucun écran pour le changer. On ne le
  choisit qu'à l'invitation, avec 10 caractères au minimum
  (`minPasswordLength` de Better Auth).
- **Version** : le site public la calcule à la construction, à partir de
  l'historique Git (`@fourmy/release`, 0.112.1 le 2026-11-13). Elle est
  affichée en pied de page, et le site a une page des nouveautés
  (`/changelog`). L'application web n'affiche aucune version.
- **Photo de l'utilisateur** : elle est portée par sa fiche personne, que
  l'API sert par `GET /people/me` (lot P5).

## 2. Décisions (2026-11-13)

1. **Onglet « Équipe » dans « Ma ferme »**, placé juste après « Identité ».
   - Il reprend tout le contenu de la page Équipe : les pavés, les filtres,
     l'ajout et l'invitation d'une personne.
   - L'entrée de menu « Équipe » est supprimée.
2. **L'onglet Équipe est ouvert à tous les membres**, comme le prévoit la
   décision 4 du 12/11.
   - Le responsable ajoute, invite et modifie.
   - Les autres membres voient les pavés, sans les coordonnées des autres
     personnes.
3. **Onglet « Préférences »** : il remplace les onglets Entretien, Parcours
   et Marques, et regroupe leurs trois contenus, sans rien perdre.
4. **Menu utilisateur en haut à droite**, en forme de rond. L'entrée de menu
   « Ma ferme » est supprimée.
5. **Contenu du menu utilisateur** :
   - en tête, un simple affichage, non cliquable : nom, e-mail et rôle sur
     la ferme ;
   - la ferme ouverte, et « Changer de ferme » ;
   - Ma ferme ;
   - Changer de mot de passe ;
   - Se déconnecter.
6. **Le nom de la ferme et le badge du rôle sont retirés de l'en-tête.** Le
   nom de la ferme passe dans le menu utilisateur, et le logo Fourmy garde
   son lien vers la liste des fermes.
7. **Version en bas à gauche**, à la place de « FOURMY · JUMEAU
   NUMÉRIQUE ».
   - On affiche la version publique, « Version 0.112.1 », calculée à la
     construction comme sur fourmy.org.
   - Elle porte un lien vers la page des nouveautés du site.

## 3. Parcours utilisateur

### 3.1 Menu utilisateur

- **Le rond** :
  - Il montre la photo de la fiche personne de l'utilisateur, ou
    l'avatar choisi sur cette fiche.
  - Sinon, il montre les initiales de son nom, ou de son e-mail s'il n'a pas
    de nom.
  - Il est toujours visible, y compris sur mobile, à la place du bouton
    « Se déconnecter » actuel.
- **Au clic, le menu déroulant contient, de haut en bas** :
  1. **En-tête**, non cliquable :
     - le nom de l'utilisateur, sinon son e-mail ;
     - son e-mail, en plus petit ;
     - son rôle sur la ferme ouverte : Responsable, Salarié ou Lecture
       seule.
  2. **La ferme ouverte** : son nom, suivi de « Changer de ferme ». Ce
     lien mène à la liste des fermes, et n'apparaît que si l'utilisateur
     en a plusieurs.
  3. **Ma ferme** : ouvre `/farm`, sur l'onglet Identité.
  4. **Changer de mot de passe** : ouvre une fenêtre, détaillée au §3.3.
  5. Un séparateur, puis **Se déconnecter**.
- **Accessibilité** :
  - Le bouton porte un nom : « Compte de &lt;nom&gt; ».
  - On peut ouvrir le menu et le parcourir au clavier, et Échap le ferme.

### 3.2 Onglets de « Ma ferme »

Ordre : **Identité, Équipe, Sites et cartes, Données IGN, Préférences**.

- **Équipe** :
  - Il affiche ce qu'affiche aujourd'hui `/team`.
  - Un clic sur un pavé ouvre la fiche personne. On revient ensuite à
    l'onglet Équipe, pas à l'ancienne page.
- **Préférences** : une seule page, en trois sections titrées.
  - **Entretien** : seuils et alertes. Responsable seulement, la section
    est absente pour les autres.
  - **Parcours** : responsable seulement, absente pour les autres.
  - **Marques** : couleurs et logos, visibles par tous et modifiables par
    le responsable.
  - Pour un salarié, l'onglet ne contient donc que les Marques.
- **Anciennes adresses** :
  - `?tab=maintenance`, `?tab=tracks` et `?tab=brands` ouvrent
    Préférences, et l'écran défile jusqu'à la section demandée.
  - `/team` mène à l'onglet Équipe.
  - `/team/:personId` continue d'ouvrir la fiche personne.
  - Les favoris et les liens déjà écrits restent donc valables.

### 3.3 Changer de mot de passe

- La fenêtre demande trois champs :
  - le mot de passe actuel ;
  - le nouveau, avec 10 caractères au minimum, comme à l'invitation ;
  - la confirmation du nouveau.
- Messages :
  - en cas de succès : « Mot de passe modifié » ;
  - si le mot de passe actuel est faux : « Mot de passe actuel incorrect » ;
  - si les deux saisies du nouveau mot de passe diffèrent : un message
    sous le champ de confirmation.
- **Autres sessions** : par défaut, les sessions ouvertes sur d'autres
  appareils sont fermées après le changement. La session en cours reste
  ouverte (question 1 du §6, tranchée).

### 3.4 Pied du menu

- Il affiche « Version 0.112.1 », avec un lien vers
  `https://fourmy.org/changelog`, qui s'ouvre dans un nouvel onglet.
- **En développement** : comme en production, la version est calculée à
  partir de l'historique Git local.
- **Sans historique Git** à la construction : on affiche « Version de
  développement », sans lien.

## 4. Exigences non fonctionnelles

- **N1. Aucune route ne disparaît** : les anciennes adresses mènent à leur
  nouvelle place (§3.2).
- **N2. Droits inchangés** :
  - Les droits restent vérifiés par l'API.
  - Cacher une section ne remplace pas un contrôle.
  - L'ouverture de l'onglet Équipe aux autres membres ne leur donne aucune
    coordonnée de plus.
- **N3. Mobile web** :
  - Le rond et son menu marchent sur un écran étroit.
  - Les onglets de « Ma ferme » défilent horizontalement s'ils ne
    tiennent pas sur la largeur.
- **N4. Version** :
  - Le calcul est le même que celui du site public, donc le même numéro.
  - La version est figée à la construction de l'image, sans appel réseau.
- **N5. Pas de régression des parcours de bout en bout** : les tests e2e
  qui passent par le menu « Équipe » ou « Ma ferme » doivent être mis à
  jour.

## 5. Critères d'acceptation

1. Le menu latéral n'a plus ni « Équipe » ni « Ma ferme ».
2. Un salarié ouvre « Ma ferme », puis l'onglet Équipe. Il voit les pavés
   sans coordonnées, et aucun bouton d'ajout ni d'invitation.
3. Le responsable ouvre l'onglet Préférences, et y trouve Entretien,
   Parcours et Marques. Un salarié n'y trouve que Marques, en lecture.
4. Le lien « Réglages dans Ma ferme : seuils et alertes d'entretien », sur
   la page Entretien, ouvre Préférences sur la section Entretien.
5. L'en-tête ne montre plus « phaurigot » ni « Responsable ». Le rond
   affiche la photo de l'utilisateur, sinon ses initiales.
6. Le menu du rond montre le nom, l'e-mail, le rôle et la ferme, ainsi
   que « Changer de ferme » si l'utilisateur en a plusieurs. Il donne aussi
   accès à Ma ferme, à Changer de mot de passe et à Se déconnecter.
7. Après un changement de mot de passe, l'ancien est refusé à la
   connexion et le nouveau est accepté.
8. Le pied du menu affiche « Version x.y.z », le même numéro que sur
   fourmy.org pour la même construction.
9. Avec un compte « Lecture seule », le rôle affiché est « Lecture seule »,
   et non « Salarié » comme aujourd'hui.

## 6. Questions tranchées (2026-11-13)

1. **Autres sessions après un changement de mot de passe** : **fermées**. La
   session en cours reste ouverte.
2. **Mot de passe oublié** : **hors de ce lot**. Il attend l'envoi d'e-mails
   (SMTP, point 4 des points ouverts).
3. **Application mobile** : **hors du périmètre**.

## 7. Suite

- La taille est modeste : un seul lot, côté web. Côté API, seul le
  changement de mot de passe est concerné, et Better Auth le fournit déjà.
  On peut passer directement à `/sc:implement`, sans `/sc:design`.
- Après la livraison, mettre à jour :
  - `besoins_equipe_personnes.md`, pour l'accès à l'équipe ;
  - le README ;
  - `points_ouverts.md`, en retirant la partie du point 11 sur le message
    « (owner) » d'Équipe si elle disparaît.
