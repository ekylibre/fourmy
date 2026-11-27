# API ouverte et serveur MCP — expression des besoins

*Brainstorm du 27/11/2026. Étapes suivantes : `/sc:design` (conception), puis `/sc:workflow` (plan).*
*Exigences d'origine : FR-API-1 (API publique documentée), FR-API-2 (serveur MCP), US-7 (Aiffel), point ouvert 60.*

## 1. Contexte

Demande : **une API et un serveur MCP** sur Fourmy. Pour chaque accès, on paramètre **par module** la lecture ou l'écriture. Pour les interventions, on ajoute un **scope sur les activités**.

### Dans Fourmy aujourd'hui

- **API REST `/api/v1`** (Hono). Elle ne sert que le web et le mobile Fourmy, et n'a pas de documentation publique (issue #35 « Documentation OpenAPI »).
- **Authentification** par better-auth : sessions du web, plus le plugin `bearer` signé, utilisé par le mobile. Il n'y a ni clé d'API ni OAuth pour des tiers.
- **Droits** par ferme (`memberships.role`) :
  - `owner` a tous les droits ;
  - `reader` ne fait que lire, sauf sur son propre profil.

  Les droits s'appliquent dans `context.ts` (méthode HTTP) et dans `requireOwner`. Rien ne descend au niveau d'un module ou d'une activité.
- **Pas de serveur MCP.** L'architecture prévoit une route `/mcp` (Streamable HTTP, SDK TypeScript officiel) adossée aux mêmes services de domaine et aux mêmes permissions que l'API (`docs/architecture.md`).
- **Lien entre intervention et activité.** Il est indirect :
  - une intervention a des cibles (`intervention_parameters`, rôle `target`), qui sont des productions ou des parcelles ;
  - une production porte `activity_id`.

  Une intervention peut donc concerner **plusieurs activités**, par exemple un passage de pulvé sur blé et orge. Elle peut aussi n'en concerner **aucune** : entretien de matériel, travail de cour, intervention sans cible.
- **Origine des écritures** : `interventions.origin` existe déjà (`import`, agrirouter…).

### Modules de l'API actuelle (base du découpage)

| Module proposé | Routes actuelles |
|---|---|
| Ferme | `farm`, `farm-profile` |
| Parcellaire | `parcels`, `ign`, `plan3d`, `remote-sensing` |
| Activités et assolement | `activities`, `crop-plans`, `crop-model`, `technical-itineraries`, `itk-work`, `planned-interventions` |
| Interventions | `interventions`, `procedures`, `prescriptions`, `tracks` |
| Phytosanitaire et registres | `phyto`, `registers` |
| Fertilisation | `fertilization`, `fertilizers` |
| Stocks et semences | `articles`, `inventory`, `seeds` |
| Matériels | `equipments`, `maintenance` |
| Personnes et équipes | `people`, `crew-templates` |
| Économique | `prices` |
| Certifications | `certifications`, `certification-controls` |
| *Jamais ouverts aux accès externes* | `members`, `invitations`, `integrations`, `agrirouter`, `imports`, `sync`, `me` |

## 2. Décisions prises pendant le brainstorm

| # | Décision |
|---|---|
| B1 | **Quatre familles de clients** : les assistants IA de l'exploitant (Claude, ChatGPT…), Aiffel et les services de l'offre commune, les tiers à qui l'exploitant ouvre un accès limité (conseiller, technicien de coopérative), les scripts et intégrateurs. |
| B2 | **Deux façons d'obtenir un accès** : une **clé d'API** créée par l'exploitant dans Fourmy (scripts, serveurs), et **OAuth avec écran de consentement Fourmy** (assistants IA, connecteurs MCP distants). Les deux portent les mêmes droits. |
| B3 | **Le scope « activités » couvre tout ce qui en dépend**, pas seulement les interventions : productions, parcelles cultivées par ces activités, assolement, ITK, registres, marges. Exemple : un conseiller vigne ne voit pas les céréales. |
| B4 | **La lecture d'abord.** Lot 1 : lecture sur tous les modules ouverts. Lot 2 : écriture, en commençant par les interventions (traitement, semis…) et ce qu'elles alimentent (registre). |
| B5 | **Intervention mixte** (Q1) : un accès limité à certaines activités la voit **réduite à ses cibles du scope**, avec les quantités d'intrants au prorata des surfaces visibles et la mention « intervention partagée avec d'autres cultures ». |
| B6 | **Écriture externe proposée à validation** (Q3) : ce qu'un accès externe écrit arrive en **proposition**, que l'exploitant accepte, corrige ou refuse dans Fourmy, comme les TaskData agrirouter. Rien n'est enregistré dans la ferme, ni dans le registre ni dans les stocks, avant validation. |
| B7 | **Un tiers a son propre compte Fourmy invité** (Q5) : l'exploitant invite le conseiller avec des droits restreints (modules × niveau × activités). Le conseiller se connecte ensuite à Fourmy, ou à son outil par OAuth, avec son compte. Il n'y a pas de clé à faire circuler, et le journal est nominatif. |
| B8 | **Un seul modèle de droits, à terme pour tous les membres** (Q8) : `owner` et `reader` deviendront deux profils prédéfinis du modèle modules × niveau × activités, dont le membre restreint (B7) est le premier cas sur mesure. La conception doit le permettre dès ce chantier ; la bascule des rôles existants se tranche avec l'issue #36. |
| B9 | **Seul un responsable accepte une proposition** (Q9). Un salarié la voit mais ne peut pas la valider. |
| B10 | **Pas d'accès « de confiance »** (Q10) : dans ce chantier, toute écriture externe passe par la validation, y compris celles d'Aiffel ou d'un script de l'exploitant. |

