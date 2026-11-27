# Accès externes : clés d'API et applications

*Lots AM4 et AM5 ([conception](../claudedocs/conception_api_mcp.md)). Pour l'exploitant et pour qui branche un logiciel sur Fourmy.*

Un logiciel peut lire les données d'une ferme sans le mot de passe de personne, de deux façons :

- **une clé d'API**, créée dans Fourmy et collée dans le logiciel (un script, un export comptable) ;
- **une application** qui s'autorise elle-même (OAuth) : un assistant IA, un service connecté, l'outil d'un conseiller. L'utilisateur se connecte à Fourmy, choisit la ferme, puis ce que l'application verra.

Dans les deux cas :

- l'accès n'ouvre que **les modules et les activités choisis**, jamais plus que les droits de la personne qui l'a créé ou autorisé, recalculés à chaque appel ;
- il ne peut **rien modifier** pour l'instant (les propositions à valider viendront plus tard) ;
- il est **journalisé** (90 jours) et limité à 120 appels par minute et 10 000 par jour ;
- il se **révoque** dans *Ma ferme → Accès externes*, avec effet immédiat.

## Clés d'API

*Ma ferme → Accès externes → Créer une clé* : un nom, une durée (1 mois, 3 mois, 1 an ou sans expiration) et les droits. La clé (`fmy_…`) n'est affichée qu'une fois.

```http
GET /api/v1/farms/{farmId}/interventions?campaign=2026
x-api-key: fmy_…
```

`Authorization: Bearer fmy_…` est accepté aussi. Une clé n'ouvre que sa ferme.

## Applications (OAuth 2.1)

Fourmy est un serveur d'autorisation OAuth 2.1 : code d'autorisation avec **PKCE obligatoire**, jetons d'accès d'une heure, jetons de rafraîchissement.

| Point | Adresse |
|---|---|
| Métadonnées du serveur | `/.well-known/oauth-authorization-server/api/auth` |
| Métadonnées de la ressource MCP | `/.well-known/oauth-protected-resource/mcp` |
| Enregistrement dynamique | `POST /api/auth/oauth2/register` |
| Autorisation | `/api/auth/oauth2/authorize` |
| Jeton | `POST /api/auth/oauth2/token` |

- **Scopes** : `fourmy:read` (lecture), `fourmy:write` (réservé aux propositions, plus tard), et `offline_access` pour le rafraîchissement. Le détail (ferme, modules, activités) ne passe pas par les scopes : l'utilisateur le choisit à l'écran de consentement.
- **Ressource** (RFC 8707) : l'application **doit** demander `resource=https://<fourmy>/api/v1` (API REST) ou `https://<fourmy>/mcp` (serveur MCP). Le jeton est alors un JWT lié à cette ressource ; sans ressource, le jeton n'est pas accepté.
- **Identification du client** : enregistrement dynamique, ou *Client ID Metadata Document* (l'identifiant est l'URL HTTPS d'un document qui décrit l'application, profil MCP 2026-07-28).
- **Une ferme par consentement.** Pour une autre ferme, l'application relance une autorisation et l'utilisateur choisit l'autre ferme ; le même jeton sert ensuite pour toutes les fermes consenties.

```http
GET /api/v1/farms/{farmId}/activities
Authorization: Bearer eyJ…
```

Le jeton porte la ferme choisie dans la revendication `fourmy_farm`.

### Écran de consentement

1. Connexion à Fourmy si besoin.
2. **Ferme** : celle que l'application pourra consulter (choisie d'office s'il n'y en a qu'une).
3. **Consentement** : l'application, la ferme, les modules et les activités ouverts, puis *Autoriser* ou *Refuser*.

À la première connexion d'une application à une ferme, ses responsables reçoivent un e-mail. L'application apparaît dans *Accès externes* avec la mention « Application » ; la retirer efface son consentement et ses jetons.

### Applications déclarées d'avance

Les services maison (Aiffel, offre commune) sont déclarés par l'hébergeur, dans la variable `FOURMY_OAUTH_CLIENTS` de l'API :

```json
[{ "clientId": "aiffel", "name": "Aiffel", "redirectUris": ["https://aiffel.example/oauth/callback"], "clientSecret": "…32 caractères au moins…" }]
```

Sans `clientSecret`, l'application est un client public (PKCE seul). Elles passent par le même écran de consentement que les autres.
