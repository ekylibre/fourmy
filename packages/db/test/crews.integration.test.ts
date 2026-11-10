import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres, { type TransactionSql } from "postgres";

/**
 * Garde des attelages (migration 0022) : invariants vérifiés en fin de
 * transaction, quel que soit l'écrivain. Ne s'exécute que sur une base migrée.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("attelages (0022)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const farm = crypto.randomUUID();
  const tractor = crypto.randomUUID();
  const tool = crypto.randomUUID();
  const person = crypto.randomUUID();

  beforeAll(async () => {
    await sql`INSERT INTO farms (id, name) VALUES (${farm}, 'Ferme attelages (test)')`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind, state) VALUES
      (${tractor}, ${farm}, 'Tracteur', 'tractor', 'active'), (${tool}, ${farm}, 'Charrue', 'trailed_equipment', 'active')`;
    await sql`INSERT INTO people (id, farm_id, name) VALUES (${person}, ${farm}, 'Camille')`;
  });
  afterAll(async () => {
    await sql`DELETE FROM farms WHERE id = ${farm}`;
    await sql.end();
  });

  /** Écrit une intervention dans une transaction (validée à la fin → garde). */
  const write = (staffing: "free" | "crews", fill: (tx: TransactionSql, id: string) => Promise<unknown>) =>
    sql.begin(async (tx) => {
      const id = crypto.randomUUID();
      await tx`INSERT INTO interventions (id, farm_id, procedure, status, origin, staffing)
               VALUES (${id}, ${farm}, 'plowing', 'done', 'web', ${staffing})`;
      await fill(tx, id);
      return id;
    });
  const crew = (tx: TransactionSql, id: string, rank = 0) => {
    const cid = crypto.randomUUID();
    return tx`INSERT INTO intervention_crews (id, intervention_id, rank) VALUES (${cid}, ${id}, ${rank})`.then(() => cid);
  };
  const param = (tx: TransactionSql, id: string, role: string, refType: string, refId: string, crewId: string | null) =>
    tx`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, crew_id)
       VALUES (${crypto.randomUUID()}, ${id}, ${role}, ${refType}, ${refId}, ${crewId})`;
  const period = (tx: TransactionSql, id: string, from: string, to: string, crewId: string | null) =>
    tx`INSERT INTO intervention_periods (id, intervention_id, started_at, stopped_at, crew_id)
       VALUES (${crypto.randomUUID()}, ${id}, ${from}, ${to}, ${crewId})`;

  it("mode libre : inchangé", async () => {
    await expect(
      write("free", async (tx, id) => {
        await param(tx, id, "tool", "equipment", tractor, null);
        await period(tx, id, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", null);
      }),
    ).resolves.toBeTypeOf("string");
  });

  it("mode libre : aucun attelage accepté", async () => {
    await expect(
      write("free", async (tx, id) => {
        const c = await crew(tx, id);
        await param(tx, id, "tool", "equipment", tractor, c);
        await period(tx, id, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", c);
      }),
    ).rejects.toThrow(/mode libre/);
  });

  it("attelages : deux attelages qui se chevauchent, un sans intervenant", async () => {
    await expect(
      write("crews", async (tx, id) => {
        const a = await crew(tx, id, 0);
        const b = await crew(tx, id, 1);
        await param(tx, id, "tool", "equipment", tractor, a);
        await param(tx, id, "doer", "person", person, a);
        await period(tx, id, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", a);
        await param(tx, id, "tool", "equipment", tool, b);
        await period(tx, id, "2026-10-28T09:00:00Z", "2026-10-28T12:00:00Z", b);
        await param(tx, id, "target", "equipment", tool, null);
      }),
    ).resolves.toBeTypeOf("string");
  });

  it("attelages : matériel hors attelage refusé", async () => {
    await expect(
      write("crews", async (tx, id) => {
        const a = await crew(tx, id);
        await param(tx, id, "tool", "equipment", tractor, a);
        await period(tx, id, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", a);
        await param(tx, id, "tool", "equipment", tool, null);
      }),
    ).rejects.toThrow(/appartiennent à un attelage/);
  });

  it("attelages : attelage sans matériel ou sans période refusé", async () => {
    await expect(
      write("crews", async (tx, id) => {
        const a = await crew(tx, id);
        await param(tx, id, "doer", "person", person, a);
        await period(tx, id, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", a);
      }),
    ).rejects.toThrow(/sans matériel ou sans période/);
  });

  it("attelages : périodes qui se chevauchent dans un attelage refusées", async () => {
    await expect(
      write("crews", async (tx, id) => {
        const a = await crew(tx, id);
        await param(tx, id, "tool", "equipment", tractor, a);
        await period(tx, id, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", a);
        await period(tx, id, "2026-10-28T09:30:00Z", "2026-10-28T11:00:00Z", a);
      }),
    ).rejects.toThrow(/se chevauchent/);
  });

  it("une cible ne peut pas appartenir à un attelage", async () => {
    await expect(
      write("crews", async (tx, id) => {
        const a = await crew(tx, id);
        await param(tx, id, "tool", "equipment", tractor, a);
        await period(tx, id, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", a);
        await param(tx, id, "target", "equipment", tool, a);
      }),
    ).rejects.toThrow(/seuls matériels et intervenants/);
  });

  it("réécrire une intervention (supprimer puis réinsérer) passe : contrôle en fin de transaction", async () => {
    const id = await write("crews", async (tx, iid) => {
      const a = await crew(tx, iid);
      await param(tx, iid, "tool", "equipment", tractor, a);
      await period(tx, iid, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", a);
    });
    await expect(
      sql.begin(async (tx) => {
        await tx`DELETE FROM intervention_crews WHERE intervention_id = ${id}`;
        await tx`UPDATE interventions SET staffing = 'free' WHERE id = ${id}`;
        await param(tx, id, "tool", "equipment", tractor, null);
        await period(tx, id, "2026-10-28T08:00:00Z", "2026-10-28T10:00:00Z", null);
        return true;
      }),
    ).resolves.toBe(true);
    const [r] = await sql`SELECT staffing, (SELECT count(*)::int FROM intervention_parameters WHERE intervention_id = ${id}) AS n FROM interventions WHERE id = ${id}`;
    expect(r).toMatchObject({ staffing: "free", n: 1 });
  });
});
