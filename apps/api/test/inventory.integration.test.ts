import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadFixture, type FixtureFile } from "@fourmy/db";
import { createApp } from "../src/app.js";
import { addMember } from "./helpers.js";

/**
 * Lectures sur la fixture viticole (données réelles anonymisées) : valeurs
 * connues à l'avance (migration du 2026-11-07).
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("snapshot, cuves, stocks, registre (fixture viticole)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let base = "";
  let headers: Record<string, string> = {};
  let userId = "";

  beforeAll(async () => {
    const path = fileURLToPath(new URL("../../../fixtures/pilote-viticulture.json", import.meta.url));
    const fixture = JSON.parse(await readFile(path, "utf8")) as FixtureFile;
    await loadFixture(sql, fixture);
    const farmId = fixture.tables.farms![0]!.id as string;
    ({ headers, userId } = await addMember(sql, farmId, "worker"));
    base = `/api/v1/farms/${farmId}`;
  }, 60_000);
  afterAll(async () => {
    await sql`DELETE FROM memberships WHERE user_id = ${userId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end();
  });

  it("snapshot fin 2021 : parcelles nommées, 6 cuves (GV2, GV6, GV8 arrivent en 2023), volumes", async () => {
    const snap = await (await app.request(`${base}/snapshot?at=2021-12-31T23:00:00Z`, { headers })).json();
    expect(snap.landParcels).toHaveLength(9);
    expect(snap.landParcels[0].name).toMatch(/^Parcelle \d{3}$/);
    expect(snap.containers).toHaveLength(6);
    const later = await (await app.request(`${base}/snapshot?at=2023-12-31T23:00:00Z`, { headers })).json();
    expect(later.containers).toHaveLength(9);
    const byName = Object.fromEntries(snap.containers.map((c: { name: string }) => [c.name, c]));
    expect(byName["Cuve 1"].volumeL).toBe(3000);
    expect(byName["Cuve 3"].volumeL).toBe(2800);
    expect(byName["GV3"].volumeL).toBe(500);
    expect(byName["GV3"].version.capacityL).toBe(600); // corrigée dans Fourmy
    expect(snap.places.length).toBeGreaterThan(0);
  });

  it("le snapshot suit le temps : fin 2020, la Cuve 1 est vide", async () => {
    const snap = await (await app.request(`${base}/snapshot?at=2020-12-31T23:00:00Z`, { headers })).json();
    const cuve1 = snap.containers.find((c: { name: string }) => c.name === "Cuve 1");
    expect(cuve1.volumeL).toBe(0);
  });

  it("contenu de la Cuve 1 : volume, lots de vendange, cépage, derniers mouvements", async () => {
    const snap = await (await app.request(`${base}/snapshot?at=2021-12-31T23:00:00Z`, { headers })).json();
    const id = snap.containers.find((c: { name: string }) => c.name === "Cuve 1").id;
    const res = await app.request(`${base}/containers/${id}/contents?at=2021-12-31T23:00:00Z`, { headers });
    expect(res.status).toBe(200);
    const contents = await res.json();
    expect(contents.volumeL).toBe(3000);
    expect(contents.composition.reduce((s: number, p: { share: number }) => s + p.share, 0)).toBeCloseTo(1);
    expect(contents.composition[0].lotCode).toMatch(/^LOT-\d{4}$/);
    expect(contents.composition[0].attrs.varieties).toContain("CABERNET-SAUVIGNON N");
    expect(contents.lastMovements.length).toBeGreaterThan(0);
  });

  it("stock à une date, filtrable par cuve", async () => {
    const all = await (await app.request(`${base}/stock?at=2021-12-31T23:00:00Z`, { headers })).json();
    expect(all.items.length).toBeGreaterThan(0);
    const snap = await (await app.request(`${base}/snapshot?at=2021-12-31T23:00:00Z`, { headers })).json();
    const id = snap.containers.find((c: { name: string }) => c.name === "Cuve 1").id;
    const inTank = await (await app.request(`${base}/stock?at=2021-12-31T23:00:00Z&place=${id}`, { headers })).json();
    const total = inTank.items.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0);
    expect(total).toBe(3000);
  });

  it("registre phyto 2021 : 260 lignes (identique à Ekylibre), en JSON et en CSV", async () => {
    const json = await (await app.request(`${base}/registers/phyto?campaign=2021`, { headers })).json();
    expect(json.items).toHaveLength(260);
    const csv = await app.request(`${base}/registers/phyto?campaign=2021&format=csv`, { headers });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toBe("Date;Parcelle;Surface (ha);Culture;Produit;N° AMM;Dose;Unité;Applicateur");
    expect(lines).toHaveLength(261);
  });

  it("valide les paramètres (400) et les cuves inconnues (404)", async () => {
    expect((await app.request(`${base}/registers/phyto?campaign=abc`, { headers })).status).toBe(400);
    expect((await app.request(`${base}/snapshot?at=pas-une-date`, { headers })).status).toBe(400);
    const unknown = await app.request(`${base}/containers/${crypto.randomUUID()}/contents`, { headers });
    expect(unknown.status).toBe(404);
  });
});
