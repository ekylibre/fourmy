import type { ImageMetadata } from "astro";

/** Captures de l'application (phase 4, `pnpm --filter @fourmy/site captures`), par nom. */
const files = import.meta.glob<{ default: ImageMetadata }>("../assets/captures/*.png", { eager: true });
export const captures = new Map(
  Object.entries(files).map(([path, mod]) => [path.split("/").pop()!.replace(/\.png$/, ""), mod.default]),
);
