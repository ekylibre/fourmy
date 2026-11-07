// Copie les fichiers statiques de Cesium (workers, textures, widgets) dans
// public/cesium, servis à l'URL CESIUM_BASE_URL. Lancé avant dev et build.
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cesiumRoot = dirname(require.resolve("cesium/package.json"));
const source = join(cesiumRoot, "Build", "Cesium");
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "cesium");
await mkdir(target, { recursive: true });
for (const dir of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
  await cp(join(source, dir), join(target, dir), { recursive: true });
}
console.log(`Cesium : fichiers statiques copiés dans ${target}`);
