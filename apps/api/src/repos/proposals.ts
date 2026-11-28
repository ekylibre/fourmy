import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  interventionPlanWrite,
  PROPOSAL_RETENTION_DAYS,
  type InterventionPlanWrite,
  type Proposal,
  type ProposalChannel,
  type ProposalChecks,
  type ProposalPayload,
  type ProposalStatus,
} from "@fourmy/contracts";
import { DomainError, type DomainCtx } from "@fourmy/domain";
import { checkCompliance } from "./phyto.js";
import { completeInTx, planInTx } from "./interventions.js";
import { checkApplicationTx } from "./fertilization-record.js";
import { checkInterventionCertification } from "./certification-controls.js";
import { Conflict, NotFound } from "../routes/helpers.js";

/**
 * Propositions des accès externes (lot AM8, claudedocs/conception_api_mcp.md
 * §8) : dépôt contrôlé à blanc, liste « À valider », acceptation par le
 * chemin habituel des interventions, refus, expiration à 90 jours.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

/** Qui dépose ou consulte. */
export type ProposalActor = { userId: string; accessId: string | null; owner: boolean };

type Row = {
  id: string;
  status: ProposalStatus;
  channel: ProposalChannel;
  access_name: string | null;
  user_id: string;
  user_name: string | null;
  payload: ProposalPayload;
  message: string | null;
  checks: ProposalChecks | null;
  created_at: Date | string;
  decided_at: Date | string | null;
  decision_note: string | null;
  result_id: string | null;
  corrected: boolean;
};

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

function toProposal(r: Row): Proposal {
  return {
    id: r.id,
    kind: "intervention",
    status: r.status,
    channel: r.channel,
    accessName: r.access_name,
    user: { id: r.user_id, name: r.user_name ?? "" },
    payload: r.payload,
    message: r.message,
    checks: r.checks,
    createdAt: iso(r.created_at)!,
    decidedAt: iso(r.decided_at),
    decisionNote: r.decision_note,
    resultId: r.result_id,
    corrected: r.corrected,
  };
}

const SELECT = sql`SELECT p.id, p.status, p.channel, p.access_name, p.user_id, coalesce(nullif(u.name, ''), u.email) AS user_name,
                          p.payload, p.message, p.checks, p.created_at, p.decided_at, p.decision_note, p.result_id, p.corrected
                   FROM external_proposals p JOIN users u ON u.id = p.user_id`;

/** Le responsable voit toutes les propositions ; un accès, les siennes (API-23b). */
const visibleTo = (a: ProposalActor) =>
  a.owner ? sql`true` : a.accessId ? sql`p.access_id = ${a.accessId}` : sql`(p.user_id = ${a.userId} AND p.access_id IS NULL)`;

/** Jour de l'intervention proposée : première période, sinon date prévue, sinon aujourd'hui. */
function proposedAt(p: ProposalPayload): string {
  return p.periods[0]?.startedAt ?? p.plannedAt ?? new Date().toISOString();
}

/**
 * Cibles dans le périmètre (API-24) : parcelles de la ferme, cultivées par une
 * activité de l'accès à la date. Matériels, lieux et cuves : hors périmètre
 * d'activités, refusés si l'accès est limité à certaines activités.
 */
async function assertTargetsInScope(tx: Tx, p: ProposalPayload) {
  const day = proposedAt(p).slice(0, 10);
  const parcels = p.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id);
  const [scope] = await rows<{ scoped: boolean }>(tx, sql`SELECT current_activity_scope() IS NOT NULL AS scoped`);
  if (scope?.scoped && p.targets.some((t) => t.kind !== "land_parcel")) {
    throw new DomainError("Cet accès est limité à certaines activités : une proposition ne peut cibler que des parcelles.");
  }
  if (!parcels.length) return;
  const ok = await rows<{ id: string }>(
    tx,
    sql`SELECT lp.id FROM land_parcels lp
        WHERE lp.id IN (${sql.join(parcels.map((id) => sql`${id}::uuid`), sql`, `)})
          AND fourmy_parcel_in_scope_on(lp.id, ${day}::date)`,
  );
  const seen = new Set(ok.map((r) => r.id));
  const out = parcels.filter((id) => !seen.has(id));
  if (out.length) throw new DomainError(`${out.length} parcelle(s) ciblée(s) hors de cet accès ou inconnues de la ferme.`);
}

