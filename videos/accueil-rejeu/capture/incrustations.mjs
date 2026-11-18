// Incrustations du film : en haut à droite la fiche de l'intervention (pulvérisation : dose, IFT et
// météo avec leurs voyants ; autre intervention : météo, durée de travail, contrôle réglementaire) ;
// en bas à gauche la surface travaillée, la carte 2D de la parcelle et le matériel. Elles sont
// dessinées dans la page au-dessus de la scène 3D, donc présentes dans chaque image capturée, et
// suivent l'horloge du rejeu. Données : assets/data/<donnees>.json (capture/donnees.mjs).
import { readFileSync } from "node:fs";
import { instant, video } from "./videos.mjs";

const fonts = new URL("../../../apps/site/node_modules/@fontsource/", import.meta.url).pathname;
const font = (family, file, weight) =>
  `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(`${fonts}${file}`).toString("base64")}) format("woff2")}`;

const fr = (n, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Valeurs affichées, calculées depuis les données de l'application (rien n'est saisi à la main). */
export function lireDonnees(d) {
  const i = d.intervention;
  const eq = new Map(d.snapshot.equipments.map((e) => [e.id, e]));
  const parcels = new Map(d.snapshot.landParcels.map((p) => [p.id, p]));
  const w = i.weather;
  const work = d.track.sessions.find((s) => s.kind === "work");
  const samples = d.track.samples.filter((s) => s[0] >= work.from && s[0] <= work.to);
  const targets = i.targets.filter((t) => t.kind === "land_parcel");
  const tools = (i.crews[0]?.tools ?? i.tools).map((t) => eq.get(t.equipmentId)).sort((a) => (a.kind === "tractor" ? -1 : 1));
  // Largeur de travail : celle de la trace (outil attelé).
  const largeur = samples.find((s) => s[4])?.[4] ?? 0;
  const totalM2 = targets.reduce((s, t) => s + (t.workedAreaM2 ?? 0), 0);
  const shapes = targets.map((t) => parcels.get(t.id).version.shape);
  const lignes = [];
  if (i.procedure === "spraying") {
    const input = i.inputs[0];
    const check = d.compliance.checks.find((c) => c.articleId === input.articleId);
    const dose = check.indicators.find((x) => x.code === "dose");
    const max = /maximum ([\d,]+ ?[^.]+)/.exec(dose.message)?.[1];
    // Conditions de pulvérisation : seuils par défaut de la ferme (packages/domain/spraying-conditions.ts).
    const wind = w.windKmh <= 7.2 ? "ok" : w.windKmh < 18 ? "warning" : "danger";
    const band = (v, b) => (v >= b[0] && v <= b[1] ? "ok" : v > b[2] && v < b[3] ? "warning" : "danger");
    const order = ["ok", "warning", "danger"];
    const meteo = [wind, band(w.humidityPct, [75, 95, 50, 99]), band(w.temperatureC, [5, 25, 0, 30])].reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), "ok");
    const segments = [...new Set(i.ift.lines.map((l) => l.segment.toLowerCase()))].join(", ");
    // Nom commercial masqué sur le site public.
    const produit = process.env.PRODUIT ?? "Produit 1";
    lignes.push(
      { titre: "Dose", niveau: dose.level, valeur: `${produit} : ${fr(input.quantity, 2)} L/ha`, detail: `Dose maximale autorisée : ${max}` },
      { titre: "IFT", niveau: i.ift.status === "ok" ? "ok" : "warning", valeur: fr(i.ift.total, 2), detail: `IFT ${segments} de l'intervention` },
      { titre: "Météo", niveau: meteo, valeur: `${fr(w.temperatureC)} °C, vent ${fr(w.windKmh)} km/h`, detail: `Hygrométrie ${fr(w.humidityPct)} %, conditions ${MOT[meteo]}` },
    );
  } else {
    const heure = (iso) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(iso)).replace(":", " h ");
    const min = Math.round(i.workDurationS / 60);
    lignes.push(
      { titre: "Météo", valeur: `${fr(w.temperatureC)} °C, vent ${fr(w.windKmh)} km/h`, detail: `Hygrométrie ${fr(w.humidityPct)} %, ${w.precipitationMm ? `${fr(w.precipitationMm, 1)} mm de pluie` : "sans pluie"}` },
      { titre: "Durée de travail", valeur: `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`, detail: `De ${heure(i.startedAt)} à ${heure(i.stoppedAt)}` },
      { titre: "Contrôle réglementaire", niveau: d.compliance.level === "ok" ? "ok" : d.compliance.level === "danger" ? "danger" : "warning", valeur: d.compliance.level === "ok" ? "Conforme" : "À vérifier", detail: i.inputs.length ? "" : "Aucun produit appliqué" },
    );
  }
  const f = focus(targets.map((t) => parcels.get(t.id)), samples);
  return {
    titre: video.titre,
    date: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(i.startedAt)),
    lignes,
    couleur: video.couleur,
    participe: video.participe,
    materiel: tools.map((e) => e.name),
    outil: `${video.outil} de ${fr(largeur, Number.isInteger(largeur) ? 0 : 1)} m`,
    largeur,
    surfaceHa: fr(totalM2 / 10000, totalM2 < 10000 ? 2 : 1),
    chantier:
      targets.length > 1
        ? `Chantier de ${targets.length} parcelles de ${video.culture}`
        : `${video.culture[0].toUpperCase()}${video.culture.slice(1)}, ${fr(parcels.get(targets[0].id).version.areaM2 / 10000, 2)} ha`,
    parcelles: shapes,
    autres: d.snapshot.landParcels.filter((p) => !targets.some((t) => t.id === p.id)).map((p) => p.version.shape),
    ...couverture(samples, shapes, largeur),
    ...f,
  };
}

