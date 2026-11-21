import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  getProcedure,
  interventionPlanWrite,
  type Intervention,
  type ItineraryRef,
  type ItkContent,
  type PlannedConfirmResult,
  type PlannedItem,
  type PlannedPreview,
} from "@fourmy/contracts";
import {
  parisDay,
  plannedSignature,
  proposeInterventions,
  reconcilePlanned,
  splitUnit,
  storedUnit,
  convertQuantity,
  type DomainCtx,
  type ExistingPlanned,
  type PlannedItinerary,
  type PlannedProduction,
  type PlannedProposal,
  type ReconciledItem,
} from "@fourmy/domain";
import type { plannedConfirmWrite } from "@fourmy/contracts";
import type { z } from "zod";
import { planInTx, readInterventionsWhere } from "./interventions.js";

/**
 * Interventions prévues d'une campagne d'après les ITK des productions (lot
 * IT3, claudedocs/conception_assolement_itk.md §7, décisions A10 et A14) :
 * aperçu rapproché de l'existant, puis confirmation. Les interventions sont
 * écrites par le chemin des interventions prévues (`planInTx`), une à une
 * dans un point de sauvegarde : un refus (unité, procédure) n'empêche pas les
 * autres.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const pgArray = (values: string[]) => `{${values.join(",")}}`;

/** L'aperçu a changé entre l'affichage et la confirmation (autre onglet, ITK modifié) : 409. */
export class StalePlanned extends Error {
  constructor(readonly current: PlannedPreview) {
    super("Les interventions prévues ont changé depuis l'aperçu : relisez-le avant de confirmer.");
  }
}

/** Empreinte d'une intervention telle qu'elle est en base. */
function signatureOfIntervention(i: Intervention): string {
  return plannedSignature({
    procedure: i.procedure,
    day: parisDay(i.startedAt ?? i.stoppedAt ?? i.createdAt),
    targets: i.targets.filter((t) => t.kind === "land_parcel").map((t) => ({ id: t.id, workedAreaM2: t.workedAreaM2 ?? null })),
    inputs: i.inputs.map((x) => ({ articleId: x.articleId, quantity: x.quantity, unit: x.per === "hectare" && !/_per_/.test(x.unit) ? `${x.unit}_per_hectare` : x.unit })),
    equipmentIds: i.tools.map((t) => t.equipmentId),
    personIds: i.doers.map((d) => d.personId),
  });
}

interface Loaded {
  productions: PlannedProduction[];
  itineraries: Map<string, PlannedItinerary>;
  existing: ExistingPlanned[];
  interventions: Map<string, Intervention>;
  crews: Map<string, { equipmentIds: string[]; personIds: string[] }>;
  /** Articles cités par les ITK : unité du stock, nature, densité (dose écrite dans l'unité de l'article). */
  articles: Map<string, { unit: string; kind: string; density: number | null }>;
  withoutItinerary: number;
}

