import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { parseAgrifoodDate, parseAgrifoodPrice, readAgrifoodItems, refreshMarketPrices } from "../src/agrifood.js";

/** API agrifood (lot E3) : lecture des réponses, cache, échec, délais entre deux appels. */
describe("agrifood : lecture", () => {
  it("prix et dates", () => {
    expect(parseAgrifoodPrice("€201,50")).toBe(201.5);
    expect(parseAgrifoodPrice("1,201.5")).toBe(1201.5);
    expect(parseAgrifoodPrice("€0,00")).toBeNull();
    expect(parseAgrifoodPrice(null)).toBeNull();
    expect(parseAgrifoodDate("13/04/2026")).toBe("2026-04-13");
    expect(parseAgrifoodDate("2026-04-13")).toBeNull();
  });

  it("éléments : France seulement, sans prix écartés, espèce du code", () => {
    const rows = readAgrifoodItems("MAI", [
      { memberStateCode: "FR", beginDate: "13/04/2026", endDate: "19/04/2026", productName: "Feed maize", marketName: "Bordeaux", stageName: "Rendu Port", unit: "TONNES", price: "€201,50" },
      { memberStateCode: "DK", beginDate: "13/04/2026", productName: "Feed maize", marketName: "Kobenhavn", unit: "TONNES", price: "€190,00" },
      { memberStateCode: "FR", beginDate: "13/04/2026", productName: "Feed maize", marketName: "Rhin", unit: "TONNES", price: null },
    ]);
    expect(rows).toEqual([
      {
        id: "MAI_FR_Bordeaux_2026-04-13",
        productCode: "MAI",
        specie: "zea_mays",
        productLabel: "Feed maize Bordeaux",
        market: "Bordeaux",
        stage: "Rendu Port",
        unit: "ton",
        price: 201.5,
        startedOn: "2026-04-13",
        endedOn: "2026-04-19",
      },
    ]);
  });
});

const url = process.env.DATABASE_URL;
class Rollback extends Error {}

describe.skipIf(!url)("agrifood : cache (intégration)", () => {
  it("charge, garde le cache en cas d'échec, attend une semaine après une réussite et un jour après un échec", async () => {
    const sql = postgres(url!, { max: 1, onnotice: () => {} });
    const calls: string[] = [];
    let down = false;
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input));
      if (down) return new Response('{"message":"Runtime Error"}', { status: 500 });
      const code = new URL(String(input)).searchParams.get("productCodes");
      const items =
        code === "MAI" ? [{ memberStateCode: "FR", beginDate: "13/04/2026", endDate: "19/04/2026", productName: "Feed maize", marketName: "Bordeaux", unit: "TONNES", price: "€201,50" }] : [];
      return Response.json(items);
    }) as typeof fetch;
    try {
      await sql
        .begin(async (tx) => {
          await tx`DELETE FROM market_prices`;
          await tx`DELETE FROM market_price_fetches`;
          const t0 = new Date("2026-11-21T10:00:00Z");
          const first = await refreshMarketPrices(tx, { base: "http://agrifood.test", fetchImpl, now: t0 });
          expect(first).toEqual({ status: "loaded", rows: 1 });
          expect(calls[0]).toContain("memberStateCodes=FR&productCodes=BLTPAN&beginDate=21/11/2025");
          expect(await tx`SELECT id, specie, price::float8 AS price FROM market_prices`).toEqual([{ id: "MAI_FR_Bordeaux_2026-04-13", specie: "zea_mays", price: 201.5 }]);
          // Moins d'une semaine après une réussite : rien.
          expect((await refreshMarketPrices(tx, { base: "http://agrifood.test", fetchImpl, now: new Date("2026-11-25T10:00:00Z") })).status).toBe("skipped");
          // Une semaine plus tard, API en panne : échec noté, cache gardé.
          down = true;
          const failed = await refreshMarketPrices(tx, { base: "http://agrifood.test", fetchImpl, now: new Date("2026-11-29T10:00:00Z") });
          expect(failed.status).toBe("failed");
          expect(failed.error).toContain("HTTP 500");
          expect((await tx`SELECT count(*)::int AS n FROM market_prices`)[0]!.n).toBe(1);
          const [state] = await tx`SELECT succeeded_at, error FROM market_price_fetches WHERE source = 'agrifood'`;
          expect(state!.succeeded_at.toISOString()).toBe(t0.toISOString());
          expect(state!.error).toContain("HTTP 500");
          // Moins d'un jour après l'échec : pas de nouvel appel ; le lendemain, oui (depuis le dernier prix moins deux semaines).
          down = false;
          expect((await refreshMarketPrices(tx, { base: "http://agrifood.test", fetchImpl, now: new Date("2026-11-29T20:00:00Z") })).status).toBe("skipped");
          calls.length = 0;
          expect((await refreshMarketPrices(tx, { base: "http://agrifood.test", fetchImpl, now: new Date("2026-11-30T11:00:00Z") })).status).toBe("loaded");
          expect(calls[0]).toContain("beginDate=30/03/2026");
          throw new Rollback();
        })
        .catch((e) => {
          if (!(e instanceof Rollback)) throw e;
        });
    } finally {
      await sql.end();
    }
  });
});
