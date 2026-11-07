import postgres, { type Sql } from "postgres";
import { signedQuantity, buildEvent, type DomainCtx } from "@fourmy/domain";
import { idsFor, uuidv5 } from "./ids.js";
import * as x from "./extract.js";
import {
  toLiters,
  articleKind,
  productionNature,
  interventionStatus,
  parameterRole,
  containerKind,
  capacityFromLabel,
} from "./rules.js";

/**
 * Migration d'une instance Ekylibre (base source restaurée en lecture seule)
 * vers Fourmy. Idempotente : identifiants UUID v5 déterministes et
 * `ON CONFLICT DO UPDATE`. Écrit sous contexte de ferme (rôle fourmy_app +
 * RLS), produit un rapport dans `import_runs` (FR-MIG-3).
 */

export interface MigrateOptions {
  sourceUrl: string;
  targetUrl: string;
  /** Schéma du tenant ; lu dans le commentaire de la base source si absent. */
  tenant?: string;
  farmName?: string;
}

export interface Report {
  runId: string;
  farmId: string;
  tenant: string;
  ekylibreVersion: string | null;
  counts: Record<string, number>;
  rejected: { entity: string; id: string; reason: string }[];
  /** Données migrées telles quelles mais suspectes, à vérifier par l'exploitant. */
  warnings: { entity: string; id: string; message: string }[];
  phyto: { year: number; ekylibre: number; fourmy: number }[];
}

const FAR_PAST = "1900-01-01T00:00:00Z";
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const num = (v: string | null) => (v === null || v === "" ? null : Number(v));
const geo = (g: unknown) => JSON.stringify(g);

