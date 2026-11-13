import type { APIRoute } from "astro";
import { release } from "../lib/release";

/**
 * Version publique, lue par l'application web (pied du menu) : le nginx de
 * l'application relaie /version.json vers ce site, construit avec
 * l'historique Git (claudedocs/besoins_navigation_compte.md §3.4).
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ version: release.version, date: release.date }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
