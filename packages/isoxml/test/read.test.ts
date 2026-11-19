import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseXml, readTaskData, taskData, unzip, zip } from "../src/index.js";

/** Lecture d'un TaskData reçu (lot AR4) : fichier réel d'une console Topcon (voir fixtures/NOTICE.md). */
const topcon = new Uint8Array(readFileSync(new URL("./fixtures/topcon-2021-04-09-taskdata.zip", import.meta.url)));

describe("readTaskData", () => {
  it("TaskData réel Topcon : fichiers externes, tâche, journal binaire", () => {
    const r = readTaskData(topcon);
    expect(r.software).toEqual({ manufacturer: "FarmFacts", version: "0", taskController: "Topcon Precision Agriculture" });
    expect(r.warnings).toEqual([]);
    expect(r.tasks).toHaveLength(1);
    const t = r.tasks[0]!;
    expect(t).toMatchObject({ id: "TSK-1", designator: "Task 9 Apr, 2021 1450", status: 3 });
    expect(t.times).toEqual([{ start: "2021-04-09T14:54:04.975", stop: "2021-04-09T14:54:44.107", type: 4 }]);
    expect(t.devices).toEqual([{ id: "DVC-1", designator: "8250-8280 TTV", serial: null, elements: ["DET-1", "DET-2", "DET-3", "DET-4"] }]);
    expect(t.log.length).toBeGreaterThan(50);
    const first = t.log[0]!;
    const last = t.log.at(-1)!;
    // Enregistrements entre le début et la fin de la tâche, positions plausibles et proches les unes des autres.
    expect(first.time! >= "2021-04-09T14:54:04" && last.time! <= "2021-04-09T14:54:45").toBe(true);
    for (const rec of t.log) {
      expect(Math.abs(rec.lat! - first.lat!)).toBeLessThan(0.01);
      expect(Math.abs(rec.lon! - first.lon!)).toBeLessThan(0.01);
    }
    expect(Math.abs(first.lat!)).toBeLessThanOrEqual(90);
    expect(Object.keys(first.values).every((k) => /^\d+@DET-1$/.test(k))).toBe(true);
    // Vitesse (DDI 397) relevée au fil du journal.
    expect(t.log.some((rec) => rec.values["397@DET-1"] !== undefined)).toBe(true);
  });

  it("relit une tâche écrite par Fourmy : parcelle, limite, produit", () => {
    const ring = [[-0.2, 43.38], [-0.196, 43.38], [-0.196, 43.383], [-0.2, 43.383], [-0.2, 43.38]];
    const files = taskData({
      software: { manufacturer: "Fourmy", version: "1" },
      customer: "EARL", farm: "Ferme", partfield: { name: "Grand Champ", areaM2: 90000, boundary: [[ring]] },
      task: "Azote F1234abcd", product: "Ammonitrate", unit: "kg_ha",
      zones: [{ code: 1, name: "Zone 1", rate: 120 }], defaultRate: 120,
      grid: { minLat: 43.38, minLon: -0.2, cellLat: 0.001, cellLon: 0.001, columns: 1, rows: 1, cells: new Uint8Array([1]) },
    });
    const r = readTaskData(zip(files));
    const t = r.tasks[0]!;
    expect(t.designator).toBe("Azote F1234abcd");
    expect(t.partfield).toMatchObject({ name: "Grand Champ", areaM2: 90000 });
    expect(t.partfield!.polygons[0]![0]!.slice(0, 2)).toEqual([[-0.2, 43.38], [-0.196, 43.38]]);
  });

  it("analyseur XML : entités, attributs entre apostrophes, commentaires ; erreurs claires", () => {
    const doc = parseXml(`<?xml version="1.0"?><!-- c --><A x='1' y="a &amp; b &#233;"><B/></A>`);
    expect(doc.children[0]).toEqual({ tag: "A", attrs: { x: "1", y: "a & b é" }, children: [{ tag: "B", attrs: {}, children: [] }] });
    expect(() => parseXml("<A><B></A>")).toThrow("XML mal formé");
    // Texte des éléments et attributs accentués (TelePAC).
    const t = parseXml(`<?xml version="1.0" encoding="ISO-8859-1"?><!DOCTYPE x SYSTEM "http://evil/x.dtd"><r a-récolte="true"><siret> 12345678901234 </siret><n>a &amp; b</n></r>`);
    const r = t.children[0]!;
    expect(r.attrs["a-récolte"]).toBe("true");
    expect(r.children.map((c) => [c.tag, c.text])).toEqual([["siret", "12345678901234"], ["n", "a & b"]]);
    expect(r.text).toBeUndefined();
    expect(() => readTaskData(zip({ "AUTRE.XML": "<X/>" }))).toThrow("TASKDATA.XML absent");
    expect(() => unzip(new Uint8Array([1, 2, 3]))).toThrow("Archive zip illisible");
  });
});
