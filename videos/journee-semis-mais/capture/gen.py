#!/usr/bin/env python3
"""Écrit index.html et compositions/*.html du film « Aujourd'hui, je sème mon maïs ».

Les fichiers produits sont du HTML ordinaire, modifiable à la main ou dans
l'application HyperFrames ; ce script ne sert qu'à poser le premier montage.
Coordonnées des cadrages : pixels CSS de la page capturée (1920 de large).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMP = ROOT / "compositions"
COMP.mkdir(exist_ok=True)

GSAP = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>'

FONTS = """
    @font-face { font-family: "Bricolage Grotesque"; font-weight: 700; src: url("assets/fonts/bricolage-grotesque-latin-700-normal.woff2") format("woff2"); }
    @font-face { font-family: "Bricolage Grotesque"; font-weight: 800; src: url("assets/fonts/bricolage-grotesque-latin-800-normal.woff2") format("woff2"); }
    @font-face { font-family: "IBM Plex Sans"; font-weight: 400; src: url("assets/fonts/ibm-plex-sans-latin-400-normal.woff2") format("woff2"); }
    @font-face { font-family: "IBM Plex Sans"; font-weight: 600; src: url("assets/fonts/ibm-plex-sans-latin-600-normal.woff2") format("woff2"); }
"""

TOKENS = """
      --paper: #F6F4EE; --ink: #1E2421; --muted: #4E5A54; --lichen: #2F6B4F; --lichen-strong: #1E4A36;
      --paille: #D9A441; --paille-ink: #6B4A0E; --paille-tint: #F6E7C3;
"""

# Cadre d'écran : 1680 × 840 en (120, 64).
FW, FH = 1680, 840

COMMON_JS = """
      const FW = %d, FH = %d;
      // Cadrage : le point (cx, cy) de la page capturée au centre du cadre, à l'échelle s.
      const at = (cx, cy, s) => ({ x: FW / 2 - cx * s, y: FH / 2 - cy * s, scale: s });
      // Position dans le cadre d'un point de la page, pour un cadrage donné.
      const pt = (f, px, py) => ({ x: f.x + px * f.scale, y: f.y + py * f.scale });
      const wipe = (tl, sel, t) => tl.fromTo(sel, { clipPath: "inset(0 100%% 0 0)" }, { clipPath: "inset(0 0%% 0 0)", duration: 0.47, ease: "power3.out" }, t);
""" % (FW, FH)


def scene(sid, duration, css, body, js):
    return f"""<template>
  <style>
{FONTS}
    #{sid} {{
{TOKENS}
      position: absolute; inset: 0; background: var(--paper); overflow: hidden;
      font-family: "IBM Plex Sans", sans-serif; color: var(--ink);
    }}
    #{sid} .frame {{
      position: absolute; left: 120px; top: 64px; width: {FW}px; height: {FH}px; border-radius: 18px;
      background: #fff; overflow: hidden; box-shadow: 0 8px 24px rgba(30, 36, 33, 0.12);
    }}
    #{sid} .shot {{ position: absolute; inset: 0; }}
    #{sid} .shot img {{ position: absolute; left: 0; top: 0; transform-origin: 0 0; }}
    #{sid} .say {{ position: absolute; left: 120px; top: 942px; width: 1680px; }}
    #{sid} .say span {{
      display: block; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: 44px;
      line-height: 1.15; letter-spacing: -0.01em;
    }}
    #{sid} .cursor {{ position: absolute; left: 0; top: 0; width: 34px; height: 34px; z-index: 5; transform-origin: 4px 3px; }}
{css}
  </style>
  <div id="{sid}" data-composition-id="{sid}" data-width="1920" data-height="1080">
{body}
  </div>
  <script>
    (() => {{
      const tl = gsap.timeline({{ paused: true }});
{COMMON_JS}
{js}
      window.__timelines["{sid}"] = tl;
    }})();
  </script>
