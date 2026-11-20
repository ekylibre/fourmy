import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { CropPlanContext, CropPlanDraft, CropPlanValidation, CropPlanVersionView, CropPlanView } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Assolement prévisionnel, lot AS2a (claudedocs/conception_assolement.md
 * §5, §6) : brouillon, contexte des contrôles, validation des productions,
 * réouverture, versions, droits.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const SQUARE = (x: number) => `MULTIPOLYGON(((${x} 44.8,${x + 0.0013} 44.8,${x + 0.0013} 44.8009,${x} 44.8009,${x} 44.8)))`;

describe.skipIf(!url)("assolement (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let other = { farmId: "", headers: {} as Record<string, string>, userId: "" };
  let users: string[] = [];
  let headers: Record<string, string> = {};
  let worker: Record<string, string> = {};
  let base = "";
  const parcels = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID() };
  const wheat = crypto.randomUUID();
  const rapeseed = crypto.randomUUID();
  const maize = crypto.randomUUID();

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test assolement");
    farmId = owner.farmId;
    headers = owner.headers;
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    other = await setupFarm(sql, "Autre ferme assolement");
    users = [owner.userId, w.userId, other.userId];
    base = `/api/v1/farms/${farmId}`;
    let x = 0.5;
    for (const [name, id] of [["Le Champ", parcels.a], ["La Côte", parcels.b], ["Le Bas", parcels.c]] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
                VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${SQUARE(x)}, 4326), 100000, tstzrange('2020-01-01', NULL))`;
      x += 0.002;
    }
    await sql`INSERT INTO activities (id, farm_id, name, family, cap_code) VALUES
      (${wheat}, ${farmId}, 'Blé tendre', 'plant_farming', 'BTH'),
      (${rapeseed}, ${farmId}, 'Colza', 'plant_farming', 'CZH'),
      (${maize}, ${farmId}, 'Maïs', 'plant_farming', 'MIS')`;
    // Campagne 2026 : blé sur Le Champ et La Côte (avec un couvert après), maïs sur Le Bas ; colza 2025 sur Le Champ.
    for (const [year, rows] of [
      [2025, [[parcels.a, rapeseed]]],
      [2026, [[parcels.a, wheat], [parcels.b, wheat], [parcels.c, maize]]],
    ] as const) {
      const campaign = crypto.randomUUID();
      await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${campaign}, ${farmId}, ${year}, make_date(${year}, 1, 1), make_date(${year}, 12, 31))`;
      for (const [parcel, activity] of rows) {
        await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id) VALUES (${crypto.randomUUID()}, ${farmId}, ${campaign}, ${parcel}, 'field_crop', ${activity})`;
      }
    }
    await sql`INSERT INTO cover_crops (id, farm_id, land_parcel_id, campaign, family, species, sown_on, destroyed_on)
              VALUES (${crypto.randomUUID()}, ${farmId}, ${parcels.b}, 2027, 'cruciferes', 'moutarde', '2026-08-20', '2027-02-20')`;
    await sql`INSERT INTO parcel_certifications (id, farm_id, land_parcel_id, kind, level, started_on)
              VALUES (${crypto.randomUUID()}, ${farmId}, ${parcels.c}, 'organic', 'certified', '2020-03-01')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, users.slice(0, 2));
    await teardown(sql, other.farmId, users.slice(2));
    await sql.end();
  });

  const send = (method: string, path: string, body?: unknown, h = headers) =>
    app.request(`${base}${path}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
  const assign = (key: string, activityId: string, extra: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    key,
    role: "main",
    activityId,
    startedOn: null,
    stoppedOn: null,
    ...extra,
  });

  it("crée l'assolement 2027 (responsable seulement), une fois", async () => {
    expect((await send("POST", "/crop-plans/2027", undefined, worker)).status).toBe(403);
    const res = await send("POST", "/crop-plans/2027");
    expect(res.status).toBe(201);
    const plan = await json<CropPlanView>(res);
    expect(plan).toMatchObject({ year: 2027, status: "draft", revision: 0, currentVersion: null, versions: [] });
    expect(plan.draft.assignments).toEqual([]);
    expect((await send("POST", "/crop-plans/2027")).status).toBe(409);
    // Liste : l'assolement 2027, et les campagnes 2026 et 2025 déjà saisies (sans assolement).
    expect((await json<{ year: number; status: string }[]>(send("GET", "/crop-plans", undefined, worker))).map((p) => [p.year, p.status])).toEqual([
      [2027, "draft"],
      [2026, "current"],
      [2025, "current"],
    ]);
    // Campagne 2026 sans assolement : affichée telle quelle (cultures saisies).
    const current = await json<CropPlanView>(send("GET", "/crop-plans/2026", undefined, worker));
    expect(current).toMatchObject({ year: 2026, status: "current", currentVersion: null });
    expect(current.draft.assignments).toHaveLength(3);
    expect((await send("GET", "/crop-plans/2030", undefined, worker)).status).toBe(404);
    // Autre ferme : rien à voir.
    expect((await app.request(`/api/v1/farms/${other.farmId}/crop-plans/2027`, { headers: other.headers })).status).toBe(404);
  });

  it("contexte : parcellaire, codes PAC des activités, historique, culture secondaire, certification", async () => {
    const ctx = await json<CropPlanContext>(send("GET", "/crop-plans/2027/context", undefined, worker));
    expect(ctx.parcels.map((p) => p.name)).toEqual(["La Côte", "Le Bas", "Le Champ"]);
    expect(ctx.parcels[0]!.shape).toMatchObject({ type: "MultiPolygon" });
    expect(ctx.activities.find((a) => a.id === rapeseed)).toMatchObject({ capCode: "CZH", cycle: "annual" });
    expect(ctx.history[parcels.a]).toMatchObject({ "2025": { main: "CZH" }, "2026": { main: "BTH", secondary: false } });
    expect(ctx.history[parcels.b]!["2026"]).toMatchObject({ main: "BTH", secondary: true });
    expect(ctx.previousByActivity[wheat]).toBe(200000);
    expect(ctx.certification.abParcels).toEqual({ [parcels.c]: { conversionStart: "2020-03-01" } });
  });

  it("sauvegarde avec révision ; une révision périmée rend l'assolement du serveur (409)", async () => {
    const draft: CropPlanDraft = { schema: 1, year: 2027, operations: [], covers: [], fallow: [], assignments: [assign(`p:${parcels.a}`, rapeseed)] as CropPlanDraft["assignments"] };
    const saved = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: 0, draft }));
    expect(saved.revision).toBe(1);
    expect((await send("PUT", "/crop-plans/2027/draft", { revision: 0, draft }, worker)).status).toBe(403);
    const stale = await send("PUT", "/crop-plans/2027/draft", { revision: 0, draft });
    expect(stale.status).toBe(409);
    expect((await stale.json()).current.revision).toBe(1);
    expect((await send("PUT", "/crop-plans/2027/draft", { revision: 1, draft: { ...draft, year: 2026 } })).status).toBe(409);
  });

  it("aperçu : parcelles sans culture bloquantes, contrôles calculés (colza deux ans après colza)", async () => {
    const preview = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate?dryRun=1", { revision: 1 }));
    expect(preview.version).toBeNull();
    expect(preview.blockers.map((b) => b.code)).toEqual(["unassigned"]);
    expect(preview.changes.map((c) => c.kind)).toEqual(["campaign.create", "production.create"]);
    expect(preview.sections.map((s) => s.id)).toEqual(["pac", "agronomy", "certification", "regulatory"]);
    const agro = preview.sections.find((s) => s.id === "agronomy")!;
    expect(agro.findings[0]!.message).toContain("Le Champ : crucifères");
    // Sans dryRun, des bloquants : rien n'est appliqué.
    const refused = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate", { revision: 1 }));
    expect(refused.version).toBeNull();
    expect((await sql`SELECT count(*)::int AS n FROM campaigns WHERE farm_id = ${farmId} AND year = 2027`)[0]!.n).toBe(0);
  });

  it("valide : campagne et productions créées, version 1 figée, assolement validé", async () => {
    const draft = {
      schema: 1,
      year: 2027,
      operations: [],
      covers: [],
      fallow: [],
      assignments: [
        assign(`p:${parcels.a}`, rapeseed, { startedOn: "2026-08-25", stoppedOn: "2027-07-05" }),
        assign(`p:${parcels.b}`, maize),
        assign(`p:${parcels.c}`, wheat),
        assign(`p:${parcels.a}`, maize, { role: "secondary" }),
      ],
    };
    await send("PUT", "/crop-plans/2027/draft", { revision: 1, draft });
    const done = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate", { revision: 2 }));
    expect(done.blockers).toEqual([]);
    expect(done.version).toBe(1);
    const prods = await sql`SELECT p.land_parcel_id, p.activity_id, p.started_on::text, p.attrs->'cropPlan'->>'role' AS role, p.nature
                            FROM productions p JOIN campaigns c ON c.id = p.campaign_id WHERE c.farm_id = ${farmId} AND c.year = 2027 ORDER BY p.started_on NULLS LAST`;
    expect(prods).toHaveLength(4);
    expect(prods[0]).toMatchObject({ land_parcel_id: parcels.a, activity_id: rapeseed, started_on: "2026-08-25", role: "main", nature: "field_crop" });
    expect(prods.filter((p) => p.role === "secondary")).toHaveLength(1);

    const plan = await json<CropPlanView>(send("GET", "/crop-plans/2027", undefined, worker));
    expect(plan).toMatchObject({ status: "validated", currentVersion: 1 });
    expect(plan.draft.assignments.every((a) => a.productionId)).toBe(true);
    const v1 = await json<CropPlanVersionView>(send("GET", "/crop-plans/2027/versions/1", undefined, worker));
    expect(v1.changes.filter((c) => c.kind === "production.create")).toHaveLength(4);
    expect(v1.snapshot.assignments.every((a) => a.productionId)).toBe(true);
    expect(v1.findings.map((s) => s.id)).toContain("pac");
    // Validé : il faut le rouvrir avant de le modifier.
    expect((await send("POST", "/crop-plans/2027/validate", { revision: plan.revision })).status).toBe(409);
  });

  it("révision : production avec intervention réalisée non supprimable ; modification et version 2", async () => {
    const reopened = await json<CropPlanView>(send("POST", "/crop-plans/2027/reopen"));
    expect(reopened.status).toBe("draft");
    // Un semis réalisé sur La Côte (maïs 2027).
    const sowing = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${sowing}, ${farmId}, 'sowing', 'done', 'web', '2027-04-20T08:00:00Z', '2027-04-20T12:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${sowing}, 'target', 'land_parcel', ${parcels.b})`;

    const withoutB = { ...reopened.draft, assignments: reopened.draft.assignments.filter((a) => a.key !== `p:${parcels.b}`), fallow: [{ key: `p:${parcels.b}` }] };
    const saved = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: reopened.revision, draft: withoutB }));
    const blocked = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate?dryRun=1", { revision: saved.revision }));
    expect(blocked.blockers.map((b) => b.code)).toEqual(["done-interventions"]);

    // Le Bas passe du blé au maïs : mise à jour de la production.
    const changed = {
      ...reopened.draft,
      assignments: reopened.draft.assignments.map((a) => (a.key === `p:${parcels.c}` ? { ...a, activityId: maize } : a)),
    };
    const s2 = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: saved.revision, draft: changed }));
    const v2 = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate", { revision: s2.revision, reason: "sortie d'hiver" }));
    expect(v2.version).toBe(2);
    expect(v2.changes.map((c) => c.kind)).toEqual(["production.update"]);
    const list = await json<CropPlanView>(send("GET", "/crop-plans/2027"));
    expect(list.versions.map((v) => [v.version, v.reason])).toEqual([[2, "sortie d'hiver"], [1, null]]);
  });

  it("abandon du brouillon : retour à la version validée ; réglages de l'assolement", async () => {
    const back = await json<CropPlanView>(send("DELETE", "/crop-plans/2027/draft"));
    expect(back).toMatchObject({ status: "validated", currentVersion: 2 });
    expect(back.draft.operations).toEqual([]);

    expect(await json(send("GET", "/settings/crop-plan", undefined, worker))).toEqual({ bcae7Preferred: "rotation", alsaceRhinePlain: false, returnIntervals: {} });
    expect((await send("PUT", "/settings/crop-plan", { returnIntervals: { cruciferes: 3 } }, worker)).status).toBe(403);
    expect(await json(send("PUT", "/settings/crop-plan", { returnIntervals: { cruciferes: 3 } }))).toMatchObject({ returnIntervals: { cruciferes: 3 } });
    expect((await json<CropPlanContext>(send("GET", "/crop-plans/2027/context"))).settings.returnIntervals).toEqual({ cruciferes: 3 });
  });

  // Le Champ (a) : x 0,5 à 0,5013 ; coupé en deux à x = 0,50065.
  const half = (x0: number, x1: number) => ({ type: "Polygon", coordinates: [[[x0, 44.8], [x1, 44.8], [x1, 44.8009], [x0, 44.8009], [x0, 44.8]]] });

  it("découpe : date d'effet après une intervention réalisée refusée ; fusion AB et non AB refusée", async () => {
    const reopened = await json<CropPlanView>(send("POST", "/crop-plans/2027/reopen"));
    // La Côte (b) porte un semis réalisé le 20/04/2027 : découpe au 01/01/2027 refusée.
    const bx = 0.502;
    const draft = {
      ...reopened.draft,
      operations: [
        { kind: "split", source: `p:${parcels.b}`, effectiveOn: "2027-01-01", pieces: [{ key: "n:b1", name: "La Côte haut", shape: half(bx, bx + 0.00065), areaM2: 50000 }, { key: "n:b2", name: "La Côte bas", shape: half(bx + 0.00065, bx + 0.0013), areaM2: 50000 }] },
        { kind: "merge", sources: [`p:${parcels.a}`, `p:${parcels.c}`], effectiveOn: "2026-08-01", result: { key: "n:ac", name: "Grande pièce", shape: half(0.5, 0.5053), areaM2: 200000 } },
      ],
    };
    const saved = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: reopened.revision, draft }));
    const preview = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate?dryRun=1", { revision: saved.revision }));
    const codes = preview.blockers.map((b) => b.code);
    expect(codes).toContain("effective-date"); // semis réalisé sur La Côte après le 01/01/2027
    expect(codes).toContain("certification"); // Le Bas est AB, Le Champ non
    expect(codes).toContain("geometry"); // Le Champ et Le Bas ne se touchent pas : la forme fusionnée ne colle pas
    expect(preview.blockers.find((b) => b.code === "effective-date")!.message).toContain("1 intervention(s) réalisée(s)");
    await send("DELETE", "/crop-plans/2027/draft");
  });

  it("découpe validée : nouvelles parcelles datées, filiation, productions sur les morceaux, historique hérité", async () => {
    const reopened = await json<CropPlanView>(send("POST", "/crop-plans/2027/reopen"));
    const draft = {
      ...reopened.draft,
      operations: [{ kind: "split", source: `p:${parcels.a}`, effectiveOn: "2026-08-01", pieces: [{ key: "n:a1", name: "Le Champ ouest", shape: half(0.5, 0.50065), areaM2: 50000 }, { key: "n:a2", name: "Le Champ est", shape: half(0.50065, 0.5013), areaM2: 50000 }] }],
      // Les cultures de Le Champ passent sur les morceaux : colza à l'ouest, maïs à l'est.
      assignments: [
        ...reopened.draft.assignments.filter((a) => a.key !== `p:${parcels.a}`),
        assign("n:a1", rapeseed, { startedOn: "2026-08-25", stoppedOn: "2027-07-05" }),
        assign("n:a2", maize, { startedOn: "2027-04-20" }),
      ],
    };
    const saved = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: reopened.revision, draft }));
    // Une culture qui commence avant la date d'effet est refusée.
    const early = { ...draft, operations: [{ ...draft.operations[0]!, effectiveOn: "2026-09-01" }] };
    const saved2 = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: saved.revision, draft: early }));
    const refused = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate?dryRun=1", { revision: saved2.revision }));
    expect(refused.blockers.map((b) => b.message).join(" ")).toContain("avant la date d'effet");

    const ok = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: saved2.revision, draft }));
    const done = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate", { revision: ok.revision, reason: "découpe de Le Champ" }));
    expect(done.blockers).toEqual([]);
    expect(done.version).toBe(3);

    const pieces = await sql`SELECT lp.id, lp.name, lower(v.valid)::date::text AS from_day, round(v.area_m2) AS area
                             FROM land_parcels lp JOIN land_parcel_versions v ON v.land_parcel_id = lp.id
                             WHERE lp.farm_id = ${farmId} AND lp.name LIKE 'Le Champ %' ORDER BY lp.name`;
    expect(pieces.map((p) => [p.name, p.from_day])).toEqual([["Le Champ est", "2026-08-01"], ["Le Champ ouest", "2026-08-01"]]);
    const [parent] = await sql`SELECT upper(valid)::date::text AS until FROM land_parcel_versions WHERE land_parcel_id = ${parcels.a}`;
    expect(parent!.until).toBe("2026-08-01");
    const lineage = await sql`SELECT parent_id, kind, round(share::numeric, 2)::float8 AS share FROM land_parcel_lineage WHERE farm_id = ${farmId}`;
    expect(lineage).toHaveLength(2);
    expect(lineage.every((l) => l.parent_id === parcels.a && l.kind === "split" && l.share === 1)).toBe(true);
    const prods = await sql`SELECT lp.name, p.activity_id FROM productions p JOIN campaigns c ON c.id = p.campaign_id JOIN land_parcels lp ON lp.id = p.land_parcel_id
                            WHERE c.farm_id = ${farmId} AND c.year = 2027 AND lp.name LIKE 'Le Champ%' ORDER BY lp.name`;
    expect(prods.map((p) => [p.name, p.activity_id])).toEqual([["Le Champ est", maize], ["Le Champ ouest", rapeseed]]);
    // Instantané : les morceaux portent leur identifiant définitif.
    const v3 = await json<CropPlanVersionView>(send("GET", "/crop-plans/2027/versions/3"));
    expect(v3.snapshot.assignments.some((a) => a.key.startsWith("n:"))).toBe(false);

    // Campagne 2028 : les morceaux remplacent Le Champ et héritent de son historique.
    const ctx = await json<CropPlanContext>(send("GET", "/crop-plans/2028/context"));
    expect(ctx.parcels.map((p) => p.name)).toEqual(["La Côte", "Le Bas", "Le Champ est", "Le Champ ouest"]);
    const west = ctx.parcels.find((p) => p.name === "Le Champ ouest")!;
    expect(west).toMatchObject({ validFrom: "2026-08-01", lastStoppedOn: "2027-07-05" });
    expect(ctx.history[west.id]).toMatchObject({ "2025": { main: "CZH" }, "2026": { main: "BTH" }, "2027": { main: "CZH" } });
  });

  it("zonages : aire de captage et site Natura 2000 de Lexicon, point d'eau", async () => {
    // Le Bas (c) : x 0,504 à 0,5053 ; captage sur sa moitié ouest, Natura 2000 sur toute la parcelle.
    await sql`INSERT INTO lexicon_water_catchments (id, basin, name, shape)
              VALUES ('fourmy-test-bac', 'ADOUR-GARONNE', 'BAC d''essai', ST_GeomFromText('MULTIPOLYGON(((0.504 44.799,0.50465 44.799,0.50465 44.802,0.504 44.802,0.504 44.799)))', 4326))`;
    await sql`INSERT INTO lexicon_natura2000 (id, name, nature, shape)
              VALUES ('fourmy-test-n2000', 'Vallée d''essai', 'zps', ST_GeomFromText('MULTIPOLYGON(((0.5035 44.799,0.506 44.799,0.506 44.802,0.5035 44.802,0.5035 44.799)))', 4326))`;
    try {
      const ctx = await json<CropPlanContext>(send("GET", "/crop-plans/2027/context"));
      const z = ctx.zones[parcels.c]!;
      expect(z.catchments).toHaveLength(1);
      expect(z.catchments[0]!.name).toBe("BAC d'essai");
      expect(z.catchments[0]!.share).toBeCloseTo(0.5, 1);
      expect(z.natura2000).toEqual([{ name: "Vallée d'essai", nature: "zps", share: expect.closeTo(1, 2) }]);
      // Contrôles : le blé ou le maïs prévu sur Le Bas est en aire de captage.
      const reopened = await json<CropPlanView>(send("POST", "/crop-plans/2027/reopen"));
      const preview = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate?dryRun=1", { revision: reopened.revision }));
      const reg = preview.sections.find((s) => s.id === "regulatory")!;
      expect(reg.findings.map((f) => f.ruleId)).toEqual(["reg.catchment", "reg.natura2000"]);
      await send("DELETE", "/crop-plans/2027/draft");
    } finally {
      await sql`DELETE FROM lexicon_water_catchments WHERE id = 'fourmy-test-bac'`;
      await sql`DELETE FROM lexicon_natura2000 WHERE id = 'fourmy-test-n2000'`;
    }
  });

  it("couverts d'interculture : enregistrés dans le cahier de fertilisation (campagne suivante), repris à la réouverture, retirés", async () => {
    const reopened = await json<CropPlanView>(send("POST", "/crop-plans/2027/reopen"));
    const cover = { id: "cv1", key: `p:${parcels.c}`, kind: "sown", family: "cruciferes", species: "moutarde blanche", sownOn: "2027-08-20", destroyedOn: "2028-02-20" };
    const saved = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: reopened.revision, draft: { ...reopened.draft, covers: [cover] } }));
    const done = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate", { revision: saved.revision }));
    expect(done.blockers).toEqual([]);
    expect(done.changes.map((c) => c.kind)).toEqual(["cover.create"]);
    const rows1 = await sql`SELECT campaign, kind, family, species, sown_on::text FROM cover_crops WHERE land_parcel_id = ${parcels.c}`;
    expect(rows1).toEqual([{ campaign: 2028, kind: "sown", family: "cruciferes", species: "moutarde blanche", sown_on: "2027-08-20" }]);

    const again = await json<CropPlanView>(send("POST", "/crop-plans/2027/reopen"));
    expect(again.draft.covers).toEqual([expect.objectContaining({ key: `p:${parcels.c}`, species: "moutarde blanche", coverId: expect.any(String) })]);
    const s2 = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: again.revision, draft: { ...again.draft, covers: [] } }));
    const removed = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate", { revision: s2.revision }));
    expect(removed.changes.map((c) => c.kind)).toEqual(["cover.delete"]);
    expect(await sql`SELECT id FROM cover_crops WHERE land_parcel_id = ${parcels.c}`).toEqual([]);
  });

  it("assolement jamais validé : l'abandon le supprime", async () => {
    expect((await send("POST", "/crop-plans/2028")).status).toBe(201);
    expect((await send("DELETE", "/crop-plans/2028/draft")).status).toBe(204);
    expect((await send("GET", "/crop-plans/2028")).status).toBe(404);
  });
});

