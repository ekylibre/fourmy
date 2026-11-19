import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyBundle, registerReader } from "@fourmy/importers";
import { createApp } from "../src/app.js";
import { purgeExpiredImportFiles } from "../src/repos/file-imports.js";
import { db } from "../src/db.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/**
 * Imports de fichiers, lot IM1 (claudedocs/workflow_import_onboarding.md) :
 * dépôt, reconnaissance, suivi, décisions, abandon, purge. Le jeu DAPLOS
 * anonymisé sert de fichier ; un faux lecteur TelePAC sert à l'aperçu.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const emptyDaplos = "EI400000000000035  999999999999999  1   \r\nDE                                    2026111800630.95\r\n";
const fixture = readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "importers", "test", "fixtures", "daplos-pilote.dap"));
/** Le jeu DAPLOS, rendu unique par une ligne vide finale (autre empreinte, même contenu). */
const daplos = (variant = 0) => new Uint8Array(Buffer.concat([fixture, Buffer.from("\r\n".repeat(variant))]));
const telepac = (pacage: string) =>
  `<?xml version="1.0" encoding="ISO-8859-1"?>\n<producteurs xmlns="urn:x-telepac:fr.gouv.agriculture.telepac:echange-producteur"><producteur numero-pacage="${pacage}"/></producteurs>`;

