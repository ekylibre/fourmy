import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { DayWeather, ParcelVegetation } from "@fourmy/contracts";
import { instancedBoxGlb } from "../src/3d/vegetation-glb";
import { vegetationStyle } from "../src/3d/vegetation";
import { weatherLook } from "../src/3d/weather-look";
import { server } from "./setup";
import { FARM, renderApp } from "./render";

/** Jumeau 3D (lot AA) : glTF instancié, apparence de la végétation, ambiance météo, rangs de la parcelle. */

function readGlb(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const bin = bytes.subarray(20 + jsonLength + 8);
  const floats = (accessor: number) => {
    const a = json.accessors[accessor];
    const v = json.bufferViews[a.bufferView];
    return new Float32Array(bin.slice(v.byteOffset, v.byteOffset + v.byteLength).buffer);
  };
  return { magic: dv.getUint32(0, true), length: dv.getUint32(8, true), json, floats };
}

const vegetation = (over: Partial<ParcelVegetation["canopy"]>, nature = "field_crop", species = "zea_mays"): ParcelVegetation => ({
  parcelId: "p",
  species,
  nature,
  rows: { bearingDeg: 90, spacingM: 0.75, auto: true },
  canopy: { phase: "growing", heightM: 2, density: 0.8, ndvi: 0.75, observedOn: "2026-07-01", source: "ndvi", ...over },
});

const weather = (over: Partial<DayWeather>): DayWeather => ({
  day: "2026-07-02",
  source: "open_meteo",
  kind: "observed",
  icon: "02d",
  precipitationMm: 0,
  precipitation48hMm: 0,
  temperatureMinC: 12,
  temperatureMaxC: 24,
  windMaxKmh: 20,
  ...over,
});

describe("jumeau 3D : glTF instancié", () => {
  it("un pavé, une instance par tronçon (translation, rotation autour de z, échelle)", () => {
    const glb = instancedBoxGlb([
      { x: 10, y: 20, z: 1.5, yaw: Math.PI / 2, length: 15, width: 0.5, height: 2 },
      { x: -4, y: 0, z: 0, yaw: 0, length: 7, width: 0.5, height: 2 },
    ]);
    const { magic, length, json, floats } = readGlb(glb);
    expect(magic).toBe(0x46546c67);
    expect(length).toBe(glb.byteLength);
    expect(json.extensionsUsed).toEqual(["EXT_mesh_gpu_instancing"]);
    const attrs = json.nodes[0].extensions.EXT_mesh_gpu_instancing.attributes;
    expect(json.accessors[attrs.TRANSLATION].count).toBe(2);
    expect(Array.from(floats(attrs.TRANSLATION))).toEqual([10, 20, 1.5, -4, 0, 0]);
    const q = Array.from(floats(attrs.ROTATION)).slice(0, 4);
    expect(q[0]).toBeCloseTo(0, 9);
    expect(q[1]).toBeCloseTo(0, 9);
    expect(q[2]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Array.from(floats(attrs.SCALE)).slice(0, 3)).toEqual([15, 0.5, 2]);
    expect(json.accessors[0]).toMatchObject({ count: 24, min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] });
    expect(() => instancedBoxGlb([])).toThrow();

    // Pente : un rang vers l'est (yaw 0) qui monte de 1 m sur 10 m — le bout +x monte.
    const tilted = readGlb(instancedBoxGlb([{ x: 0, y: 0, z: 0, yaw: 0, pitch: Math.atan2(1, 10), length: 10, width: 1, height: 1 }]));
    const [qx, qy, qz, qw] = Array.from(tilted.floats(tilted.json.nodes[0].extensions.EXT_mesh_gpu_instancing.attributes.ROTATION));
    // Image de +x par le quaternion : (1 − 2(y²+z²), 2(xy+wz), 2(xz − wy)).
    const end = [1 - 2 * (qy! ** 2 + qz! ** 2), 2 * (qx! * qy! + qw! * qz!), 2 * (qx! * qz! - qw! * qy!)];
    expect(end[0]).toBeCloseTo(10 / Math.hypot(1, 10), 6);
    expect(end[1]).toBeCloseTo(0, 6);
    expect(end[2]).toBeCloseTo(1 / Math.hypot(1, 10), 6);
  });
});

