import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import { createApp } from "../src/app.js";
import { clientIp, resetContactLimits, resetContactMailer } from "../src/contact.js";

/**
 * Formulaire de contact contre un vrai serveur SMTP local : message, Répondre
 * vers l'expéditeur, pièges à robots, limite de débit, repli sans JavaScript.
 */
const received: { from: string; to: string[]; raw: string }[] = [];
let smtp: SMTPServer;
const app = createApp();

const valid = () => ({
  name: "Camille Martin",
  email: "camille@exemple.fr",
  profile: "agriculteur",
  message: "Bonjour, je voudrais essayer Fourmy sur ma ferme.",
  consent: true,
  website: "",
  startedAt: Date.now() - 10_000,
});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.request("/api/public/contact", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, session, callback) {
      let raw = "";
      stream.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  process.env.FOURMY_SMTP_HOST = "127.0.0.1";
  process.env.FOURMY_SMTP_PORT = String((smtp.server.address() as AddressInfo).port);
  process.env.FOURMY_SMTP_FROM = "site@fourmy.org";
  process.env.FOURMY_CONTACT_TO = "contact@fourmy.org";
  resetContactMailer();
});
afterAll(async () => {
  for (const k of ["FOURMY_SMTP_HOST", "FOURMY_SMTP_PORT", "FOURMY_SMTP_FROM", "FOURMY_CONTACT_TO"]) delete process.env[k];
  resetContactMailer();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
});
beforeEach(() => {
  received.length = 0;
  resetContactLimits();
});

describe("contact (fourmy.org)", () => {
  it("transmet le message à contact@fourmy.org, Répondre vers l'expéditeur", async () => {
    const res = await post(valid());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    const mail = received[0]!;
    expect(mail.to).toEqual(["contact@fourmy.org"]);
    expect(mail.from).toBe("site@fourmy.org");
    expect(mail.raw).toMatch(/^Reply-To: "?Camille Martin"? <camille@exemple\.fr>/m);
    expect(mail.raw).toMatch(/^Subject: .*Agriculteur/m);
    expect(mail.raw).toContain("essayer Fourmy");
  });

  it("refuse un formulaire invalide (400), sans envoi", async () => {
    const res = await post({ ...valid(), email: "pas-une-adresse", message: "court", consent: false });
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/e-mail invalide.*trop court.*Accord requis/);
    expect(received).toHaveLength(0);
  });

  it("robots : champ piège ou envoi trop rapide → réponse normale, aucun envoi", async () => {
    expect((await post({ ...valid(), website: "http://spam.example" })).status).toBe(200);
    expect((await post({ ...valid(), startedAt: Date.now() - 500 })).status).toBe(200);
    expect(received).toHaveLength(0);
  });

  it("limite de débit par adresse : 5 messages puis 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post(valid())).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(received).toHaveLength(5);
  });

  it("sans JavaScript : formulaire classique → redirection vers la confirmation", async () => {
    const body = new URLSearchParams({ ...valid(), consent: "on", startedAt: String(Date.now() - 10_000) } as unknown as Record<string, string>);
    const res = await app.request("/api/public/contact", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/contact/merci/");
    expect(received).toHaveLength(1);
  });

  it("sans configuration SMTP : indisponible (503)", async () => {
    const host = process.env.FOURMY_SMTP_HOST;
    delete process.env.FOURMY_SMTP_HOST;
    resetContactMailer();
    try {
      expect((await post(valid())).status).toBe(503);
    } finally {
      process.env.FOURMY_SMTP_HOST = host;
      resetContactMailer();
    }
  });

  it("adresse du visiteur : seules les valeurs ajoutées par les proxys de confiance comptent", () => {
    // Client → Traefik → nginx → API : 2 proxys de confiance.
    expect(clientIp("1.2.3.4, 203.0.113.9, 172.18.0.5", "172.18.0.6", 2)).toBe("203.0.113.9");
    // Une valeur forgée en tête de chaîne est ignorée.
    expect(clientIp("6.6.6.6, 1.2.3.4, 203.0.113.9, 172.18.0.5", "x", 2)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6", "10.0.0.1", 0)).toBe("10.0.0.1");
  });
});