async function sourceInfo(sql: Sql): Promise<{ tenant: string | null; version: string | null }> {
  const rows = await sql<{ c: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = current_database()`;
  const c = rows[0]?.c ?? "";
  return {
    tenant: /tenant=(\S+)/.exec(c)?.[1] ?? null,
    version: /version=(.+)$/.exec(c)?.[1] ?? null,
  };
}

export async function migrate(opts: MigrateOptions): Promise<Report> {
  const source = postgres(opts.sourceUrl, { max: 1, onnotice: () => {} });
  const target = postgres(opts.targetUrl, { max: 1, onnotice: () => {} });
  try {
    const info = await sourceInfo(source);
    const tenant = opts.tenant ?? info.tenant;
    if (!tenant) throw new Error("Tenant inconnu : passer --tenant ou restaurer avec restore-source.sh");
    const src: x.Source = { sql: source, tenant };
    const instance = `ekylibre:${tenant}`;
    const id = idsFor(instance);
    const farmId = id("farm", tenant);

    // ---- Extraction (lecture seule) -------------------------------------
    const data = await x.read(src, async (s) => ({
      campaigns: await x.campaigns(s),
      landParcels: await x.landParcels(s),
      productions: await x.productions(s),
      places: await x.places(s),
      containers: await x.containers(s),
      equipments: await x.equipments(s),
      matters: await x.matters(s),
      interventions: await x.interventions(s),
      parameters: await x.parameters(s),
      harvests: await x.harvests(s),
      phytoRef: await x.phytoReference(s),
    }));

    const runId = uuidv5(`${instance}:run:${new Date().toISOString()}`);
    await target`INSERT INTO import_runs (id, source, status) VALUES (${runId}, ${instance}, 'running')`;

    const counts: Record<string, number> = {};
    const rejected: Report["rejected"] = [];
    const warnings: Report["warnings"] = [];
    const inc = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    const reject = (entity: string, eid: string | number, reason: string) =>
      rejected.push({ entity, id: String(eid), reason });

    const ctx: DomainCtx = {
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
      actor: "migrator-ekylibre",
      origin: "migration",
    };

    try {
      await target.begin(async (tx) => {
        await tx`SET LOCAL ROLE fourmy_app`;
        await tx`SELECT set_config('fourmy.farm_id', ${farmId}, true)`;

        // ---- Ferme et campagnes -------------------------------------------
        await tx`
          INSERT INTO farms (id, name) VALUES (${farmId}, ${opts.farmName ?? tenant})
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = now()`;
        inc("farms");

        const campaignByYear = new Map<number, string>();
        for (const c of data.campaigns) {
          const cid = id("campaigns", c.id);
          campaignByYear.set(c.harvest_year, cid);
          await tx`
            INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on)
            VALUES (${cid}, ${farmId}, ${c.harvest_year},
                    ${`${c.harvest_year}-01-01`}, ${`${c.harvest_year}-12-31`})
            ON CONFLICT (id) DO UPDATE SET year = excluded.year`;
          inc("campaigns");
        }

        // ---- Parcellaire (avec attributs viti issus des productions vigne) --
        const vitiBySupport = new Map<number, string>();
        for (const p of data.productions) {
          if (p.family === "vine_farming" && p.support_id && p.plant_variety) {
            vitiBySupport.set(p.support_id, p.plant_variety);
          }
        }
        const migratedParcels = new Set<number>();
        for (const lp of data.landParcels) {
          if (!lp.shape) {
            reject("land_parcel", lp.id, "géométrie absente");
            continue;
          }
          const pid = id("products", lp.id);
          const lower = iso(lp.born_at) ?? FAR_PAST;
          let upper = iso(lp.dead_at);
          if (upper && upper <= lower) upper = null;
          const variety = vitiBySupport.get(lp.id);
          await tx`
            INSERT INTO land_parcels (id, farm_id, name) VALUES (${pid}, ${farmId}, ${lp.name})
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = now()`;
          await tx`
            INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, pac_islet, viti, valid)
            VALUES (
              ${id("land_parcel_versions", lp.id)}, ${pid},
              ST_SetSRID(ST_GeomFromGeoJSON(${geo(lp.shape)}), 4326),
              ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(${geo(lp.shape)}), 4326)::geography),
              ${lp.work_number},
              ${variety ? tx.json({ variety }) : null},
              tstzrange(${lower}::timestamptz, ${upper}::timestamptz))
            ON CONFLICT (id) DO UPDATE SET
              shape = excluded.shape, area_m2 = excluded.area_m2,
              pac_islet = excluded.pac_islet, viti = excluded.viti,
              valid = tstzrange(lower(excluded.valid), coalesce(upper(land_parcel_versions.valid), upper(excluded.valid)))
            WHERE NOT EXISTS (SELECT 1 FROM audit_log a
              WHERE a.entity_id = land_parcel_versions.id AND a.action = 'corrected')`;
          migratedParcels.add(lp.id);
          inc("land_parcels");
        }

        // ---- Productions ---------------------------------------------------
        for (const p of data.productions) {
          const nature = productionNature(p.family);
          if (!nature) {
            reject("production", p.id, `famille d'activité non migrée : ${p.family}`);
            continue;
          }
          if (!p.support_id || !migratedParcels.has(p.support_id)) {
            reject("production", p.id, "parcelle support absente ou non migrée");
            continue;
          }
          // Production annuelle : une campagne. Pérenne (vigne…) : pas de campagne
          // dans Ekylibre mais une période de vie → une production par campagne
          // existante comprise dans [started_on, stopped_on].
          const targets: { pid: string; campaignId: string }[] = [];
          if (p.campaign_id) {
            targets.push({ pid: id("activity_productions", p.id), campaignId: id("campaigns", p.campaign_id) });
          } else {
            const from = p.started_on ? Number(p.started_on.slice(0, 4)) : -Infinity;
            const to = p.stopped_on ? Number(p.stopped_on.slice(0, 4)) : Infinity;
            for (const [year, campaignId] of campaignByYear) {
              if (year >= from && year <= to) {
                targets.push({ pid: id("activity_productions", `${p.id}:${year}`), campaignId });
              }
            }
            if (targets.length === 0) {
              reject("production", p.id, "pérenne sans campagne couvrant sa période");
              continue;
            }
          }
          for (const t of targets) {
            await tx`
              INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, species)
              VALUES (${t.pid}, ${farmId}, ${t.campaignId}, ${id("products", p.support_id)}, ${nature},
                      ${p.plant_variety ?? p.cultivation_variety})
              ON CONFLICT (id) DO UPDATE SET nature = excluded.nature, species = excluded.species`;
            inc("productions");
          }
        }

        // ---- Bâtiments ------------------------------------------------------
        const placeIds = new Set<number>();
        const upsertPlace = async (
          pid: string,
          vid: string,
          name: string,
          kind: "building" | "room" | "storage",
          footprint: unknown | null,
          lower: string,
          upper: string | null,
        ) => {
          await tx`
            INSERT INTO places (id, farm_id, name) VALUES (${pid}, ${farmId}, ${name})
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = now()`;
          await tx`
            INSERT INTO place_versions (id, place_id, kind, footprint, height_m, source, valid)
            VALUES (${vid}, ${pid}, ${kind},
              ${footprint ? tx`ST_SetSRID(ST_GeomFromGeoJSON(${geo(footprint)}), 4326)` : null},
              NULL, 'ekylibre', tstzrange(${lower}::timestamptz, ${upper}::timestamptz))
            ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, footprint = excluded.footprint,
              valid = tstzrange(lower(excluded.valid), coalesce(upper(place_versions.valid), upper(excluded.valid)))
            WHERE NOT EXISTS (SELECT 1 FROM audit_log a
              WHERE a.entity_id = place_versions.id AND a.action = 'corrected')`;
        };
        for (const pl of data.places) {
          const lower = iso(pl.born_at) ?? FAR_PAST;
          let upper = iso(pl.dead_at);
          if (upper && upper <= lower) upper = null;
          await upsertPlace(
            id("products", pl.id),
            id("place_versions", pl.id),
            pl.name,
            pl.type === "BuildingDivision" ? "room" : "building",
            pl.footprint,
            lower,
            upper,
          );
          placeIds.add(pl.id);
          inc("places");
        }

        // Lieux de repli (déterministes) pour ce qui n'a pas de localisation.
        let fallbackStock: string | null = null;
        const stockPlace = async () => {
          if (!fallbackStock) {
            fallbackStock = id("fallback", "stock");
            await upsertPlace(fallbackStock, id("fallback_v", "stock"), "Stock non localisé (migration)",
              "storage", null, FAR_PAST, null);
            inc("places");
          }
          return fallbackStock;
        };
        let fallbackCellar: string | null = null;
        const cellarPlace = async () => {
          if (!fallbackCellar) {
            fallbackCellar = id("fallback", "cellar");
            await upsertPlace(fallbackCellar, id("fallback_v", "cellar"),
              "Cuverie — emplacement inconnu (migration)", "building", null, FAR_PAST, null);
            inc("places");
          }
          return fallbackCellar;
        };

        // ---- Contenants (cuves) --------------------------------------------
        const correctedVersions = new Set(
          (await tx<{ id: string }[]>`
            SELECT DISTINCT entity_id::text AS id FROM audit_log
            WHERE action = 'corrected' AND entity = 'container_versions'`).map((r) => r.id),
        );
        const containerIds = new Set<number>();
        for (const c of data.containers) {
          const kind = containerKind(c.variety);
          const capacity = toLiters(num(c.capacity_value), c.capacity_unit);
          if (!kind) continue;
          if (capacity === null || capacity <= 0) {
            reject("container", c.id, `capacité inconnue (${c.capacity_value ?? "?"} ${c.capacity_unit ?? ""})`);
            continue;
          }
          const announced = capacityFromLabel(c.variant_name);
          if (announced !== null && Math.abs(announced - capacity) / announced > 0.01) {
            warnings.push({
              entity: "container",
              id: String(c.id),
              message: `${c.name} : capacité saisie ${capacity} L ≠ libellé « ${c.variant_name} » (${announced} L) — ${
                correctedVersions.has(id("container_versions", c.id))
                  ? "corrigée dans Fourmy (correction préservée)"
                  : "valeur source conservée, à corriger dans Fourmy"
              }`,
            });
          }
          const placeId =
            c.container_id && placeIds.has(c.container_id) ? id("products", c.container_id) : await cellarPlace();
          const cid = id("products", c.id);
          const lower = iso(c.born_at) ?? FAR_PAST;
          let upper = iso(c.dead_at);
          if (upper && upper <= lower) upper = null;
          await tx`
            INSERT INTO containers (id, farm_id, place_id, name) VALUES (${cid}, ${farmId}, ${placeId}, ${c.name})
            ON CONFLICT (id) DO UPDATE SET place_id = excluded.place_id, name = excluded.name, updated_at = now()`;
          // Placement 3D laissé à l'agent F (placement automatique) : shape3d NULL.
          await tx`
            INSERT INTO container_versions (id, container_id, kind, capacity_l, shape3d, placement, valid)
            VALUES (${id("container_versions", c.id)}, ${cid}, ${kind}, ${capacity}, NULL, 'auto',
                    tstzrange(${lower}::timestamptz, ${upper}::timestamptz))
            ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, capacity_l = excluded.capacity_l,
              valid = tstzrange(lower(excluded.valid), coalesce(upper(container_versions.valid), upper(excluded.valid)))
            WHERE NOT EXISTS (SELECT 1 FROM audit_log a
              WHERE a.entity_id = container_versions.id AND a.action = 'corrected')`;
          containerIds.add(c.id);
          inc("containers");
        }

        // ---- Matériels -----------------------------------------------------
        const equipmentIds = new Set<number>();
        for (const e of data.equipments) {
          await tx`
            INSERT INTO equipments (id, farm_id, name, kind, state)
            VALUES (${id("products", e.id)}, ${farmId}, ${e.name}, ${e.variety ?? "equipment"},
                    ${e.dead_at ? "retired" : "active"})
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
              state = excluded.state, updated_at = now()`;
          equipmentIds.add(e.id);
          inc("equipments");
        }

        // ---- Articles et lots ------------------------------------------------
        const lotByMatter = new Map<number, { lotId: string; unit: string; placeId: string | null }>();
        const articles = new Set<number>();
        for (const m of data.matters) {
          const aid = id("product_nature_variants", m.variant_id);
          const unit = m.unit_name || "unity";
          if (!articles.has(m.variant_id)) {
            await tx`
              INSERT INTO articles (id, farm_id, lexicon_ref, name, kind, unit, amm)
              VALUES (${aid}, ${farmId}, ${m.reference_name}, ${m.variant_name},
                      ${articleKind(m)}, ${unit}, ${m.france_maaid})
              ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
                unit = excluded.unit, amm = excluded.amm, updated_at = now()`;
            articles.add(m.variant_id);
            inc("articles");
          }
          const lid = id("products", m.id);
          await tx`
            INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lid}, ${farmId}, ${aid}, ${m.name})
            ON CONFLICT (id) DO UPDATE SET code = excluded.code, updated_at = now()`;
          lotByMatter.set(m.id, {
            lotId: lid,
            unit,
            placeId: m.storage_id && placeIds.has(m.storage_id) ? id("products", m.storage_id) : null,
          });
          inc("lots");
        }

        // ---- Interventions, paramètres, mouvements --------------------------
        const paramsByIntervention = new Map<number, x.ParameterRow[]>();
        for (const p of data.parameters) {
          const list = paramsByIntervention.get(p.intervention_id) ?? [];
          list.push(p);
          paramsByIntervention.set(p.intervention_id, list);
        }

        for (const it of data.interventions) {
          const status = interventionStatus(it.state);
          if (!status) {
            reject("intervention", it.id, `état non migré : ${it.state}`);
            continue;
          }
          const iid = id("interventions", it.id);
          const stoppedAt = iso(it.stopped_at);
          await tx`
            INSERT INTO interventions (id, farm_id, procedure, status, started_at, stopped_at, origin)
            VALUES (${iid}, ${farmId}, ${it.procedure_name}, ${status},
                    ${iso(it.started_at)}, ${stoppedAt}, 'migration')
            ON CONFLICT (id) DO UPDATE SET procedure = excluded.procedure, status = excluded.status,
              started_at = excluded.started_at, stopped_at = excluded.stopped_at, updated_at = now()`;
          inc("interventions");

          for (const p of paramsByIntervention.get(it.id) ?? []) {
            const role = parameterRole(p.type);
            if (!role) continue;

            let refType = "other";
            let refId: string | null = null;
            const pt = p.product_type;
            if (role === "target") {
              if (pt === "LandParcel" && p.product_id && migratedParcels.has(p.product_id)) {
                refType = "land_parcel";
                refId = id("products", p.product_id);
              } else if (pt === "Plant" && p.plant_support_id && migratedParcels.has(p.plant_support_id)) {
                refType = "land_parcel";
                refId = id("products", p.plant_support_id);
              } else if (p.product_id && containerIds.has(p.product_id)) {
                refType = "container";
                refId = id("products", p.product_id);
              } else if (p.product_id && equipmentIds.has(p.product_id)) {
                refType = "equipment";
                refId = id("products", p.product_id);
              } else if (p.product_id && placeIds.has(p.product_id)) {
                refType = "place";
                refId = id("products", p.product_id);
              } else {
                refType = (pt ?? "other").toLowerCase();
              }
            } else if (role === "input" || role === "output") {
              const lot = p.product_id ? lotByMatter.get(p.product_id) : undefined;
              if (lot) {
                refType = "article";
                const m = data.matters.find((mm) => mm.id === p.product_id)!;
                refId = id("product_nature_variants", m.variant_id);
              } else {
                refType = (pt ?? "other").toLowerCase(); // ex. sortie « Plant » (semis)
              }
            } else if (role === "tool") {
              refType = "equipment";
              refId = p.product_id && equipmentIds.has(p.product_id) ? id("products", p.product_id) : null;
            } else if (role === "doer") {
              refType = "worker"; // personnes non migrées (données personnelles)
            }

            await tx`
              INSERT INTO intervention_parameters
                (id, intervention_id, role, ref_type, ref_id, quantity, unit, working_zone)
              VALUES (${id("intervention_parameters", p.id)}, ${iid}, ${role}, ${refType}, ${refId},
                      ${num(p.quantity_value)}, ${p.quantity_unit_name || null},
                      ${p.working_zone ? tx`ST_SetSRID(ST_GeomFromGeoJSON(${geo(p.working_zone)}), 4326)` : null})
              ON CONFLICT (id) DO UPDATE SET role = excluded.role, ref_type = excluded.ref_type,
                ref_id = excluded.ref_id, quantity = excluded.quantity, unit = excluded.unit,
                working_zone = excluded.working_zone`;
            inc("intervention_parameters");

            // Mouvement de stock pour les intrants / sorties de lots, si réalisée.
            if (status === "done" && (role === "input" || role === "output") && p.product_id) {
              const lot = lotByMatter.get(p.product_id);
              if (!lot) continue;
              const population = num(p.quantity_population);
              if (population === null || !stoppedAt) {
                reject("stock_movement", p.id, "quantité absolue (population) ou date absente");
                continue;
              }
              const placeId = lot.placeId ?? (await stockPlace());
              await tx`
                INSERT INTO stock_movements
                  (id, farm_id, lot_id, place_id, container_id, quantity, unit, occurred_at, cause, intervention_id)
                VALUES (${id("stock_movements", p.id)}, ${farmId}, ${lot.lotId}, ${placeId}, NULL,
                        ${signedQuantity(role, population)}, ${lot.unit}, ${stoppedAt}, 'intervention', ${iid})
                ON CONFLICT (id) DO UPDATE SET quantity = excluded.quantity, occurred_at = excluded.occurred_at`;
              inc("stock_movements");
            }
          }
        }

        // ---- Vendanges → remplissage des cuves (US-9) -----------------------
        if (data.harvests.length > 0) {
          const harvestArticle = id("article", "harvest");
          await tx`
            INSERT INTO articles (id, farm_id, name, kind, unit)
            VALUES (${harvestArticle}, ${farmId}, 'Vendange (réception)', 'harvest', 'liter')
            ON CONFLICT (id) DO NOTHING`;
          inc("articles");
          const lots = new Set<number>();
          for (const h of data.harvests) {
            if (!containerIds.has(h.storage_id)) {
              reject(
                "harvest_storage",
                h.storage_line_id,
                h.storage_exists
                  ? "cuve de destination non migrée"
                  : `cuve de destination supprimée dans Ekylibre (produit #${h.storage_id} introuvable)`,
              );
              continue;
            }
            const liters = toLiters(num(h.quantity_value), h.quantity_unit);
            if (liters === null) {
              reject("harvest_storage", h.storage_line_id, `unité de volume inconnue : ${h.quantity_unit}`);
              continue;
            }
            const lid = id("wine_incoming_harvests", h.id);
            if (!lots.has(h.id)) {
              await tx`
                INSERT INTO lots (id, farm_id, article_id, code, attrs)
                VALUES (${lid}, ${farmId}, ${harvestArticle}, ${h.number},
                        ${tx.json({ vintage: h.harvest_year, varieties: h.varieties ?? [] })})
                ON CONFLICT (id) DO UPDATE SET code = excluded.code, attrs = excluded.attrs`;
              lots.add(h.id);
              inc("lots");
            }
            await tx`
              INSERT INTO stock_movements
                (id, farm_id, lot_id, place_id, container_id, quantity, unit, occurred_at, cause)
              VALUES (${id("wine_incoming_harvest_storages", h.storage_line_id)}, ${farmId}, ${lid}, NULL,
                      ${id("products", h.storage_id)}, ${liters}, 'liter', ${iso(h.received_at)}, 'migration')
              ON CONFLICT (id) DO UPDATE SET quantity = excluded.quantity, occurred_at = excluded.occurred_at`;
            inc("stock_movements");
          }
        }

        // ---- Audit + événement outbox ----------------------------------------
        await tx`
          INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
          VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'import', ${runId}, 'completed',
                  ${tx.json({ counts, rejected: rejected.length })})`;
        const event = buildEvent(ctx, farmId, "import.completed", { runId, source: instance, counts });
        await tx`
          INSERT INTO outbox_events (id, farm_id, type, payload)
          VALUES (${event.id}, ${farmId}, ${event.type}, ${tx.json(event as unknown as Record<string, never>)})`;
      });

      // Statistiques à jour après l'écriture massive : sans elles, les vues
      // sous RLS (registre phyto) prennent des plans désastreux (> 5 s mesurés).
      for (const t of ["land_parcels", "land_parcel_versions", "productions", "places", "place_versions",
        "containers", "container_versions", "equipments", "articles", "lots", "interventions",
        "intervention_parameters", "stock_movements"]) {
        await target.unsafe(`ANALYZE ${t}`);
      }

      // Corrections faites dans Fourmy et préservées par cette migration.
      const [preserved] = await target<{ n: number }[]>`
        SELECT count(DISTINCT entity_id)::int AS n FROM audit_log
        WHERE farm_id = ${farmId} AND action = 'corrected'`;
      if (preserved && preserved.n > 0) counts.preserved_corrections = preserved.n;

      // ---- Écart du registre phyto (critère US-5) ---------------------------
      const fourmy = await target.begin(async (tx) => {
        await tx`SET LOCAL ROLE fourmy_app`;
        await tx`SELECT set_config('fourmy.farm_id', ${farmId}, true)`;
        return tx<{ year: number; rows: string }[]>`
          SELECT extract(year FROM done_at)::int AS year, count(*) AS rows
          FROM phyto_register GROUP BY 1`;
      });
      const years = new Set([...data.phytoRef.map((r) => r.year), ...fourmy.map((r) => r.year)]);
      const phyto = [...years].sort().map((year) => ({
        year,
        ekylibre: Number(data.phytoRef.find((r) => r.year === year)?.rows ?? 0),
        fourmy: Number(fourmy.find((r) => r.year === year)?.rows ?? 0),
      }));

      const report: Report = {
        runId,
        farmId,
        tenant,
        ekylibreVersion: info.version,
        counts,
        rejected,
        warnings,
        phyto,
      };
      await target`
        UPDATE import_runs SET farm_id = ${farmId}, status = 'completed', finished_at = now(),
          report = ${target.json({ counts, rejected, warnings, phyto } as unknown as Record<string, never>)}
        WHERE id = ${runId}`;
      return report;
    } catch (e) {
      await target`
        UPDATE import_runs SET status = 'failed', finished_at = now(),
          report = ${target.json({ error: String(e) })} WHERE id = ${runId}`;
      throw e;
    }
  } finally {
    await source.end();
    await target.end();
  }
}
