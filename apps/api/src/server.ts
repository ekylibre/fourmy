import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { createApp } from "./app.js";
import { db } from "./db.js";

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: createApp().fetch, port }, (info) =>
  console.log(`Fourmy API sur http://localhost:${info.port}`),
);

// Le référentiel Lexicon (productions de référence, images, E-Phy, taxonomie)
// n'est chargé que par le worker ou `fourmy-lexicon-sync` : le signaler s'il
// manque, sinon activités sans image, références « inconnues », contrôle phyto faux.
db()
  .execute(sql`SELECT name FROM lexicon_packages`)
  .then((r) => {
    const loaded = new Set((r as unknown as { name: string }[]).map((x) => x.name));
    const missing = ["phytosanitary", "taxonomy", "productions", "agricultural_pictures"].filter((n) => !loaded.has(n));
    if (missing.length > 0) {
      console.warn(
        `⚠ Référentiel Lexicon non chargé (${missing.join(", ")}) : lancer le worker ou \`corepack pnpm --filter @fourmy/lexicon sync\`.`,
      );
    }
  })
  .catch((e: unknown) => console.warn(`⚠ Référentiel Lexicon : vérification impossible (${e instanceof Error ? e.message : String(e)}).`));
