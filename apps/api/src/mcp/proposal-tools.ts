import { z } from "zod";
import { PROPOSAL_STATUS_LABELS, type Proposal } from "@fourmy/contracts";
import { ToolError, type FarmApi } from "./client.js";
import { day, dayTime, fold, page, pageNote, plural, quantity } from "./format.js";
import { findParcel, type ToolDef } from "./tools.js";

/**
 * Outils MCP du lot 2 (lot AM8, conception_api_mcp.md §8) : l'assistant
 * propose une intervention, que le responsable de la ferme valide dans
 * « À valider ». Rien n'est écrit dans la ferme avant cette validation.
 */

/** Heure de Paris (« 2026-11-27T08:00 ») en ISO 8601 ; une date ou une heure avec décalage passe telle quelle. */
export function parisIso(local: string): string {
  if (/[zZ]|[+-]\d\d:\d\d$/.test(local)) {
    const t = Date.parse(local);
    if (Number.isNaN(t)) throw new ToolError(`Date illisible : « ${local} ».`);
    return new Date(t).toISOString();
  }
  const m = local.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if (!m) throw new ToolError(`Date illisible : « ${local} ». Format attendu : AAAA-MM-JJ ou AAAA-MM-JJTHH:MM (heure de Paris).`);
  const asUtc = new Date(`${m[1]}T${m[2] ?? "08"}:${m[3] ?? "00"}:00Z`);
  const paris = new Date(`${asUtc.toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace(" ", "T")}Z`);
  return new Date(asUtc.getTime() - (paris.getTime() - asUtc.getTime())).toISOString();
}

type Named = { id: string; name: string };

/** Élément désigné par son identifiant ou son nom (exact, sinon partiel). */
function pick<T extends Named>(all: T[], ref: string, what: string, hint: string): T {
  const byId = all.find((x) => x.id === ref);
  if (byId) return byId;
  const exact = all.filter((x) => fold(x.name) === fold(ref));
  const found = exact.length ? exact : all.filter((x) => fold(x.name).includes(fold(ref)));
  if (found.length === 1) return found[0]!;
  if (!found.length) throw new ToolError(`Aucun ${what} ne correspond à « ${ref} ». ${hint}`);
  throw new ToolError(`Plusieurs ${what}s correspondent à « ${ref} » : ${found.slice(0, 10).map((x) => x.name).join(", ")}. Précisez.`);
}

const STATUS_TEXT = { ...PROPOSAL_STATUS_LABELS } as Record<string, string>;

/** Proposition mise en forme, avec les noms des parcelles et des intrants. */
async function describe(api: FarmApi, list: Proposal[]) {
  const [parcels, articles, procedures] = await Promise.all([api.parcelNames(), api.articleNames(), api.procedureLabels()]);
  return list.map((p) => ({
    id: p.id,
    etat: p.status === "accepted" && p.corrected ? "acceptée après correction" : (STATUS_TEXT[p.status] ?? p.status).toLowerCase(),
    deposee_le: dayTime(p.createdAt),
    type: procedures.get(p.payload.procedure) ?? p.payload.procedure,
    date: dayTime(p.payload.periods[0]?.startedAt ?? p.payload.plannedAt ?? null),
    parcelles: p.payload.targets.filter((t) => t.kind === "land_parcel").map((t) => parcels.get(t.id) ?? "parcelle"),
    intrants: p.payload.inputs.map((i) => ({ article: articles.get(i.articleId) ?? "article", quantite: quantity(i.quantity, i.unit ?? null, i.per) })),
    controles: p.checks ? { niveau: p.checks.level, alertes: p.checks.messages.map((m) => m.message) } : null,
    message: p.message,
    decision: p.decidedAt ? { le: day(p.decidedAt), note: p.decisionNote } : null,
    intervention: p.resultId,
  }));
}

const LEVEL_TEXT: Record<string, string> = {
  ok: "aucune alerte",
  info: "aucune alerte",
  warning: "points à vérifier",
  danger: "feu rouge réglementaire",
};

