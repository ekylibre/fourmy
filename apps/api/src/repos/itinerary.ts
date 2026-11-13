import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  ACTIVITY_FAMILY_LABELS,
  getProcedure,
  PLANT_FAMILIES,
  TREATMENT_PURPOSE_LABELS,
  unitLabel,
  type ActivityFamily,
  type ActivityItinerary,
  type Intervention,
  type ItineraryDetail,
  type TechnicalItinerary,
} from "@fourmy/contracts";
import { buildActivityItinerary, buildParcelItinerary, parisDay, type CampaignWindow, type ItineraryIntervention, type ParcelCampaignInput } from "@fourmy/domain";
import { NotFound } from "../routes/helpers.js";
import { readInterventionsWhere } from "./interventions.js";

/**
 * Itinéraires techniques (claudedocs/conception_itineraires_techniques.md §5) :
 * lecture des productions, couverts et interventions d'une parcelle ou d'une
 * activité, libellés résolus, puis règles du domaine. Activités végétales
 * seulement (élevage exclu, décision 6 des besoins).
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const pgArray = (values: string[]) => `{${values.join(",")}}`;

/** Fenêtres des campagnes (table `campaigns`, sinon l'année civile), en jours. */
async function windows(tx: Tx, years: number[]): Promise<CampaignWindow[]> {
  const found = await rows<{ year: number; from: string; to: string }>(
    tx,
    sql`SELECT DISTINCT ON (year) year, starts_on::text AS from, (stops_on + 1)::text AS to
        FROM campaigns WHERE year = ANY(${`{${years.join(",")}}`}::int[]) ORDER BY year, starts_on`,
  );
  return years.map((year) => {
    const c = found.find((f) => f.year === year);
    return { year, from: c?.from ?? `${year}-01-01`, to: c?.to ?? `${year + 1}-01-01` };
  });
}

const fr = (n: number, digits = 2) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
const ha = (m2: number) => `${fr(m2 / 10_000)} ha`;
const frDay = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

interface Names {
  articles: Map<string, string>;
  equipments: Map<string, string>;
  people: Map<string, string>;
  parcels: Map<string, { name: string; areaM2: number }>;
}

/** Libellés de tous les objets cités : une requête par type, pas une par intervention. */
async function names(tx: Tx, list: Intervention[], parcelIds: string[]): Promise<Names> {
  // Des identifiants peuvent manquer (matériel d'un attelage repris sans fiche) : écartés.
  const ids = (pick: (i: Intervention) => (string | null | undefined)[]) => [...new Set(list.flatMap(pick))].filter((x): x is string => !!x);
  const articleIds = ids((i) => i.inputs.map((x) => x.articleId));
  const equipmentIds = ids((i) => i.tools.map((x) => x.equipmentId));
  const personIds = ids((i) => i.doers.map((x) => x.personId));
  const allParcels = [...new Set([...parcelIds, ...ids((i) => i.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id))])].filter(Boolean);
  const map = async (q: SQL) => new Map((await rows<{ id: string; name: string }>(tx, q)).map((r) => [r.id, r.name]));
  return {
    articles: articleIds.length ? await map(sql`SELECT id, name FROM articles WHERE id = ANY(${pgArray(articleIds)}::uuid[])`) : new Map(),
    equipments: equipmentIds.length ? await map(sql`SELECT id, name FROM equipments WHERE id = ANY(${pgArray(equipmentIds)}::uuid[])`) : new Map(),
    people: personIds.length
      ? await map(sql`SELECT id, coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), name) AS name FROM people WHERE id = ANY(${pgArray(personIds)}::uuid[])`)
      : new Map(),
    parcels: allParcels.length
      ? new Map(
          (
            await rows<{ id: string; name: string; area_m2: string | null }>(
              tx,
              sql`SELECT p.id, p.name, (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = p.id ORDER BY lower(v.valid) DESC LIMIT 1) AS area_m2
                  FROM land_parcels p WHERE p.id = ANY(${pgArray(allParcels)}::uuid[])`,
            )
          ).map((r) => [r.id, { name: r.name, areaM2: Number(r.area_m2 ?? 0) }]),
        )
      : new Map(),
  };
}

