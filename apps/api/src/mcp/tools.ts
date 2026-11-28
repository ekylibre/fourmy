import { z } from "zod";
import type { AccessModule } from "@fourmy/contracts";
import { ToolError, type FarmApi } from "./client.js";
import { day, dayTime, fold, ha, haText, isoDay, matches, num, page, pageNote, plural, quantity } from "./format.js";

/**
 * Outils MCP du lot 1, en lecture (conception_api_mcp.md §7.2). Chaque outil
 * déclare son module : il n'est proposé que si ce module est ouvert sur au
 * moins une ferme de l'appelant, et refusé sur une ferme où il ne l'est pas.
 * La réponse : un résumé en français, puis les données structurées.
 */

export type ToolResult = { summary: string; data: Record<string, unknown> };

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  module: AccessModule;
  /** `write` : outil d'écriture (propositions), proposé si le module est ouvert en écriture. */
  level?: "write";
  input: z.ZodRawShape;
  run: (api: FarmApi, args: Record<string, unknown>) => Promise<ToolResult>;
};

const curseur = z.string().optional().describe("Curseur de la page suivante, donné par la réponse précédente.");
const campagne = z.number().int().min(2000).max(2100).optional().describe("Campagne (année de récolte), par défaut l'année en cours.");
const thisYear = () => new Date().getFullYear();

type Intervention = {
  id: string;
  procedure: string;
  status: "planned" | "done" | "cancelled";
  startedAt: string;
  stoppedAt: string | null;
  targets: { kind: string; id: string; workedAreaM2?: number | null }[];
  inputs: { articleId: string; quantity: number | null; per?: string | null; unit: string | null }[];
  outputs?: { articleId: string; quantity: number | null; per?: string | null; unit: string | null }[];
  tools: { equipmentId: string }[];
  doers?: unknown[];
  purposes?: string[];
  notes?: string | null;
  bbch?: string | number | null;
  shared?: boolean;
  workDurationS?: number | null;
};

const STATUS: Record<Intervention["status"], string> = { planned: "prévue", done: "réalisée", cancelled: "annulée" };

/** Parcelle désignée par son identifiant ou son nom (sans casse ni accents). */
export async function findParcel(api: FarmApi, ref: string) {
  const names = await api.parcelNames();
  if (names.has(ref)) return { id: ref, name: names.get(ref)! };
  // Module Parcelles fermé : un identifiant reste utilisable, sans le nom.
  if (!names.size && /^[0-9a-f-]{36}$/i.test(ref)) return { id: ref, name: "parcelle" };
  const all = [...names].map(([id, name]) => ({ id, name }));
  const exact = all.filter((p) => fold(p.name) === fold(ref));
  const found = exact.length ? exact : all.filter((p) => fold(p.name).includes(fold(ref)));
  if (found.length === 1) return found[0]!;
  if (!found.length) throw new ToolError(`Aucune parcelle ne correspond à « ${ref} ». L'outil parcelles donne la liste.`);
  throw new ToolError(`Plusieurs parcelles correspondent à « ${ref} » : ${found.slice(0, 10).map((p) => p.name).join(", ")}. Précisez.`);
}

/** Interventions mises en forme, avec les noms des parcelles, intrants et matériels. */
async function describeInterventions(api: FarmApi, list: Intervention[]) {
  const [parcels, articles, equipments, procedures] = await Promise.all([api.parcelNames(), api.articleNames(), api.equipmentNames(), api.procedureLabels()]);
  return list.map((i) => {
    const plots = i.targets.filter((t) => t.kind === "land_parcel");
    const worked = plots.reduce((s, t) => s + (t.workedAreaM2 ?? 0), 0);
    return {
      id: i.id,
      type: procedures.get(i.procedure) ?? i.procedure,
      statut: STATUS[i.status] ?? i.status,
      debut: dayTime(i.startedAt),
      fin: dayTime(i.stoppedAt),
      parcelles: plots.map((t) => parcels.get(t.id) ?? "parcelle"),
      surface_travaillee_ha: worked ? ha(worked) : null,
      intrants: i.inputs.map((x) => ({ article: articles.get(x.articleId) ?? "article", quantite: quantity(x.quantity, x.unit, x.per) })),
      materiels: i.tools.map((t) => equipments.get(t.equipmentId) ?? "matériel"),
      ...(i.shared ? { partagee: true } : {}),
    };
  });
}

