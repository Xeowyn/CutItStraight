"""Generates the three CrazyGames submission cover images.

Run:  python3 tools/gen_covers.py
Out:  submission/cover_1920x1080.png
      submission/cover_800x1200.png
      submission/cover_800x800.png

Platform rules these obey (CRAZYGAMES_GUIDELINES.md §4):
  * Exact sizes: 1920x1080 landscape, 800x1200 portrait, 800x800 square.
  * Consistent visuals across all three.
  * The game title, in a stylised treatment, on the cover.
  * NO borders, NO extra text beyond the title, NO icons, NO raw gameplay screenshots.

Composition is the same in all three: a plank running through frame on a diagonal,
the cyan guide line along it, the blade's cut behind, and the title locked to the
centre. Only the crop and the plank angle change per aspect, which is what keeps
them recognisably one set.
"""

import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "submission")

TITLE = "CUT IT"
TITLE2 = "STRAIGHT"

BG_TOP = (34, 26, 20)
BG_BOT = (12, 14, 18)
CYAN = (125, 240, 255)
WOOD_MID = (198, 150, 92)


def font(size, bold=True):
    """System fonts only — no font files are checked in."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def backdrop(w, h):
    yy = np.linspace(0, 1, h)[:, None]
    top = np.array(BG_TOP, float)[None, None, :]
    bot = np.array(BG_BOT, float)[None, None, :]
    grad = top * (1 - yy[:, :, None]) + bot * yy[:, :, None]
    img = np.repeat(grad, w, axis=1)
    # Warm pool of light behind where the title lands.
    xx, yg = np.meshgrid(np.linspace(0, 1, w), np.linspace(0, 1, h))
    glow = np.exp(-(((xx - 0.5) / 0.42) ** 2 + ((yg - 0.5) / 0.40) ** 2))
    img += glow[:, :, None] * np.array([90, 62, 26], float)[None, None, :]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")


def wood_strip(w, h, angle):
    """A plank with a real cut in it, drawn oversized then rotated into place.

    The grain is the game's OWN texture (assets/wood/oak.jpg) rather than a
    reimplementation. That guarantees the store page and the game look like the same
    product, which is the whole point of a cover.
    """
    d = int(math.hypot(w, h) * 1.3)
    band_h = int(min(w, h) * 0.46)

    tex_path = os.path.join(os.path.dirname(__file__), "..", "assets", "wood", "oak.jpg")
    if os.path.exists(tex_path):
        tex = Image.open(tex_path).convert("RGB")
        # The texture's grain runs down its long axis, so rotate it to run along the
        # plank, then tile.
        tex = tex.rotate(90, expand=True)
        scale = band_h / tex.height
        tex = tex.resize((max(1, int(tex.width * scale)), band_h), Image.LANCZOS)
        strip = Image.new("RGB", (d, band_h))
        for x in range(0, d, tex.width):
            strip.paste(tex, (x, 0))
    else:
        strip = Image.new("RGB", (d, band_h), WOOD_MID)

    px = np.array(strip, float)
    # Volume across the board plus a warm key light.
    v = np.abs(np.linspace(-1, 1, band_h))[:, None, None]
    px *= (1.0 - 0.40 * v ** 2)
    px *= np.array([1.06, 0.99, 0.90], float)[None, None, :]
    strip = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8), "RGB")

    dr = ImageDraw.Draw(strip)
    mid = band_h // 2
    cut_at = int(d * 0.42)
    pts = [(x, mid + int(math.sin(x / 165.0) * band_h * 0.19)) for x in range(0, d, 5)]

    # Guide line ONLY ahead of the blade. Drawing it along the whole plank painted
    # cyan back over the kerf and erased the one detail that explains the game.
    ahead = [(x, y) for x, y in pts if x >= cut_at]
    glow_layer = Image.new("RGB", strip.size, (0, 0, 0))
    gdr = ImageDraw.Draw(glow_layer)
    if len(ahead) > 1:
        gdr.line(ahead, fill=CYAN, width=max(7, band_h // 22))
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(band_h // 16))
    strip = Image.fromarray(
        np.clip(np.array(strip, float) + np.array(glow_layer, float) * 1.5, 0, 255).astype(np.uint8), "RGB")

    dr = ImageDraw.Draw(strip)
    if len(ahead) > 1:
        dr.line(ahead, fill=CYAN, width=max(4, band_h // 40))
        dr.line(ahead, fill=(240, 254, 255), width=max(2, band_h // 90))

    # The kerf behind the blade: this is the story of the game, so it has to read,
    # and it is drawn last so nothing paints over it.
    kerf = [(x, y) for x, y in pts if x <= cut_at]
    if len(kerf) > 1:
        dr.line(kerf, fill=(96, 62, 30), width=max(13, band_h // 15))
        dr.line(kerf, fill=(42, 25, 11), width=max(8, band_h // 24))
        dr.line(kerf, fill=(12, 7, 3), width=max(4, band_h // 46))

    # The blade, at the head of the kerf.
    by = mid + int(math.sin(cut_at / 165.0) * band_h * 0.19)
    bw = max(5, band_h // 34)
    dr.rectangle([cut_at - bw, by - band_h // 3, cut_at + bw, by + band_h // 3],
                 fill=(214, 226, 240))
    dr.rectangle([cut_at - bw // 3, by - band_h // 3, cut_at + bw // 3, by + band_h // 3],
                 fill=(255, 255, 255))

    # Sawdust burst at the contact point.
    rng = np.random.default_rng(11)
    for _ in range(260):
        a = rng.uniform(-math.pi, math.pi)
        r = abs(rng.normal(0, band_h * 0.20))
        sx = cut_at + math.cos(a) * r * 1.5
        sy = by + math.sin(a) * r
        sz = rng.uniform(1.5, band_h / 90)
        shade = rng.uniform(0.75, 1.0)
        dr.ellipse([sx - sz, sy - sz, sx + sz, sy + sz],
                   fill=(int(255 * shade), int(214 * shade), int(150 * shade)))

    canvas = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    canvas.paste(strip, (0, (d - band_h) // 2))
    return canvas.rotate(angle, resample=Image.BICUBIC, center=(d // 2, d // 2))


def title_block(img, w, h, scale):
    dr = ImageDraw.Draw(img)
    f1 = font(int(126 * scale))
    f2 = font(int(126 * scale))

    def centred(text, fnt, cy):
        bb = dr.textbbox((0, 0), text, font=fnt)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        x, y = (w - tw) // 2 - bb[0], cy - th // 2 - bb[1]
        # Heavy dark outline so the title survives on any background.
        for ox in range(-6, 7, 2):
            for oy in range(-6, 7, 2):
                dr.text((x + ox, y + oy), text, font=fnt, fill=(14, 12, 10))
        dr.text((x, y + int(5 * scale)), text, font=fnt, fill=(150, 96, 30))
        dr.text((x, y), text, font=fnt, fill=(255, 214, 115))
        return th

    gap = int(104 * scale)
    cy = int(h * 0.70)
    centred(TITLE, f1, cy - gap // 2)
    centred(TITLE2, f2, cy + gap // 2)


def make(w, h, angle, scale):
    img = backdrop(w, h).convert("RGBA")
    strip = wood_strip(w, h, angle)
    img.alpha_composite(strip, ((w - strip.width) // 2, (h - strip.height) // 2))

    # Vignette, to push the eye to the title.
    xx, yy = np.meshgrid(np.linspace(-1, 1, w), np.linspace(-1, 1, h))
    vig = np.clip(1.0 - 0.50 * (xx ** 2 + (yy + 0.25) ** 2), 0.22, 1.0)
    arr = np.array(img.convert("RGB"), float) * vig[:, :, None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    title_block(img, w, h, scale)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    specs = [
        ("cover_1920x1080", 1920, 1080, -14, 1.0),
        ("cover_800x1200", 800, 1200, -62, 0.62),
        ("cover_800x800", 800, 800, -20, 0.60),
    ]
    for name, w, h, angle, scale in specs:
        img = make(w, h, angle, scale)
        path = os.path.join(OUT, f"{name}.png")
        img.save(path, optimize=True)
        print(f"{name:20s} {w}x{h}  {os.path.getsize(path)/1024:7.1f} KB")


if __name__ == "__main__":
    main()
