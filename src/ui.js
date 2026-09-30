// UI skin — workshop materials (2026-09-28).
//
// The owner's siblings recognised the old UI as AI-made on sight, and they were right:
// glossy candy buttons with a white highlight strip, green/orange/grey fills, dark
// translucent rounded cards and a bold system font are the default recipe. This skin
// builds every piece of UI out of something that is really in a workshop:
//
//   buttons   blocks of birch plywood — raw, or painted with the paint worn back to
//             the wood at the edges — with the ply layers showing on the cut edge and
//             stencilled lettering
//   panels    stained plywood boards screwed together, or a pegboard wall
//   labels    torn strips of masking tape written on in marker
//   sheets    paper on a clipboard (the work order before a level)
//   sliders   a steel rule with a brass slider
//
// Buttons are rendered ONCE into an offscreen canvas per (size, style, label, state)
// and blitted afterwards: the paint wear, grain and shadows cost nothing per frame.
// That also keeps any destination-out compositing off the shared game canvas, which
// has bitten this project twice (see the odd-finds notes in render.js).

// Own copy rather than render.js's, so render.js can use this module without an
// import cycle.
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// --- Assets ---------------------------------------------------------------------

const TEX = {};
const TEX_FILES = { ply: 'ply.jpg', kraft: 'kraft.jpg', card: 'card.jpg', tape: 'tape.jpg', peg: 'pegboard.jpg', grunge: 'grunge.png' };
let skinReady = false;

// The single-file tester build (tools/build_standalone.py) embeds assets as data: URLs
// in window.__ASSETS; everywhere else they are plain relative paths.
function assetUrl(path, prefix) {
  const map = typeof window !== 'undefined' && window.__ASSETS;
  return (map && map[path]) || prefix + path;
}

export const FAMILY = { stencil: 'CisStencil', marker: 'CisMarker', body: 'CisBody' };

export const F = {
  stencil: (px) => `800 ${px}px ${FAMILY.stencil}, ${FAMILY.body}, system-ui, sans-serif`,
  marker: (px) => `400 ${px}px ${FAMILY.marker}, ${FAMILY.body}, system-ui, sans-serif`,
  body: (weight, px) => `${weight} ${px}px ${FAMILY.body}, system-ui, sans-serif`,
};

// Fonts and textures. Resolves when everything has loaded OR failed: a missing font
// falls back to system-ui and a missing texture to a flat fill, and starting the game
// without them beats not starting (same rule as the wood textures).
export function loadUiSkin(prefix = '') {
  const jobs = [];
  if (typeof FontFace !== 'undefined' && document.fonts) {
    const faces = [
      [FAMILY.stencil, 'assets/fonts/stencil.woff2', '800'],
      [FAMILY.marker, 'assets/fonts/marker.woff2', '400'],
      [FAMILY.body, 'assets/fonts/body-600.woff2', '600'],
      [FAMILY.body, 'assets/fonts/body-700.woff2', '700'],
      [FAMILY.body, 'assets/fonts/body-800.woff2', '800'],
    ];
    for (const [fam, path, weight] of faces) {
      const face = new FontFace(fam, `url("${assetUrl(path, prefix)}")`, { weight });
      jobs.push(face.load().then((f) => document.fonts.add(f)).catch(() => {}));
    }
  }
  for (const [k, file] of Object.entries(TEX_FILES)) {
    jobs.push(new Promise((res) => {
      const im = new Image();
      im.onload = () => { TEX[k] = im; res(); };
      im.onerror = () => res();
      im.src = `${prefix}assets/ui/${file}`;
    }));
  }
  return Promise.all(jobs).then(() => { skinReady = true; blockCache.clear(); artCache.clear(); cachedPixels = 0; });
}

export function uiSkinReady() { return skinReady; }

// Patterns are per-context (a pattern made on one canvas can't be used on another).
const patCache = new WeakMap();
function pattern(ctx, key) {
  const im = TEX[key];
  if (!im) return null;
  let m = patCache.get(ctx);
  if (!m) { m = {}; patCache.set(ctx, m); }
  if (!m[key]) m[key] = ctx.createPattern(im, 'repeat');
  return m[key];
}
// Fill the current path with a texture anchored at (ox, oy), scaled by s.
function fillTex(ctx, key, ox, oy, s, fallback) {
  const p = pattern(ctx, key);
  if (!p) { ctx.fillStyle = fallback; ctx.fill(); return; }
  try { p.setTransform(new DOMMatrix().translateSelf(ox, oy).scaleSelf(s, s)); } catch (e) { /* old Safari: untransformed */ }
  ctx.fillStyle = p;
  ctx.fill();
}

