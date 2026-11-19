import type { MultiPolygon } from "geojson";
import { parseDaplosFile, type AeeDictionary, type Crop, type Input, type Intervention, type SimplifiedDapDocument } from "@osfarm/agroedei-edifact-daplos-reader";
import { aeeUnit, COMPONENTS, eventStatus, inputNature } from "./aee.js";
import { isCoverSpecies } from "./covers.js";
import { corruptFile } from "./errors.js";
import { closeRing, overlapShare } from "./geo.js";
import { emptyBundle, normalizeGuid, type BundleArticle, type BundleParcel, type BundleQuantity, type ImportBundle, type Nutrient } from "./model.js";

/**
 * Lecteur EDI DAPLOS (`.dap`, AgroEDI) — lot IM4,
 * claudedocs/conception_import_onboarding.md §4.1. Le fichier est lu par le
 * lecteur d'OSFarm (fork Ekylibre 2.0.0 : libellés lus dans la table AgroEDI
 * de chaque champ, segment `DP` corrigé), les libellés de Lexicon passés en
 * `dictionary` quand la ferme a le jeu `agroedi`.
 *
 * - `DP` : une culture par parcelle et par campagne, avec son contour (`SC`),
 *   ses surfaces épandables (`PS`) et ses précédents (`PH`).
 * - `PV` : un couple intervention × parcelle (`intervention_guid`, le même
 *   GUID que le `RecognitionId` de Geofolia), ses intrants (`VI`, dose par
 *   hectare donnée par le fichier) et ses récoltes (`VR`).
 * - DAPLOS ne dit pas qu'une culture (couvert, dérobée) occupe la terre d'une
 *   autre : deux cultures d'une campagne qui se recouvrent sont sur la même
 *   terre, la culture principale étant celle qui n'est pas un couvert, puis
 *   celle de plus petit numéro de travail (constaté sur un export réel
 *   comparé à Geofolia : 22 cultures secondaires sur 22).
 */

export interface DaplosOptions {
  /** Libellés AgroEDI par table (jeu `agroedi` de Lexicon), prioritaires sur ceux du lecteur. */
  dictionary?: AeeDictionary;
}

/** Part de recouvrement à partir de laquelle deux cultures occupent la même terre. */
const SAME_LAND_SHARE = 0.5;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Libellé lisible d'une culture : espèce, complément, saison, usage (« Avoine noire d'hiver — grain »). */
export function daplosCropLabel(c: Partial<Crop>): string {
  const species = text(c.crop_specie_edilabel) ?? text(c.crop_specie_edicode) ?? "Culture inconnue";
  const parts = [species];
  const complement = text(c.crop_specie_label);
  if (complement) parts.push(complement.toLowerCase().replace(/\(e\)$/, species.endsWith("e") ? "e" : ""));
  const period = text(c.crop_sowing_period_edilabel)?.toLowerCase();
  if (period) parts.push(/^[aeiouyh]/.test(period) ? `d'${period}` : `de ${period}`);
  // « Grain(es) » → grain ; « Fourrage(r.) = Prairie » → fourrage.
  const usage = text(c.crop_final_usage_edilabel)?.toLowerCase().replace(/\(.*?\)/g, "").replace(/\s*=.*$/, "").trim();
  return usage ? `${parts.join(" ")} — ${usage}` : parts.join(" ");
}

/** Unité de base (`liter`…) et dose par hectare d'une quantité DAPLOS. */
function quantityOf(
  total: number | null,
  totalUnit: string | null | undefined,
  perHa: number | null,
  perHaUnit: string | null | undefined,
  areaHa: number | null,
): { total: number | null; perHa: number | null; unit: string | null } {
  const base = aeeUnit(totalUnit);
  const per = aeeUnit(perHaUnit);
  const unit = base && !base.perHa ? base.unit : per?.perHa ? per.unit.replace(/_per_hectare$/, "") : null;
  const perHaOk = per?.perHa && unit && per.unit === `${unit}_per_hectare` ? perHa : null;
  return {
    total: base && !base.perHa ? total : null,
    perHa: perHaOk ?? (total !== null && base && !base.perHa && areaHa ? total / areaHa : null),
    unit,
  };
}

