# Submission assets — Cut It Straight

Everything here is generated, so it can be regenerated after any art change rather
than drifting out of date. Nothing in this folder is hand-edited.

## Covers

| File | Size | Use |
|---|---|---|
| `cover_1920x1080.png` | 1920×1080 | Landscape |
| `cover_800x1200.png` | 800×1200 | Portrait |
| `cover_800x800.png` | 800×800 | Square |

Regenerate (2026-09-28): open `tools/covers.html?w=1920&h=1080` (and 800x1200, 800x800)
through `tools/serve.py` and screenshot the canvas at 1:1. It draws from the game's own
wood textures and `src/ui.js` plank sign + stencil font, so the store matches the game.
(`tools/gen_covers.py` made the old covers — gradient title with a black outline, the
look play-testers called "AI" — and is superseded.)

They share one composition — a fan of the game's colourful boards, a padauk board
being cut (cyan guide line ahead, kerf and sawdust behind the blade) and the title on
stencilled plank signs (one sign landscape; two stacked on portrait/square so it reads
at thumbnail size).

Checked against the platform rules in `CRAZYGAMES_GUIDELINES.md` §4:
- [x] Exact required sizes
- [x] Consistent visuals across all three
- [x] Title present, stylised
- [x] No borders
- [x] No extra text beyond the title
- [x] No icons
- [x] Not a raw gameplay screenshot

## Preview video

`preview_1080p.mp4` — 18.8s, 1920×1080, 30fps, H.264, ~5.6MB, **no audio track**.
Re-captured 2026-09-28 with the workshop-materials UI.

Beat sheet: "GO!" on level 39 (rosewood, SHORT SPRINT + BOARD JUMP) and the cut
including a PERFECT JUMP (0–8s) → PERFECT CUT, 3 stars landing (8–12.5s) → a piece
dropping into The Woodshop (12.5–15s) → level select scrolling past the boards (15–19s).
Captured with dev UI hidden (`window.__testerBuild`) and banners off.

Checked against §4:
- [x] 15–20s
- [x] ≤50MB
- [x] 1080p
- [x] No audio stream
- [x] No black bars (verified by sampling frame edges)
- [x] No cursor
- [x] No promo text overlay
- [x] No ad banners (captured with `window.__setBanners(false)`)

### Regenerating the video

It is a real capture of the running game, not a mock-up, driven through Chrome
DevTools' screencast so frame timings are true to life.

1. Serve the game: `python3 tools/serve.py`
2. Capture + encode with the scripts in the session scratchpad (`capture.mjs`,
   then ffmpeg over a concat list built from the recorded frame timestamps).

`puppeteer-core` and `ffmpeg` are deliberately **not** project dependencies — the
zero-dependency rule covers the shipped game, and capture tooling lives outside it.

## Listing copy

`listing.md` — title, tagline, long description, controls, category and tags, written
to be pasted straight into the developer portal. Category is **Puzzle**: CrazyGames'
own published average playtime for Puzzle is 21 min vs 8.6 min for hypercasual, which
is the single largest lever available on the prime metrics, and the game honestly
supports the tag.

## The upload itself

`python3 tools/build_upload.py` → `dist/CutItStraight-crazygames.zip` (index.html at
the zip root; 148 files, 4.7 MB). Nothing is outstanding by hand except the portal form.

## Do not ship this folder

`submission/` is 4.2MB and is uploaded to the developer portal separately. It must
**not** be inside the game bundle — the initial-download budget is the thing that
protects the mobile-homepage qualification (§4), and these files would eat a fifth
of it for assets no player ever downloads.

## Portrait preview video (2026-09-28)

`preview_portrait_1080x1920.mp4` — 18.8s, 1080×1920 (9:16), 30fps, H.264, ~8.8MB, no audio.
The portal asks for a landscape AND a portrait video. Same beat sheet as the landscape
one, captured with a true 1080×1920 viewport (dpr 1 — at 540×960@2 the CDP screencast
delivers 540×960 frames and the upscale is soft). Script: scratchpad `pt/capture.js`
with `VIEW=1080x1920x1 OUTDIR=vidp`.
