import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, /api est relayé vers l'API Fourmy (apps/api, port 3000).
export default defineConfig({
  plugins: [react()],
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
    proxy: { "/api": { target: process.env.FOURMY_API_URL ?? "http://localhost:3000", changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: process.env.FOURMY_API_URL ?? "http://localhost:3000", changeOrigin: true } },
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