// Stable per-string hash, so the same button always gets the same grain offset and
// wear pattern (a button whose paint chips move every frame looks broken).
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// --- Palette ---------------------------------------------------------------------

export const INK = {
  cream: '#f3e9d2',
  creamDim: 'rgba(243,233,210,0.72)',
  burn: '#3a2213',
  marker: '#1d1a17',
  red: '#b3261e',
  pencil: '#4a4640',
};

const PAINT = {
  primary: { paint: '#3f6d3c', text: '#f4ecd6', wear: 0.9 },   // workshop green
  reward: { paint: '#e2a92b', text: '#2b1b0c', wear: 0.8 },    // safety yellow
  locked: { paint: '#56595a', text: 'rgba(232,228,216,0.55)', wear: 0.6 },
  danger: { paint: '#9e2b22', text: '#f4ecd6', wear: 0.8 },
  ghost: null,                                                  // raw plywood
};

// --- Offscreen cache ------------------------------------------------------------
//
// Measured, not assumed: drawn live every frame, the textured tape strips alone took
// the home screen from 24 fps to 7 and the Workshop from 21 to 4 (1280x800@2, software
// raster) — pattern fills under shadowBlur are expensive to rasterise. Everything
// static is therefore rendered once per (size, content, scale) and blitted.
const artCache = new Map();
// Budget by PIXELS, not entry count: a phone gives a tab far less memory than a desktop,
// and one full-screen pegboard at 2x is worth thirty buttons. ~12M px is ~48 MB of
// canvas across both caches; the oldest entries go first (Map keeps insertion order).
const PIXEL_BUDGET = 12e6;
let cachedPixels = 0;
function remember(map, key, cv) {
  map.set(key, cv);
  cachedPixels += cv.width * cv.height;
  while (cachedPixels > PIXEL_BUDGET && (artCache.size + blockCache.size) > 1) {
    const victim = artCache.size >= blockCache.size ? artCache : blockCache;
    const [k, old] = victim.entries().next().value;
    victim.delete(k);
    const c = old.canvas || old;
    cachedPixels -= c.width * c.height;
    c.width = c.height = 0;   // release the backing store now, not at the next GC
  }
}
export function uiCacheStats() {
  return { entries: artCache.size + blockCache.size, megapixels: +(cachedPixels / 1e6).toFixed(2) };
}
function cachedArt(ctx, key, w, h, pad, x, y, draw) {
  const m = ctx.getTransform();
  const sc = Math.max(1, Math.hypot(m.a, m.b));
  const k = `${key}|${sc.toFixed(2)}|${skinReady ? 1 : 0}`;
  let cv = artCache.get(k);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = Math.ceil((w + pad * 2) * sc);
    cv.height = Math.ceil((h + pad * 2) * sc);
    const g = cv.getContext('2d');
    g.setTransform(sc, 0, 0, sc, pad * sc, pad * sc);
    draw(g);
    remember(artCache, k, cv);
  }
  ctx.drawImage(cv, x - pad, y - pad, cv.width / sc, cv.height / sc);
}

// --- Blocks (buttons) ------------------------------------------------------------

const blockCache = new Map();

// b: { x, y, w, h, label, sub, style, coin, small, icon }. `drawIcon(ctx, cx, cy, colour)`
// draws the icon into the cached block. `fit(ctx, text, max, size, weight, family)`
// is main.js's shrink-to-fit.
export function drawBlock(ctx, b, pressed, fit, drawIcon) {
  const m = ctx.getTransform();
  const sc = Math.max(1, Math.hypot(m.a, m.b));
  const key = `${b.style}|${Math.round(b.w)}|${Math.round(b.h)}|${b.label}|${b.sub || ''}|${b.icon || ''}|${b.coin ? 1 : 0}|${b.small ? 1 : 0}|${pressed ? 1 : 0}|${sc.toFixed(2)}|${skinReady ? 1 : 0}`;
  let c = blockCache.get(key);
  if (!c) {
    c = renderBlock(b, pressed, sc, fit, drawIcon);
    remember(blockCache, key, c.canvas);
    blockCache.set(key, c);
  }
  ctx.drawImage(c.canvas, b.x - c.pad, b.y - c.pad, c.canvas.width / sc, c.canvas.height / sc);
  return c;
}

