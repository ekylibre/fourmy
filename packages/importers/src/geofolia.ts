import type { TreatmentPurpose } from "@fourmy/contracts";
import { IsoxmlReadError, unzip, zipEntries } from "@fourmy/isoxml";
import { eventStatus } from "./aee.js";
import { geofoliaEntry } from "./detect.js";
import { corruptFile } from "./errors.js";
import { GeometryError, lambert93, toMultiPolygon, wgs84, wktToGeoJson, type Projection } from "./geo.js";
import {
  emptyBundle,
  normalizeGuid,
  type ArticleNature,
  type BundleArticle,
  type BundleParcel,
  type BundleQuantity,
  type BundleWorkUnit,
  type ImportBundle,
  type Nutrient,
} from "./model.js";

/**
 * Lecteur de l'export Geofolia « Parcelles et Interventions complet » (ZIP :
 * `Field.Json`, `Action.Json`, `IdentificationCodes.json`) — lot IM2,
 * claudedocs/conception_import_onboarding.md §4.1.
 *
 * - `Fields` : une culture par parcelle et par campagne ; une « parcelle
 *   secondaire » (interculture, dérobée) partage la terre de sa parcelle
 *   principale (`MainPlotId`).
 * - `Activities` : une action regroupe plusieurs couples action × parcelle
 *   (`CropZoneIds`, identifiés par `RecognitionId`, le GUID commun avec
 *   DAPLOS) ; intrants et récoltes sont donnés par couple.
 */

/** Limites de décompression : l'export d'une ferme fait quelques Mo. */
const UNZIP_LIMITS = { maxEntryBytes: 200 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024, maxRatio: 100 };

/** Unités Geofolia → unités Fourmy. */
const UNITS: Record<string, string> = {
  l: "liter",
  kg: "kilogram",
  g: "gram",
  t: "ton",
  q: "quintal",
  "m³": "cubic_meter",
  m3: "cubic_meter",
  tms: "ton_dry_matter",
  d: "unity", // dose
  u: "unity",
};

/** Destination de la culture (Geofolia) → usage final AgroEDI (table 17). */
const USAGES: Record<string, string> = {
  grains: "ZLD",
  "grain(es)": "ZLD",
  fourrage: "ZLF",
  "pâturée et fauchée": "ZEQ",
  fauchée: "ZEP",
  biomasse: "ZPB",
  industrie: "ZNS",
  oléagineux: "ZES",
  semences: "ZLE",
};

export function geofoliaUsage(destination: string | null | undefined): string | null {
  return destination ? (USAGES[destination.trim().toLowerCase()] ?? null) : null;
}

export function geofoliaUnit(symbol: string | null | undefined): string | null {
  return symbol ? (UNITS[symbol.trim().toLowerCase()] ?? null) : null;
}

/** Litres d'une quantité d'eau (L ou m³). */
function liters(quantity: number, symbol: string | null | undefined): number | null {
  const unit = geofoliaUnit(symbol);
  if (unit === "liter") return quantity;
  if (unit === "cubic_meter") return quantity * 1000;
  return null;
}

/**
 * Nature d'un produit Geofolia d'après son type (`ProductTypeEnum` : 1 phyto,
 * 2 semence, 4 fertilisant, 8 eau) et sa catégorie (`CategoryEnum`), établies
 * sur un export réel (Geofolia 26.2) : 2 adjuvant, 3 amendement, 13 effluent,
 * 17 fongicide, 19 herbicide, 20 insecticide, 22 molluscicide, 26 régulateur.
 */
export function geofoliaNature(type: number | null, category: number | null): { nature: ArticleNature; purpose?: TreatmentPurpose; organic?: true } {
  switch (type) {
    case 1:
      if (category === 2) return { nature: "adjuvant" };
      return { nature: "phyto", purpose: PURPOSES[category ?? -1] };
    case 2:
      return { nature: "seed" };
    case 4:
      if (category === 3) return { nature: "amendment" };
      if (category === 13) return { nature: "fertilizer", organic: true };
      return { nature: "fertilizer" };
    case 8:
      return { nature: "water" };
    default:
      return { nature: "other" };
  }
}

const PURPOSES: Record<number, TreatmentPurpose> = {
  17: "fungicide",
  19: "herbicide",
  20: "insecticide",
  22: "molluscicide",
  26: "growth_regulator",
};

