import nodemailer, { type Transporter } from "nodemailer";

/**
 * Envoi d'e-mails de l'application (alertes d'entretien), par le SMTP
 * configuré (FOURMY_SMTP_*). Sans configuration : null, rien n'est envoyé.
 */
let transporter: Transporter | null = null;

export function appMailer(): Transporter | null {
  const host = process.env.FOURMY_SMTP_HOST;
  if (!host || !process.env.FOURMY_SMTP_FROM) return null;
  if (!transporter) {
    const port = Number(process.env.FOURMY_SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: process.env.FOURMY_SMTP_USER ? { user: process.env.FOURMY_SMTP_USER, pass: process.env.FOURMY_SMTP_PASSWORD ?? "" } : undefined,
    });
  }
  return transporter;
}