/**
 * Contrôles à blanc (API-22) : les mêmes que l'écran de saisie, sans rien
 * écrire. L'IFT, calculé après la réalisation, l'est à l'acceptation.
 */
async function dryRunChecks(tx: Tx, farmId: string, p: ProposalPayload): Promise<ProposalChecks> {
  const body = { ...p, periods: p.periods, plannedAt: p.plannedAt };
  const phyto = await checkCompliance(tx, body);
  const fertilizers = await rows<{ id: string }>(
    tx,
    p.inputs.length
      ? sql`SELECT id FROM articles WHERE kind = 'fertilizer' AND id IN (${sql.join(p.inputs.map((i) => sql`${i.articleId}::uuid`), sql`, `)})`
      : sql`SELECT NULL::uuid AS id WHERE false`,
  );
  const fertIds = new Set(fertilizers.map((f) => f.id));
  const parcelIds = p.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id);
  const fertInputs = p.inputs.filter((i) => fertIds.has(i.articleId));
  const fertilization =
    fertInputs.length && parcelIds.length
      ? await checkApplicationTx(tx, farmId, {
          startedAt: proposedAt(p),
          parcelIds,
          inputs: fertInputs.map(({ articleId, quantity, per, unit }) => ({ articleId, quantity, per, ...(unit ? { unit } : {}) })),
          areaM2: null,
          interventionId: null,
          weather: null,
        })
      : null;
  const certification = parcelIds.length ? await checkInterventionCertification(tx, { ...body, justification: p.justification ?? null }) : null;

  const messages: ProposalChecks["messages"] = [];
  for (const c of phyto.checks) {
    for (const i of c.indicators) if (i.level === "danger" || i.level === "warning") messages.push({ level: i.level, message: `${c.articleName} : ${i.message}` });
  }
  if (phyto.mixture?.level === "danger") for (const i of phyto.mixture.issues) messages.push({ level: "danger", message: i.message });
  for (const i of fertilization?.indicators ?? []) {
    if (i.level === "danger" || i.level === "warning") messages.push({ level: i.level, message: `${i.parcelName ? `${i.parcelName} : ` : ""}${i.message}` });
  }
  for (const f of certification?.findings ?? []) if (f.level === "danger" || f.level === "warning") messages.push({ level: f.level, message: f.message });
  const rank = { ok: 0, info: 1, warning: 2, danger: 3 } as const;
  const levels: (keyof typeof rank)[] = [phyto.level, ...messages.map((m) => m.level)];
  const level = levels.reduce((a, b) => (rank[b] > rank[a] ? b : a), "ok" as keyof typeof rank);
  return { level, messages, phyto: phyto.checks.length ? phyto : null, fertilization, certification, checkedAt: new Date().toISOString() };
}

class DryRun extends Error {}

/**
 * Validation du contenu (API-22) : l'enregistrement habituel (planification,
 * puis réalisation s'il a des périodes) joué dans un point de sauvegarde
 * annulé. Une règle du domaine refusée l'est dès le dépôt (422).
 */
async function dryRunSave(tx: Tx, farmId: string, actor: ProposalActor & { channel: ProposalChannel }, p: ProposalPayload) {
  const ctx: DomainCtx = { now: new Date().toISOString(), newId: () => crypto.randomUUID(), actor: actor.userId, origin: actor.channel === "mcp" ? "mcp" : "api" };
  const id = crypto.randomUUID();
  await tx
    .transaction(async (sp) => {
      // Cibles déjà vérifiées dans le périmètre : la répétition s'écrit sans lui (une intervention
      // naît sans cible, donc hors périmètre) ; le point de sauvegarde annulé rétablit le réglage.
      await sp.execute(sql`SELECT set_config('fourmy.activity_scope', '', true)`);
      if (p.periods.length || p.crews.length) {
        // Planifiée avec ses cibles d'abord : sans cible, elle serait hors du périmètre d'activités (RLS).
        await planInTx(sp, farmId, ctx, interventionPlanWrite.parse({ ...p, id, periods: [], crews: [], plannedAt: proposedAt(p) }));
        await completeInTx(sp, farmId, ctx, id, p);
      } else {
        await planInTx(sp, farmId, ctx, { ...p, id });
      }
      throw new DryRun();
    })
    .catch((e: unknown) => {
      if (!(e instanceof DryRun)) throw e;
    });
}

