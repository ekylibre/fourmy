import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sireneDeps, sireneSearch, SireneError } from "../src/sirene.js";

/** Recherche Sirene (assistant) : réponses v4 de l'INSEE simulées, sans réseau. */
const unit = { siren: "400000000", denominationUniteLegale: "GAEC PILOTE TEST", etatUniteLegale: "A", nicSiegeUniteLegale: "00003" };
const head = {
  siren: "400000000",
  siret: "40000000000003",
  etablissementSiege: true,
  etatEtablissement: "A",
  adresseEtablissement: { numeroVoieEtablissement: "12", indiceRepetitionEtablissement: "B", typeVoieEtablissement: "RUE", libelleVoieEtablissement: "DES CHAMPS", codePostalEtablissement: "00000", libelleCommuneEtablissement: "COMMUNE TEST" },
};

describe("recherche Sirene", () => {
  const realFetch = sireneDeps.fetch;
  const calls: { url: string; body: unknown }[] = [];
  beforeEach(() => {
    process.env.FOURMY_SIRENE_API_KEY = "cle-de-test";
    calls.length = 0;
    sireneDeps.fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      expect((init?.headers as Record<string, string>)["X-INSEE-Api-Key-Integration"]).toBe("cle-de-test");
      if (url.includes("/unites-legales/multicritere")) return Response.json({ items: [{ item: unit }] });
      if (url.includes("/etablissements/multicritere")) return Response.json({ items: [{ item: head }] });
      if (url.includes("/unites-legales/400000000")) return Response.json(unit);
      if (url.includes("/etablissements/40000000000003")) return Response.json(head);
      return new Response("", { status: 404 });
    };
  });
  afterEach(() => {
    sireneDeps.fetch = realFetch;
    delete process.env.FOURMY_SIRENE_API_KEY;
  });

  it("par nom : unités actives et adresse de leur siège", async () => {
    const r = await sireneSearch("gaec pilote");
    expect(r).toEqual([
      { siren: "400000000", siret: "40000000000003", name: "GAEC PILOTE TEST", line1: "12 bis rue DES CHAMPS", line2: null, postalCode: "00000", city: "COMMUNE TEST", headOffice: true, active: true },
    ]);
    expect(calls[0]!.body).toMatchObject({ denominationUniteLegale: ["gaec pilote"], etatUniteLegale: ["1"] });
  });

  it("par SIRET : sa fiche ; texte trop court refusé", async () => {
    expect((await sireneSearch("400 000 000 00003"))[0]).toMatchObject({ siret: "40000000000003", name: "GAEC PILOTE TEST" });
    await expect(sireneSearch("ab")).rejects.toBeInstanceOf(SireneError);
  });

  it("clé refusée par l'INSEE : message explicite", async () => {
    sireneDeps.fetch = async () => new Response("", { status: 401 });
    await expect(sireneSearch("autre ferme")).rejects.toThrow(/clé Sirene du serveur est refusée/);
  });
});
