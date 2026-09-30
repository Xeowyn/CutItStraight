"""Generates the saw machine's metal textures.

Run:  python3 tools/gen_machine.py
Out:  assets/machine/<name>.jpg   (512x512, tiles on both axes)

Why these exist: the saw arm was flat-shaded grey and read as moulded plastic, which
is the one thing on screen the player stares at for the whole run. The wood textures
work because they carry real surface variation; the metal needs the same treatment.

What makes metal read as metal here:
  * ANISOTROPIC micro-detail. Machining leaves directional tool marks; isotropic
    noise reads as concrete or stone.
  * A very high dynamic range. Metal is mostly a mirror of a bright room, so the
    highlights blow out and the shadows go much darker and COOLER than a plain
    darkening of the body colour.
  * Sparse hard defects — casting pits, hairline scratches — rather than an even
    all-over grunge, which reads as dirt instead of surface.

Tiles on both axes: the arm is drawn at arbitrary sizes and rotations, so a texture
that only wrapped on Y would show a seam.
"""

import numpy as np
from PIL import Image, ImageFilter
import os

S = 512


def periodic_noise(shape, size_x, size_y, rng):
    """Smooth noise wrapping on both axes. size_* = feature size in px per axis."""
    h, w = shape
    white = rng.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None] * h
    fx = np.fft.fftfreq(w)[None, :] * w
    radius = np.sqrt((fy * size_y / h) ** 2 + (fx * size_x / w) ** 2)
    falloff = 1.0 / (1.0 + radius ** 4)
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * falloff))
    return out / (np.abs(out).max() + 1e-9)


def fbm(shape, size_x, size_y, octaves, rng, gain=0.5):
    total = np.zeros(shape)
    amp, norm = 1.0, 0.0
    sx, sy = size_x, size_y
    for _ in range(octaves):
        total += amp * periodic_noise(shape, sx, sy, rng)
        norm += amp
        amp *= gain
        sx = max(1.0, sx * 0.5)
        sy = max(1.0, sy * 0.5)
    return total / (norm + 1e-9)


def shade(v, dark, mid, hot):
    """Map a 0..~1.6 luminance field through a three-point metal ramp."""
    dark = np.array(dark, float)
    mid = np.array(mid, float)
    hot = np.array(hot, float)
    t = np.clip(v, 0, 1)[:, :, None]
    rgb = dark[None, None, :] * (1 - t) + mid[None, None, :] * t
    over = np.clip(v - 1.0, 0, 0.9)[:, :, None]
    return rgb * (1 - over) + hot[None, None, :] * over


def pit(rgb, rng, density=0.9988, depth=0.5):
    """Sparse casting pits: single dark pixels smeared one step, not a noise field."""
    p = rng.random(rgb.shape[:2])
    m = (p > density).astype(float)
    m = np.maximum(m, np.roll(m, 1, 0) * 0.65)
    m = np.maximum(m, np.roll(m, 1, 1) * 0.45)
    return rgb * (1.0 - depth * m)[:, :, None]


def make_cast_iron(rng):
    """The saw body and arm: a grey iron casting with a semi-matte machined finish."""
    # Tool marks run along X (the arm's long axis when drawn unrotated).
    tool = fbm((S, S), 260, 1.6, 3, rng)
    micro = fbm((S, S), 90, 0.9, 2, rng)
    broad = fbm((S, S), 900, 240, 2, rng)
    swell = fbm((S, S), 1800, 520, 1, rng)

    v = 0.44 + 0.10 * tool + 0.045 * micro + 0.26 * broad + 0.17 * swell
    # One broad soft highlight band, as if lit from a single overhead source.
    yy = np.mgrid[0:S, 0:S][0].astype(float) / S
    v += 0.30 * np.exp(-((yy - 0.34) / 0.24) ** 2)
    v = np.clip(v, 0, 1.55)

    rgb = shade(v, (28, 32, 38), (132, 140, 150), (238, 244, 250))
    sc = fbm((S, S), 900, 1.1, 1, rng)
    rgb += (np.clip(np.abs(sc) - 0.80, 0, None) * 5.0 * 46)[:, :, None]
    rgb = pit(rgb, rng, 0.9986, 0.42)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_brushed(rng):
    """Brushed stainless for the table insert and pressure plates."""
    brush = fbm((S, S), 420, 1.0, 4, rng)
    micro = fbm((S, S), 140, 0.7, 2, rng)
    broad = fbm((S, S), 1400, 380, 2, rng)

    v = 0.52 + 0.16 * brush + 0.06 * micro + 0.28 * broad
    yy = np.mgrid[0:S, 0:S][0].astype(float) / S
    v += 0.34 * np.exp(-((yy - 0.28) / 0.16) ** 2)
    v += 0.18 * np.exp(-((yy - 0.72) / 0.10) ** 2)
    v = np.clip(v, 0, 1.6)

    rgb = shade(v, (46, 54, 64), (168, 178, 190), (250, 252, 255))
    rgb = pit(rgb, rng, 0.9995, 0.3)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_blade_steel(rng):
    """Hardened blade stock: darker, bluer, with fine lengthwise grind marks."""
    grind = fbm((S, S), 1.0, 520, 4, rng)
    broad = fbm((S, S), 220, 1600, 2, rng)
    v = 0.40 + 0.20 * grind + 0.26 * broad
    xx = np.mgrid[0:S, 0:S][1].astype(float) / S
    v += 0.42 * np.exp(-((xx - 0.40) / 0.10) ** 2)
    v = np.clip(v, 0, 1.5)
    rgb = shade(v, (20, 26, 36), (108, 122, 142), (232, 242, 252))
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "assets", "machine")
    os.makedirs(out_dir, exist_ok=True)

    def save(name, img):
        path = os.path.join(out_dir, f"{name}.jpg")
        img.save(path, quality=84, optimize=True, progressive=True)
        print(f"{name:12s} {os.path.getsize(path)/1024:7.1f} KB")

    save("cast_iron", make_cast_iron(np.random.default_rng(5501)))
    save("brushed", make_brushed(np.random.default_rng(5502)))
    save("blade_steel", make_blade_steel(np.random.default_rng(5503)))


if __name__ == "__main__":
    main()