/** Litres d'eau d'un intrant d'irrigation. */
function waterLiters(i: Input): number | null {
  const q = num(i.input_quantity);
  const unit = aeeUnit(i.input_unity_edicode)?.unit;
  if (q === null) return null;
  if (unit === "liter") return q;
  if (unit === "cubic_meter") return q * 1000;
  return null;
}

/** Contour d'une culture : polygone de sa surface culturale (`A17`), sinon de la première surface qui en a un. */
function shapeOf(c: Crop): MultiPolygon | null {
  const areas = c.crop_areas ?? [];
  const area = areas.find((a) => a.area_nature_edicode === "A17" && (a.crop_spatial_coordinates?.length ?? 0) >= 3) ?? areas.find((a) => (a.crop_spatial_coordinates?.length ?? 0) >= 3);
  const ring = area?.crop_spatial_coordinates;
  if (!ring) return null;
  const pts = ring.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
  if (pts.length < 3) return null;
  return { type: "MultiPolygon", coordinates: [[closeRing(pts.map((p) => [p[0], p[1]]))]] };
}

const bboxOf = (m: MultiPolygon) => {
  const pts = m.coordinates.flat(2);
  return [Math.min(...pts.map((p) => p[0]!)), Math.min(...pts.map((p) => p[1]!)), Math.max(...pts.map((p) => p[0]!)), Math.max(...pts.map((p) => p[1]!))] as const;
};

/**
 * Terre de chaque culture : les cultures d'une campagne qui se recouvrent
 * (îlot PAC identique ou inconnu) partagent la terre de la culture principale.
 */
export function landKeys(crops: { key: string; campaign: number; islet: string | null; shape: MultiPolygon | null; cover: boolean }[]): Map<string, string> {
  const parent = new Map(crops.map((c) => [c.key, c.key]));
  const find = (k: string): string => (parent.get(k) === k ? k : find(parent.get(k)!));
  const boxes = new Map(crops.filter((c) => c.shape).map((c) => [c.key, bboxOf(c.shape!)]));
  for (let i = 0; i < crops.length; i++) {
    for (let j = i + 1; j < crops.length; j++) {
      const a = crops[i]!;
      const b = crops[j]!;
      if (a.campaign !== b.campaign || !a.shape || !b.shape) continue;
      if (a.islet && b.islet && a.islet !== b.islet) continue;
      const [ba, bb] = [boxes.get(a.key)!, boxes.get(b.key)!];
      if (ba[0] > bb[2] || bb[0] > ba[2] || ba[1] > bb[3] || bb[1] > ba[3]) continue;
      // Part de la plus petite des deux recouverte par l'autre.
      const share = Math.max(overlapShare(a.shape, b.shape), overlapShare(b.shape, a.shape));
      if (share >= SAME_LAND_SHARE) parent.set(find(a.key), find(b.key));
    }
  }
  const groups = new Map<string, typeof crops>();
  for (const c of crops) groups.set(find(c.key), [...(groups.get(find(c.key)) ?? []), c]);
  const workNumber = (k: string) => (/^\d+$/.test(k) ? Number(k) : Number.MAX_SAFE_INTEGER);
  const out = new Map<string, string>();
  for (const members of groups.values()) {
    const main = [...members].sort((x, y) => Number(x.cover) - Number(y.cover) || workNumber(x.key) - workNumber(y.key) || x.key.localeCompare(y.key))[0]!;
    for (const m of members) out.set(m.key, main.key);
  }
  return out;
}

