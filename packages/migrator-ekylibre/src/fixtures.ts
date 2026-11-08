import postgres from "postgres";
import { uuidv5 } from "./ids.js";

/**
 * Export d'une ferme migrée en **fixture anonymisée** (NFR-DEV-4).
 *
 * - Noms de ferme, parcelles, bâtiments, matériels et codes de lots remplacés.
 * - Tous les identifiants remappés (UUID v5 propres à la fixture) : aucun lien
 *   avec les identifiants dérivés du tenant d'origine.
 * - Géométries et données agronomiques conservées (décision du 2026-11-07),
 *   coordonnées alignées au micro-degré (~0,1 m).
 * - Personnes : jamais migrées, donc absentes.
 *
 * Le fichier embarque les valeurs attendues (registre phyto par année,
 * volumes) pour que la CI vérifie la vue du registre sur données réelles.
 */

export interface Fixture {
  meta: {
    label: string;
    description: string;
    exportedAt: string;
    expected: {
      counts: Record<string, number>;
      phytoRowsByYear: Record<string, number>;
    };
  };
  /** Lignes par table, dans l'ordre de chargement (dépendances d'abord). */
  tables: Record<string, Record<string, unknown>[]>;
}

/** Ordre de chargement (clés étrangères). */
export const FIXTURE_TABLES = [
  "farms",
  "campaigns",
  "land_parcels",
  "land_parcel_versions",
  "activities",
  "productions",
  "places",
  "place_versions",
  "containers",
  "container_versions",
  "equipments",
  "articles",
  "lots",
  "lot_lineage",
  "people",
  "interventions",
  "intervention_periods",
  "intervention_parameters",
  "stock_movements",
] as const;

const snap = (col: string) => `ST_AsEWKT(ST_SnapToGrid(${col}, 0.000001))`;

/** Requête d'export par table : toutes les colonnes + surcharges d'anonymisation. */
function exportQuery(table: (typeof FIXTURE_TABLES)[number], label: string): string {
  const l = label.replace(/'/g, "''");
  const rank = (alias: string) => `row_number() OVER (ORDER BY ${alias}.id)`;
  switch (table) {
    case "farms":
      return `SELECT to_jsonb(t) || jsonb_build_object('name', 'Ferme pilote — ${l}')
              FROM farms t WHERE t.id = $1`;
    case "land_parcels":
      return `SELECT to_jsonb(t) || jsonb_build_object('name', 'Parcelle ' || lpad(${rank("t")}::text, 3, '0'))
              FROM land_parcels t WHERE t.farm_id = $1`;
    case "land_parcel_versions":
      return `SELECT to_jsonb(t) || jsonb_build_object('shape', ${snap("t.shape")})
              FROM land_parcel_versions t JOIN land_parcels p ON p.id = t.land_parcel_id WHERE p.farm_id = $1`;
    case "places":
      return `SELECT to_jsonb(t) || jsonb_build_object('name',
                CASE WHEN t.name LIKE '%(migration)%' THEN t.name ELSE 'Bâtiment ' || ${rank("t")} END)
              FROM places t WHERE t.farm_id = $1`;
    case "place_versions":
      // Hauteurs : dérivées de la BD TOPO dans Fourmy, jamais issues d'Ekylibre → recalculées.
      return `SELECT to_jsonb(t) || jsonb_build_object('height_m', NULL, 'footprint',
                CASE WHEN t.footprint IS NULL THEN NULL ELSE ${snap("t.footprint")} END)
              FROM place_versions t JOIN places p ON p.id = t.place_id WHERE p.farm_id = $1`;
    case "container_versions":
      return `SELECT to_jsonb(t) FROM container_versions t
              JOIN containers c ON c.id = t.container_id WHERE c.farm_id = $1`;
    case "equipments":
      return `SELECT to_jsonb(t) || jsonb_build_object('name', initcap(replace(t.kind, '_', ' ')) || ' ' || ${rank("t")})
              FROM equipments t WHERE t.farm_id = $1`;
    case "lots":
      return `SELECT to_jsonb(t) || jsonb_build_object('code', 'LOT-' || lpad(${rank("t")}::text, 4, '0'))
              FROM lots t WHERE t.farm_id = $1`;
    case "lot_lineage":
      return `SELECT to_jsonb(t) FROM lot_lineage t JOIN lots l ON l.id = t.child_lot_id WHERE l.farm_id = $1`;
    case "people":
      return `SELECT to_jsonb(t) || jsonb_build_object('name', 'Personne ' || ${rank("t")}, 'user_id', NULL)
              FROM people t WHERE t.farm_id = $1`;
    case "intervention_periods":
      return `SELECT to_jsonb(t) FROM intervention_periods t
              JOIN interventions i ON i.id = t.intervention_id WHERE i.farm_id = $1`;
    case "intervention_parameters":
      return `SELECT to_jsonb(t) || jsonb_build_object('working_zone',
                CASE WHEN t.working_zone IS NULL THEN NULL ELSE ${snap("t.working_zone")} END)
              FROM intervention_parameters t JOIN interventions i ON i.id = t.intervention_id
              WHERE i.farm_id = $1`;
    default:
      return `SELECT to_jsonb(t) FROM ${table} t WHERE t.farm_id = $1`;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remplace récursivement chaque UUID par un UUID v5 propre à la fixture (intégrité préservée). */
function remapIds<T>(value: T, label: string): T {
  const map = (v: unknown): unknown => {
    if (typeof v === "string") return UUID.test(v) ? uuidv5(`fixture:${label}:${v.toLowerCase()}`) : v;
    if (Array.isArray(v)) return v.map(map);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)]));
    }
    return v;
  };
  return map(value) as T;
}

export async function exportFixture(
  targetUrl: string,
  farmId: string,
  label: string,
  description: string,
): Promise<Fixture> {
  const sql = postgres(targetUrl, { max: 1, onnotice: () => {} });
  try {
    const tables: Fixture["tables"] = {};
    const counts: Record<string, number> = {};
    for (const table of FIXTURE_TABLES) {
      const rows = await sql.unsafe<{ row: Record<string, unknown> }[]>(
        `SELECT q.r AS row FROM (${exportQuery(table, label)}) AS q(r)`,
        [farmId],
      );
      tables[table] = rows.map((r) => r.row);
      counts[table] = rows.length;
    }
    const phyto = await sql<{ year: number; rows: string }[]>`
      SELECT extract(year FROM done_at)::int AS year, count(*) AS rows
      FROM phyto_register WHERE farm_id = ${farmId} GROUP BY 1 ORDER BY 1`;
    const fixture: Fixture = {
      meta: {
        label,
        description,
        exportedAt: new Date().toISOString(),
        expected: {
          counts,
          phytoRowsByYear: Object.fromEntries(phyto.map((p) => [String(p.year), Number(p.rows)])),
        },
      },
      tables,
    };
    return remapIds(fixture, label);
  } finally {
    await sql.end();
  }
}
