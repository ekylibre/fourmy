import { describe, expect, it } from "vitest";
import { decodeDeviceDescription, decodeTimeLog, encodeDeviceDescription, encodeTimeLog, wrapAny, EFDI_SECTION } from "../src/index.js";

/** EFDI (lot AR5) : aller-retour écriture → lecture, valeurs négatives, enveloppe Any, message abîmé. */
describe("EFDI", () => {
  const times = [
    {
      start: "2026-04-16T07:30:00.250Z",
      type: 4,
      position: { lat: 43.3812345, lon: -0.1987654, status: 4, gpsTime: "2026-04-16T07:30:00.000Z" },
      values: [
        { ddi: 141, value: 1, element: 1 },
        { ddi: 7, value: 15000, element: 3 },
        { ddi: 0x0086, value: -1355, element: 2 },
      ],
    },
    { start: "2026-04-16T07:30:01.250Z", type: 4, position: null, values: [] },
  ];

  it("journal : dates, position, valeurs (dont négatives), élément de matériel", () => {
    const r = decodeTimeLog(encodeTimeLog(times, "TLG00042"));
    expect(r.filename).toBe("TLG00042");
    expect(r.times).toEqual([
      { ...times[0], stop: null },
      { ...times[1], stop: null },
    ]);
  });

  it("journal enveloppé dans un Any (ancienne API) : déballé", () => {
    expect(decodeTimeLog(wrapAny("efdi.TimeLog", encodeTimeLog(times))).times).toHaveLength(2);
  });

  it("description de machine : matériels, numéro de série, éléments, sections, propriétés", () => {
    const device = {
      id: -1,
      designator: "Amazone ZA-TS",
      serial: "AMZ-12345",
      elements: [
        { id: 1, objectId: 1, type: 1, designator: "Épandeur", number: 0, parent: 0 },
        { id: 2, objectId: 2, type: 6, designator: "Attelage", number: 1, parent: 1 },
        ...[3, 4].map((n) => ({ id: n, objectId: n, type: EFDI_SECTION, designator: `Section ${n - 2}`, number: n, parent: 1 })),
      ],
      properties: [{ objectId: 10, ddi: 0x0044, value: 24000, designator: "Largeur de travail" }],
    };
    const r = decodeDeviceDescription(encodeDeviceDescription([device], "Müller"));
    expect(r).toEqual({ taskController: "Müller", devices: [device] });
  });

  it("message abîmé : erreur claire", () => {
    expect(() => decodeTimeLog(new Uint8Array([0x22, 0x10, 1]))).toThrow("Message EFDI tronqué");
  });
});