describe.skipIf(!url)("imports de fichiers (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let otherFarmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let worker: { userId: string; headers: Record<string, string> };
  let other: { userId: string; headers: Record<string, string> };
  let restore: (() => void) | null = null;
  const base = () => `/api/v1/farms/${farmId}`;

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test imports fichiers");
    farmId = o.farmId;
    owner = o;
    worker = await addMember(sql, farmId, "worker");
    const x = await setupFarm(sql, "Autre ferme");
    otherFarmId = x.farmId;
    other = x;
    await sql`UPDATE farms SET siret = '40000000000003' WHERE id = ${farmId}`;
  });
  afterEach(() => {
    restore?.();
    restore = null;
  });
  afterAll(async () => {
    await sql`DELETE FROM import_runs WHERE farm_id IN (${farmId}, ${otherFarmId})`;
    await teardown(sql, farmId, [owner.userId, worker.userId]);
    await teardown(sql, otherFarmId, [other.userId]);
    await sql.end();
  });

  const upload = (headers: Record<string, string>, name: string, content: string | Uint8Array, farm = farmId) => {
    const form = new FormData();
    form.set("file", new File([typeof content === "string" ? Buffer.from(content, "latin1") : content], name));
    return app.request(`/api/v1/farms/${farm}/imports/files`, { method: "POST", headers: { authorization: headers.authorization! }, body: form });
  };

  it("réservé au responsable ; le suivi se lit par les membres", async () => {
    expect((await upload(worker.headers, "x.dap", daplos())).status).toBe(403);
    expect((await app.request(`${base()}/imports`, { headers: worker.headers })).status).toBe(200);
  });

  it("refuse un format inconnu ou un envoi sans fichier, sans rien garder", async () => {
    const r = await upload(owner.headers, "notes.txt", "bonjour");
    expect(r.status).toBe(422);
    expect((await r.json()).detail).toMatch(/DAPLOS.*Geofolia.*TelePAC/);
    const none = await app.request(`${base()}/imports/files`, { method: "POST", headers: { authorization: owner.headers.authorization! }, body: new FormData() });
    expect(none.status).toBe(400);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM import_files WHERE farm_id = ${farmId}`;
    expect(n).toBe(0);
  });

  it("reconnaît et lit un DAPLOS ; un DAPLOS sans culture est refusé sans rien garder ; fichier gardé une seule fois", async () => {
    const empty = await upload(owner.headers, "vide.dap", emptyDaplos);
    expect(empty.status).toBe(422);
    const [{ n: none }] = await sql`SELECT count(*)::int AS n FROM import_files WHERE farm_id = ${farmId}`;
    expect(none).toBe(0);

    const first = await upload(owner.headers, "C:\\exports\\40000000000003.dap", daplos());
    expect(first.status).toBe(201);
    const run = await first.json();
    expect(run).toMatchObject({ source: "file:daplos", format: "daplos", status: "analyzed", file: { name: "40000000000003.dap" } });
    expect(run.preview).toMatchObject({ readable: true, format: "daplos", farm: { siretMatches: true } });
    expect(run.preview.warnings.some((w: { level: string }) => w.level === "blocking")).toBe(false);

    // Même contenu : même fichier, même analyse en attente.
    const again = await upload(owner.headers, "copie.dap", daplos());
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(run.id);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM import_files WHERE farm_id = ${farmId}`;
    expect(n).toBe(1);

    const list = await (await app.request(`${base()}/imports`, { headers: worker.headers })).json();
    expect(list.items.map((i: { id: string }) => i.id)).toContain(run.id);
    expect(JSON.stringify(list)).not.toMatch(/bytes/);
  });

  it("aperçu, SIRET différent bloquant puis confirmé par décision", async () => {
    restore = registerReader("telepac", () => {
      const b = emptyBundle("telepac");
      b.farm.siret = "12345678901234";
      b.campaigns = [2026];
      return b;
    });
    const run = await (await upload(owner.headers, "Dossier-PAC-2026.xml", telepac("044000001"))).json();
    expect(run.preview).toMatchObject({ readable: true, campaigns: [2026], farm: { siretMatches: false } });
    expect(run.preview.warnings.some((w: { level: string }) => w.level === "blocking")).toBe(true);

    const put = (body: unknown, headers = owner.headers) =>
      app.request(`${base()}/imports/${run.id}/decisions`, { method: "PUT", headers, body: JSON.stringify(body) });
    expect((await put({ confirmSiret: true }, worker.headers)).status).toBe(403);
    expect((await put({ inconnu: 1 })).status).toBe(400);
    const decided = await (await put({ confirmSiret: true })).json();
    expect(decided.decisions).toEqual({ confirmSiret: true });
    expect(decided.preview.warnings.some((w: { level: string }) => w.level === "blocking")).toBe(false);
  });

  it("abandon : fichier supprimé, plus de décision possible", async () => {
    const run = await (await upload(owner.headers, "autre.xml", telepac("044000002"))).json();
    const discarded = await (await app.request(`${base()}/imports/${run.id}/discard`, { method: "POST", headers: owner.headers })).json();
    expect(discarded).toMatchObject({ status: "discarded", file: null });
    expect(discarded.finishedAt).not.toBeNull();
    const again = await app.request(`${base()}/imports/${run.id}/decisions`, { method: "PUT", headers: owner.headers, body: "{}" });
    expect(again.status).toBe(409);
  });

  it("une ferme ne voit ni les imports ni les fichiers d'une autre", async () => {
    const mine = await (await upload(other.headers, "x.dap", daplos(1), otherFarmId)).json();
    expect((await app.request(`${base()}/imports/${mine.id}`, { headers: owner.headers })).status).toBe(404);
    const theirs = await (await app.request(`/api/v1/farms/${otherFarmId}/imports`, { headers: other.headers })).json();
    expect(theirs.items).toHaveLength(1);
  });

  it("purge : fichiers expirés supprimés, analyses sans fichier abandonnées", async () => {
    const run = await (await upload(owner.headers, "vieux.dap", daplos(2))).json();
    await sql`UPDATE import_files SET expires_at = now() - interval '1 day' WHERE farm_id = ${farmId} AND name = 'vieux.dap'`;
    const r = await purgeExpiredImportFiles(db());
    expect(r.files).toBeGreaterThanOrEqual(1);
    const after = await (await app.request(`${base()}/imports/${run.id}`, { headers: owner.headers })).json();
    expect(after).toMatchObject({ status: "discarded", file: null });
  });
});