function renderBlock(b, pressed, sc, fit, drawIcon) {
  const pad = 14;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((b.w + pad * 2) * sc);
  cv.height = Math.ceil((b.h + pad * 2) * sc);
  const g = cv.getContext('2d');
  g.setTransform(sc, 0, 0, sc, pad * sc, pad * sc);
  const w = b.w, h = b.h;
  const seed = hash(`${b.label}|${b.style}|${w}`);
  const T = Math.max(5, Math.min(11, h * 0.13));       // ply thickness on screen
  const sink = pressed ? T * 0.7 : 0;
  const fy = sink, fh = h - T;                          // face rect
  const r = 5;
  const paint = PAINT[b.style] || null;

  // Contact shadow on the bench.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = (pressed ? 4 : 9) * sc;
  g.shadowOffsetY = (pressed ? 1 : 4) * sc;
  g.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(g, 1, 4, w - 2, h - 4, r);
  g.fill();
  g.restore();

  // Cut edge: the plies, alternating light and dark, visible below the face.
  g.save();
  roundRect(g, 0, fy + fh - r, w, T - sink + r, r);
  g.clip();
  const plies = 5;
  const edgeTop = fy + fh - r, edgeH = T - sink + r;
  for (let i = 0; i < plies; i++) {
    g.fillStyle = i % 2 ? '#a9824f' : '#dcc08e';
    g.fillRect(0, edgeTop + (edgeH * i) / plies, w, edgeH / plies + 0.5);
  }
  g.fillStyle = 'rgba(40,24,10,0.28)';
  g.fillRect(0, edgeTop, w, edgeH);
  g.restore();

  // Face: raw plywood.
  g.save();
  roundRect(g, 0, fy, w, fh, r);
  g.save();
  g.clip();
  roundRect(g, 0, fy, w, fh, r);
  fillTex(g, 'ply', -(seed % 300), fy - ((seed >> 9) % 200), 0.9, '#dcbf8c');

  if (paint) {
    // Paint on its own layer so wear can take it back to the wood without touching
    // the ply underneath.
    const pl = document.createElement('canvas');
    pl.width = Math.ceil(w * sc); pl.height = Math.ceil(fh * sc);
    const p = pl.getContext('2d');
    p.scale(sc, sc);
    p.fillStyle = paint.paint;
    p.fillRect(0, 0, w, fh);
    // Grain telegraphing through the paint, and brush streaks along the board.
    // (source-over, not multiply — see boardPanel.)
    p.globalAlpha = 0.08;
    p.beginPath(); p.rect(0, 0, w, fh);
    fillTex(p, 'ply', -(seed % 300), -((seed >> 9) % 200), 0.9, paint.paint);
    p.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      const yy = ((seed >> (i * 3)) % 100) / 100 * fh;
      p.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      p.fillRect(0, yy, w, 1.5 + (i % 3));
    }
    // Wear: grunge eats the paint hardest near the edges and corners.
    p.globalCompositeOperation = 'destination-out';
    const band = 7;
    p.save();
    p.beginPath();
    p.rect(0, 0, w, fh);
    p.rect(band, band, w - band * 2, fh - band * 2);
    p.clip('evenodd');
    p.globalAlpha = paint.wear;
    p.beginPath(); p.rect(0, 0, w, fh);
    fillTex(p, 'grunge', -((seed >> 5) % 256), -((seed >> 13) % 256), 0.7, 'rgba(0,0,0,0)');
    p.restore();
    p.globalAlpha = 0.05 * paint.wear;
    p.beginPath(); p.rect(0, 0, w, fh);
    fillTex(p, 'grunge', -((seed >> 3) % 256), -((seed >> 11) % 256), 1.4, 'rgba(0,0,0,0)');
    g.drawImage(pl, 0, fy, w, fh);
  }
  g.restore();

  // A lit top arris and a dark lower one — the face reads as a flat surface on a
  // block, not as a glossy pill.
  g.strokeStyle = 'rgba(255,248,230,0.35)';
  g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(r, fy + 0.8); g.lineTo(w - r, fy + 0.8); g.stroke();
  g.strokeStyle = 'rgba(40,22,8,0.45)';
  g.beginPath(); roundRect(g, 0.5, fy + 0.5, w - 1, fh - 1, r); g.stroke();
  g.restore();

  // Nails on the big blocks.
  if (h >= 78 && w >= 220) {
    for (const nx of [13, w - 13]) nail(g, nx, fy + fh / 2);
  }

  // Lettering.
  const col = paint ? paint.text : INK.burn;
  const cx = w / 2;
  if (b.icon && drawIcon) {
    drawIcon(g, cx, fy + fh / 2, col);
  } else {
    const hasSub = !!b.sub;
    const inner = w - (b.coin ? 70 : 40);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = hasSub ? 34 : b.small ? 30 : 40;
    const px = fit(g, b.label, inner, size, 800, FAMILY.stencil);
    g.font = F.stencil(px);
    const ly = fy + (hasSub ? fh * 0.38 : fh / 2 + 1);
    const lx = b.coin ? cx + 16 : cx;
    if (!paint) {
      // Burned in: a soft scorch round dark letters.
      g.save();
      g.shadowColor = 'rgba(90,45,10,0.55)';
      g.shadowBlur = 3 * sc;
      g.fillStyle = col;
      g.fillText(b.label, lx, ly);
      g.restore();
    } else {
      // Sprayed through a stencil: a little overspray haze.
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 1.6 * sc;
      g.fillStyle = col;
      g.fillText(b.label, lx, ly);
      g.restore();
    }
    if (b.coin) b._coinAt = { x: lx - g.measureText(b.label).width / 2 - 26, y: ly };
    if (hasSub) {
      fit(g, b.sub, inner, 22, 700, FAMILY.body);
      g.globalAlpha = 0.82;
      g.fillStyle = col;
      g.fillText(b.sub, cx, fy + fh * 0.74);
      g.globalAlpha = 1;
    }
  }
  if (b.style === 'locked') padlock(g, w - 30, fy + 22, 0.8);

  return { canvas: cv, pad, coinAt: b._coinAt ? { x: b._coinAt.x, y: b._coinAt.y } : null };
}