// --- Structures JSON (champs utilisés seulement) ---------------------------------

interface GeoField {
  Id: string;
  HarvestYear: number;
  Code: string | null;
  Name: string | null;
  Area: number | null;
  Geography: string | null;
  MainPlotId: string | null;
  PlotKind: number | null;
  SowingDate: string | null;
  HarvestDate: string | null;
  IsletNum: string | null;
  CityNumber: string | null;
  SoilKind: string | null;
  SoilName: string | null;
  CropName: string | null;
  RNCropCode: string | null;
  VarietyName: string | null;
  ReferentialVarietyCode: string | null;
  ObjectiveYield: number | null;
  YieldRealized: number | null;
  YieldUnit: string | null;
  DestinationName: string | null;
  ResiduesName: string | null;
  NMinus1Crop?: string | null;
  NMinus2Crop?: string | null;
  NMinus3Crop?: string | null;
  NMinus4Crop?: string | null;
  NMinus5Crop?: string | null;
  [key: string]: unknown;
}

interface GeoProduct {
  SupplyId: string;
  SupplyName: string;
  Code: string | null;
  CategoryEnum: number | null;
  ProductTypeEnum: number | null;
  UnitSymbol: string | null;
  BotanicalSpecies: string | null;
  VarietyName: string | null;
  [key: string]: unknown;
}

interface GeoActionProduct {
  SupplyId: string;
  RecognitionId: string;
  ReferentialUnitSymbol: string | null;
  Quantity: number | null;
}

interface GeoActionHarvest {
  HarvestId: string;
  RecognitionId: string;
  Quantity: number | null;
  HarvestGoodsUnitSymbol: string | null;
}

