# API ouverte et serveur MCP — note d'essai AM0

*Essai du 27/11/2026 ([`workflow_api_mcp.md`](workflow_api_mcp.md) §3, lot AM0). Le code d'essai se trouve sur la branche locale `essai/api-mcp-am0` (`apps/api/src/essai/`) et n'est pas fusionné. Il a tourné sur une base isolée, `fourmy_essai` (port 5434), migrée jusqu'en 0083.*

## 1. Résultats

| # | Question | Résultat | Décision |
|---|---|---|---|
| 1 | Les plugins better-auth en 1.7.12, avec nos tables en snake_case ? | **Oui.** Le `schema` de chaque plugin est calculé à partir de sa propre description (tables `auth_*`, colonnes en snake_case). `getMigrations` de better-auth produit le SQL : 9 tables, 120 colonnes, uuid, timestamptz, jsonb. | On garde ce calcul automatique. Le SQL généré est relu et versé dans nos migrations (0087 pour api-key, 0088 pour oauth et jwks). Il faut convertir les majuscules consécutives (`requirePKCE` donne `require_pkce`). |
| 2 | Clés d'API (`@better-auth/api-key`) ? | **Oui.** Préfixe `fmy_`, 68 caractères ; seul le haché SHA-256 est stocké, avec les 6 premiers caractères pour l'affichage. `metadata` porte la ferme. Vérification : **1,6 ms en médiane** (12,7 ms au plus, sur 30 appels). Une fausse clé ou une clé désactivée est refusée. | Il faut **couper la limite intégrée** (10 requêtes par jour par défaut, `rateLimit.enabled: false`), puisque notre compteur prend le relais (NF-2). La durée minimale vaut 1 jour par défaut, ce qui convient. Chaque clé refusée produit une ligne `ERROR` : on filtre ce journal pour ne pas noyer les vraies erreurs. On n'active pas `enableSessionForAPIKeys`, que ses auteurs déconseillent : notre middleware appelle `verifyApiKey`. |
| 3 | Serveur OAuth (`@better-auth/oauth-provider`) : enregistrement dynamique, PKCE, consentement, rafraîchissement ? | **Oui, du premier coup**, dans cet ordre : enregistrement (201), `authorize` avec PKCE et `resource`, choix de la ferme, page de consentement, code, puis jeton (JWT EdDSA d'1 h) et jeton de rafraîchissement. | Retenu. |
| 4 | Choix de la ferme pendant l'autorisation ? | **Oui, sans rien ajouter au plugin.** L'étape `postLogin` (prévue pour choisir une organisation) redirige vers `/oauth/ferme`. La ferme choisie est rangée dans la session (`auth_sessions.active_farm_id`), devient la **référence du consentement** (`consentReferenceId`) et revient dans le jeton (`customAccessTokenClaims` donne `fourmy_farm`). Le consentement et le jeton de rafraîchissement gardent cette référence. | C'est le mécanisme du point 3 de la conception (§7.1, un consentement par ferme). `farm_accesses` est relié au consentement par `(client_id, user_id, farm_id)`. |
| 5 | `@better-auth/mcp` en plus d'oauth-provider ? | **Utile.** Il lie les jetons à la ressource `/mcp` (audience), associe la ressource aux nouveaux clients et sert `/.well-known/oauth-protected-resource/mcp` **à la racine du site**, pas sous `/api/auth`. Son `requireMcpAuth`, en revanche, **va chercher les clés de signature par HTTP sur sa propre URL** : en production, l'API s'interrogerait elle-même par le réseau, et en test il n'y a pas de serveur à interroger. Sans option `resource`, il annonce de plus une mauvaise adresse de métadonnées. | On retient le plugin `mcp`, mais **pas `requireMcpAuth`**. On vérifie nous-mêmes le jeton avec `jose` (`jwtVerify` sur `createLocalJWKSet(auth.api.getJwks())`) : clés lues en base, aucun appel réseau, émetteur et audience contrôlés, et `WWW-Authenticate` produit par nous. `/.well-known/*` est routé vers better-auth. `jose` 6.2.15 devient une dépendance directe de l'API (il est déjà présent dans l'arbre). |
| 6 | SDK MCP dans Hono ? | **Oui.** `WebStandardStreamableHTTPServerTransport` (Request vers Response, sans état, réponse JSON) fonctionne dans une route Hono. Un client du SDK branché sur `app.fetch` liste les outils et les appelle. Sans jeton : 401 avec `WWW-Authenticate` et `resource_metadata`. Jeton altéré : 401. | Retenu. Un serveur MCP est créé par requête, sans état, ce qui va avec une API sans session MCP. |
| 7 | Coût d'un outil qui appelle l'API en interne (`app.request`) ? | Appel interne : **0,4 ms**. Appel d'outil complet (vérification du JWT, protocole MCP, appel interne) : **0,7 ms en médiane**, 1,2 ms au plus, sans la base. | Le principe « l'outil MCP est un client de `/api/v1` » est confirmé (conception §2, point 4). Le principal est transmis à l'appel interne par un contexte que seule l'application pose, jamais par un en-tête accepté de l'extérieur. |
| 8 | Contrôles réglementaires à blanc pour les propositions ? | **Déjà là.** `POST /phyto/check` (`checkComplianceFor` : feux, ZNT, délais), `POST /fertilization/check` (nitrates) et `POST /control/check` (HVE et AB) contrôlent une saisie sans l'enregistrer : le web s'en sert avant l'enregistrement. L'**IFT** est calculé plus tard par le worker (API du ministère), après la réalisation. | AM8 n'a rien à extraire : une proposition appelle les trois contrôles. L'IFT n'est pas connu au dépôt ; il est calculé à l'acceptation, comme aujourd'hui. On corrige la conception §8 (« phyto, ZNT, IFT » devient « phyto, ZNT, nitrates, HVE et AB »). |
| 9 | Connecteur réel d'un assistant du marché | **Pas fait.** Il faut une URL publique en HTTPS, soit un déploiement séparé de la branche d'essai, soit un tunnel. Cela attend l'accord de l'utilisateur. | À faire au plus tard en AM6, sur dev.fourmy.org (recette US-7). Tout le parcours a été rejoué localement avec le SDK et des requêtes réelles. |

