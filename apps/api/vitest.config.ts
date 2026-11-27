import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Cache des tuiles IGN (« Ma ferme », F4) : un dossier neuf par lancement,
// supprimé à la fin (test/global-setup.ts). Sans cela, une tuile écrite par
// un test précédent (faux IGN) serait relue au lieu d'être demandée.
const ignCacheDir = mkdtempSync(join(tmpdir(), "fourmy-ign-test-"));
process.env.FOURMY_IGN_CACHE_DIR = ignCacheDir;

/**
 * Tests d'intégration contre une vraie base : chaque fichier ouvre ses pools
 * (API : 10 connexions, better-auth : 5). Sans limite, vitest lance un
 * processus par cœur et dépasse les 100 connexions de PostgreSQL
 * (« sorry, too many clients already ») sur une machine à 32 cœurs.
 */
/**
 * Délais : en CI, les tests web (jsdom) tournent en même temps que ceux-ci,
 * et l'import d'un fichier Geofolia écrit plusieurs centaines d'interventions
 * dans une transaction ; les délais par défaut (5 s par test, 10 s par
 * préparation) faisaient échouer des tests sans rapport, par simple lenteur.
 */
export default defineConfig({
  test: {
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { FOURMY_IGN_CACHE_DIR: ignCacheDir },
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/no-carto.ts"],
  },
});
