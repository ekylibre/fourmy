# Site public fourmy.org — exigences

> Statut : **exigences validées le 2026-11-07** (`/sc:brainstorm`). Étape
> suivante : `/sc:workflow` (plan) puis `/sc:implement`.

## 1. Objectifs

1. Présenter Fourmy au public (agriculteurs, partenaires, contributeurs) sur
   **fourmy.org** et **www.fourmy.org** : le projet, ce qu'il fait déjà
   (fonctionnalités illustrées), où il va (roadmap), ce qui change (changelog).
2. Donner l'accès à l'application : **bouton « Se connecter » en haut à droite**.
3. Recevoir les demandes : **formulaire de contact** vers `contact@fourmy.org`.
4. Rester à jour **sans effort** : version, changelog et fonctionnalités
   recalculés à chaque commit sur `main`.
5. Sur **ekylibre.com**, remplacer la page Ekylibre par une page **Fourmy**
   (nouvelle génération d'Ekylibre, fonctionnalités à venir).
6. Doter Fourmy d'un **logo SVG** par défaut (modifiable ensuite).

## 2. Décisions (2026-11-07)

| Sujet | Décision |
|---|---|
| Emplacement | Dans le monorepo Fourmy : `apps/site` (Astro, comme ekylibre.com), charte Lyvre de l'application |
| Hébergement | Dokploy (même serveur que dev.fourmy.org), service statique, domaines `fourmy.org` + `www.fourmy.org` (l'un redirige vers l'autre) — `*.fourmy.org` y pointe déjà |
| Contact | Point d'entrée public de l'API Fourmy + envoi SMTP d'une boîte Gandi de fourmy.org (MX Gandi déjà en place) ; pas de service tiers |
| Mise à jour auto | **Calculée à la construction** : chaque push sur `main` redéploie le site, qui recalcule version, changelog et fonctionnalités. Rien n'est recommité |
| ekylibre.com | `/ekylibre/` et `/en/ekylibre/` **remplacées** par `/fourmy/` (`/en/fourmy/`), avec redirections ; liens internes mis à jour |
| Langues | Français seul pour commencer ; structure prête pour `/en/` |
| Illustrations | **Captures des fermes de test** (fixtures anonymisées des pilotes), automatisées |
| Logo | Fourmi stylisée + mot-symbole « fourmy », couleurs de la charte Lyvre |

## 3. Exigences fonctionnelles

### Site fourmy.org

- **FS-1 En-tête** : logo, navigation (Projet, Fonctionnalités, Roadmap,
  Changelog, Contact), bouton **« Se connecter »** en haut à droite vers
  l'application (`https://dev.fourmy.org` aujourd'hui ; URL configurable pour
  la production Eyona). Version courante affichée discrètement (pied de page).
- **FS-2 Accueil / projet** : ce qu'est Fourmy (jumeau numérique de la ferme,
  réécriture d'Ekylibre, logiciel libre AGPL), pour qui, ce qui le distingue
  (carte et plan 3D dans le temps, hors ligne sur mobile, registre phyto
  calculé, réversibilité), lien vers ekylibre.com (éditeur) et Lyvre.
- **FS-3 Fonctionnalités illustrées** : une carte par fonctionnalité livrée
  (titre, phrase, capture, état « disponible / en test / à venir »). Captures
  générées automatiquement depuis l'application sur les **fermes de test**.
- **FS-4 Roadmap** : jalons à venir (ex. mobile sur appareil, production
  Eyona, registre PDF, OpenAPI, intégrations météo…), avec état et horizon ;
  source unique dans le dépôt (§4).
- **FS-5 Changelog** : par version, les nouveautés et corrections lisibles
  par un agriculteur, dates comprises.
- **FS-6 Contact** : nom, e-mail, profil (agriculteur, partenaire,
  développeur, autre), message, consentement ; accusé de réception à
  l'écran ; message reçu sur `contact@fourmy.org` avec réponse possible
  directement à l'expéditeur.
- **FS-7 Pages légales** : mentions légales (éditeur Ekylibre SAS), données
  personnelles du formulaire (finalité, conservation, droits).

### Mise à jour automatique

- **AU-1 Version** : calculée depuis l'historique Git selon les commits
  conventionnels — `feat` → version mineure, `fix` → correctif, `!` /
  `BREAKING CHANGE` → majeure ; point de départ 0.1.0. Même version exposée
  par l'API (`/health`) et le site.
- **AU-2 Changelog** : seuls `feat` et `fix` ; portée technique retirée
  (« (agent D) »…), **corps des commits jamais publiés** ; un commit peut
  porter une ligne `Public: <texte>` qui remplace son titre sur le site, ou
  `Public: non` pour l'exclure.
- **AU-3 Liste noire** : la construction **échoue** si le changelog public
  contient un nom de pilote, de tenant ou un identifiant interne (liste dans
  le dépôt), plutôt que de le publier.
