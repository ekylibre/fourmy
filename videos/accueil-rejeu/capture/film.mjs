// Boucle du haut de page : rejeu 3D d'une intervention (capture/videos.mjs), filmé image par image
// (horloge Cesium pilotée), caméra de poursuite lissée, incrustations de la fiche.
//   VIDEO=broyage node capture/film.mjs     (FROM, SECONDS, FPS, DURATION, RANGE… pour ajuster)
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { openReplay, settle } from "./session.mjs";
import { installer, lireDonnees, mettreAJour } from "./incrustations.mjs";
import { instant, video } from "./videos.mjs";
const incrust = process.env.INCRUST !== "0";
const dir = new URL(`../assets/raw/${process.env.SHOT ?? video.sortie}/`, import.meta.url).pathname;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const data = JSON.parse(readFileSync(new URL(`../assets/data/${video.donnees}.json`, import.meta.url), "utf8"));
const from = instant(video.debut);
const replaySeconds = video.secondes;
const fps = Number(process.env.FPS ?? 30);
const frames = Math.round(Number(process.env.DURATION ?? 20) * fps);
const cam = video.camera;

const { browser, page } = await openReplay(new Date(from).toISOString(), { jour: video.jour, equipment: data.tractor });
await page.waitForFunction(() => globalThis.fourmyScene.swathModel?.customShader, null, { timeout: 120000 });
await page.evaluate(({ since }) => {
  const s = globalThis.fourmyScene;
  s.play(false);
  s.cameraMode = "custom";
  s.setVegetation(null);
  s.setParcelStyle(null, 0);
  // Ni la trace de la journée ni le tracé parcouru : la bande violette suffit.
  if (s.trackLines) s.trackLines.show = false;
  for (const e of s.viewer.entities.values) if (e.id.startsWith("track:done:")) e.show = false;
  // Bande de l'intervention seulement (pas les passes d'une autre intervention le même jour).
  const m = s.swathModel;
  const old = m.customShader;
  const t0 = Date.parse(s.viewer.clock.currentTime.toString()) - old.uniforms.u_now.value * 1000;
  const C = old.constructor;
  const shader = new C({
    uniforms: { u_now: { type: old.uniforms.u_now.type, value: -1 }, u_min: { type: old.uniforms.u_now.type, value: (since - t0) / 1000 } },
    translucencyMode: old.translucencyMode,
    lightingModel: old.lightingModel,
    fragmentShaderText: old.fragmentShaderText.replace("if (fsInput.attributes.time > u_now) discard;", "if (fsInput.attributes.time > u_now || fsInput.attributes.time < u_min) discard;"),
  });
  m.customShader = shader;
  s.viewer.scene.preRender.addEventListener(() => shader.setUniform("u_now", (Date.parse(s.viewer.clock.currentTime.toString()) - t0) / 1000));
}, { since: Date.parse(data.intervention.startedAt) });

if (incrust) await installer(page, lireDonnees(data));

const t0 = Date.now();
let heading = null;
for (let i = 0; i < frames; i++) {
  const at = new Date(from + (i / frames) * replaySeconds * 1000).toISOString();
  await page.evaluate(({ at, cam, k, first }) => {
    const s = globalThis.fourmyScene;
    const v = s.viewer;
    s.seek(at);
    const time = v.clock.currentTime;
    const pos = v.entities.getById("track:vehicle").position.getValue(time);
    const cap = ((s.trackHeading?.getValue(time) ?? 0) * Math.PI) / 180; // cap du rejeu en degrés
    // Cap lissé (un demi-tour ne fait pas tourner la caméra d'un coup).
    const prev = globalThis.__camHeading ?? cap;
    let d = cap - prev;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    // Constante de temps d'environ 12 s de rejeu, quel que soit le nombre d'images.
    const h = first ? cap : prev + d * Math.min(1, cam.step / 12);
    globalThis.__camHeading = h;
    v.camera.lookAt(pos, { heading: h + cam.dh + cam.orbit * (k - 0.5), pitch: cam.pitch, range: cam.range });
  }, { at, cam: { ...cam, step: replaySeconds / frames }, k: i / frames, first: i === 0 });
  if (incrust) await mettreAJour(page);
  await settle(page, 15000);
  await page.screenshot({ path: `${dir}f${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92 });
  if (i % 60 === 0) console.log(`image ${i}/${frames}`, ((Date.now() - t0) / 1000).toFixed(0), "s");
}
await browser.close();
console.log("fini", dir);
