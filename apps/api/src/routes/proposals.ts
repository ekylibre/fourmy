import { Hono } from "hono";
import { withFarm } from "@fourmy/db";
import { interventionCompleteWrite, interventionPlanWrite, proposalAccept, proposalReject, proposalStatus, proposalWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { isMcpCall } from "../external/audit.js";
import { completeInTx, planInTx } from "../repos/interventions.js";
import { listProposals, noteProposal, pendingProposal, readProposal, rejectProposal, submitProposal, type ProposalActor } from "../repos/proposals.js";
import { BadRequest, domainCtx, problem, uuidParam } from "./helpers.js";
import type { Context } from "hono";

/** Qui consulte : le responsable voit tout, un accès ou un membre ses propres dépôts. */
const actorOf = (c: Context<Env>): ProposalActor => ({ userId: c.get("userId"), accessId: c.get("principal").accessId, owner: c.get("role") === "owner" });

/**
 * Propositions (lot AM8, claudedocs/conception_api_mcp.md §8). Le dépôt et le
 * suivi sont ouverts aux accès externes (routes ouvertes, module
 * Interventions) ; l'acceptation et le refus sont réservés au responsable (B9).
 */
export const proposalRoutes = new Hono<Env>()
  .get("/proposals", async (c) => {
    const s = c.req.query("status");
    const status = s === undefined ? undefined : proposalStatus.safeParse(s);
    if (status && !status.success) throw new BadRequest("status : pending, accepted, rejected ou expired");
    return c.json(await listProposals(db(), c.get("farmId"), actorOf(c), status?.data));
  })
  .get("/proposals/:id", async (c) => c.json(await readProposal(db(), c.get("farmId"), actorOf(c), uuidParam(c, "id"))))
  .post("/proposals", async (c) => {
    const parsed = proposalWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const principal = c.get("principal");
    const channel = isMcpCall(c) ? "mcp" : principal.kind === "session" ? "web" : "api";
    const p = await submitProposal(db(), c.get("farmId"), { ...actorOf(c), channel }, parsed.data);
    c.set("written", { proposals: [p.id] });
    return c.json(p, 201);
  })
  /**
   * Acceptation telle quelle, ou corrigée (`payload`) : l'intervention est
   * enregistrée par le chemin habituel, contrôles, registre et stocks compris,
   * dans une seule transaction. Le web passe plutôt par le formulaire prérempli.
   */
  .post("/proposals/:id/accept", requireOwner, async (c) => {
    const parsed = proposalAccept.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const farmId = c.get("farmId");
    const proposalId = uuidParam(c, "id");
    const stored = await pendingProposal(db(), farmId, proposalId);
    const payload = parsed.data.payload ?? stored.payload;
    const ctx = domainCtx(c);
    const id = ctx.newId();
    const done = payload.periods.length > 0 || payload.crews.length > 0;
    const warnings = await withFarm(db(), farmId, async (tx) => {
      if (!done) return (await planInTx(tx, farmId, ctx, interventionPlanWrite.parse({ ...payload, id, proposal: proposalId }))).warnings;
      await planInTx(tx, farmId, ctx, interventionPlanWrite.parse({ id, procedure: payload.procedure, plannedAt: payload.periods[0]?.startedAt }));
      const { procedure: _procedure, plannedAt: _plannedAt, ...rest } = payload;
      return (await completeInTx(tx, farmId, ctx, id, interventionCompleteWrite.parse({ ...rest, proposal: proposalId }))).warnings;
    });
    if (parsed.data.note) await noteProposal(db(), farmId, proposalId, parsed.data.note);
    return c.json({ proposal: await readProposal(db(), farmId, actorOf(c), proposalId), interventionId: id, warnings });
  })
  .post("/proposals/:id/reject", requireOwner, async (c) => {
    const parsed = proposalReject.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await rejectProposal(db(), c.get("farmId"), actorOf(c), uuidParam(c, "id"), parsed.data.note));
  });