- **AU-4 Fonctionnalités** : fichier `apps/site/content/features.yaml`
  (titre, texte, état, capture, lien vers la version d'arrivée) complété par
  des données calculées (nombre de procédures du catalogue, formes…). Une
  fonctionnalité passe « disponible » quand le commit qui la livre est publié.
- **AU-5 Déclenchement** : Dokploy redéploie le site à chaque push sur `main`
  (déjà en place pour l'application). La construction a besoin de
  l'historique Git complet (clone non superficiel, ou historique fourni à la
  construction).
- **AU-6 Captures** : script Playwright qui ouvre l'application sur les
  fermes de test et régénère les captures ; lancé en CI ou à la main quand
  l'interface change (pas à chaque commit : coûteux).

### ekylibre.com (dépôt ekylibre-sas)

- **EK-1** Nouvelle page produit `/fourmy/` (et `/en/fourmy/`) : Fourmy,
  nouvelle génération d'Ekylibre, fonctionnalités **à venir** et lien vers
  fourmy.org.
- **EK-2** Redirections `/ekylibre/` → `/fourmy/`, `/en/ekylibre/` →
  `/en/fourmy/` (GitHub Pages : pages de redirection).
- **EK-3** Liens internes mis à jour : `routes.ts`, menu, cartes
  (`InfoCard`), page Aiffel, schéma du système (`SystemDiagram`), produits
  (`products.yaml`), sitemap, images de partage.
- **EK-4** Logo Fourmy ajouté aux logos produits du site.
- **EK-5** Les contrôles du site (`check-content`, liens, tests a11y et
  smoke) passent.

### Logo

- **LG-1** SVG vectoriel pur : symbole (fourmi stylisée) + mot-symbole
  « fourmy » ; versions symbole seul (favicon), clair / sombre ; couleurs de
  la charte Lyvre ; lisible à 16 px. Réutilisé par l'app, le site et
  ekylibre.com.

## 4. Exigences non fonctionnelles

- **Performance** : site statique, Lighthouse ≥ 95 (performance,
  accessibilité, bonnes pratiques, SEO) ; images optimisées (WebP/AVIF).
- **Accessibilité** : RGAA / WCAG AA (tests a11y comme ekylibre.com).
- **Sécurité du formulaire** : point d'entrée public limité (débit par IP,
  taille), pièges anti-robots (champ invisible, délai minimal), validation
  stricte ; aucune donnée du formulaire stockée en base ; secrets SMTP dans
  les variables Dokploy uniquement ; en-têtes de sécurité (CSP).
- **Vie privée** : pas de cookie ni de traceur tiers ; mesure d'audience
  éventuelle sans cookie.
- **SEO** : titres, descriptions, sitemap, Open Graph, `www` → apex (ou
  l'inverse) en 301.
- **Portabilité** : rejouable sur le Dokploy d'Eyona par variables.

## 5. Critères d'acceptation

- `https://fourmy.org` et `https://www.fourmy.org` servent le site en HTTPS ;
  « Se connecter » ouvre l'application.
- Un commit `feat: …` poussé sur `main` fait apparaître, après redéploiement,
  une version mineure supérieure et l'entrée correspondante au changelog ; un
  commit `docs:` ne change ni la version ni le changelog.
- Un commit dont le titre contient un nom de la liste noire fait échouer la
  construction du site (rien n'est publié).
- Le formulaire envoie un message reçu sur `contact@fourmy.org` avec
  « Répondre » vers l'expéditeur ; un envoi robotisé (champ piège rempli)
  est ignoré ; 10 envois rapides depuis la même IP sont limités.
- `https://ekylibre.com/ekylibre/` redirige vers `/fourmy/` ; aucun lien
  interne cassé (`check:links`).
- Le logo s'affiche net en favicon (16 px) et en en-tête.

## 6. Questions ouvertes

1. **Consentement des pilotes** : les captures montrent les contours réels de
   leurs parcelles (fixtures anonymisées, choix retenu). Recommandé : leur
   accord écrit, ou réserver aux captures les vues qui ne situent pas la
   ferme (stocks, cuverie, registre) et une carte recadrée.
2. **Boîte `contact@fourmy.org`** : à créer chez Gandi (ou redirection), et
   accès SMTP d'envoi (compte dédié) à fournir dans `.env.prod`.
3. **Domaine canonique** : `fourmy.org` (www redirigé) — proposé.
4. **Adresse de l'application en production** (Eyona) : `app.fourmy.org` ?
   Le bouton « Se connecter » pointe vers dev.fourmy.org en attendant.
5. **Roadmap** : contenu initial à valider (je propose une première version
   tirée du README et de `docs/interventions.md`).
6. **Historique Git dans Dokploy** : vérifier que la construction dispose de
   l'historique complet (sinon le fournir à la construction).
7. **ekylibre.com** : textes de la page `/fourmy/` à relire par l'équipe
   (ton éditeur), et date de bascule (le site est publié dès le push sur
   `main` d'ekylibre-sas).