export function readDaplos(bytes: Uint8Array, fileName: string, options: DaplosOptions = {}): ImportBundle {
  let doc: SimplifiedDapDocument;
  try {
    doc = parseDaplosFile(bytes, options.dictionary ? { dictionary: options.dictionary } : {});
  } catch (e) {
    throw corruptFile(fileName, e instanceof Error ? e.message : "fichier DAPLOS illisible.");
  }
  const bundle = emptyBundle("daplos");
  const header = doc.headers?.[0] ?? {};
  bundle.producedBy = text(header.version) ? `DAPLOS ${text(header.version)}` : "DAPLOS";
  bundle.exportedAt = day(header.printed_on);

  // --- Exploitation (entité TF) ---------------------------------------------------
  const tf = doc.entities?.find((e) => e.entity_nature === "TF");
  const siret = text(tf?.siret)?.replace(/\s/g, "") ?? text(doc.sender_siret);
  bundle.farm.siret = siret && /^\d{14}$/.test(siret) ? siret : null;
  bundle.farm.name = text(tf?.entity_name);
  bundle.farm.pacage = [tf?.entity_informations_1, tf?.entity_informations_2, tf?.entity_informations_3].map(text).find((v) => !!v && /^\d{9}$/.test(v)) ?? null;
  if (tf && (text(tf.entity_address) || text(tf.entity_town))) {
    const postalCode = text(tf.entity_postal_code);
    bundle.farm.address = {
      ...(text(tf.entity_address) ? { line1: text(tf.entity_address)! } : {}),
      ...(text(tf.entity_address_complement) ? { line2: text(tf.entity_address_complement)! } : {}),
      ...(postalCode && /^\d{5}$/.test(postalCode) ? { postalCode } : {}),
      ...(text(tf.entity_town) ? { city: text(tf.entity_town)! } : {}),
      ...(text(tf.entity_country) ? { country: text(tf.entity_country)! } : {}),
    };
  }

  // --- Cultures --------------------------------------------------------------------
  const crops = doc.crops ?? [];
  const keyOf = (c: Crop) => text(c.land_parcel_work_number)?.replace(/^0+(?=\d)/, "") ?? "?";
  const seen = new Set<string>();
  const shapes = new Map<Crop, MultiPolygon | null>();
  for (const c of crops) {
    const key = `${c.harvest_year}:${keyOf(c)}`;
    if (seen.has(key)) bundle.warnings.push({ level: "warning", message: `Parcelle ${keyOf(c)} : deux cultures pour la campagne ${c.harvest_year}, la seconde est ignorée.`, ref: keyOf(c) });
    seen.add(key);
    shapes.set(c, shapeOf(c));
  }
  const unique = crops.filter((c, i) => crops.findIndex((x) => x.harvest_year === c.harvest_year && keyOf(x) === keyOf(c)) === i);
  const land = landKeys(
    unique.map((c) => ({
      key: keyOf(c),
      campaign: Number(c.harvest_year),
      islet: text(c.cap_islet_number),
      shape: shapes.get(c) ?? null,
      cover: c.crop_final_usage_edicode === "ZPB" || isCoverSpecies(c.crop_specie_edicode),
    })),
  );
  const campaigns = new Set<number>();
  for (const c of unique) {
    const key = keyOf(c);
    const campaign = Number(c.harvest_year);
    if (!Number.isInteger(campaign) || campaign < 2000 || campaign > 2100) {
      bundle.warnings.push({ level: "warning", message: `Parcelle ${key} : campagne « ${c.harvest_year} » illisible, ignorée.`, ref: key });
      continue;
    }
    campaigns.add(campaign);
    const landKey = land.get(key) ?? key;
    const shape = shapes.get(c) ?? null;
    const secondary = landKey !== key;
    if (!shape && !secondary) bundle.warnings.push({ level: "warning", message: `Parcelle ${key} (${text(c.crop_name_details) ?? "sans nom"}) sans contour : elle ne sera pas créée.`, ref: key });
    const areaHa = (code: string) => num(c.crop_areas?.find((a) => a.area_nature_edicode === code)?.area_nature_value_in_hectare);
    const spreadable: Record<string, number> = {};
    for (const [code, name] of [["A28", "manureSpreadable"], ["A38", "slurrySpreadable"], ["A18", "droppingsSpreadable"]] as const) {
      const ha = areaHa(code);
      if (ha !== null) spreadable[name] = Math.round(ha * 10_000);
    }
    const yieldUnit = aeeUnit(c.provisionnal_yield_unity);
    const parcel: BundleParcel = {
      key,
      landKey,
      secondary,
      campaign,
      name: text(c.crop_name_details) ?? `Parcelle ${key}`,
      shape,
      areaM2: areaHa("A17") !== null ? Math.round(areaHa("A17")! * 10_000) : null,
      islet: text(c.cap_islet_number),
      inseeCode: text(c.town_insee_code),
      crop: {
        aeeCode: text(c.crop_specie_edicode),
        aeeComplement: text(c.crop_specie_number),
        aeeSowingPeriod: text(c.crop_sowing_period_edicode),
        aeeUsage: text(c.crop_final_usage_edicode),
        capCode: null,
        label: daplosCropLabel(c),
        variety: text(c.first_variety) ? { name: null, gnis: text(c.first_variety) } : null,
        sownOn: day(c.crop_started_on),
        harvestedOn: day(c.crop_stopped_on),
        destination: text(c.crop_final_usage_edilabel),
      },
      soil: text(c.soil_nature_edicode) ? { code: text(c.soil_nature_edicode), label: text(c.soil_nature_edilabel) } : null,
      yield: num(c.provisionnal_yield) !== null ? { objective: num(c.provisionnal_yield), realized: null, unit: yieldUnit?.unit ?? text(c.provisionnal_yield_unity) } : null,
      advice: null,
      spreadable: Object.keys(spreadable).length ? spreadable : null,
      sourceIds: { "daplos.crop": `${campaign}:${key}` },
    };
    bundle.parcels.push(parcel);

    // Précédents (N-1…N-5) des cultures principales.
    if (!secondary) {
      for (const h of c.crop_histories ?? []) {
        const order = Number(h.previous_order);
        if (!Number.isInteger(order) || order >= 0 || order < -5) continue;
        bundle.history.push({
          parcelKey: key,
          campaign: campaign + order,
          aeeCode: text(h.crop_specie_edicode),
          aeeComplement: text(h.crop_specie_number),
          aeeSowingPeriod: text(h.crop_sowing_period_edicode),
          aeeUsage: text(h.crop_final_usage_edicode),
          label: daplosCropLabel(h),
        });
      }
    }
  }
  bundle.campaigns = [...campaigns].sort();

  // --- Articles (intrants et récoltes, sans identifiant dans DAPLOS : par nom) ------
  const articles = new Map<string, BundleArticle>();
  const unitVotes = new Map<string, Map<string, number>>();
  const vote = (key: string, unit: string | null) => {
    if (!unit) return;
    const m = unitVotes.get(key) ?? new Map<string, number>();
    m.set(unit, (m.get(unit) ?? 0) + 1);
    unitVotes.set(key, m);
  };
  const articleKey = (nature: string, name: string) => `${nature}|${norm(name)}`;
  const interventions = unique.flatMap((c) => (c.interventions ?? []).map((i) => ({ crop: c, i })));
  for (const { i } of interventions) {
    for (const input of i.inputs ?? []) {
      const nature = inputNature(input.input_nature_edicode);
      if (nature.nature === "water") continue;
      const name = text(input.input_name) ?? text(input.input_nature_edilabel) ?? "Intrant sans nom";
      const key = articleKey(nature.nature, name);
      vote(key, quantityOf(num(input.input_quantity), input.input_unity_edicode, num(input.input_quantity_per_hectare), input.per_area_unity_edicode, null).unit);
      if (articles.has(key)) continue;
      const amm = text(input.input_phytosanitary_number);
      const composition: Partial<Record<Nutrient, number>> = {};
      for (const comp of input.input_components ?? []) {
        const nutrient = COMPONENTS[text(comp.indicator_nature_edicode) ?? ""];
        const q = num(comp.indicator_quantity);
        if (nutrient && q !== null && q > 0) composition[nutrient] = q;
      }
      const organic = nature.organic || !!text(input.input_organic_code);
      articles.set(key, {
        key,
        name,
        nature: nature.nature,
        amm: (nature.nature === "phyto" || nature.nature === "adjuvant") && amm && /^\d{7}$/.test(amm) ? amm : null,
        gnis: text(input.input_gnis_code),
        unit: "unity",
        composition: Object.keys(composition).length ? composition : null,
        species: null,
        ...(nature.purpose ? { purpose: nature.purpose } : {}),
        ...(organic && nature.nature === "fertilizer" ? { organic: true } : {}),
        sourceIds: {},
      });
    }
    for (const o of i.outputs ?? []) {
      const name = text(o.output_name) ?? text(o.output_specie_edilabel) ?? "Récolte";
      const key = articleKey("harvest", name);
      vote(key, aeeUnit(o.output_unity_edicode)?.unit ?? null);
      if (!articles.has(key)) {
        articles.set(key, { key, name, nature: "harvest", amm: null, gnis: null, unit: "unity", composition: null, species: text(o.output_specie_edilabel), sourceIds: {} });
      }
    }
  }
  for (const a of articles.values()) {
    const best = [...(unitVotes.get(a.key) ?? new Map<string, number>())].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (best) a.unit = best;
    else bundle.warnings.push({ level: "blocking", message: `Produit « ${a.name} » : unité inconnue.`, ref: a.key });
    bundle.articles.push(a);
  }

  // --- Interventions : un couple intervention × parcelle par unité de travail -------
  for (const { crop, i } of interventions) {
    const parcelKey = keyOf(crop);
    const on = day(i.intervention_started_at);
    const label = text(i.intervention_name) ?? text(i.intervention_nature_edilabel) ?? "Intervention";
    if (!on || !text(i.intervention_guid)) {
      bundle.warnings.push({ level: "warning", message: `Parcelle ${parcelKey} : ${label} sans date ou sans identifiant, ignorée.`, ref: parcelKey });
      continue;
    }
    const until = day(i.intervention_stopped_at);
    const areaHa = num(i.working_area_in_hectare);
    const inputs: BundleQuantity[] = [];
    let waterL: number | null = null;
    for (const input of i.inputs ?? []) {
      const nature = inputNature(input.input_nature_edicode);
      if (nature.nature === "water") {
        const l = waterLiters(input) ?? (num(input.input_quantity_per_hectare) !== null && areaHa && aeeUnit(input.per_area_unity_edicode)?.unit === "liter_per_hectare" ? num(input.input_quantity_per_hectare)! * areaHa : null);
        if (l !== null) waterL = (waterL ?? 0) + l;
        continue;
      }
      const name = text(input.input_name) ?? text(input.input_nature_edilabel) ?? "Intrant sans nom";
      const q = quantityOf(num(input.input_quantity), input.input_unity_edicode, num(input.input_quantity_per_hectare), input.per_area_unity_edicode, areaHa);
      inputs.push({ articleKey: articleKey(nature.nature, name), total: q.total, perHa: q.perHa, unit: q.unit ?? "unity" });
    }
    const outputs: BundleQuantity[] = (i.outputs ?? []).map((o) => {
      const name = text(o.output_name) ?? text(o.output_specie_edilabel) ?? "Récolte";
      const unit = aeeUnit(o.output_unity_edicode);
      const yieldUnit = aeeUnit(o.output_yield_unity_edicode);
      return {
        articleKey: articleKey("harvest", name),
        total: unit && !unit.perHa ? num(o.output_quantity) : null,
        perHa: yieldUnit?.perHa && unit && yieldUnit.unit === `${unit.unit}_per_hectare` ? num(o.output_yield) : null,
        unit: unit?.unit ?? "unity",
      };
    });
    const motivation = [text(i.intervention_motivation_label), text(i.intervention_motivation_details)].filter(Boolean).join(" : ") || null;
    bundle.workUnits.push({
      guid: normalizeGuid(text(i.intervention_guid)!),
      groupKey: null,
      parcelKey,
      campaign: Number(crop.harvest_year),
      operation: { aeeCode: text(i.intervention_nature_edicode), label, category: text(i.intervention_category_edicode) },
      status: eventStatus(i.intervention_state_edicode),
      on,
      until: until && until !== on ? until : null,
      workedAreaM2: areaHa !== null ? areaHa * 10_000 : null,
      inputs,
      outputs,
      waterL,
      weather: num(i.external_temperature) !== null ? { temperatureC: num(i.external_temperature)! } : null,
      purpose: motivation,
      notes: text((i as Intervention).first_comment),
      doerKeys: [],
      modifiedBy: null,
    });
  }
  return bundle;
}
