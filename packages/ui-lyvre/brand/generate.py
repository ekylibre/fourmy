"""Génère les logos SVG de Fourmy (logo par défaut, appelé à évoluer).

    python3 -m venv /tmp/v && /tmp/v/bin/pip install fonttools==4.60.1 brotli==1.1.0
    /tmp/v/bin/python packages/ui-lyvre/brand/generate.py

Symbole : une fourmi vue de dessus (fourmi / Fourmy, le travail collectif de
la ferme). Mot-symbole : « fourmy » en Bricolage Grotesque 700 (police de
l'application, licence OFL), converti en tracés — les SVG produits n'ont
besoin d'aucune police. Le « y » porte l'accent de couleur, comme dans l'app.
Couleurs : charte Lyvre (packages/ui-lyvre/src/lyvre.css).
"""

from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = Path(__file__).parent
FONT = next(
    (HERE / "../../../node_modules/.pnpm").resolve().glob(
        "@fontsource+bricolage-grotesque@*/node_modules/@fontsource/bricolage-grotesque/files/"
        "bricolage-grotesque-latin-700-normal.woff2"
    )
)

THEMES = {
    "light": {"ink": "#1E2421", "body": "#2F6B4F", "accent": "#2F6B4F", "legs": "#1E4A36"},
    "dark": {"ink": "#F6F4EE", "body": "#6FB08E", "accent": "#D9A441", "legs": "#6FB08E"},
}


def ant(theme: dict, stroke: float = 3.4) -> str:
    """Fourmi dans une boîte 64 × 64 : traits épais pour rester lisible à 16 px."""
    legs = " ".join(
        [
            # Trois paires de pattes, articulées, attachées au thorax.
            "M28 25 L19 19 L13 20", "M36 25 L45 19 L51 20",
            "M27.5 29.5 L16 30 L10 35", "M36.5 29.5 L48 30 L54 35",
            "M28.5 33 L20 40 L17 47", "M35.5 33 L44 40 L47 47",
        ]
    )
    antennae = "M29.5 9.5 Q26 3 20 3.5 M34.5 9.5 Q38 3 44 3.5"
    return (
        f'<g fill="none" stroke="{theme["legs"]}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">'
        f'<path d="{legs}"/><path d="{antennae}"/></g>'
        f'<g fill="{theme["body"]}">'
        '<circle cx="32" cy="14.5" r="6.5"/>'
        '<ellipse cx="32" cy="29" rx="5.2" ry="6.8"/>'
        '<ellipse cx="32" cy="47" rx="9" ry="11.5"/></g>'
    )


def wordmark_paths(theme: dict) -> tuple[str, float, float]:
    """Tracés de « fourmy » ; renvoie (svg, largeur, hauteur) en unités du logo."""
    font = TTFont(FONT)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    ascent = font["hhea"].ascent
    size = 44 / upm * 1000 / 1000  # corps : 44 unités
    scale = 44 / upm
    tracking = -0.03 * 44  # letter-spacing de l'app : -0.03em
    x = 0.0
    parts = []
    for ch in "fourmy":
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs)
        # Repère SVG : y vers le bas ; ligne de base à `ascent`.
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, ascent * scale)))
        color = theme["accent"] if ch == "y" else theme["ink"]
        parts.append(f'<path fill="{color}" d="{pen.getCommands()}"/>')
        x += glyphs[name].width * scale + tracking
    del size
    height = (font["hhea"].ascent - font["hhea"].descent) * scale
    return "".join(parts), x - tracking, height


def svg(width: float, height: float, body: str, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {height:.1f}" '
        f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'
    )


def main() -> None:
    for variant, theme in THEMES.items():
        suffix = "" if variant == "light" else "-dark"
        (HERE / f"fourmy-symbol{suffix}.svg").write_text(svg(64, 64, ant(theme), "Fourmy"))
        words, w_width, w_height = wordmark_paths(theme)
        # Symbole 64 de haut, mot-symbole centré verticalement, 12 unités d'écart.
        offset_y = (64 - w_height) / 2 + 2
        body = ant(theme) + f'<g transform="translate(76 {offset_y:.2f})">{words}</g>'
        (HERE / f"fourmy-logo{suffix}.svg").write_text(svg(76 + w_width + 2, 64, body, "Fourmy"))
    # Favicon : symbole sur pastille claire, traits encore plus épais.
    fav = THEMES["light"]
    body = '<rect width="64" height="64" rx="14" fill="#F6F4EE"/>' + ant(fav, stroke=4.2)
    (HERE / "favicon.svg").write_text(svg(64, 64, body, "Fourmy"))
    print("logos écrits dans", HERE)


if __name__ == "__main__":
    main()
