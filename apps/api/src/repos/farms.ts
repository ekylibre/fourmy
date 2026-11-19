import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { geocodeSearch } from "../geocode.js";

/**
 * Création d'une ferme par son futur responsable (assistant de premier
 * démarrage, lot IM6 ; claudedocs/conception_import_onboarding.md §7.3) :
 * ferme, adhésion `owner`, réglages avec l'état de l'assistant, campagne de
 * l'année, personne liée au compte, adresse du siège (géocodée si elle est trouvée).
 * Le droit de créer (quota du compte) est consommé dans la même transaction :
 * deux envois simultanés ne créent qu'une ferme.
 */

export class NoFarmQuota extends Error {}

export interface FarmCreate {
  name: string;
  siret?: string | null;
  pacage?: string | null;
  legalName?: string | null;
  address?: { line1?: string | null; line2?: string | null; postalCode?: string | null; city?: string | null } | null;
}

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Point du siège, si l'adresse se géocode assez sûrement (sinon le siège reste sans point). */
async function locate(address: FarmCreate["address"], userId: string): Promise<{ lat: number; lon: number; score: number; type: string; inseeCode: string } | null> {
  const q = [address?.line1, address?.postalCode, address?.city].filter(Boolean).join(" ").trim();
  if (q.length < 3) return null;
  const [best] = await geocodeSearch(q, 1, userId).catch(() => []);
  return best && best.score >= 0.5 ? { ...best.location, score: best.score, type: best.type, inseeCode: best.inseeCode } : null;
}

export async function createFarm(db: Database, userId: string, body: FarmCreate): Promise<{ id: string }> {
  const id = randomUUID();
  const point = await locate(body.address, userId);
  const year = new Date().getFullYear();
  await withFarm(db, id, async (tx) => {
    const [quota] = await rows<{ id: string; name: string | null; email: string }>(
      tx,
      sql`UPDATE users SET farm_creation_quota = farm_creation_quota - 1 WHERE id = ${userId} AND farm_creation_quota > 0 RETURNING id, name, email`,
    );
    if (!quota) throw new NoFarmQuota("Ce compte ne peut pas créer de ferme : demandez une invitation à l'administrateur de Fourmy.");
    await tx.execute(sql`
      INSERT INTO farms (id, name, siret, pacage, legal_name)
      VALUES (${id}, ${body.name}, ${body.siret ?? null}, ${body.pacage ?? null}, ${body.legalName ?? null})`);
    await tx.execute(sql`INSERT INTO memberships (id, farm_id, user_id, role) VALUES (${randomUUID()}, ${id}, ${userId}, 'owner')`);
    await tx.execute(sql`
      INSERT INTO farm_settings (farm_id, onboarding) VALUES (${id}, ${JSON.stringify({ step: "files", completedAt: null })}::jsonb)`);
    await tx.execute(sql`
      INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${randomUUID()}, ${id}, ${year}, make_date(${year}, 1, 1), make_date(${year}, 12, 31))`);
    const personName = quota.name?.trim() || quota.email.split("@")[0]!;
    await tx.execute(sql`INSERT INTO people (id, farm_id, name, user_id, active) VALUES (${randomUUID()}, ${id}, ${personName}, ${userId}, true)`);
    const a = body.address ?? {};
    const postal = a.postalCode && /^\d{5}$/.test(a.postalCode) ? a.postalCode : null;
    // Le siège est créé avec la ferme (déclencheur `farms_create_hq`) : on le complète.
    await tx.execute(sql`
      UPDATE farm_sites SET address_line1 = ${a.line1?.slice(0, 200) || null}, address_line2 = ${a.line2?.slice(0, 200) || null},
             postal_code = ${postal}, city = ${a.city?.slice(0, 120) || null}, insee_code = ${point?.inseeCode ?? null},
             location = ${point ? sql`ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)` : sql`location`},
             location_source = ${point ? sql`'geocoded'` : sql`location_source`},
             geocode_score = ${point ? sql`${point.score}` : sql`geocode_score`}, geocode_type = ${point ? sql`${point.type}` : sql`geocode_type`},
             updated_at = now()
      WHERE farm_id = ${id} AND is_headquarters`);
  });
  return { id };
}

export type OnboardingStep = "farm" | "files" | "preview" | "matching" | "settings" | "import" | "done";

/** Étape courante de l'assistant, ou sa fin (`completedAt`). */
export async function saveOnboarding(db: Database, farmId: string, body: { step?: OnboardingStep; completed?: boolean }) {
  return withFarm(db, farmId, async (tx) => {
    const patch = { ...(body.step ? { step: body.step } : {}), ...(body.completed ? { completedAt: new Date().toISOString() } : {}) };
    const [r] = await rows<{ onboarding: Record<string, unknown> }>(
      tx,
      sql`INSERT INTO farm_settings (farm_id, onboarding) VALUES (${farmId}, ${JSON.stringify(patch)}::jsonb)
          ON CONFLICT (farm_id) DO UPDATE SET onboarding = coalesce(farm_settings.onboarding, '{}'::jsonb) || excluded.onboarding, updated_at = now()
          RETURNING onboarding`,
    );
    return r!.onboarding;
  });
}
