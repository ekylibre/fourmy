import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import { PROCEDURE_LABELS, type OfficialRegister, type PhytoRegisterEntry } from "@fourmy/contracts";
import { officialRegisterLine } from "@fourmy/domain";

/** Registre phytosanitaire d'une campagne (vue calculée, jamais saisie — FR-REG-1). */
export async function phytoRegister(db: Database, farmId: string, year: number): Promise<PhytoRegisterEntry[]> {
  return withFarm(db, farmId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT intervention_id, done_at, parcel_name, area_m2::float8 AS area_m2, crop,
             product_name, amm, quantity::float8 AS quantity, unit, applicators
      FROM phyto_register
      WHERE extract(year FROM done_at)::int = ${year}
      ORDER BY done_at, parcel_name, product_name`)) as unknown as {
      intervention_id: string;
      done_at: Date | string;
      parcel_name: string;
      area_m2: number;
      crop: string | null;
      product_name: string;
      amm: string | null;
      quantity: number | null;
      unit: string | null;
      applicators: string[];
    }[];
    return rows.map((r) => ({
      interventionId: r.intervention_id,
      doneOn: new Date(r.done_at).toISOString(),
      parcelName: r.parcel_name,
      areaM2: r.area_m2,
      crop: r.crop ?? undefined,
      productName: r.product_name,
      amm: r.amm ?? undefined,
      quantity: r.quantity ?? 0,
      unit: r.unit ?? "",
      applicators: r.applicators,
    }));
  });
}

/** Export CSV (séparateur « ; », décimales françaises — lisible par un tableur FR). */
export function phytoRegisterCsv(entries: PhytoRegisterEntry[]): string {
  const fr = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["Date", "Parcelle", "Surface (ha)", "Culture", "Produit", "N° AMM", "Dose", "Unité", "Applicateur"];
  const lines = entries.map((e) =>
    [
      e.doneOn.slice(0, 10),
      e.parcelName,
      fr(e.areaM2 / 10_000),
      e.crop ?? "",
      e.productName,
      e.amm ?? "",
      fr(e.quantity, 3),
      e.unit,
      e.applicators.join(", ") || "non renseigné",
    ]
      .map((v) => cell(String(v)))
      .join(";"),
  );
  return [header.join(";"), ...lines].join("\r\n") + "\r\n";
}

/**
 * Registre au format réglementaire (lot X) : une ligne par produit phyto et
 * par parcelle traitée des interventions réalisées de l'année. Surface
 * traitée = zone travaillée, sinon la parcelle à la date ; culture = code
 * OEPP de l'activité de la production (choisi ou proposé) ; bio = parcelle
 * certifiée à la date ; cible = usage E-Phy retenu par le contrôle.
 */
export async function officialPhytoRegister(db: Database, farmId: string, year: number): Promise<OfficialRegister> {
  return withFarm(db, farmId, async (tx) => {
    const [farm] = (await tx.execute(sql`SELECT name, siret, pacage FROM farms WHERE id = ${farmId}`)) as unknown as {
      name: string;
      siret: string | null;
      pacage: string | null;
    }[];
    const raw = (await tx.execute(sql`
      WITH done AS (
        SELECT i.* FROM interventions i
        WHERE i.status = 'done' AND extract(year FROM i.stopped_at)::int = ${year}
      ),
      span AS (
        SELECT p.intervention_id, min(p.started_at) AS started_at, max(p.stopped_at) AS stopped_at
        FROM intervention_periods p JOIN done d ON d.id = p.intervention_id GROUP BY 1
      ),
      tgt AS (
        SELECT t.id, t.intervention_id, t.ref_id AS parcel_id, lp.name AS parcel_name, v.area_m2::float8 AS parcel_m2,
               coalesce((t.attrs->>'workedAreaM2')::float8, v.area_m2::float8) AS treated_m2,
               ST_Y(ST_PointOnSurface(v.shape)) AS lat, ST_X(ST_PointOnSurface(v.shape)) AS lon
        FROM intervention_parameters t
        JOIN done d ON d.id = t.intervention_id
        JOIN land_parcel_versions v ON v.land_parcel_id = t.ref_id AND v.valid @> d.stopped_at
        JOIN land_parcels lp ON lp.id = t.ref_id
        WHERE t.role = 'target' AND t.ref_type = 'land_parcel'
      ),
      total AS (SELECT intervention_id, sum(treated_m2) AS m2 FROM tgt GROUP BY 1)
      SELECT inp.id AS input_id, tgt.id AS target_id, d.id AS intervention_id, d.procedure,
             coalesce(span.started_at, d.started_at) AS started_at, coalesce(span.stopped_at, d.stopped_at) AS stopped_at,
             a.name AS product_name, a.amm, inp.quantity::float8 AS quantity, inp.unit,
             total.m2 AS intervention_m2, tgt.treated_m2, tgt.parcel_m2, tgt.lat, tgt.lon, tgt.parcel_id, tgt.parcel_name,
             prod.activity_id, crop.oepp AS crop_oepp, st.label AS bbch_label,
             EXISTS (SELECT 1 FROM parcel_certifications pc
                     WHERE pc.land_parcel_id = tgt.parcel_id AND pc.kind = 'organic'
                       AND pc.started_on <= d.stopped_at::date AND (pc.stopped_on IS NULL OR pc.stopped_on >= d.stopped_at::date)) AS organic,
             (SELECT u.target_label FROM jsonb_array_elements(coalesce(d.compliance->'checks', '[]')) c
                JOIN phyto_usages u ON u.id = c->>'usageId'
               WHERE c->>'articleId' = a.id::text LIMIT 1) AS usage_target
      FROM done d
      JOIN intervention_parameters inp ON inp.intervention_id = d.id AND inp.role = 'input' AND inp.ref_type = 'article'
      JOIN articles a ON a.id = inp.ref_id AND a.kind = 'phyto'
      JOIN tgt ON tgt.intervention_id = d.id
      JOIN total ON total.intervention_id = d.id
      LEFT JOIN span ON span.intervention_id = d.id
      LEFT JOIN ref_bbch_stages st ON st.code = d.bbch
      -- Culture en place le jour du traitement (productions datées, sinon celle de la campagne).
      LEFT JOIN LATERAL (
        SELECT p.activity_id FROM productions p
        WHERE p.id = fourmy_production_at(tgt.parcel_id, (coalesce(span.started_at, d.stopped_at) AT TIME ZONE 'Europe/Paris')::date)
      ) prod ON true
      LEFT JOIN ref_phyto_crops crop ON crop.code = fourmy_activity_crop(prod.activity_id)
      ORDER BY coalesce(span.started_at, d.started_at), d.id, a.name, tgt.parcel_id`)) as unknown as {
      input_id: string;
      target_id: string;
      intervention_id: string;
      procedure: string;
      started_at: Date | string | null;
      stopped_at: Date | string | null;
      product_name: string;
      amm: string | null;
      quantity: number | null;
      unit: string | null;
      intervention_m2: number;
      treated_m2: number;
      parcel_m2: number;
      lat: number | null;
      lon: number | null;
      parcel_id: string;
      parcel_name: string;
      activity_id: string | null;
      crop_oepp: string | null;
      bbch_label: string | null;
      organic: boolean;
      usage_target: string | null;
    }[];
    const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
    return {
      campaign: year,
      holder: { name: farm?.name ?? "", siret: farm?.siret ?? null, pacage: farm?.pacage ?? null },
      generatedAt: new Date().toISOString(),
      lines: raw.map((r) =>
        officialRegisterLine({
          inputId: r.input_id,
          targetId: r.target_id,
          interventionId: r.intervention_id,
          landParcelId: r.parcel_id,
          parcelName: r.parcel_name,
          activityId: r.activity_id,
          procedureLabel: PROCEDURE_LABELS[r.procedure] ?? r.procedure,
          startedAt: iso(r.started_at),
          stoppedAt: iso(r.stopped_at),
          productName: r.product_name,
          amm: r.amm,
          quantity: r.quantity,
          unit: r.unit,
          interventionAreaM2: Number(r.intervention_m2),
          treatedAreaM2: Number(r.treated_m2),
          parcelAreaM2: Number(r.parcel_m2),
          lat: r.lat,
          lon: r.lon,
          cropOepp: r.crop_oepp,
          bbchLabel: r.bbch_label,
          organic: r.organic,
          usageTarget: r.usage_target,
          siret: farm?.siret ?? null,
          pacage: farm?.pacage ?? null,
          campaign: year,
        }),
      ),
    };
  });
}
