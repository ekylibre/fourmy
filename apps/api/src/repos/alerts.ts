import type { Transporter } from "nodemailer";
import type { Database } from "@fourmy/db";
import { dueLabel } from "@fourmy/domain";
import { markAlertsSent, pendingAlerts } from "./maintenance.js";

/**
 * Alertes d'entretien (FR-MAT-25) : un e-mail récapitulatif par ferme aux
 * membres choisis, pour les échéances passées à « bientôt » ou « en retard »
 * depuis le dernier envoi. Rien n'est marqué envoyé sans envoi réel.
 */
export async function sendMaintenanceAlerts(
  db: Database,
  farmId: string,
  mailer: Transporter | null,
  opts: { at?: string; appUrl?: string } = {},
): Promise<{ sent: number; items: number; skipped?: string }> {
  const { farmName, recipients, items } = await pendingAlerts(db, farmId, opts.at ?? new Date().toISOString());
  if (!items.length) return { sent: 0, items: 0 };
  if (!recipients.length) return { sent: 0, items: items.length, skipped: "aucun destinataire" };
  if (!mailer) return { sent: 0, items: items.length, skipped: "SMTP non configuré" };
  const late = items.filter((i) => i.due.status === "overdue");
  const soon = items.filter((i) => i.due.status === "soon");
  const line = (i: (typeof items)[number]) => `- ${i.equipmentName} : ${i.label} (${dueLabel(i.due)})`;
  const text = [
    `Entretien des matériels — ${farmName}`,
    "",
    ...(late.length ? ["En retard :", ...late.map(line), ""] : []),
    ...(soon.length ? ["Bientôt :", ...soon.map(line), ""] : []),
    opts.appUrl ? `Tableau de bord de l'entretien : ${opts.appUrl}/f/${farmId}/maintenance` : "",
    "",
    "Vous recevez ce message car vous êtes à prévenir des échéances d'entretien de cette ferme (réglage sur la page Entretien).",
  ].join("\n");
  await mailer.sendMail({
    from: { name: "Fourmy", address: process.env.FOURMY_SMTP_FROM ?? "no-reply@fourmy.org" },
    to: recipients.map((r) => r.email),
    subject: `Fourmy · ${farmName} : ${late.length ? `${late.length} entretien(s) en retard` : `${soon.length} entretien(s) à prévoir`}`,
    text,
  });
  await markAlertsSent(db, farmId, items);
  return { sent: recipients.length, items: items.length };
}
