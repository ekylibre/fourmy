import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { buildRelease, readGitHistory } from "@fourmy/release";

/**
 * /version.json en local (`vite` et `vite preview`) : même calcul que le site
 * public, depuis l'historique Git du dépôt. En production, le nginx de
 * l'application le relaie vers le site (docker/nginx.conf). Sans historique
 * (clone superficiel) : 404, la page affiche « Version de développement ».
 */
function versionJson(): Plugin {
  let body: string | null | undefined;
  const compute = () => {
    if (body !== undefined) return body;
    try {
      const release = buildRelease(readGitHistory(fileURLToPath(new URL("../..", import.meta.url))));
      body = JSON.stringify({ version: release.version, date: release.date });
    } catch {
      body = null;
    }
    return body;
  };
  // Ne rien renvoyer : une fonction renvoyée serait appelée par Vite comme crochet « après ».
  const serve = (server: { middlewares: { use: (path: string, fn: (req: unknown, res: import("node:http").ServerResponse) => void) => unknown } }): void => {
    server.middlewares.use("/version.json", (_req, res) => {
      const json = compute();
      res.statusCode = json ? 200 : 404;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-cache");
      res.end(json ?? "{}");
    });
  };
  return { name: "fourmy-version-json", configureServer: serve, configurePreviewServer: serve };
}

const API_TARGET = process.env.FOURMY_API_URL ?? "http://localhost:3000";
// /api, et la racine OAuth et MCP (lots AM5, AM6) : relayés vers l'API.
const API_PROXY = {
  "/api": { target: API_TARGET, changeOrigin: true },
  "^/\\.well-known/oauth-": { target: API_TARGET, changeOrigin: true },
  "^/mcp$": { target: API_TARGET, changeOrigin: true },
};
// En dev, /api est relayé vers l'API Fourmy (apps/api, port 3000).
export default defineConfig({
  plugins: [react(), versionJson()],
  // Le worker de MapLibre est un module ESM (new Worker(url, { type: "module" })).
  worker: { format: "es" },
  // Service worker (« Ma ferme » F5) : publié à la racine, sous un nom fixe
  // (/sw.js), pour couvrir toute l'application.
  build: {
    rollupOptions: {
      input: { main: "index.html", sw: "sw/sw.ts" },
      output: { entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js") },
    },
  },
  server: {
    port: 5173,
    proxy: API_PROXY,
  },
  preview: {
    port: 4173,
    proxy: API_PROXY,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: false,
    include: ["test/**/*.test.{ts,tsx}"],
    // Les machines de la CI sont plus lentes que les postes : les parcours de
    // formulaire longs (plan de fumure, modulation, entretien) dépassaient 5 s.
    testTimeout: 20_000,
  },
});