export function nail(ctx, x, y, r = 3.6) {
  ctx.save();
  const gr = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 0.5, x, y, r);
  gr.addColorStop(0, '#e9e6de');
  gr.addColorStop(0.6, '#8d8a82');
  gr.addColorStop(1, '#4b4943');
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(x + 0.8, y + 1.2, r, 0, 6.2832); ctx.fill();
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  ctx.restore();
}

// A cross-head screw, slot at a stable random angle.
export function screw(ctx, x, y, r = 6, seed = 0) {
  nail(ctx, x, y, r);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((seed % 628) / 100);
  ctx.strokeStyle = 'rgba(40,38,34,0.8)';
  ctx.lineWidth = r * 0.28;
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, 0); ctx.lineTo(r * 0.6, 0);
  ctx.moveTo(0, -r * 0.6); ctx.lineTo(0, r * 0.6);
  ctx.stroke();
  ctx.restore();
}

// Vector padlock — the old UI used the 🔒 emoji, which renders differently on every
// platform and is one of the loudest "generated UI" tells there is.
export function padlock(ctx, x, y, s = 1, colour = 'rgba(30,30,30,0.75)') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 3.2;
  ctx.beginPath(); ctx.arc(0, -4, 7, Math.PI, 0); ctx.lineTo(7, 2); ctx.moveTo(-7, 2); ctx.lineTo(-7, -4); ctx.stroke();
  roundRect(ctx, -11, 1, 22, 17, 3); ctx.fill();
  ctx.restore();
}

// --- Panels ----------------------------------------------------------------------

// Stained plywood board with screwed corners. Replaces the dark translucent card.
// Light text stays readable on it, which is why it can take over every existing panel.
export function boardPanel(ctx, x, y, w, h, opts = {}) {
  const seed = opts.seed ?? hash(`${Math.round(w)}|${Math.round(h)}`);
  const key = `board|${Math.round(w)}|${Math.round(h)}|${seed}|${opts.stain || ''}|${opts.screws !== false}`;
  cachedArt(ctx, key, w, h, 26, x, y, (g) => boardPanelLive(g, 0, 0, w, h, { ...opts, seed }));
}