describe("jumeau 3D : apparence", () => {
  it("maïs en croissance, en maturation, récolté ; rien à dessiner sur sol nu", () => {
    const growing = vegetationStyle(vegetation({}))!;
    expect(growing).toMatchObject({ heightM: 2, baseM: 0, spacingM: 1 });
    expect(growing.widthM).toBeCloseTo(0.56, 2);
    const dry = vegetationStyle(vegetation({ phase: "senescent", density: 0.3, ndvi: 0.3 }))!;
    expect(dry.color).not.toBe(growing.color);
    expect(vegetationStyle(vegetation({ phase: "harvested", heightM: 0.12 }))).toMatchObject({ heightM: 0.12, color: "#C9B27A" });
    expect(vegetationStyle(vegetation({ phase: "bare", heightM: 0 }))).toBeNull();
    expect(vegetationStyle(vegetation({ phase: "unknown", heightM: 0, ndvi: null }))).toBeNull();
  });

  it("vigne : ceps en bois l'hiver, feuillage l'été, givre", () => {
    const winter = vegetationStyle({ ...vegetation({ phase: "dormant", heightM: 0.9, density: 0, ndvi: null }, "vine", "Malbec"), rows: { bearingDeg: 0, spacingM: 2, auto: true } })!;
    expect(winter).toMatchObject({ color: "#6B4F3A", baseM: 0.4, spacingM: 2 });
    const summer = vegetationStyle({ ...vegetation({ heightM: 1.7, density: 0.9 }, "vine", "Malbec"), rows: { bearingDeg: 0, spacingM: 2, auto: true } })!;
    expect(summer.widthM).toBeGreaterThan(winter.widthM);
    const frosted = vegetationStyle({ ...vegetation({ heightM: 1.7, density: 0.9 }, "vine", "Malbec"), rows: { bearingDeg: 0, spacingM: 2, auto: true } }, true)!;
    expect(frosted.color).not.toBe(summer.color);
  });
});

describe("jumeau 3D : ambiance météo", () => {
  it("pluie, sol mouillé, gelée, brume, prévision", () => {
    expect(weatherLook(null)).toBeNull();
    expect(weatherLook(weather({}))).toMatchObject({ sky: "partly", rain: 0, wetSoil: false, frost: false, label: "Éclaircies, 12 à 24 °C" });
    const rainy = weatherLook(weather({ icon: "10d", precipitationMm: 12, precipitation48hMm: 15 }))!;
    expect(rainy).toMatchObject({ sky: "rain", rain: 1, wetSoil: true });
    expect(rainy.label).toBe("Pluie, 12 mm, 12 à 24 °C");
    // Couvert mais vraiment arrosé : montré pluvieux.
    expect(weatherLook(weather({ icon: "04d", precipitationMm: 5 }))!.sky).toBe("rain");
    expect(weatherLook(weather({ icon: "50d", temperatureMinC: -2 }))).toMatchObject({ sky: "mist", frost: true });
    expect(weatherLook(weather({ kind: "forecast" }))!.label).toContain("(prévision)");
  });
});

describe("jumeau 3D : rangs de la parcelle", () => {
  const PARCEL = "00000000-0000-7000-8000-0000000000a0";
  it("affiche l'orientation automatique et enregistre une correction", async () => {
    const user = userEvent.setup();
    let saved: unknown = null;
    server.use(
      http.get("*/land-parcels/:id/sheet", () =>
        HttpResponse.json({
          id: PARCEL,
          name: "Les Rouffiats",
          shape: { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.501, 44.8], [0.501, 44.801], [0.5, 44.8]]]] },
          areaM2: 12000,
          center: [0.5005, 44.8005],
          pacIslet: null,
          since: "2020-01-01T00:00:00Z",
          until: null,
          productions: [],
          cadastre: [],
          cap: [],
          referencesFetchedAt: null,
          water: [],
          interventions: [],
        }),
      ),
      http.put("*/land-parcels/:id/rows", async ({ request }) => {
        saved = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp(`/f/${FARM}/land-parcels/${PARCEL}?at=2026-06-10`);
    const panel = await screen.findByLabelText("Rangs de la parcelle");
    expect(within(panel).getByText(/Orientation 35° · inter-rang 2 m/)).toBeInTheDocument();
    expect(within(panel).getByText(/automatique : grand axe de la parcelle/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Modifier" }));
    const bearing = within(panel).getByRole("textbox", { name: "Orientation (° depuis le nord)" });
    await user.clear(bearing);
    await user.type(bearing, "42");
    await user.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    await vi.waitFor(() => expect(saved).toEqual({ bearingDeg: 42, spacingM: 2 }));
  });
});