/**
 * Dépôt (POST /proposals) : cibles dans le périmètre, contrôles à blanc,
 * proposition en attente. Rien n'est écrit dans la ferme (B6).
 */
export async function submitProposal(
  db: Database,
  farmId: string,
  actor: ProposalActor & { channel: ProposalChannel },
  write: { payload: ProposalPayload; message?: string },
): Promise<Proposal> {
  return withFarm(db, farmId, async (tx) => {
    await assertTargetsInScope(tx, write.payload);
    await dryRunSave(tx, farmId, actor, write.payload);
    const checks = await dryRunChecks(tx, farmId, write.payload);
    const id = crypto.randomUUID();
    await tx.execute(sql`
      INSERT INTO external_proposals (id, farm_id, access_id, user_id, access_name, channel, kind, payload, message, checks)
      VALUES (${id}, ${farmId}, ${actor.accessId}, ${actor.userId},
              (SELECT name FROM farm_accesses WHERE id = ${actor.accessId}::uuid), ${actor.channel}, 'intervention',
              ${JSON.stringify(write.payload)}::jsonb, ${write.message ?? null}, ${JSON.stringify(checks)}::jsonb)`);
    return toProposal((await rows<Row>(tx, sql`${SELECT} WHERE p.id = ${id}`))[0]!);
  });
}

