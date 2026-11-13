import postgres, { type Sql } from "postgres";
import { signedQuantity, buildEvent, proposeComposition, type DomainCtx } from "@fourmy/domain";
import { idsFor, uuidv5 } from "./ids.js";
import * as x from "./extract.js";
import { personName, privateOf, readPicture } from "./people.js";
import { companyIdentity, mergeWithoutOverwrite } from "./identity.js";
import { createHash } from "node:crypto";
import {
  toLiters,
  articleKind,
  productionNature,
  interventionStatus,
  parameterRole,
  containerKind,
  capacityFromLabel,
  cultivationOf,
  ACTIVITY_FAMILIES,
  hasHourMeter,
  samsysId,
  equipmentExternalIds,
  commissionedAt,
  crewsOf,
  isMotorised,
  type CrewMember,
  type Span,
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
  /**
   * Ferme Fourmy cible (import depuis l'API). Par défaut, la ferme est
   * dérivée du tenant. Si une autre ferme est visée, l'espace des UUID
   * inclut la ferme : un même tenant importé dans deux fermes ne collisionne pas.
   */
  farmId?: string;
  /** Identifiant du suivi, pour le connaître avant la fin (import asynchrone). */
  runId?: string;
  /** Fichiers du tenant Ekylibre (Paperclip) : photos des personnes. Sinon EKYLIBRE_FILES_DIR. */
  filesDir?: string;
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
  /**
   * Secrets trouvés dans la source (clé OpenWeatherMap), en clair : jamais
   * écrits par le migrateur ni dans `import_runs.report`. L'API les enregistre
   * chiffrés comme intégration de la ferme, après test (repos/imports.ts).
   */
  secrets: { openweather?: string };
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
    const baseInstance = `ekylibre:${tenant}`;
    const defaultFarmId = idsFor(baseInstance)("farm", tenant);
    const farmId = opts.farmId ?? defaultFarmId;
    const instance = farmId === defaultFarmId ? baseInstance : `${baseInstance}@${farmId}`;
    const id = idsFor(instance);

    // ---- Extraction (lecture seule) -------------------------------------
    const data = await x.read(src, async (s) => ({
      campaigns: await x.campaigns(s),
      landParcels: await x.landParcels(s),
      activities: await x.activities(s),
      productions: await x.productions(s),
      places: await x.places(s),
      containers: await x.containers(s),
      equipments: await x.equipments(s),
      matters: await x.matters(s),
      nutrients: await x.nutrientReadings(s),
      interventions: await x.interventions(s),
      parameters: await x.parameters(s),
      workingPeriods: await x.workingPeriods(s),
      participations: await x.participations(s),
      harvests: await x.harvests(s),
      phytoRef: await x.phytoReference(s),
      openWeatherKey: await x.openWeatherKey(s),
      people: await x.people(s),
      personAddresses: await x.personAddresses(s),
      personContracts: await x.personContracts(s),
      company: (await x.company(s))[0] ?? null,
    }));

    const runId = opts.runId ?? uuidv5(`${instance}:run:${new Date().toISOString()}`);
    await target`
      INSERT INTO import_runs (id, farm_id, source, status)
      VALUES (${runId}, ${opts.farmId ?? null}, ${instance}, 'running')
      ON CONFLICT (id) DO UPDATE SET status = 'running', started_at = now()`;

    const counts: Record<string, number> = {};
    const rejected: Report["rejected"] = [];
    const warnings: Report["warnings"] = [];
    const inc = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
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
          ON CONFLICT (id) DO UPDATE SET name = coalesce(${opts.farmName ?? null}, farms.name), updated_at = now()`;
        inc("farms");

        // ---- Identité de la société (« Ma ferme », F3) : sans rien écraser --
        if (data.company) {
          const company = companyIdentity(data.company);
          const companyId = String(data.company.id);
          for (const message of company.invalid) warnings.push({ entity: "farm_identity", id: companyId, message });
          const [current] = await tx<{ legal_name: string | null; legal_form: string | null; siret: string | null; vat_number: string | null; naf_code: string | null }[]>`
            SELECT legal_name, legal_form, siret, vat_number, naf_code FROM farms WHERE id = ${farmId}`;
          const identity = mergeWithoutOverwrite(current!, company.identity as typeof current & object);
          if (Object.keys(identity.updates).length) {
            await tx`UPDATE farms SET ${tx(identity.updates)}, updated_at = now() WHERE id = ${farmId}`;
            inc("farm_identity_fields", Object.keys(identity.updates).length);
          }
          for (const c of identity.conflicts) warnings.push({ entity: "farm_identity", id: companyId, message: `Écart non appliqué, ${c}` });
          // Adresse du siège : reprise seulement s'il n'en a aucune (on ne mélange pas deux adresses).
          if (company.address) {
            const [hq] = await tx<{ id: string; address_line1: string | null; address_line2: string | null; postal_code: string | null; city: string | null }[]>`
              SELECT id, address_line1, address_line2, postal_code, city FROM farm_sites WHERE is_headquarters`;
            if (hq) {
              const empty = !hq.address_line1 && !hq.address_line2 && !hq.postal_code && !hq.city;
              if (empty) {
                await tx`UPDATE farm_sites SET ${tx(company.address)}, updated_at = now() WHERE id = ${hq.id}`;
                inc("farm_address");
              } else if (mergeWithoutOverwrite(hq, { id: hq.id, ...company.address }).conflicts.length) {
                warnings.push({ entity: "farm_identity", id: companyId, message: "Écart non appliqué, adresse du siège : celle de Fourmy est gardée." });
              }
            }
          }
        }

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
        // Pérenne en cours (`opened`) : sa date de fin et celle de sa parcelle
        // support ne sont qu'une durée de vie prévue (30 ans par défaut dans
        // Ekylibre), pas un arrachage. On les laisse ouvertes.
        const isOpenedPerennial = (p: x.ProductionRow) => !p.campaign_id && p.state === "opened";
        const openedPerennialSupports = new Set(
          data.productions.filter((p) => isOpenedPerennial(p) && p.support_id).map((p) => p.support_id!),
        );
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
          let upper = openedPerennialSupports.has(lp.id) ? null : iso(lp.dead_at);
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

        // ---- Activités -----------------------------------------------------
        // Celles de la ferme d'origine. Une activité de même nom créée avant
        // la reprise (activités déduites, migration 0011) lui cède ses
        // productions puis disparaît.
        const migratedActivities = new Set<number>();
        for (const a of data.activities) {
          if (!ACTIVITY_FAMILIES.has(a.family)) {
            reject("activity", a.id, `famille d'activité inconnue : ${a.family}`);
            continue;
          }
          const aid = id("activities", a.id);
          const [other] = await tx<{ id: string }[]>`SELECT id FROM activities WHERE farm_id = ${farmId} AND name = ${a.name} AND id <> ${aid}`;
          if (other) await tx`UPDATE activities SET name = name || ' (' || id || ')' WHERE id = ${other.id}`;
          await tx`
            INSERT INTO activities (id, farm_id, name, family, reference, cultivation, suspended)
            VALUES (${aid}, ${farmId}, ${a.name}, ${a.family}, ${a.reference_name}, ${a.cultivation_variety?.trim().toLowerCase() || null}, ${a.suspended})
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, family = excluded.family, reference = excluded.reference,
              cultivation = excluded.cultivation, suspended = excluded.suspended, updated_at = now()`;
          if (other) {
            await tx`UPDATE productions SET activity_id = ${aid} WHERE activity_id = ${other.id}`;
            await tx`DELETE FROM activities WHERE id = ${other.id}`;
          }
          migratedActivities.add(a.id);
          inc("activities");
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
            const to = p.stopped_on && !isOpenedPerennial(p) ? Number(p.stopped_on.slice(0, 4)) : Infinity;
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
              INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, species, cultivation, activity_id)
              VALUES (${t.pid}, ${farmId}, ${t.campaignId}, ${id("products", p.support_id)}, ${nature},
                      ${p.plant_variety ?? p.cultivation_variety}, ${cultivationOf(p.cultivation_variety, nature)},
                      ${migratedActivities.has(p.activity_id) ? id("activities", p.activity_id) : null})
              ON CONFLICT (id) DO UPDATE SET nature = excluded.nature, species = excluded.species,
                cultivation = excluded.cultivation, activity_id = excluded.activity_id`;
            inc("productions");
          }
        }

        // Activités déduites avant la reprise, désormais vides : remplacées.
        await tx`DELETE FROM activities a WHERE a.farm_id = ${farmId} AND a.deduced
                 AND NOT EXISTS (SELECT 1 FROM productions p WHERE p.activity_id = a.id)`;

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
        // Les recopies Samsys (`SAMSYS_…`) inutilisées d'un matériel de même nom
        // y sont fusionnées (l'id Samsys est gardé) ; les boîtiers de
        // géolocalisation ne sont pas des matériels (traceurs : Intégrations).
        const equipmentRef = new Map<number, string>();
        const originals = new Map<string, x.EquipmentRow>();
        for (const e of data.equipments) {
          if (!samsysId(e.work_number)) originals.set(e.name.trim().toLowerCase(), e);
        }
        const samsysOf = new Map<number, string[]>();
        for (const e of data.equipments) {
          const sid = samsysId(e.work_number);
          const original = originals.get(e.name.trim().toLowerCase());
          if (sid && original && e.uses === 0) {
            equipmentRef.set(e.id, id("products", original.id));
            samsysOf.set(original.id, [...(samsysOf.get(original.id) ?? []), sid]);
            // Créée par une migration précédente : retirée si rien n'y renvoie.
            await tx.savepoint((sp) => sp`DELETE FROM equipments WHERE id = ${id("products", e.id)}`).catch(() => {});
            inc("equipments_merged");
          }
        }
        for (const e of data.equipments) {
          if (equipmentRef.has(e.id)) continue;
          if (e.variety === "connected_object") {
            reject("equipment", e.id, `boîtier de géolocalisation « ${e.name} », pas un matériel (traceurs : Intégrations)`);
            continue;
          }
          if (e.type !== "Equipment") {
            warnings.push({
              entity: "equipment",
              id: String(e.id),
              message: `${e.name} : saisi comme ${e.type} dans Ekylibre mais utilisé comme outil, repris comme matériel`,
            });
          }
          const eid = id("products", e.id);
          const ids = equipmentExternalIds(e);
          const merged = samsysOf.get(e.id);
          if (merged) ids.samsys = merged.join(", ");
          await tx`
            INSERT INTO equipments (id, farm_id, name, kind, state, serial_number, meter_unit, commissioned_at, external_ids)
            VALUES (${eid}, ${farmId}, ${e.name}, ${e.variety ?? "equipment"},
                    ${e.dead_at ? "retired" : "active"}, ${e.identification_number},
                    ${hasHourMeter(e.variety) ? "hours" : null}, ${iso(commissionedAt(e.born_at))},
                    ${tx.json(ids)})
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
              state = excluded.state,
              -- Complétés seulement s'ils sont vides : une saisie dans Fourmy est conservée.
              serial_number = coalesce(equipments.serial_number, excluded.serial_number),
              commissioned_at = coalesce(equipments.commissioned_at, excluded.commissioned_at),
              external_ids = excluded.external_ids || coalesce(equipments.external_ids, '{}'),
              updated_at = now()`;
          equipmentRef.set(e.id, eid);
          inc("equipments");
        }
        const equipmentIds = { has: (pid: number) => equipmentRef.has(pid) };
        const equipmentUuid = (pid: number) => equipmentRef.get(pid)!;

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
            await migrateNutrients(tx, farmId, aid, { name: m.variant_name, lexiconRef: m.reference_name }, data.nutrients.filter((r) => r.variant_id === m.variant_id), inc);
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

        const periodsByIntervention = new Map<number, x.WorkingPeriodRow[]>();
        for (const wp of data.workingPeriods) {
          const list = periodsByIntervention.get(wp.intervention_id) ?? [];
          list.push(wp);
          periodsByIntervention.set(wp.intervention_id, list);
        }

        // Personnes : les intervenants (« Worker ») des interventions, par leur nom
        // seulement (docs/interventions.md §7 — aucune autre donnée personnelle).
        const migratedPeople = new Set<number>();
        for (const p of data.parameters) {
          if (p.type !== "InterventionDoer" || !p.product_id || p.product_type !== "Worker") continue;
          if (migratedPeople.has(p.product_id)) continue;
          migratedPeople.add(p.product_id);
          await tx`
            INSERT INTO people (id, farm_id, name)
            VALUES (${id("products", p.product_id)}, ${farmId}, ${p.product_name?.trim() || `Personne ${p.product_id}`})
            ON CONFLICT (id) DO NOTHING`;
          inc("people");
        }

        // Personnes (lot P4, docs/equipe-personnes-design.md §7) : identité,
        // coordonnées, contrat et photo des intervenants et des utilisateurs.
        // Une valeur déjà présente dans Fourmy l'emporte toujours.
        const filesDir = opts.filesDir ?? process.env.EKYLIBRE_FILES_DIR;
        const addressesOf = new Map<number, x.AddressRow[]>();
        for (const a of data.personAddresses) addressesOf.set(a.entity_id, [...(addressesOf.get(a.entity_id) ?? []), a]);
        const contractsOf = new Map<number, x.ContractRow[]>();
        for (const c of data.personContracts) contractsOf.set(c.entity_id, [...(contractsOf.get(c.entity_id) ?? []), c]);
        for (const e of data.people) {
          const workers = e.worker_ids ?? [];
          // Utilisateur sans fiche d'intervenant, déjà membre de la ferme sous le même email :
          // on complète sa personne plutôt que d'en créer une seconde.
          const member = !workers.length && e.user_email
            ? (await tx<{ id: string }[]>`
                SELECT p.id FROM people p JOIN users u ON u.id = p.user_id
                WHERE p.farm_id = ${farmId} AND lower(u.email) = lower(${e.user_email})`)[0]
            : undefined;
          const personIds = workers.length ? workers.map((w) => id("products", w)) : [member?.id ?? id("entities", e.entity_id)];
          for (const w of workers) migratedPeople.add(w); // désignables comme intervenants
          const priv = privateOf(e, addressesOf.get(e.entity_id) ?? [], contractsOf.get(e.entity_id) ?? []);
          const picture = readPicture(filesDir, tenant, e);
          if (e.picture_file_name && !picture) inc("people_photo_missing");
          if (e.user_id && e.administrator) inc("ekylibre_admins");
          const external = {
            ekylibreEntity: e.entity_id,
            ...(workers.length ? { ekylibreWorker: workers[0] } : {}),
            ...(e.user_id ? { ekylibreUser: e.user_id } : {}),
          };
          for (const pid of personIds) {
            const name = personName(e) ?? `Personne ${workers[0] ?? e.entity_id}`;
            const [r] = await tx<{ inserted: boolean }[]>`
              INSERT INTO people (id, farm_id, name, first_name, last_name, external_ids)
              VALUES (${pid}, ${farmId}, ${name}, ${e.first_name}, ${e.last_name}, ${tx.json(external)})
              ON CONFLICT (id) DO UPDATE SET
                first_name = coalesce(people.first_name, excluded.first_name),
                last_name = coalesce(people.last_name, excluded.last_name),
                name = CASE WHEN people.first_name IS NULL AND people.last_name IS NULL
                             AND (excluded.first_name IS NOT NULL OR excluded.last_name IS NOT NULL)
                            THEN excluded.name ELSE people.name END,
                external_ids = people.external_ids || excluded.external_ids, updated_at = now()
              RETURNING (xmax = 0) AS inserted`;
            inc(r?.inserted ? "people" : "people_completed");
            const a = priv.address;
            const c = priv.contract;
            if (priv.email || priv.mobile || a || priv.birthDate || c) {
              await tx`
                INSERT INTO person_private (person_id, farm_id, email, mobile, address_line1, address_line2, postal_code, city, country,
                                            birth_date, contract_type, contract_started_on, contract_ended_on)
                VALUES (${pid}, ${farmId}, ${priv.email}, ${priv.mobile}, ${a?.line1 ?? null}, ${a?.line2 ?? null}, ${a?.postalCode ?? null},
                        ${a?.city ?? null}, ${a?.country ?? null}, ${priv.birthDate}, ${c?.type ?? null}, ${c?.startedOn ?? null}, ${c?.endedOn ?? null})
                ON CONFLICT (person_id) DO UPDATE SET
                  email = coalesce(person_private.email, excluded.email),
                  mobile = coalesce(person_private.mobile, excluded.mobile),
                  address_line1 = coalesce(person_private.address_line1, excluded.address_line1),
                  address_line2 = coalesce(person_private.address_line2, excluded.address_line2),
                  postal_code = coalesce(person_private.postal_code, excluded.postal_code),
                  city = coalesce(person_private.city, excluded.city),
                  country = coalesce(person_private.country, excluded.country),
                  birth_date = coalesce(person_private.birth_date, excluded.birth_date),
                  contract_type = coalesce(person_private.contract_type, excluded.contract_type),
                  contract_started_on = coalesce(person_private.contract_started_on, excluded.contract_started_on),
                  contract_ended_on = coalesce(person_private.contract_ended_on, excluded.contract_ended_on),
                  updated_at = now()`;
              if (priv.email) inc("people_email");
              if (priv.mobile) inc("people_mobile");
              if (a) inc("people_address");
              if (priv.birthDate) inc("people_birth_date");
              if (c) inc("people_contract");
            }
            if (picture) {
              const [cur] = await tx<{ photo_id: string | null }[]>`SELECT photo_id FROM people WHERE id = ${pid}`;
              if (!cur?.photo_id) {
                const photoId = id("entity_pictures", `${e.entity_id}:${pid}`);
                await tx`
                  INSERT INTO person_photos (id, farm_id, media_type, bytes, size, sha256)
                  VALUES (${photoId}, ${farmId}, ${picture.mediaType}, ${picture.bytes}, ${picture.bytes.length},
                          ${createHash("sha256").update(picture.bytes).digest("hex")})
                  ON CONFLICT (id) DO NOTHING`;
                await tx`UPDATE people SET photo_id = ${photoId} WHERE id = ${pid}`;
                inc("people_photo");
              }
            }
          }
        }

        // Attelages (FR-ATT-10) : participations par intervention et par produit,
        // nature des matériels, interventions corrigées dans Fourmy (non réécrites).
        const participationsOf = new Map<number, Map<number, Span[]>>();
        for (const p of data.participations) {
          const byProduct = participationsOf.get(p.intervention_id) ?? new Map<number, Span[]>();
          const list = byProduct.get(p.product_id) ?? [];
          list.push({ startedAt: iso(p.started_at)!, stoppedAt: iso(p.stopped_at)! });
          byProduct.set(p.product_id, list);
          participationsOf.set(p.intervention_id, byProduct);
        }
        const varietyOf = new Map(data.equipments.map((e) => [e.id, e.variety]));
        const correctedInterventions = new Set(
          (await tx<{ id: string }[]>`
            SELECT DISTINCT entity_id AS id FROM audit_log
            WHERE farm_id = ${farmId} AND entity = 'intervention' AND action = 'corrected'`).map((r) => r.id),
        );

        for (const it of data.interventions) {
          const status = interventionStatus(it.state);
          if (!status) {
            reject("intervention", it.id, `état non migré : ${it.state}`);
            continue;
          }
          const iid = id("interventions", it.id);
          if (correctedInterventions.has(iid)) {
            inc("interventions_preserved"); // corrigée dans Fourmy : ni moyens, ni attelages, ni cibles réécrits
            continue;
          }
          const stoppedAt = iso(it.stopped_at);

          // Périodes de travail : celles d'Ekylibre, sinon [début, fin] de l'intervention.
          // Recalculées à chaque migration, comme le reste de l'intervention.
          const periods: { id: string; startedAt: string; stoppedAt: string; crewId?: string }[] = [];
          for (const wp of periodsByIntervention.get(it.id) ?? []) {
            const last = periods.at(-1);
            const startedAt = iso(wp.started_at)!;
            const stoppedAt = iso(wp.stopped_at)!;
            // Ekylibre tolère les chevauchements : on fusionne les périodes qui se recouvrent.
            if (last && startedAt < last.stoppedAt) {
              if (stoppedAt > last.stoppedAt) last.stoppedAt = stoppedAt;
              continue;
            }
            periods.push({ id: id("intervention_working_periods", wp.id), startedAt, stoppedAt });
          }
          if (periods.length === 0 && it.started_at && it.stopped_at && it.stopped_at > it.started_at) {
            periods.push({ id: id("intervention_period", it.id), startedAt: iso(it.started_at)!, stoppedAt: stoppedAt! });
          }

          // Attelages : règles 1 à 3 (rules.ts). En attelages, chaque matériel,
          // intervenant et période porte son attelage (garde de 0022).
          const members: CrewMember[] = [];
          for (const p of paramsByIntervention.get(it.id) ?? []) {
            const role = parameterRole(p.type);
            if (role !== "tool" && role !== "doer") continue;
            members.push({ paramId: p.id, role, productId: p.product_id, motorised: role === "tool" && p.product_id !== null && isMotorised(varietyOf.get(p.product_id) ?? null) });
          }
          const plan = crewsOf({ members, periods, participations: participationsOf.get(it.id) ?? new Map() });
          const crewIds = plan.staffing === "crews" ? plan.crews.map((_, rank) => id("intervention_crews", `${it.id}:${rank}`)) : [];
          const crewOfParam = new Map<number, string>();
          if (plan.staffing === "crews") {
            plan.crews.forEach((c, rank) => c.paramIds.forEach((pid) => crewOfParam.set(pid, crewIds[rank]!)));
            if (plan.rule === 2) for (const pr of periods) pr.crewId = crewIds[0]!;
            else {
              // Règle 1 : les périodes de l'intervention sont celles des attelages.
              periods.length = 0;
              plan.crews.forEach((c, rank) =>
                c.periods.forEach((s, k) => periods.push({ id: id("intervention_crew_periods", `${it.id}:${rank}:${k}`), ...s, crewId: crewIds[rank]! })),
              );
            }
            inc(`crews_rule_${plan.rule}`);
          } else if (plan.ambiguous) {
            inc("crews_ambiguous");
            const names = (role: "tool" | "doer") =>
              (paramsByIntervention.get(it.id) ?? [])
                .filter((p) => parameterRole(p.type) === role)
                .map((p) => p.product_name ?? `#${p.product_id}`)
                .join(", ");
            warnings.push({
              entity: "intervention",
              id: String(it.id),
              message: `${it.procedure_name} du ${(iso(it.started_at) ?? "?").slice(0, 10)} : plusieurs matériels motorisés et plusieurs intervenants sans participations, laissée en mode libre (attelage ambigu) — matériels : ${names("tool")} ; intervenants : ${names("doer")}`,
            });
          }

          await tx`
            INSERT INTO interventions (id, farm_id, procedure, status, started_at, stopped_at, origin, staffing)
            VALUES (${iid}, ${farmId}, ${it.procedure_name}, ${status},
                    ${iso(it.started_at)}, ${stoppedAt}, 'migration', ${plan.staffing})
            ON CONFLICT (id) DO UPDATE SET procedure = excluded.procedure, status = excluded.status,
              started_at = excluded.started_at, stopped_at = excluded.stopped_at, staffing = excluded.staffing, updated_at = now()`;
          inc("interventions");

          // Attelages d'un passage précédent qui n'existent plus (leurs matériels,
          // intervenants et périodes suivent en cascade, puis sont réécrits ci-dessous).
          await tx`
            DELETE FROM intervention_crews
            WHERE intervention_id = ${iid} AND NOT (id = ANY(${`{${crewIds.join(",")}}`}::uuid[]))`;
          for (const [rank, crewId] of crewIds.entries()) {
            await tx`
              INSERT INTO intervention_crews (id, intervention_id, rank)
              VALUES (${crewId}, ${iid}, ${rank})
              ON CONFLICT (id) DO UPDATE SET rank = excluded.rank`;
            inc("crews");
          }

          await tx`DELETE FROM intervention_periods WHERE intervention_id = ${iid}`;
          for (const pr of periods) {
            await tx`
              INSERT INTO intervention_periods (id, intervention_id, started_at, stopped_at, crew_id)
              VALUES (${pr.id}, ${iid}, ${pr.startedAt}, ${pr.stoppedAt}, ${pr.crewId ?? null})`;
            inc("intervention_periods");
          }

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
                refId = equipmentUuid(p.product_id);
              } else if (p.product_id && placeIds.has(p.product_id)) {
                refType = "place";
                refId = id("products", p.product_id);
              } else {
                refType = (pt ?? "other").toLowerCase();
              }
              // La zone de travail fait foi : quand elle tombe surtout sur une autre
              // parcelle à la date, la cible Ekylibre (parcelle, ou support de la
              // culture) est fausse — constaté chez deux pilotes, 2026-11-08.
              const at = stoppedAt ?? iso(it.started_at);
              if (refType === "land_parcel" && p.working_zone && at) {
                const [best] = await tx<{ id: string; share: number }[]>`
                  WITH z AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geo(p.working_zone)}), 4326) AS g)
                  SELECT v.land_parcel_id AS id,
                         (ST_Area(ST_Intersection(v.shape, z.g)::geography) / NULLIF(ST_Area(z.g::geography), 0))::float8 AS share
                  FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id, z
                  WHERE lp.farm_id = ${farmId} AND v.valid @> ${at}::timestamptz AND ST_Intersects(v.shape, z.g)
                  ORDER BY share DESC NULLS LAST LIMIT 1`;
                if (best && best.id !== refId && best.share >= 0.5) {
                  warnings.push({
                    entity: "intervention_parameter",
                    id: String(p.id),
                    message: `${it.procedure_name} du ${at.slice(0, 10)} : cible rattachée à la parcelle de sa zone de travail (${Math.round(best.share * 100)} % de la zone) plutôt qu'à la cible Ekylibre (${pt === "Plant" ? "support de la culture" : "parcelle"})`,
                  });
                  refId = best.id;
                }
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
              refId = p.product_id && equipmentIds.has(p.product_id) ? equipmentUuid(p.product_id) : null;
            } else if (role === "doer") {
              if (p.product_id && migratedPeople.has(p.product_id)) {
                refType = "person";
                refId = id("products", p.product_id);
              } else {
                refType = "worker";
              }
            }

            await tx`
              INSERT INTO intervention_parameters
                (id, intervention_id, role, ref_type, ref_id, quantity, unit, working_zone, crew_id)
              VALUES (${id("intervention_parameters", p.id)}, ${iid}, ${role}, ${refType}, ${refId},
                      ${num(p.quantity_value)}, ${p.quantity_unit_name || null},
                      ${p.working_zone ? tx`ST_SetSRID(ST_GeomFromGeoJSON(${geo(p.working_zone)}), 4326)` : null},
                      ${crewOfParam.get(p.id) ?? null})
              ON CONFLICT (id) DO UPDATE SET role = excluded.role, ref_type = excluded.ref_type,
                ref_id = excluded.ref_id, quantity = excluded.quantity, unit = excluded.unit,
                working_zone = excluded.working_zone, crew_id = excluded.crew_id`;
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
        "containers", "container_versions", "equipments", "articles", "lots", "people", "interventions",
        "intervention_periods", "intervention_parameters", "stock_movements"]) {
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

      if (data.openWeatherKey) {
        warnings.push({
          entity: "integration",
          id: "openweathermap_api_key",
          message: `clé OpenWeatherMap trouvée (…${data.openWeatherKey.slice(-4)}) : reprise comme intégration OpenWeather par l'import depuis l'API, sinon à saisir dans Intégrations`,
        });
      }
      const report: Report = {
        runId,
        farmId,
        tenant,
        ekylibreVersion: info.version,
        counts,
        rejected,
        warnings,
        phyto,
        secrets: data.openWeatherKey ? { openweather: data.openWeatherKey } : {},
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

/**
 * Teneurs N, P, K d'une variante (relevés Ekylibre en %) → composition du
 * fertilisant (lot AE). Une composition confirmée ou issue d'une analyse dans
 * Fourmy n'est jamais écrasée. P et K sont lus comme P2O5 et K2O, convention
 * des étiquettes d'engrais (« 9,5-15-30 »).
 */
async function migrateNutrients(
  tx: Sql,
  farmId: string,
  articleId: string,
  article: { name: string; lexiconRef: string | null },
  readings: x.NutrientReadingRow[],
  inc: (k: string) => void,
): Promise<void> {
  const percent = (name: string) => {
    const r = readings.find((x) => x.indicator_name === name && (x.unit === "percent" || x.unit === "mass_percent"));
    return r ? Number(r.value) : null;
  };
  const nTotal = percent("nitrogen_concentration");
  if (nTotal === null) return;
  // Ekylibre ne dit pas si le produit est minéral : seul le nom ou le code Lexicon le dit.
  const proposal = proposeComposition(article);
  const mineral = nTotal > 0 && proposal?.nitrateType === "III";
  await tx`
    INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, n_mineral_share, p2o5, k2o, nitrate_type, density, origin, source)
    VALUES (${articleId}, ${farmId}, 'mass_percent', ${nTotal}, ${mineral ? 1 : null},
            ${percent("phosphorus_concentration")}, ${percent("potassium_concentration")}, ${mineral ? "III" : null},
            ${proposal?.density ?? null}, 'migrated', 'Ekylibre (relevés de la variante)')
    ON CONFLICT (article_id) DO UPDATE SET n_total = excluded.n_total, p2o5 = excluded.p2o5, k2o = excluded.k2o,
      n_mineral_share = excluded.n_mineral_share, nitrate_type = excluded.nitrate_type, density = excluded.density, updated_at = now()
    WHERE article_fertilizers.origin IN ('migrated', 'proposed')`;
  inc("fertilizer_compositions");
}