async function load(tx: Tx, year: number, productionIds?: string[]): Promise<Loaded> {
  const only = productionIds?.length ? sql`AND p.id = ANY(${pgArray(productionIds)}::uuid[])` : sql``;
  const prods = await rows<{
    id: string;
    parcel_id: string;
    parcel_name: string;
    area_m2: string | null;
    activity_name: string;
    itinerary_id: string | null;
    sowing_on: string | null;
    harvest_on: string | null;
  }>(
    tx,
    sql`SELECT p.id, p.land_parcel_id AS parcel_id, lp.name AS parcel_name, a.name AS activity_name, p.attrs->>'itineraryId' AS itinerary_id,
               coalesce((SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = p.land_parcel_id AND v.valid @> make_date(${year}, 6, 1)::timestamptz LIMIT 1),
                        (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = p.land_parcel_id ORDER BY lower(v.valid) DESC LIMIT 1)) AS area_m2,
               -- Dates prévues de la production, sinon dates types Lexicon de l'activité ramenées à la campagne.
               coalesce(p.started_on, (lx.started_on + make_interval(years => ${year} - extract(year FROM lx.stopped_on)::int))::date)::text AS sowing_on,
               coalesce(p.stopped_on, (lx.stopped_on + make_interval(years => ${year} - extract(year FROM lx.stopped_on)::int))::date)::text AS harvest_on
        FROM productions p JOIN campaigns c ON c.id = p.campaign_id JOIN land_parcels lp ON lp.id = p.land_parcel_id
        JOIN activities a ON a.id = p.activity_id LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
        WHERE c.year = ${year} AND NOT p.declared ${only}
        ORDER BY lp.name`,
  );
  const withItk = prods.filter((p) => p.itinerary_id);
  const itkIds = [...new Set(withItk.map((p) => p.itinerary_id!))];
  const itineraries = new Map(
    (itkIds.length
      ? await rows<{ id: string; name: string; revision: number; content: ItkContent }>(tx, sql`SELECT id, name, revision, content FROM technical_itineraries WHERE id = ANY(${pgArray(itkIds)}::uuid[])`)
      : []
    ).map((t) => [t.id, t]),
  );
  const refs = await rows<{ id: string; status: ExistingPlanned["status"]; itinerary_ref: ItineraryRef }>(
    tx,
    sql`SELECT id, status, itinerary_ref FROM interventions
        WHERE itinerary_ref IS NOT NULL AND status <> 'cancelled' AND (itinerary_ref->>'campaign')::int = ${year}
          ${productionIds?.length ? sql`AND itinerary_ref->>'productionId' = ANY(${pgArray(productionIds)}::text[])` : sql``}`,
  );
  const read = refs.length ? await readInterventionsWhere(tx, sql`i.id = ANY(${pgArray(refs.map((r) => r.id))}::uuid[])`, 20_000) : [];
  const interventions = new Map(read.map((i) => [i.id, i]));
  const templateIds = [...new Set(withItk.flatMap((p) => itineraries.get(p.itinerary_id!)?.content.steps.map((s) => s.staffing.crewTemplateId) ?? []).filter((x): x is string => !!x))];
  const crews = new Map<string, { equipmentIds: string[]; personIds: string[] }>();
  if (templateIds.length) {
    for (const m of await rows<{ template_id: string; equipment_id: string | null; person_id: string | null }>(
      tx,
      sql`SELECT m.template_id, m.equipment_id, m.person_id FROM crew_template_members m JOIN crew_templates t ON t.id = m.template_id
          WHERE m.template_id = ANY(${pgArray(templateIds)}::uuid[]) ORDER BY m.rank`,
    )) {
      const c = crews.get(m.template_id) ?? { equipmentIds: [], personIds: [] };
      if (m.equipment_id) c.equipmentIds.push(m.equipment_id);
      if (m.person_id) c.personIds.push(m.person_id);
      crews.set(m.template_id, c);
    }
  }
  const articleIds = [...new Set([...itineraries.values()].flatMap((t) => t.content.steps.flatMap((s) => s.inputs.map((i) => i.articleId).filter((x): x is string => !!x))))];
  const articles = new Map(
    (articleIds.length
      ? await rows<{ id: string; unit: string; kind: string; density: number | null }>(
          tx,
          sql`SELECT a.id, a.unit, a.kind, f.density::float8 AS density FROM articles a LEFT JOIN article_fertilizers f ON f.article_id = a.id
              WHERE a.id = ANY(${pgArray(articleIds)}::uuid[])`,
        )
      : []
    ).map((a) => [a.id, { unit: a.unit, kind: a.kind, density: a.density }]),
  );
  return {
    articles,
    productions: withItk.map((p) => ({
      id: p.id,
      parcelId: p.parcel_id,
      parcelName: p.parcel_name,
      areaM2: Number(p.area_m2 ?? 0),
      activityName: p.activity_name,
      campaign: year,
      itineraryId: p.itinerary_id!,
      sowingOn: p.sowing_on,
      harvestOn: p.harvest_on,
    })),
    itineraries,
    existing: refs.map((r) => ({
      id: r.id,
      status: r.status,
      ref: r.itinerary_ref,
      currentHash: interventions.has(r.id) ? signatureOfIntervention(interventions.get(r.id)!) : "",
    })),
    interventions,
    crews,
    withoutItinerary: prods.length - withItk.length,
  };
}

/** Matériels et intervenants d'une proposition : attelage type déplié, sinon ceux de l'étape. */
const staffingOf = (p: PlannedProposal, crews: Loaded["crews"]) => (p.crewTemplateId && crews.get(p.crewTemplateId)) || { equipmentIds: p.equipmentIds, personIds: p.personIds };