</template>
"""


CURSOR = '<svg class="cursor" id="{id}" viewBox="0 0 24 24"><path d="M4 3 L4 19 L8.5 15 L11.5 21.5 L14.5 20.2 L11.6 13.8 L17.5 13.6 Z" fill="#1E2421" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'


def title(sid, duration, hour, lines, accent_last=False, at_zero=False):
    spans = "\n".join(
        f'      <div class="line clip" id="{sid}-l{i}" data-start="{0.35 + 0.45 * i:.2f}" data-duration="{duration - 0.35 - 0.45 * i:.2f}"><span{" class=\"accent\"" if accent_last and i == len(lines) - 1 else ""}>{t}</span></div>'
        for i, t in enumerate(lines)
    )
    hour_html = (
        f'      <div class="hour clip" id="{sid}-h" data-start="0.1" data-duration="{duration - 0.1:.2f}"><span>{hour}</span></div>\n'
        if hour
        else ""
    )
    css = f"""
    #{sid} .block {{ position: absolute; left: 160px; top: 50%; transform: translateY(-50%); width: 1600px; }}
    #{sid} .hour span {{ display: block; font-weight: 600; font-size: 56px; color: var(--paille-ink); font-variant-numeric: tabular-nums; margin-bottom: 18px; }}
    #{sid} .line span {{ display: block; font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 120px; line-height: 1.04; letter-spacing: -0.02em; }}
    #{sid} .line span.accent {{ color: var(--lichen); }}
    #{sid} .hour, #{sid} .line {{ position: relative; }}
"""
    body = f'    <div class="block" data-hold="true">\n{hour_html}{spans}\n    </div>'
    if at_zero:  # vignette : l'heure et la première ligne sont là dès l'image 0
        body = body.replace(f'id="{sid}-h" data-start="0.1" data-duration="{duration - 0.1:.2f}"', f'id="{sid}-h" data-start="0" data-duration="{duration}"')
        body = body.replace(f'id="{sid}-l0" data-start="0.35" data-duration="{duration - 0.35:.2f}"', f'id="{sid}-l0" data-start="0" data-duration="{duration}"')
    js = ""
    if hour and not at_zero:
        js += f'      wipe(tl, "#{sid}-h span", 0.1);\n'
    for i in range(1 if at_zero else 0, len(lines)):
        js += f'      wipe(tl, "#{sid}-l{i} span", {0.35 + 0.45 * i:.2f});\n'
    js += f"      tl.set({{}}, {{}}, {duration});\n"
    return scene(sid, duration, css, body, js)


def screens(sid, duration, shots, says, clicks=(), extra_css="", extra_body="", extra_js=""):
    """shots : (id, image, largeur CSS, début, durée, cadrage initial, [(t, cadrage)]).
    says : (début, durée, texte). clicks : (shot id, t arrivée, (px, py), depuis (px, py))."""
    body, js = ['    <div class="frame">'], []
    for sh in shots:
        shid, img, w, t0, d, f0, moves = sh[:7]
        hold = len(sh) > 7 and sh[7] == "hold"
        clicked = any(c[0] == shid for c in clicks)
        body.append(
            f'      <div class="shot clip" id="{sid}-{shid}" data-start="{t0}" data-duration="{d}"{" data-hold=\"true\"" if hold else ""}><img id="{sid}-{shid}-img" src="{img}" width="{w}" alt="" /></div>'
        )
        js.append(f'      const {shid} = at{f0}; tl.set("#{sid}-{shid}-img", {shid}, 0);')
        last, end = f0, t0
        for t, f, dur in moves:
            js.append(f'      tl.to("#{sid}-{shid}-img", {{ ...at{f}, duration: {dur}, ease: "power2.inOut" }}, {t});')
            last, end = f, t + dur
        if not hold and not clicked and t0 + d - end > 1.5:
            js.append(f'      tl.to("#{sid}-{shid}-img", {{ ...at({last[0]}, {last[1]}, {last[2]} * 1.035), duration: {t0 + d - end:.2f}, ease: "none" }}, {end:.2f});')
    for k, (shid, t, p, frm) in enumerate(clicks):
        cid = f"{sid}-c{k}"
        shot = next(s for s in shots if s[0] == shid)
        # le pointeur vit dans le plan qui le montre
        last = shot[5]
        for mt, f, dur in shot[6]:
            if mt + dur <= t:
                last = f
        body.append(
            f'      <div class="shot clip" id="{cid}-w" data-start="{max(shot[3], t - 1.2):.2f}" data-duration="{min(shot[3] + shot[4], t + 0.9) - max(shot[3], t - 1.2):.2f}" style="z-index:6">{CURSOR.format(id=cid)}</div>'
        )
        js.append(
            f"      {{ const f = at{last}; const a = pt(f, {frm[0]}, {frm[1]}), b = pt(f, {p[0]}, {p[1]});\n"
            f'        tl.fromTo("#{cid}", {{ x: a.x, y: a.y, scale: 1 }}, {{ x: b.x, y: b.y, duration: 0.6, ease: "power2.out" }}, {t - 0.75:.2f});\n'
            f'        tl.to("#{cid}", {{ scale: 0.85, duration: 0.13, ease: "power1.in" }}, {t:.2f}).to("#{cid}", {{ scale: 1, duration: 0.17, ease: "power1.out" }}, {t + 0.13:.2f}); }}'
        )
    body.append(extra_body)
    body.append("    </div>")
    for k, (t, d, text) in enumerate(says):
        body.append(f'    <div class="say clip" id="{sid}-s{k}" data-start="{t}" data-duration="{d}"><span>{text}</span></div>')
        js.append(f'      wipe(tl, "#{sid}-s{k} span", {t + 0.05:.2f});')
    js.append(extra_js)
    js.append(f"      tl.set({{}}, {{}}, {duration});")
    return scene(sid, duration, extra_css, "\n".join(body), "\n".join(js))


S = "assets/screens/"
FULL = (960, 540, 0.875)

scenes = []  # (id, début, durée, html)


def add(sid, start, dur, html):
    (COMP / f"{sid}.html").write_text(html)
    scenes.append((sid, start, dur))


add("matin", 0, 4.5, title("matin", 4.5, "7 h 10", ["Aujourd'hui,", "je sème mon maïs."], at_zero=True))

add(
    "plan",
    4.5,
    15,
    screens(
        "plan",
        15,
        [
            ("a", S + "01-plan-haut.png", 1920, 0, 5, FULL, [(0.4, (760, 520, 1.45), 1.2)]),
            ("b", S + "01-plan-meteo.png", 1920, 5, 5, (820, 780, 1.55), [(7.3, (1370, 700, 1.55), 1.0), (8.6, (900, 790, 1.45), 0.7)]),
            ("c", S + "01-fiche-planifiee.png", 1920, 10, 5, FULL, [(10.4, (620, 420, 1.35), 1.2)]),
        ],
        [
            (0.3, 4.6, "Je prépare le semis : tracteur, semoir, semences, starter."),
            (5.2, 4.75, "Météo et contrôles : 24 kg d'azote sur les 243 du plan."),
            (10.1, 4.85, "C'est planifié pour 8 h."),
        ],
        clicks=[("b", 9.6, (740, 1022), (900, 900))],
    ),
)

add("depart", 19.5, 3.5, title("depart", 3.5, "9 h 15", ["Je pars semer", "Lespourcy."]))

champ_css = """
    #champ video { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; object-fit: cover; }
    #champ .band { position: absolute; left: 0; right: 0; bottom: 0; height: 150px; background: var(--paper); }
    #champ .say { top: 950px; }
    #champ .credit { position: absolute; right: 120px; top: 1002px; font-size: 28px; color: var(--muted); }