## 2. Point nouveau : Client ID Metadata Documents

La version 2026-07-28 de la spécification MCP fait des **Client ID Metadata Documents** (CIMD) la voie privilégiée. Un client MCP s'y identifie par l'URL d'un document qui le décrit, au lieu de s'enregistrer dynamiquement. better-auth fournit `@better-auth/cimd`, disponible en 1.7.12, avec le profil `metadataProfile: "mcp-2026-07-28"`.

- **Décision.** AM5 active **les deux** : l'enregistrement dynamique, que l'essai a validé, et CIMD, pour les clients récents.
- **Contrainte.** CIMD fait **lire à Fourmy** une URL donnée par le client. Ce fetch sortant doit être encadré : HTTPS seulement, taille et délai limités, pas d'adresse privée. L'option `fetchClientMetadataResource` du plugin le permet.
- **Restreindre les scopes à l'enregistrement.** Un client qui demandait `fourmy:read` a reçu `fourmy:read fourmy:write` à l'enregistrement, à cause de `clientRegistrationAllowedScopes`. Le jeton, lui, ne portait que ce qui avait été demandé et consenti. On règle `clientRegistrationDefaultScopes` sur `fourmy:read` et on n'accorde à l'enregistrement que les scopes demandés.

## 3. Écarts avec la conception

| Conception | Après l'essai |
|---|---|
| §7.2 : `@better-auth/mcp` fournit l'assistant de protection, « retenu ou écarté au lot 0 ». | Le plugin est retenu (audience, métadonnées). `requireMcpAuth` est écarté au profit d'une vérification locale avec `jose`. |
| §7.1 : écran de consentement Fourmy. | Deux pages web : `/oauth/ferme` (étape `postLogin`, choix de la ferme) puis `/oauth/consentement` (modules et activités). La ferme choisie passe par `auth_sessions.active_farm_id`. |
| §8 : contrôles « phyto, ZNT, IFT » au dépôt. | Phyto, ZNT, nitrates, HVE et AB au dépôt ; IFT à l'acceptation. |
| §7.1 : enregistrement dynamique des clients. | Enregistrement dynamique **et** CIMD, avec un fetch sortant encadré. |
| Migrations 0087 et 0088 | Le SQL des plugins est généré par `getMigrations` puis relu. On y ajoute la colonne `auth_sessions.active_farm_id`. |

## 4. Suite

- AM1 peut commencer. Aucune des incertitudes ne change le découpage.
- Le connecteur réel (point 9) est à planifier avec l'utilisateur : déploiement séparé ou tunnel, au plus tard en AM6.
- La base `fourmy_essai` peut être supprimée à la fin d'AM5.