export const PROPOSAL_TOOLS: ToolDef[] = [
  {
    name: "proposer_intervention",
    title: "Proposer une intervention",
    module: "interventions",
    level: "write",
    description:
      "Propose une intervention (traitement, semis, apport, travail du sol…) à la ferme. Elle est contrôlée tout de suite (phytosanitaire, ZNT, " +
      "nitrates, HVE et AB) mais n'est PAS enregistrée : le responsable de la ferme l'accepte, la corrige ou la refuse dans Fourmy. " +
      "Donnez le type (son libellé, « Pulvérisation », « Semis »…), les parcelles, la date et, s'il y en a, les produits avec leur dose. " +
      "Relisez la proposition avec l'utilisateur avant de l'envoyer.",
    input: {
      type: z.string().describe("Type d'intervention : son code ou son libellé (« Pulvérisation », « Semis »…)."),
      parcelles: z.array(z.string()).min(1).max(100).describe("Parcelles visées : noms ou identifiants."),
      debut: z.string().describe("Début, heure de Paris : AAAA-MM-JJ ou AAAA-MM-JJTHH:MM (8 h par défaut)."),
      fin: z.string().optional().describe("Fin, même format ; une heure après le début par défaut."),
      realisee: z.boolean().optional().describe("true : déjà faite ; false : à prévoir. Par défaut, faite si le début est passé."),
      intrants: z
        .array(
          z.object({
            produit: z.string().describe("Produit, semence ou engrais de la ferme : nom ou identifiant."),
            quantite: z.number().positive().describe("Dose ou quantité."),
            par: z.enum(["hectare", "total"]).optional().describe("hectare (dose, par défaut) ou total."),
            unite: z.string().optional().describe("Unité, si elle diffère de celle du produit (« l », « kg »)."),
          }),
        )
        .max(30)
        .optional(),
      notes: z.string().max(2000).optional().describe("Observations reprises sur l'intervention."),
      message: z.string().max(2000).optional().describe("Mot pour le responsable (« dicté au bord du champ le 27/11 »)."),
    },
    async run(api, a) {
      const { items: procedures } = await api.lookupList<{ code: string; label: string }>("interventions", "/procedures");
      const kinds = procedures.map((p) => ({ id: p.code, name: p.label }));
      const proc = pick(kinds, String(a.type), "type d'intervention", `Types possibles : ${kinds.map((k) => k.name).sort((x, y) => x.localeCompare(y, "fr")).join(", ")}.`);
      const parcels = [];
      for (const ref of a.parcelles as string[]) parcels.push(await findParcel(api, ref));
      const startedAt = parisIso(String(a.debut));
      const stoppedAt = a.fin ? parisIso(String(a.fin)) : new Date(Date.parse(startedAt) + 3_600_000).toISOString();
      if (Date.parse(stoppedAt) <= Date.parse(startedAt)) throw new ToolError("La fin doit suivre le début.");
      const done = (a.realisee as boolean | undefined) ?? Date.parse(startedAt) <= Date.now();
      type Input = { produit: string; quantite: number; par?: "hectare" | "total"; unite?: string };
      const wanted = (a.intrants as Input[] | undefined) ?? [];
      const { items: articles } = wanted.length ? await api.lookupList<{ id: string; name: string; unit: string }>("stocks", "/articles") : { items: [] };
      const inputs = wanted.map((i) => {
        const art = articles.length
          ? pick(articles, i.produit, "produit", "L'outil stock liste les produits de la ferme.")
          : /^[0-9a-f-]{36}$/i.test(i.produit)
            ? { id: i.produit, name: "produit", unit: "" }
            : (() => {
                throw new ToolError("Le module Stocks n'est pas ouvert à cet accès : désignez les produits par leur identifiant.");
              })();
        return { articleId: art.id, quantity: i.quantite, per: i.par ?? "hectare", ...(i.unite ? { unit: i.unite } : {}) };
      });
      const payload = {
        procedure: proc.id,
        targets: parcels.map((p) => ({ kind: "land_parcel" as const, id: p.id })),
        inputs,
        periods: done ? [{ startedAt, stoppedAt }] : [],
        ...(done ? {} : { plannedAt: startedAt }),
        ...(a.notes ? { notes: String(a.notes) } : {}),
      };
      const p = await api.post<Proposal>("/proposals", { kind: "intervention", payload, ...(a.message ? { message: String(a.message) } : {}) });
      const [d] = await describe(api, [p]);
      const alerts = p.checks?.messages ?? [];
      return {
        summary:
          `Proposition déposée : ${proc.name} ${done ? "réalisée" : "prévue"} le ${dayTime(startedAt)} sur ${plural(parcels.length, "parcelle")}` +
          ` (${parcels.map((x) => x.name).join(", ")}). Elle attend la validation du responsable de la ferme ; rien n'est encore enregistré.` +
          ` Contrôles : ${LEVEL_TEXT[p.checks?.level ?? "ok"]}${alerts.length ? ` — ${alerts.map((m) => m.message).join(" ; ")}` : ""}.` +
          " L'outil etat_propositions en donne la suite.",
        data: { proposition: d },
      };
    },
  },
  {
    name: "etat_propositions",
    title: "État des propositions",
    module: "interventions",
    description: "Propositions déposées avec cet accès et leur suite : en attente, acceptée (avec ou sans correction), refusée ou expirée (90 jours sans suite).",
    input: {
      etat: z.enum(["pending", "accepted", "rejected", "expired"]).optional().describe("Filtre : pending (en attente), accepted, rejected, expired."),
      curseur: z.string().optional().describe("Curseur de la page suivante, donné par la réponse précédente."),
    },
    async run(api, a) {
      const { items, pending } = await api.get<{ items: Proposal[]; pending: number }>(`/proposals${a.etat ? `?status=${String(a.etat)}` : ""}`);
      const rows = await describe(api, items);
      const pg = page(rows, a.curseur as string | undefined);
      return {
        summary: `${plural(rows.length, "proposition")}${a.etat ? "" : `, dont ${pending} en attente de validation`}.${pageNote(pg)}`,
        data: { propositions: pg.items, total: pg.total, curseur_suivant: pg.nextCursor },
      };
    },
  },
];
