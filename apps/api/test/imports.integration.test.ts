import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { pendingImports } from "../src/routes/imports.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/**
 * Imports Ekylibre via l'API. Les garde-fous se testent partout ; l'import
 * réel seulement si une base source restaurée est disponible
 * (MIGRATOR_SOURCE_URL → on en déduit EKYLIBRE_SOURCES_URL).
 */
const url = process.env.DATABASE_URL;
const source = process.env.MIGRATOR_SOURCE_URL;
const app = createApp();

describe.skipIf(!url)("imports Ekylibre (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let worker: { userId: string; headers: Record<string, string> };
  let base = "";
  const saved = process.env.EKYLIBRE_SOURCES_URL;

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test imports");
    farmId = o.farmId;
    owner = o;
    worker = await addMember(sql, farmId, "worker");
    base = `/api/v1/farms/${farmId}`;
  });
  afterAll(async () => {
    process.env.EKYLIBRE_SOURCES_URL = saved;
    await sql`DELETE FROM import_runs WHERE farm_id = ${farmId}`;
    await teardown(sql, farmId, [owner.userId, worker.userId]);
    await sql.end();
  });

  const start = (headers: Record<string, string>, body: unknown) =>
    app.request(`${base}/imports/ekylibre`, { method: "POST", headers, body: JSON.stringify(body) });

  it("réservé au responsable (owner)", async () => {
    expect((await start(worker.headers, { sourceDatabase: "ekylibre_src_x" })).status).toBe(403);
  });

  it("503 si les imports ne sont pas configurés", async () => {
    delete process.env.EKYLIBRE_SOURCES_URL;
    expect((await start(owner.headers, { sourceDatabase: "ekylibre_src_x" })).status).toBe(503);
  });

  it("refuse tout ce qui n'est pas un nom de base source (jamais d'URL)", async () => {
    process.env.EKYLIBRE_SOURCES_URL = "postgres://fourmy:fourmy@localhost:5432/";
    for (const sourceDatabase of [
      "postgres://evil@host/db",
      "fourmy",
      "ekylibre_src_x; DROP TABLE farms",
      "../ekylibre_src_x",
    ]) {
      expect((await start(owner.headers, { sourceDatabase })).status).toBe(400);
    }
  });

  it.skipIf(!source)("import réel : 202, suivi, registre phyto identique, données dans la ferme visée", async () => {
    const db = new URL(source!).pathname.slice(1);
    process.env.EKYLIBRE_SOURCES_URL = new URL("/", source!).toString();
    const res = await start(owner.headers, { sourceDatabase: db });
    expect(res.status).toBe(202);
    const run = await res.json();
    expect(run.status).toBe("running");

    // Un second import pendant le premier est refusé.
    expect((await start(owner.headers, { sourceDatabase: db })).status).toBe(409);

    await Promise.all([...pendingImports]);
    const done = await (await app.request(`${base}/imports/${run.id}`, { headers: worker.headers })).json();
    expect(done.status).toBe("completed");
    for (const y of done.report.phyto) expect(y.fourmy).toBe(y.ekylibre);

    // Les données sont dans la ferme de l'URL, qui garde son nom.
    const [farm] = await sql`SELECT name FROM farms WHERE id = ${farmId}`;
    expect(farm?.name).toBe("Ferme test imports");
    const parcels = await (await app.request(`${base}/land-parcels`, { headers: worker.headers })).json();
    expect(parcels.items.length).toBeGreaterThan(0);
  }, 120_000);

  it("le suivi d'un import d'une autre ferme est invisible (RLS)", async () => {
    const other = await setupFarm(sql, "Ferme voisine imports");
    const runId = crypto.randomUUID();
    await sql`INSERT INTO import_runs (id, farm_id, source, status) VALUES (${runId}, ${other.farmId}, 'x', 'completed')`;
    const res = await app.request(`${base}/imports/${runId}`, { headers: owner.headers });
    expect(res.status).toBe(404);
    await sql`DELETE FROM import_runs WHERE id = ${runId}`;
    await teardown(sql, other.farmId, [other.userId]);
  });
});
