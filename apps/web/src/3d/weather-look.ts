import type { DayWeather } from "@fourmy/contracts";

/**
 * Ambiance du plan 3D d'après la météo du jour de la frise (lot AA,
 * FR-TWIN-4). Pas de simulation : on traduit le temps dominant observé (ou
 * prévu) en ciel, brume, pluie et sol mouillé. Pur : testable sans Cesium.
 */
export type Sky = "clear" | "partly" | "cloudy" | "overcast" | "rain" | "storm" | "snow" | "mist";

export interface WeatherLook {
  sky: Sky;
  /** Intensité de la pluie affichée (0..1). */
  rain: number;
  snow: boolean;
  /** Sol mouillé : au moins 3 mm sur les 48 h précédentes. */
  wetSoil: boolean;
  /** Gelée : minimum ≤ 0 °C (végétation givrée). */
  frost: boolean;
  /** Luminosité du ciel (−1..0) et saturation (−1..0). */
  brightness: number;
  saturation: number;
  /** Densité du brouillard Cesium (scene.fog.density). */
  fogDensity: number;
  label: string;
}

const SKY_BY_ICON: Record<string, Sky> = { "01": "clear", "02": "partly", "03": "cloudy", "04": "overcast", "09": "rain", "10": "rain", "11": "storm", "13": "snow", "50": "mist" };
const LABELS: Record<Sky, string> = {
  clear: "Ensoleillé",
  partly: "Éclaircies",
  cloudy: "Nuageux",
  overcast: "Couvert",
  rain: "Pluie",
  storm: "Orage",
  snow: "Neige",
  mist: "Brume",
};

export function weatherLook(w: DayWeather | null): WeatherLook | null {
  if (!w) return null;
  let sky: Sky = (w.icon && SKY_BY_ICON[w.icon.slice(0, 2)]) || "partly";
  const mm = w.precipitationMm ?? 0;
  // Une journée « couverte » avec de vraies pluies se montre pluvieuse.
  if ((sky === "cloudy" || sky === "overcast") && mm >= 4) sky = "rain";
  const rainy = sky === "rain" || sky === "storm";
  const rain = rainy ? Math.min(1, Math.max(0.3, mm / 10)) : 0;
  const shade: Record<Sky, [number, number, number]> = {
    clear: [0, 0, 2e-4],
    partly: [-0.05, -0.05, 2.5e-4],
    cloudy: [-0.15, -0.2, 4e-4],
    overcast: [-0.25, -0.35, 6e-4],
    rain: [-0.35, -0.45, 1e-3],
    storm: [-0.5, -0.5, 1.2e-3],
    snow: [-0.1, -0.6, 1e-3],
    mist: [-0.15, -0.5, 2.5e-3],
  };
  const [brightness, saturation, fogDensity] = shade[sky];
  const temp = w.temperatureMinC !== null ? `, ${Math.round(w.temperatureMinC)} à ${Math.round(w.temperatureMaxC ?? w.temperatureMinC)} °C` : "";
  const wet = (w.precipitation48hMm ?? 0) >= 3;
  return {
    sky,
    rain,
    snow: sky === "snow",
    wetSoil: wet,
    frost: w.temperatureMinC !== null && w.temperatureMinC <= 0,
    brightness,
    saturation,
    fogDensity,
    label: `${LABELS[sky]}${mm > 0 ? `, ${String(mm).replace(".", ",")} mm` : ""}${temp}${w.kind === "forecast" ? " (prévision)" : ""}`,
  };
}
