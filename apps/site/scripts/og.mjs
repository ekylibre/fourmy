// Image de partage (Open Graph 1200 × 630) : logo Fourmy et accroche, sur le
// papier de la charte. `node scripts/og.mjs` → public/og.png.
import { readFileSync } from "node:fs";
import sharp from "sharp";

const logo = readFileSync(new URL("../../../packages/ui-lyvre/brand/fourmy-logo.svg", import.meta.url));
const width = 1200;
const height = 630;
const logoPng = await sharp(logo, { density: 600 }).resize({ width: 760 }).png().toBuffer();
const { height: logoHeight = 0 } = await sharp(logoPng).metadata();
const caption = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="140">
     <text x="${width / 2}" y="60" text-anchor="middle" font-family="IBM Plex Sans, DejaVu Sans, sans-serif"
           font-size="44" fill="#4E5A54">Le jumeau numérique de la ferme</text>
     <rect x="${width / 2 - 60}" y="100" width="120" height="8" rx="4" fill="#D9A441"/>
   </svg>`,
);
await sharp({ create: { width, height, channels: 4, background: "#F6F4EE" } })
  .composite([
    { input: logoPng, top: Math.round(height / 2 - logoHeight / 2 - 70), left: Math.round((width - 760) / 2) },
    { input: caption, top: Math.round(height / 2 + logoHeight / 2 - 30), left: 0 },
  ])
  .png()
  .toFile(new URL("../public/og.png", import.meta.url).pathname);
console.log("public/og.png écrit");
