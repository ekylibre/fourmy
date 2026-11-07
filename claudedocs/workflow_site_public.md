# Plan d'implémentation — site public fourmy.org

> Source : `docs/site-public-exigences.md` (exigences validées le 2026-11-07).
> Produit par `/sc:workflow` ; exécution par `/sc:implement`, phase par phase.
> Aucune ligne de code n'est écrite à cette étape.

## Vue d'ensemble

```
Phase 0  Vérifications et accès ───────────────┐ (bloquant pour 5 et 6 seulement)
Phase 1  Logo SVG ───────────┬──────────────────┼──────────────► Phase 7 ekylibre.com
Phase 2  Moteur de version ──┤                  │
                             ├► Phase 3 Site ──► Phase 4 Captures
Phase 5  Contact (API) ──────┴──────────────────┴► Phase 6 Déploiement ► Phase 8 Recette
```

- **En parallèle d'emblée** : 1 (logo), 2 (moteur de version), 5 (contact).
- **Chemin critique** : 2 → 3 → 6 → 8.
- **Publication** : les `git push` (Fourmy et ekylibre-sas) sont faits par
  toi — la protection de Claude Code refuse les publications.

---

## Phase 0 — Vérifications et accès (préalable)

| # | Tâche | Qui | Sortie |
|---|---|---|---|
| 0.1 | **Historique Git à la construction** : vérifier si Dokploy clone en superficiel (`--depth 1`) ; le `.dockerignore` exclut `.git`. Décider : (a) image `site` avec son propre fichier d'exclusions qui garde `.git`, si l'historique est complet ; (b) sinon, `git fetch --unshallow` impossible (dépôt privé, pas de jeton dans la construction) → l'historique est fourni par un **fichier généré par le hook de déploiement Dokploy** (commande avant construction) ou par la commande de construction elle-même. | moi (lecture Dokploy) | décision a/b notée dans `docs/deploiement.md` |
| 0.2 | Boîte **contact@fourmy.org** chez Gandi + compte SMTP d'envoi (ou redirection + SMTP dédié) ; accès dans `.env.prod` (`FOURMY_SMTP_*`). | toi | accès disponibles |
| 0.3 | **Accord des pilotes** pour les captures (contours de parcelles) — ou recadrage des vues carte. | toi | décision écrite |
| 0.4 | Domaine canonique : `fourmy.org`, `www` → 301 (proposé). URL de l'app pour « Se connecter » : `https://dev.fourmy.org`, variable `PUBLIC_APP_URL`. | toi (valider) | — |
| 0.5 | Premier déploiement de `dev.fourmy.org` (en attente de ton push) — prérequis de la phase 6. | toi + moi | app en ligne |

**Point de contrôle 0** : décision 0.1 prise ; 0.2 et 0.3 peuvent arriver
plus tard (ils ne bloquent que 5/6 et 4).

---

## Phase 1 — Logo SVG (LG-1)

| # | Tâche | Détail |
|---|---|---|
| 1.1 | Symbole : fourmi stylisée (tête, thorax, abdomen, antennes, 6 pattes), géométrie simple, lisible à 16 px. | `packages/ui-lyvre/brand/fourmy-symbol.svg` |
| 1.2 | Logo complet : symbole + mot-symbole « fourm·y » (le « y » à l'accent de couleur, comme l'app), textes convertis en tracés (aucune police requise). | `fourmy-logo.svg`, `fourmy-logo-dark.svg` |
| 1.3 | Dérivés : favicon SVG + PNG 32/180/512, image Open Graph 1200×630. | script `scripts/brand.mjs` (sharp) |
| 1.4 | Branchement : favicon de l'app web, `Wordmark` inchangé (le logo complet sert sur le site et ekylibre.com). | — |

