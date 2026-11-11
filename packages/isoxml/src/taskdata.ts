import type { PrescriptionUnit } from "@fourmy/contracts";
import type { MultiPolygonCoords } from "./shapefile.js";

/**
 * TaskData ISO 11783-10 (version 4.2) d'une carte de modulation : une tâche
 * planifiée sur la parcelle, une zone de traitement (TZN) par zone avec sa
 * dose de consigne (PDV), et une grille de type 1 (GRD) dont chaque maille
 * porte le code de sa zone. Attributs d'après ISO 11783-10 et le greffon
 * ISOv4 d'AgGateway ADAPT (docs/modulation.md).
 */

/** DDI de consigne par unité, facteur de la dose vers la valeur ISO, présentation. */
export const RATE_DDI: Record<PrescriptionUnit, { ddi: string; factor: number; scale: number; decimals: number; unit: string }> = {
  // DDI 6 Setpoint Mass Per Area Application Rate, mg/m², résolution 1 : 1 kg/ha = 100 mg/m².
  kg_ha: { ddi: "0006", factor: 100, scale: 0.01, decimals: 0, unit: "kg/ha" },
  // DDI 1 Setpoint Volume Per Area Application Rate, mm³/m², résolution 0,01 : 1 L/ha = 100 mm³/m² = 10 000 pas.
  l_ha: { ddi: "0001", factor: 10_000, scale: 0.0001, decimals: 1, unit: "L/ha" },
  // DDI 11 Setpoint Count Per Area Application Rate, /m², résolution 0,001 : 1 grain/ha = 0,1 pas.
  seeds_ha: { ddi: "000B", factor: 0.1, scale: 10, decimals: 0, unit: "grains/ha" },
};

export interface TaskGrid {
  /** Coin sud-ouest de la grille (degrés WGS84). */
  minLat: number;
  minLon: number;
  /** Taille d'une maille (degrés). */
  cellLat: number;
  cellLon: number;
  columns: number;
  rows: number;
  /** Code de zone de chaque maille (0 : hors parcelle), ligne par ligne du sud au nord, d'ouest en est. */
  cells: Uint8Array;
}

export interface TaskDataInput {
  software: { manufacturer: string; version: string };
  customer: string;
  farm: string;
  partfield: { name: string; areaM2: number; boundary: MultiPolygonCoords };
  task: string;
  product: string;
  unit: PrescriptionUnit;
  zones: { code: number; name: string; rate: number }[];
  /** Dose hors zone connue (perte de position) : en général la dose moyenne. */
  defaultRate: number;
  grid: TaskGrid;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Désignations : 32 caractères au plus (ISO 11783-10). */
const designator = (s: string) => esc([...s].slice(0, 32).join(""));
const deg = (v: number) => v.toFixed(9);

const points = (ring: number[][]) => {
  const pts = ring.map((p) => [p[0]!, p[1]!]);
  const [f, l] = [pts[0]!, pts[pts.length - 1]!];
  if (pts.length > 1 && f[0] === l[0] && f[1] === l[1]) pts.pop(); // anneau implicitement fermé
  return pts.map(([lon, lat]) => `<PNT A="2" C="${deg(lat!)}" D="${deg(lon!)}"/>`).join("");
};

export function taskData(input: TaskDataInput): { "TASKDATA/TASKDATA.XML": string; "TASKDATA/GRD00001.bin": Uint8Array } {
  const g = input.grid;
  if (g.cells.length !== g.columns * g.rows) throw new Error("Grille de taille incohérente.");
  if (input.zones.length > 252) throw new Error("Trop de zones.");
  const rate = RATE_DDI[input.unit];
  const value = (r: number) => Math.round(r * rate.factor);
  const pdv = (r: number) => `<PDV A="${rate.ddi}" B="${value(r)}" C="PDT1" E="VPN1"/>`;
  const defaultCode = Math.max(0, ...input.zones.map((z) => z.code)) + 1;

  const boundary = input.partfield.boundary
    .map(
      (polygon) =>
        `<PLN A="1">${polygon.map((ring, i) => `<LSG A="${i === 0 ? 1 : 2}">${points(ring)}</LSG>`).join("")}</PLN>`,
    )
    .join("");
  const zones = [
    `<TZN A="0" B="Hors parcelle">${pdv(0)}</TZN>`,
    ...input.zones.map((z) => `<TZN A="${z.code}" B="${designator(z.name)}">${pdv(z.rate)}</TZN>`),
    `<TZN A="${defaultCode}" B="Dose par défaut">${pdv(input.defaultRate)}</TZN>`,
  ].join("");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ISO11783_TaskData VersionMajor="4" VersionMinor="2" ManagementSoftwareManufacturer="${esc(input.software.manufacturer)}" ManagementSoftwareVersion="${esc(input.software.version)}" DataTransferOrigin="1">` +
    `<CTR A="CTR1" B="${designator(input.customer)}"/>` +
    `<FRM A="FRM1" B="${designator(input.farm)}" I="CTR1"/>` +
    `<PFD A="PFD1" C="${designator(input.partfield.name)}" D="${Math.round(input.partfield.areaM2)}" E="CTR1" F="FRM1">${boundary}</PFD>` +
    `<PDT A="PDT1" B="${designator(input.product)}"/>` +
    `<VPN A="VPN1" B="0" C="${rate.scale}" D="${rate.decimals}" E="${rate.unit}"/>` +
    `<TSK A="TSK1" B="${designator(input.task)}" C="CTR1" D="FRM1" E="PFD1" G="1" H="${defaultCode}" I="${defaultCode}" J="0">` +
    // Ordre des enfants de TSK repris du greffon ADAPT : GRD puis TZN.
    `<GRD A="${deg(g.minLat)}" B="${deg(g.minLon)}" C="${g.cellLat.toFixed(10)}" D="${g.cellLon.toFixed(10)}" E="${g.columns}" F="${g.rows}" G="GRD00001" H="${g.cells.length}" I="1"/>` +
    zones +
    `</TSK>` +
    `</ISO11783_TaskData>\n`;
  return { "TASKDATA/TASKDATA.XML": xml, "TASKDATA/GRD00001.bin": g.cells };
}
