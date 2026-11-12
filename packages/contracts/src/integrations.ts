import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

/**
 * Intégrations par ferme (services externes : traceurs GPS, puis stations
 * météo, sondes…). Chaque fournisseur décrit ses champs : l'interface affiche
 * le formulaire à partir de cette description, sans code propre au
 * fournisseur. Un champ `secret` est chiffré côté serveur et jamais renvoyé.
 */

export const integrationProvider = z.enum(["traccar", "openweather", "meteoblue", "weenat", "sencrop", "copernicus", "agrirouter"]);
export type IntegrationProvider = z.infer<typeof integrationProvider>;

export interface IntegrationField {
  key: string;
  label: string;
  kind: "url" | "text" | "secret";
  required: boolean;
  placeholder?: string;
  help?: string;
}

/** Thème d'une intégration : regroupe les fournisseurs à l'écran. */
export type IntegrationCategory = "weather" | "gps_equipment" | "remote_sensing" | "machine_data" | "decision_support";

export const INTEGRATION_CATEGORIES: { category: IntegrationCategory; label: string; description: string }[] = [
  { category: "weather", label: "Météo", description: "Prévisions et mesures pour la météo des interventions et les conditions de pulvérisation." },
  { category: "gps_equipment", label: "Suivi GPS – Matériels", description: "Positions et parcours des matériels." },
  { category: "remote_sensing", label: "Télédétection", description: "Images satellite et indices de végétation des parcelles." },
  {
    category: "machine_data",
    label: "Échanges avec les machines",
    description: "Envoi des cartes de modulation aux consoles des tracteurs (ISOBUS), sans clé USB.",
  },
  { category: "decision_support", label: "OAD", description: "Outils d'aide à la décision (modèles de risque, préconisations)." },
];

export interface IntegrationProviderDefinition {
  provider: IntegrationProvider;
  category: IntegrationCategory;
  label: string;
  description: string;
  fields: IntegrationField[];
  /**
   * Connexion par consentement OAuth (bouton « Connecter ») au lieu d'un
   * formulaire : les identifiants de l'application sont ceux du serveur.
   */
  connect?: "oauth";
  /** Fournisseur utilisable sur ce serveur (connexion OAuth : application configurée). Renseigné par GET /integrations. */
  available?: boolean;
}