interface GeoAction {
  ActionId: string;
  HarvestYear: number;
  StartingDate: string;
  EndingDate: string | null;
  OperationName: string;
  ReferentialOperationCode: string | null;
  OperationCategory: string | null;
  StatusCode: string | null;
  Comment: string | null;
  Motivation: string | null;
  Temperature: number | null;
  LastModificationUser: string | null;
  CropZoneIds: { PlotCode: string | null; PlotId: string; RecognitionId: string; WorkedSurface: number | null }[] | null;
  ProductIds: GeoActionProduct[] | null;
  ActionHarvests: GeoActionHarvest[] | null;
  ActionEmployees: { EmployeeId: string }[] | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Valeurs non nulles d'un ensemble de champs numériques. */
function pick(src: Record<string, unknown>, fields: Record<string, string>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const [key, field] of Object.entries(fields)) {
    const v = num(src[field]);
    if (v !== null && v !== 0) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

const COMPONENTS: Record<Nutrient, string> = {
  n: "ProductComponentNTotal",
  p2o5: "ProductComponentP2O5",
  k2o: "ProductComponentK2O",
  mgo: "ProductComponentMgO",
  so3: "ProductComponentSO3",
  cao: "ProductComponentCaO",
  na2o: "ProductComponentNa2O",
  b: "ProductComponentB",
  cu: "ProductComponentCu",
  zn: "ProductComponentZn",
  mn: "ProductComponentMn",
  fe: "ProductComponentFe",
  mo: "ProductComponentMo",
  co: "ProductComponentCo",
  ms: "MS",
  cn: "CN",
};

function readJson<T>(files: Map<string, Uint8Array>, names: string[], wanted: "Field.Json" | "Action.Json" | "IdentificationCodes.json", fileName: string): T | null {
  const path = geofoliaEntry(names, wanted);
  if (!path) return null;
  try {
    // TextDecoder retire la marque d'ordre des octets (BOM) des exports Geofolia.
    return JSON.parse(new TextDecoder("utf-8").decode(files.get(path))) as T;
  } catch {
    throw corruptFile(fileName, `${wanted} n'est pas un JSON valide.`);
  }
}

/** Projection d'après le système de coordonnées déclaré (Lambert 93 en métropole). */
function projectionOf(crs: unknown, fileName: string): Projection {
  const s = typeof crs === "string" ? crs : "";
  if (!s || /LAMB93|Lambert[- ]93|EPSG[",: ]+2154/i.test(s)) return lambert93;
  if (/WGS ?84|EPSG[",: ]+4326/i.test(s)) return wgs84;
  throw corruptFile(fileName, "système de coordonnées non pris en charge (Lambert 93 ou WGS 84 attendu).");
}

export function readGeofolia(bytes: Uint8Array, fileName: string): ImportBundle {
  let files: Map<string, Uint8Array>;
  let names: string[];
  try {
    names = zipEntries(bytes).map((e) => e.name);
    const wanted = new Set(["Field.Json", "Action.Json", "IdentificationCodes.json"].map((n) => geofoliaEntry(names, n as "Field.Json")).filter(Boolean));
    files = unzip(bytes, { ...UNZIP_LIMITS, only: (n) => wanted.has(n) });
  } catch (e) {
    throw corruptFile(fileName, e instanceof IsoxmlReadError ? e.message : "archive zip illisible.");
  }

  const fieldDoc = readJson<{ Information?: Record<string, unknown>; Fields?: GeoField[] }>(files, names, "Field.Json", fileName);
  const actionDoc = readJson<{
    Information?: Record<string, unknown>;
    Products?: GeoProduct[];
    Employees?: { EmployeeId: string; Name: string | null; FirstName: string | null; StartDate: string | null }[];
    HarvestedProducts?: { HarvestId: string; Name: string; BotanicalSpeciesName: string | null; UnitSymbol: string | null }[];
    Activities?: GeoAction[];
  }>(files, names, "Action.Json", fileName);
  const ids = readJson<string[]>(files, names, "IdentificationCodes.json", fileName);
  if (!fieldDoc || !actionDoc) throw corruptFile(fileName, "Field.Json et Action.Json sont attendus.");

  const bundle = emptyBundle("geofolia");
  const info = { ...(actionDoc.Information ?? {}), ...(fieldDoc.Information ?? {}) };
  bundle.producedBy = [text(info.AppName), text(info.AppVersion)].filter(Boolean).join(" ") || null;
  bundle.exportedAt = text(info.ExportDate);
  const siret = (Array.isArray(ids) ? ids : []).map((v) => String(v).trim()).find((v) => /^\d{14}$/.test(v)) ?? null;
  bundle.farm.siret = siret;
  const project = projectionOf(info.CoordinateReferenceSystem, fileName);

  // --- Parcelles et cultures ------------------------------------------------------
  const fields = fieldDoc.Fields ?? [];
  const byId = new Map(fields.map((f) => [f.Id, f]));
  const keyOf = (f: GeoField) => text(f.Code) ?? f.Id;
  const campaigns = new Set<number>();
  for (const f of fields) {
    campaigns.add(f.HarvestYear);
    const main = f.MainPlotId && f.MainPlotId !== f.Id ? byId.get(f.MainPlotId) : undefined;
    let shape = null;
    try {
      shape = f.Geography ? toMultiPolygon(wktToGeoJson(f.Geography, project)) : null;
    } catch (e) {
      bundle.warnings.push({ level: "warning", message: `Parcelle ${keyOf(f)} (${f.Name ?? "sans nom"}) : contour illisible (${e instanceof GeometryError ? e.message : "géométrie"}).`, ref: keyOf(f) });
    }
    if (!shape && !main) bundle.warnings.push({ level: "warning", message: `Parcelle ${keyOf(f)} (${f.Name ?? "sans nom"}) sans contour : elle ne sera pas créée.`, ref: keyOf(f) });
    const code = (f.RNCropCode ?? "").replace(/\s+/g, "");
    const parcel: BundleParcel = {
      key: keyOf(f),
      landKey: main ? keyOf(main) : keyOf(f),
      secondary: !!main,
      campaign: f.HarvestYear,
      name: text(f.Name) ?? `Parcelle ${keyOf(f)}`,
      shape,
      areaM2: num(f.Area),
      islet: text(f.IsletNum),
      inseeCode: text(f.CityNumber),
      crop: {
        aeeCode: code.slice(0, 3) || null,
        aeeComplement: /^[A-Z]{3}Z[A-Z]{2}/.test(code) ? code.slice(3, 6) : null,
        aeeSowingPeriod: /^ZF[AB]$/.exec(code.slice(-3))?.[0] ?? null,
        aeeUsage: geofoliaUsage(f.DestinationName),
        capCode: null,
        label: text(f.CropName) ?? "Culture inconnue",
        variety: text(f.VarietyName) || text(f.ReferentialVarietyCode) ? { name: text(f.VarietyName), gnis: text(f.ReferentialVarietyCode) } : null,
        sownOn: day(f.SowingDate),
        harvestedOn: day(f.HarvestDate),
        destination: text(f.DestinationName),
      },
      soil: text(f.SoilName) || text(f.SoilKind) ? { code: text(f.SoilKind), label: text(f.SoilName) } : null,
      yield:
        num(f.ObjectiveYield) !== null || num(f.YieldRealized) !== null
          ? { objective: num(f.ObjectiveYield), realized: num(f.YieldRealized), unit: text(f.YieldUnit) }
          : null,
      advice: pick(f, { n: "NAdviseDose", p2o5: "PAdviseDose", k2o: "KAdviseDose", mgo: "MgAdviseDose", so3: "SAdviseDose", cao: "CaOAdviseDose" }),
      spreadable: pick(f, {
        nonSpreadable: "SNE",
        manureExcluded: "ManureExcludedArea",
        slurryExcluded: "LiquidManureExcludedArea",
        otherExcluded: "OtherExcludedArea",
      }),
      sourceIds: { "geofolia.field": f.Id },
    };
    bundle.parcels.push(parcel);

    // Cultures des campagnes précédentes (noms seulement), pour les cultures principales.
    if (!main) {
      for (let n = 1; n <= 5; n++) {
        const label = text(f[`NMinus${n}Crop`]);
        if (label) bundle.history.push({ parcelKey: parcel.key, campaign: f.HarvestYear - n, aeeCode: null, label });
      }
    }
  }
  bundle.campaigns = [...campaigns].sort();

  // --- Articles -------------------------------------------------------------------
  const activities = actionDoc.Activities ?? [];
  // Unité la plus employée dans les actions (sinon celle du produit) : les quantités y sont exprimées.
  const usedUnits = new Map<string, Map<string, number>>();
  const countUnit = (key: string, symbol: string | null) => {
    if (!symbol) return;
    const m = usedUnits.get(key) ?? new Map<string, number>();
    m.set(symbol, (m.get(symbol) ?? 0) + 1);
    usedUnits.set(key, m);
  };
  for (const a of activities) {
    for (const p of a.ProductIds ?? []) countUnit(p.SupplyId, p.ReferentialUnitSymbol);
    for (const h of a.ActionHarvests ?? []) countUnit(`harvest:${h.HarvestId}`, h.HarvestGoodsUnitSymbol);
  }
  const mainUnit = (key: string, fallback: string | null) => {
    const m = usedUnits.get(key);
    const best = m ? [...m].sort((x, y) => y[1] - x[1])[0]?.[0] : undefined;
    return best ?? fallback;
  };

  const natures = new Map<string, ReturnType<typeof geofoliaNature>>();
  for (const p of actionDoc.Products ?? []) {
    const n = geofoliaNature(p.ProductTypeEnum, p.CategoryEnum);
    natures.set(p.SupplyId, n);
    if (n.nature === "water") continue;
    const symbol = mainUnit(p.SupplyId, p.UnitSymbol);
    const unit = geofoliaUnit(symbol);
    if (!unit) bundle.warnings.push({ level: "blocking", message: `Produit « ${p.SupplyName} » : unité « ${symbol ?? "?"} » inconnue.`, ref: p.SupplyId });
    const code = text(p.Code);
    const phyto = n.nature === "phyto" || n.nature === "adjuvant";
    const composition = n.nature === "fertilizer" || n.nature === "amendment" ? pick(p, COMPONENTS) : null;
    const article: BundleArticle = {
      key: p.SupplyId,
      name: p.SupplyName.trim(),
      nature: n.nature,
      amm: phyto && code && /^\d{7}$/.test(code) ? code : null,
      gnis: n.nature === "seed" ? code : null,
      unit: unit ?? "unity",
      composition: composition as BundleArticle["composition"],
      species: text(p.BotanicalSpecies),
      ...(n.purpose ? { purpose: n.purpose } : {}),
      ...(n.organic ? { organic: true } : {}),
      sourceIds: { "geofolia.supply": p.SupplyId },
    };
    bundle.articles.push(article);
  }
  for (const h of actionDoc.HarvestedProducts ?? []) {
    const key = `harvest:${h.HarvestId}`;
    const symbol = mainUnit(key, h.UnitSymbol);
    const unit = geofoliaUnit(symbol);
    if (!unit) bundle.warnings.push({ level: "blocking", message: `Produit récolté « ${h.Name} » : unité « ${symbol ?? "?"} » inconnue.`, ref: key });
    bundle.articles.push({
      key,
      name: h.Name.trim(),
      nature: "harvest",
      amm: null,
      gnis: null,
      unit: unit ?? "unity",
      composition: null,
      species: text(h.BotanicalSpeciesName),
      sourceIds: { "geofolia.harvest": h.HarvestId },
    });
  }
  const articleUnit = new Map(bundle.articles.map((a) => [a.key, a.unit]));

  // --- Personnes ------------------------------------------------------------------
  for (const e of actionDoc.Employees ?? []) {
    const lastName = text(e.Name) ?? "Sans nom";
    bundle.people.push({ key: e.EmployeeId, firstName: text(e.FirstName), lastName, startedOn: day(e.StartDate), sourceIds: { "geofolia.employee": e.EmployeeId } });
  }

  // --- Interventions : un couple action × parcelle par unité de travail -----------
  const plotKey = new Map(fields.map((f) => [f.Id, keyOf(f)]));
  for (const a of activities) {
    const on = day(a.StartingDate);
    if (!on) {
      bundle.warnings.push({ level: "warning", message: `${a.OperationName} sans date : ignorée.`, ref: a.ActionId });
      continue;
    }
    const until = day(a.EndingDate);
    for (const cz of a.CropZoneIds ?? []) {
      const guid = normalizeGuid(cz.RecognitionId);
      const parcelKey = plotKey.get(cz.PlotId) ?? text(cz.PlotCode);
      if (!parcelKey) {
        bundle.warnings.push({ level: "warning", message: `${a.OperationName} du ${on} : parcelle inconnue, ignorée.`, ref: guid });
        continue;
      }
      const area = num(cz.WorkedSurface);
      const perHa = (q: number | null) => (q !== null && area ? q / (area / 10_000) : null);
      const inputs: BundleQuantity[] = [];
      let waterL: number | null = null;
      for (const p of (a.ProductIds ?? []).filter((x) => x.RecognitionId === cz.RecognitionId)) {
        const q = num(p.Quantity);
        if (natures.get(p.SupplyId)?.nature === "water") {
          const l = q === null ? null : liters(q, p.ReferentialUnitSymbol);
          if (l !== null) waterL = (waterL ?? 0) + l;
          continue;
        }
        const unit = geofoliaUnit(p.ReferentialUnitSymbol) ?? articleUnit.get(p.SupplyId) ?? "unity";
        inputs.push({ articleKey: p.SupplyId, total: q, perHa: perHa(q), unit });
      }
      const outputs: BundleQuantity[] = (a.ActionHarvests ?? [])
        .filter((h) => h.RecognitionId === cz.RecognitionId)
        .map((h) => {
          const q = num(h.Quantity);
          const key = `harvest:${h.HarvestId}`;
          return { articleKey: key, total: q, perHa: perHa(q), unit: geofoliaUnit(h.HarvestGoodsUnitSymbol) ?? articleUnit.get(key) ?? "unity" };
        });
      const unit: BundleWorkUnit = {
        guid,
        groupKey: a.ActionId,
        parcelKey,
        campaign: a.HarvestYear,
        operation: { aeeCode: text(a.ReferentialOperationCode), label: a.OperationName.trim(), category: null },
        status: eventStatus(a.StatusCode),
        on,
        until: until && until !== on ? until : null,
        workedAreaM2: area,
        inputs,
        outputs,
        waterL,
        weather: num(a.Temperature) !== null ? { temperatureC: num(a.Temperature)! } : null,
        purpose: text(a.Motivation),
        notes: text(a.Comment),
        doerKeys: (a.ActionEmployees ?? []).map((e) => e.EmployeeId),
        modifiedBy: text(a.LastModificationUser),
      };
      bundle.workUnits.push(unit);
    }
  }
  return bundle;
}
