import { defineConfig, devices } from "@playwright/test";

/**
 * Parcours de bout en bout contre la vraie API et une vraie base.
 * Prérequis : API (port 3000) et application (`vite preview`, port 4173)
 * démarrées, DATABASE_URL pointant la même base que l'API.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Un seul navigateur : les parcours partagent la ferme pilote en base, et le
  // rendu WebGL logiciel (cartes, plan 3D) cale quand plusieurs tournent ensemble.
  workers: 1,
  // En CI, une relance : les parcours dépendent de services de l'IGN qui hoquettent
  // (tuiles 400 passagères) et d'un rendu WebGL logiciel lent.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    locale: "fr-FR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        // WebGL logiciel (SwiftShader) : le plan 3D Cesium tourne sans GPU, en CI.
        launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
    // Firefox (E2E_FIREFOX=1, sur un poste avec carte graphique) : le plan 3D seulement.
    // Pas en CI : sans GPU, Firefox n'y a pas de WebGL et le plan 3D affiche son repli.
    ...(process.env.E2E_FIREFOX ? [{
      // Firefox : le plan 3D seulement. Les lignes drapées de Cesium y arrêtaient la vue
      // (« d is not a function ») ; on vérifie que le rendu tient. `npx playwright install firefox`.
      name: "firefox",
      testMatch: /plan3d\.spec\.ts/,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true } },
      },
    }] : []),
  ],
});
