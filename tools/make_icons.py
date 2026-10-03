"""Generate the app icons (PNG) from a simple vector-ish drawing.

Run:  python tools/make_icons.py
Needs Pillow (pip install pillow).
"""
from pathlib import Path
from PIL import Image, ImageDraw

BG = "#c67139"      # crust terracotta
LOAF = "#f5ead8"    # parchment
SS = 4              # supersampling for smooth edges
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw_icon(size: int, scale: float = 0.9) -> Image.Image:
    w = size * SS
    im = Image.new("RGBA", (w, w), BG)
    d = ImageDraw.Draw(im)
    k = scale * w / 1024.0
    cx = cy = w / 2.0

    def p(x, y):
        return (cx + (x - 512) * k, cy + (y - 512) * k)

    # Dome
    d.ellipse([*p(150, 330), *p(874, 710)], fill=LOAF)
    # Body (flat top join + rounded bottom)
    d.rectangle([*p(150, 520), *p(874, 620)], fill=LOAF)
    d.rounded_rectangle([*p(150, 520), *p(874, 760)], radius=int(70 * k), fill=LOAF)
    # Three diagonal scores
    width = max(2, int(36 * k))
    r = width / 2.0
    for mid in (350, 512, 674):
        a = p(mid - 60, 500)
        b = p(mid + 60, 400)
        d.line([a, b], fill=BG, width=width)
        for (x, y) in (a, b):
            d.ellipse([x - r, y - r, x + r, y + r], fill=BG)

    return im.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(1024).save(OUT / "icon-1024.png")
    draw_icon(512).save(OUT / "icon-512.png")
    draw_icon(192).save(OUT / "icon-192.png")
    draw_icon(512, scale=0.72).save(OUT / "icon-maskable-512.png")
    draw_icon(180).save(OUT / "apple-touch-icon.png")
    draw_icon(32).save(OUT / "favicon-32.png")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