/**
 * Intrant écrit : dose à l'hectare dans l'unité de l'article quand elle s'y
 * convertit (une unité reprise d'Ekylibre est un libellé, « Kilogramme » ; la
 * saisie d'un phyto exige l'unité de l'article, recette du 21/11), sinon dans
 * l'unité de la dose. Les semences gardent la leur (grains/m², doses…).
 */
function inputOf(i: PlannedProposal["inputs"][number], articles: Loaded["articles"]) {
  const { unit } = splitUnit(i.unit);
  const a = articles.get(i.articleId!);
  const base = { articleId: i.articleId!, per: "hectare" as const };
  if (!a || a.kind === "seed") return { ...base, quantity: i.dose, unit };
  if (unit === a.unit) return { ...base, quantity: i.dose };
  const q = convertQuantity(i.dose, unit, a.unit, a.density);
  return q !== null && q > 0 ? { ...base, quantity: Math.round(q * 1e6) / 1e6 } : { ...base, quantity: i.dose, unit };
}

/** Ce que la génération écrit (corps d'intervention prévue), pour un jour donné. */
function writeOf(p: PlannedProposal, day: string, l: Pick<Loaded, "crews" | "articles">) {
  const staff = staffingOf(p, l.crews);
  return interventionPlanWrite.parse({
    procedure: p.procedure,
    plannedAt: `${day}T06:00:00Z`,
    targets: [{ kind: "land_parcel", id: p.parcelId, ...(p.areaM2 > 0 ? { workedAreaM2: p.areaM2 } : {}) }],
    inputs: p.inputs.filter((i) => i.articleId).map((i) => inputOf(i, l.articles)),
    tools: staff.equipmentIds.map((equipmentId) => ({ equipmentId })),
    doers: staff.personIds.map((personId) => ({ personId })),
    purposes: p.purposes,
    ...(p.notes ? { notes: p.notes } : {}),
  });
}

/** Empreinte de ce que la génération écrirait, normalisée comme à la relecture (`signatureOfIntervention`). */
function signatureOfProposal(p: PlannedProposal, l: Pick<Loaded, "crews" | "articles">, day = p.day): string | null {
  if (!day) return null;
  const w = writeOf(p, day, l);
  return plannedSignature({
    procedure: p.procedure,
    day,
    targets: [{ id: p.parcelId, workedAreaM2: p.areaM2 > 0 ? p.areaM2 : null }],
    inputs: w.inputs.map((i) => ({ articleId: i.articleId, quantity: i.quantity, unit: storedUnit(i.unit ?? l.articles.get(i.articleId)?.unit ?? "", i.per) })),
    equipmentIds: w.tools.map((t) => t.equipmentId),
    personIds: w.doers.map((d) => d.personId),
  });
}

function toItem(r: ReconciledItem, l: Loaded): PlannedItem {
  if (r.proposal) {
    const { revision, stepId, occurrence, campaign, purposes, crewTemplateId, equipmentIds, personIds, people, notes, ...item } = r.proposal;
    void [stepId, occurrence, campaign, purposes, crewTemplateId, equipmentIds, personIds, people, notes];
    return { ...item, state: r.state, interventionId: r.existing?.id ?? null, itineraryChanged: !!r.existing && r.existing.ref.revision !== revision };
  }
  // Retrait : l'intervention n'est plus proposée (étape retirée, culture changée).
  const e = r.existing!;
  const i = l.interventions.get(e.id);
  const parcel = i?.targets.find((t) => t.kind === "land_parcel");
  return {
    key: `${e.ref.productionId}:${e.ref.stepId}:${e.ref.occurrence}`,
    state: r.state,
    productionId: e.ref.productionId,
    parcelId: parcel?.id ?? "",
    parcelName: "",
    activityName: "",
    itineraryId: e.ref.itineraryId,
    itineraryName: l.itineraries.get(e.ref.itineraryId)?.name ?? "",
    procedure: i?.procedure ?? "",
    label: i ? getProcedure(i.procedure).label : "",
    day: i?.startedAt ? parisDay(i.startedAt) : null,
    areaM2: parcel?.workedAreaM2 ?? 0,
    optional: false,
    inputs: [],
    interventionId: e.id,
    itineraryChanged: false,
  };
}

