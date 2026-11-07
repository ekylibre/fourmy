import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { TraccarClient, syncTraccar, type TraccarPosition } from "../src/index.js";

/** Synchronisation contre un faux serveur Traccar (pas de réseau) et la vraie base. */
const url = process.env.DATABASE_URL;
const farmId = crypto.randomUUID();

function fakeTraccar(positions: TraccarPosition[]) {
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const u = new URL(String(input));
    if (u.pathname === "/api/devices") {
      return new Response(JSON.stringify([{ id: 42, name: "Tracteur Test" }, { id: 43, name: "Orphelin" }]));
    }
    if (u.pathname === "/api/positions") {
      const from = Date.parse(u.searchParams.get("from")!);
      const to = Date.parse(u.searchParams.get("to")!);
      const out = positions.filter((p) => Date.parse(p.fixTime) >= from && Date.parse(p.fixTime) < to);
      return new Response(JSON.stringify(out));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return new TraccarClient("https://traccar.test", { token: "x" }, fetchImpl);
}

const positions = (working: string): TraccarPosition[] =>
  Array.from({ length: 20 }, (_, i) => ({
    id: i,
    deviceId: 42,
    fixTime: new Date(Date.UTC(2026, 9, 5, 12, 0, i * 5)).toISOString(),
    latitude: 44.8 + i * 0.00001,
    longitude: 0.5,
    speed: 3,
    valid: true,
    attributes: { isWorking: working, workingWidth: "6 m" },
  }));

describe.skipIf(!url)("synchronisation Traccar (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  beforeAll(async () => {
    await sql`INSERT INTO farms (id, name) VALUES (${farmId}, 'Ferme test traccar')`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${crypto.randomUUID()}, ${farmId}, 'Tracteur Test', 'tractor')`;
  });
  afterAll(async () => {
    await sql`DELETE FROM farms WHERE id = ${farmId}`;
    await sql.end();
  });

  const run = (client: TraccarClient, full = false) =>
    syncTraccar({
      targetUrl: url!,
      farmId,
      client,
      since: new Date("2026-10-01T00:00:00Z"),
      until: new Date("2026-10-10T00:00:00Z"),
      full,
    });

  it("rattache par nom, insère, reprend sans doublon, met à jour en réingestion", async () => {
    const first = await run(fakeTraccar(positions("False")));
    expect(first.inserted).toBe(20);
    expect(first.unmatched).toEqual([{ deviceId: 43, name: "Orphelin", reason: "aucun matériel de ce nom" }]);

    const again = await run(fakeTraccar(positions("False")));
    expect(again.inserted).toBe(0); // reprise après la dernière position

    const same = await run(fakeTraccar(positions("False")), true);
    expect(same.updated).toBe(0); // rien n'a changé : aucune réécriture

    const changed = await run(fakeTraccar(positions("True")), true);
    expect(changed.updated).toBe(20);
    const [r] = await sql`SELECT count(*) FILTER (WHERE (attrs->>'working')::boolean)::int AS working
                          FROM positions WHERE farm_id = ${farmId}`;
    expect(r?.working).toBe(20);
  });
});