"""
champ_body = """    <video id="champ-v1" class="clip" src="assets/video/3d-arrivee.mp4" data-start="0" data-duration="5" muted playsinline></video>
    <video id="champ-v2" class="clip" src="assets/video/3d-champ.mp4" data-start="5" data-duration="6" data-media-start="0" muted playsinline></video>
    <div class="band"></div>
    <div class="say clip" id="champ-s0" data-start="0.3" data-duration="10.7"><span>7,84 ha, deux heures et demie de semoir.</span></div>
    <div class="credit clip" id="champ-cr" data-start="0" data-duration="11">Rejeu GPS dans le plan 3D de Fourmy</div>"""
add(
    "champ",
    23,
    11,
    scene(
        "champ",
        11,
        champ_css,
        champ_body,
        '      wipe(tl, "#champ-s0 span", 0.35);\n      tl.set({}, {}, 11);',
    ),
)

add("retour", 34, 3.5, title("retour", 3.5, "18 h 30", ["Au bureau,", "la trace m'attend."]))

add(
    "bureau",
    37.5,
    16,
    screens(
        "bureau",
        16,
        [
            ("a", S + "03-parcours-carte.png", 1920, 0, 5, FULL, [(0.3, (1100, 520, 1.12), 1.2)]),
            ("b", S + "03-choix-intervention.png", 1920, 5, 4, (960, 240, 1.75), []),
            ("c", S + "04-realiser-form.png", 1920, 9, 3.6, (700, 580, 1.7), []),
            ("d", S + "04-realiser-bas.png", 1920, 12.6, 3.4, (760, 800, 1.5), []),
        ],
        [
            (0.3, 4.6, "La trace est là : Lespourcy, 8,45 ha semés."),
            (5.1, 3.85, "Je l'ajoute au semis prévu ce matin."),
            (9.1, 3.45, "Les heures viennent du GPS : 9 h 15 – 11 h 47."),
            (12.7, 3.25, "Je passe le semis en réalisé."),
        ],
        clicks=[
            ("a", 3.9, (684, 391), (560, 560)),
            ("b", 7.4, (1206, 216), (1000, 330)),
            ("d", 14.6, (740, 1022), (980, 860)),
        ],
    ),
)

add(
    "fiche",
    53.5,
    10,
    screens(
        "fiche",
        10,
        [
            ("a", S + "05-fiche-realisee.png", 1920, 0, 5, FULL, [(0.3, (1180, 560, 1.12), 1.2)]),
            ("b", S + "05-fiche-realisee-2.png", 1920, 5, 5, (1370, 450, 1.5), [], "hold"),
        ],
        [
            (0.3, 4.6, "Réalisé : la trace, la zone semée, les contrôles."),
            (5.1, 4.85, "Nitrates conformes, IFT de 1,435 : c'est calculé."),
        ],
        extra_css="""
    #fiche .ring { position: absolute; border: 4px solid var(--paille); border-radius: 14px; transform-origin: 50% 50%; }