/** Libellé (E11) et détails en texte brut (E12) d'une intervention. */
function toItinerary(i: Intervention, n: Names): ItineraryIntervention {
  const proc = getProcedure(i.procedure);
  const products = i.inputs.map((x) => n.articles.get(x.articleId)).filter((x): x is string => !!x);
  const mainProduct = proc.shape === "treatment" || proc.shape === "fertilization" || proc.shape === "sowing" ? products[0] : undefined;
  const parcels = i.targets.filter((t) => t.kind === "land_parcel").map((t) => ({ id: t.id, ...(n.parcels.get(t.id) ?? { name: "Parcelle", areaM2: 0 }), worked: t.workedAreaM2 }));
  const at = i.startedAt ?? i.stoppedAt ?? i.createdAt;
  const details: ItineraryDetail[] = [];
  const day = (iso: string) => parisDay(iso);
  details.push({ label: "Date", value: i.startedAt && i.stoppedAt && day(i.startedAt) !== day(i.stoppedAt) ? `du ${frDay(i.startedAt)} au ${frDay(i.stoppedAt)}` : frDay(at) });
  if (i.status === "planned") details.push({ label: "Statut", value: "prévue" });
  if (i.workDurationS) details.push({ label: "Durée de travail", value: `${fr(i.workDurationS / 3600, 1)} h` });
  if (parcels.length) details.push({ label: "Parcelles", value: parcels.map((p) => `${p.name} (${ha(p.worked ?? p.areaM2)})`).join(", ") });
  if (i.inputs.length)
    details.push({
      label: "Intrants",
      value: i.inputs.map((x) => `${n.articles.get(x.articleId) ?? "Article"} ${fr(x.quantity, 3)} ${unitLabel(x.unit)}${x.per === "hectare" && !x.unit.includes("_per_") ? "/ha" : ""}`).join(" ; "),
    });
  if (i.irrigation) details.push({ label: "Irrigation", value: `${fr(i.irrigation.depthMm, 1)} mm` });
  const tools = i.tools.map((x) => n.equipments.get(x.equipmentId)).filter((x): x is string => !!x);
  if (tools.length) details.push({ label: "Matériels", value: tools.join(", ") });
  const doers = i.doers.map((x) => n.people.get(x.personId)).filter((x): x is string => !!x);
  if (doers.length) details.push({ label: "Équipe", value: doers.join(", ") });
  if (i.bbch) details.push({ label: "Stade BBCH", value: `${i.bbch.code} ${i.bbch.label}` });
  if (i.purposes.length) details.push({ label: "Cibles", value: i.purposes.map((p) => TREATMENT_PURPOSE_LABELS[p] ?? p).join(", ") });
  if (i.ift?.total != null) details.push({ label: "IFT", value: fr(i.ift.total) });
  if (i.weather && (i.weather.temperatureC != null || i.weather.windKmh != null)) {
    const parts = [i.weather.temperatureC != null ? `${fr(i.weather.temperatureC, 1)} °C` : null, i.weather.windKmh != null ? `vent ${fr(i.weather.windKmh, 0)} km/h` : null];
    details.push({ label: "Météo", value: parts.filter(Boolean).join(", ") });
  }
  if (i.notes) details.push({ label: "Notes", value: i.notes });
  return {
    id: i.id,
    procedure: i.procedure,
    status: i.status === "planned" ? "planned" : "done",
    at,
    irrigation: !!i.irrigation,
    label: mainProduct ? `${proc.label} · ${mainProduct}` : proc.label,
    details,
    parcels: parcels.map((p) => ({ id: p.id, name: p.name })),
  };
}

/** Interventions non annulées qui ciblent l'une des parcelles, dans la fenêtre. */
async function interventionsOn(tx: Tx, parcelIds: string[], from: string, to: string): Promise<Intervention[]> {
  return readInterventionsWhere(
    tx,
    sql`i.status <> 'cancelled'
        AND EXISTS (SELECT 1 FROM intervention_parameters t
                    WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
                      AND t.ref_id = ANY(${pgArray(parcelIds)}::uuid[]))
        AND coalesce(i.started_at, i.stopped_at, i.created_at) >= ${from}::timestamptz
        AND coalesce(i.started_at, i.stopped_at, i.created_at) < ${to}::timestamptz`,
    20_000,
  );
}

/** Bornes ISO d'une suite de fenêtres : minuit à Paris, approché par le jour en UTC moins une marge d'un jour. */
const isoBounds = (ws: CampaignWindow[]) => ({
  from: new Date(Date.parse(`${ws[0]!.from}T00:00:00Z`) - 86_400_000).toISOString(),
  to: new Date(Date.parse(`${ws.at(-1)!.to}T00:00:00Z`) + 86_400_000).toISOString(),
});

type ProductionRow = { year: number; activity_id: string | null; name: string | null; color: string | null; family: ActivityFamily | null; species: string | null };

