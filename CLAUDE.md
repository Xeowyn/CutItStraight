# Wood Cutting Game

## FIRST: read the guidelines

**Before doing anything in this project, read `CRAZYGAMES_GUIDELINES.md` in this directory.**

It is the source of truth for game design, monetization, and CrazyGames platform compliance. Do not plan, write, or change code in this project without it loaded.

## Standing rules

- **Update `CRAZYGAMES_GUIDELINES.md` in the same session as any change it covers**, and append to its Changelog. The guidelines going stale is the main failure mode for this project.
- Every feature must defend one of the three prime metrics (10+ min playtime, 12%+ D1 retention, 80%+ conversion). If it defends none, don't build it.
- **Zero dependencies, no build step.** Vanilla JS + Canvas 2D. This is a load-time decision, not a taste one — do not add a framework or bundler.
- **Relative paths only.** Absolute paths break the CrazyGames embed.
- Gameplay logic runs on a fixed-timestep accumulator. Never scale game state by raw `deltaTime` — CrazyGames tests physics consistency at 144Hz and 165Hz.
- Check any ad-related change against the ad rules in §3 of the guidelines. Ad policy violations are the most common rejection cause and are not judgment calls.

## Running it

```
python3 tools/serve.py
```
Then open `http://localhost:8936`.

**Use `tools/serve.py`, not `python3 -m http.server`.** The stdlib server sends no
`Cache-Control` header, so Chrome heuristically caches the ES modules and serves them
stale on reload — which silently hides your changes and has already cost one review
cycle. `tools/serve.py` sends `no-store`. Port 8936 is this project's — 8935 belongs to Rush Hour Rampage, so don't reuse it. The CrazyGames SDK runs in `local` mode on localhost with demo ads. On any other non-CrazyGames host, append `?useLocalSdk=true` to force local mode.

Regenerate the wood textures with `python3 tools/gen_wood.py` (`--more` for only the
2026-09-26 boards), the saw's metal with
`python3 tools/gen_machine.py`, the odd-find sprites with `python3 tools/gen_finds.py`,
the UI coin with `python3 tools/gen_coin.py`, the UI's workshop-material textures (plywood, kraft, tape,
pegboard, grunge) with `python3 tools/gen_ui.py` and the store covers by opening `tools/covers.html?w=1920&h=1080` (etc.) and screenshotting
the canvas (`gen_covers.py` is superseded). **The CrazyGames upload zip: `python3 tools/build_upload.py`**
→ `dist/CutItStraight-crazygames.zip`
(all need numpy + Pillow). The Build screen's kitchen sprites (`python3 tools/gen_kitchen.py`)
and the chest's frames (`python3 tools/gen_chest.py`) are rendered in **Blender** — the Windows
install at `/mnt/c/Program Files/Blender Foundation/Blender 5.0/`, driven headless from WSL
(override with `BLENDER=...`); they also need node, numpy and Pillow. Each takes a few minutes.
Don't hand-edit the generated PNGs or `src/kitchen_sprites.js` / `src/chest_sprites.js`.

**The Build screen and the chest are 2D.** There is no runtime 3D renderer any more
(`model3d.js` was retired on 2026-09-21). After re-rendering, or touching `src/build.js`,
`src/chest.js` or the layouts in `src/kitchens.js`, **open `tools/harness_build2d.html`** —
every kitchen empty / half / complete and the chest at each stage, drawn by the game's own
code. Check that every object faces into the room. The Build screen has four different
rooms (Woodshop, Kitchen, Living Room, Music Room); every object is modelled in code in
`tools/blender/kitchen_models.py` (since 2026-09-26), all facing the viewer. In Cycles,
two visible faces that are coplanar and overlapping render BLACK — never stack parts flush.

**After touching the odd-finds block in `src/render.js`, open `tools/harness_finds.html`** —
it draws every find on real wood at three work-light directions, plus a row of them sawn
in half, which is what the blade does to one it goes through. The finds are lit from the
lamp's actual position over the blade, so a lighting fault only shows when the same object
is compared at several angles; it was written after the previous set shipped as unlit flat
vector cartoons that read as clipart against the photographic wood.

`submission/` holds the store assets and must **not** ship inside the game bundle.

**The UI style is "workshop materials"** (2026-09-28, `src/ui.js`, guidelines §6): plywood
blocks, stained boards, pegboard, masking tape, stencil/marker fonts. Don't reintroduce
glossy pills, dark translucent cards, gradient-outlined titles or emoji — the owner's
testers identified exactly that as "AI-made". Anything textured/shadowed must be drawn
through `cachedArt` (drawing it live per frame cost 70-85% of the frame rate).

**Tester copy** (flash drive, family play-testers): `python3 tools/build_standalone.py`
→ `dist/CutItStraight.zip`: the game folder + `Start Game.bat` (no-install PowerShell server on
localhost:8936, opens the browser; sources in `tools/tester/`) + a one-file `CutItStraight.html`
backup that runs by double-click. No SDK, no ads, dev buttons hidden (`window.__testerBuild`).
Copying the bare folder does not work — browsers block ES modules on `file://`.
It is a snapshot: rebuild after changes. `dist/` is never part of the CrazyGames upload.