""",
        extra_body="""      <div class="shot clip" id="fiche-r1w" data-start="5.5" data-duration="4.5" style="z-index:4"><div class="ring" id="fiche-r1"></div></div>
      <div class="shot clip" id="fiche-r2w" data-start="6.3" data-duration="3.7" style="z-index:4"><div class="ring" id="fiche-r2"></div></div>""",
        extra_js="""      { const f = at(1370, 450, 1.5);
        const box = (sel, x0, y0, x1, y1) => { const a = pt(f, x0, y0), b = pt(f, x1, y1); tl.set(sel, { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }, 0); };
        box("#fiche-r1", 1786, 326, 1886, 357);
        box("#fiche-r2", 1824, 476, 1888, 507);
        tl.fromTo("#fiche-r1", { scale: 1.25, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)" }, 5.5);
        tl.fromTo("#fiche-r2", { scale: 1.25, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)" }, 6.3); }""",
    ),
)

# Cahier : capture de l'élément (1068 × 339 CSS), coupée sous la ligne du 16/04 (la ligne de mai n'existe pas encore ce soir-là).
cahier_css = """
    #cahier .sheet { transform-origin: 50% 70%; position: absolute; left: 60px; top: 250px; width: 1560px; height: 416px; overflow: hidden; }
    #cahier .sheet img { position: absolute; left: 0; top: -273px; width: 2777px; max-width: none; }
    #cahier .mark { position: absolute; left: 0; top: 276px; width: 1560px; height: 138px; background: var(--paille); opacity: 0.28; transform-origin: 0 50%; mix-blend-mode: multiply; }
    #cahier .doc { position: absolute; left: 60px; top: 80px; font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 52px; letter-spacing: -0.01em; }
    #cahier .sub { position: absolute; left: 60px; top: 156px; font-size: 32px; color: var(--muted); }
"""
cahier_body = """    <div class="frame">
      <div class="doc">Cahier d'enregistrement 2026</div>
      <div class="sub">Lespourcy Maïs 2026 · 7,8 ha · zone vulnérable · sols limoneux</div>
      <div class="sheet"><img src="assets/screens/06-cahier-lespourcy.png" alt="" />
        <div class="shot clip" id="cahier-mw" data-start="1.2" data-duration="6.3"><div class="mark" id="cahier-m"></div></div>
      </div>
    </div>
    <div class="say clip" id="cahier-s0" data-start="0.3" data-duration="7.2"><span>Et le cahier de fertilisation s'est rempli tout seul.</span></div>"""
add(
    "cahier",
    63.5,
    7.5,
    scene(
        "cahier",
        7.5,
        cahier_css,
        cahier_body,
        '      wipe(tl, "#cahier-s0 span", 0.35);\n'
        '      tl.fromTo("#cahier-m", { scaleX: 0 }, { scaleX: 1, duration: 0.53, ease: "power2.out" }, 1.2);\n'
        '      tl.fromTo("#cahier .sheet", { scale: 1 }, { scale: 1.04, duration: 5.7, ease: "none" }, 1.8);\n'
        "      tl.set({}, {}, 7.5);",
    ),
)

add("papiers", 71, 4.5, title("papiers", 4.5, None, ["Je sème.", "Fourmy fait les papiers."], accent_last=True))

fin_css = """
    #fin .mark { position: absolute; left: 160px; top: 300px; display: flex; align-items: center; gap: 40px; }
    #fin .mark img { width: 200px; height: 200px; }
    #fin .word { font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 168px; color: var(--lichen-strong); letter-spacing: -0.03em; }
    #fin .url span { display: block; font-weight: 600; font-size: 56px; }
    #fin .url { position: absolute; left: 160px; top: 560px; }
    #fin .note { position: absolute; left: 160px; top: 900px; width: 1600px; font-size: 28px; line-height: 1.35; color: var(--muted); }
"""
fin_body = """    <div class="mark clip" id="fin-m" data-start="0" data-duration="5.5"><img id="fin-logo" src="assets/logo.svg" alt="" /><span class="word" id="fin-w">fourmy</span></div>
    <div class="url clip" id="fin-u" data-start="0.5" data-duration="5"><span>fourmy.org · le logiciel libre de la ferme</span></div>
    <div class="note clip" id="fin-n" data-start="0.9" data-duration="4.6">Avec Pierre Haurigot, Monassut-Audiracq (64). Vrais écrans de Fourmy, journée de semis reconstituée.</div>"""
add(
    "fin",
    75.5,
    5.5,
    scene(
        "fin",
        5.5,
        fin_css,
        fin_body,
        '      tl.fromTo("#fin-logo", { rotation: -12, scale: 0.8 }, { rotation: 0, scale: 1, duration: 0.6, ease: "back.out(1.6)" }, 0.05);\n'
        '      wipe(tl, "#fin-w", 0.15);\n'
        '      wipe(tl, "#fin-u span", 0.55);\n'
        "      tl.set({}, {}, 5.5);",
    ),
)

TOTAL = 81

# Sons : un clic par clic visible, un « pop » par repère, le moteur sous la 3D, un souffle à l'entrée du champ.
sounds = [
    ("sfx-clic1", "assets/sfx/click-soft.mp3", 4.5 + 9.6 + 0.03, 0.6),
    ("sfx-clic2", "assets/sfx/click-soft.mp3", 37.5 + 3.9 + 0.03, 0.6),
    ("sfx-clic3", "assets/sfx/click-soft.mp3", 37.5 + 7.4 + 0.03, 0.6),
    ("sfx-clic4", "assets/sfx/click-soft.mp3", 37.5 + 14.6 + 0.03, 0.6),
    ("sfx-pop1", "assets/sfx/pop.mp3", 53.5 + 5.5 + 0.03, 0.5),
    ("sfx-pop2", "assets/sfx/pop.mp3", 53.5 + 6.3 + 0.03, 0.5),
    ("sfx-pop3", "assets/sfx/pop.mp3", 63.5 + 1.2 + 0.03, 0.45),
    ("sfx-souffle", "assets/sfx/whoosh-short.mp3", 22.85, 0.4),
]
hosts = "\n".join(
    f'      <div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{st}" data-duration="{du}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>'
    for sid, st, du in scenes
)
audio = "\n".join(
    f'      <audio id="{i}" class="clip" src="{src}" data-start="{t:.2f}" data-duration="{ {"click-soft": 0.37, "pop": 0.72, "whoosh-short": 0.57}[src.split("/")[-1][:-4]] }" data-track-index="{6 + k}" data-volume="{v}"></audio>'
    for k, (i, src, t, v) in enumerate(sounds)
)
audio += '\n      <audio id="sfx-moteur" class="clip" src="assets/sfx/moteur.mp3" data-start="23" data-duration="7.7" data-track-index="2" data-volume="0.22" data-fade-in="0.6" data-fade-out="1.5"></audio>'
audio += '\n      <audio id="sfx-moteur2" class="clip" src="assets/sfx/moteur.mp3" data-start="30.6" data-duration="3.4" data-track-index="5" data-volume="0.22" data-media-start="2" data-fade-in="0.4" data-fade-out="1.2"></audio>'

index = f"""<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    {GSAP}
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #F6F4EE; }}
      #root {{ position: relative; width: 100%; height: 100%; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1920" data-height="1080">
{hosts}
{audio}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      tl.set({{}}, {{}}, {TOTAL});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
"""
(ROOT / "index.html").write_text(index)
print(json.dumps([s[0] for s in scenes]))
