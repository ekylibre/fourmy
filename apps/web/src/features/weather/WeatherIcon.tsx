import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudMoonRain, CloudSnow, CloudSun, CloudSunRain, Cloudy, Moon, Sun, type LucideIcon } from "lucide-react";

/**
 * Icônes météo de Fourmy, sur la liste de codes d'OpenWeather
 * (https://openweathermap.org/weather-conditions#Icon-list) : les trois
 * fournisseurs (Open-Meteo, OpenWeather, meteoblue) y sont ramenés par le
 * serveur. Dessin local (lucide), sans image chargée chez un tiers.
 */
const ICONS: Record<string, { day: LucideIcon; night: LucideIcon; label: string; color: string }> = {
  "01": { day: Sun, night: Moon, label: "Ensoleillé", color: "#E8B500" },
  "02": { day: CloudSun, night: CloudMoon, label: "Peu nuageux", color: "#C9A227" },
  "03": { day: Cloud, night: Cloud, label: "Nuageux", color: "#7C8B95" },
  "04": { day: Cloudy, night: Cloudy, label: "Couvert", color: "#5F6B73" },
  "09": { day: CloudDrizzle, night: CloudDrizzle, label: "Averses", color: "#2B7BB9" },
  "10": { day: CloudSunRain, night: CloudMoonRain, label: "Pluie", color: "#2B7BB9" },
  "11": { day: CloudLightning, night: CloudLightning, label: "Orage", color: "#6B4FA0" },
  "13": { day: CloudSnow, night: CloudSnow, label: "Neige", color: "#5BA4CF" },
  "50": { day: CloudFog, night: CloudFog, label: "Brouillard", color: "#8A949B" },
};

export function weatherLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const e = ICONS[code.slice(0, 2)];
  if (!e) return null;
  return code === "01n" ? "Nuit claire" : e.label;
}

export function WeatherIcon({ code, size = 24 }: { code: string | null | undefined; size?: number }) {
  const e = code ? ICONS[code.slice(0, 2)] : undefined;
  if (!e) return null;
  const Icon = code!.endsWith("n") ? e.night : e.day;
  return <Icon size={size} color={e.color} strokeWidth={1.75} role="img" aria-label={weatherLabel(code) ?? undefined} />;
}