function summarizeInterventions(items: Awaited<ReturnType<typeof describeInterventions>>, from: string, to: string, one: string, many: string) {
  const plots = new Set(items.flatMap((i) => i.parcelles));
  const shared = items.filter((i) => i.partagee).length;
  return (
    `${plural(items.length, one, many)} du ${day(from)} au ${day(to)}${plots.size ? ` sur ${plural(plots.size, "parcelle")}` : ""}.` +
    (shared ? ` ${shared} partagée(s) avec des activités hors de votre accès : quantités et surfaces ramenées à votre part.` : "")
  );
}

/** Fenêtre de dates : du/au (AAAA-MM-JJ), 366 jours au plus. */
function window(du: unknown, au: unknown, defaultDays: number, forward: boolean) {
  const today = new Date();
  const shift = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
  const parse = (v: unknown, name: string) => {
    if (v === undefined) return null;
    const d = new Date(`${String(v)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new ToolError(`${name} : date AAAA-MM-JJ attendue.`);
    return d;
  };
  let from = parse(du, "du");
  let to = parse(au, "au");
  if (!from && !to) [from, to] = forward ? [today, shift(today, defaultDays)] : [shift(today, -defaultDays), today];
  else if (!from) from = shift(to!, -defaultDays);
  else if (!to) to = shift(from, defaultDays);
  if (to! < from!) throw new ToolError("La date de fin précède la date de début.");
  if (to!.getTime() - from!.getTime() > 366 * 86_400_000) throw new ToolError("Période limitée à 366 jours.");
  return { from: isoDay(from!), to: isoDay(to!) };
}

export const TOOLS: ToolDef[] = [
  {
    name: "parcelles",
    title: "Parcelles",
    module: "parcels",
    description: "Liste les parcelles de la ferme avec leur surface, leur îlot PAC et leurs activités ; recherche par nom, îlot ou culture.",
    input: { recherche: z.string().optional().describe("Texte cherché dans le nom, l'îlot ou l'activité."), curseur },
    async run(api, a) {
      const list = api.get<{ items: { id: string; name: string; version: { areaM2: number; pacIslet: string | null } | null }[] }>("/land-parcels");
      const [{ items }, acts] = await Promise.all([list, api.activities()]);
      const byParcel = new Map<string, string[]>();
      for (const act of acts) for (const p of act.parcelIds) byParcel.set(p, [...(byParcel.get(p) ?? []), act.name]);
      const rows = items
        .map((p) => ({ id: p.id, nom: p.name, surface_ha: ha(p.version?.areaM2), ilot_pac: p.version?.pacIslet ?? null, activites: byParcel.get(p.id) ?? [] }))
        .filter((p) => matches(a.recherche as string | undefined, p.nom, p.ilot_pac, ...p.activites))
        .sort((x, y) => x.nom.localeCompare(y.nom, "fr", { numeric: true }));
      const pg = page(rows, a.curseur as string | undefined);
      const total = rows.reduce((s, p) => s + (p.surface_ha ?? 0), 0);
      return {
        summary: `${plural(rows.length, "parcelle")}, ${num(total)} ha au total${a.recherche ? ` (recherche « ${String(a.recherche)} »)` : ""}.${pageNote(pg)}`,
        data: { parcelles: pg.items, total: pg.total, curseur_suivant: pg.nextCursor },
      };
    },
  },
  {
    name: "fiche_parcelle",
    title: "Fiche d'une parcelle",
    module: "parcels",
    description: "Fiche d'une parcelle : surface, îlot PAC, productions par campagne, points d'eau proches.",
    input: { parcelle: z.string().describe("Nom ou identifiant de la parcelle.") },
    async run(api, a) {
      // Le nom se résout d'abord par les libellés ; l'appel principal (journalisé) est la fiche.
      const { id } = await findParcel(api, String(a.parcelle));
      type Sheet = {
        name: string;
        areaM2: number;
        pacIslet: string | null;
        productions: { year: number; declared: boolean; activity: { name: string } }[];
        water?: { name: string | null; kind: string; distanceM: number }[];
        cap?: unknown[];
      };
      const s = await api.get<Sheet>(`/land-parcels/${id}/sheet`);
      const data = {
        id,
        nom: s.name,
        surface_ha: ha(s.areaM2),
        ilot_pac: s.pacIslet,
        productions: s.productions.map((p) => ({ campagne: p.year, activite: p.activity.name, declaree_pac: p.declared })),
        points_d_eau: (s.water ?? []).slice(0, 5).map((w) => ({ nom: w.name, distance_m: w.distanceM })),
      };
      const current = data.productions.filter((p) => p.campagne === thisYear()).map((p) => p.activite);
      return {
        summary: `${s.name} : ${haText(s.areaM2)}${s.pacIslet ? `, îlot ${s.pacIslet}` : ""}${current.length ? `, ${current.join(", ")} en ${thisYear()}` : ""}.`,
        data,
      };
    },
  },
  {
    name: "interventions_periode",
    title: "Interventions d'une période",
    module: "interventions",
    description:
      "Interventions réalisées sur une période (30 derniers jours par défaut, 366 jours au plus), filtrables par parcelle, activité et type d'intervention.",
    input: {
      du: z.string().optional().describe("Début (AAAA-MM-JJ)."),
      au: z.string().optional().describe("Fin incluse (AAAA-MM-JJ)."),
      parcelle: z.string().optional().describe("Nom ou identifiant de parcelle."),
      activite: z.string().optional().describe("Nom d'activité (ex. « Blé »)."),
      type: z.string().optional().describe("Type d'intervention (ex. « Semis », « Traitement »)."),
      statut: z.enum(["realisee", "prevue", "annulee", "toutes"]).optional().describe("Par défaut : réalisées."),
      curseur,
    },
    async run(api, a) {
      const { from, to } = window(a.du, a.au, 30, false);
      const status = ({ realisee: "done", prevue: "planned", annulee: "cancelled", toutes: null } as const)[(a.statut as string) ?? "realisee"] ?? null;
      const toNext = isoDay(new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000));
      const res = api.get<{ items: Intervention[] }>(`/interventions?from=${from}&to=${toNext}${status ? `&status=${status}` : ""}`);
      let list = (await res).items;
      if (a.parcelle) {
        const p = await findParcel(api, String(a.parcelle));
        list = list.filter((i) => i.targets.some((t) => t.id === p.id));
      }
      if (a.activite) {
        const acts = (await api.activities(Number(from.slice(0, 4)))).filter((x) => matches(String(a.activite), x.name, x.cultivationLabel));
        if (!acts.length) throw new ToolError(`Aucune activité ne correspond à « ${String(a.activite)} ».`);
        const plots = new Set(acts.flatMap((x) => x.parcelIds));
        list = list.filter((i) => i.targets.some((t) => plots.has(t.id)));
      }
      let rows = await describeInterventions(api, list);
      if (a.type) rows = rows.filter((r) => matches(String(a.type), r.type));
      const pg = page(rows, a.curseur as string | undefined);
      return { summary: summarizeInterventions(rows, from, to, "intervention", "interventions") + pageNote(pg), data: { interventions: pg.items, total: pg.total, curseur_suivant: pg.nextCursor } };
    },
  },
  {
    name: "detail_intervention",
    title: "Détail d'une intervention",
    module: "interventions",
    description: "Détail d'une intervention : dates, parcelles et surfaces, intrants et doses, récoltes, matériels, cibles, notes.",
    input: { id: z.string().uuid().describe("Identifiant de l'intervention (donné par interventions_periode).") },
    async run(api, a) {
      const i = await api.get<Intervention>(`/interventions/${String(a.id)}`);
      const [row] = await describeInterventions(api, [i]);
      const articles = await api.articleNames();
      const data = {
        ...row!,
        recoltes: (i.outputs ?? []).map((x) => ({ article: articles.get(x.articleId) ?? "article", quantite: quantity(x.quantity, x.unit, x.per) })),
        cibles: i.purposes ?? [],
        stade_bbch: i.bbch ?? null,
        duree_travail_h: i.workDurationS ? Math.round(i.workDurationS / 360) / 10 : null,
        intervenants: i.doers?.length ?? 0,
        notes: i.notes ?? null,
      };
      return {
        summary: `${row!.type} ${row!.statut} le ${day(i.startedAt)}${row!.parcelles.length ? ` sur ${row!.parcelles.join(", ")}` : ""}${row!.surface_travaillee_ha ? ` (${num(row!.surface_travaillee_ha)} ha)` : ""}.${i.shared ? " Intervention partagée : quantités ramenées à votre part." : ""}`,
        data,
      };
    },
  },
  {
    name: "interventions_prevues",
    title: "Interventions prévues",
    module: "interventions",
    description: "Interventions prévues à venir (60 prochains jours par défaut).",
    input: { du: z.string().optional().describe("Début (AAAA-MM-JJ)."), au: z.string().optional().describe("Fin incluse (AAAA-MM-JJ)."), curseur },
    async run(api, a) {
      const { from, to } = window(a.du, a.au, 60, true);
      const toNext = isoDay(new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000));
      const { items } = await api.get<{ items: Intervention[] }>(`/interventions?from=${from}&to=${toNext}&status=planned`);
      const rows = await describeInterventions(api, items);
      const pg = page(rows, a.curseur as string | undefined);
      return { summary: summarizeInterventions(rows, from, to, "intervention prévue", "interventions prévues") + pageNote(pg), data: { interventions: pg.items, total: pg.total, curseur_suivant: pg.nextCursor } };
    },
  },
  {
    name: "registre_phyto",
    title: "Registre phytosanitaire",
    module: "phyto",
    description: "Registre phytosanitaire d'une campagne : date, parcelle, culture, produit, numéro AMM, dose.",
    input: { campagne, curseur },
    async run(api, a) {
      const year = (a.campagne as number | undefined) ?? thisYear();
      type Entry = { doneOn: string; parcelName: string; areaM2: number; crop: string | null; productName: string; amm: string | null; quantity: number | null; unit: string | null };
      const { items } = await api.get<{ items: Entry[] }>(`/registers/phyto?campaign=${year}`);
      const rows = items.map((e) => ({ date: day(e.doneOn), parcelle: e.parcelName, surface_ha: ha(e.areaM2), culture: e.crop, produit: e.productName, amm: e.amm, dose: quantity(e.quantity, e.unit) }));
      const pg = page(rows, a.curseur as string | undefined);
      const products = new Set(items.map((e) => e.productName));
      return {
        summary: `Registre phyto ${year} : ${plural(rows.length, "ligne")}, ${plural(products.size, "produit")}.${pageNote(pg)}`,
        data: { campagne: year, lignes: pg.items, total: pg.total, curseur_suivant: pg.nextCursor },
      };
    },
  },
  {
    name: "assolement",
    title: "Assolement",
    module: "activities",
    description: "Assolement d'une campagne : surface et parcelles de chaque activité.",
    input: { campagne },
    async run(api, a) {
      const year = (a.campagne as number | undefined) ?? thisYear();
      type A = { id: string; name: string; cultivationLabel: string | null; parcelIds: string[]; areaM2: number; suspended: boolean };
      const { items } = await api.get<{ items: A[] }>(`/activities?year=${year}`);
      const names = await api.parcelNames();
      const rows = items
        .filter((x) => x.parcelIds.length)
        .sort((x, y) => y.areaM2 - x.areaM2)
        .map((x) => ({ activite: x.name, culture: x.cultivationLabel, surface_ha: ha(x.areaM2), parcelles: x.parcelIds.map((p) => names.get(p) ?? "parcelle") }));
      const total = items.reduce((s, x) => s + x.areaM2, 0);
      return {
        summary: `Assolement ${year} : ${plural(rows.length, "activité")} sur ${haText(total)} (${rows.map((r) => `${r.activite} ${num(r.surface_ha)} ha`).join(", ") || "aucune parcelle affectée"}).`,
        data: { campagne: year, activites: rows, surface_totale_ha: ha(total) },
      };
    },
  },
  {
    name: "activites",
    title: "Activités",
    module: "activities",
    description: "Activités de la ferme (productions) avec leur culture, leur famille et leur surface de l'année.",
    input: {},
    async run(api) {
      type A = { id: string; name: string; family: string; cultivationLabel: string | null; areaM2: number; suspended: boolean; parcelIds: string[] };
      const { items } = await api.get<{ items: A[] }>("/activities");
      const rows = items.map((x) => ({ id: x.id, nom: x.name, famille: x.family, culture: x.cultivationLabel, surface_ha: ha(x.areaM2), parcelles: x.parcelIds.length, suspendue: x.suspended }));
      return { summary: `${plural(rows.length, "activité")} : ${rows.map((r) => r.nom).join(", ")}.`, data: { activites: rows } };
    },
  },
  {
    name: "stock",
    title: "Stock",
    module: "stocks",
    description: "État du stock par article (intrants, semences, récoltes) : quantité et unité ; recherche par nom ou famille d'article.",
    input: {
      recherche: z.string().optional().describe("Texte cherché dans le nom de l'article."),
      famille: z.string().optional().describe("Famille d'article (ex. fertilizer, phyto, seed)."),
      curseur,
    },
    async run(api, a) {
      type Row = { articleId: string; articleName: string; articleKind: string; quantity: number; unit: string | null; lotId: string | null };
      const { items } = await api.get<{ items: Row[] }>("/stock");
      const byArticle = new Map<string, { article: string; famille: string; quantite: number; unite: string | null; lots: number }>();
      for (const r of items) {
        const cur = byArticle.get(r.articleId) ?? { article: r.articleName, famille: r.articleKind, quantite: 0, unite: r.unit, lots: 0 };
        cur.quantite += r.quantity;
        cur.lots += r.lotId ? 1 : 0;
        byArticle.set(r.articleId, cur);
      }
      const rows = [...byArticle.values()]
        .filter((r) => matches(a.recherche as string | undefined, r.article) && matches(a.famille as string | undefined, r.famille))
        .sort((x, y) => x.article.localeCompare(y.article, "fr"))
        .map((r) => {
          const q = Math.round(r.quantite * 1000) / 1000;
          return { ...r, quantite: q, stock: quantity(q, r.unite) };
        });
      const negative = rows.filter((r) => r.quantite < 0).length;
      const pg = page(rows, a.curseur as string | undefined);
      return {
        summary: `${plural(rows.length, "article")} en stock${negative ? `, dont ${negative} en négatif (sorties sans entrée enregistrée)` : ""}.${pageNote(pg)}`,
        data: { articles: pg.items, total: pg.total, curseur_suivant: pg.nextCursor },
      };
    },
  },
  {
    name: "materiels",
    title: "Matériels",
    module: "equipments",
    description: "Matériels de la ferme : type, état, marque et modèle, compteur, prochain entretien.",
    input: { recherche: z.string().optional().describe("Texte cherché dans le nom, la marque ou le modèle."), curseur },
    async run(api, a) {
      type E = {
        id: string;
        name: string;
        kind: string;
        state: string;
        brand: string | null;
        model: string | null;
        year: number | null;
        meterUnit: string | null;
        lastReading: { value: number } | null;
        due: { overdue: number; soon: number; unknown: number } | null;
      };
      const { items } = await api.get<{ items: E[] }>("/equipments");
      const rows = items
        .filter((e) => matches(a.recherche as string | undefined, e.name, e.brand, e.model, e.kind))
        .map((e) => ({
          id: e.id,
          nom: e.name,
          type: e.kind,
          etat: e.state,
          marque: e.brand,
          modele: e.model,
          annee: e.year,
          compteur: e.lastReading ? `${num(e.lastReading.value, 1)} ${e.meterUnit === "hours" ? "h" : (e.meterUnit ?? "")}`.trim() : null,
          entretien: e.due && (e.due.overdue || e.due.soon) ? { en_retard: e.due.overdue, bientot: e.due.soon } : null,
        }));
      const pg = page(rows, a.curseur as string | undefined);
      const late = rows.filter((r) => r.entretien?.en_retard).length;
      const soon = rows.filter((r) => r.entretien && !r.entretien.en_retard).length;
      return {
        summary: `${plural(rows.length, "matériel")}${late ? `, ${late} avec un entretien en retard` : ""}${soon ? `, ${soon} avec un entretien bientôt dû` : ""}.${pageNote(pg)}`,
        data: { materiels: pg.items, total: pg.total, curseur_suivant: pg.nextCursor },
      };
    },
  },
  {
    name: "controles_certification",
    title: "Contrôles HVE et AB",
    module: "certifications",
    description: "Résultat du contrôle de certification d'une campagne (HVE niveau 3 ou agriculture biologique) : verdict, points par section, écarts.",
    input: { type: z.enum(["hve", "ab"]).describe("Certification contrôlée."), campagne },
    async run(api, a) {
      const year = (a.campagne as number | undefined) ?? thisYear();
      type Finding = { level: string; message: string };
      type Report = { verdict: string; sections: { label: string; level: string; points?: { got: number; max: number; min?: number }; findings: Finding[] }[] };
      const r = await api.get<Report>(`/control/${String(a.type)}?campaign=${year}`);
      const LEVEL: Record<string, string> = { ok: "conforme", warning: "à surveiller", error: "non conforme", missing: "données manquantes", na: "sans objet" };
      const sections = r.sections.map((s) => ({
        section: s.label,
        niveau: LEVEL[s.level] ?? s.level,
        points: s.points ? `${s.points.got}/${s.points.max}${s.points.min !== undefined ? ` (minimum ${s.points.min})` : ""}` : null,
        ecarts: s.findings.filter((f) => f.level !== "ok" && f.level !== "na").map((f) => f.message),
      }));
      const issues = sections.reduce((n, s) => n + s.ecarts.length, 0);
      return {
        summary: `Contrôle ${String(a.type).toUpperCase()} ${year} : ${LEVEL[r.verdict] ?? r.verdict}, ${plural(issues, "point")} à revoir. Ce contrôle est indicatif : il ne remplace pas l'audit.`,
        data: { certification: a.type, campagne: year, verdict: LEVEL[r.verdict] ?? r.verdict, sections },
      };
    },
  },
];