## 3. Objectifs

1. **Ouvrir Fourmy** aux outils de l'exploitant et de ses partenaires, sans partager son mot de passe ni lui donner plus de droits que nécessaire.
2. **Un seul modèle de droits** pour l'API REST et le serveur MCP : modules × (aucun, lecture, écriture) × activités.
3. **Brancher un assistant IA en quelques clics** : l'exploitant ajoute Fourmy comme connecteur dans son assistant, consent, et peut demander « qu'est-ce qui a été traité sur la parcelle X cette semaine ? » (US-7).
4. **Garder la main** : l'exploitant voit qui accède à quoi, ce qui a été lu ou écrit, et révoque en un clic.

## 4. Utilisateurs et récits

**R1 — Assistant IA de l'exploitant.**
Je branche Fourmy sur mon assistant. Fourmy me montre un écran de consentement, prérempli à partir de ce que l'assistant demande, où je choisis la ferme, les modules, la lecture ou l'écriture et les activités. Ensuite je demande à mon assistant :
- les traitements de la semaine ;
- l'état de mes stocks d'engrais ;
- les parcelles sans culture prévue en 2027.

*Accepté si* l'assistant ne voit rien hors des modules et activités consentis, et si une demande d'écriture est refusée tant que je n'ai donné que la lecture.

**R2 — Conseiller viticole.**
Mon client m'invite sur sa ferme avec un accès « Vigne », en lecture sur les interventions, le phyto et le parcellaire. J'ai mon propre compte Fourmy (B7). Je lis ses traitements et ses parcelles de vigne dans Fourmy, ou depuis mon propre outil connecté par OAuth avec ce compte.

*Accepté si* :
- aucune parcelle, production ou intervention de céréales n'apparaît, ni dans les listes, ni par identifiant direct, ni dans les totaux et registres ;
- une intervention mixte (vigne et autre culture) n'apparaît qu'avec ses cibles de vigne, ses quantités au prorata et la mention « partagée » (B5) ;
- si l'exploitant me retire de la ferme, mon outil perd aussitôt l'accès.

**R3 — Aiffel et les services de l'offre commune.**
Aiffel interroge la ferme par MCP au nom de l'exploitant, avec les droits que celui-ci a consentis.

*Accepté si* chaque appel est rattaché à la ferme, au client et à l'utilisateur qui a consenti.

**R4 — Script d'un intégrateur.**
L'exploitant crée une clé « Export compta » : lecture sur Stocks et Économique, toutes activités. Le script appelle l'API REST documentée (OpenAPI).

*Accepté si* :
- la clé n'est montrée qu'une fois ;
- elle peut avoir une date d'expiration ;
- un appel hors des droits renvoie 403 avec un message clair.

**R5 — Saisie d'un traitement par un assistant (lot 2).**
Je dicte à mon assistant : « traitement fongicide sur les vignes du haut, 2 L/ha de X, ce matin ». L'intervention arrive en **proposition** dans Fourmy (B6). Je la retrouve dans une liste « À valider », je la corrige si besoin, puis je l'accepte.

*Accepté si* :
- l'assistant reçoit tout de suite le résultat des **mêmes contrôles qu'à l'écran** (phyto, ZNT, feux, IFT), sans que rien ne soit encore enregistré ;
- la proposition porte l'origine du client ;
- elle n'entre dans le registre et les stocks qu'une fois acceptée.

**R6 — Gestion des accès.**
Une page « Accès externes » de la ferme liste les clés et les applications connectées, chacune avec :
- ses droits ;
- sa dernière utilisation ;
- son auteur.

