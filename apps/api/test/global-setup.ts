import { rm } from "node:fs/promises";

/** Supprime le dossier de cache IGN propre à ce lancement (vitest.config.ts). */
export default function setup() {
  return async () => {
    const dir = process.env.FOURMY_IGN_CACHE_DIR;
    if (dir?.includes("fourmy-ign-test-")) await rm(dir, { recursive: true, force: true });
  };
}
