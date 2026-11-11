import { defineConfig } from "vitest/config";

/**
 * Tests d'intégration contre une vraie base : chaque fichier ouvre ses pools
 * (API : 10 connexions, better-auth : 5). Sans limite, vitest lance un
 * processus par cœur et dépasse les 100 connexions de PostgreSQL
 * (« sorry, too many clients already ») sur une machine à 32 cœurs.
 */
export default defineConfig({
  test: { maxWorkers: 4, minWorkers: 1 },
});