async function previewInTx(tx: Tx, year: number, productionIds?: string[]): Promise<{ preview: PlannedPreview; reconciled: ReconciledItem[]; loaded: Loaded }> {
  const loaded = await load(tx, year, productionIds);
  const proposals = proposeInterventions(loaded.productions, loaded.itineraries);
  const reconciled = reconcilePlanned(proposals, loaded.existing, (p) => signatureOfProposal(p, loaded));
  const items = reconciled.map((r) => toItem(r, loaded));
  // Noms des parcelles des retraits (production disparue ou changée).
  const missingNames = items.filter((i) => !i.parcelName && i.parcelId).map((i) => i.parcelId);
  if (missingNames.length) {
    const names = new Map((await rows<{ id: string; name: string }>(tx, sql`SELECT id, name FROM land_parcels WHERE id = ANY(${pgArray([...new Set(missingNames)])}::uuid[])`)).map((r) => [r.id, r.name]));
    for (const i of items) if (!i.parcelName) i.parcelName = names.get(i.parcelId) ?? "Parcelle";
  }
  items.sort((a, b) => a.parcelName.localeCompare(b.parcelName, "fr") || (a.day ?? "9999").localeCompare(b.day ?? "9999") || a.label.localeCompare(b.label, "fr"));
  const previewHash = plannedSignature({
    procedure: "preview",
    day: String(year),
    targets: reconciled.map((r) => ({ id: `${r.proposal?.key ?? r.existing!.id}|${r.state}|${r.hash ?? ""}|${r.existing?.currentHash ?? ""}`, workedAreaM2: null })),
    inputs: [],
    equipmentIds: [],
    personIds: [],
  });
  return { preview: { year, items, withoutItinerary: loaded.withoutItinerary, previewHash }, reconciled, loaded };
}

export async function previewPlanned(db: Database, farmId: string, year: number, productionIds?: string[]): Promise<PlannedPreview> {
  return withFarm(db, farmId, async (tx) => (await previewInTx(tx, year, productionIds)).preview);
}

const cancel = (tx: Tx, id: string) => tx.execute(sql`UPDATE interventions SET status = 'cancelled', updated_at = now() WHERE id = ${id} AND status = 'planned'`);

/** Confirmation : crée, refait ou retire ce qui est accepté ; rien d'autre ne bouge. */
export async function confirmPlanned(db: Database, farmId: string, year: number, ctx: DomainCtx, body: z.output<typeof plannedConfirmWrite>): Promise<PlannedConfirmResult> {
  return withFarm(db, farmId, async (tx) => {
    // Sérialise deux confirmations concurrentes de la même ferme.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`planned:${farmId}:${year}`}))`);
    const { preview, reconciled, loaded } = await previewInTx(tx, year, body.productionIds);
    if (preview.previewHash !== body.previewHash) throw new StalePlanned(preview);
    const accepted = new Set(body.accepted);
    const result: PlannedConfirmResult = { created: 0, updated: 0, removed: 0, failed: [] };
    for (const r of reconciled) {
      const key = r.proposal?.key ?? `${r.existing!.ref.productionId}:${r.existing!.ref.stepId}:${r.existing!.ref.occurrence}`;
      if (!accepted.has(key)) continue;
      if (r.state === "remove") {
        await cancel(tx, r.existing!.id);
        result.removed++;
        continue;
      }
      if (r.state !== "create" && r.state !== "update") continue;
      const p = r.proposal!;
      const edited = body.dateEdits[key];
      const day = edited ?? p.day!;
      try {
        await tx.transaction(async (sp) => {
          if (r.state === "update") await cancel(sp, r.existing!.id);
          const { intervention } = await planInTx(sp, farmId, ctx, { ...writeOf(p, day, loaded), id: ctx.newId() });
          // Empreinte de la proposition non modifiée : une date changée dans l'aperçu compte comme une modification à la main.
          const ref: ItineraryRef = { itineraryId: p.itineraryId, revision: p.revision, stepId: p.stepId, occurrence: p.occurrence, productionId: p.productionId, campaign: p.campaign, hash: signatureOfProposal(p, loaded)! };
          await sp.execute(sql`UPDATE interventions SET itinerary_ref = ${JSON.stringify(ref)}::jsonb WHERE id = ${intervention.id}`);
        });
        if (r.state === "update") result.updated++;
        else result.created++;
      } catch (err) {
        result.failed.push({ key, message: `${p.parcelName} · ${p.label} : ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    return result;
  });
}
