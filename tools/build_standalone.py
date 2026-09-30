#!/usr/bin/env python3
"""Build the play-tester package (flash drive / other computers).

    python3 tools/build_standalone.py

Writes dist/CutItStraight.zip, which unzips to a CutItStraight/ folder holding:
  * the real game (index.html + src/ + shipped assets/)
  * "Start Game.bat" -> tools/tester/server.ps1: a no-install PowerShell web server
    that serves the folder on http://localhost:8936/ and opens the browser there
  * "Start Game (Mac).command" (python3 http.server)
  * CutItStraight.html: a single self-contained file as a backup that runs by
    double-click with no server at all
  * README.txt (from tools/tester/README.txt)

Why a server: the game is ES modules, and browsers refuse to load module files
from a file:// page (CORS), so opening index.html from the drive just shows
"Couldn't start". The single-file backup avoids that by packing every module into
one inline script and every shipped image into a data: URL.

This is a TEST build, not the CrazyGames upload:
  * The CrazyGames SDK tag is removed. sdk.js already runs standalone without it —
    no ads, saves go to localStorage (per browser, per computer).
  * The CrazyGames upload is still the project folder itself (index.html + src/ +
    assets/, minus assets/src and submission/). Do not upload this file there.

Stdlib only. It is a dev tool, not part of the game, so the zero-dependency rule
for the shipped game is unaffected.
"""
import base64
import json
import shutil
from datetime import datetime
import mimetypes
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'
# Shipped art and fonts only. assets/src is the unused source pack (19 MB) and never ships.
ASSET_DIRS = ['wood', 'machine', 'ui', 'finds', 'kitchen', 'chest', 'fonts']
OUT_NAME = 'CutItStraight.html'

IMPORT_RE = re.compile(r"^import\s+(.+?)\s+from\s+'\./([\w.]+)\.js';\s*$", re.M | re.S)
EXPORT_DECL_RE = re.compile(r"^export\s+(async\s+function\*?|function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)", re.M)
EXPORT_LIST_RE = re.compile(r"^export\s*\{([^}]*)\};?\s*$", re.M)


def mod_var(name):
    return '__m_' + re.sub(r'\W', '_', name)


def parse_module(name):
    text = (SRC / f'{name}.js').read_text(encoding='utf-8')
    if re.search(r'\bimport\.meta\b|^export\s+default|^export\s+\*', text, re.M):
        sys.exit(f'{name}.js uses a module form this bundler does not handle')
    deps = []

    def repl_import(m):
        spec, dep = m.group(1).strip(), m.group(2)
        deps.append(dep)
        if spec.startswith('* as '):
            return f'const {spec[5:].strip()} = {mod_var(dep)};'
        if not (spec.startswith('{') and spec.endswith('}')):
            sys.exit(f'{name}.js: unsupported import form: {spec}')
        parts = [p.strip() for p in spec[1:-1].split(',') if p.strip()]
        binds = [p.replace(' as ', ': ') for p in parts]
        return f'const {{ {", ".join(binds)} }} = {mod_var(dep)};'

    text = IMPORT_RE.sub(repl_import, text)
    if re.search(r"^import\s", text, re.M):
        sys.exit(f'{name}.js: an import statement was not rewritten')

    exports = {}  # exported name -> local name
    for m in EXPORT_DECL_RE.finditer(text):
        exports[m.group(2)] = m.group(2)
    text = re.sub(r'^export\s+(?=(async\s+)?function|const|let|var|class)', '', text, flags=re.M)

    def repl_list(m):
        for p in m.group(1).split(','):
            p = p.strip()
            if not p:
                continue
            local, _, public = p.partition(' as ')
            exports[(public or local).strip()] = local.strip()
        return ''

    text = EXPORT_LIST_RE.sub(repl_list, text)
    if re.search(r'^export\b', text, re.M):
        sys.exit(f'{name}.js: an export statement was not rewritten')
    return text, deps, exports


def bundle_js():
    mods = {}
    pending = ['main']
    while pending:
        n = pending.pop()
        if n in mods:
            continue
        mods[n] = parse_module(n)
        pending.extend(mods[n][1])

    order, state = [], {}

    def visit(n, stack):
        if state.get(n) == 'done':
            return
        if state.get(n) == 'active':
            sys.exit('import cycle: ' + ' -> '.join(stack + [n]))
        state[n] = 'active'
        for d in mods[n][1]:
            visit(d, stack + [n])
        state[n] = 'done'
        order.append(n)

    visit('main', [])

    out = []
    for n in order:
        body, _, exports = mods[n]
        # Getters keep ES live-binding semantics for the namespace objects.
        getters = ', '.join(f'get {pub}() {{ return {loc}; }}' for pub, loc in sorted(exports.items()))
        out.append(f'// ---- src/{n}.js ----\n'
                   f'const {mod_var(n)} = (() => {{\n{body}\n'
                   f'return Object.freeze({{ {getters} }});\n}})();\n')
    return '\n'.join(out), order


