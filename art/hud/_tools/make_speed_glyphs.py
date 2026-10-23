"""Speed glyphs ▶▶ and ▶▶▶ built from the play triangle, like the owner's mock-up.

The generated fast / faster glyphs came out thin; these reuse the bold
glyph_play triangle (and its light twin), two or three in a row.

    py -I art/hud/_tools/make_speed_glyphs.py
"""
from pathlib import Path

from PIL import Image

HUD = Path(__file__).resolve().parents[1]

# name -> (count, triangle height as a share of play's, step as a share of width)
LAYOUT = {"glyph_fast": (2, 0.80, 0.60), "glyph_faster": (3, 0.62, 0.56)}


def build(src: Image.Image, count: int, k: float, step: float) -> Image.Image:
    tri = src.crop(src.getchannel("A").getbbox())
    w, h = max(1, round(tri.width * k)), max(1, round(tri.height * k))
    tri = tri.resize((w, h), Image.LANCZOS)
    dx = round(w * step)
    total = w + dx * (count - 1)
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    x0 = (src.width - total) // 2
    y0 = (src.height - h) // 2
    for i in range(count):
        layer = Image.new("RGBA", src.size, (0, 0, 0, 0))
        layer.paste(tri, (x0 + dx * i, y0), tri)
        out = Image.alpha_composite(out, layer)
    return out


def main() -> None:
    for suffix in ("", "_light"):
        play = Image.open(HUD / f"glyph_play{suffix}.png").convert("RGBA")
        for name, (count, k, step) in LAYOUT.items():
            build(play, count, k, step).save(HUD / f"{name}{suffix}.png")
            print("wrote", f"{name}{suffix}.png")


if __name__ == "__main__":
    main()
