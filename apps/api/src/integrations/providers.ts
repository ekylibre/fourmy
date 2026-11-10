import { TraccarClient, matchDevices, syncTraccar } from "@fourmy/connector-traccar";
import type { IntegrationProvider } from "@fourmy/contracts";
import { meteoblueTest, openWeatherTest, SencropClient, WeenatClient, type StationClient } from "@fourmy/weather";
import { db } from "../db.js";
import { syncStations } from "../repos/weather-stations.js";
import { BadRequest } from "../routes/helpers.js";

/**
 * Adaptateurs des fournisseurs d'intégration. Chacun sait tester une
 * configuration (avant de l'enregistrer) et synchroniser une ferme. Ajouter un
 * fournisseur : sa définition dans @fourmy/contracts (INTEGRATION_PROVIDERS),
 * son adaptateur ici, sa valeur dans la contrainte SQL `integrations.provider`.
 */

export interface ProviderContext {
  farmId: string;
  settings: Record<string, string>;
  secret: string;
  /** Matériels de la ferme (rattachement des boîtiers). */
  equipments: { id: string; name: string }[];
}

export interface ProviderAdapter {
  /** Vérifie l'accès et décrit ce qui sera synchronisé. Lève une erreur lisible sinon. */
  test(ctx: ProviderContext): Promise<Record<string, unknown>>;
  /** Synchronise ; renvoie un rapport court (stocké, affiché). */
  sync(ctx: ProviderContext, targetUrl: string): Promise<Record<string, unknown>>;
}

const isLocalDev = () => {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(process.env.DATABASE_URL ?? "").hostname);
  } catch {
    return false;
  }
};

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

/**
 * Adresse d'un service externe saisie par l'utilisateur et appelée par le
 * serveur : HTTPS, et jamais une adresse locale ou privée (sinon un
 * responsable de ferme ferait interroger les services internes du serveur).
 * En développement local, http et localhost restent permis.
 */
export function externalUrl(raw: string | undefined, label: string): string {
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new BadRequest(`${label} : adresse invalide.`);
  }
  if (isLocalDev()) return url.toString().replace(/\/+$/, "");
  if (url.protocol !== "https:") throw new BadRequest(`${label} : adresse en https:// attendue.`);
  if (PRIVATE_HOST.test(url.hostname) || url.username || url.password) {
    throw new BadRequest(`${label} : adresse publique attendue.`);
  }
  return url.toString().replace(/\/+$/, "");
}

const traccar: ProviderAdapter = {
  async test({ settings, secret, equipments }) {
    const client = new TraccarClient(externalUrl(settings.url, "Serveur Traccar"), { token: secret });
    const devices = await client.devices();
    const { matched, unmatched } = matchDevices(devices, equipments);
    return {
      devices: devices.length,
      matched: matched.map((m) => ({ device: m.device.name, equipment: m.equipment.name })),
      unmatched: unmatched.map((u) => ({ device: u.device.name, reason: u.reason })),
    };
  },
  async sync({ farmId, settings, secret }, targetUrl) {
    const report = await syncTraccar({
      targetUrl,
      farmId,
      client: new TraccarClient(externalUrl(settings.url, "Serveur Traccar"), { token: secret }),
      // Un boîtier jamais synchronisé reprend 90 jours d'historique.
      since: new Date(Date.now() - 90 * 86_400_000),
    });
    return {
      inserted: report.inserted,
      updated: report.updated,
      devices: report.devices.map((d) => ({ device: d.name, inserted: d.inserted, updated: d.updated })),
      unmatched: report.unmatched.map((u) => ({ device: u.name, reason: u.reason })),
    };
  },
};

// Fournisseurs météo : la clé est testée au centre de la France (elle ne
// dépend pas du lieu) ; pas de synchronisation périodique, la météo est
// demandée à la saisie et pour le widget (repos/weather.ts).
const FRANCE = { lat: 46.6, lon: 2.4 };
const openweather: ProviderAdapter = {
  async test({ secret }) {
    return openWeatherTest(secret, FRANCE.lat, FRANCE.lon);
  },
  async sync() {
    return {};
  },
};
const meteoblue: ProviderAdapter = {
  async test({ secret }) {
    return meteoblueTest(secret, FRANCE.lat, FRANCE.lon);
  },
  async sync() {
    return {};
  },
};

// Stations météo (lot W) : le test liste les stations du compte ; la synchro
// recopie stations et mesures horaires (repos/weather-stations.ts).
function stationsAdapter(provider: "weenat" | "sencrop", client: (settings: Record<string, string>, secret: string) => StationClient): ProviderAdapter {
  return {
    async test({ settings, secret }) {
      const stations = await client(settings, secret).stations();
      return {
        stations: stations.length,
        names: stations.map((s) => s.name),
        withoutLocation: stations.filter((s) => s.lat === null || s.lon === null).map((s) => s.name),
      };
    },
    async sync({ farmId, settings, secret }) {
      const report = await syncStations(db(), farmId, provider, client(settings, secret));
      return { measures: report.measures, stations: report.stations.map((s) => ({ station: s.name, inserted: s.inserted })) };
    },
  };
}
const required = (v: string | undefined, label: string) => {
  if (!v?.trim()) throw new BadRequest(`${label} manquant.`);
  return v.trim();
};
const weenat = stationsAdapter("weenat", (settings, secret) => new WeenatClient(required(settings.email, "E-mail Weenat"), secret));
const sencrop = stationsAdapter("sencrop", (settings, secret) => new SencropClient(required(settings.applicationId, "Identifiant d'application Sencrop"), secret));

export const PROVIDERS: Record<IntegrationProvider, ProviderAdapter> = { traccar, openweather, meteoblue, weenat, sencrop };
