import { Hono, type Context } from "hono";
import { withFarm } from "@fourmy/db";
import { itkWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { StaleItk, copyItk, createItk, deleteItk, getItk, listItks, updateItk } from "../repos/technical-itineraries.js";
import { domainCtx, problem, uuidParam } from "./helpers.js";

/**
 * Itinéraires techniques de la ferme (lot IT1, claudedocs/conception_assolement_itk.md §10) :
 * lecture pour les membres, écriture pour le responsable (NFR-AS-5).
 */

/** 409 avec l'ITK du serveur, que l'éditeur propose de recharger. */
async function guard<T>(c: Context<Env>, run: () => Promise<T>, status: 200 | 201 = 200) {
  try {
    return c.json(await run(), status);
  } catch (err) {
    if (err instanceof StaleItk) return c.json({ title: "Conflit", detail: err.message, current: err.current }, 409);
    throw err;
  }
}

const body = async (c: Context<Env>) => itkWrite.safeParse(await c.req.json().catch(() => null));
const issues = (e: { issues: { message: string }[] }) => e.issues.map((i) => i.message).join(" ");

export const technicalItineraryRoutes = new Hono<Env>()
  .get("/technical-itineraries", async (c) => {
    const activityId = c.req.query("activityId") ? uuidParam(c, "activityId", "query") : undefined;
    const active = c.req.query("active");
    const items = await withFarm(db(), c.get("farmId"), (tx) =>
      listItks(tx, { activityId, active: active === undefined ? undefined : active === "true" }),
    );
    return c.json({ items });
  })
  .get("/technical-itineraries/:id", async (c) => {
    const id = uuidParam(c, "id");
    return c.json(await withFarm(db(), c.get("farmId"), (tx) => getItk(tx, id)));
  })
  .post("/technical-itineraries", requireOwner, async (c) => {
    const parsed = await body(c);
    if (!parsed.success) return problem(c, 400, "Corps invalide", issues(parsed.error));
    const id = parsed.data.id ?? domainCtx(c).newId();
    return guard(c, () => withFarm(db(), c.get("farmId"), (tx) => createItk(tx, c.get("farmId"), id, parsed.data, c.get("userId"))), 201);
  })
  .put("/technical-itineraries/:id", requireOwner, async (c) => {
    const id = uuidParam(c, "id");
    const parsed = await body(c);
    if (!parsed.success) return problem(c, 400, "Corps invalide", issues(parsed.error));
    return guard(c, () => withFarm(db(), c.get("farmId"), (tx) => updateItk(tx, id, parsed.data, c.get("userId"))));
  })
  .post("/technical-itineraries/:id/copy", requireOwner, async (c) => {
    const id = uuidParam(c, "id");
    const newId = domainCtx(c).newId();
    return c.json(await withFarm(db(), c.get("farmId"), (tx) => copyItk(tx, c.get("farmId"), id, newId, c.get("userId"))), 201);
  })
  .delete("/technical-itineraries/:id", requireOwner, async (c) => {
    const id = uuidParam(c, "id");
    return c.json(await withFarm(db(), c.get("farmId"), (tx) => deleteItk(tx, id, c.get("userId"))));
  });
