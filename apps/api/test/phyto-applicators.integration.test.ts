import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { applicatorsOf } from "@fourmy/domain";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Applicateur du registre phyto (lot R1, FR-ATT-12) : les cas du test de
 * domaine (packages/domain/test/applicators.test.ts) enregistrés par l'API,
 * relus par la vue `phyto_register` (fonction SQL `fourmy_input_applicators`)
 * et comparés à `applicatorsOf`. Le contrôle réglementaire signale un
 * attelage du pulvérisateur sans intervenant.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const ids = {
  tractorA: crypto.randomUUID(),
  tractorB: crypto.randomUUID(),
  sprayer: crypto.randomUUID(),
  harrow: crypto.randomUUID(),
  ann: crypto.randomUUID(),
  bob: crypto.randomUUID(),
  parcel: crypto.randomUUID(),
  product: crypto.randomUUID(),
  hangar: crypto.randomUUID(),
  lot: crypto.randomUUID(),
};
const names: Record<string, string> = { [ids.ann]: "Ann", [ids.bob]: "Bob" };
const hints: Record<string, { kind: string; avatarTemplate?: string }> = {
  [ids.tractorA]: { kind: "tractor" },
  [ids.tractorB]: { kind: "tractor" },
  [ids.sprayer]: { kind: "trailed_equipment", avatarTemplate: "trailed_sprayer" },
  [ids.harrow]: { kind: "trailed_equipment" },
};

type Crew = { tools: { equipmentId: string }[]; doers: { personId: string }[]; periods: { startedAt: string; stoppedAt: string }[] };
const crew = (day: number, tools: string[], doers: string[]): Crew => ({
  tools: tools.map((equipmentId) => ({ equipmentId })),
  doers: doers.map((personId) => ({ personId })),
  periods: [{ startedAt: `2026-05-${String(day).padStart(2, "0")}T08:00:00Z`, stoppedAt: `2026-05-${String(day).padStart(2, "0")}T10:00:00Z` }],
});

// Mêmes cas que le test de domaine, un jour chacun.
const cases: { name: string; staffing: "free" | "crews"; crews?: Crew[]; doers?: string[]; inputEquipment?: string }[] = [
  { name: "1. libre", staffing: "free", doers: [ids.ann, ids.bob] },
  { name: "2. matériel de l'intrant", staffing: "crews", crews: [crew(2, [ids.tractorA, ids.sprayer], [ids.ann]), crew(2, [ids.tractorB, ids.harrow], [ids.bob])], inputEquipment: ids.harrow },
  { name: "3. pulvérisateur", staffing: "crews", crews: [crew(3, [ids.tractorB, ids.harrow], [ids.bob]), crew(3, [ids.tractorA, ids.sprayer], [ids.ann])] },
  { name: "4. seul attelage", staffing: "crews", crews: [crew(4, [ids.tractorA, ids.harrow], [ids.ann])] },
  { name: "5. ambigu", staffing: "crews", crews: [crew(5, [ids.tractorA], [ids.ann]), crew(5, [ids.tractorB], [ids.bob])] },
  { name: "pulvérisateur sans intervenant", staffing: "crews", crews: [crew(6, [ids.tractorA, ids.sprayer], []), crew(6, [ids.tractorB], [ids.bob])] },
];

describe.skipIf(!url)("applicateur du registre phyto (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let base = "";
  const created: string[] = [];

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test applicateurs"));
    base = `/api/v1/farms/${farmId}`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${ids.parcel}, ${farmId}, 'Les Vignes')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${ids.parcel},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326), 10000, tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind, avatar) VALUES
      (${ids.tractorA}, ${farmId}, 'Tracteur A', 'tractor', NULL), (${ids.tractorB}, ${farmId}, 'Tracteur B', 'tractor', NULL),
      (${ids.sprayer}, ${farmId}, 'Pulvé', 'trailed_equipment', '{"template": "trailed_sprayer"}'),
      (${ids.harrow}, ${farmId}, 'Herse', 'trailed_equipment', NULL)`;
    await sql`INSERT INTO people (id, farm_id, name) VALUES (${ids.ann}, ${farmId}, 'Ann'), (${ids.bob}, ${farmId}, 'Bob')`;
    // Produit sans n° AMM : feu orange « contrôle impossible », jamais rouge.
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${ids.product}, ${farmId}, 'Fongicide sans AMM', 'phyto', 'liter')`;
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${ids.hangar}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO place_versions (id, place_id, kind, source, valid) VALUES (${crypto.randomUUID()}, ${ids.hangar}, 'building', 'manual', tstzrange('2000-01-01', NULL))`;
    await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${ids.lot}, ${farmId}, ${ids.product}, 'LOT')`;
    await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${ids.lot}, ${ids.hangar}, 1000, 'liter', '2026-01-02', 'purchase')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });

  it("le registre (SQL) donne le même applicateur que applicatorsOf (TS), cas par cas", async () => {
    for (const [k, c] of cases.entries()) {
      const id = crypto.randomUUID();
      created.push(id);
      const input = { articleId: ids.product, quantity: 1, per: "hectare", ...(c.inputEquipment ? { equipmentId: c.inputEquipment } : {}) };
      const common = { targets: [{ kind: "land_parcel", id: ids.parcel }], inputs: [input], purposes: ["fungicide"] };
      expect((await send("POST", "/interventions", { id, procedure: "spraying", plannedAt: "2026-05-01T08:00:00Z", ...common })).status).toBe(201);
      const body =
        c.staffing === "crews"
          ? { staffing: "crews", crews: c.crews }
          : { doers: c.doers!.map((personId) => ({ personId })), periods: [{ startedAt: `2026-05-0${k + 1}T08:00:00Z`, stoppedAt: `2026-05-0${k + 1}T10:00:00Z` }] };
      const res = await send("POST", `/interventions/${id}/complete`, { ...common, ...body });
      expect(res.status, `${c.name} : ${await res.clone().text()}`).toBe(200);
    }
    const register = (await (await send("GET", "/registers/phyto?campaign=2026")).json()).items as { interventionId: string; applicators: string[] }[];
    expect(register).toHaveLength(cases.length);
    for (const [k, c] of cases.entries()) {
      const expected = applicatorsOf(
        { staffing: c.staffing, crews: c.crews, doers: (c.doers ?? []).map((personId) => ({ personId })) },
        { equipmentId: c.inputEquipment },
        (id) => hints[id],
      );
      const row = register.find((r) => r.interventionId === created[k]);
      expect(row?.applicators, c.name).toEqual(expected.personIds.map((p) => names[p]).sort());
    }
    const csv = await (await send("GET", "/registers/phyto?campaign=2026&format=csv")).text();
    expect(csv.split("\r\n")[0]).toMatch(/;Applicateur$/);
    expect(csv).toContain(";non renseigné\r\n");
  });

  it("contrôle : feu orange sans intervenant, information si ambigu, rien sinon", async () => {
    const indicators = async (k: number) => {
      const r = await (await send("GET", `/interventions/${created[k]}/compliance`)).json();
      return (r.checks[0].indicators as { code: string; level: string; message: string }[]).filter((i) => i.code === "applicator");
    };
    expect(await indicators(5)).toEqual([{ code: "applicator", level: "warning", message: "Applicateur non renseigné : l'attelage 1 n'a pas d'intervenant." }]);
    expect((await indicators(4)).map((i) => i.level)).toEqual(["info"]);
    expect(await indicators(2)).toEqual([]);
    expect(await indicators(0)).toEqual([]); // mode libre : inchangé
  });
});
