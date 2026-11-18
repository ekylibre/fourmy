// Repérage : quelques images du rejeu, caméra en orbite autour du tracteur, pour choisir le plan.
import { mkdirSync, readFileSync } from "node:fs";
import { openReplay, settle } from "./session.mjs";
import { video } from "./videos.mjs";
const data = JSON.parse(readFileSync(new URL(`../assets/data/${video.donnees}.json`, import.meta.url), "utf8"));
const iso = (hm) => `${video.jour}T${hm.length > 5 ? hm : hm + ":00"}${video.fuseau}`;
const dir = new URL("../assets/repere/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const pad = (n) => String(n).padStart(2, "0");
const seq = process.env.FROM ? Array.from({ length: Number(process.env.N) }, (_, i) => { const s = Number(process.env.FROM) + i * Number(process.env.STEP); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; }) : null;
const times = seq ?? (process.env.TIMES ?? "16:28,16:33,16:38,16:42,16:47,16:55,17:05,17:15,17:25,17:35").split(",");
const { browser, page } = await openReplay(iso(times[0]), { jour: video.jour, equipment: data.tractor });
if (process.env.VEG === "0") await page.evaluate(() => globalThis.fourmyScene.setVegetation(null));
if (process.env.TINT === "0") await page.evaluate(() => globalThis.fourmyScene.setParcelStyle(null, 0));
const tag = process.env.TAG ?? "";
for (const hm of times) {
  await page.evaluate(({ iso, range, pitch, dh }) => {
    const s = globalThis.fourmyScene;
    s.play(false);
    s.cameraMode = "custom";
    s.seek(iso);
    const C = globalThis.Cesium ?? s.constructor.Cesium;
    const v = s.viewer;
    const veh = v.entities.getById("track:vehicle");
    const at = veh.position.getValue(v.clock.currentTime);
    const cap = s.trackHeading?.getValue(v.clock.currentTime) ?? 0;
    v.camera.lookAt(at, { heading: cap + dh, pitch, range });
  }, { iso: iso(hm), range: Number(process.env.RANGE ?? 120), pitch: Number(process.env.PITCH ?? -0.5), dh: Number(process.env.DH ?? 0.9) }).catch((e) => console.log(hm, e.message));
  await settle(page);
  await page.screenshot({ path: `${dir}${hm.replaceAll(":", "")}${tag}.jpg`, type: "jpeg", quality: 80 });
  console.log(hm);
}
await browser.close();
