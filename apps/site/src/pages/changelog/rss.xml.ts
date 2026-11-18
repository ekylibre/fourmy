// Flux RSS des nouveautés : une entrée par livraison.
import type { APIRoute } from "astro";
import { deliveries } from "../../lib/release";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://fourmy.org");
  const items = deliveries().map((d) => {
    const url = new URL(`/changelog/${d.version}/`, base).href;
    const parts = [
      ["Action requise", d.required],
      ["Nouveautés", d.features],
      ["Corrections", d.fixes],
    ] as const;
    const html = parts
      .filter(([, items]) => items.length)
      .map(([title, items]) => `<h3>${title}</h3><ul>${items.map((e) => `<li>${esc(e.text)}</li>`).join("")}</ul>`)
      .join("");
    return `<item><title>${esc(`${d.version}${d.title ? ` — ${d.title}` : ""}`)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${new Date(`${d.day}T12:00:00Z`).toUTCString()}</pubDate><description>${esc(html)}</description></item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Nouveautés de Fourmy</title><link>${new URL("/changelog/", base).href}</link><description>Les nouveautés et corrections de Fourmy, le jumeau numérique de la ferme.</description><language>fr</language>${items.join("")}</channel></rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