On peut y révoquer un accès, ou modifier ses droits (pour une clé).

## 5. Exigences fonctionnelles

### Accès et droits

- **API-1 (M)** Un **accès externe** porte une ferme et un nom. Il est soit une clé d'API, soit une autorisation OAuth donnée à une application. Il a une date d'expiration facultative et peut être révoqué.
- **API-2 (M)** Pour chaque module du §1, l'accès a un niveau : **aucun**, **lecture** ou **écriture**. L'écriture inclut la lecture.
- **API-3 (M)** Un **scope d'activités**, au choix :
  - « toutes les activités », y compris celles créées plus tard ;
  - une liste d'activités de la ferme.
- **API-4 (M)** Les droits d'un accès ne dépassent **jamais** ceux de l'utilisateur qui l'a créé ou consenti. Si cet utilisateur perd son rôle ou quitte la ferme, ses accès sont suspendus.
- **API-5 (M)** Seul un responsable (`owner`) crée des accès en écriture. Un salarié `reader` ne peut consentir qu'en lecture (Q4).
- **API-5a (M)** **Membre restreint** (B7) : une invitation peut porter des droits restreints, avec le même modèle modules × niveau × activités. Le membre invité voit Fourmy, à l'écran comme par l'API, réduit à ces droits. Ses propres accès OAuth héritent de ce plafond.
- **API-5b (M)** Le responsable modifie à tout moment les droits d'un membre restreint, ou le retire. Ses accès OAuth suivent immédiatement.
- **API-6 (M)** Les modules « jamais ouverts » (§1) ne sont accessibles par aucun accès externe : membres, invitations, intégrations, imports, synchronisation mobile.

### Scope d'activités (B3)

- **API-7 (M)** Avec un scope restreint, un objet n'est visible que s'il se rattache à au moins une activité du scope :
  - une production, par son activité ;
  - une parcelle, si elle porte une production d'une activité du scope **sur la campagne consultée** ;
  - une intervention, par ses cibles, qu'elles soient des productions ou des parcelles résolues à la date de l'intervention ;
  - une intervention prévue ou un ITK, par son activité ;
  - les lignes de registre et les marges, par leur production.
