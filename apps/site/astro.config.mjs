// Site public fourmy.org (docs/site-public-exigences.md). Statique, français
// d'abord (structure prête pour /en/). Version, changelog et fonctionnalités
// sont recalculés à chaque construction (src/lib/release.ts).
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://fourmy.org",
  trailingSlash: "always",
  output: "static",
  build: { format: "directory" },
  integrations: [sitemap({ filter: (page) => !page.includes("/contact/merci/") })],
  i18n: { locales: ["fr"], defaultLocale: "fr", routing: { prefixDefaultLocale: false } },
});
