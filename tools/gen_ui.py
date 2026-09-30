"""Generates the workshop-material textures the UI is built from (2026-09-28).

Run:  python3 tools/gen_ui.py
Out:  assets/ui/ply.jpg        birch plywood face (buttons), tiles both ways
      assets/ui/kraft.jpg      brown kraft paper (tags, strips)
      assets/ui/card.jpg       cream index-card / paper-sheet stock
      assets/ui/tape.jpg       masking tape crepe, tiles along X
      assets/ui/pegboard.jpg   tempered hardboard with a 4x4 hole grid, tiles both ways
      assets/ui/grunge.png     alpha noise for paint wear and spray overspray

Why: the owner's siblings recognised the old UI as AI-made on sight (glossy candy
buttons, dark translucent cards, system font). The replacement is built from the
things that are actually in a workshop, and those need real surface texture — a flat
fill of "plywood colour" reads as exactly the same generic UI with a brown palette.

All noise is built with the same wrapped-grid FFT low-pass as gen_wood.py, so every
texture tiles seamlessly as a canvas pattern.
"""

import os
import numpy as np
from PIL import Image

from gen_wood import periodic_noise, fbm, ramp

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'ui')


def save_jpg(arr, name, q=86):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=q, optimize=True)
    print('wrote', name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


def fibres(shape, rng, n, length, strength):
    """Short random paper fibres: thin dark/light dashes, wrapped so they tile."""
    h, w = shape
    out = np.zeros(shape)
    for _ in range(n):
        y, x = rng.integers(0, h), rng.integers(0, w)
        a = rng.uniform(0, np.pi)
        ln = rng.integers(length // 2, length)
        s = rng.choice([-1, 1]) * rng.uniform(0.4, 1.0) * strength
        for k in range(ln):
            yy = int(y + np.sin(a) * k) % h
            xx = int(x + np.cos(a) * k) % w
            out[yy, xx] += s
    return out


def make_ply(rng):
    # Rotary-cut birch veneer: pale, low contrast, wide soft figure.
    # Grain runs along X: buttons are wide, and grain follows a board's long side.
    h, w = 256, 512
    base = fbm((h, w), 260, 14, 4, rng)
    fine = periodic_noise((h, w), 70, 1.2, rng)
    figure = periodic_noise((h, w), 120, 26, rng)
    t = 0.52 + 0.30 * base + 0.12 * fine + 0.10 * np.sin(figure * 9)
    rgb = ramp(t, [(0.0, (196, 160, 112)), (0.45, (222, 192, 146)), (0.7, (236, 210, 168)), (1.0, (244, 224, 186))])
    # Occasional darker veneer streak — what makes it read as ply, not paper.
    streak = np.clip(periodic_noise((h, w), 400, 6, rng) * 3 - 2.1, 0, 1)
    rgb *= (1 - 0.18 * streak)[..., None]
    save_jpg(rgb, 'ply.jpg')


def make_kraft(rng):
    h = w = 256
    base = fbm((h, w), 40, 40, 4, rng)
    t = 0.5 + 0.18 * base + fibres((h, w), rng, 900, 14, 0.12)
    rgb = ramp(t, [(0.0, (120, 84, 50)), (0.5, (164, 122, 80)), (1.0, (196, 156, 108))])
    save_jpg(rgb, 'kraft.jpg')


def make_card(rng):
    h = w = 256
    base = fbm((h, w), 50, 50, 4, rng)
    t = 0.55 + 0.10 * base + fibres((h, w), rng, 700, 10, 0.06)
    rgb = ramp(t, [(0.0, (218, 204, 172)), (0.5, (236, 226, 200)), (1.0, (248, 242, 224))])
    save_jpg(rgb, 'card.jpg')


def make_tape(rng):
    # Masking tape: cream, with the crepe crinkles running ACROSS the tape.
    h, w = 64, 256
    crepe = periodic_noise((h, w), 1.5, 40, rng)
    base = fbm((h, w), 30, 30, 3, rng)
    t = 0.55 + 0.10 * base + 0.10 * crepe
    rgb = ramp(t, [(0.0, (206, 188, 142)), (0.5, (226, 212, 170)), (1.0, (240, 230, 196))])
    save_jpg(rgb, 'tape.jpg')


def make_pegboard(rng):
    # 144px tile = 4x4 holes at 36px, the same pitch in logical units on screen.
    s, pitch = 144, 36
    base = fbm((s, s), 30, 30, 4, rng)
    t = 0.5 + 0.16 * base + fibres((s, s), rng, 300, 8, 0.05)
    rgb = ramp(t, [(0.0, (88, 60, 38)), (0.5, (116, 82, 52)), (1.0, (140, 104, 70))])
    yy, xx = np.mgrid[0:s, 0:s]
    for cy in range(pitch // 2, s, pitch):
        for cx in range(pitch // 2, s, pitch):
            d = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
            hole = d < 5.2
            rim = (d >= 5.2) & (d < 7.0)
            # Lit from the top-left: lower-right rim catches light, upper-left is shadow.
            lit = ((xx - cx) + (yy - cy)) / (d + 1e-6)
            rgb[rim] *= (1.0 + 0.16 * lit[rim])[:, None]
            rgb[hole] = np.array([22, 14, 9]) + (d[hole] / 5.2)[:, None] * 14
    save_jpg(rgb, 'pegboard.jpg', q=88)


def make_grunge(rng):
    h = w = 256
    n = fbm((h, w), 22, 22, 5, rng, gain=0.6)
    speck = periodic_noise((h, w), 1.5, 1.5, rng)
    a = np.clip((n * 1.6 + speck * 0.5 + 0.1) * 255, 0, 255).astype(np.uint8)
    img = Image.new('LA', (w, h))
    img.putdata([(0, int(v)) for v in a.flatten()])
    img.save(os.path.join(OUT, 'grunge.png'), optimize=True)
    print('wrote grunge.png', os.path.getsize(os.path.join(OUT, 'grunge.png')) // 1024, 'KB')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(2809)
    make_ply(rng)
    make_kraft(rng)
    make_card(rng)
    make_tape(rng)
    make_pegboard(rng)
    make_grunge(rng)