- **API-8 (M)** Une intervention **sans activité** (entretien de matériel, travail sans cible) est invisible avec un scope restreint (Q2).
- **API-9 (M)** Les données qui ne se rattachent à aucune activité restent régies par le seul niveau du module : stocks, matériels, personnes, prix.
- **API-10 (M)** Agrégats et totaux (surfaces, IFT, marges, récapitulatif d'assolement) : ils sont calculés **sur le périmètre visible seulement**, pour ne rien laisser deviner hors scope.
- **API-11 (M)** Un objet hors scope demandé par son identifiant répond **404**, et non 403, pour ne pas confirmer son existence.

### API REST

- **API-12 (M)** Les accès externes utilisent l'API `/api/v1` existante, avec les mêmes routes et les mêmes contrats que le web, filtrée par les droits de l'accès. Il n'y a pas de seconde API parallèle.
- **API-13 (M)** La documentation est en **OpenAPI**, générée depuis `packages/contracts` et publiée (issue #35). Chaque opération y indique le module et le niveau qu'elle exige.
- **API-14 (S)** La version est garantie (`/api/v1`). Un changement incompatible passe par une nouvelle version ou une période de dépréciation annoncée.

### Serveur MCP

- **API-15 (M)** La route `/mcp` (Streamable HTTP) sert un serveur MCP authentifié par OAuth ou par clé, sur les mêmes droits que l'API.
- **API-16 (M)** Le serveur expose des **outils métier**, pas un miroir des routes : chercher une parcelle, lister les interventions d'une période, l'état d'un stock, le registre phyto d'une campagne, l'assolement d'une campagne, la météo d'une parcelle…
  - Il ne propose que les outils permis par l'accès.
  - Les outils d'écriture sont absents d'un accès en lecture seule.
- **API-17 (M)** Les réponses des outils sont **en français**, et leurs unités sont explicites (ha, L/ha, kg). Elles restent dans une taille raisonnable pour un assistant : pagination et résumés.
- **API-18 (S)** Les **outils d'écriture (lot 2)** décrivent leurs effets et renvoient l'avertissement réglementaire éventuel (feu orange ou rouge du contrôle phyto) au lieu de le contourner.

### OAuth et consentement

- **API-19 (M)** Fourmy est serveur d'autorisation OAuth 2.1, compatible avec les connecteurs MCP distants des assistants du marché : PKCE, découverte des métadonnées, enregistrement dynamique des clients.
- **API-20 (M)** L'écran de consentement Fourmy montre l'application, la ferme, et les modules et activités demandés. L'exploitant peut **réduire** ces droits avant d'accepter.
- **API-21 (S)** Aiffel et les services de l'offre commune sont des clients déclarés d'avance (SSO commun, FR-ACC-2). Pour eux, le consentement reste explicite.

### Écriture (lot 2)

- **API-22 (M)** Une écriture externe crée une **proposition**, pas un enregistrement (B6). Elle est contrôlée tout de suite par les **mêmes services de domaine** que l'écran (validations, contrôle phyto, IFT), et le client reçoit ce résultat.
- **API-23 (M)** Une proposition porte son origine (`api` ou `mcp`), l'accès et l'utilisateur qui l'ont faite, et le message du client. Elle apparaît dans une liste « À valider » de la ferme, signalée dans la navigation.
- **API-23a (M)** Un responsable (B9) accepte, corrige puis accepte, ou refuse une proposition. Seule l'acceptation écrit dans la ferme : intervention, registre, mouvements de stock. Les contrôles sont refaits à ce moment-là.
- **API-23b (M)** Le client peut relire l'état de ses propositions (en attente, acceptée, corrigée, refusée), par l'API et par un outil MCP.
- **API-23c (S)** Les propositions refusées ou laissées sans suite sont gardées 90 jours, puis effacées.
- **API-24 (M)** Avec un scope restreint, une proposition ne peut cibler que des productions ou des parcelles du scope.
- **API-25 (S)** Ordre de mise en service : interventions (réalisées et prévues), puis stocks (entrées), puis le reste.

### Traçabilité et gestion

- **API-26 (M)** La page « Accès externes » de la ferme liste chaque accès avec son type, ses droits, son auteur, sa création, sa dernière utilisation et son expiration. On peut y révoquer un accès, et modifier les droits d'une clé.
- **API-27 (M)** Un **journal** garde chaque appel externe pendant 90 jours (Q6) : accès, outil ou route, lecture ou écriture, objets écrits. L'exploitant peut le consulter.
- **API-28 (S)** Un e-mail à l'exploitant à la création d'un accès en écriture et à la première connexion d'une nouvelle application.

## 6. Exigences non fonctionnelles

- **NF-1 Sécurité.**
  - Les clés sont stockées hachées.
  - Les jetons OAuth sont courts, avec rafraîchissement.
  - Les droits sont vérifiés côté serveur sur chaque appel, y compris pour les listes, les totaux et les objets imbriqués.
  - Le cloisonnement par ferme (`withFarm`, RLS) reste la première barrière.
- **NF-2 Limitation de débit** par accès : quotas par minute et par jour, et 429 avec `Retry-After`.
- **NF-3 Performance.** Le filtrage par activité ne doit pas dégrader le web : une liste d'interventions filtrée reste sous 300 ms pour une ferme de 200 parcelles.
- **NF-4 Auto-hébergement.** Tout fonctionne sans service externe : OAuth, MCP et clés sont portés par l'API Fourmy elle-même (FR-ACC-1).
- **NF-5 Tests.** Chaque module a un test qui prouve qu'un accès hors scope ne voit rien, ni en liste, ni par identifiant, ni dans les totaux. Le cas de référence est l'intervention mixte.
- **NF-6 Documentation.** Une page « Connecter un assistant » pour l'exploitant, et la référence OpenAPI et MCP pour les développeurs.

## 7. Hors périmètre

- Webhooks et notifications poussées aux clients (à envisager plus tard).
- Un catalogue public d'applications tierces.
- La facturation de l'API.
- L'accès externe aux imports, aux intégrations et à agrirouter.
- La synchronisation Lyvre (FR-API-3, chantier distinct, qui pourra s'appuyer sur ces accès).

## 8. Questions tranchées

Toutes les questions du brainstorm sont tranchées le 27/11/2026 : Q1, Q3, Q5, Q8, Q9 et Q10 donnent B5 à B10 (§2). Les autres reprennent la proposition faite :

| # | Question | Décision |
|---|---|---|
| Q2 | Interventions sans activité (entretien, travaux de cour) avec un scope restreint | Invisibles (API-8). Il faut « toutes les activités » pour les voir. |
| Q4 | Un salarié (`reader`) branche son propre assistant sur la ferme | Oui, en lecture seulement, visible et révocable par le responsable. |
| Q6 | Conservation du journal des appels | 90 jours. |
| Q7 | Découpage en modules | Le tableau du §1, tel quel. |
