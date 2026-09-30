"""Generates seamlessly-tiling wood grain textures for the game.

Run:  python3 tools/gen_wood.py
Out:  assets/wood/<species>.jpg   (512x1024, tiles vertically)

Textures tile along Y because the plank scrolls vertically. Periodicity comes from
building all noise with an FFT low-pass over a wrapped grid, which is periodic on
both axes by construction.

The thing that makes this read as wood rather than marble is anisotropy: every noise
field is stretched hard along Y, so grain runs the length of the board in long
near-parallel lines instead of wandering in all directions.
"""

import numpy as np
from PIL import Image, ImageFilter
import os

W, H = 512, 1024


def periodic_noise(shape, size_x, size_y, rng):
    """Smooth noise wrapping on both axes. size_* = feature size in px per axis."""
    h, w = shape
    white = rng.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None] * h
    fx = np.fft.fftfreq(w)[None, :] * w
    # Elliptical low-pass: a larger size along an axis means longer features there.
    radius = np.sqrt((fy * size_y / h) ** 2 + (fx * size_x / w) ** 2)
    falloff = 1.0 / (1.0 + radius ** 4)
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * falloff))
    return out / (np.abs(out).max() + 1e-9)


def fbm(shape, size_x, size_y, octaves, rng, gain=0.5):
    total = np.zeros(shape)
    amp = 1.0
    norm = 0.0
    sx, sy = size_x, size_y
    for _ in range(octaves):
        total += amp * periodic_noise(shape, sx, sy, rng)
        norm += amp
        amp *= gain
        sx *= 0.5
        sy *= 0.5
    return total / norm


def ramp(t, stops):
    t = np.clip(t, 0.0, 1.0)
    out = np.zeros(t.shape + (3,))
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        m = (t >= p0) & (t <= p1)
        if not m.any():
            continue
        f = ((t[m] - p0) / (p1 - p0))[:, None]
        out[m] = np.array(c0)[None, :] * (1 - f) + np.array(c1)[None, :] * f
    return out


SPECIES = {
    # ring_period: px between growth rings across the board's width.
    # warp: how far rings wander along the length (cathedral arching).
    "pine": dict(ring_period=34, warp=26, sharp=2.6, knot=True, stops=[
        (0.00, (238, 208, 158)), (0.40, (223, 186, 133)),
        (0.72, (192, 145, 92)),  (1.00, (150, 104, 60))]),
    "oak": dict(ring_period=27, warp=20, sharp=3.2, knot=True, stops=[
        (0.00, (214, 175, 126)), (0.40, (192, 149, 100)),
        (0.70, (156, 112, 70)),  (1.00, (112, 76, 44))]),
    "maple": dict(ring_period=42, warp=30, sharp=2.0, knot=False, stops=[
        (0.00, (243, 223, 190)), (0.42, (232, 206, 168)),
        (0.74, (211, 179, 136)), (1.00, (180, 145, 104))]),
    "cherry": dict(ring_period=31, warp=22, sharp=2.9, knot=False, stops=[
        (0.00, (196, 133, 96)),  (0.40, (176, 110, 74)),
        (0.70, (146, 84, 55)),   (1.00, (108, 57, 36))]),
    "walnut": dict(ring_period=25, warp=18, sharp=3.4, knot=True, stops=[
        (0.00, (112, 78, 52)),   (0.34, (86, 58, 38)),
        (0.62, (60, 39, 25)),    (1.00, (34, 21, 14))]),
    "ebony": dict(ring_period=23, warp=16, sharp=3.6, knot=False, stops=[
        (0.00, (62, 53, 48)),    (0.34, (42, 35, 32)),
        (0.62, (27, 22, 20)),    (1.00, (14, 11, 10))]),
    # --- Added 2026-09-19. Three woods picked for COLOUR and pattern rather than for
    # another brown: the campaign had six woods and four of them were brown, so the
    # material a level is cut from stopped being information after the first hour.
    #
    # Birch is the outlier in shape rather than colour: near-straight grain (tiny
    # warp) and a wide, even ring period — the palest board in the game and the only
    # one with no cathedral arching to read the line against.
    "birch": dict(ring_period=58, warp=7, sharp=1.6, knot=False, stops=[
        (0.00, (238, 226, 178)), (0.42, (226, 208, 148)),
        (0.74, (205, 180, 116)), (1.00, (176, 148, 84))]),
    # Zebrano is the highest-contrast wood in the set: pale gold ground with near-black
    # stripes. Small ring period and a high sharpness give the stripes their edges.
    "zebrano": dict(ring_period=19, warp=12, sharp=4.4, knot=False, stops=[
        (0.00, (226, 196, 140)), (0.34, (196, 160, 104)),
        (0.60, (96, 66, 38)),    (1.00, (38, 26, 16))]),
    # Purpleheart really is violet, and it is the only wood in the game that is not on
    # the yellow-brown axis at all.
    "purpleheart": dict(ring_period=29, warp=21, sharp=3.0, knot=False, stops=[
        (0.00, (156, 104, 146)), (0.38, (126, 74, 120)),
        (0.68, (92, 48, 88)),    (1.00, (54, 26, 52))]),
}