export async function listProposals(db: Database, farmId: string, actor: ProposalActor, status?: ProposalStatus): Promise<{ items: Proposal[]; pending: number }> {
  return withFarm(db, farmId, async (tx) => {
    const filter = status ? sql`AND p.status = ${status}` : sql``;
    const items = await rows<Row>(tx, sql`${SELECT} WHERE ${visibleTo(actor)} ${filter} ORDER BY p.created_at DESC LIMIT 200`);
    const [n] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM external_proposals p WHERE p.status = 'pending' AND ${visibleTo(actor)}`);
    return { items: items.map(toProposal), pending: n?.n ?? 0 };
  });
}

export async function readProposal(db: Database, farmId: string, actor: ProposalActor, id: string): Promise<Proposal> {
  return withFarm(db, farmId, async (tx) => {
    const [r] = await rows<Row>(tx, sql`${SELECT} WHERE p.id = ${id} AND ${visibleTo(actor)}`);
    if (!r) throw new NotFound("Proposition introuvable.");
    return toProposal(r);
  });
}

/** Contenu comparable : procédure, cibles, intrants, périodes à la minute. */
function signature(p: Pick<InterventionPlanWrite, "procedure" | "targets" | "inputs" | "periods" | "crews">) {
  const minute = (s: string | undefined) => (s ? new Date(s).toISOString().slice(0, 16) : null);
  const periods = p.periods.length ? p.periods : p.crews.flatMap((c) => c.periods);
  return JSON.stringify({
    procedure: p.procedure,
    targets: p.targets.map((t) => `${t.kind}:${t.id}`).sort(),
    inputs: p.inputs.map((i) => `${i.articleId}:${i.quantity}:${i.per}:${i.unit ?? ""}`).sort(),
    periods: periods.map((x) => `${minute(x.startedAt)}-${minute(x.stoppedAt)}`).sort(),
  });
}

/**
 * Acceptation liée à un enregistrement d'intervention (`proposal` du corps,
 * lot AM8) : la proposition passe « acceptée », corrigée si le contenu a
 * changé, et l'intervention prend l'origine du dépôt (`api`, `mcp`).
 * Appelée dans la transaction de l'intervention : tout ou rien.
 */
export async function acceptLinkedProposal(tx: Tx, ctx: DomainCtx, interventionId: string, body: InterventionPlanWrite | (Omit<InterventionPlanWrite, "procedure"> & { procedure?: string })) {
  if (!body.proposal) return;
  const [p] = await rows<{ status: ProposalStatus; result_id: string | null; channel: ProposalChannel; payload: ProposalPayload }>(
    tx,
    sql`SELECT status, result_id, channel, payload FROM external_proposals WHERE id = ${body.proposal} FOR UPDATE`,
  );
  if (!p) throw new NotFound("Proposition introuvable.");
  if (p.status === "accepted" && p.result_id === interventionId) return; // réalisation après planification, ou nouvel essai
  if (p.status !== "pending") throw new Conflict("Cette proposition a déjà été traitée.");
  const [i] = await rows<{ procedure: string }>(tx, sql`SELECT procedure FROM interventions WHERE id = ${interventionId}`);
  const corrected = signature(p.payload) !== signature({ ...body, procedure: body.procedure ?? i?.procedure ?? "" });
  const origin = p.channel === "mcp" ? "mcp" : "api";
  await tx.execute(sql`UPDATE external_proposals SET status = 'accepted', decided_by = ${ctx.actor}, decided_at = now(), result_id = ${interventionId}, corrected = ${corrected}
                       WHERE id = ${body.proposal}`);
  if (p.channel !== "web") await tx.execute(sql`UPDATE interventions SET origin = ${origin} WHERE id = ${interventionId}`);
}

/** Refus (POST /proposals/:id/reject) : gardée 90 jours, puis effacée (API-23c). */
export async function rejectProposal(db: Database, farmId: string, actor: ProposalActor, id: string, note: string | undefined): Promise<Proposal> {
  return withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ status: ProposalStatus }>(tx, sql`SELECT status FROM external_proposals WHERE id = ${id} FOR UPDATE`);
    if (!p) throw new NotFound("Proposition introuvable.");
    if (p.status !== "pending") throw new Conflict("Cette proposition a déjà été traitée.");
    await tx.execute(sql`UPDATE external_proposals SET status = 'rejected', decided_by = ${actor.userId}, decided_at = now(), decision_note = ${note ?? null} WHERE id = ${id}`);
    return toProposal((await rows<Row>(tx, sql`${SELECT} WHERE p.id = ${id}`))[0]!);
  });
}

/** Proposition en attente, pour l'acceptation : son contenu et son canal. */
export async function pendingProposal(db: Database, farmId: string, id: string): Promise<{ payload: ProposalPayload; channel: ProposalChannel }> {
  return withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ status: ProposalStatus; payload: ProposalPayload; channel: ProposalChannel }>(tx, sql`SELECT status, payload, channel FROM external_proposals WHERE id = ${id}`);
    if (!p) throw new NotFound("Proposition introuvable.");
    if (p.status !== "pending") throw new Conflict("Cette proposition a déjà été traitée.");
    return { payload: p.payload, channel: p.channel };
  });
}

/** Note du responsable à l'acceptation. */
export async function noteProposal(db: Database, farmId: string, id: string, note: string) {
  await withFarm(db, farmId, (tx) => tx.execute(sql`UPDATE external_proposals SET decision_note = ${note} WHERE id = ${id}`));
}

/**
 * Worker (API-23c) : une proposition laissée 90 jours sans suite expire ;
 * refusée ou expirée depuis 90 jours, elle est effacée. Les acceptées restent,
 * liées à leur intervention.
 */
export async function expireProposals(db: Database): Promise<{ expired: number; purged: number }> {
  return db.transaction(async (tx) => {
    const days = sql.raw(`interval '${PROPOSAL_RETENTION_DAYS} days'`);
    const expired = await rows(tx, sql`UPDATE external_proposals SET status = 'expired', decided_at = now()
                                       WHERE status = 'pending' AND created_at < now() - ${days} RETURNING id`);
    const purged = await rows(tx, sql`DELETE FROM external_proposals
                                      WHERE status IN ('rejected', 'expired') AND decided_at < now() - ${days} RETURNING id`);
    return { expired: expired.length, purged: purged.length };
  });
}
