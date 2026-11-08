import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { capacityLiters, parseCsv, parseEquipmentBundle } from "../src/repos/equipment-bundle.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Plan d'entretien (lot J) : import d'un dossier de base matériel (données
 * fictives), opérations non applicables, échéances calculées, « dernière
 * fois connue », tableau de bord, réimport sans doublon.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const machine = {
  marque: "TESTMARK",
  modele: "T 400",
  type_constructeur: "X9",
  numero_serie: "X9000001",
  options: ["relevage_avant"],
  options_absentes_usine: ["pdf_avant"],
  agregats: { moteur: "M400 SN123" },
};
const plan = {
  avertissement: "Notice d'essai",
  operations: [
    { id: "OP01", libelle: "Contrôle du niveau d'huile moteur", type: "controle", periodicite: { heures: 10, mois: null }, realise_par: "utilisateur", pieces: [], note: null, source: { id: "NOT-1", page: 12 }, applicable: true },
    {
      id: "OP02",
      libelle: "Échange de l'huile moteur",
      type: "remplacement",
      periodicite: { heures: 500, mois: 12 },
      realise_par: "utilisateur",
      pieces: [{ reference: "11 2233 445 5", designation: "FILTRE A HUILE", quantite: "1", famille: "filtre_huile_moteur" }],
      note: null,
      source: { id: "NOT-1", page: 30 },
      applicable: true,
    },
    { id: "OP03", libelle: "Échange de l'huile du boîtier de prise de force avant", type: "remplacement", periodicite: { heures: 500, mois: 12 }, realise_par: "utilisateur", pieces: [], note: null, source: { id: "NOT-1", page: 31 }, applicable: true },
    { id: "OP04", libelle: "Graissage du relevage avant", type: "graissage", periodicite: { heures: 50, mois: null }, realise_par: "utilisateur", pieces: [], note: null, source: null, applicable: true },
    { id: "OP05", libelle: "Liquide de refroidissement", type: "remplacement", periodicite: { heures: 1500, mois: 24 }, realise_par: "atelier_agree", pieces: [], note: null, source: { id: "NOT-1", page: 40 }, applicable: true },
  ],
  visites_initiales: [{ heures: 100, realise_par: "atelier_agree", source: { id: "NOT-1", page: 5 }, operations: ["OP02"], note: "Visite de garantie" }],
};
const files = {
  "machine.json": JSON.stringify(machine),
  "sources.json": JSON.stringify([{ id: "NOT-1", titre: "Notice d'essai" }]),
  "fiche_technique.json": JSON.stringify({ moteur: { puissance_max: { valeur: 100, unite: "ch", source: { id: "NOT-1", page: 2 } } } }),
  "entretien/plan_entretien.json": JSON.stringify(plan),
  "entretien/fluides.csv": 'organe,fluide,norme,viscosite,capacite_l,note,source_id,page\nmoteur,Huile essai,ACEA E6,15W40,"10 – 12,5",min/max,NOT-1,112\npont_avant_reductions_finales,Huile pont,,,"2 x 0,6",,NOT-1,113\n',
  "pieces/pieces_entretien.csv":
    "reference,reference_norm,designation,famille,quantite,groupe,sous_groupe,planche,bgz,dessin,page_dessin,rep,operations,complement,note,source\n11 2233 445 5,1122334455,FILTRE A HUILE,filtre_huile_moteur,1,01 MOTEUR,30 HUILE,120 FILTRE,0130120,A,1,4,OP02,,,essai\n",
};

describe("lecture d'un dossier de base matériel", () => {
  it("normalise le plan, les visites, les fluides et les pièces", () => {
    const b = parseEquipmentBundle(files);
    expect(b.model).toMatchObject({ slug: "testmark-t-400-x9", warning: "Notice d'essai" });
    expect(b.operations.find((o) => o.code === "OP03")).toMatchObject({ requiresOption: "front_pto", kind: "replacement" });
    expect(b.operations.find((o) => o.code === "OP04")).toMatchObject({ requiresOption: "front_linkage", kind: "greasing" });
    expect(b.operations.find((o) => o.code === "V100")).toMatchObject({ kind: "visit", firstHours: 100, performer: "workshop" });
    expect(b.fluids.map((f) => f.capacityMaxL)).toEqual([12.5, 1.2]);
    expect(b.warnings).toContain("OP04 : opération sans source.");
    expect(b.machine.aggregates).toEqual([{ organ: "Moteur", designation: "M400", serial: "SN123" }]);
    expect(capacityLiters("1,5 kg")).toBeNull();
    expect(parseCsv('a,b\n"x, y",2\n')).toEqual([{ a: "x, y", b: "2" }]);
    expect(() => parseEquipmentBundle({ "machine.json": "{}" })).toThrow(/marque et modèle/);
  });
});