def asset_map():
    m = {}
    for d in ASSET_DIRS:
        for f in sorted((ROOT / 'assets' / d).iterdir()):
            if not f.is_file():
                continue
            mime = 'font/woff2' if f.suffix == '.woff2' else mimetypes.guess_type(f.name)[0]
            # Images go through the <img> src shim; fonts are looked up by ui.js
            # (loadUiSkin reads window.__ASSETS before falling back to the path).
            if not mime or not (mime.startswith('image/') or mime.startswith('font/')):
                continue
            b64 = base64.b64encode(f.read_bytes()).decode('ascii')
            m[f'assets/{d}/{f.name}'] = f'data:{mime};base64,{b64}'
    return m


# Every image the game loads goes through `img.src = '...assets/...'`. Redirect those
# to the embedded data: URLs. data: URLs also keep the canvas untainted, so the Build
# screen's getImageData silhouettes still work (a file:// image would taint it).
ASSET_SHIM = r"""
(function () {
  var map = window.__ASSETS;
  var desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: desc.enumerable,
    get: function () { return desc.get.call(this); },
    set: function (v) {
      var k = String(v).replace(/^(\.\.?\/)+/, '');
      desc.set.call(this, Object.prototype.hasOwnProperty.call(map, k) ? map[k] : v);
    },
  });
})();
"""

TESTER = ROOT / 'tools' / 'tester'
PKG = 'CutItStraight'
SDK_TAG = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'


def strip_sdk(html):
    # No SDK in a tester copy: sdk.js runs standalone (no ads, localStorage saves).
    # With it, a localhost copy would run the SDK's demo ads, and an offline one
    # would wait on a script that can never load.
    if SDK_TAG not in html:
        sys.exit('index.html: SDK tag not found (did it change?)')
    # __testerBuild hides the dev-only buttons (main.js isDev), which would otherwise
    # show because the package is served from localhost.
    return html.replace(SDK_TAG, '<script>window.__testerBuild = true;</script>')


def single_file_html():
    js, order = bundle_js()
    assets = asset_map()
    html = strip_sdk((ROOT / 'index.html').read_text(encoding='utf-8'))

    boot_re = re.compile(r'<script type="module">\s*import\(\'\./src/main\.js\'\).*?</script>', re.S)
    if not boot_re.search(html):
        sys.exit('index.html: module boot script not found (did it change?)')

    payload = (
        '<script>window.__ASSETS = ' + json.dumps(assets, separators=(',', ':')) + ';'
        + ASSET_SHIM + '</script>\n'
        # A module script, so the code keeps strict mode and module-scope semantics.
        # Inline modules run fine from file:// — only fetched module files are blocked.
        + '<script type="module">\ntry {\n' + js.replace('</script', '<\\/script')
        + '\n} catch (err) {\n  window.__bootFailed(\'Start failed: \' + (err && err.message ? err.message : err));\n}\n</script>'
    )
    return boot_re.sub(lambda _: payload, html), order, len(assets)


def crlf(text):
    # .bat files misparse with bare LF line endings on Windows.
    return text.replace('\r\n', '\n').replace('\n', '\r\n')


def main():
    single, order, n_assets = single_file_html()
    stamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    read = lambda name: (TESTER / name).read_text(encoding='utf-8')

    # (path inside the package, bytes, unix mode)
    files = [
        ('index.html', strip_sdk((ROOT / 'index.html').read_text(encoding='utf-8')).encode(), 0o644),
        (OUT_NAME, single.encode(), 0o644),
        ('README.txt', crlf(read('README.txt').replace('{stamp}', stamp)).encode(), 0o644),
        ('Start Game.bat', crlf(read('Start Game.bat')).encode(), 0o644),
        # BOM: Windows PowerShell 5.1 reads a BOM-less script as the ANSI code page.
        ('server.ps1', crlf(read('server.ps1')).encode('utf-8-sig'), 0o644),
        ('Start Game (Mac).command', read('Start Game (Mac).command').encode(), 0o755),
    ]
    for f in sorted(SRC.glob('*.js')):
        files.append((f'src/{f.name}', f.read_bytes(), 0o644))
    for d in ASSET_DIRS:
        for f in sorted((ROOT / 'assets' / d).iterdir()):
            if f.is_file():
                files.append((f'assets/{d}/{f.name}', f.read_bytes(), 0o644))

    # Unzipped copy too, so it can be tested (and copied) without extracting.
    stage = DIST / PKG
    if stage.exists():
        shutil.rmtree(stage)
    for rel, data, mode in files:
        p = stage / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        p.chmod(mode)
    for stale in (DIST / OUT_NAME, DIST / 'README.txt'):
        stale.unlink(missing_ok=True)

    zpath = DIST / f'{PKG}.zip'
    now = datetime.now().timetuple()[:6]
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel, data, mode in files:
            info = zipfile.ZipInfo(f'{PKG}/{rel}', date_time=now)
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)

    print(f'modules: {" ".join(order)}')
    print(f'assets:  {n_assets} images')
    print(f'files:   {len(files)} in {stage.relative_to(ROOT)}/')
    print(f'wrote    {zpath.relative_to(ROOT)}  {zpath.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
