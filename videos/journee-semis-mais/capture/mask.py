"""Efface le coin droit de l'en-tête (adresse du compte de démonstration) des captures pleine page."""
from PIL import Image, ImageDraw
from pathlib import Path
for f in sorted((Path(__file__).parent.parent / "assets/screens").glob("*.png")):
    im = Image.open(f).convert("RGB")
    if im.size not in ((3840, 2160), (1920, 1080)):
        continue
    k = im.size[0] // 1920
    ImageDraw.Draw(im).rectangle((1560 * k, 4 * k, 1915 * k, 52 * k), fill=im.getpixel((1500 * k, 8 * k)))
    im.save(f)
