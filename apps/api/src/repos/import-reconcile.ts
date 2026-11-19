import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@fourmy/db";
import {
  getProcedure,
  interventionCompleteWrite,
  interventionPlanWrite,
  type ArticleKind,
  type ImportDecisions,
  type ImportReconciliation,
  type InterventionPlanWrite,
} from "@fourmy/contracts";
import { convertQuantity, validateIntervention } from "@fourmy/domain";
import {
  coverOf,
  draftInterventions,
  parisDayBounds,
  productionDates,
  stableId,
  type CoverInfo,
  type BundleArticle,
  type BundleParcel,
  type BundlePerson,
  type ImportBundle,
  type InterventionDraft,
} from "@fourmy/importers";

/**
 * Rapprochement d'un fichier lu avec la ferme (lot IM2,
 * claudedocs/conception_import_onboarding.md §5) : lecture seule. Produit le
 * plan d'écriture (identifiants Fourmy compris, créés d'avance) et son résumé
 * pour l'aperçu. Recalculé à l'écriture : la ferme a pu changer depuis
 * l'analyse.
 *
 * Règles : une entité déjà importée (lien `import_links`) est reliée, jamais
 * réécrite ; sinon une entité équivalente de la ferme (même géométrie, même
 * nom, même AMM) est reliée ; sinon elle est créée.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** IoU au-delà duquel une parcelle de la ferme est la même terre. */
const SAME_LAND_IOU = 0.8;

type Action = "create" | "link" | "skip";

export interface LandItem {
  landKey: string;
  name: string;
  shape: BundleParcel["shape"];
  islet: string | null;
  action: Action;
  landParcelId: string | null;
  reason?: string;
}

export interface CampaignItem {
  year: number;
  id: string;
  create: boolean;
}

export interface ActivityItem {
  key: string;
  name: string;
  action: Exclude<Action, "skip">;
  activityId: string;
  reference: string | null;
  referenceLabel: string | null;
  via: ImportReconciliation["activities"][number]["via"];
  family: string;
  cultivation: string | null;
  nature: "field_crop" | "grassland";
}

export interface ProductionItem {
  parcel: BundleParcel;
  landParcelId: string;
  campaignId: string;
  activityKey: string;
  action: Exclude<Action, "skip">;
  productionId: string;
  /** Semis → récolte : la culture en place à une date (`fourmy_production_at`). */
  startedOn: string | null;
  stoppedOn: string | null;
}

export interface CoverItem {
  parcel: BundleParcel;
  cover: CoverInfo;
  landParcelId: string | null;
  campaign: number;
  action: Action;
  coverId: string;
  reason?: string;
}

export interface ArticleItem {
  article: BundleArticle;
  kind: ArticleKind;
  /** Unité de l'article dans Fourmy (celle du fichier pour un article créé). */
  unit: string;
  action: Exclude<Action, "skip">;
  articleId: string;
  lexiconRef: string | null;
  via: ImportReconciliation["articles"][number]["via"];
  match: string | null;
}

export interface PersonItem {
  person: BundlePerson;
  name: string;
  action: Exclude<Action, "skip">;
  personId: string;
}

export interface InterventionItem {
  draft: InterventionDraft;
  id: string;
  action: "create" | "skip";
  reason?: string;
  /** Corps de planification (et de réalisation si `done`). */
  body?: InterventionPlanWrite;
}

export interface ReconcilePlan {
  /** Début de validité des parcelles créées (première date du fichier, à Paris). */
  validFrom: string;
  lands: LandItem[];
  campaigns: CampaignItem[];
  activities: ActivityItem[];
  productions: ProductionItem[];
  covers: CoverItem[];
  articles: ArticleItem[];
  people: PersonItem[];
  interventions: InterventionItem[];
  alreadyImported: number;
  summary: ImportReconciliation;
}