/**
 * Lot AS5 : ferme reprise d'Ekylibre, une parcelle par culture et par
 * campagne (« Braquet Maïs 2025 », « Braquet Maïs 2026 »). L'assolement 2027
 * propose de reconduire les parcelles 2026 (noms nettoyés), retrouve
 * l'historique par recoupement géographique, et crée les parcelles 2027.
 */
describe.skipIf(!url)("assolement : reconduction d'un parcellaire repris d'Ekylibre (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let users: string[] = [];
  let headers: Record<string, string> = {};
  let base = "";
  const maize = crypto.randomUUID();
  const triticale = crypto.randomUUID();
  const ids = { b25: crypto.randomUUID(), b26: crypto.randomUUID(), strip26: crypto.randomUUID(), s26: crypto.randomUUID() };
  const BRAQUET = "MULTIPOLYGON(((0.6 44.8,0.6013 44.8,0.6013 44.8009,0.6 44.8009,0.6 44.8)))";
  const STRIP = "MULTIPOLYGON(((0.6 44.8,0.6012 44.8,0.6012 44.8008,0.6 44.8008,0.6 44.8)))";
  const SEDZERE = "MULTIPOLYGON(((0.603 44.8,0.6043 44.8,0.6043 44.8009,0.603 44.8009,0.603 44.8)))";

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test reprise Ekylibre");
    farmId = owner.farmId;
    headers = owner.headers;
    users = [owner.userId];
    base = `/api/v1/farms/${farmId}`;
    await sql`INSERT INTO lexicon_productions (reference_name, family, specie, label, started_on, stopped_on)
              VALUES ('fourmy_test_triticale', 'plant_farming', 'x_triticosecale', 'Triticale d''essai', '2000-09-01', '2001-07-31') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO activities (id, farm_id, name, family, cap_code, reference) VALUES (${maize}, ${farmId}, 'Maïs', 'plant_farming', 'MIS', NULL), (${triticale}, ${farmId}, 'Triticale', 'plant_farming', 'TTH', 'fourmy_test_triticale')`;
    const parcels: [string, string, string, string, string][] = [
      [ids.b25, "Braquet Maïs 2025", BRAQUET, "2024-12-31", "2025-12-30"],
      [ids.b26, "Braquet Maïs 2026", BRAQUET, "2025-12-31", "2026-12-30"],
      [ids.strip26, "Braquet bande Maïs 2026", STRIP, "2025-12-31", "2026-12-30"],
      [ids.s26, "Sedzère Triticale 2026", SEDZERE, "2025-08-31", "2026-12-30"],
    ];
    for (const [id, name, shape, from, to] of parcels) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
                VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${shape}, 4326), ST_Area(ST_GeomFromText(${shape}, 4326)::geography), tstzrange(${from}, ${to}))`;
    }
    for (const [year, rows] of [[2025, [[ids.b25, maize]]], [2026, [[ids.b26, maize], [ids.strip26, maize], [ids.s26, triticale]]]] as const) {
      const campaign = crypto.randomUUID();
      await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${campaign}, ${farmId}, ${year}, make_date(${year}, 1, 1), make_date(${year}, 12, 31))`;
      for (const [parcel, activity] of rows) {
        await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id) VALUES (${crypto.randomUUID()}, ${farmId}, ${campaign}, ${parcel}, 'field_crop', ${activity})`;
      }
    }
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql`DELETE FROM lexicon_productions WHERE reference_name = 'fourmy_test_triticale'`;
    await sql.end();
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;

  it("propose les parcelles 2026 à reconduire, noms nettoyés, bande en double écartée, historique par la carte", async () => {
    const ctx = await json<CropPlanContext>(send("GET", "/crop-plans/2027/context"));
    expect(ctx.parcels.map((p) => [p.name, p.carryOver, p.sourceName])).toEqual([
      ["Braquet", true, "Braquet Maïs 2026"],
      ["Sedzère", true, "Sedzère Triticale 2026"],
    ]);
    // Même nom nettoyé pour deux parcelles distinctes : numérotées (Cazala, Cazala 2).
    const { carriedName } = await import("../src/repos/crop-plans.js");
    expect(carriedName("Cazala Triticale 2026", ["Triticale", "Triticale d'hiver"])).toBe("Cazala");
    expect(carriedName("Monassut Chisné Maïs 2026", ["Maïs", "Maïs grain"])).toBe("Monassut Chisné");
    expect(carriedName("Le Champ", ["Blé"])).toBe("Le Champ");
    // Dates types de Lexicon ramenées à la campagne 2027 : semis en 2026, récolte en 2027.
    expect(ctx.activities.find((a) => a.id === triticale)).toMatchObject({ defaultStartedOn: "2026-09-01", defaultStoppedOn: "2027-07-31" });
    expect(ctx.activities.find((a) => a.id === maize)).toMatchObject({ defaultStartedOn: null, defaultStoppedOn: null });
    // 2026 : sa propre culture ; 2025 : celle de « Braquet Maïs 2025 », au même endroit.
    expect(ctx.history[ids.b26]).toMatchObject({ "2025": { main: "MIS" }, "2026": { main: "MIS" } });
  });

  it("valide : parcelle 2027 créée à la suite de l'ancienne, l'autre écartée ; découpe d'une parcelle à reconduire refusée", async () => {
    const plan = await json<CropPlanView>(send("POST", "/crop-plans/2027"));
    const square = { type: "Polygon", coordinates: [[[0.6, 44.8], [0.60065, 44.8], [0.60065, 44.8009], [0.6, 44.8009], [0.6, 44.8]]] };
    const withSplit = {
      ...plan.draft,
      operations: [{ kind: "split", source: `p:${ids.b26}`, effectiveOn: "2027-01-01", pieces: [{ key: "n:x1", name: "A", shape: square, areaM2: 1 }, { key: "n:x2", name: "B", shape: square, areaM2: 1 }] }],
    };
    const s1 = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: plan.revision, draft: withSplit }));
    const refused = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate?dryRun=1", { revision: s1.revision }));
    expect(refused.blockers.map((b) => b.message).join(" ")).toContain("parcelle reprise de l'an passé");

    const draft = {
      ...plan.draft,
      assignments: [{ id: "a1", key: `p:${ids.b26}`, role: "main", activityId: triticale, startedOn: "2026-10-20", stoppedOn: null }],
      excluded: [`p:${ids.s26}`],
    };
    const s2 = await json<CropPlanView>(send("PUT", "/crop-plans/2027/draft", { revision: s1.revision, draft }));
    const done = await json<CropPlanValidation>(send("POST", "/crop-plans/2027/validate", { revision: s2.revision }));
    expect(done.blockers).toEqual([]);
    expect(done.changes.map((c) => c.kind)).toEqual(["campaign.create", "parcel.carry", "production.create"]);
    const created = await sql`SELECT lp.id, lp.name, lower(v.valid)::date::text AS from_day, upper(v.valid) AS until
                              FROM land_parcels lp JOIN land_parcel_versions v ON v.land_parcel_id = lp.id WHERE lp.farm_id = ${farmId} AND lp.name = 'Braquet'`;
    expect(created).toEqual([{ id: expect.any(String), name: "Braquet", from_day: "2026-12-30", until: null }]);
    const [lineage] = await sql`SELECT parent_id, kind FROM land_parcel_lineage WHERE child_id = ${created[0]!.id}`;
    expect(lineage).toEqual({ parent_id: ids.b26, kind: "carry" });
    const [prod] = await sql`SELECT p.activity_id FROM productions p JOIN campaigns c ON c.id = p.campaign_id WHERE c.year = 2027 AND p.land_parcel_id = ${created[0]!.id}`;
    expect(prod!.activity_id).toBe(triticale);

    // 2028 : « Braquet » est la parcelle en cours ; historique 2025 à 2027.
    const ctx = await json<CropPlanContext>(send("GET", "/crop-plans/2028/context"));
    expect(ctx.parcels.map((p) => [p.name, !!p.carryOver])).toEqual([["Braquet", false]]);
    expect(ctx.history[created[0]!.id as string]).toMatchObject({ "2025": { main: "MIS" }, "2026": { main: "MIS" }, "2027": { main: "TTH" } });
  });
});
