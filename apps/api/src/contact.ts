import { Hono, type Context } from "hono";
import { z } from "zod";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Formulaire de contact du site public (fourmy.org) → contact@fourmy.org.
 * Point d'entrée public, sans session : validation stricte, pièges à robots
 * (champ invisible, délai minimal), limite de débit par adresse IP et
 * plafond global, envoi SMTP avec « Répondre » vers l'expéditeur. Rien n'est
 * stocké ; les journaux ne contiennent pas le message.
 */

const PROFILES = ["agriculteur", "partenaire", "developpeur", "autre"] as const;

const contactInput = z.object({
  name: z.string().trim().min(1, "Nom requis.").max(120),
  email: z.string().trim().email("Adresse e-mail invalide.").max(200),
  profile: z.enum(PROFILES).default("autre"),
  message: z.string().trim().min(10, "Message trop court.").max(5000),
  consent: z.union([z.literal(true), z.literal("on"), z.literal("true")], {
    errorMap: () => ({ message: "Accord requis pour être recontacté." }),
  }),
  /** Piège : champ masqué, rempli seulement par les robots. */
  website: z.string().max(200).optional(),
  /** Horodatage de l'affichage du formulaire (ms). */
  startedAt: z.coerce.number().optional(),
});

const MIN_FILL_MS = 3_000;
const PER_IP = { max: 5, windowMs: 10 * 60_000 };
const GLOBAL = { max: 60, windowMs: 60 * 60_000 };

const hits = new Map<string, number[]>();
let globalHits: number[] = [];

/** Réinitialise les compteurs (tests). */
export function resetContactLimits(): void {
  hits.clear();
  globalHits = [];
}

function allow(ip: string, now: number): boolean {
  globalHits = globalHits.filter((t) => now - t < GLOBAL.windowMs);
  const mine = (hits.get(ip) ?? []).filter((t) => now - t < PER_IP.windowMs);
  if (mine.length >= PER_IP.max || globalHits.length >= GLOBAL.max) {
    hits.set(ip, mine);
    return false;
  }
  mine.push(now);
  globalHits.push(now);
  hits.set(ip, mine);
  // Ménage : la carte ne grossit pas indéfiniment.
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((t) => now - t >= PER_IP.windowMs)) hits.delete(k);
  return true;
}

/**
 * Adresse du visiteur. Derrière des proxys (Traefik → nginx), chacun ajoute
 * l'adresse qu'il voit à `X-Forwarded-For` ; seules les N dernières valeurs
 * sont fiables (N = FOURMY_TRUSTED_PROXY_HOPS), les précédentes peuvent être
 * forgées par le client. Sans proxy de confiance : l'adresse de la connexion.
 */
export function clientIp(forwardedFor: string | undefined, socketAddress: string | undefined, hops: number): string {
  if (hops > 0 && forwardedFor) {
    const chain = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
    const candidate = chain[chain.length - hops];
    if (candidate) return candidate;
  }
  return socketAddress ?? "inconnue";
}

let transporter: Transporter | null = null;
function mailer(): Transporter | null {
  const host = process.env.FOURMY_SMTP_HOST;
  if (!host || !process.env.FOURMY_SMTP_FROM) return null;
  if (!transporter) {
    const port = Number(process.env.FOURMY_SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: process.env.FOURMY_SMTP_USER
        ? { user: process.env.FOURMY_SMTP_USER, pass: process.env.FOURMY_SMTP_PASSWORD ?? "" }
        : undefined,
    });
  }
  return transporter;
}

/** Réinitialise le transport (tests : configuration changée). */
export function resetContactMailer(): void {
  transporter = null;
}

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();
const PROFILE_LABELS: Record<(typeof PROFILES)[number], string> = {
  agriculteur: "Agriculteur",
  partenaire: "Partenaire",
  developpeur: "Développeur",
  autre: "Autre",
};

async function readBody(c: Context): Promise<{ data: unknown; form: boolean }> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    return { data: Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)])), form: true };
  }
  return { data: await c.req.json().catch(() => null), form: false };
}

/**
 * Sans JavaScript, le formulaire est envoyé en `application/x-www-form-urlencoded` :
 * on répond par une redirection vers la page de confirmation (ou d'erreur).
 */
const done = (c: Context, form: boolean, status: 200 | 400 | 429 | 503, detail?: string) => {
  if (form) return c.redirect(status === 200 ? "/contact/merci/" : `/contact/?erreur=${status}`, 303);
  return status === 200
    ? c.json({ ok: true })
    : c.json({ type: "about:blank", title: "Message non envoyé", status, detail }, status, {
        "content-type": "application/problem+json",
      });
};

export const contactRoutes = new Hono().post("/contact", async (c) => {
  const { data, form } = await readBody(c);
  const transport = mailer();
  if (!transport) return done(c, form, 503, "Formulaire de contact indisponible : écrivez à contact@fourmy.org.");

  const parsed = contactInput.safeParse(data);
  if (!parsed.success) return done(c, form, 400, parsed.error.issues.map((i) => i.message).join(" "));
  const input = parsed.data;

  // Robots : réponse identique à un succès, sans envoi (ne rien leur apprendre).
  const now = Date.now();
  const tooFast = input.startedAt !== undefined && now - input.startedAt < MIN_FILL_MS;
  if (input.website || tooFast) return done(c, form, 200);

  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  const ip = clientIp(
    c.req.header("x-forwarded-for"),
    incoming?.socket?.remoteAddress,
    Number(process.env.FOURMY_TRUSTED_PROXY_HOPS ?? 0),
  );
  if (!allow(ip, now)) return done(c, form, 429, "Trop de messages envoyés. Réessayez plus tard.");

  const name = oneLine(input.name);
  try {
    await transport.sendMail({
      from: { name: "Site fourmy.org", address: process.env.FOURMY_SMTP_FROM! },
      to: process.env.FOURMY_CONTACT_TO ?? "contact@fourmy.org",
      replyTo: { name, address: input.email },
      subject: `[fourmy.org] ${PROFILE_LABELS[input.profile]} — ${name}`.slice(0, 200),
      text: [
        `Nom : ${name}`,
        `E-mail : ${input.email}`,
        `Profil : ${PROFILE_LABELS[input.profile]}`,
        "",
        input.message,
        "",
        "—",
        "Envoyé depuis le formulaire de contact de fourmy.org (accord donné pour être recontacté).",
      ].join("\n"),
    });
  } catch (e) {
    console.error("[contact] envoi SMTP impossible :", e instanceof Error ? e.message : e);
    return done(c, form, 503, "Envoi impossible pour le moment : écrivez à contact@fourmy.org.");
  }
  console.log(`[contact] message transmis (profil ${input.profile})`);
  return done(c, form, 200);
});