function boardPanelLive(ctx, x, y, w, h, opts = {}) {
  const seed = opts.seed;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = '#2a1a10';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, 8);
  ctx.clip();
  roundRect(ctx, x, y, w, h, 8);
  fillTex(ctx, 'ply', x - (seed % 300), y - ((seed >> 9) % 200), 1.3, '#6b4a2c');
  // Walnut stain. Plain source-over, NOT 'multiply': in the Android emulator's Chrome
  // (GPU-rasterised canvas) the multiply pass was silently dropped and every board came
  // out as raw pale ply with cream text on it. The colour is solved so the result lands
  // on the same brown multiply gave, with a little of the grain left showing.
  ctx.fillStyle = opts.stain || 'rgba(58,24,0,0.75)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(12,7,3,0.38)';
  ctx.fillRect(x, y, w, h);
  // Uneven stain: grunge lifts it in patches.
  ctx.globalAlpha = 0.16;
  ctx.beginPath(); ctx.rect(x, y, w, h);
  fillTex(ctx, 'grunge', x - (seed % 256), y - ((seed >> 7) % 256), 2, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 1;
  ctx.restore();

  // Arrises.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,230,190,0.16)';
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 7);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();
  ctx.restore();

  if (opts.screws !== false) {
    const i = 16;
    screw(ctx, x + i, y + i, 5.5, seed);
    screw(ctx, x + w - i, y + i, 5.5, seed >> 3);
    screw(ctx, x + i, y + h - i, 5.5, seed >> 6);
    screw(ctx, x + w - i, y + h - i, 5.5, seed >> 9);
  }
}

// Pegboard wall filling a rect — the backdrop for the menu screens that used to sit on
// a flat 94% black dim.
export function pegboardWall(ctx, x, y, w, h, tint = 0.35) {
  cachedArt(ctx, `peg|${Math.round(w)}|${Math.round(h)}|${tint}`, w, h, 0, x, y,
    (g) => pegboardLive(g, 0, 0, w, h, tint));
}

function pegboardLive(ctx, x, y, w, h, tint) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  fillTex(ctx, 'peg', 0, 0, 1, '#6b4a2c');
  // Darken so panels and text stay the brightest things on the screen.
  ctx.fillStyle = `rgba(14,8,4,${tint})`;
  ctx.fillRect(x, y, w, h);
  const v = ctx.createRadialGradient(x + w / 2, y + h * 0.45, Math.min(w, h) * 0.2, x + w / 2, y + h * 0.45, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// A strip of masking tape with torn ends, slightly rotated, optionally written on.
export function tape(ctx, cx, cy, w, h, rot = 0, text = null, opts = {}) {
  const pad = 8 + Math.abs(Math.sin(rot)) * w / 2;
  const key = `tape|${Math.round(w)}|${Math.round(h)}|${rot.toFixed(3)}|${text}|${opts.font || ''}|${opts.size || ''}|${opts.ink || ''}|${opts.align || ''}|${opts.seed ?? ''}`;
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  cachedArt(ctx, key, w, h, pad, cx - w / 2, cy - h / 2,
    (g) => tapeLive(g, w / 2, h / 2, w, h, rot, text, { ...opts, alpha: 1 }));
  ctx.restore();
}

function tapeLive(ctx, cx, cy, w, h, rot = 0, text = null, opts = {}) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  const seed = opts.seed ?? hash(`${text}|${Math.round(w)}`);
  const x0 = -w / 2, y0 = -h / 2;
  // Torn ends: the short edges zigzag, the long ones are straight (it's tape).
  const n = Math.max(4, Math.round(h / 5));
  const jit = (i) => ((((seed >> (i % 13)) ^ (i * 7)) & 7) - 3.5) * 0.9;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(-x0, y0);
  for (let i = 1; i <= n; i++) ctx.lineTo(-x0 + jit(i), y0 + (h * i) / n);
  ctx.lineTo(x0, -y0);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(x0 + jit(i + 5), y0 + (h * i) / n);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  fillTex(ctx, 'tape', x0 - (seed % 200), y0, h / 64, '#e2d4aa');
  ctx.shadowColor = 'transparent';
  ctx.globalAlpha = opts.alpha ?? 1;
  if (text) {
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.ink || INK.marker;
    ctx.font = opts.font || F.marker(opts.size || Math.round(h * 0.56));
    const tx = opts.align === 'left' ? x0 + (opts.padX ?? 14) : 0;
    ctx.fillText(text, tx, 1);
  }
  ctx.restore();
}

