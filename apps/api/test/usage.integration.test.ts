import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createDb } from "@fourmy/db";
import { createApp } from "../src/app.js";
import { computeUsageDays } from "../src/repos/usage.js";
import { sendMaintenanceAlerts } from "../src/repos/alerts.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Lot L : heures estimées depuis Traccar (désactivable sans perte), écart
 * avec un relevé réel, pièces à commander, alertes d'entretien par e-mail.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("heures estimées, pièces à commander, alertes (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const db = createDb(url);
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let equipmentId = "";
  let opId = "";
  let partId = "";
  const base = () => `/api/v1/farms/${farmId}`;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test heures"));
    equipmentId = (await (await app.request(`${base()}/equipments`, { method: "POST", headers, body: JSON.stringify({ name: "Tracteur", kind: "tractor" }) })).json()).id;
    await app.request(`${base()}/equipments/${equipmentId}/readings`, { method: "POST", headers, body: JSON.stringify({ readAt: "2026-11-01T18:00:00.000Z", value: 1000 }) });
    const binding = crypto.randomUUID();
    await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid) VALUES (${binding}, ${farmId}, ${equipmentId}, '42', tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO integrations (id, farm_id, provider, enabled) VALUES (${crypto.randomUUID()}, ${farmId}, 'traccar', true)`;
    // 3 h de travail le 03/11 : une position par minute, en mouvement.
    for (let m = 0; m <= 180; m++) {
      const t = new Date(Date.parse("2026-11-03T07:00:00Z") + m * 60_000).toISOString();
      await sql`INSERT INTO positions (farm_id, binding_id, time, point, speed, attrs) VALUES (${farmId}, ${binding}, ${t}, ST_SetSRID(ST_MakePoint(0.5, 44.8), 4326), 8, '{}'::jsonb)`;
    }
    opId = (await (await app.request(`${base()}/equipments/${equipmentId}/plan`, { method: "POST", headers, body: JSON.stringify({ label: "Filtre à gasoil", kind: "replacement", everyHours: 100, performer: "member" }) })).json()).id;
    partId = crypto.randomUUID();
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, custom) VALUES (${partId}, ${farmId}, 'Filtre gasoil', 'part', 'Unité', '{"reference": "00 1135 042 0"}'::jsonb)`;
    await sql`INSERT INTO equipment_operation_parts (id, farm_id, operation_id, article_id, quantity) VALUES (${crypto.randomUUID()}, ${farmId}, ${opId}, ${partId}, 1)`;
    await app.request(`${base()}/plan-operations/${opId}/baseline`, { method: "PUT", headers, body: JSON.stringify({ at: "2026-10-01T00:00:00.000Z", hours: 920 }) });
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("estime les heures d'un jour d'activité et les ajoute au dernier relevé", async () => {
    expect(await computeUsageDays(db, farmId)).toEqual({ equipments: 1, days: 1 });
    expect(await computeUsageDays(db, farmId)).toMatchObject({ days: 1 }); // rejouable, sans doublon
    const m = await (await app.request(`${base()}/equipments/${equipmentId}/maintenance?at=2026-11-04T12:00:00.000Z`, { headers })).json();
    expect(m).toMatchObject({ usageNow: 1003, usageEstimated: true });
    // 920 + 100 = 1 020 h ; 1 003 h estimées → bientôt (17 h).
    expect(m.operations[0].due).toMatchObject({ status: "soon", remainingHours: 17 });
    // Intégration coupée : plus de calcul, rien de perdu.
    await sql`UPDATE integrations SET enabled = false WHERE farm_id = ${farmId}`;
    expect(await computeUsageDays(db, farmId)).toEqual({ equipments: 0, days: 0 });
    expect(await sql`SELECT 1 FROM equipment_usage_days WHERE equipment_id = ${equipmentId}`).toHaveLength(1);
  });

  it("un relevé réel loin de l'estimation : accepté, écart signalé", async () => {
    const r = await (await app.request(`${base()}/equipments/${equipmentId}/readings`, { method: "POST", headers, body: JSON.stringify({ readAt: "2026-11-04T08:00:00.000Z", value: 1030 }) })).json();
    expect(r.warning).toMatch(/Écart de \+27 h avec l'estimation Traccar/);
  });

  it("pièces à commander pour les 200 prochaines heures, avec le stock", async () => {
    const p = await (await app.request(`${base()}/maintenance/parts?hours=200&at=2026-11-05T00:00:00.000Z`, { headers })).json();
    // Échéance à 1 020 h, compteur 1 030 h → en retard : 1 filtre.
    expect(p.items).toEqual([expect.objectContaining({ articleId: partId, reference: "00 1135 042 0", needed: 1, inStock: 0, toOrder: 1, operations: ["Filtre à gasoil"] })]);
  });

  it("alertes : un seul e-mail par échéance et par état, rien sans destinataire ni SMTP", async () => {
    const mails: { to: unknown; subject: string; text: string }[] = [];
    const mailer = { sendMail: async (m: { to: unknown; subject: string; text: string }) => mails.push(m) } as never;
    expect(await sendMaintenanceAlerts(db, farmId, mailer, { at: "2026-11-05T00:00:00.000Z" })).toMatchObject({ sent: 0, skipped: "aucun destinataire" });
    await app.request(`${base()}/settings/maintenance`, { method: "PUT", headers, body: JSON.stringify({ soonHours: 50, soonMonths: 1, notify: [userId] }) });
    expect(await sendMaintenanceAlerts(db, farmId, null, { at: "2026-11-05T00:00:00.000Z" })).toMatchObject({ skipped: "SMTP non configuré" });
    expect(await sendMaintenanceAlerts(db, farmId, mailer, { at: "2026-11-05T00:00:00.000Z", appUrl: "https://dev.fourmy.org" })).toMatchObject({ sent: 1, items: 1 });
    expect(mails[0]!.subject).toContain("1 entretien(s) en retard");
    expect(mails[0]!.text).toContain("Tracteur : Filtre à gasoil");
    expect(mails[0]!.text).toContain(`https://dev.fourmy.org/f/${farmId}/maintenance`);
    expect(await sendMaintenanceAlerts(db, farmId, mailer, { at: "2026-11-05T00:00:00.000Z" })).toEqual({ sent: 0, items: 0 });
  });
});
