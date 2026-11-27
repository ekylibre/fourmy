import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { accessModules } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { addGuest, setupFarm, teardown } from "./helpers.js";

/**
 * Périmètre d'activités (lot AM2, conception_api_mcp.md §5, NF-5) : un accès
 * « Vigne » sur une ferme Vigne + Blé ne voit rien du blé — ni en liste, ni par
 * identifiant (404), ni dans le registre ou l'assolement — et l'intervention
 * mixte apparaît réduite à la vigne, quantités totales au prorata.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const vigne = crypto.randomUUID();
const ble = crypto.randomUUID();
const pVigne = crypto.randomUUID(); // 1 ha de vigne en 2026
const pBle = crypto.randomUUID(); // 3 ha de blé en 2026
const pArrachee = crypto.randomUUID(); // vigne en 2020, blé en 2026
const fongicide = crypto.randomUUID();
const iVigne = crypto.randomUUID();
const iBle = crypto.randomUUID();
const iMixte = crypto.randomUUID();
const iCour = crypto.randomUUID();

const square = (x: number) =>
  `MULTIPOLYGON(((${x} 44.8,${x + 0.001} 44.8,${x + 0.001} 44.801,${x} 44.801,${x} 44.8)))`;

describe.skipIf(!url)("périmètre d'activités (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  let guest: Awaited<ReturnType<typeof addGuest>>;
  const base = () => `/api/v1/farms/${farm.farmId}`;
  const as = (headers: Record<string, string>, path: string) => app.request(`${base()}${path}`, { headers });
  const json = async (headers: Record<string, string>, path: string) => {
    const res = await as(headers, path);
    expect(res.status, `${path} : ${await res.clone().text()}`).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme test périmètre AM2");
    const f = farm.farmId;
    const c2020 = crypto.randomUUID();
    const c2026 = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${c2020}, ${f}, 2020, '2020-01-01', '2020-12-31'), (${c2026}, ${f}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${vigne}, ${f}, 'Vigne', 'vine_farming'), (${ble}, ${f}, 'Blé tendre', 'plant_farming')`;
    for (const [id, name, x, area] of [
      [pVigne, "Les Vignes", 0.5, 10000],
      [pBle, "Le Grand Champ", 0.51, 30000],
      [pArrachee, "L'Ancienne Vigne", 0.52, 20000],
    ] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${f}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
                VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${square(x)}, 4326), ${area}, tstzrange('2019-01-01', NULL))`;
    }
    const prod = (campaign: string, parcel: string, activity: string) =>
      sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id) VALUES (${crypto.randomUUID()}, ${f}, ${campaign}, ${parcel}, 'field_crop', ${activity})`;
    await prod(c2026, pVigne, vigne);
    await prod(c2026, pBle, ble);
    await prod(c2020, pArrachee, vigne);
    await prod(c2026, pArrachee, ble);
    // Brouillon d'assolement 2026 : instantané de toutes les activités (doit rester invisible).
    await sql`INSERT INTO crop_plans (id, farm_id, year, status, draft) VALUES (${crypto.randomUUID()}, ${f}, 2026, 'draft',
              ${sql.json({ year: 2026, assignments: [{ id: "a1", key: { kind: "parcel", parcelId: pBle }, role: "main", activityId: ble, startedOn: null, stoppedOn: null }] })})`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${fongicide}, ${f}, 'Fongicide X', 'phyto', 'liter', '9100001')`;

    // Interventions prévues (le responsable) : vigne seule, blé seul, mixte (30 L au total + 2 L/ha), cour sans parcelle.
    const plan = async (id: string, targets: string[], inputs: unknown[], procedure = "spraying") => {
      const res = await app.request(`${base()}/interventions`, {
        method: "POST",
        headers: farm.headers,
        body: JSON.stringify({ id, procedure, plannedAt: "2026-06-10T08:00:00Z", targets: targets.map((t) => ({ kind: "land_parcel", id: t })), inputs, purposes: procedure === "spraying" ? ["fungicide"] : [] }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    await plan(iVigne, [pVigne], [{ articleId: fongicide, quantity: 2, per: "hectare" }]);
    await plan(iBle, [pBle], [{ articleId: fongicide, quantity: 2, per: "hectare" }]);
    await plan(iMixte, [pVigne, pBle], [{ articleId: fongicide, quantity: 40, per: "total" }]);
    await plan(iCour, [], [], "maintenance");

    guest = await addGuest(sql, farm.farmId, { modules: Object.fromEntries(accessModules.map((m) => [m, "read"])), activities: [vigne] });
  });
  afterAll(async () => {
    await teardown(sql, farm.farmId, [farm.userId, guest.userId]);
    await sql.end();
  });

  it("activités et parcelles : la vigne seulement (l'ancienne vigne comprise)", async () => {
    const acts = await json(guest.headers, "/activities");
    expect((acts.items ?? acts).map((a: { id: string }) => a.id)).toEqual([vigne]);
    const parcels = await json(guest.headers, "/land-parcels");
    const ids = (parcels.items ?? parcels.features ?? parcels).map((p: { id: string; properties?: { id: string } }) => p.id ?? p.properties?.id);
    expect(ids.sort()).toEqual([pVigne, pArrachee].sort());
    expect((await as(guest.headers, `/land-parcels/${pBle}/sheet`)).status).toBe(404);
    // Fiche de l'ancienne vigne : la campagne 2020 seulement, pas son blé de 2026.
    const sheet = await json(guest.headers, `/land-parcels/${pArrachee}/sheet`);
    expect(JSON.stringify(sheet)).not.toContain(ble);
  });

  it("interventions : vigne et mixte ; ni le blé, ni la cour", async () => {
    const list = await json(guest.headers, "/interventions?campaign=2026");
    const items = list.items ?? list;
    expect(items.map((i: { id: string }) => i.id).sort()).toEqual([iVigne, iMixte].sort());
    expect((await as(guest.headers, `/interventions/${iBle}`)).status).toBe(404);
    expect((await as(guest.headers, `/interventions/${iCour}`)).status).toBe(404);
  });

  it("intervention mixte : cibles de la vigne, total au prorata de la surface (1 ha sur 4), mention « partagée »", async () => {
    const one = await json(guest.headers, `/interventions/${iMixte}`);
    const i = one.intervention ?? one;
    expect(i.shared).toBe(true);
    expect(i.targets.map((t: { id: string }) => t.id)).toEqual([pVigne]);
    expect(i.inputs).toEqual([expect.objectContaining({ articleId: fongicide, quantity: 10, per: "total" })]);
    expect(JSON.stringify(one)).not.toContain(pBle);
    // Le responsable voit l'intervention entière.
    const full = await json(farm.headers, `/interventions/${iMixte}`);
    const fi = full.intervention ?? full;
    expect(fi.shared).toBeUndefined();
    expect(fi.targets).toHaveLength(2);
    expect(fi.inputs[0].quantity).toBe(40);
  });

  it("registre phyto : les lignes de la vigne seulement", async () => {
    const done = await app.request(`${base()}/interventions/${iMixte}/complete`, {
      method: "POST",
      headers: farm.headers,
      body: JSON.stringify({
        periods: [{ startedAt: "2026-06-10T08:00:00Z", stoppedAt: "2026-06-10T10:00:00Z" }],
        targets: [{ kind: "land_parcel", id: pVigne }, { kind: "land_parcel", id: pBle }],
        inputs: [{ articleId: fongicide, quantity: 40, per: "total" }],
        purposes: ["fungicide"],
        compliance: { reason: "essai" },
      }),
    });
    expect(done.status, await done.clone().text()).toBe(200);
    const owner = await json(farm.headers, "/registers/phyto?campaign=2026");
    expect(new Set(owner.items.map((l: { parcelName: string }) => l.parcelName))).toEqual(new Set(["Les Vignes", "Le Grand Champ"]));
    const reg = await json(guest.headers, "/registers/phyto?campaign=2026");
    expect(reg.items.length).toBeGreaterThan(0);
    expect(reg.items.every((l: { parcelName: string }) => l.parcelName === "Les Vignes")).toBe(true);
  });

  it("assolement 2026 : reconstruit depuis les productions visibles, sans le brouillon", async () => {
    const plan = await json(guest.headers, "/crop-plans/2026");
    expect(plan.status).toBe("current");
    expect(plan.draft.assignments.map((a: { activityId: string }) => a.activityId)).toEqual([vigne]);
    expect(JSON.stringify(plan)).not.toContain(ble);
    const owner = await json(farm.headers, "/crop-plans/2026");
    expect(owner.status).toBe("draft");
  });

  it("le responsable voit tout", async () => {
    const acts = await json(farm.headers, "/activities");
    expect((acts.items ?? acts)).toHaveLength(2);
    const list = await json(farm.headers, "/interventions?campaign=2026");
    expect((list.items ?? list)).toHaveLength(4);
  });
});
