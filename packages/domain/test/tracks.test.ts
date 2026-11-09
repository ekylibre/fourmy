import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { DEFAULT_TRACK_SETTINGS } from "@fourmy/contracts";
import { canonicalJson, segmentSessions, settingsHash, sha256Hex, type TrackPosition } from "../src/tracks.js";

/** Morceau de trace : `min` minutes, une position toutes les 30 s. */
interface Piece {
  min: number;
  kmh?: number | null;
  working?: boolean | null;
  tool?: string | null;
  /** Aucune position pendant ce morceau (trou de transmission). */
  gap?: boolean;
}

const STEP_S = 30;
const M_PER_DEG_LAT = 111_195;

/** Trace synthétique vers le nord, à partir du 28/10/2026 8 h (UTC). */
function trace(pieces: Piece[]): TrackPosition[] {
  const out: TrackPosition[] = [];
  let t = Date.parse("2026-10-28T08:00:00.000Z");
  let lat = 47.5;
  for (const p of pieces) {
    const kmh = p.kmh ?? 0;
    for (let s = 0; s < p.min * 60; s += STEP_S) {
      if (!p.gap) {
        out.push({ time: new Date(t).toISOString(), lon: 1.5, lat, speedKmh: p.kmh === undefined ? 0 : p.kmh, working: p.working ?? null, tool: p.tool ?? null });
      }
      t += STEP_S * 1000;
      lat += (kmh / 3.6) * STEP_S / M_PER_DEG_LAT;
    }
  }
  return out;
}

const work = (min: number, tool: string | null = null): Piece => ({ min, kmh: 8, working: true, tool });
const drive = (min: number, kmh = 20): Piece => ({ min, kmh, working: false });
const idle = (min: number): Piece => ({ min, kmh: 0, working: false });
const S = DEFAULT_TRACK_SETTINGS;
const kinds = (pos: TrackPosition[], settings = S) => segmentSessions(pos, settings).map((s) => s.kind);

describe("découpage en parcours", () => {
  it("un travail continu donne une session avec ses bornes et sa distance", () => {
    const pos = trace([work(30)]);
    const [s, ...rest] = segmentSessions(pos, S);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ kind: "work", fromIndex: 0, toIndex: 59, positionCount: 60, startedAt: "2026-10-28T08:00:00.000Z", stoppedAt: "2026-10-28T08:29:30.000Z" });
    expect(s!.distanceM).toBeGreaterThan(3_900);
    expect(s!.distanceM).toBeLessThan(4_000);
  });

  it("absorbe les demi-tours (outil relevé) dans le travail", () => {
    const pos = trace([work(10), { min: 1, kmh: 6, working: false }, work(10), { min: 2, kmh: 6, working: false }, work(10)]);
    expect(kinds(pos)).toEqual(["work"]);
    expect(segmentSessions(pos, S)[0]).toMatchObject({ fromIndex: 0, toIndex: pos.length - 1 });
  });

  it("une pause de 20 min coupe, 14 min ne coupe pas (stopMin 15)", () => {
    expect(kinds(trace([work(10), idle(20), work(10)]))).toEqual(["work", "work"]);
    expect(kinds(trace([work(10), idle(14), work(10)]))).toEqual(["work"]);
  });

  it("une pause longue n'entre pas dans les bornes des sessions", () => {
    const [a, b] = segmentSessions(trace([idle(5), work(10), idle(20), work(10), idle(30)]), S);
    expect(a).toMatchObject({ startedAt: "2026-10-28T08:05:00.000Z", stoppedAt: "2026-10-28T08:14:30.000Z" });
    expect(b).toMatchObject({ startedAt: "2026-10-28T08:35:00.000Z", stoppedAt: "2026-10-28T08:44:30.000Z" });
  });

  it("un trou de transmission de plus de stopMin coupe", () => {
    expect(kinds(trace([work(10), { min: 16, gap: true }, work(10)]))).toEqual(["work", "work"]);
    expect(kinds(trace([work(10), { min: 10, gap: true }, work(10)]))).toEqual(["work"]);
  });

  it("sépare les déplacements du travail", () => {
    const sessions = segmentSessions(trace([drive(10), work(30), drive(10)]), S);
    expect(sessions.map((s) => s.kind)).toEqual(["transit", "work", "transit"]);
    expect(sessions[0]!.toIndex + 1).toBe(sessions[1]!.fromIndex);
  });

  it("un trajet long entre deux parcelles n'est pas absorbé", () => {
    expect(kinds(trace([work(20), drive(15), work(20)]))).toEqual(["work", "transit", "work"]);
    expect(kinds(trace([work(20), drive(14), work(20)]))).toEqual(["work"]);
  });

  it("écarte les sessions trop courtes ou trop peu longues en distance", () => {
    expect(kinds(trace([work(2)]))).toEqual([]);
    expect(kinds(trace([{ min: 10, kmh: 1, working: true }]))).toEqual([]); // ~165 m
    expect(kinds(trace([work(2)]), { ...S, minDurationMin: 0, minDistanceM: 0 })).toEqual(["work"]);
  });

  it("sans attribut working, l'état vient de la vitesse : un déplacement", () => {
    const pos = trace([{ min: 20, kmh: 10, working: null }]);
    expect(kinds(pos)).toEqual(["transit"]);
    // Vitesse absente : déduite de la distance entre points.
    expect(kinds(pos.map((p) => ({ ...p, speedKmh: null })))).toEqual(["transit"]);
    expect(kinds(trace([{ min: 20, kmh: 1, working: null }]))).toEqual([]);
  });

  it("est déterministe : même entrée mélangée, même sortie", () => {
    const pos = trace([drive(10), work(15, "Semoir"), { min: 1, kmh: 6, working: false }, work(15, "Semoir"), idle(20), drive(10)]);
    const expected = segmentSessions(pos, S);
    let seed = 42;
    const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 5; k++) {
      const shuffled = [...pos].map((p) => ({ p, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.p);
      expect(segmentSessions(shuffled, S)).toEqual(expected);
    }
    expect(expected.map((s) => s.kind)).toEqual(["transit", "work", "transit"]);
  });

  it("toolHint : outil majoritaire, null sans outil", () => {
    const [s] = segmentSessions(trace([work(10, "Herse"), work(20, "Semoir"), work(5)]), S);
    expect(s!.toolHint).toBe("Semoir");
    expect(segmentSessions(trace([work(10)]), S)[0]!.toolHint).toBeNull();
  });

  it("entrée vide", () => {
    expect(segmentSessions([], S)).toEqual([]);
  });
});

describe("hash des réglages", () => {
  it("SHA-256 conforme", () => {
    for (const s of ["", "abc", "é".repeat(100), "x".repeat(55), "x".repeat(56), "x".repeat(64)]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });

  it("stable quel que soit l'ordre des clés", () => {
    const reversed = Object.fromEntries(Object.entries(DEFAULT_TRACK_SETTINGS).reverse());
    expect(settingsHash(reversed)).toBe(settingsHash(DEFAULT_TRACK_SETTINGS));
    expect(canonicalJson(reversed)).toBe('{"minDistanceM":200,"minDurationMin":3,"movingKmh":2,"parcelMinAreaM2":500,"parcelMinShare":0.05,"stopMin":15}');
    expect(settingsHash(DEFAULT_TRACK_SETTINGS)).toMatch(/^[0-9a-f]{64}$/);
    expect(settingsHash({ ...DEFAULT_TRACK_SETTINGS, stopMin: 20 })).not.toBe(settingsHash(DEFAULT_TRACK_SETTINGS));
  });
});
