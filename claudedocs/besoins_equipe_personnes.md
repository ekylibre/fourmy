# Équipe et personnes : expression des besoins

Brainstorm du 2026-11-12, à la suite des retours de David sur la page
Équipe (`/f/:farm/team`). Document de **besoins** : le modèle de données, les
contrats et l'API sont à concevoir ensuite (`/sc:design`).

## 1. Constat

- **Deux listes séparées sur la page Équipe.**
  - **Membres** : les comptes (`users`) rattachés à la ferme par
    `memberships`, avec un rôle (Responsable, Salarié). L'ajout se fait par
    email, pour un compte qui doit déjà exister (« à créer par
    l'administrateur »).
  - **Personnes** (`people`) : un nom, un rôle libre, un lien facultatif
    vers un compte, actif ou non. Ce sont elles qu'on choisit comme
    intervenants dans les interventions et les modèles d'attelage.
- La même personne apparaît donc deux fois, et le lien entre les deux est
  manuel. Chez Pierre : 1 personne et 1 compte, non reliés.
- **Ni coordonnées, ni photo, ni temps de travail.** Les heures existent
  pourtant : ce sont les périodes des interventions réalisées.
- **Certiphyto** : rien n'est stocké. L'applicateur d'un traitement est
  déduit de l'attelage (docs/interventions.md).
- **Import Ekylibre** : seuls les intervenants (« Worker ») sont repris, par
  leur nom. C'était la décision du 2026-11-07 (docs/interventions.md §7),
  revue ici.
- **Données Ekylibre disponibles** : la fiche « entité » liée à chaque
  intervenant et à chaque utilisateur contient prénom, nom, photo, date de
  naissance, adresse postale, email et portable.
  - Chez Pierre : 1 intervenant et 3 utilisateurs, sans coordonnées.
  - Chez Entre-deux-Terres : 9 intervenants et 7 utilisateurs, dont
    quelques-uns avec email, adresse postale ou portable.
  - Groupes, contrats et pointages (`worker_groups`, `worker_contracts`,
    `worker_time_logs`) : vides dans les deux fermes.

## 2. Décisions (2026-11-12)

1. **Un seul modèle : la personne.**
   - Les membres de l'équipe sont des personnes.
   - Une personne **peut avoir un compte** Fourmy, ou non (un saisonnier,
     un voisin qui aide).
   - Le rôle sur la ferme est porté par la personne qui a un compte.
2. **Trois rôles** :
   - **Responsable** : tout.
   - **Salarié** : saisit, voit l'équipe sans les coordonnées des autres.
   - **Lecture seule** (nouveau) : conseiller, technicien, comptable. Voit
     la ferme, ne saisit rien, ne voit pas les coordonnées.
3. **Une équipe par ferme.** La page Équipe montre toutes les personnes de
   la ferme. Les regroupements de chantier restent les modèles d'attelage
   existants. Pas d'équipes nommées.
4. **Coordonnées visibles par le responsable et par la personne
   elle-même.** Les autres voient le nom, la photo, le rôle et le temps de
   travail.
5. **Champs de la fiche** :
   - prénom, nom, photo (ou avatar) ;
   - adresse personnelle, email, portable ;
   - date de naissance ;
   - Certiphyto ;
   - contrat.
6. **Import Ekylibre complet**.
   - Sont repris : identité, photo, date de naissance et coordonnées des
     intervenants **et** des utilisateurs Ekylibre.
   - Un utilisateur Ekylibre devient une personne **sans compte Fourmy** ;
     le responsable l'invite ensuite.
   - Cette décision remplace le « nom seulement » du 2026-11-07.
7. **Invitation** : par email quand l'envoi d'emails (SMTP) est
   configuré. Sinon, le responsable copie un lien d'invitation et l'envoie
   lui-même (SMS, messagerie).
8. **Temps de travaux** :
   - totaux par période ;
   - répartition par activité et par procédure ;
   - liste des interventions.

   Pas d'export de paie dans ce lot.
9. **Pavé** : sous le nom, les heures du mois et la dernière intervention.

## 3. Parcours utilisateur

### 3.1 Vue index : les pavés

- **US-EQ-1** : en tant que membre de la ferme, j'ouvre Équipe et je vois
  une grille de pavés, un par personne.
  - Chaque pavé montre :
    - la photo, sinon un avatar (initiales sur une couleur stable) ;
    - le prénom et le nom ;
    - le rôle (Responsable, Salarié, Lecture seule, ou « Sans compte ») ;
    - les heures du mois de la frise ;
    - la dernière intervention réalisée (date et procédure) ;
    - un badge « Inactive », et un badge « Certiphyto expiré » ou « expire
      bientôt » le cas échéant.
  - Les personnes actives viennent d'abord, puis par nom.
  - Filtres : active / inactive, avec ou sans compte, rôle. Recherche sur
    le nom.
  - Responsable : bouton « Ajouter une personne ».
  - Sur téléphone, une colonne, sans défilement horizontal.
- **US-EQ-2** : je clique sur un pavé et j'arrive sur la fiche de la
  personne, comme la fiche d'un matériel. Elle a une adresse propre et
  partageable, qui garde la date de la frise. Un lien « ← Équipe » ramène
  à la grille.

### 3.2 Vue détaillée : la fiche personne

- **En-tête** :
  - photo ou avatar ;
  - prénom et nom ;
  - badges : rôle, compte (« Compte actif », « Invitée », « Sans
    compte »), « Inactive » ;
  - bouton « Modifier », pour le responsable, et pour la personne
    elle-même sur ses coordonnées et sa photo.
- **Onglet Général** :
  - **Identité** : prénom, nom, photo, date de naissance.
  - **Coordonnées** : adresse personnelle, email, portable. Pour les
    autres membres, le bloc n'apparaît pas.
  - **Contrat** (visible du responsable et de la personne) :
    - type : exploitant, CDI, CDD, saisonnier, apprenti, bénévole,
      prestataire ;
    - date d'entrée, date de sortie.
  - **Certiphyto** :
    - catégorie (décideur, opérateur…), numéro, date de fin de validité ;
    - alerte 3 mois avant l'expiration ;
    - visible de tous les membres : la conformité d'un traitement en
      dépend.
  - **Compte Fourmy** (responsable) :
    - état : sans compte, invitée, compte actif ;
    - rôle sur la ferme ;
    - actions : inviter (avec l'email de la fiche), renvoyer ou copier le
      lien d'invitation, changer le rôle, retirer l'accès.
    - Retirer l'accès garde la personne et son historique.
- **Onglet Temps de travaux** : voir §3.3.

#### Parcours

- **US-EQ-3** : en tant que responsable, je crée une personne sans compte.
  Le prénom et le nom suffisent, le reste est facultatif. Elle est aussitôt
  choisissable comme intervenant.
- **US-EQ-4** : en tant que responsable, j'invite une personne existante.
  - Avec SMTP, elle reçoit un email. Sans SMTP, je copie le lien
    d'invitation, valable 7 jours.
  - Quand elle crée son compte, elle reste **la même personne** et garde
    son historique d'interventions.
- **US-EQ-5** : en tant que salarié, j'ouvre ma propre fiche.
  - Je modifie ma photo, mon adresse, mon email et mon portable.
  - Je ne change ni mon rôle, ni mon contrat, ni mon Certiphyto.
- **US-EQ-6** : en tant que responsable, je désactive une personne partie.
  Elle disparaît des choix d'intervenants, mais reste dans l'historique et
  dans les temps passés.
- **US-EQ-7** : en tant que lecteur (Lecture seule), je vois la grille et
  les fiches sans coordonnées, et aucun bouton de modification.

### 3.3 Temps de travaux

- **Calcul** : une personne a travaillé pendant chaque période d'une
  intervention **réalisée** où elle est intervenante.
  - En mode attelage, seules les périodes de son attelage comptent.
  - En mode libre, toutes les périodes de l'intervention comptent.
  - Les interventions annulées ou planifiées ne comptent pas.
  - Deux interventions qui se chevauchent pour la même personne ne sont
    comptées qu'une fois (union des plages horaires).
- **Totaux** : semaine (lundi à dimanche), mois civil, campagne en cours
  (même règle de campagne que le reste de Fourmy), 12 derniers mois, et des
  barres par mois. La période suit la date de la frise.
- **Répartition** :
  - par activité (maïs, vigne…), d'après les parcelles cibles de
    l'intervention ;
  - par procédure (semis, traitement, récolte…) ;
  - une intervention sur plusieurs activités répartit ses heures au
    prorata des surfaces travaillées (règle définie dans
    docs/equipe-personnes-design.md §5.3) ;
  - « Sans activité » pour les interventions sans parcelle (entretien,
    transport).
- **Liste des interventions** :
  - date, procédure, durée, parcelles, matériel de son attelage ;
  - lien vers chaque intervention ;
  - les plus récentes d'abord, sur la période choisie, paginée.
- **Contrôle** : sur la ferme de Pierre, la somme des heures par mois est
  égale à la somme des périodes, au quart d'heure près.

### 3.4 Import Ekylibre

- **Intervenants** (`products` de type Worker) : une personne chacun,
  rattachée à sa fiche entité. On reprend :
  - prénom, nom, photo, date de naissance ;
  - adresse postale, email, portable ;
  - pour plusieurs adresses du même canal : celle marquée « par défaut »,
    sinon la plus récente.
- **Utilisateurs Ekylibre** : une personne chacun, sans compte Fourmy.
  - Un utilisateur qui est aussi intervenant (même fiche entité) ne donne
    qu'**une** personne.
  - Son rôle Ekylibre (administrateur ou non) est noté dans le rapport à
    titre indicatif. Aucun rôle Fourmy n'est attribué.
- **Contrats Ekylibre** (`worker_contracts`) : repris quand il y en a
  (date d'entrée, de sortie, nature). Vides chez les deux fermes connues.
- **Sans prénom ni nom** : le nom reste « Personne n », comme aujourd'hui.
- **Réimport** :
  - pas de doublon : la clé reste l'identifiant Ekylibre ;
  - un champ modifié dans Fourmy depuis l'import n'est **pas écrasé** ;
  - seuls les champs encore vides sont complétés.
- **Personnes déjà importées** (nom seul) : un réimport les complète sans
  changer leur identifiant. Les interventions restent rattachées.
- **Rapport d'import** : personnes créées et complétées, coordonnées
  reprises par type. Il ne contient aucune valeur.

## 4. Exigences non fonctionnelles

- **RGPD** :
  - Coordonnées, date de naissance, contrat et photo : accessibles au
    responsable et à la personne seulement.
    - Le contrôle est fait par l'API, pas seulement à l'écran.
    - Exception : la photo est visible de tous les membres (pavés).
  - Journaux et rapport d'import : aucune donnée personnelle.
  - Fixtures et fermes de démonstration : coordonnées fictives.
  - Mention d'information à compléter dans
    `docs/site-public-exigences.md` : catégories de données, finalité,
    accès, durée de conservation.
- **Effacement** :
  - une personne sans historique peut être supprimée ;
  - avec un historique, elle est anonymisée : nom remplacé, coordonnées,
    photo et date de naissance effacées, heures conservées.
- **Photo** :
  - PNG ou JPEG, 2 Mo au plus, recadrée en carré et réduite à 256 px ;
  - stockée comme les logos des matériels ;
  - jamais transmise à un service tiers.
- **Lien d'invitation** :
  - à usage unique, valable 7 jours, révocable ;
  - il ne contient pas l'email de la personne.
- **Synchro mobile** :
  - la collection `people` de zero-mobile garde son format, sans
    coordonnées ;
  - la personne connectée reçoit en plus sa propre fiche complète et ses
    temps de travaux (§6.3).
- **Compatibilité** : les écrans qui choisissent un intervenant
  (interventions, attelages, phyto) continuent de fonctionner. Seul
  l'affichage change : prénom et nom.
- **Performance** : la grille de 50 personnes, avec heures du mois et
  dernière intervention, répond en moins de 300 ms côté API.

## 5. Critères d'acceptation

1. La page Équipe n'a plus deux tableaux mais une grille de pavés. Chaque
   pavé ouvre la fiche de la personne.
2. Un compte rattaché à la ferme sans personne correspondante (cas actuel
   de la ferme de Pierre) apparaît comme une personne, avec son rôle, sans
   doublon.
3. Une personne sans compte peut être créée, choisie comme intervenant,
   puis invitée par lien. Une fois son compte créé, son historique est
   intact.
4. Un salarié ou un lecteur connecté ne voit pas l'adresse, l'email, le
   portable, la date de naissance ni le contrat d'un collègue, y compris en
   appelant l'API directement.
5. Un compte « Lecture seule » ne peut rien créer ni modifier (API : 403).
   Il exporte les registres phyto et fertilisation.
6. Les heures d'octobre 2026 d'un intervenant de Pierre sont égales à la
   somme des périodes de ses interventions réalisées d'octobre. La
   répartition par activité retombe sur ce total.
7. Un Certiphyto qui expire dans moins de 3 mois s'affiche en alerte, sur
   le pavé et sur la fiche.
8. Un import d'Entre-deux-Terres reprend les coordonnées présentes dans
   Ekylibre. Un second import ne crée aucun doublon et n'écrase pas une
   coordonnée modifiée dans Fourmy.
9. Tests :
   - API : droits, temps de travaux, invitation, import ;
   - web : pavés, fiche, droits d'affichage ;
   - e2e : création → intervention → heures sur la fiche ;
   - synchro mobile : sa fiche et ses heures pour la personne connectée,
     pas de coordonnées des autres.
10. Dans zero-mobile, la personne connectée voit sa fiche et ses heures.

## 6. Questions tranchées (2026-11-12)

1. **Certiphyto et contrôle réglementaire** : **non**. Le Certiphyto est
   porté par la fiche, avec son alerte d'expiration. Le contrôle des
   traitements n'en tient pas compte.
2. **Lecture seule et registres** : **oui**. Un compte « Lecture seule »
   consulte et exporte les registres phyto et fertilisation. Il ne voit pas
   les coordonnées des personnes.
3. **Mobile** : **oui**. Dans zero-mobile, la personne connectée voit sa
   fiche (coordonnées comprises) et ses heures. Elle ne voit pas les
   coordonnées des autres.
   - Conséquence pour la synchro mobile (§4) : un pull de sa propre fiche
     et de ses temps de travaux.
   - La collection `people` des autres personnes reste sans coordonnées.
4. **Coût de main-d'œuvre** : **écarté de ce lot**, confirmé. Il sera
   rouvert avec le coût des chantiers.

## 7. Suite

- `/sc:design`, à concevoir :
  - le modèle `people` enrichi, avec le compte et le rôle portés par la
    personne ;
  - la reprise des `memberships` existantes ;
  - les invitations ;
  - les droits par champ ;
  - le calcul des heures (union des plages, prorata par activité) ;
  - les contrats et les routes ;
  - le mapping de l'import Ekylibre.
- Mettre à jour la décision §7.1 de `docs/interventions.md`, pour qu'elle
  renvoie vers ce document une fois validé.