export const INTEGRATION_PROVIDERS: IntegrationProviderDefinition[] = [
  {
    provider: "traccar",
    category: "gps_equipment",
    label: "Traccar — traceurs GPS",
    description:
      "Positions des boîtiers GPS des matériels (travail au champ, transport). Chaque boîtier est rattaché au matériel de même nom.",
    fields: [
      { key: "url", label: "Adresse du serveur Traccar", kind: "url", required: true, placeholder: "https://traccar.exemple.fr" },
      {
        key: "token",
        label: "Jeton d'accès",
        kind: "secret",
        required: true,
        help: "Créé dans Traccar : Paramètres → Préférences → Jeton. Lecture seule suffit.",
      },
    ],
  },
  {
    provider: "openweather",
    category: "weather",
    label: "OpenWeather — météo",
    description:
      "Prévisions à 5 jours pour la météo des interventions et les conditions de pulvérisation. Sans intégration météo, Open-Meteo (gratuit, sans clé) est utilisé ; l'historique vient toujours d'Open-Meteo.",
    fields: [
      {
        key: "apiKey",
        label: "Clé d'API",
        kind: "secret",
        required: true,
        help: "Sur openweathermap.org : My API keys. Une clé gratuite suffit.",
      },
    ],
  },
  {
    provider: "meteoblue",
    category: "weather",
    label: "meteoblue — météo agricole",
    description:
      "Prévisions horaires du paquet agro de meteoblue pour la météo des interventions et les conditions de pulvérisation. Prioritaire sur OpenWeather et Open-Meteo quand il est actif.",
    fields: [
      {
        key: "apiKey",
        label: "Clé d'API",
        kind: "secret",
        required: true,
        help: "Sur my.meteoblue.com : clé donnant accès au paquet basic-1h_agro-1h.",
      },
    ],
  },
  {
    provider: "weenat",
    category: "weather",
    label: "Weenat — stations météo",
    description:
      "Mesures horaires de vos stations Weenat (pluie, température, humidité, vent). La météo d'une intervention passée prend d'abord la station la plus proche des parcelles (moins de 5 km). Synchronisation toutes les heures ; 30 jours d'historique à la première.",
    fields: [
      { key: "email", label: "E-mail du compte Weenat", kind: "text", required: true, placeholder: "vous@exemple.fr" },
      { key: "password", label: "Mot de passe Weenat", kind: "secret", required: true, help: "Celui de l'application Weenat (app.weenat.com)." },
    ],
  },
  {
    provider: "sencrop",
    category: "weather",
    label: "Sencrop — stations météo",
    description:
      "Mesures horaires de vos stations Sencrop (pluie, température, humidité, vent, humectation). La météo d'une intervention passée prend d'abord la station la plus proche des parcelles (moins de 5 km). Synchronisation toutes les heures ; 30 jours d'historique à la première.",
    fields: [
      { key: "applicationId", label: "Identifiant d'application", kind: "text", required: true },
      {
        key: "applicationSecret",
        label: "Secret d'application",
        kind: "secret",
        required: true,
        help: "Créés dans votre compte Sencrop (accès API / applications).",
      },
    ],
  },
  {
    provider: "copernicus",
    category: "remote_sensing",
    label: "Copernicus — images Sentinel-2",
    description:
      "Indices de végétation (NDVI, NDRE, NDMI) de chaque parcelle à chaque passage du satellite, et images de la ferme pour la carte et le plan 3D. Compte gratuit du Copernicus Data Space Ecosystem. À l'activation, l'historique remonte au 1er janvier de l'année précédente ; ensuite, vérification toutes les 6 heures.",
    fields: [
      {
        key: "clientId",
        label: "Identifiant client OAuth",
        kind: "text",
        required: true,
        placeholder: "sh-…",
        help: "Sur shapps.dataspace.copernicus.eu/dashboard : User settings, OAuth clients, Create. Ne pas cocher « SPA ».",
      },
      { key: "clientSecret", label: "Secret client OAuth", kind: "secret", required: true, help: "Affiché une seule fois à la création du client." },
      {
        key: "monthlyRequests",
        label: "Budget mensuel de requêtes",
        kind: "text",
        required: false,
        placeholder: "3000",
        help: "Plafond de requêtes par mois pour cette ferme (le compte gratuit en permet 10 000). Vide : 3 000.",
      },
    ],
  },
  {
    provider: "agrirouter",
    category: "machine_data",
    label: "agrirouter — échanges avec les machines",
    description:
      "Plateforme neutre d'échange de données entre logiciels et machines agricoles (DKE-Data). Fourmy y envoie les cartes de modulation (ISO-XML ou Shapefile) aux consoles des tracteurs reliées au compte agrirouter de la ferme. La connexion se fait par votre compte agrirouter ; Fourmy ne connaît pas votre mot de passe.",
    fields: [],
    connect: "oauth",
  },
];

export const integrationStatus = z.enum(["pending", "ok", "error"]);

/** Intégration telle que lue (sans secret). */
export const integration = z.object({
  id: uuid,
  provider: integrationProvider,
  settings: z.record(z.string(), z.string()),
  /** Un secret est enregistré ; ses 4 derniers caractères pour le reconnaître. */
  hasSecret: z.boolean(),
  secretHint: z.string().nullable(),
  enabled: z.boolean(),
  status: integrationStatus,
  running: z.boolean(),
  lastSyncAt: isoDateTime.nullable(),
  lastError: z.string().nullable(),
  lastReport: z.record(z.string(), z.unknown()).nullable(),
});
export type Integration = z.infer<typeof integration>;

/** Configuration : paramètres + secret (facultatif s'il est déjà enregistré). */
export const integrationWrite = z.object({
  settings: z.record(z.string(), z.string().trim().max(500)).default({}),
  secret: z.string().trim().min(8).max(500).optional(),
  enabled: z.boolean().optional(),
});
export type IntegrationWrite = z.infer<typeof integrationWrite>;