/** Itinéraire d'une parcelle (E4, E5) : `years` campagnes jusqu'à `year`. */
export async function parcelItinerary(db: Database, farmId: string, parcelId: string, year: number, years: number): Promise<TechnicalItinerary> {
  return withFarm(db, farmId, async (tx) => {
    const [parcel] = await rows<{ name: string }>(tx, sql`SELECT name FROM land_parcels WHERE id = ${parcelId}`);
    if (!parcel) throw new NotFound("Parcelle introuvable");
    const list = Array.from({ length: years }, (_, k) => year - years + 1 + k);
    const ws = await windows(tx, list);
    const productions = await rows<ProductionRow>(
      tx,
      sql`SELECT c.year, p.activity_id, a.name, a.color, a.family, p.species
          FROM productions p JOIN campaigns c ON c.id = p.campaign_id LEFT JOIN activities a ON a.id = p.activity_id
          WHERE p.land_parcel_id = ${parcelId} AND c.year = ANY(${`{${list.join(",")}}`}::int[])
          ORDER BY c.year, a.name`,
    );
    const covers = await rows<{ campaign: number; species: string; sown_on: string; destroyed_on: string | null; exported: boolean }>(
      tx,
      sql`SELECT campaign, species, sown_on::text, destroyed_on::text, exported FROM cover_crops
          WHERE land_parcel_id = ${parcelId} AND campaign = ANY(${`{${list.join(",")}}`}::int[])`,
    );
    // Les interventions d'un couvert peuvent précéder la première fenêtre (semis d'été).
    const bounds = isoBounds(ws);
    const firstCover = covers.map((c) => c.sown_on).sort()[0];
    const from = firstCover && `${firstCover}T00:00:00Z` < bounds.from ? new Date(Date.parse(`${firstCover}T00:00:00Z`) - 86_400_000).toISOString() : bounds.from;
    const interventions = await interventionsOn(tx, [parcelId], from, bounds.to);
    const n = await names(tx, interventions, [parcelId]);
    const area = n.parcels.get(parcelId)?.areaM2 ?? 0;
    const campaigns: ParcelCampaignInput[] = ws.map((w) => {
      const crops = productions
        .filter((p) => p.year === w.year && (!p.family || PLANT_FAMILIES.includes(p.family)))
        .map((p) => ({
          name: p.name ?? p.species ?? "Culture",
          color: p.color,
          attributes: [
            ...(p.family ? [{ label: "Famille", value: ACTIVITY_FAMILY_LABELS[p.family] }] : []),
            ...(area ? [{ label: "Surface", value: ha(area) }] : []),
          ],
        }));
      const cover = covers.find((c) => c.campaign === w.year);
      return {
        window: w,
        crops,
        cover: cover
          ? {
              name: `Couvert : ${cover.species}`,
              sownOn: cover.sown_on,
              destroyedOn: cover.destroyed_on,
              attributes: [{ label: "Type", value: cover.exported ? "CIE (exporté)" : "CINE (non exporté)" }],
            }
          : null,
      };
    });
    return buildParcelItinerary({ title: parcel.name, campaigns, interventions: interventions.map((i) => toItinerary(i, n)) });
  });
}

/** Vue fusionnée d'une activité végétale pour une campagne (E8 à E10). */
export async function activityItinerary(db: Database, farmId: string, activityId: string, year: number): Promise<ActivityItinerary> {
  return withFarm(db, farmId, async (tx) => {
    const [activity] = await rows<{ name: string; color: string | null; family: ActivityFamily }>(tx, sql`SELECT name, color, family FROM activities WHERE id = ${activityId}`);
    if (!activity || !PLANT_FAMILIES.includes(activity.family)) throw new NotFound("Activité végétale introuvable");
    const [w] = await windows(tx, [year]);
    const parcelRows = await rows<{ id: string }>(
      tx,
      sql`SELECT DISTINCT p.land_parcel_id AS id FROM productions p JOIN campaigns c ON c.id = p.campaign_id
          WHERE p.activity_id = ${activityId} AND c.year = ${year}`,
    );
    const parcelIds = parcelRows.map((r) => r.id);
    const bounds = isoBounds([w!]);
    const interventions = parcelIds.length ? await interventionsOn(tx, parcelIds, bounds.from, bounds.to) : [];
    const n = await names(tx, interventions, parcelIds);
    const parcels = parcelIds.map((id) => ({ id, name: n.parcels.get(id)?.name ?? "Parcelle", areaM2: n.parcels.get(id)?.areaM2 ?? 0 }));
    const total = parcels.reduce((s, p) => s + p.areaM2, 0);
    return buildActivityItinerary({
      title: `${activity.name} ${year}`,
      window: w!,
      crop: {
        name: activity.name,
        color: activity.color,
        attributes: [
          { label: "Famille", value: ACTIVITY_FAMILY_LABELS[activity.family] },
          { label: "Parcelles", value: `${parcels.length} (${ha(total)})` },
        ],
      },
      parcels,
      interventions: interventions.map((i) => toItinerary(i, n)),
    });
  });
}