/** Liens déjà posés : `espace|clé|entité` → id. */
async function loadLinks(tx: Tx): Promise<Map<string, string>> {
  const list = await rows<{ namespace: string; key: string; entity: string; entity_id: string }>(
    tx,
    sql`SELECT namespace, key, entity, entity_id FROM import_links`,
  );
  return new Map(list.map((l) => [`${l.namespace}|${l.key}|${l.entity}`, l.entity_id]));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Article Fourmy d'après la nature d'un article importé. */
export function articleKindOf(a: BundleArticle): ArticleKind {
  switch (a.nature) {
    case "phyto":
    case "adjuvant":
      return "phyto";
    case "seed":
      return "seed";
    case "fertilizer":
    case "amendment":
      return "fertilizer";
    case "harvest":
      return "harvest";
    default:
      return "other";
  }
}

// --- Productions de référence ------------------------------------------------------

/** Usages Lexicon acceptés pour un usage final AgroEDI (table 17). */
const USAGES: Record<string, string[]> = {
  ZLD: ["grain"],
  ZES: ["grain"],
  ZLE: ["seed"],
  ZLF: ["fodder", "meadow"],
  ZEQ: ["fodder", "meadow"],
  ZEP: ["fodder", "meadow"],
  ZPB: ["fodder", "meadow", "grain"],
  ZNS: ["vegetable", "grain", "plant"],
};

function seasonOf(p: BundleParcel): "winter" | "spring" | null {
  if (p.crop.aeeSowingPeriod === "ZFB" || /hiver/i.test(p.crop.label)) return "winter";
  if (p.crop.aeeSowingPeriod === "ZFA" || /printemps/i.test(p.crop.label)) return "spring";
  return null;
}

interface ReferenceRow {
  reference_name: string;
  label: string;
  family: string;
  specie: string | null;
  usage: string | null;
  season: string | null;
}

async function resolveReference(
  tx: Tx,
  p: BundleParcel,
): Promise<{ ref: ReferenceRow; via: "agroedi_crop" | "agroedi_species" | "label" } | null> {
  const c = p.crop;
  if (c.aeeCode) {
    // Codes combinés du dictionnaire AgroEDI (jeu Lexicon réservé, avec une clé).
    const candidates = [
      `${c.aeeCode}${c.aeeComplement ?? ""}${c.aeeSowingPeriod ?? ""}`,
      `${c.aeeCode}${c.aeeUsage ?? ""}`,
      `${c.aeeCode}${c.aeeComplement ?? ""}`,
    ].filter((code, i, all) => code.length > 3 && all.indexOf(code) === i);
    if (candidates.length) {
      const found = await rows<ReferenceRow & { code: string }>(
        tx,
        sql`SELECT c.code, p.reference_name, p.label, p.family, p.specie, p.usage, p.season
            FROM lexicon_agroedi_crops c JOIN lexicon_productions p ON p.reference_name = c.production
            WHERE c.code IN (${sql.join(candidates.map((x) => sql`${x}`), sql`, `)})`,
      );
      for (const code of candidates) {
        const hit = found.find((f) => f.code === code);
        if (hit) return { ref: hit, via: "agroedi_crop" };
      }
    }
    // Code d'espèce des productions de référence (paquet public), filtré par saison et usage.
    let list = await rows<ReferenceRow>(
      tx,
      sql`SELECT reference_name, label, family, specie, usage, season FROM lexicon_productions WHERE agroedi_crop_code = ${c.aeeCode} ORDER BY reference_name`,
    );
    const season = seasonOf(p);
    if (season && list.some((r) => r.season === season)) list = list.filter((r) => r.season === season || !r.season);
    const usages = c.aeeUsage ? USAGES[c.aeeUsage] : undefined;
    if (usages && list.some((r) => usages.includes(r.usage ?? ""))) list = list.filter((r) => usages.includes(r.usage ?? ""));
    // Plusieurs candidats : celui dont le libellé est contenu dans celui de la culture, sinon le premier.
    const byLabel = list.find((r) => norm(p.crop.label).includes(norm(r.label)));
    if (byLabel ?? list[0]) return { ref: (byLabel ?? list[0])!, via: "agroedi_species" };
  }
  const [byName] = await rows<ReferenceRow>(
    tx,
    sql`SELECT reference_name, label, family, specie, usage, season FROM lexicon_productions WHERE lower(label) = lower(${c.label}) LIMIT 1`,
  );
  return byName ? { ref: byName, via: "label" } : null;
}

function natureOf(p: BundleParcel, ref: ReferenceRow | null): "field_crop" | "grassland" {
  if (ref?.usage === "meadow" || ref?.reference_name === "meadow") return "grassland";
  return /prairie|bande enherb/i.test(p.crop.label) ? "grassland" : "field_crop";
}

// --- Plan ------------------------------------------------------------------------

export async function reconcile(tx: Tx, farmId: string, bundle: ImportBundle, decisions: ImportDecisions): Promise<ReconcilePlan> {
  const links = await loadLinks(tx);
  const linked = (ns: string, key: string, entity: string) => links.get(`${ns}|${key}|${entity}`);

  // Début de validité : premier jour du fichier, au plus tard le 1er janvier de la première campagne.
  const firstDay = [...bundle.workUnits.map((u) => u.on), ...bundle.campaigns.map((y) => `${y}-01-01`)].sort()[0] ?? `${new Date().getFullYear()}-01-01`;
  const validFrom = parisDayBounds(firstDay).startedAt;

  // --- Parcelles (terres) --------------------------------------------------------
  const lands: LandItem[] = [];
  for (const p of bundle.parcels.filter((x) => !x.secondary)) {
    const item: LandItem = { landKey: p.landKey, name: p.name, shape: p.shape, islet: p.islet, action: "skip", landParcelId: null };
    const known = linked("plot.work_number", p.landKey, "land_parcel");
    const [still] = known ? await rows<{ id: string }>(tx, sql`SELECT id FROM land_parcels WHERE id = ${known}`) : [];
    if (still) Object.assign(item, { action: "link", landParcelId: still.id });
    else if (p.shape) {
      const geo = JSON.stringify(p.shape);
      const [best] = await rows<{ id: string; iou: number }>(
        tx,
        sql`WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326) AS g)
            SELECT v.land_parcel_id AS id,
                   (ST_Area(ST_Intersection(v.shape, g.g)::geography) / NULLIF(ST_Area(ST_Union(v.shape, g.g)::geography), 0))::float8 AS iou
            FROM land_parcel_versions v, g
            WHERE v.valid && tstzrange(${validFrom}::timestamptz, NULL) AND ST_Intersects(v.shape, g.g)
            ORDER BY iou DESC NULLS LAST LIMIT 1`,
      );
      if (best && best.iou >= SAME_LAND_IOU) Object.assign(item, { action: "link", landParcelId: best.id });
      else Object.assign(item, { action: "create", landParcelId: randomUUID() });
    } else item.reason = "sans contour";
    lands.push(item);
  }
  const landOf = new Map(lands.filter((l) => l.landParcelId).map((l) => [l.landKey, l.landParcelId!]));

  // --- Campagnes -------------------------------------------------------------------
  const campaigns: CampaignItem[] = [];
  for (const year of [...new Set(bundle.parcels.map((p) => p.campaign))].sort()) {
    const [c] = await rows<{ id: string }>(tx, sql`SELECT id FROM campaigns WHERE year = ${year} LIMIT 1`);
    campaigns.push(c ? { year, id: c.id, create: false } : { year, id: randomUUID(), create: true });
  }
  const campaignOf = new Map(campaigns.map((c) => [c.year, c.id]));

  // Couverts d'interculture : couverts de la parcelle (cover_crops), ni activité ni production.
  const coverInfo = new Map(bundle.parcels.map((p) => [p.key, coverOf(bundle, p)] as const).filter((x): x is readonly [string, CoverInfo] => !!x[1]));
  const crops = bundle.parcels.filter((p) => !coverInfo.has(p.key));

  // --- Activités (une par culture) ------------------------------------------------
  const activities: ActivityItem[] = [];
  const activityOf = new Map<string, ActivityItem>();
  for (const p of crops) {
    const key = norm(p.crop.label);
    if (activityOf.has(key)) continue;
    const decided = decisions.activities?.[key];
    const name = (decided?.name ?? p.crop.label).trim().slice(0, 120);
    const knownId = linked("crop.label", key, "activity");
    const [existing] = knownId
      ? await rows<{ id: string; reference: string | null }>(tx, sql`SELECT id, reference FROM activities WHERE id = ${knownId}`)
      : await rows<{ id: string; reference: string | null }>(tx, sql`SELECT id, reference FROM activities WHERE lower(name) = lower(${name}) LIMIT 1`);
    let ref: ReferenceRow | null = null;
    let via: ActivityItem["via"] = null;
    if (decided?.reference !== undefined && decided.reference !== null) {
      [ref = null] = await rows<ReferenceRow>(tx, sql`SELECT reference_name, label, family, specie, usage, season FROM lexicon_productions WHERE reference_name = ${decided.reference}`);
      via = ref ? "decision" : null;
    } else if (existing?.reference) {
      [ref = null] = await rows<ReferenceRow>(tx, sql`SELECT reference_name, label, family, specie, usage, season FROM lexicon_productions WHERE reference_name = ${existing.reference}`);
      via = "existing";
    } else if (decided?.reference !== null) {
      const r = await resolveReference(tx, p);
      ref = r?.ref ?? null;
      via = r?.via ?? null;
    }
    const item: ActivityItem = {
      key,
      name,
      action: existing ? "link" : "create",
      activityId: existing?.id ?? randomUUID(),
      reference: ref?.reference_name ?? null,
      referenceLabel: ref?.label ?? null,
      via,
      family: ref && ["plant_farming", "plant_nursery"].includes(ref.family) ? ref.family : "plant_farming",
      cultivation: ref?.specie ?? null,
      nature: natureOf(p, ref),
    };
    activities.push(item);
    activityOf.set(key, item);
  }

  // --- Productions (une par culture et par campagne) ------------------------------
  const productions: ProductionItem[] = [];
  for (const p of crops) {
    const landParcelId = landOf.get(p.landKey);
    if (!landParcelId) continue;
    const campaignId = campaignOf.get(p.campaign)!;
    const activity = activityOf.get(norm(p.crop.label))!;
    const known = linked("crop.parcel", `${p.campaign}:${p.key}`, "production");
    const [existing] = known
      ? await rows<{ id: string }>(tx, sql`SELECT id FROM productions WHERE id = ${known}`)
      : activity.action === "link"
        ? await rows<{ id: string }>(
            tx,
            sql`SELECT id FROM productions WHERE land_parcel_id = ${landParcelId} AND campaign_id = ${campaignId} AND activity_id = ${activity.activityId} LIMIT 1`,
          )
        : [];
    productions.push({
      parcel: p,
      landParcelId,
      campaignId,
      activityKey: activity.key,
      action: existing ? "link" : "create",
      productionId: existing?.id ?? randomUUID(),
      ...productionDates(p),
    });
  }

  // --- Couverts d'interculture (un par parcelle et par campagne) -------------------
  const covers: CoverItem[] = [];
  const coverSlots = new Set<string>();
  for (const p of bundle.parcels.filter((x) => coverInfo.has(x.key))) {
    const landParcelId = landOf.get(p.landKey) ?? null;
    const item: CoverItem = { parcel: p, cover: coverInfo.get(p.key)!, landParcelId, campaign: p.campaign, action: "skip", coverId: randomUUID() };
    const slot = `${landParcelId}|${p.campaign}`;
    if (!landParcelId) item.reason = "parcelle non importée";
    else if (coverSlots.has(slot)) item.reason = "un autre couvert du fichier occupe déjà cette parcelle pour cette campagne";
    else {
      coverSlots.add(slot);
      const known = linked("crop.parcel", `${p.campaign}:${p.key}`, "cover_crop");
      const [existing] = known
        ? await rows<{ id: string }>(tx, sql`SELECT id FROM cover_crops WHERE id = ${known}`)
        : await rows<{ id: string }>(tx, sql`SELECT id FROM cover_crops WHERE land_parcel_id = ${landParcelId} AND campaign = ${p.campaign}`);
      Object.assign(item, existing ? { action: "link", coverId: existing.id } : { action: "create" });
    }
    covers.push(item);
  }

  // --- Articles -------------------------------------------------------------------
  const articles: ArticleItem[] = [];
  for (const a of bundle.articles) {
    const kind = articleKindOf(a);
    const [ns, sourceKey] = Object.entries(a.sourceIds)[0] ?? ["article.name", norm(a.name)];
    const decided = decisions.articles?.[a.key];
    let found: { id: string; name: string; unit: string } | undefined;
    let via: ArticleItem["via"] = null;
    if (decided?.articleId) {
      [found] = await rows(tx, sql`SELECT id, name, unit FROM articles WHERE id = ${decided.articleId}`);
      via = found ? "decision" : null;
    }
    if (!found && !decided?.create) {
      const knownId = linked(ns, sourceKey, "article");
      if (knownId) [found] = await rows(tx, sql`SELECT id, name, unit FROM articles WHERE id = ${knownId}`);
      if (found) via = "link";
      if (!found && a.amm) {
        [found] = await rows(tx, sql`SELECT id, name, unit FROM articles WHERE amm = ${a.amm} AND kind = 'phyto' ORDER BY created_at LIMIT 1`);
        if (found) via = "amm";
      }
      if (!found) {
        [found] = await rows(tx, sql`SELECT id, name, unit FROM articles WHERE lower(name) = lower(${a.name}) AND kind = ${kind} ORDER BY created_at LIMIT 1`);
        if (found) via = "name";
      }
    }
    let lexiconRef: string | null = null;
    let match = found?.name ?? null;
    if (!found && a.amm) {
      const [p] = await rows<{ id: number; name: string }>(tx, sql`SELECT id, name FROM phyto_products WHERE amm = ${a.amm} ORDER BY (state = 'authorized') DESC LIMIT 1`);
      if (p) {
        lexiconRef = `phyto:${p.id}`;
        match = `E-Phy : ${p.name}`;
      }
    }
    articles.push({
      article: a,
      kind,
      unit: found?.unit ?? decided?.unit ?? a.unit,
      action: found ? "link" : "create",
      articleId: found?.id ?? randomUUID(),
      lexiconRef,
      via,
      match,
    });
  }
  const articleOf = new Map(articles.map((x) => [x.article.key, x]));

  // --- Personnes ------------------------------------------------------------------
  const people: PersonItem[] = [];
  for (const person of bundle.people) {
    const name = [person.firstName, person.lastName].filter(Boolean).join(" ");
    if (decisions.people?.[person.key]?.skip) continue;
    const [ns, sourceKey] = Object.entries(person.sourceIds)[0] ?? ["person.name", norm(name)];
    const decidedId = decisions.people?.[person.key]?.personId;
    const knownId = decidedId ?? linked(ns, sourceKey, "person");
    const [found] = knownId
      ? await rows<{ id: string }>(tx, sql`SELECT id FROM people WHERE id = ${knownId}`)
      : await rows<{ id: string }>(tx, sql`SELECT id FROM people WHERE lower(name) = lower(${name}) LIMIT 1`);
    people.push({ person, name, action: found ? "link" : "create", personId: found?.id ?? randomUUID() });
  }
  const personOf = new Map(people.map((x) => [x.person.key, x.personId]));

  // --- Interventions --------------------------------------------------------------
  const importedGuids = new Set(bundle.workUnits.map((u) => u.guid).filter((g) => linked("agri.crop_zone", g, "intervention")));
  const landOfCulture = new Map(bundle.parcels.map((p) => [p.key, landOf.get(p.landKey)]));
  const interventions: InterventionItem[] = [];
  for (const draft of draftInterventions(bundle, importedGuids)) {
    const id = stableId(farmId, "agri.crop_zone", draft.guids[0]!);
    const skip = (reason: string) => interventions.push({ draft, id, action: "skip", reason });
    if (draft.skip) {
      skip(draft.skip);
      continue;
    }
    // Cibles : la terre de chaque culture (culture principale et secondaire : même parcelle Fourmy).
    const targets = new Map<string, number | null>();
    let missing = false;
    for (const t of draft.targets) {
      const land = landOfCulture.get(t.parcelKey);
      if (!land) missing = true;
      else targets.set(land, Math.max(targets.get(land) ?? 0, t.workedAreaM2 ?? 0) || null);
    }
    if (missing || !targets.size) {
      skip("parcelle non importée");
      continue;
    }
    const inputs: NonNullable<InterventionPlanWrite["inputs"]> = [];
    let inputError: string | null = null;
    for (const i of draft.inputs) {
      const art = articleOf.get(i.articleKey);
      if (!art) continue;
      const quantity = convertQuantity(i.perHa, i.unit, art.unit);
      if (quantity !== null) inputs.push({ articleId: art.articleId, quantity: Number(quantity.toPrecision(6)), per: "hectare" });
      else if (art.kind === "fertilizer") inputs.push({ articleId: art.articleId, quantity: Number(i.perHa.toPrecision(6)), per: "hectare", unit: i.unit });
      else inputError = `${art.article.name} : dose en ${i.unit} pour un article en ${art.unit}`;
    }
    if (inputError) {
      skip(inputError);
      continue;
    }
    const outputs = draft.outputs
      .map((o) => ({ o, art: articleOf.get(o.articleKey) }))
      .filter((x) => x.art)
      .map(({ o, art }) => ({ articleId: art!.articleId, quantity: Number((convertQuantity(o.total, o.unit, art!.unit) ?? o.total).toPrecision(6)), per: "total" as const }));
    const raw = {
      id,
      procedure: draft.procedure,
      periods: [parisDayBounds(draft.on, draft.until)],
      targets: [...targets].map(([landId, area]) => ({ kind: "land_parcel" as const, id: landId, ...(area ? { workedAreaM2: area } : {}) })),
      inputs,
      outputs,
      doers: draft.doerKeys.map((k) => personOf.get(k)).filter((x): x is string => !!x).map((personId) => ({ personId })),
      purposes: draft.purposes,
      ...(draft.notes ? { notes: draft.notes } : {}),
      ...(draft.depthMm !== null ? { irrigation: { depthMm: draft.depthMm } } : {}),
      ...(draft.sowing && getProcedure(draft.procedure).shape === "sowing" ? { sowing: { technique: draft.sowing } } : {}),
    };
    const parsed = interventionPlanWrite.safeParse(raw);
    if (!parsed.success) {
      skip(parsed.error.issues[0]?.message ?? "corps invalide");
      continue;
    }
    // Mêmes règles que la saisie, avant toute écriture : une intervention refusée est laissée de côté, pas l'import.
    const mode = draft.status === "done" ? "complete" : "plan";
    if (mode === "complete" && !interventionCompleteWrite.safeParse(raw).success) {
      skip("corps de réalisation invalide");
      continue;
    }
    const kinds = new Map(articles.map((x) => [x.articleId, x.kind]));
    const errors = validateIntervention(getProcedure(draft.procedure), parsed.data, mode, {
      articleKind: (aid) => kinds.get(aid),
      allowMissingDestination: true,
    });
    if (errors.length) {
      skip(errors.join(" "));
      continue;
    }
    interventions.push({ draft, id, action: "create", body: parsed.data });
  }

  // --- Résumé ---------------------------------------------------------------------
  const count = <T extends { action: string }>(list: T[], a: string) => list.filter((x) => x.action === a).length;
  const byProcedure = new Map<string, { procedure: string; done: number; planned: number }>();
  for (const i of interventions.filter((x) => x.action === "create")) {
    const row = byProcedure.get(i.draft.procedure) ?? { procedure: i.draft.procedure, done: 0, planned: 0 };
    row[i.draft.status === "done" ? "done" : "planned"]++;
    byProcedure.set(i.draft.procedure, row);
  }
  const summary: ImportReconciliation = {
    parcels: { create: count(lands, "create"), link: count(lands, "link"), skip: count(lands, "skip") },
    productions: { create: count(productions, "create"), link: count(productions, "link") },
    covers: { create: count(covers, "create"), link: count(covers, "link"), skip: count(covers, "skip") },
    campaigns: campaigns.filter((c) => c.create).map((c) => c.year),
    activities: activities.map((a) => ({
      key: a.key,
      name: a.name,
      action: a.action,
      reference: a.reference,
      referenceLabel: a.referenceLabel,
      via: a.via,
      productions: productions.filter((p) => p.activityKey === a.key).length,
    })),
    articles: articles.map((a) => ({ key: a.article.key, name: a.article.name, kind: a.kind, unit: a.unit, action: a.action, match: a.match, via: a.via })),
    people: people.map((p) => ({ key: p.person.key, name: p.name, action: p.action })),
    interventions: {
      create: count(interventions, "create"),
      alreadyImported: importedGuids.size,
      skipped: interventions
        .filter((i) => i.action === "skip")
        .slice(0, 100)
        .map((i) => ({ label: i.draft.source.label, on: i.draft.on, reason: i.reason ?? "" })),
      byProcedure: [...byProcedure.values()].sort((a, b) => b.done + b.planned - (a.done + a.planned)),
    },
  };
  return { validFrom, lands, campaigns, activities, productions, covers, articles, people, interventions, alreadyImported: importedGuids.size, summary };
}
