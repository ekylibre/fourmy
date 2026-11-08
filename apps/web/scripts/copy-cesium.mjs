// Copie les fichiers statiques de Cesium (workers, textures, widgets) dans
// public/cesium, servis à l'URL CESIUM_BASE_URL. Lancé avant dev et build.
//
// Rien n'est réécrit si la même version est déjà copiée : un build lancé
// pendant que le serveur de développement tourne ne doit pas remplacer les
// workers qu'un navigateur est en train de charger (mélange d'anciens et de
// nouveaux morceaux → « d is not a function » dans createGeometry.js).
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cesiumRoot = dirname(require.resolve("cesium/package.json"));
const { version } = JSON.parse(await readFile(join(cesiumRoot, "package.json"), "utf8"));
const source = join(cesiumRoot, "Build", "Cesium");
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "cesium");
const marker = join(target, "VERSION");

const current = await readFile(marker, "utf8").catch(() => "");
if (current.trim() === version) {
  console.log(`Cesium ${version} : fichiers statiques déjà en place`);
} else {
  // Copie dans un dossier temporaire, puis remplacement d'un bloc.
  const staging = `${target}.tmp-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const dir of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
    await cp(join(source, dir), join(staging, dir), { recursive: true });
  }
  await writeFile(join(staging, "VERSION"), `${version}\n`);
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  console.log(`Cesium ${version} : fichiers statiques copiés dans ${target}`);
}