const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
const dedans = (pt, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    if (ring[i][1] > pt[1] !== ring[j][1] > pt[1] && pt[0] < ((ring[j][0] - ring[i][0]) * (pt[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  return c;
};
const dansForme = (pt, g) => polys(g).some((poly) => dedans(pt, poly[0]) && !poly.slice(1).some((h) => dedans(pt, h)));

/** Parcelle où travaille le tracteur pendant le film (milieu de la fenêtre filmée) : cadre de la carte. */
function focus(targets, samples) {
  const mid = instant(video.debut) + (video.secondes * 1000) / 2;
  const at = samples.reduce((a, b) => (Math.abs(Date.parse(b[0]) - mid) < Math.abs(Date.parse(a[0]) - mid) ? b : a));
  const p = targets.find((t) => dansForme([at[1], at[2]], t.version.shape)) ?? targets[0];
  const pts = polys(p.version.shape).flat(2);
  return {
    // Nom de lieu, sans la culture ni l'année (« Sarthou Maïs 2026 » → « Sarthou »).
    nomParcelle: p.name.replace(/ (Maïs|Prairie|Blé|Orge|Colza|Tournesol|Soja)\b.*$/, ""),
    cadre: [Math.min(...pts.map((c) => c[0])), Math.min(...pts.map((c) => c[1])), Math.max(...pts.map((c) => c[0])), Math.max(...pts.map((c) => c[1]))],
  };
}

/**
 * Trace du chantier et surface travaillée cumulée à chaque point : surface réellement couverte par
 * l'outil (disques de la largeur de travail le long des passes, outil ouvert), dans les parcelles de
 * l'intervention, sur une grille de 0,5 à 1 m. Les recouvrements ne comptent qu'une fois, comme
 * la surface travaillée de la fiche.
 */
function couverture(samples, shapes, largeur) {
  const trace = samples.map((s) => [Date.parse(s[0]), s[1], s[2], s[3] === true]);
  const lat0 = trace[0][2], lon0 = trace[0][1], k = Math.cos((lat0 * Math.PI) / 180);
  const xy = (lon, lat) => [(lon - lon0) * k * 111320, (lat - lat0) * 110540];
  const pts = shapes.flatMap((g) => polys(g).flat(2)).map((c) => xy(c[0], c[1]));
  const [x0, y0] = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
  const [x1, y1] = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const pas = (x1 - x0) * (y1 - y0) > 400000 ? 1 : 0.5;
  const nx = Math.ceil((x1 - x0) / pas) + 1, ny = Math.ceil((y1 - y0) / pas) + 1;
  // 1 : dans une parcelle de l'intervention ; 2 : déjà travaillé.
  const grille = new Uint8Array(nx * ny);
  const formes = shapes.map((g) => ({ type: "MultiPolygon", coordinates: polys(g).map((poly) => poly.map((r) => r.map((c) => xy(c[0], c[1])))) }));
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) if (formes.some((g) => dansForme([x0 + i * pas, y0 + j * pas], g))) grille[j * nx + i] = 1;
  const r = largeur / 2, rc = Math.ceil(r / pas);
  let n = 0;
  const cumHa = [0];
  for (let s = 1; s < trace.length; s++) {
    const a = trace[s - 1];
    if (a[3]) {
      const [ax, ay] = xy(a[1], a[2]), [bx, by] = xy(trace[s][1], trace[s][2]);
      const L = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.ceil(L / pas));
      for (let q = 0; q <= m; q++) {
        const cx = (ax + ((bx - ax) * q) / m - x0) / pas, cy = (ay + ((by - ay) * q) / m - y0) / pas;
        for (let dj = -rc; dj <= rc; dj++)
          for (let di = -rc; di <= rc; di++) {
            const i = Math.round(cx) + di, j = Math.round(cy) + dj;
            if (i < 0 || j < 0 || i >= nx || j >= ny || (i * pas - cx * pas) ** 2 + (j * pas - cy * pas) ** 2 > r * r) continue;
            if (grille[j * nx + i] === 1) (grille[j * nx + i] = 2), n++;
          }
      }
    }
    cumHa.push((n * pas * pas) / 10000);
  }
  return { trace, cumHa };
}

const LED = { ok: "#6FB08E", warning: "#D9A441", danger: "#E27D66" };
const MOT = { ok: "favorables", warning: "moyennes", danger: "défavorables" };

/** Installe les incrustations dans la page du rejeu et `globalThis.__incrustations(lon, lat, ms)`. */
export async function installer(page, v) {
  const css = [
    font("Plex", "ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", 400),
    font("Plex", "ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", 600),
    font("Bricolage", "bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2", 700),
    font("Bricolage", "bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2", 800),
  ].join("");
  await page.evaluate(
    ({ v, css, LED, MOT }) => {
      const style = document.createElement("style");
      style.textContent = `${css}
      .inc{position:fixed;z-index:2000;font-family:Plex,sans-serif;color:#1E2421;background:rgba(246,244,238,.94);
        border:1px solid rgba(30,36,33,.14);border-radius:22px;box-shadow:0 14px 40px rgba(14,18,16,.28);font-variant-numeric:tabular-nums}
      .inc-haut{top:40px;right:40px;width:470px;padding:26px 30px 22px}
      .inc-bas{left:40px;bottom:40px;width:470px;padding:20px 20px 22px}
      .inc h2{font:800 34px/1.05 Bricolage,sans-serif;letter-spacing:-.02em;margin:0}
      .inc .heure{font:600 22px/1.2 Plex;color:#4E5A54;margin-top:6px}
      .inc .heure b{color:#1E2421;font-weight:600}
      .inc dl{margin:18px 0 0;display:grid;grid-template-columns:auto 1fr;column-gap:16px;row-gap:16px;align-items:start}
      .inc dt{grid-column:1/-1;margin:0;font:600 17px/1 Plex;color:#4E5A54;margin-bottom:-10px}
      .inc dd{display:contents}
      .led{width:20px;height:20px;border-radius:50%;margin-top:7px;box-shadow:0 0 0 3px rgba(255,255,255,.7),0 0 14px 2px var(--c);
        background:radial-gradient(circle at 35% 35%,#fff8 0 18%,var(--c) 45%)}
      .val{font:600 27px/1.2 Plex}
      .val small{display:block;font:400 18px/1.3 Plex;color:#4E5A54;margin-top:2px}
      .compteur{margin:2px 6px 14px;font:400 18px/1.2 Plex;color:#4E5A54}
      .compteur b{font:800 38px/1 Bricolage,sans-serif;color:#1E2421;letter-spacing:-.01em;margin-right:8px}
      .barre{height:8px;border-radius:4px;background:#D5D9D3;margin-top:10px;overflow:hidden}.barre i{display:block;height:100%;background:${v.couleur}}
      .inc-bas{position:fixed}.carte-cadre{position:relative}
      .carte{display:block;width:430px;height:300px;border-radius:12px;background:#E9ECE6}
      .legende{margin:14px 6px 0;font:400 18px/1.3 Plex;color:#4E5A54}.legende span{display:block;margin-top:2px}
      .legende b{display:block;font:600 22px/1.2 Plex;color:#1E2421}
      .materiel{margin:14px 6px 0;padding-top:14px;border-top:1px solid rgba(30,36,33,.14);font:600 22px/1.3 Plex}
      .materiel small{display:block;font:400 18px/1.3 Plex;color:#4E5A54}`;
      document.head.append(style);
      const led = (n) => `<span class="led" style="--c:${LED[n]}"></span>`;
      const haut = document.createElement("section");
      haut.className = "inc inc-haut";
      haut.innerHTML = `<h2>${v.titre}</h2><div class="heure">${v.date}, <b data-heure></b></div>
        <dl>${v.lignes
          .map((l) => `<dt>${l.titre}</dt><dd>${l.niveau ? led(l.niveau) : "<span></span>"}<div class="val">${l.valeur}${l.detail ? `<small>${l.detail}</small>` : ""}</div></dd>`)
          .join("")}</dl>`;
      // Carte 2D, nord en haut : parcelles traitées, trace parcourue (violet de la bande) et à venir.
      const lat0 = v.trace[0][2], k = Math.cos((lat0 * Math.PI) / 180);
      const [cx0, cy0, cx1, cy1] = v.cadre;
      const [x0, x1, y0, y1] = [cx0 * k, cx1 * k, cy0, cy1];
      const W = 430, H = 300, pad = 34, s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0));
      const ox = (W - s * (x1 - x0)) / 2, oy = (H - s * (y1 - y0)) / 2;
      const P = (lon, lat) => [ox + (lon * k - x0) * s, oy + (y1 - lat) * s];
      const ring = (r) => "M" + r.map((c) => P(c[0], c[1]).map((n) => n.toFixed(1)).join(",")).join("L") + "Z";
      const path = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((poly) => poly.map(ring).join("")).join("");
      const line = (arr) => arr.map((c, i) => (i ? "L" : "M") + P(c[0], c[1]).map((n) => n.toFixed(1)).join(",")).join("");
      // Échelle : 100, 50 ou 20 m, au plus un tiers de la carte.
      const metres = [100, 50, 20].find((m) => s * (m / 111320) <= W / 3) ?? 20;
      const m100 = s * (metres / 111320);
      const bas = document.createElement("section");
      bas.className = "inc inc-bas";
      bas.innerHTML = `<div class="compteur"><b data-ha></b>${v.participe} sur ${v.surfaceHa} ha<div class="barre"><i data-barre></i></div></div><div class="carte-cadre"><svg class="carte" viewBox="0 0 ${W} ${H}"><clipPath id="cadre"><rect width="${W}" height="${H}" rx="12"/></clipPath><g clip-path="url(#cadre)">
          <path d="${v.autres.map(path).join("")}" fill="#F6F4EE" stroke="#BCC4BE" stroke-width="1"/>
          <path d="${v.parcelles.map(path).join("")}" fill="#DDE8DF" stroke="#2F6B4F" stroke-width="2"/>
          <path data-route fill="none" stroke="#4E5A54" stroke-width="2" stroke-linejoin="round"/>
          <path data-fait fill="none" stroke="${v.couleur}" stroke-opacity=".85" stroke-width="${Math.max(2, s * (v.largeur / 111320)).toFixed(1)}" stroke-linejoin="round" stroke-linecap="butt"/>
          </g><circle data-tracteur r="9" fill="#1E2421" stroke="#fff" stroke-width="3"/>
          <g transform="translate(${W - 18 - m100},${H - 16})"><path d="M0,-6V0H${m100.toFixed(1)}V-6" fill="none" stroke="#4E5A54" stroke-width="2"/><text x="${(m100 / 2).toFixed(1)}" y="-10" text-anchor="middle" font-size="15" fill="#4E5A54" font-family="Plex">${metres} m</text></g>
          <text x="${W - 18}" y="30" text-anchor="end" font-size="16" font-weight="600" fill="#4E5A54" font-family="Plex">N ↑</text>
        </svg></div>
        <div class="legende"><b>Parcelle ${v.nomParcelle}</b><span>${v.chantier}</span></div>
        <div class="materiel">${v.materiel.join(" + ")}<small>${v.outil}</small></div>`;
      document.body.append(haut, bas);
      const heure = haut.querySelector("[data-heure]");
      const fait = bas.querySelector("[data-fait]");
      const route = bas.querySelector("[data-route]");
      const ha = bas.querySelector("[data-ha]");
      const barre = bas.querySelector("[data-barre]");
      const total = Number(v.surfaceHa.replace(",", "."));
      const tracteur = bas.querySelector("[data-tracteur]");
      const fmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
      globalThis.__incrustations = (lon, lat, ms) => {
        heure.textContent = fmt.format(ms).replace(":", " h ");
        // Passes travaillées en bandes de la largeur de l'outil, trajets outil fermé en trait fin.
        const done = v.trace.filter((t) => t[0] <= ms);
        const seg = (on) => {
          let d = "";
          for (let i = 0; i < done.length; i++) {
            if (done[i][3] !== on) continue;
            const b = i + 1 < done.length ? [done[i + 1][1], done[i + 1][2]] : [lon, lat];
            d += line([[done[i][1], done[i][2]], b]);
          }
          return d;
        };
        fait.setAttribute("d", seg(true));
        // Surface travaillée : cumul au dernier point passé, interpolé jusqu'au point suivant.
        const i = done.length - 1;
        const next = v.trace[i + 1];
        const surf = i < 0 ? 0 : next ? v.cumHa[i] + ((v.cumHa[i + 1] - v.cumHa[i]) * (ms - done[i][0])) / (next[0] - done[i][0]) : v.cumHa[i];
        ha.textContent = `${surf.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
        barre.style.width = `${Math.min(100, (100 * surf) / total).toFixed(1)}%`;
        route.setAttribute("d", seg(false));
        const [x, y] = P(lon, lat);
        tracteur.setAttribute("cx", x.toFixed(1));
        tracteur.setAttribute("cy", y.toFixed(1));
      };
    },
    { v, css, LED, MOT },
  );
}

/** Met à jour l'heure, la trace parcourue et la position du tracteur à l'instant courant du rejeu. */
export async function mettreAJour(page) {
  await page.evaluate(() => {
    const v = globalThis.fourmyScene.viewer;
    const time = v.clock.currentTime;
    const pos = v.entities.getById("track:vehicle").position.getValue(time);
    const carto = v.scene.globe.ellipsoid.cartesianToCartographic(pos);
    globalThis.__incrustations((carto.longitude * 180) / Math.PI, (carto.latitude * 180) / Math.PI, Date.parse(time.toString()));
  });
}
