"""Shared by gen_kitchen.py and gen_chest.py: run Blender, then crop and quantise.

Blender is the Windows install, driven from WSL. Paths handed to it go through
`wslpath -w`, and it writes its renders straight into a WSL temp directory.
Override the executable with BLENDER=/path/to/blender.
"""
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BLENDER = os.environ.get(
    'BLENDER', '/mnt/c/Program Files/Blender Foundation/Blender 5.0/blender.exe')


def winpath(p):
    """A path Blender can open. Identity when Blender is a Linux build."""
    if not BLENDER.endswith('.exe'):
        return p
    return subprocess.check_output(['wslpath', '-w', p], text=True).strip()


def run_blender(script, args, done_marker):
    if not os.path.exists(BLENDER):
        raise SystemExit(f'Blender not found at {BLENDER} (set BLENDER=...)')
    cmd = [BLENDER, '-b', '--factory-startup', '-P', winpath(script), '--', *args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    for line in out.splitlines():
        if line.startswith(('SPRITE', 'ROOM', 'Traceback', 'Error')) or 'Error:' in line:
            print('   ', line)
    if done_marker not in out:
        print(out[-4000:])
        raise SystemExit('Blender render failed')


def temp_dir():
    return tempfile.mkdtemp(prefix='wcg_render_')


def cleanup(d):
    shutil.rmtree(d, ignore_errors=True)


def fade_shadow_edges(im, px=70):
    """Fade SHADOW pixels to nothing near the frame edge.

    A cast shadow that runs off the render frame is otherwise cut with a hard straight
    edge. Shadow-catcher pixels are pure black at partial alpha, which is what tells
    them apart from the object (even its black iron is opaque)."""
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    edge = np.minimum(np.minimum(xs, w - 1 - xs), np.minimum(ys, h - 1 - ys))
    k = np.clip(edge / px, 0, 1)
    k = k * k * (3 - 2 * k)
    shadow = (a[..., 3] < 235) & (a[..., :3].max(axis=2) < 28)
    a[..., 3] = np.where(shadow, a[..., 3] * k, a[..., 3])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def clear_transparent(q, mask):
    """Force `mask` pixels of a paletted image to one fully transparent entry.

    The octree quantiser folds transparent pixels into whichever palette entry is
    nearest, which carries an alpha of 2-7 — a haze over the whole crop that composites
    into a visible box round every sprite. One entry is made alpha 0 and every masked
    pixel is pointed at it."""
    idx = np.array(q)
    if not mask.any():
        return q
    pal = q.getpalette('RGBA')
    t = int(np.bincount(idx[mask].ravel()).argmax())
    pal[t * 4 + 3] = 0
    idx[mask] = t
    out = Image.fromarray(idx, 'P')
    out.putpalette(pal, 'RGBA')
    return out


def fix_file(path):
    """Apply clear_transparent to an already-written sprite."""
    q = Image.open(path)
    if q.mode != 'P':
        return
    a = np.asarray(q.convert('RGBA'))[..., 3]
    clear_transparent(q, a < 12).save(path, optimize=True)


def crop_quantise(src, dst, colours=256, pad=2):
    """Crop to the non-transparent area; returns (x0, y0, w, h) of the crop."""
    im = fade_shadow_edges(Image.open(src).convert('RGBA'))
    # A shadow catcher leaves alpha 1-5 over its whole frame. Invisible alone, but it
    # keeps the crop at full frame and quantises into a faint rectangle round every
    # sprite, which showed as a visible box once sprites overlapped.
    al = im.getchannel('A').point(lambda v: 0 if v < 8 else v)
    im.putalpha(al)
    a = al.point(lambda v: 255 if v else 0)
    box = a.getbbox() or (0, 0, 1, 1)
    x0 = max(0, box[0] - pad)
    y0 = max(0, box[1] - pad)
    x1 = min(im.width, box[2] + pad)
    y1 = min(im.height, box[3] + pad)
    im = im.crop((x0, y0, x1, y1))
    q = im.quantize(colours, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    q = clear_transparent(q, np.asarray(im)[..., 3] < 12)
    q.save(dst, optimize=True)
    return x0, y0, x1 - x0, y1 - y0


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1]
    return default