describe.skipIf(!url)("plan d'entretien (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  let equipmentId = "";
  const base = () => `/api/v1/farms/${farmId}`;

  beforeAll(async () => {
    const s = await setupFarm(sql, "Ferme test entretien");
    farmId = s.farmId;
    owner = s.headers;
    users.push(s.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql.end();
  });

  it("importe le dossier : fiche, options, plan, pièces ; option absente d'usine non applicable", async () => {
    const send = (headers: Record<string, string>) => app.request(`${base()}/imports/equipment-bundle`, { method: "POST", headers, body: JSON.stringify({ files }) });
    expect((await send(worker)).status).toBe(403);
    const r = await send(owner);
    expect(r.status).toBe(201);
    const res = await r.json();
    equipmentId = res.equipmentId;
    expect(res).toMatchObject({ created: true, report: { operationsAdded: 6, notApplicable: ["Échange de l'huile du boîtier de prise de force avant"], fluids: 2, parts: 1, articlesCreated: 1 } });
    const sheet = await (await app.request(`${base()}/equipments/${equipmentId}/sheet`, { headers: worker })).json();
    expect(sheet).toMatchObject({ brand: "TESTMARK", model: "T 400", serialNumber: "X9000001", meterUnit: "hours", options: [{ code: "front_linkage" }] });
    // Réimport : rien n'est dupliqué, les opérations de la ferme sont conservées.
    const again = await (await send(owner)).json();
    expect(again).toMatchObject({ created: false, equipmentId, report: { operationsAdded: 0, operationsKept: 6, articlesCreated: 0 } });
  });

  it("échéances : à renseigner, puis calculées depuis la dernière fois connue ; tableau de bord", async () => {
    await app.request(`${base()}/equipments/${equipmentId}/readings`, { method: "POST", headers: worker, body: JSON.stringify({ readAt: "2026-11-01T08:00:00.000Z", value: 2480 }) });
    const view = async () => (await app.request(`${base()}/equipments/${equipmentId}/maintenance?at=2026-11-08T00:00:00.000Z`, { headers: worker })).json();
    let m = await view();
    const oil = m.operations.find((o: { code: string }) => o.code === "OP02");
    expect(oil).toMatchObject({ due: { status: "unknown" }, parts: [{ reference: "11 2233 445 5", quantity: 1 }] });
    expect(m.operations.find((o: { code: string }) => o.code === "OP03").due.status).toBe("not_applicable");
    expect(m.operations.find((o: { code: string }) => o.code === "V100").due.status).toBe("not_applicable"); // antérieure au premier relevé
    expect(m.model).toMatchObject({ label: "TESTMARK T 400", warning: "Notice d'essai" });
    // L'ouvrier renseigne la dernière vidange : 2 000 h le 01/12/2025 → prochaine à 2 500 h (dans 20 h).
    expect((await app.request(`${base()}/plan-operations/${oil.id}/baseline`, { method: "PUT", headers: worker, body: JSON.stringify({ at: "2025-12-01T00:00:00.000Z", hours: 2000 }) })).status).toBe(204);
    m = await view();
    expect(m.operations.find((o: { code: string }) => o.code === "OP02").due).toMatchObject({ status: "soon", nextUsage: 2500, remainingHours: 20 });
    const dash = await (await app.request(`${base()}/maintenance/due?at=2026-11-08T00:00:00.000Z`, { headers: worker })).json();
    expect(dash.items).toEqual([expect.objectContaining({ equipmentId, label: "Échange de l'huile moteur", due: expect.objectContaining({ status: "soon" }) })]);
    expect(dash.byEquipment[equipmentId]).toMatchObject({ soon: 1 });
    // Le responsable ajuste le plan ; l'ouvrier ne peut pas.
    const put = (headers: Record<string, string>) =>
      app.request(`${base()}/plan-operations/${oil.id}`, { method: "PUT", headers, body: JSON.stringify({ label: "Vidange moteur", kind: "oil_change", everyHours: 400, everyMonths: 12, performer: "member" }) });
    expect((await put(worker)).status).toBe(403);
    expect((await put(owner)).status).toBe(204);
    m = await view();
    expect(m.operations.find((o: { code: string }) => o.code === "OP02").due).toMatchObject({ status: "overdue", nextUsage: 2400 });
    // « Amorcer le plan » : les opérations périodiques encore à renseigner partent d'une même révision.
    const all = await app.request(`${base()}/equipments/${equipmentId}/plan/baseline`, { method: "POST", headers: worker, body: JSON.stringify({ at: "2026-10-01T00:00:00.000Z", hours: 2450 }) });
    expect(await all.json()).toEqual({ updated: 3 }); // OP01, OP04, OP05 (OP02 déjà amorcée, OP03 retirée, V100 ponctuelle)
    m = await view();
    expect(m.operations.filter((o: { due: { status: string } }) => o.due.status === "unknown")).toEqual([]);
  });
});