**Contrôle 1** : rendu vérifié en capture à 16, 32, 64 et 256 px, clair et
sombre ; SVG valide (aucune `<text>`, pas d'image intégrée).

---

## Phase 2 — Moteur de version et de changelog (AU-1, AU-2, AU-3)

Nouveau paquet **`packages/release`** (TypeScript pur, testable sans Git).

| # | Tâche | Détail |
|---|---|---|
| 2.1 | Lecture de l'historique : `git log` → liste `{sha, date, subject, body}` (fonction séparée, seule à toucher Git ; entrée alternative : fichier JSON, cf. 0.1 b). | `history.ts` |
| 2.2 | Analyse des commits conventionnels : type, portée, `!`, `BREAKING CHANGE`, ligne `Public: <texte>` / `Public: non`. | `conventional.ts` |
| 2.3 | Version sémantique : départ 0.1.0 ; `feat` → mineure, `fix` → correctif, rupture → majeure (≥ 1.0) ; une version par commit publiable, groupées par jour pour l'affichage. | `semver.ts` |
| 2.4 | Changelog public : `feat`/`fix` seulement ; portée retirée (« (agent D) ») ; jamais le corps du commit ; reformulation par `Public:`. | `changelog.ts` |
| 2.5 | **Liste noire** : fichier `packages/release/denylist.txt` (noms des pilotes, tenants, identifiants internes, « agent X ») ; le contrôle **fait échouer** la génération si une entrée publique en contient un. | `guard.ts` |
| 2.6 | CLI `fourmy-release` → `release.json` `{version, date, entries[]}`. | `cli.ts` |
| 2.7 | Version exposée par l'API (`/health` → `version`) et par le web (pied de page). | apps/api, apps/web |
| 2.8 | Tests : analyse, calcul de version, filtrage, `Public:`, liste noire, historique réel du dépôt (aucune fuite). | vitest |

**Contrôle 2** : `fourmy-release` sur l'historique actuel donne une version
cohérente (≈ 0.2x.0), un changelog sans jargon interne ni nom de pilote ; un
commit factice contenant un nom de pilote fait échouer la commande.

---

## Phase 3 — Site Astro `apps/site` (FS-1 à FS-5, FS-7, AU-4)

| # | Tâche | Détail |
|---|---|---|
| 3.1 | Squelette Astro (même version et outils qu'ekylibre-sas), Français seul, structure `/en/` prête. Intégré à Turborepo (`build`, `lint`, `typecheck`, `test`). | `apps/site` |
| 3.2 | Charte : `@fourmy/ui-lyvre` (couleurs, typographie Lyvre), logo de la phase 1. | — |
| 3.3 | Mise en page : en-tête (logo, navigation, **« Se connecter » en haut à droite** → `PUBLIC_APP_URL`), pied de page (version, licence AGPL, éditeur, liens légaux). | `layouts/Base.astro` |
| 3.4 | Accueil / projet (FS-2) : jumeau numérique, ce qui distingue Fourmy, lien ekylibre.com et Lyvre. | `pages/index.astro` |
| 3.5 | Fonctionnalités (FS-3, AU-4) : `content/features.yaml` (titre, texte, état disponible/en test/à venir, capture, version d'arrivée) + données calculées (procédures du catalogue, formes) importées de `@fourmy/contracts`. | `pages/fonctionnalites.astro` |
| 3.6 | Roadmap (FS-4) : `content/roadmap.yaml`, première version tirée du README et de `docs/interventions.md` — **à valider par toi**. | `pages/roadmap.astro` |
| 3.7 | Changelog (FS-5) : lu depuis `release.json` (phase 2) à la construction. | `pages/changelog.astro` |
| 3.8 | Contact (FS-6, côté page) : formulaire accessible, pièges anti-robots (champ invisible, horodatage), message d'accusé, repli sans JavaScript. | `pages/contact.astro` |
| 3.9 | Légal (FS-7) : mentions légales (Ekylibre SAS, reprises d'ekylibre.com), données personnelles du formulaire. | — |
| 3.10 | SEO : titres, descriptions, Open Graph, sitemap, `robots.txt`, données structurées `SoftwareApplication`. | — |
| 3.11 | Tests : Playwright smoke + a11y (axe), comme ekylibre-sas ; budget Lighthouse ≥ 95. | `apps/site/tests` |

**Contrôle 3** : `pnpm --filter @fourmy/site build` produit un site
statique complet ; tests smoke/a11y verts ; « Se connecter » pointe vers
l'URL configurée.

---

## Phase 4 — Captures automatisées (FS-3, AU-6)

| # | Tâche | Détail |
|---|---|---|
| 4.1 | Script Playwright `apps/site/scripts/captures.ts` : charge les fixtures (fermes de test), démarre API + web, se connecte, capture les vues listées dans `features.yaml` (tableau de bord, carte + traces, plan 3D, interventions, formulaire par forme, cuverie dans le temps, registre phyto, équipe, intégrations). | — |
| 4.2 | Post-traitement : WebP/AVIF, tailles responsives, cadrage ; masquage des éléments identifiants restants (noms de compte). | sharp |
| 4.3 | Les images sont **versionnées** (régénérées à la main ou en CI quand l'interface change, pas à chaque commit). | `apps/site/src/assets/captures/` |
| 4.4 | Respect de 0.3 : vues carte recadrées si l'accord des pilotes n'est pas acquis. | — |

**Contrôle 4** : une commande régénère toutes les captures ; aucune n'affiche
un nom de pilote, de tenant ou une adresse e-mail réelle.

---

## Phase 5 — Contact côté API (FS-6, sécurité)

| # | Tâche | Détail |
|---|---|---|
| 5.1 | Point d'entrée public `POST /api/public/contact` (hors authentification et hors ferme) : validation stricte (Zod), tailles bornées. | apps/api |
| 5.2 | Anti-abus : champ piège, délai minimal depuis l'affichage (horodatage signé), **limite de débit par IP** (fenêtre glissante en mémoire du processus, suffisant pour un seul conteneur), réponse identique dans les cas ignorés. | — |
| 5.3 | Envoi SMTP (nodemailer, version publiée depuis ≥ 2 semaines) vers `contact@fourmy.org`, `Reply-To` = expéditeur ; aucun stockage en base ; journal sans contenu du message. | — |
| 5.4 | Configuration : `FOURMY_SMTP_HOST/PORT/USER/PASSWORD`, `FOURMY_CONTACT_TO` ; point d'entrée désactivé (503) si absente. | `.env.example`, compose |
| 5.5 | Tests : serveur SMTP factice local, pièges, limite de débit, validation, désactivation sans configuration. | vitest |

**Contrôle 5** : message reçu par le serveur SMTP factice avec le bon
`Reply-To` ; 11e envoi rapide limité ; envoi robotisé ignoré.

---

## Phase 6 — Déploiement fourmy.org (dépend de 0.1, 0.5, 3, 5)

| # | Tâche | Détail |
|---|---|---|
| 6.1 | Image `site` (Dockerfile, cible dédiée) : construction Astro avec l'historique selon la décision 0.1 ; nginx statique ; en-têtes de sécurité (CSP stricte, HSTS, nosniff) ; relais **`/api/public/` seulement** vers `api:3000` (même origine, pas de CORS ; le reste de l'API n'est pas exposé sur fourmy.org). | — |
| 6.2 | Service `site` dans `docker/compose.deploy.yml` ; variables `PUBLIC_APP_URL`. | — |
| 6.3 | Dokploy : domaines `fourmy.org` et `www.fourmy.org` (HTTPS) sur le service `site` ; redirection 301 `www` → apex. Variables SMTP générées/renseignées dans Dokploy. | API Dokploy (moi) |
| 6.4 | Vérification de bout en bout en ligne (contrôle 8). | — |

**Contrôle 6** : `https://fourmy.org` et `https://www.fourmy.org` répondent
(301 pour www) ; `/api/public/contact` accessible, `/api/v1/...` **non**
accessible via fourmy.org.

---

## Phase 7 — ekylibre.com : Ekylibre → Fourmy (EK-1 à EK-5)

Dépôt `ekylibre-sas` (Astro, GitHub Pages, publié à chaque push sur `main`).
Travail sur une **branche**, fusion et push par toi.

| # | Tâche | Détail |
|---|---|---|
| 7.1 | `products.yaml` : produit `fourmy` (nom, rôle, accroche, points, statut `en-cours`, liens fourmy.org) à la place d'`ekylibre` ; logo Fourmy (phase 1) dans `assets/brand/products/`. | — |
| 7.2 | Page `/fourmy/` + `/en/fourmy/` (composant `FourmyPage`, sur le modèle d'`EkylibrePage`) : Fourmy nouvelle génération d'Ekylibre, fonctionnalités **à venir**, ce qui reste à Lyvre, lien vers fourmy.org. Textes FR/EN dans `docs/contenus/`. | — |
| 7.3 | Redirections dans `src/data/redirects.yaml` : `/ekylibre/` → `/fourmy/`, `/en/ekylibre/` → `/en/fourmy/`. | — |
| 7.4 | Liens internes : `i18n/routes.ts`, `InfoCard`, `AiffelPage`, `SystemDiagram` (nœud et flux), menu, pied de page, JSON-LD, image Open Graph. Les **actualités** historiques gardent « Ekylibre » (articles datés). | — |
| 7.5 | Contrôles : `check:content`, `check:links`, `astro check`, tests unitaires, smoke et a11y. | — |

**Contrôle 7** : build ekylibre-sas vert ; `/ekylibre/` redirige ; aucun lien
cassé ; relecture des textes par l'équipe (question ouverte 7).

---

## Phase 8 — Recette et documentation

| # | Tâche |
|---|---|
| 8.1 | Critères d'acceptation des exigences (§5) vérifiés en ligne, dont : un commit `feat:` poussé fait monter la version et apparaître l'entrée au changelog après redéploiement ; un `docs:` ne change rien ; un nom de pilote dans un titre fait échouer la construction. |
| 8.2 | Formulaire : message reçu sur la vraie boîte `contact@fourmy.org`. |
| 8.3 | Lighthouse ≥ 95 sur les pages principales ; tests a11y verts. |
| 8.4 | Documentation : `docs/deploiement.md` (service site, domaines, SMTP), README (commandes `site`, `release`, `captures`), convention `Public:` pour les messages de commit. |
| 8.5 | CI : jobs `site` (build + tests) et `release` (génération + liste noire) ajoutés à `.github/workflows/ci.yml`. |

---

## Risques et parades

| Risque | Parade |
|---|---|
| Historique Git absent à la construction (clone superficiel, `.git` exclu) | Phase 0.1 décide avant d'écrire la phase 6 ; le moteur accepte un fichier d'historique en entrée (2.1). |
| Fuite de noms de pilotes dans le changelog ou les captures | Liste noire bloquante (2.5), corps de commit jamais publiés, contrôle des captures (4.2–4.4). |
| Spam du formulaire | Pièges + limite de débit + désactivation sans configuration (5.2, 5.4). |
| Exposition de l'API via fourmy.org | nginx du site ne relaie que `/api/public/` (6.1). |
| Bascule d'ekylibre.com prématurée | Branche dédiée, publication décidée par toi (7). |
| Captures obsolètes | Régénération en une commande (4.1), documentée. |

## Ordre d'exécution proposé pour `/sc:implement`

1. Phase 0.1 (lecture Dokploy) — et 0.2/0.3/0.4 de ton côté en parallèle.
2. Phases 1, 2 et 5 (indépendantes).
3. Phase 3, puis 4.
4. Phase 6 (après ton push et l'app en ligne).
5. Phase 7 (branche ekylibre-sas, push par toi).
6. Phase 8.
