import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import type { PhytoRegisterEntry } from "@fourmy/contracts";

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