def make_species(cfg, rng):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)

    # Grain wander at THREE scales. A single very-stretched field gives ruler-straight
    # corduroy stripes; the medium and fine terms are what make fibres wander,
    # converge and split the way real grain does.
    wander_long = fbm((H, W), 300, 2600, 2, rng)    # slow drift down the board
    wander_mid = fbm((H, W), 150, 620, 3, rng)      # the term that kills the corduroy
    wander_fine = fbm((H, W), 55, 190, 3, rng)      # local raggedness
    w = cfg["warp"]
    warped_x = (xx
                + w * 1.00 * wander_long
                + w * 0.62 * wander_mid
                + w * 0.22 * wander_fine)

    # Ring spacing varies across the board instead of being a fixed period, so bands
    # bunch up and open out like real early/latewood.
    density = 1.0 + 0.42 * fbm((H, W), 220, 1400, 2, rng)
    phase = warped_x * density / cfg["ring_period"]

    # Per-ring sharpness variation so not every band is identical.
    sharp_var = 1.0 + 0.45 * fbm((H, W), 180, 1100, 2, rng)
    rings = np.abs(((phase % 1.0) * 2.0) - 1.0)
    rings = np.clip(rings, 1e-4, 1.0) ** (cfg["sharp"] * sharp_var)

    # Hairline fibres running the length of the board.
    fibre = fbm((H, W), 3.5, 90, 3, rng)
    medium = fbm((H, W), 14, 420, 2, rng)

    grain = rings + 0.22 * fibre + 0.15 * medium

    # Broad tonal drift so tiling reads less mechanically.
    tone_field = fbm((H, W), 300, 1800, 2, rng)
    grain += 0.10 * tone_field

    grain = (grain - grain.min()) / (np.ptp(grain) + 1e-9)
    rgb = ramp(grain, cfg["stops"])
    rgb *= (1.0 + 0.07 * tone_field)[:, :, None]

    # Sparse open pores, elongated along the grain.
    pores = rng.random((H, W))
    pore = (pores > 0.9988).astype(np.float64)
    pore = np.maximum(pore, np.roll(pore, 1, axis=0) * 0.7)
    pore = np.maximum(pore, np.roll(pore, 2, axis=0) * 0.4)
    rgb *= (1.0 - 0.30 * pore)[:, :, None]

    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def add_knot(img, rng):
    """A knot with a hard-edged dark core and tight rings around it.

    A soft radial blob just reads as a smudge, so the core edge is kept sharp and a
    few tight growth rings are wrapped around it — that's what makes the eye read
    'knot' rather than 'stain'.
    """
    a = np.asarray(img).astype(np.float64)
    cy = float(rng.integers(170, H - 170))
    cx = float(rng.integers(120, W - 120))
    rx = float(rng.integers(15, 21))
    ry = rx * float(rng.uniform(1.35, 1.8))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    dy = np.minimum(np.abs(yy - cy), H - np.abs(yy - cy))
    dx = xx - cx
    # Slight irregularity so the knot isn't a perfect ellipse.
    wobble = 1.0 + 0.12 * np.sin(np.arctan2(dy, dx) * 3.0 + 0.7)
    d = np.sqrt((dx / rx) ** 2 + (dy / ry) ** 2) / wobble

    # Hard dark core with a narrow transition.
    core = 1.0 / (1.0 + np.exp((d - 1.0) * 9.0))
    # Tight rings hugging the core, fading out quickly.
    ring_zone = np.clip((d - 0.9) / 1.5, 0, 1)
    rings = 0.5 + 0.5 * np.cos(d * 7.5)
    ring_fade = np.clip(1.0 - (d - 0.9) / 1.5, 0, 1) ** 1.4 * (d > 0.9)

    darken = 1.0 - 0.80 * core - 0.26 * rings * ring_fade
    # Faint light halo just outside, as if grain is compressed around the knot.
    halo = np.clip(1.0 - np.abs(d - 2.5) / 0.8, 0, 1) * 0.10
    darken = darken + halo * (1 - core)

    a *= np.clip(darken, 0, 1.2)[:, :, None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def make_ice(rng):
    """Cracked ice: pale blue with internal fractures and trapped bubbles."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    base = fbm((H, W), 120, 340, 3, rng)
    # Fracture planes: sharp ridges where a smooth field crosses zero.
    f1 = fbm((H, W), 90, 260, 2, rng)
    f2 = fbm((H, W), 45, 150, 3, rng)
    cracks = np.exp(-np.abs(f1) * 26) * 0.9 + np.exp(-np.abs(f2) * 34) * 0.5
    depth = 0.55 + 0.35 * base

    rgb = np.zeros((H, W, 3))
    rgb[:, :, 0] = 176 + 46 * depth
    rgb[:, :, 1] = 214 + 34 * depth
    rgb[:, :, 2] = 236 + 19 * depth
    rgb += (cracks * 62)[:, :, None] * np.array([0.75, 0.9, 1.0])[None, None, :]

    # Trapped bubbles.
    b = rng.random((H, W))
    bub = (b > 0.9990).astype(np.float64)
    bub = np.maximum(bub, np.roll(bub, 1, 0) * 0.6)
    bub = np.maximum(bub, np.roll(bub, 1, 1) * 0.6)
    rgb += (bub * 40)[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


METALS = {
    # dark = shadow tint, mid = body colour, hot = specular highlight tint.
    "steel":  dict(dark=(38, 44, 52),   mid=(150, 158, 168), hot=(250, 253, 255), bands=[(0.30, 0.09, 1.0), (0.66, 0.05, 0.62)]),
    "copper": dict(dark=(58, 24, 12),   mid=(190, 104, 62),  hot=(255, 214, 178), bands=[(0.36, 0.10, 1.0), (0.74, 0.06, 0.55)]),
    "brass":  dict(dark=(60, 44, 10),   mid=(196, 158, 66),  hot=(255, 240, 178), bands=[(0.32, 0.11, 1.0), (0.70, 0.06, 0.60)]),
    # Added 2026-09-19. Blued steel: the dark end of the metal set, so a metal board is
    # not always a bright one. The highlight stays cold and narrow — blueing is a thin
    # oxide over polished steel, not a matte paint.
    "blued":  dict(dark=(14, 18, 34),   mid=(58, 70, 104),   hot=(214, 228, 255), bands=[(0.28, 0.08, 1.0), (0.62, 0.05, 0.70)]),
}


def make_metal(cfg, rng):
    """Rolled metal sheet.

    What sells metal is not the hue but the LIGHT: a very high dynamic range along the
    brush direction, narrow blown-out specular bands, and a shadow tint that is much
    darker and cooler than a simple darkening of the body colour.
    """
    xx = np.mgrid[0:H, 0:W][1].astype(np.float64)

    # Metal is mostly a SMOOTH broad reflection. Heavy fine striping reads as brushed
    # fabric, not sheet metal, so the brushing here is deliberately faint and the
    # broad undulation carries most of the variation.
    brush = fbm((H, W), 1.8, 340, 3, rng)
    micro = fbm((H, W), 0.9, 120, 2, rng)
    broad = fbm((H, W), 230, 1700, 2, rng)
    swell = fbm((H, W), 420, 2600, 1, rng)

    v = 0.46 + 0.11 * brush + 0.05 * micro + 0.30 * broad + 0.20 * swell
    spec = np.zeros((H, W))
    for centre, width, amp in cfg["bands"]:
        spec += amp * np.exp(-((xx / W - centre) / width) ** 2)
    spec *= (0.80 + 0.30 * broad)
    v = np.clip(v + spec * 1.05, 0.0, 1.9)

    dark = np.array(cfg["dark"], dtype=np.float64)
    mid = np.array(cfg["mid"], dtype=np.float64)
    hot = np.array(cfg["hot"], dtype=np.float64)

    t = np.clip(v, 0, 1)[:, :, None]
    rgb = dark[None, None, :] * (1 - t) + mid[None, None, :] * t
    over = np.clip(v - 1.0, 0, 0.9)[:, :, None]
    rgb = rgb * (1 - over) + hot[None, None, :] * over

    # A few sparse hairline scratches, not an all-over brush.
    sc = fbm((H, W), 1.2, 620, 1, rng)
    scratch = np.clip(np.abs(sc) - 0.78, 0, None) * 5.0
    rgb += (scratch * 55)[:, :, None]

    # Pitting and dirt.
    p = rng.random((H, W))
    pit = (p > 0.9990).astype(np.float64)
    pit = np.maximum(pit, np.roll(pit, 1, 0) * 0.6)
    rgb *= (1.0 - 0.45 * pit)[:, :, None]

    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_weathered(rng):
    """Old grey barn board: silvered surface, deep splits, a little moss."""
    xx = np.mgrid[0:H, 0:W][1].astype(np.float64)
    wander = fbm((H, W), 260, 1800, 2, rng) * 30 + fbm((H, W), 120, 500, 3, rng) * 18
    phase = (xx + wander) / 30.0
    rings = np.abs(((phase % 1.0) * 2.0) - 1.0) ** 2.2
    fibre = fbm((H, W), 3.0, 110, 3, rng)
    grain = rings + 0.30 * fibre
    grain = (grain - grain.min()) / (np.ptp(grain) + 1e-9)

    rgb = ramp(grain, [
        (0.00, (176, 172, 162)), (0.40, (150, 146, 137)),
        (0.72, (116, 112, 104)), (1.00, (78, 75, 70))])

    # Deep splits running along the board.
    s1 = fbm((H, W), 40, 900, 2, rng)
    splits = np.exp(-np.abs(s1) * 30)
    rgb *= (1.0 - 0.72 * splits)[:, :, None]

    # Patches of green-grey moss in the low areas.
    moss = np.clip(fbm((H, W), 130, 420, 3, rng) * 2.2 - 0.5, 0, 1)
    rgb[:, :, 0] *= (1 - 0.22 * moss)
    rgb[:, :, 1] *= (1 + 0.10 * moss)
    rgb[:, :, 2] *= (1 - 0.16 * moss)

    # Worm holes.
    p = rng.random((H, W))
    holes = (p > 0.99955).astype(np.float64)
    holes = np.maximum(holes, np.roll(holes, 1, 0) * 0.8)
    holes = np.maximum(holes, np.roll(holes, 1, 1) * 0.8)
    rgb *= (1.0 - 0.75 * holes)[:, :, None]

    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")



# =====================================================================================
# 2026-09-26: the roster went from 15 boards to 48. The owner's note was that there
# are "dozens of vastly different looking woods and at least a few different types of
# metal", and that is true: the game had nine woods, most of them brown. Every board
# below was picked because it LOOKS different at a glance — a colour nothing else has
# (padauk, yellowheart, bloodwood, holly), a figure nothing else has (bird's-eye, burl,
# spalting, olive, lacewood), or a surface nothing else has (driftwood, charred,
# painted, bamboo) — not because it is another name for a brown board.
#
# Rule kept from the seam fix: NOTHING in a texture may form a straight full-width
# line across the board. A horizontal mark across the whole width reads as the seam
# the owner reported, whatever it is meant to be.
# =====================================================================================

MORE_SPECIES = {
    "redwood": dict(ring_period=30, warp=14, sharp=2.4, knot=False, stops=[
        (0.00, (214, 124, 88)), (0.40, (192, 100, 66)),
        (0.72, (156, 72, 46)), (1.00, (108, 44, 30))]),
    "padauk": dict(ring_period=26, warp=12, sharp=2.6, knot=False, stops=[
        (0.00, (240, 116, 66)), (0.40, (220, 92, 50)),
        (0.72, (184, 64, 36)), (1.00, (132, 40, 22))]),
    "bloodwood": dict(ring_period=22, warp=10, sharp=3.0, knot=False, stops=[
        (0.00, (178, 50, 44)), (0.40, (152, 36, 34)),
        (0.72, (118, 24, 26)), (1.00, (78, 12, 16))]),
    "yellowheart": dict(ring_period=36, warp=16, sharp=2.4, knot=False, stops=[
        (0.00, (248, 220, 104)), (0.40, (238, 200, 74)),
        (0.72, (214, 170, 50)), (1.00, (172, 128, 30))]),
    "teak": dict(ring_period=28, warp=18, sharp=2.8, knot=False, streaks=[((70, 48, 26), 0.55, 9)], stops=[
        (0.00, (208, 162, 96)), (0.40, (188, 140, 78)),
        (0.72, (154, 108, 56)), (1.00, (112, 76, 38))]),
    # Ribbon stripe: tight, dead-straight rings with almost no arching.
    "mahogany": dict(ring_period=15, warp=5, sharp=1.5, knot=False, stops=[
        (0.00, (182, 94, 64)), (0.40, (160, 76, 50)),
        (0.72, (128, 56, 36)), (1.00, (92, 38, 24))]),
    # Ash: pale, with bold dark latewood — the strongest grain on a pale board.
    "ash": dict(ring_period=30, warp=22, sharp=4.2, knot=True, stops=[
        (0.00, (238, 224, 198)), (0.46, (224, 206, 172)),
        (0.78, (178, 152, 114)), (1.00, (118, 94, 64))]),
    "holly": dict(ring_period=70, warp=9, sharp=1.4, knot=False, stops=[
        (0.00, (248, 245, 234)), (0.40, (240, 235, 220)),
        (0.74, (226, 219, 200)), (1.00, (204, 195, 172))]),
    # Aromatic cedar: purple-red heartwood with cream sapwood streaks and knots.
    "cedar": dict(ring_period=24, warp=20, sharp=2.6, knot=True, streaks=[((236, 214, 170), 0.85, 16)], stops=[
        (0.00, (206, 120, 102)), (0.40, (184, 98, 86)),
        (0.72, (150, 72, 66)), (1.00, (104, 46, 44))]),
    "rosewood": dict(ring_period=21, warp=24, sharp=3.2, knot=False, streaks=[((16, 8, 8), 0.8, 6)], stops=[
        (0.00, (128, 66, 50)), (0.36, (100, 48, 38)),
        (0.66, (68, 30, 26)), (1.00, (32, 14, 14))]),
    # Wenge: fine, near-black and chocolate pinstripes.
    "wenge": dict(ring_period=11, warp=5, sharp=2.6, knot=False, stops=[
        (0.00, (110, 80, 56)), (0.36, (82, 58, 40)),
        (0.62, (42, 30, 22)), (1.00, (16, 11, 9))]),
    "bubinga": dict(ring_period=20, warp=34, sharp=2.6, knot=False, stops=[
        (0.00, (204, 118, 96)), (0.40, (182, 98, 80)),
        (0.72, (146, 70, 58)), (1.00, (100, 44, 38))]),
    # Bocote and ziricote: wild, heavily warped black lines. The warp is what does it.
    "bocote": dict(ring_period=26, warp=64, sharp=5.0, knot=False, stops=[
        (0.00, (228, 182, 102)), (0.45, (208, 156, 78)),
        (0.62, (98, 64, 30)), (1.00, (32, 20, 10))]),
    "ziricote": dict(ring_period=20, warp=90, sharp=1.2, knot=False, contours=((200, 190, 170), 0.55, 9.0), stops=[
        (0.00, (96, 80, 62)), (0.40, (74, 60, 46)),
        (0.72, (46, 36, 28)), (1.00, (22, 17, 13))]),
    "olive": dict(ring_period=34, warp=70, sharp=1.6, knot=False, contours=((78, 54, 30), 0.85, 6.0), stops=[
        (0.00, (232, 212, 168)), (0.40, (220, 196, 148)),
        (0.72, (196, 166, 118)), (1.00, (160, 126, 82))]),
    # Rainbow poplar: the green-and-purple board. Nothing else in the set is either.
    "rainbow": dict(ring_period=40, warp=16, sharp=1.8, knot=False,
                    streaks=[((126, 84, 140), 0.75, 22), ((96, 146, 104), 0.7, 26), ((70, 96, 120), 0.5, 12)], stops=[
        (0.00, (214, 210, 174)), (0.40, (200, 196, 158)),
        (0.72, (176, 170, 134)), (1.00, (140, 132, 100))]),
    "spalted": dict(ring_period=42, warp=30, sharp=2.0, knot=False, spalt=True, stops=[
        (0.00, (238, 222, 192)), (0.42, (226, 206, 170)),
        (0.74, (204, 178, 136)), (1.00, (170, 142, 102))]),
    "birdseye": dict(ring_period=40, warp=26, sharp=2.0, knot=False, eyes=True, stops=[
        (0.00, (244, 226, 190)), (0.42, (234, 210, 170)),
        (0.74, (212, 182, 138)), (1.00, (180, 146, 104))]),
}


def contours_overlay(rgb, rng, colour, amount, freq):
    """Thin meandering lines: the zero-crossings of a warped field (olive, ziricote)."""
    f = fbm((H, W), 90, 260, 3, rng) * freq + fbm((H, W), 30, 90, 2, rng) * 1.2
    line = np.exp(-np.abs(np.sin(f * np.pi)) * 14.0)
    a = (line * amount)[:, :, None]
    return rgb * (1 - a) + np.array(colour)[None, None, :] * a


def streaks_overlay(rgb, rng, streaks):
    """Colour streaks running WITH the grain: sapwood, mineral streaks, rainbow poplar."""
    xx = np.mgrid[0:H, 0:W][1].astype(np.float64)
    for colour, amount, width in streaks:
        wander = fbm((H, W), 200, 1600, 2, rng) * 60 + fbm((H, W), 60, 400, 2, rng) * 14
        field = fbm((H, W), width * 1.6, 900, 2, rng)
        # A few bands, not an all-over tint: only the peaks of a stretched field.
        m = np.clip((field - 0.25) * 3.0, 0, 1) * np.clip(0.6 + 0.4 * np.sin((xx + wander) / (width * 3)), 0, 1)
        a = (m * amount)[:, :, None]
        rgb = rgb * (1 - a) + np.array(colour)[None, None, :] * a
    return rgb


def spalt_overlay(rgb, rng):
    """Spalting: fungal zone lines — thin black lines wandering in every direction —
    over grey-brown mottling."""
    f = fbm((H, W), 160, 220, 3, rng)
    lines = np.exp(-np.abs(np.sin(f * 7.0)) * 22.0)
    mott = np.clip(fbm((H, W), 120, 200, 3, rng) * 2.0, 0, 1)
    rgb = rgb * (1 - 0.35 * mott[:, :, None]) + np.array([150, 138, 120])[None, None, :] * 0.35 * mott[:, :, None]
    a = (lines * 0.85)[:, :, None]
    return rgb * (1 - a) + np.array([30, 24, 20])[None, None, :] * a


def eyes_overlay(rgb, rng, n=90):
    """Bird's-eye figure: many tiny round eyes, each a dark dot with a pale ring."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    out = rgb.copy()
    for _ in range(n):
        cy, cx = rng.uniform(0, H), rng.uniform(10, W - 10)
        r = rng.uniform(2.2, 4.2)
        dy = np.minimum(np.abs(yy - cy), H - np.abs(yy - cy))
        d = np.sqrt((xx - cx) ** 2 + (dy * 0.8) ** 2) / r
        core = np.clip(1.2 - d, 0, 1)
        ring = np.exp(-((d - 1.9) ** 2) * 2.0) * 0.5
        out *= (1 - 0.55 * core - 0.12 * ring)[:, :, None]
    return out


def make_species2(cfg, rng):
    img = make_species(cfg, rng)
    rgb = np.asarray(img).astype(np.float64)
    if cfg.get("streaks"):
        rgb = streaks_overlay(rgb, rng, cfg["streaks"])
    if cfg.get("contours"):
        rgb = contours_overlay(rgb, rng, *cfg["contours"])
    if cfg.get("spalt"):
        rgb = spalt_overlay(rgb, rng)
    if cfg.get("eyes"):
        rgb = eyes_overlay(rgb, rng)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def periodic_voronoi(cw, ch, rng, jitter=0.85):
    """Voronoi over a grid of jittered points, wrapping on both axes. W/cw and H/ch
    must be whole numbers. Returns (F1, F2, cell id)."""
    nx, ny = W // cw, H // ch
    px = (np.arange(nx)[None, :] + 0.5 + (rng.random((ny, nx)) - 0.5) * jitter) * cw
    py = (np.arange(ny)[:, None] + 0.5 + (rng.random((ny, nx)) - 0.5) * jitter) * ch
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    gx, gy = (xx // cw).astype(int), (yy // ch).astype(int)
    f1 = np.full((H, W), 1e9)
    f2 = np.full((H, W), 1e9)
    cid = np.zeros((H, W), dtype=int)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx, cy = gx + ox, gy + oy
            wx, wy = cx % nx, cy % ny
            qx = px[wy, wx] + (cx - wx) * cw
            qy = py[wy, wx] + (cy - wy) * ch
            d = np.sqrt((xx - qx) ** 2 + (yy - qy) ** 2)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, wy * nx + wx, cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def make_burl(rng):
    """Burl: no straight grain at all — broad swirling figure, dense with small dark
    eyes that gather in clusters."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    swirl = fbm((H, W), 150, 170, 3, rng) * 5 + fbm((H, W), 40, 46, 3, rng) * 1.3
    rings = np.abs(((swirl % 1.0) * 2) - 1) ** 1.6
    g = 0.75 * rings + 0.25 * fbm((H, W), 10, 12, 3, rng)
    g = (g - g.min()) / (np.ptp(g) + 1e-9)
    rgb = ramp(g, [(0.0, (196, 138, 86)), (0.45, (160, 106, 62)), (0.75, (118, 74, 42)), (1.0, (70, 42, 24))])
    cluster = np.clip(fbm((H, W), 120, 120, 2, rng) * 3, 0, 1)
    f1, _, _ = periodic_voronoi(32, 32, rng)
    eye = np.exp(-(f1 / 3.2) ** 2) * cluster
    halo = np.exp(-((f1 - 6) / 2.5) ** 2) * cluster * 0.25
    rgb *= (1 - 0.75 * eye - halo)[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_lacewood(rng):
    """Lacewood: quartersawn London plane — straight pinkish grain covered in small
    darker ray flecks, stretched along the board."""
    grain = np.asarray(make_species(dict(ring_period=40, warp=12, sharp=1.6, knot=False, stops=[
        (0.00, (230, 178, 142)), (0.45, (214, 160, 124)),
        (0.75, (190, 134, 100)), (1.00, (156, 104, 74))]), rng)).astype(np.float64)
    # Flecks are the peaks of a noise field stretched ALONG the grain: separate little
    # lenses, never a network. (Voronoi cells read as snakeskin — borders everywhere.)
    f = fbm((H, W), 5, 22, 2, rng)
    fleck = np.clip((f - 0.18) * 4.0, 0, 1)
    core = np.clip((f - 0.34) * 5.0, 0, 1)
    rgb = grain * (1 - 0.30 * fleck[:, :, None]) * (1 + 0.10 * core[:, :, None])
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_charred(rng):
    """Shou sugi ban: charred black board, cracked into alligator blocks that run
    ACROSS the grain, with a faint silver sheen on each block's crown."""
    # Cells must divide 512x1024 exactly or the texture stops tiling (24 did not).
    f1, f2, _ = periodic_voronoi(64, 32, rng, jitter=0.7)
    crack = np.exp(-((f2 - f1) / 2.2) ** 2)
    crown = np.clip(1 - f1 / 16.0, 0, 1)
    grain = fbm((H, W), 2.5, 120, 3, rng)
    v = 34 + 26 * crown + 10 * grain
    rgb = np.stack([v * 1.02, v * 0.98, v * 0.95], axis=2)
    rgb *= (1 - 0.8 * crack)[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_bamboo(rng):
    """Strand bamboo: laminated vertical strips of slightly different tone, each with
    its own staggered nodes — never a node across the whole board."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    rgb = np.zeros((H, W, 3))
    edges = [0]
    while edges[-1] < W:
        edges.append(edges[-1] + int(rng.integers(34, 52)))
    edges[-1] = W
    fibre = fbm((H, W), 1.5, 140, 3, rng)
    for i in range(len(edges) - 1):
        x0, x1 = edges[i], edges[i + 1]
        tone = rng.uniform(-14, 14)
        base = np.array([222 + tone, 194 + tone, 132 + tone * 0.8])
        sl = (slice(None), slice(x0, x1))
        rgb[sl] = base[None, None, :] * (1 + 0.06 * fibre[sl])[:, :, None]
        for _ in range(2):
            ny = rng.uniform(0, H)
            d = np.minimum(np.abs(yy[sl] - ny), H - np.abs(yy[sl] - ny))
            node = np.exp(-(d / 3.5) ** 2) * 0.24 - np.exp(-((d - 6) / 3.5) ** 2) * 0.08
            rgb[sl] *= (1 - node)[:, :, None]
        rgb[:, x0:x0 + 1] *= 0.72
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_painted(rng):
    """An old painted board: teal paint worn and chipped back to the pine under it."""
    wood = np.asarray(make_species(SPECIES["pine"], rng)).astype(np.float64)
    wear = fbm((H, W), 60, 180, 4, rng) + 0.35 * fbm((H, W), 6, 30, 2, rng)
    paint = np.clip((wear + 0.08) * 12, 0, 1)
    edge = np.exp(-((wear + 0.08) * 12 - 0.5) ** 2 * 3) * 0.3
    colour = np.array([70, 150, 150]) * (1 + 0.06 * fbm((H, W), 40, 120, 2, rng))[:, :, None]
    rgb = wood * (1 - paint[:, :, None]) + colour * paint[:, :, None]
    rgb *= (1 - edge)[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_driftwood(rng):
    """Driftwood: sea-bleached silver-beige, smooth, with soft eroded grooves along
    the grain. Paler and cleaner than barn board — no moss, no worm holes."""
    xx = np.mgrid[0:H, 0:W][1].astype(np.float64)
    wander = fbm((H, W), 260, 1800, 2, rng) * 44 + fbm((H, W), 120, 600, 3, rng) * 20
    phase = (xx + wander) / 44.0
    groove = np.abs(((phase % 1.0) * 2.0) - 1.0) ** 1.6
    soft = fbm((H, W), 80, 600, 3, rng)
    g = 0.65 * groove + 0.25 * soft + 0.10 * fbm((H, W), 3, 90, 2, rng)
    g = (g - g.min()) / (np.ptp(g) + 1e-9)
    rgb = ramp(g, [(0.0, (222, 216, 202)), (0.45, (198, 190, 174)), (0.75, (166, 158, 144)), (1.0, (120, 112, 102))])
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


MORE_METALS = {
    "aluminium": dict(dark=(92, 98, 106), mid=(196, 202, 208), hot=(255, 255, 255), bands=[(0.34, 0.12, 0.8), (0.72, 0.07, 0.5)]),
    "gold":      dict(dark=(82, 54, 8),   mid=(224, 176, 56),  hot=(255, 246, 190), bands=[(0.30, 0.10, 1.0), (0.68, 0.06, 0.6)]),
}


def make_damascus(rng):
    """Pattern-welded steel: dozens of folded layers, etched so they alternate bright
    and dark, flowing in waves down the blade."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    warp = fbm((H, W), 200, 400, 3, rng) * 90 + fbm((H, W), 50, 120, 2, rng) * 16
    phase = (xx + warp) / 9.0
    layer = 0.5 + 0.5 * np.sin(phase * np.pi * 2)
    layer = layer ** 1.6
    v = 60 + 150 * layer + 16 * fbm((H, W), 2, 200, 2, rng)
    rgb = np.stack([v * 0.96, v * 0.99, v * 1.04], axis=2)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_bolted(rng):
    """A steel plate bolted down both edges: hex bolt heads with washers, lit from the
    top left, each throwing a short shadow."""
    base = np.asarray(make_metal(METALS["steel"], rng)).astype(np.float64) * 0.9
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    out = base.copy()
    for cx in (46, W - 46):
        for k in range(4):
            cy = 128 + k * 256 + (64 if cx > W / 2 else 0)
            dx, dy = xx - cx, yy - cy
            r = np.sqrt(dx * dx + dy * dy)
            ang = np.arctan2(dy, dx)
            # Shadow first, offset down-right.
            sd = np.sqrt((dx - 5) ** 2 + (dy - 6) ** 2)
            out *= (1 - 0.45 * np.clip(1 - (sd - 17) / 6, 0, 1))[:, :, None]
            washer = (r < 21) & (r >= 16)
            hexr = 14 / np.cos(((ang + np.pi / 6) % (np.pi / 3)) - np.pi / 6)
            head = r < hexr
            light = np.clip(0.55 - (dx + dy) / 60, 0.1, 1.0)
            wcol = np.array([150, 156, 164])
            hcol = np.array([176, 182, 190])
            out[washer] = (wcol[None, :] * (0.7 + 0.5 * light[washer][:, None]))
            out[head] = (hcol[None, :] * (0.55 + 0.8 * light[head][:, None]))
            rim = head & (r > hexr - 2.2)
            out[rim] *= 0.72
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def make_diamond(rng):
    """Diamond tread plate: raised elongated lugs in alternating directions, each lit
    on its upper-left flank. 64px cells, so it tiles exactly."""
    base = np.asarray(make_metal(MORE_METALS["aluminium"], rng)).astype(np.float64) * 0.92
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    out = base.copy()
    c = 64
    for flip in (0, 1):
        ox = (xx + flip * c / 2) % c - c / 2
        oy = (yy + flip * c / 2) % c - c / 2
        a = np.pi / 4 if ((flip == 0)) else -np.pi / 4
        u = ox * np.cos(a) + oy * np.sin(a)
        v = -ox * np.sin(a) + oy * np.cos(a)
        lug = (np.abs(u) / 22) ** 2 + (np.abs(v) / 5) ** 2
        m = lug < 1
        grad = np.clip(-(u * np.cos(a) + v * -np.sin(a)) / 22 - v / 5 * 0.6, -1, 1)
        out[m] *= (1.0 + 0.35 * grad[m])[:, None]
        edge = (lug >= 1) & (lug < 1.5)
        out[edge] *= 0.8
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def make_rusted(rng):
    """Weathering steel gone to rust: orange-brown bloom, darker scale, pitting and a
    few run streaks down the plate."""
    a = fbm((H, W), 60, 120, 5, rng)
    b = fbm((H, W), 8, 14, 3, rng)
    g = np.clip(0.5 + 0.55 * a + 0.2 * b, 0, 1)
    rgb = ramp(g, [(0.0, (70, 34, 20)), (0.35, (122, 56, 28)), (0.65, (170, 86, 40)), (1.0, (206, 124, 62))])
    runs = np.clip(fbm((H, W), 6, 700, 2, rng) * 3 - 1.2, 0, 1)
    rgb *= (1 - 0.35 * runs)[:, :, None]
    p = rng.random((H, W))
    pit = (p > 0.9975).astype(np.float64)
    pit = np.maximum(pit, np.roll(pit, 1, 0) * 0.7)
    rgb *= (1 - 0.6 * pit)[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_titanium(rng):
    """Heat-tinted titanium: the oxide rainbow — straw, bronze, violet, blue — in
    broad flowing bands over brushed metal."""
    xx = np.mgrid[0:H, 0:W][1].astype(np.float64)
    t = (xx / W) + 0.28 * fbm((H, W), 200, 900, 3, rng)
    t = (t % 1.0)
    rgb = ramp(t, [(0.0, (212, 190, 120)), (0.2, (184, 128, 70)), (0.4, (134, 70, 128)),
                   (0.6, (64, 88, 176)), (0.8, (96, 176, 206)), (1.0, (212, 190, 120))])
    brush = fbm((H, W), 1.6, 300, 3, rng)
    rgb *= (1 + 0.10 * brush)[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_galvanized(rng):
    """Hot-dip galvanised sheet: the zinc 'spangle' — large crystal cells that catch
    the light differently, each feathered inside, over a normal metal reflection."""
    base = np.asarray(make_metal(MORE_METALS["aluminium"], rng)).astype(np.float64)
    f1, f2, cid = periodic_voronoi(128, 128, rng)
    rs = np.random.default_rng(77)
    tone = rs.uniform(-1, 1, cid.max() + 1)[cid]
    ang = rs.uniform(0, np.pi, cid.max() + 1)[cid]
    # Feathering from wrapped noise, stretched one way or the other per crystal. (A
    # sine of y does not wrap at 1024 and left a seam where the texture repeats.)
    feather = np.where(ang < np.pi / 2, fbm((H, W), 1.5, 26, 2, rng), fbm((H, W), 26, 1.5, 2, rng)) * 0.5 + 0.5
    k = 1 + 0.10 * tone + 0.05 * feather
    edge = np.exp(-((f2 - f1) / 1.4) ** 2)
    rgb = base * (k * (1 - 0.12 * edge))[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_verdigris(rng):
    """Copper gone green: blue-green patina over the copper, worn through to bright
    metal on the high spots."""
    cu = np.asarray(make_metal(METALS["copper"], rng)).astype(np.float64)
    pat = fbm((H, W), 50, 110, 5, rng) + 0.3 * fbm((H, W), 6, 12, 3, rng)
    m = np.clip((pat + 0.15) * 4, 0, 1)
    green = ramp(np.clip(0.5 + fbm((H, W), 20, 40, 3, rng), 0, 1),
                 [(0.0, (60, 130, 110)), (0.5, (96, 172, 150)), (1.0, (150, 206, 186))])
    rgb = cu * (1 - m[:, :, None]) + green * m[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def make_more(save):
    for i, (name, cfg) in enumerate(MORE_SPECIES.items()):
        rng = np.random.default_rng(5300 + i * 37)
        img = make_species2(cfg, rng)
        if cfg["knot"]:
            img = add_knot(img, rng)
        save(name, img.filter(ImageFilter.SMOOTH))
    for i, fn in enumerate((make_burl, make_lacewood, make_charred, make_bamboo, make_painted, make_driftwood)):
        save(fn.__name__[5:], fn(np.random.default_rng(6100 + i * 13)).filter(ImageFilter.SMOOTH))
    for i, (name, cfg) in enumerate(MORE_METALS.items()):
        save(name, make_metal(cfg, np.random.default_rng(9700 + i * 57)))
    for i, fn in enumerate((make_damascus, make_bolted, make_diamond, make_rusted, make_titanium,
                            make_galvanized, make_verdigris)):
        save(fn.__name__[5:], fn(np.random.default_rng(9900 + i * 29)))


def main(only=None):
    out_dir = os.path.join(os.path.dirname(__file__), "..", "assets", "wood")
    os.makedirs(out_dir, exist_ok=True)

    def save(name, img):
        path = os.path.join(out_dir, f"{name}.jpg")
        img.save(path, quality=86, optimize=True, progressive=True)
        print(f"{name:10s} {os.path.getsize(path)/1024:7.1f} KB")

    if only == "more":
        make_more(save)
        return
    save("ice", make_ice(np.random.default_rng(8801)).filter(ImageFilter.SMOOTH))
    save("weathered", make_weathered(np.random.default_rng(8803)).filter(ImageFilter.SMOOTH))
    for i, (name, cfg) in enumerate(METALS.items()):
        # Metals keep their hard specular edges, so no SMOOTH pass.
        save(name, make_metal(cfg, np.random.default_rng(9100 + i * 57)))

    for i, (name, cfg) in enumerate(SPECIES.items()):
        rng = np.random.default_rng(4200 + i * 91)
        img = make_species(cfg, rng)
        if cfg["knot"]:
            img = add_knot(img, rng)
        img = img.filter(ImageFilter.SMOOTH)
        # JPEG rather than WebP: universally supported with zero fallback logic,
        # and grain is photographic so it compresses well.
        path = os.path.join(out_dir, f"{name}.jpg")
        img.save(path, quality=86, optimize=True, progressive=True)
        print(f"{name:8s} {os.path.getsize(path)/1024:7.1f} KB  {path}")
    make_more(save)


if __name__ == "__main__":
    import sys
    # `--more` regenerates only the 2026-09-26 additions, leaving the originals as-is.
    main("more" if "--more" in sys.argv else None)
