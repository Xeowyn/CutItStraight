"""Generates the currency coin sprite.

Run:  python3 tools/gen_coin.py
Out:  assets/ui/coin.png   (one 224px RGBA frame)

Why it exists: the coin shown against every coin total in the game — HUD, menus, the
workshop, the chest, every button price — was a radial-gradient circle drawn in code.
The owner's note was "new coin image (not a yellow circle)", and they were right: it is
the single most-repeated object on screen and it was the least made.

It is struck with the game's own object, a saw blade, rather than a generic numeral, and
it is RENDERED rather than painted — height field, real normals, self-shadowing, a
reflected workshop environment — the same rule the wood, the machine and the odd finds
already follow (guidelines §8.4). The modelling helpers and the shader are imported from
gen_finds.py so there is exactly one copy of them.

Lit from the upper left at a raking elevation, which is what gives the struck relief its shadows. A UI coin is not lying on a board, so it is
rendered with no cast shadow (`shadow=False`); render.js draws its own soft drop shadow
underneath, which stays correct whatever the coin is drawn on top of.
"""

import os
import numpy as np
from PIL import Image

import gen_finds as G

N = G.N
X, Y = G.X, G.Y


def coin():
    rng = np.random.default_rng(31)
    R = 34.0
    r = np.hypot(X, Y)
    ang = np.arctan2(Y, X)
    mask = r < R

    # Body: flat field inside a rounded, milled rim.
    h = G.rounded(r - R, 4.2, 1.9)
    field = r < R - 4.8
    h = np.where(field, 2.9, h)
    h += np.where((r > R - 3.0) & mask, 0.42 * np.sin(ang * 120), 0)
    # Two struck rings just inside the rim, so the face is not a bare plate.
    h += (np.abs(r - (R - 6.2)) < 0.9) * 0.55
    h += (np.abs(r - (R - 8.6)) < 0.55) * 0.35

    # The emblem: a saw blade, teeth raked the way the game's blade runs.
    # A circular saw blade reads at small sizes only if the disc stays SOLID and the
    # teeth stay small: big radial slots turned it into a flower the first time round.
    TEETH = 18
    phase = ((ang * TEETH / (2 * np.pi)) + 0.5) % 1.0
    blade_r = 16.4 + 2.2 * phase                     # ratchet edge = saw teeth
    blade = (r < blade_r) & field
    h = h + blade * 2.5
    # The tooth's back face is cut away, which is what makes teeth read as teeth
    # rather than as a scalloped edge.
    h -= ((r > blade_r - 1.0) & blade & (phase > 0.80)) * 2.0
    # One witness groove around the plate, and the arbor hole.
    h -= (np.abs(r - 9.5) < 0.7) * blade * 1.0
    h -= (r < 3.6) * blade * 3.0
    h = np.where(mask, np.maximum(h, 0), 0)

    # Gold, with the recesses left dark and the struck high points rubbed bright.
    base = G.mix(G.col([1.00, 0.82, 0.40]), G.col([0.86, 0.60, 0.22]),
                 np.clip(G.noise(9, rng) * 0.8 + 0.3, 0, 1))
    low = np.clip((3.2 - h) / 1.4, 0, 1) * field
    # Less tarnish than an odd find carries. A find is salvage pulled out of a board
    # and should look it; the currency coin has to read as GOLD next to a bright gold
    # star at 26px on a near-black panel.
    alb = G.mix(base, G.col([0.58, 0.41, 0.16]), low * 0.22)
    return dict(mask=mask.astype(float), h=h, alb=alb,
                metal=np.ones((N, N)), shin=np.full((N, N), 64.0))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, '..', 'assets', 'ui')
    os.makedirs(out_dir, exist_ok=True)
    prem, a = G.render(coin(), np.radians(218), np.radians(43), shadow=False)
    # The shader's environment is the workshop — a dim grey ceiling over brown wood —
    # which is right for an object lying on a board and too dark for one sitting on a
    # black UI panel. Lift the exposure and push the hue back toward gold, then let the
    # same soft shoulder keep the highlights round.
    lifted = prem * np.array([1.30, 1.22, 1.06])
    lifted = np.where(lifted < 0.82, lifted, 0.82 + 0.18 * (1 - np.exp(-(lifted - 0.82) / 0.18)))
    img = Image.fromarray((G.downsample(np.clip(lifted, 0, 1), a) * 255 + 0.5).astype(np.uint8), 'RGBA')
    path = os.path.join(out_dir, 'coin.png')
    img = img.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    img.save(path, optimize=True)
    print(f'coin.png  {os.path.getsize(path) / 1024:.0f}KB')


if __name__ == '__main__':
    main()