// A plank sign with stencilled lettering — the home screen title.
export function plankSign(ctx, cx, cy, w, h, text, size) {
  cachedArt(ctx, `sign|${Math.round(w)}|${Math.round(h)}|${text}|${size}`, w, h, 30, cx - w / 2, cy - h / 2,
    (g) => plankSignLive(g, w / 2, h / 2, w, h, text, size));
}

function plankSignLive(ctx, cx, cy, w, h, text, size) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#3b2616';
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 6);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 6);
  ctx.clip();
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 6);
  fillTex(ctx, 'ply', cx - w / 2 - 90, cy - h / 2 - 40, 1.6, '#6b4a2c');
  // Stain — source-over for the same reason as boardPanel (see there).
  ctx.fillStyle = 'rgba(67,12,0,0.72)';
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  // Two boards, butted: a dark joint across the middle.
  ctx.fillStyle = 'rgba(20,10,4,0.55)';
  ctx.fillRect(cx - w / 2, cy - 1, w, 2.5);
  ctx.restore();
  // Stencil spray, with overspray.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = F.stencil(size);
  ctx.shadowColor = 'rgba(245,236,214,0.55)';
  ctx.shadowBlur = 5;
  ctx.fillStyle = '#f2e8d0';
  ctx.fillText(text, cx, cy + 3);
  ctx.restore();
  for (const [sx, sy] of [[-w / 2 + 16, -h / 2 + 14], [w / 2 - 16, -h / 2 + 14], [-w / 2 + 16, h / 2 - 14], [w / 2 - 16, h / 2 - 14]]) {
    screw(ctx, cx + sx, cy + sy, 5, Math.round(sx * 13 + sy));
  }
}

// A paper sheet on a clipboard. Content drawn on it should use dark ink (INK.*).
export function clipboard(ctx, x, y, w, h) {
  cachedArt(ctx, `clip|${Math.round(w)}|${Math.round(h)}`, w, h, 30, x, y, (g) => clipboardLive(g, 0, 0, w, h));
  return { x: x + 16, y: y + 34, w: w - 32, h: h - 50 };
}

function clipboardLive(ctx, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#5a3c22';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, w, h, 14);
  ctx.clip();
  roundRect(ctx, x, y, w, h, 14);
  fillTex(ctx, 'kraft', x, y, 1.2, '#7a5634');
  ctx.fillStyle = 'rgba(40,22,10,0.35)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  // Paper.
  const px = x + 16, py = y + 34, pw = w - 32, ph = h - 50;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  fillTex(ctx, 'card', px, py, 1, '#efe5cc');
  ctx.restore();
  // Faint ruled lines.
  ctx.save();
  ctx.strokeStyle = 'rgba(80,110,160,0.16)';
  ctx.lineWidth = 1;
  for (let ly = py + 70; ly < py + ph - 10; ly += 34) {
    ctx.beginPath(); ctx.moveTo(px + 14, ly); ctx.lineTo(px + pw - 14, ly); ctx.stroke();
  }
  ctx.restore();
  // The clip.
  const cw = Math.min(190, w * 0.42);
  ctx.save();
  const gr = ctx.createLinearGradient(0, y - 6, 0, y + 46);
  gr.addColorStop(0, '#f0f0ea');
  gr.addColorStop(0.45, '#a6a6a0');
  gr.addColorStop(1, '#5d5d58');
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = gr;
  roundRect(ctx, x + w / 2 - cw / 2, y - 8, cw, 50, 10);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(40,40,36,0.55)';
  roundRect(ctx, x + w / 2 - cw * 0.3, y + 6, cw * 0.6, 12, 6);
  ctx.fill();
  ctx.restore();
  return { x: px, y: py, w: pw, h: ph };
}

// A rubber-stamp impression: rotated, rough, inked.
export function stamp(ctx, text, cx, cy, size, colour, rot = -0.08) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.font = F.stencil(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  ctx.globalAlpha = 0.88;
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(3, size * 0.09);
  roundRect(ctx, -tw / 2 - size * 0.35, -size * 0.62, tw + size * 0.7, size * 1.2, size * 0.14);
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.fillText(text, 0, size * 0.04);
  ctx.restore();
}

