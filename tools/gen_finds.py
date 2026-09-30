"""Generates the odd-find sprites.

Run:  python3 tools/gen_finds.py
Out:  assets/finds/<type>.png   (9 x 224px frames in one strip, 256-colour RGBA)

Why these exist: the finds used to be drawn live from Canvas paths. The first set was
flat vector cartoons (clipart); the second was lit salvage, but five of its six objects
were small discs seen square-on — coin, marble, screw head, nail head, bottle cap — and
at play size the owner could not tell what any of them were. Two changes fix that:

  * SILHOUETTE FIRST. Every object is picked because its outline alone names it: a nail
    and a screw lying on their sides (head, shank, point, threads), a skeleton key, a
    horseshoe, a pocket watch on its chain, and one coin with a milled rim and a big
    struck numeral. Nothing else in the set is a plain disc.
  * RENDERED, NOT PAINTED. Each object is modelled as a height field and shaded here with
    real normals, self-shadowing, ambient occlusion and a reflected workshop environment
    for the metals — the same "real image file, not code-drawn" rule the wood and the
    machine already follow (guidelines §8.4).

Lighting: the work lamp hangs over the blade, and each find is lit from wherever that is
relative to it. So each strip holds 8 frames lit from 8 azimuths at a raking elevation
(frame i: light arrives FROM angle i*45deg, screen coordinates, y down, 0 = +x) plus a
9th lit from high overhead (62deg — any steeper and every flat metal top mirrors the
lamp and blows out to white). render.js picks and cross-fades frames at runtime,
correcting for the object's own rotation. The cast shadow is baked into each frame, so it
always falls away from the lamp.

Frames are drawn with the object's long axis vertical (head/bow at the top).
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

F = 224          # output frame size, px (sized for a 3x phone at the in-game draw scale)
SS = 3           # supersampling
N = F * SS
EXT = 60.0       # frame covers -EXT..EXT world units on both axes
DU = 2 * EXT / N  # world units per supersampled pixel

_c = (np.arange(N) + 0.5) * DU - EXT
X, Y = np.meshgrid(_c, _c)

LAMP = np.array([1.0, 0.93, 0.80])
FONT_SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'


# --- Signed distance helpers (negative inside) ------------------------------

def sd_circle(cx, cy, r):
    return np.hypot(X - cx, Y - cy) - r


def sd_box(cx, cy, hw, hh, rad=0.0):
    qx = np.abs(X - cx) - hw + rad
    qy = np.abs(Y - cy) - hh + rad
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - rad


def sd_capsule(ax, ay, bx, by, r):
    px, py = X - ax, Y - ay
    vx, vy = bx - ax, by - ay
    t = np.clip((px * vx + py * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - vx * t, py - vy * t) - r


def sd_ring(cx, cy, r, half_w):
    return np.abs(np.hypot(X - cx, Y - cy) - r) - half_w


def rounded(sdf, thick, bevel):
    """Height for a flat-topped solid with a rounded edge."""
    d = np.clip(-sdf / bevel, 0, 1)
    return thick * np.sqrt(1 - (1 - d) ** 2) * (sdf < 0)


def tube(sdf, r):
    """Height for a round bar whose half-width at this point is r: a true cylinder."""
    inside = np.clip(-sdf, 0, None)
    # distance from the bar's centre line = r - inside
    return np.sqrt(np.clip(r * r - (r - np.minimum(inside, r)) ** 2, 0, None)) * (sdf < 0)


def noise(scale, rng):
    white = rng.standard_normal((N, N))
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    rad = np.hypot(fx, fy) * N * DU / scale
    out = np.real(np.fft.ifft2(np.fft.fft2(white) / (1 + rad ** 4)))
    return out / (np.abs(out).max() + 1e-9)


def blur(a, sigma_units):
    s = sigma_units / DU
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    g = np.exp(-2 * (np.pi * s) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def text_mask(text, cx, cy, size_units, font=FONT_SERIF):
    img = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(font, int(size_units / DU))
    px, py = (cx + EXT) / DU, (cy + EXT) / DU
    d.text((px, py), text, fill=255, font=f, anchor='mm')
    return np.asarray(img, float) / 255


def col(rgb):
    return np.broadcast_to(np.array(rgb, float), (N, N, 3)).copy()


def mix(a, b, t):
    return a * (1 - t[..., None]) + b * t[..., None]


# --- Objects ----------------------------------------------------------------
# Each returns dict(mask, h, alb, metal, shin, [glass]) in world units.

def coin():
    rng = np.random.default_rng(11)
    R = 32.0
    r = np.hypot(X, Y)
    ang = np.arctan2(Y, X)
    mask = r < R
    h = rounded(r - R, 3.4, 1.6)
    field = r < R - 4.2
    h = np.where(field, 2.3, h)
    # Milled edge.
    h += np.where((r > R - 2.6) & mask, 0.35 * np.sin(ang * 110), 0)
    # Raised bead ring and a big struck numeral.
    beads = (np.abs(r - (R - 7.5)) < 1.1) & (np.cos(ang * 36) > 0.2)
    h += beads * 0.9
    num = blur(text_mask('25', 0, 1.5, 30), 0.35)
    h += np.clip(num, 0, 1) * 1.5 * field
    h = np.where(mask, h, 0)

    base = mix(col([1.0, 0.80, 0.40]), col([0.82, 0.58, 0.26]), np.clip(noise(9, rng) * 0.8 + 0.3, 0, 1))
    # Tarnish sits in the recesses; the high points are rubbed bright.
    low = np.clip((2.8 - h) / 1.2, 0, 1) * field
    alb = mix(base, col([0.50, 0.36, 0.16]), low * 0.35)
    return dict(mask=mask.astype(float), h=h, alb=alb, metal=np.ones((N, N)), shin=np.full((N, N), 60.0))


def key():
    rng = np.random.default_rng(12)
    bow = sd_ring(0, -33, 11.5, 4.0)
    shaft = sd_capsule(0, -20, 0, 44, 3.7)
    collar = np.minimum(sd_box(0, -17.5, 6.5, 2.0, 1.0), sd_box(0, -12.5, 5.2, 1.5, 0.8))
    bit = sd_box(8.5, 36.5, 8.5, 8.5, 0.8)
    notch1 = sd_box(10.5, 30, 2.2, 3.4)
    notch2 = sd_box(15.5, 39.5, 2.8, 2.0)
    bit = np.maximum(bit, -np.minimum(notch1, notch2))
    solid = np.minimum(np.minimum(np.minimum(bow, shaft), collar), bit)
    mask = solid < 0
    h = np.maximum.reduce([
        tube(bow, 4.0) * 1.1,
        tube(shaft, 3.7),
        rounded(collar, 5.0, 1.4),
        rounded(bit, 3.2, 1.0),
    ])
    h = np.where(mask, h, 0)
    grime = np.clip(noise(6, rng) * 0.9 + 0.2, 0, 1)
    alb = mix(col([0.88, 0.68, 0.34]), col([0.40, 0.30, 0.16]), grime * 0.55)
    return dict(mask=mask.astype(float), h=h, alb=alb, metal=np.ones((N, N)), shin=np.full((N, N), 45.0))


def nail():
    rng = np.random.default_rng(13)
    # Head is a disc on its edge: wide across, thin along the nail.
    head = sd_box(0, -42, 10.5, 2.8, 1.3)
    # Shank tapers to a point over its last 16 units.
    t = np.clip((Y - 30) / 17, 0, 1)
    rad = 4.1 * (1 - t) + 0.3 * t
    shank = np.maximum(np.abs(X) - rad, np.maximum(-40 - Y, Y - 48))
    mask = (head < 0) | (shank < 0)
    hh = np.sqrt(np.clip(10.5 ** 2 - X ** 2, 0, None)) * 0.6 * (head < 0)
    hh = np.minimum(hh, rounded(head, 5.2, 1.5) + 0.01)
    hs = np.sqrt(np.clip(rad ** 2 - X ** 2, 0, None)) * (shank < 0)
    # Grip rings just under the head — the detail that says "nail" and not "pin".
    hs *= np.where((Y > -38) & (Y < -26), 0.88 + 0.12 * np.abs(np.sin(Y * 1.6)), 1)
    h = np.where(mask, np.maximum(hh, hs), 0)
    rust = np.clip(noise(5, rng) * 1.4 - 0.25, 0, 1)
    alb = mix(col([0.66, 0.67, 0.70]), col([0.52, 0.27, 0.12]), rust * 0.8)
    metal = 1 - rust * 0.7
    shin = 70 - rust * 55
    return dict(mask=mask.astype(float), h=h, alb=alb, metal=metal, shin=shin)


def screw():
    rng = np.random.default_rng(14)
    # Countersunk head seen side-on: a trapezoid, wide at the top.
    ty = np.clip((Y + 41) / 10, 0, 1)
    head_hw = 10.5 * (1 - ty) + 3.6 * ty
    head = np.maximum(np.abs(X) - head_hw, np.maximum(-41 - Y, Y + 31))
    # Threaded shank with a gimlet point.
    t = np.clip((Y - 26) / 20, 0, 1)
    core = 3.4 * (1 - t) + 0.2 * t
    phase = (Y + X * 0.30) / 4.6
    tooth = 1 - 2 * np.abs(phase - np.floor(phase) - 0.5)
    threaded = Y > -22
    rad = core + np.where(threaded, 2.2 * tooth * (1 - t * 0.6), 0.25)
    shank = np.maximum(np.abs(X) - rad, np.maximum(-32 - Y, Y - 46))
    mask = (head < 0) | (shank < 0)
    hh = np.sqrt(np.clip(10.5 ** 2 - X ** 2, 0, None)) * 0.6 * (head < 0)
    # The slot shows as a notch cut into the head's top edge.
    slot = (np.abs(X) < 1.9) & (Y < -36.5)
    hh = np.where(slot, hh * 0.35, hh)
    hs = np.sqrt(np.clip(rad ** 2 - X ** 2, 0, None)) * (shank < 0)
    h = np.where(mask, np.maximum(hh, hs), 0)
    wear = np.clip(noise(7, rng) * 0.8 + 0.2, 0, 1)
    alb = mix(col([0.84, 0.86, 0.90]), col([0.58, 0.58, 0.60]), wear * 0.5)
    alb = np.where(slot[..., None], alb * 0.35, alb)
    return dict(mask=mask.astype(float), h=h, alb=alb, metal=np.ones((N, N)), shin=np.full((N, N), 90.0))


def horseshoe():
    rng = np.random.default_rng(15)
    cy = -6.0
    r = np.hypot(X, Y - cy)
    # Web narrows from the toe to the heels.
    web = np.where(Y < cy, 8.2, 8.2 - (Y - cy) / 44 * 2.6)
    arc = np.maximum(np.abs(r - 29) - web, Y - cy)
    arms = np.maximum(np.abs(np.abs(X) - 29) - web, np.maximum(cy - Y, Y - 40))
    shoe = np.minimum(arc, arms)
    mask = shoe < 0
    h = rounded(shoe, 4.6, 2.0)
    # Fuller: the groove the nail holes sit in, running round the outer half of the web.
    along = np.where(Y < cy, r, np.abs(X))
    groove = np.abs(along - 32.5) < 1.4
    h = np.where(groove & mask & (Y < 32), h - 1.2, h)
    # Nail holes: four per branch.
    holes = np.zeros((N, N), bool)
    for sgn in (-1, 1):
        for a in (0.45, 1.0, 1.55):
            hx = sgn * 32.5 * np.sin(a)
            hy = cy - 32.5 * np.cos(a)
            holes |= (np.abs(X - hx) < 1.6) & (np.abs(Y - hy) < 1.6)
        holes |= (np.abs(X - sgn * 32.5) < 1.6) & (np.abs(Y - (cy + 14)) < 1.6)
    h = np.where(holes & mask, 0.6, h)
    h = np.where(mask, np.maximum(h, 0), 0)
    rust = np.clip(noise(6, rng) * 1.2 + 0.15, 0, 1)
    alb = mix(col([0.46, 0.45, 0.46]), col([0.50, 0.26, 0.12]), rust * 0.75)
    alb = np.where(holes[..., None], alb * 0.2, alb)
    metal = 0.85 - rust * 0.55
    shin = 40 - rust * 28
    return dict(mask=mask.astype(float), h=h, alb=alb, metal=metal, shin=shin)


def watch():
    rng = np.random.default_rng(16)
    cy = 8.0
    R = 27.0
    r = np.hypot(X, Y - cy)
    ang = np.arctan2(Y - cy, X)
    case = r - R
    face_r = 21.0
    crown = sd_box(0, cy - R - 3.5, 4.2, 4.0, 1.2)
    stem = sd_box(0, cy - R - 0.5, 2.2, 2.0)
    bow = sd_ring(0, cy - R - 13, 7.2, 1.9)
    # A few chain links trailing off to the upper right.
    links = []
    # Starts threaded through the top of the bow and each link overlaps the last, so
    # the chain is visibly one piece with the watch rather than dashes floating by it.
    lx, ly = 0.5, cy - R - 21.5
    for i in range(5):
        ang_l = -0.75 + i * 0.10
        dx, dy = np.cos(ang_l) * 4.6, np.sin(ang_l) * 4.6
        if i:
            lx += dx; ly += dy
        if i % 2 == 0:
            links.append(('ring', np.abs(np.hypot((X - lx) / 1.35, Y - ly) - 2.6) - 1.0))
        else:
            links.append(('bar', sd_capsule(lx - dx * 0.45, ly - dy * 0.45, lx + dx * 0.45, ly + dy * 0.45, 1.3)))
    chain = np.min([s for _, s in links], axis=0)

    mask = (case < 0) | (crown < 0) | (stem < 0) | (bow < 0) | (chain < 0)
    h = rounded(case, 5.6, 5.0)
    h = np.where(r < face_r + 1.6, 5.9, h)                      # bezel
    face = r < face_r
    h = np.where(face, 4.6, h)
    h = np.maximum(h, rounded(crown, 5.4, 1.6) + np.where(crown < 0, 0.35 * np.sin(X * 3.2), 0))
    h = np.maximum(h, rounded(stem, 4.2, 1.0))
    h = np.maximum(h, tube(bow, 1.9) * 1.2)
    h = np.maximum(h, tube(chain, 1.1) * 1.3)
    h = np.where(mask, h, 0)

    gold = mix(col([0.95, 0.78, 0.42]), col([0.62, 0.44, 0.18]), np.clip(noise(8, rng) * 0.7 + 0.25, 0, 1))
    alb = gold
    metal = np.ones((N, N))
    shin = np.full((N, N), 75.0)

    # Enamel dial with hour ticks and two blued hands.
    ticks = face & (r > face_r - 4.5) & (r < face_r - 1.2) & (np.cos(ang * 12) > 0.93)
    big = face & (r > face_r - 6.5) & (np.cos(ang * 4 + 0) > 0.985) & (r < face_r - 1.2)
    ticks |= big
    def hand(a, length, w):
        ex, ey = np.cos(a) * length, cy + np.sin(a) * length
        return sd_capsule(0, cy, ex, ey, w) < 0
    hands = hand(-2.2, 11, 1.3) | hand(-0.55, 17, 0.9) | (r < 1.8)
    dial = col([0.95, 0.93, 0.86])
    alb = np.where(face[..., None], dial, alb)
    alb = np.where((ticks | hands)[..., None], col([0.10, 0.12, 0.20]), alb)
    metal = np.where(face, 0.0, metal)
    shin = np.where(face, 20.0, shin)
    h = np.where(hands, h + 0.3, h)
    # Crystal: a shallow dome over the dial, shaded as a separate clear-coat layer.
    glass = np.where(face, np.sqrt(np.clip(40 ** 2 - r ** 2, 0, None)) - np.sqrt(40 ** 2 - face_r ** 2), 0)
    return dict(mask=mask.astype(float), h=h, alb=alb, metal=metal, shin=shin, glass=glass * 1.4)


OBJECTS = {
    'coin': coin, 'key': key, 'nail': nail, 'screw': screw,
    'horseshoe': horseshoe, 'watch': watch,
}


# --- Shading ------------------------------------------------------------------

def normals(h):
    gy, gx = np.gradient(h, DU)
    n = np.stack([-gx, -gy, np.ones_like(h)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def self_shadow(h, mask, L, elev):
    lx, ly = L[0], L[1]
    norm = np.hypot(lx, ly)
    if norm < 1e-3:
        return np.ones_like(h)
    sx, sy = lx / norm, ly / norm
    rise = np.tan(elev) * DU
    lit = np.ones_like(h)
    ii, jj = np.mgrid[0:N, 0:N]
    for k in range(2, 120, 2):
        si = np.clip(np.round(ii + sy * k).astype(int), 0, N - 1)
        sj = np.clip(np.round(jj + sx * k).astype(int), 0, N - 1)
        occ = h[si, sj] > h + k * rise + 0.15
        lit = np.where(occ, lit * 0.55, lit)
    return np.clip(blur(lit, 0.35), 0.25, 1)


def render(obj, az, elev, shadow=True):
    mask, h, alb = obj['mask'], obj['h'], obj['alb']
    metal, shin = obj['metal'], obj['shin']
    L = np.array([np.cos(elev) * np.cos(az), np.cos(elev) * np.sin(az), np.sin(elev)])
    n = normals(blur(h, 0.12))
    ndl = np.clip((n * L).sum(-1), 0, 1)
    sh = self_shadow(h, mask, L, elev)
    ao = np.clip(1 - 0.10 * np.clip(blur(h, 2.5) - h, 0, None) * 4, 0.45, 1)

    # Reflection of the view ray (camera straight down).
    Rv = np.stack([2 * n[..., 2] * n[..., 0], 2 * n[..., 2] * n[..., 1], 2 * n[..., 2] ** 2 - 1], -1)
    rdl = np.clip((Rv * L).sum(-1), 0, 1)
    lobe = rdl ** shin[...] * (shin + 2) / 8
    # The rest of the workshop: bright ceiling, warm wood near the horizon.
    rz = np.clip(Rv[..., 2], 0, 1)
    env = (col([0.30, 0.31, 0.34]) * rz[..., None] + col([0.36, 0.25, 0.15]) * (1 - rz)[..., None]) + 0.10

    lamp = LAMP[None, None, :]
    direct = (ndl * sh)[..., None] * lamp
    diffuse = alb * (0.30 * ao[..., None] + 0.95 * direct)
    metallic = alb * (env * ao[..., None] * 1.25 + direct * 0.55) + alb * lamp * (lobe * sh)[..., None] * 0.9
    spec_d = lamp * (lobe * sh * 0.10)[..., None]
    m = metal[..., None]
    c = diffuse * (1 - m) + spec_d * (1 - m) + metallic * m

    if 'glass' in obj:
        gn = normals(obj['glass'])
        gR = np.stack([2 * gn[..., 2] * gn[..., 0], 2 * gn[..., 2] * gn[..., 1], 2 * gn[..., 2] ** 2 - 1], -1)
        g = np.clip((gR * L).sum(-1), 0, 1)
        on = (obj['glass'] > 0)[..., None]
        c = c + on * lamp * ((g ** 180) * 3.0 + (g ** 12) * 0.12)[..., None] * sh[..., None]

    # Soft shoulder rather than a hard clip, so blown highlights stay round.
    c = np.where(c < 0.82, c, 0.82 + 0.18 * (1 - np.exp(-(c - 0.82) / 0.18)))
    c = np.clip(c, 0, 1)

    # Cast shadow on the board, thrown away from the lamp by the object's height.
    lift = 4.5 / max(np.tan(elev), 0.2)
    ox = -np.cos(az) * lift if elev < 1.3 else 0.0
    oy = -np.sin(az) * lift if elev < 1.3 else 0.0
    shift = np.roll(np.roll(mask, int(round(oy / DU)), 0), int(round(ox / DU)), 1)
    cast = np.clip(blur(shift, 1.6), 0, 1) * 0.55
    contact = np.clip(blur(mask, 0.8), 0, 1) * 0.50
    shadow_a = np.maximum(cast, contact)

    a = np.clip(blur(mask, 0.15), 0, 1)
    # A find lies ON a board and throws a shadow onto it. A UI coin does not lie on
    # anything, so gen_coin.py asks for the object alone.
    out_a = a + shadow_a * (1 - a) if shadow else a
    prem = c * a[..., None]                      # shadow colour is black
    return prem, out_a


def downsample(prem, a):
    p = prem.reshape(F, SS, F, SS, 3).mean((1, 3))
    aa = a.reshape(F, SS, F, SS).mean((1, 3))
    rgb = np.where(aa[..., None] > 1e-4, p / np.maximum(aa[..., None], 1e-4), 0)
    return np.dstack([np.clip(rgb, 0, 1), np.clip(aa, 0, 1)])


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, '..', 'assets', 'finds')
    os.makedirs(out_dir, exist_ok=True)
    frames = [(i * np.pi / 4, np.radians(38)) for i in range(8)] + [(np.pi / 2, np.radians(62))]
    for name, fn in OBJECTS.items():
        obj = fn()
        strip = np.zeros((F, F * len(frames), 4))
        for i, (az, el) in enumerate(frames):
            prem, a = render(obj, az, el)
            strip[:, i * F:(i + 1) * F] = downsample(prem, a)
        img = Image.fromarray((strip * 255 + 0.5).astype(np.uint8), 'RGBA')
        path = os.path.join(out_dir, f'{name}.png')
        # 256 colours per strip: ~110KB for the whole set instead of ~590KB, and the
        # only visible cost is faint dither in the soft shadow, which the wood hides.
        img = img.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        img.save(path, optimize=True)
        print(f'{name:10s} {os.path.getsize(path) / 1024:.0f}KB')


if __name__ == '__main__':
    main()
