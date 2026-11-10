import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

/**
 * Intégrations par ferme (services externes : traceurs GPS, puis stations
 * météo, sondes…). Chaque fournisseur décrit ses champs : l'interface affiche
 * le formulaire à partir de cette description, sans code propre au
 * fournisseur. Un champ `secret` est chiffré côté serveur et jamais renvoyé.
 */

export const integrationProvider = z.enum(["traccar", "openweather", "meteoblue"]);
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
export type IntegrationCategory = "weather" | "gps_equipment" | "decision_support";

export const INTEGRATION_CATEGORIES: { category: IntegrationCategory; label: string; description: string }[] = [
  { category: "weather", label: "Météo", description: "Prévisions et mesures pour la météo des interventions et les conditions de pulvérisation." },
  { category: "gps_equipment", label: "Suivi GPS – Matériels", description: "Positions et parcours des matériels." },
  { category: "decision_support", label: "OAD", description: "Outils d'aide à la décision (modèles de risque, préconisations)." },
];

export interface IntegrationProviderDefinition {
  provider: IntegrationProvider;
  category: IntegrationCategory;
  label: string;
  description: string;
  fields: IntegrationField[];
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
];

export const integrationStatus = z.enum(["pending", "ok", "error"]);

/** Intégration telle que lue (sans secret). */
export const integration = z.object({
  id: uuid,
  provider: integrationProvider,
  settings: z.record(z.string()),
  /** Un secret est enregistré ; ses 4 derniers caractères pour le reconnaître. */
  hasSecret: z.boolean(),
  secretHint: z.string().nullable(),
  enabled: z.boolean(),
  status: integrationStatus,
  running: z.boolean(),
  lastSyncAt: isoDateTime.nullable(),
  lastError: z.string().nullable(),
  lastReport: z.record(z.unknown()).nullable(),
});
export type Integration = z.infer<typeof integration>;

/** Configuration : paramètres + secret (facultatif s'il est déjà enregistré). */
export const integrationWrite = z.object({
  settings: z.record(z.string().trim().max(500)).default({}),
  secret: z.string().trim().min(8).max(500).optional(),
  enabled: z.boolean().optional(),
});
export type IntegrationWrite = z.infer<typeof integrationWrite>;