// Steel rule track for a slider, with a brass slider block at `v` (0..1).
export function rulerSlider(ctx, x0, x1, cy, v, active) {
  ctx.save();
  const h = 16;
  const gr = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  gr.addColorStop(0, '#d9dcdc');
  gr.addColorStop(0.5, '#aeb2b2');
  gr.addColorStop(1, '#7d8282');
  ctx.fillStyle = gr;
  roundRect(ctx, x0 - 6, cy - h / 2, x1 - x0 + 12, h, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,30,30,0.7)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 20; i++) {
    const tx = x0 + ((x1 - x0) * i) / 20;
    ctx.beginPath();
    ctx.moveTo(tx, cy - h / 2);
    ctx.lineTo(tx, cy - h / 2 + (i % 5 === 0 ? 9 : i % 1 === 0 ? 5 : 3));
    ctx.stroke();
  }
  const kx = x0 + (x1 - x0) * v;
  const kw = active ? 20 : 17, kh = active ? 34 : 30;
  const kg = ctx.createLinearGradient(kx - kw / 2, 0, kx + kw / 2, 0);
  kg.addColorStop(0, '#f6d27a');
  kg.addColorStop(0.5, '#c9962f');
  kg.addColorStop(1, '#8a6118');
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = kg;
  roundRect(ctx, kx - kw / 2, cy - kh / 2, kw, kh, 3);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(60,36,6,0.7)';
  ctx.fillRect(kx - 1, cy - kh / 2 + 5, 2, kh - 10);
  ctx.restore();
}

// Yellow tape measure used as a progress bar: the blade extends as `f` grows.
export function tapeMeasure(ctx, x, y, w, h, f, colour = '#f2c230') {
  ctx.save();
  // Case-dark slot the tape runs in.
  ctx.fillStyle = 'rgba(20,14,8,0.65)';
  roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 4);
  ctx.fill();
  const fw = Math.max(0, Math.min(1, f)) * w;
  if (fw > 0) {
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, fw, h);
    ctx.strokeStyle = 'rgba(30,20,6,0.85)';
    ctx.lineWidth = 1;
    const step = w / 40;
    for (let i = 0; i * step <= fw; i++) {
      const tx = x + i * step;
      ctx.beginPath();
      ctx.moveTo(tx, y);
      ctx.lineTo(tx, y + (i % 5 === 0 ? h * 0.7 : h * 0.38));
      ctx.stroke();
    }
    // The hook on the end.
    ctx.fillStyle = '#9aa0a0';
    ctx.fillRect(x + fw - 3, y - 3, 4, h + 6);
  }
  ctx.restore();
}

// Spray-painted stencil lettering: a soft dark drop shadow for legibility over anything,
// then the paint with a little overspray haze. Replaces the thick black outline the old
// titles used, which is another generic "game UI" tell.
export function sprayText(ctx, text, x, y, size, colour, opts = {}) {
  ctx.save();
  ctx.font = opts.font || F.stencil(size);
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = Math.max(4, size * 0.12);
  ctx.shadowOffsetY = Math.max(2, size * 0.05);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.shadowColor = colour;
  ctx.shadowBlur = Math.max(1.5, size * 0.04);
  ctx.shadowOffsetY = 0;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// A kraft-paper price tag (corners clipped, reinforced string hole) — the chest's loot
// cards. Content on it should use dark ink.
export function priceTag(ctx, x, y, w, h) {
  cachedArt(ctx, `tag|${Math.round(w)}|${Math.round(h)}`, w, h, 18, x, y, (g) => {
    const c = 18;
    g.save();
    g.beginPath();
    g.moveTo(c, 0); g.lineTo(w - c, 0); g.lineTo(w, c); g.lineTo(w, h); g.lineTo(0, h); g.lineTo(0, c);
    g.closePath();
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 10;
    g.shadowOffsetY = 4;
    fillTex(g, 'kraft', 0, 0, 1, '#a57a4c');
    g.shadowColor = 'transparent';
    g.fillStyle = 'rgba(255,240,210,0.18)';
    g.fill();
    // Reinforcing ring and hole.
    g.fillStyle = 'rgba(245,236,214,0.9)';
    g.beginPath(); g.arc(w / 2, 16, 9, 0, 6.2832); g.fill();
    g.fillStyle = '#1a120c';
    g.beginPath(); g.arc(w / 2, 16, 4.5, 0, 6.2832); g.fill();
    g.restore();
  });
}
