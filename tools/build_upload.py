#!/usr/bin/env python3
"""Build the zip that gets uploaded to the CrazyGames developer portal.

    python3 tools/build_upload.py

Writes dist/crazygames/ (the exact files) and dist/CutItStraight-crazygames.zip with
index.html at the ZIP ROOT — the portal expects the entry page at the top level, not
inside a folder.

What goes in: index.html (unchanged — it carries the real SDK tag), src/*.js and the
shipped art under assets/ (wood, machine, ui, finds, kitchen, chest, fonts + their
licences). What never goes in: assets/src (the 19 MB source pack), tools/, submission/
(store covers + video are uploaded separately in the portal form), dist/, the docs.

It checks the platform limits (§4 of CRAZYGAMES_GUIDELINES.md) and refuses to write a
bundle that breaks them: <= 50 MB initial download (and warns above the 20 MB mobile
homepage budget), <= 1500 files, no absolute asset paths. Unlike the tester package,
nothing is patched: no __testerBuild flag, no launcher — on the CrazyGames host the SDK
reports environment 'crazygames', which already hides every dev-only button and hook.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = DIST / 'crazygames'
ZIP = DIST / 'CutItStraight-crazygames.zip'
ASSET_DIRS = ['wood', 'machine', 'ui', 'finds', 'kitchen', 'chest', 'fonts']


def main():
    files = [ROOT / 'index.html']
    files += sorted((ROOT / 'src').glob('*.js'))
    for d in ASSET_DIRS:
        files += sorted(p for p in (ROOT / 'assets' / d).iterdir() if p.is_file())

    # Absolute paths break the platform embed (it serves the game from a subpath).
    for f in files:
        if f.suffix in ('.js', '.html'):
            text = f.read_text(encoding='utf-8')
            for m in re.finditer(r"""(?:src|href)\s*=\s*["']/(?!/)|['"`]/(?:assets|src)/""", text):
                sys.exit(f'absolute path in {f.relative_to(ROOT)}: {m.group(0)!r}')

    if OUT.exists():
        shutil.rmtree(OUT)
    total = 0
    for f in files:
        rel = f.relative_to(ROOT)
        dst = OUT / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
        total += f.stat().st_size

    if len(files) > 1500:
        sys.exit(f'{len(files)} files — over the 1500-file limit')
    if total > 50e6:
        sys.exit(f'{total / 1e6:.1f} MB — over the 50 MB initial-download limit')

    ZIP.unlink(missing_ok=True)
    with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, f.relative_to(ROOT).as_posix())

    print(f'files:   {len(files)}')
    print(f'size:    {total / 1e6:.2f} MB uncompressed'
          + ('  (WARNING: over the 20 MB mobile-homepage budget)' if total > 20e6 else '  (under the 20 MB mobile-homepage budget)'))
    print(f'wrote    {ZIP.relative_to(ROOT)}  {ZIP.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
