// All drawing.
//
// PERSPECTIVE: the camera looks straight DOWN at a workbench. Everything must read
// from that vantage point — there are no walls, no eye-level furniture, no vertical
// surfaces. The background is the bench top itself, the saw is a bench-mounted scroll
// saw whose upper arm sweeps in from one side, and shadows fall almost straight down.
// An earlier version mixed a standing-eye-level wall with a top-down saw and looked
// incoherent; don't reintroduce that.
//
// LAYOUT: the play column is a fixed 720 logical units wide with a VARIABLE logical
// height, so tall phones get no letterbox bars. Position everything against `L.h` and
// `L.bladeY`. There is no fixed stage height.
//
// DRAW ORDER: bench → saw table plate → plank → blade → upper arm → effects → HUD.

import { lineAt, curvatureAt, gapAt, nextGap, PLANK_WIDTH } from './plank.js';
import { clamp } from './rng.js';
import * as UI from './ui.js';

export const STAGE_W = 720;
const MIN_H = 1150;

// Boards vary in width per level, so the texture is scaled by the width of the board
// actually being drawn (uniformly — stretching it to fit would distort the grain).
const TEX_W = 512;

export const textures = {};
// The saw machine's own textures, kept separate from the board materials because
// they are loaded once and never selected per level.
export const machine = {};

// Used only for the frame or two before the first level exists.
export const DEFAULT_WORKSHOP = {
  name: 'Old Pine Bench', bench: [120, 84, 52], grain: [92, 62, 38],
  light: [255, 226, 168], amb: [46, 62, 70], plate: [168, 176, 184],
};

export function computeLayout(cw, ch) {
  const scale = Math.min(cw / STAGE_W, ch / MIN_H);
  const h = ch / scale;
  const ox = (cw - STAGE_W * scale) / 2;
  return {
    scale, ox, oy: 0,
    w: STAGE_W, h,
    cx: STAGE_W / 2,
    bladeY: h * 0.605,
    left: -ox / scale,
    right: STAGE_W + ox / scale,
  };
}

// Board textures load ON DEMAND (2026-09-26). With 48 boards the full set is ~2.5MB,
// and boot used to await every one of them before the first frame. Now boot waits
// only for the boards the player is about to see, the rest stream in behind, and
// `ensureTexture` is idempotent so anything can ask for a board without double-
// fetching it. A board drawn before its texture arrives falls back to a flat fill.
const texLoads = {};
// The loaded image for a board texture, or null (not loaded yet / failed). The level
// select grid draws each level as an offcut of its own board.
export function textureImage(n) {
  return textures[n] || null;
}

export function ensureTexture(n) {
  if (!texLoads[n]) {
    texLoads[n] = new Promise((res) => {
      const img = new Image();
      img.onload = () => { textures[n] = img; res(); };
      img.onerror = () => { textures[n] = null; res(); };
      img.src = `assets/wood/${n}.jpg`;
    });
  }
  return texLoads[n];
}

export function loadTextures(names) {
  return Promise.all(names.map(ensureTexture));
}

// Loads `names` a few at a time, so the background fill never competes with a board
// the player has just asked for.
export async function streamTextures(names, lanes = 2) {
  const queue = names.slice();
  const lane = async () => { while (queue.length) await ensureTexture(queue.shift()); };
  await Promise.all(Array.from({ length: lanes }, lane));
}

// UI art that is a real rendered image rather than a shape drawn in code. Right now
// that is the coin, which appears against every total in the game and was the single
// most-repeated object on screen while also being the least made.
export const ui = {};

export function loadUiSprites(prefix = '') {
  const names = ['coin'];
  return Promise.all(names.map((n) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { ui[n] = img; res(); };
    img.onerror = () => { ui[n] = null; res(); };
    img.src = `${prefix}assets/ui/${n}.png`;
  })));
}

export function loadMachineTextures() {
  const names = ['cast_iron', 'brushed', 'blade_steel'];
  return Promise.all(names.map((n) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { machine[n] = img; res(); };
    img.onerror = () => { machine[n] = null; res(); };
    img.src = `assets/machine/${n}.jpg`;
  })));
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

const rgb = (c, m = 1) => `rgb(${(c[0] * m) | 0},${(c[1] * m) | 0},${(c[2] * m) | 0})`;

// --- Bench (the whole background, seen from above) --------------------------

const benchCache = new Map();

function benchMarks(ws) {
  if (benchCache.has(ws.name)) return benchCache.get(ws.name);
  // Deterministic per workshop so the bench doesn't shimmer between frames.
  let s = 0;
  for (let i = 0; i < ws.name.length; i++) s = (s * 31 + ws.name.charCodeAt(i)) >>> 0;
  const rnd = () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const marks = [];
  for (let i = 0; i < 46; i++) {
    marks.push({
      x: rnd(), y: rnd(),
      len: 20 + rnd() * 130,
      ang: (rnd() - 0.5) * 0.7,
      a: 0.05 + rnd() * 0.14,
      w: rnd() < 0.25 ? 2.5 : 1.2,
    });
  }
  const piles = [];
  for (let i = 0; i < 16; i++) {
    piles.push({ x: rnd(), y: rnd(), r: 16 + rnd() * 52, a: 0.05 + rnd() * 0.09 });
  }
  const out = { marks, piles };
  benchCache.set(ws.name, out);
  return out;
}

// The bench is the single most expensive thing in the frame — a full-screen fill,
// ~12 board bands, ~140 full-width grain strokes, 46 scored marks, 16 radial dust
// piles and two full-screen gradients. All of it is static per workshop and layout;
// only the airborne motes move. Profiled at ~11ms/frame before caching.
const benchSprite = { canvas: null, key: '' };

function benchSpriteFor(L, ws, scale) {
  const w = L.right - L.left;
  const key = `${ws.name}|${Math.round(L.left)}|${Math.round(w)}|${Math.round(L.h)}`
    + `|${Math.round(L.bladeY)}|${scale.toFixed(2)}`;
  if (benchSprite.canvas && benchSprite.key === key) return benchSprite.canvas;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w * scale));
  cv.height = Math.max(1, Math.ceil(L.h * scale));
  const c = cv.getContext('2d');
  c.setTransform(scale, 0, 0, scale, -L.left * scale, 0);
  paintBench(c, L, ws);
  benchSprite.canvas = cv;
  benchSprite.key = key;
  return cv;
}

export function drawBench(ctx, L, ws, t) {
  const scale = Math.min(2, (L.scale || 1) * Math.min(window.devicePixelRatio || 1, 2));
  ctx.drawImage(benchSpriteFor(L, ws, scale), L.left, 0, L.right - L.left, L.h);

  // Airborne dust catching the light — the only part of the bench that moves.
  const { left, right, h, cx } = L;
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const px = cx + Math.sin(i * 2.399 + t * 0.10) * 400;
    const py = ((i * 149.3 + t * 12) % (h + 80)) - 40;
    ctx.globalAlpha = 0.05 + 0.10 * (0.5 + 0.5 * Math.sin(t * 0.9 + i));
    ctx.fillStyle = '#fff2d8';
    const sz = 1 + (i % 3);
    ctx.fillRect(px, py, sz, sz);
  }
  ctx.restore();
}

function paintBench(ctx, L, ws) {
  const { left, right, h, cx, bladeY } = L;
  const w = right - left;

  ctx.fillStyle = rgb(ws.bench);
  ctx.fillRect(left, 0, w, h);

  // Bench boards run ACROSS the screen, perpendicular to the plank — that contrast is
  // what makes the plank read as a separate object lying on top.
  const bh = 132;
  ctx.save();
  for (let y = -bh; y < h + bh; y += bh) {
    const k = ((y / bh) % 3 + 3) % 3;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = rgb(ws.bench, 1 + (k - 1) * 0.07);
    ctx.fillRect(left, y, w, bh - 5);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = rgb(ws.grain, 0.72);
    ctx.fillRect(left, y + bh - 5, w, 5);
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(left, y + bh, w, 2);
  }
  ctx.restore();

  // Long grain along each board.
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = rgb(ws.grain);
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 11) {
    ctx.beginPath();
    ctx.moveTo(left, y + Math.sin(y * 0.07) * 3);
    ctx.lineTo(right, y + Math.sin(y * 0.07 + 1.4) * 3);
    ctx.stroke();
  }
  ctx.restore();

  // Old saw kerfs and pencil marks scored into the bench.
  const { marks, piles } = benchMarks(ws);
  ctx.save();
  for (const m of marks) {
    const x = left + m.x * w, y = m.y * h;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(m.ang);
    ctx.globalAlpha = m.a;
    ctx.fillStyle = '#000';
    ctx.fillRect(-m.len / 2, 0, m.len, m.w);
    ctx.globalAlpha = m.a * 0.5;
    ctx.fillStyle = '#fff';
    ctx.fillRect(-m.len / 2, m.w, m.len, 1);
    ctx.restore();
  }
  // Old sawdust settled on the bench.
  for (const p of piles) {
    const x = left + p.x * w, y = p.y * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, p.r);
    g.addColorStop(0, `rgba(236,208,158,${p.a})`);
    g.addColorStop(1, 'rgba(236,208,158,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.2832); ctx.fill();
  }
  ctx.restore();

  // Work light hanging directly above the blade.
  const lr = Math.max(w, h) * 0.72;
  const lg = ctx.createRadialGradient(cx, bladeY - lr * 0.12, 0, cx, bladeY, lr);
  lg.addColorStop(0, `rgba(${ws.light[0]},${ws.light[1]},${ws.light[2]},0.46)`);
  lg.addColorStop(0.32, `rgba(${ws.light[0]},${ws.light[1]},${ws.light[2]},0.20)`);
  lg.addColorStop(0.70, `rgba(${ws.light[0]},${ws.light[1]},${ws.light[2]},0.05)`);
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(left, 0, w, h);

  // Ambient falloff toward the edges of the bench.
  const vg = ctx.createRadialGradient(cx, bladeY, Math.min(w, h) * 0.26, cx, bladeY, Math.max(w, h) * 0.82);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(${ws.amb[0]},${ws.amb[1]},${ws.amb[2]},0.86)`);
  ctx.fillStyle = vg;
  ctx.fillRect(left, 0, w, h);

}

// --- Saw table plate (under the plank) -------------------------------------

export function drawSawTable(ctx, L, ws) {
  // Must be comfortably wider than the plank (360) or it reads as two stray metal
  // tabs poking out either side rather than a machine table.
  const pw = 660, ph = 470;
  const x = L.cx - pw / 2, y = L.bladeY - ph * 0.52;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#000';
  roundRect(ctx, x + 5, y + 8, pw, ph, 26);
  ctx.fill();
  ctx.restore();

  const g = ctx.createLinearGradient(x, y, x + pw, y + ph);
  g.addColorStop(0, rgb(ws.plate, 1.06));
  g.addColorStop(0.42, rgb(ws.plate, 0.86));
  g.addColorStop(0.62, rgb(ws.plate, 0.95));
  g.addColorStop(1, rgb(ws.plate, 0.68));
  ctx.fillStyle = g;
  roundRect(ctx, x, y, pw, ph, 26);
  ctx.fill();

  // Concentric machined rings around the blade, a real scroll-saw table detail that
  // also draws the eye to the cut point.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  for (let r = 200; r < 320; r += 24) {
    ctx.beginPath();
    ctx.arc(L.cx, L.bladeY, r, 0, 6.2832);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 2.5;
  roundRect(ctx, x + 2, y + 2, pw - 4, ph - 4, 25);
  ctx.stroke();

  // Rivets at the corners.
  for (const [rx, ry] of [[x + 34, y + 34], [x + pw - 34, y + 34], [x + 34, y + ph - 34], [x + pw - 34, y + ph - 34]]) {
    const rg = ctx.createRadialGradient(rx - 2, ry - 2, 0, rx, ry, 11);
    rg.addColorStop(0, '#f6eedb');
    rg.addColorStop(1, rgb(ws.plate, 0.55));
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(rx, ry, 9, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // Blade slot.
  ctx.fillStyle = '#0e1216';
  roundRect(ctx, L.cx - 11, L.bladeY - 52, 22, 104, 11);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawDustHose(ctx, L);
}

// Drawn with the table, i.e. UNDER the plank — the hose lies on the bench, so it must
// disappear beneath the board rather than across it.
//
// Rebuilt 2026-09-26: the owner said it "looks flat and 2d, completely unrealistic",
// and it was — one dark 28px stroke with faint tick marks. A flexible hose reads as a
// hose from three things, all done here: it is a CYLINDER (shaded across its width, lit
// from the lamp over the blade, with a specular streak), it is CORRUGATED (ribs that
// follow the curve, each with a lit crest and a dark trough, brightest where the
// cylinder faces the light), and it is ATTACHED (a metal port collar and a hose clamp,
// not a grey rectangle). Static per layout, so it is cached like the bench.
const hoseSprite = { canvas: null, key: '' };

function hosePath(L) {
  const x = L.cx, y = L.bladeY;
  const endX = x - PLANK_WIDTH / 2 - 40;
  const p0 = [L.left - 30, y + 128], p1 = [(L.left + endX) / 2, y + 122], p2 = [endX, y + 30];
  const pts = [];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const px = (1 - f) * (1 - f) * p0[0] + 2 * (1 - f) * f * p1[0] + f * f * p2[0];
    const py = (1 - f) * (1 - f) * p0[1] + 2 * (1 - f) * f * p1[1] + f * f * p2[1];
    const tx = 2 * (1 - f) * (p1[0] - p0[0]) + 2 * f * (p2[0] - p1[0]);
    const ty = 2 * (1 - f) * (p1[1] - p0[1]) + 2 * f * (p2[1] - p1[1]);
    const tl = Math.hypot(tx, ty) || 1;
    pts.push({ x: px, y: py, tx: tx / tl, ty: ty / tl, nx: -ty / tl, ny: tx / tl });
  }
  return { pts, endX, y };
}

function renderHose(c, L) {
  const { pts, endX, y } = hosePath(L);
  const R = 17;                                   // hose radius
  const stroke = (off, width, style) => {
    c.strokeStyle = style;
    c.lineWidth = width;
    c.beginPath();
    pts.forEach((p, i) => {
      const X = p.x + p.nx * off, Y = p.y + p.ny * off;
      if (i) c.lineTo(X, Y); else c.moveTo(X, Y);
    });
    c.stroke();
  };
  c.lineCap = 'butt';
  c.lineJoin = 'round';

  // Contact shadow: tight and dark where it touches, a soft penumbra around it.
  c.save();
  c.translate(5, 9);
  for (let i = 4; i >= 1; i--) stroke(0, R * 2 + i * 7, `rgba(0,0,0,${0.07})`);
  stroke(0, R * 2 - 2, 'rgba(0,0,0,0.30)');
  c.restore();

  // The body, shaded across its width in lanes. The light is the lamp over the blade,
  // up and to the right of the hose, so the lit side is the -normal side (toward the
  // top of the screen) and the terminator sits past the centre line.
  const LANES = 18;
  for (let i = 0; i < LANES; i++) {
    const u = (i + 0.5) / LANES * 2 - 1;          // -1 (lit edge) .. 1 (shadow edge)
    const nz = Math.sqrt(Math.max(0, 1 - u * u)); // how much this lane faces up
    const lambert = Math.max(0, 0.72 * nz - 0.52 * u);
    const v = 24 + 70 * lambert;
    stroke(u * R, (2 * R) / LANES + 1.2, `rgb(${v * 0.92 | 0},${v | 0},${v * 1.1 | 0})`);
  }

  // Corrugation. Each rib is a band across the hose: a dark trough, then a lit crest.
  // A rib seen from above on a cylinder bows slightly along the hose, and its crest is
  // brightest in the lanes that face the light.
  let dist = 0;
  const pitch = 7.5;
  let next = pitch * 0.5;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], p = pts[i];
    dist += Math.hypot(p.x - a.x, p.y - a.y);
    while (dist >= next) {
      const f = 1 - (dist - next) / Math.max(1e-6, Math.hypot(p.x - a.x, p.y - a.y));
      const bx = a.x + (p.x - a.x) * f, by = a.y + (p.y - a.y) * f;
      const rib = (off, style, w) => {
        c.strokeStyle = style;
        c.lineWidth = w;
        c.beginPath();
        for (let k = 0; k <= 10; k++) {
          const u = k / 10 * 2 - 1;
          const bow = (1 - u * u) * 2.2;          // bows toward the hose's far end
          const X = bx + p.nx * u * (R - 1) + p.tx * (off + bow);
          const Y = by + p.ny * u * (R - 1) + p.ty * (off + bow);
          if (k) c.lineTo(X, Y); else c.moveTo(X, Y);
        }
        c.stroke();
      };
      rib(-1.6, 'rgba(0,0,0,0.42)', 2.2);
      const g = c.createLinearGradient(bx - p.nx * R, by - p.ny * R, bx + p.nx * R, by + p.ny * R);
      g.addColorStop(0, 'rgba(210,222,236,0.10)');
      g.addColorStop(0.3, 'rgba(226,236,248,0.42)');
      g.addColorStop(0.62, 'rgba(200,214,230,0.12)');
      g.addColorStop(1, 'rgba(160,180,200,0.02)');
      rib(0.9, g, 1.6);
      next += pitch;
    }
  }

  // Specular streak along the lit side: the thing that makes it read as moulded
  // plastic rather than a painted band.
  stroke(-R * 0.42, 3.2, 'rgba(220,232,246,0.22)');
  stroke(-R * 0.42, 1.2, 'rgba(240,248,255,0.35)');
  // Silhouette edges.
  stroke(-R + 0.6, 1.2, 'rgba(0,0,0,0.5)');
  stroke(R - 0.6, 1.6, 'rgba(0,0,0,0.6)');

  // Hose clamp and port collar at the saw end, square to the hose.
  const e = pts[pts.length - 1];
  const band = (off, len, w, top, mid, bot) => {
    const cx = e.x + e.tx * off, cy = e.y + e.ty * off;
    c.save();
    c.translate(cx, cy);
    c.rotate(Math.atan2(e.ty, e.tx));
    const g = c.createLinearGradient(0, -w / 2, 0, w / 2);
    g.addColorStop(0, top); g.addColorStop(0.38, mid); g.addColorStop(1, bot);
    c.fillStyle = g;
    roundRect(c, -len / 2, -w / 2, len, w, 3);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.45)';
    c.lineWidth = 1;
    c.stroke();
    c.restore();
  };
  // The collar: a turned-aluminium spigot the hose is pushed over.
  band(12, 22, R * 2 + 6, '#dfe6ee', '#9aa6b2', '#46505a');
  band(22, 4, R * 2 + 10, '#f6eedb', '#a8b3be', '#505a64');
  // Worm-drive clamp on the hose, with its screw housing.
  band(-6, 7, R * 2 + 3, '#f2f5f8', '#b4bcc6', '#5a626c');
  {
    const cx = e.x - e.tx * 6 - e.nx * (R + 3), cy = e.y - e.ty * 6 - e.ny * (R + 3);
    c.save();
    c.translate(cx, cy);
    c.rotate(Math.atan2(e.ty, e.tx));
    const g = c.createLinearGradient(-6, -5, 6, 5);
    g.addColorStop(0, '#f4f7fa'); g.addColorStop(1, '#6a727c');
    c.fillStyle = g;
    roundRect(c, -6, -5, 12, 10, 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#3a424a';
    c.fillRect(-0.8, -4, 1.6, 8);
    c.restore();
  }
  // The mouth: the open end of the spigot, aimed at the blade, dark inside.
  {
    const cx = e.x + e.tx * 24, cy = e.y + e.ty * 24;
    c.save();
    c.translate(cx, cy);
    c.rotate(Math.atan2(e.ty, e.tx));
    c.fillStyle = '#0b0e11';
    c.beginPath();
    c.ellipse(0, 0, 4, R - 1, 0, 0, 6.2832);
    c.fill();
    c.restore();
  }
}

function drawDustHose(ctx, L) {
  const scale = Math.min(2, (L.scale || 1) * Math.min(window.devicePixelRatio || 1, 2));
  const x0 = L.left - 60, y0 = L.bladeY - 20;
  const w = (L.cx - PLANK_WIDTH / 2) - x0 + 20, h = 200;
  const key = `${Math.round(L.left)}|${Math.round(L.cx)}|${Math.round(L.bladeY)}|${scale.toFixed(2)}`;
  if (!hoseSprite.canvas || hoseSprite.key !== key) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * scale));
    cv.height = Math.max(1, Math.ceil(h * scale));
    const c = cv.getContext('2d');
    c.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    renderHose(c, L);
    hoseSprite.canvas = cv;
    hoseSprite.key = key;
  }
  ctx.drawImage(hoseSprite.canvas, x0, y0, w, h);
}

// --- Plank -----------------------------------------------------------------

function tileTexture(ctx, tex, cx, bottomY, length, tint, L, w) {
  const HALF_W = w / 2;
  const PLANK_WIDTH = w;
  const left = cx - HALF_W;
  const topY = bottomY - length;
  if (!tex) {
    ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
    ctx.fillRect(left, topY, PLANK_WIDTH, length);
    return;
  }
  // The grain is anchored to the PLANK's own top edge, not to screen coordinates.
  // Anchoring it to the screen pins the grain in place and the board looks completely
  // static while it is supposedly feeding into the saw.
  //
  // ONE pattern fill, never a stack of drawImage tiles (2026-09-26). The owner's
  // "horizontal seam every few seconds" was the join between two tiles: each tile's
  // edge lands on a fractional pixel, the GPU rasteriser anti-aliases both edges, and
  // two partial coverages of one row (e.g. 0.76 + 0.24) do not add up to an opaque
  // row — the dark board shadow underneath shows through as a line. It comes and goes
  // as the board moves because it vanishes whenever the join happens to land on a
  // whole pixel. Headless SOFTWARE raster does not show it at all, which is why the
  // 2026-09-18 pass measured it as "not coming from this function"; it reproduces
  // with --force-gpu-rasterization. A repeating pattern has no internal edges, and the
  // textures tile seamlessly, so there is nothing left to show through.
  const visTop = Math.max(topY, -8);
  const visBot = Math.min(bottomY, L.h + 8);
  if (visBot <= visTop) return;
  const pat = boardPattern(ctx, tex);
  const k = PLANK_WIDTH / TEX_W;
  pat.setTransform(new DOMMatrix([k, 0, 0, k, left, topY]));
  ctx.fillStyle = pat;
  ctx.fillRect(left, visTop, PLANK_WIDTH, visBot - visTop);
}

// One CanvasPattern per (context, texture), made on first use. A pattern belongs to
// the context that created it.
const boardPatterns = new WeakMap();
function boardPattern(ctx, tex) {
  let m = boardPatterns.get(ctx);
  if (!m) boardPatterns.set(ctx, (m = new Map()));
  let pat = m.get(tex);
  if (!pat) m.set(tex, (pat = ctx.createPattern(tex, 'repeat')));
  return pat;
}

// Metal and ice are defined by moving light. A static texture always reads dead, so a
// specular pass is composited on top: broad reflections that slide as the player
// steers, plus glints that travel down the sheet as it feeds.
function drawSheen(ctx, cx, topY, bottomY, cut, kind, L) {
  const PLANK_WIDTH = cut.plank.width;
  // Per-material scale on the whole specular pass. A dark metal (blued steel) lit as
  // hard as a bright one comes out white down the middle and stops being dark, which
  // is the only reason it is in the set.
  const gloss = cut.plank.level.material.sheen ?? 1;
  const HALF_W = PLANK_WIDTH / 2;
  const left = cx - HALF_W;
  // Same reasoning as plankShading: clamp to what is actually on screen.
  if (L) {
    topY = Math.max(topY, -4);
    bottomY = Math.min(bottomY, L.h + 4);
    if (bottomY <= topY) return;
  }
  const s = cut.s;
  const slide = cut.offset * 0.85;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const bands = kind === 'ice'
    ? [[-0.22, 0.16, 0.34], [0.26, 0.11, 0.24]]
    : [[-0.26, 0.13, 0.80], [0.10, 0.07, 0.50], [0.40, 0.16, 0.42]];

  for (const [pos, width, rawStrength] of bands) {
    const strength = rawStrength * gloss;
    const bx = cx + pos * PLANK_WIDTH + slide;
    const g = ctx.createLinearGradient(bx - PLANK_WIDTH * width, 0, bx + PLANK_WIDTH * width, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, kind === 'ice'
      ? `rgba(228,248,255,${strength})`
      : `rgba(255,250,238,${strength})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(left, topY, PLANK_WIDTH, bottomY - topY);
  }

  // Travelling glints, spaced along the board so they stream past the blade.
  const spacing = 520;
  const first = Math.floor((topY - s) / spacing) - 1;
  const last = Math.ceil((bottomY - s) / spacing) + 1;
  for (let i = first; i <= last; i++) {
    const gy = i * spacing + s * 0.55;
    if (gy < topY - 200 || gy > bottomY + 200) continue;
    const gx = cx + Math.sin(i * 2.1) * PLANK_WIDTH * 0.24 + slide * 0.6;
    const rw = PLANK_WIDTH * 0.30, rh = 150;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rw);
    g.addColorStop(0, kind === 'ice'
      ? `rgba(240,252,255,${0.42 * gloss})`
      : `rgba(255,252,240,${0.46 * gloss})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.scale(1, rh / rw);
    ctx.beginPath(); ctx.arc(0, 0, rw, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // A gentle shadow side so the highlights have something to sit against. Keep this
  // mild — an aggressive multiply crushes the sheet to near-black and reads as dead
  // grey rather than metal.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const dg = ctx.createLinearGradient(left, 0, left + PLANK_WIDTH, 0);
  // A multiply pass, so scaling these toward black is what makes a dull metal dull.
  const k = gloss + (1 - gloss) * 0.62;
  const mul = (r, g2, b2) => `rgb(${Math.round(r * k)},${Math.round(g2 * k)},${Math.round(b2 * k)})`;
  dg.addColorStop(0, mul(168, 176, 192));
  dg.addColorStop(0.28, mul(255, 255, 255));
  dg.addColorStop(0.60, mul(232, 238, 248));
  dg.addColorStop(1, mul(158, 166, 184));
  ctx.fillStyle = dg;
  ctx.fillRect(left, topY, PLANK_WIDTH, bottomY - topY);
  ctx.restore();
}

function plankShading(ctx, cx, bottomY, length, mat, w, L) {
  const kind = mat.kind;
  // See drawSheen: a dark metal has to be lit less, and most of the light on a metal
  // board comes from THIS pass, not from the specular one.
  const gloss = mat.sheen ?? 1;
  const PLANK_WIDTH = w;
  const HALF_W = w / 2;
  const left = cx - HALF_W;
  const topY = bottomY - length;
  // Only the on-screen band is worth filling. A long board is several times taller
  // than the viewport, and filling all of it is pure wasted fill rate — which is the
  // whole budget on a 2x display.
  const vTop = Math.max(topY, -4);
  const vBot = Math.min(bottomY, (L ? L.h : bottomY) + 4);
  if (vBot <= vTop) return;
  const g = ctx.createLinearGradient(left, 0, left + PLANK_WIDTH, 0);
  if (kind === 'metal') {
    g.addColorStop(0, `rgba(30,20,4,${0.55 + 0.20 * (1 - gloss)})`);
    g.addColorStop(0.30, `rgba(255,246,214,${0.30 * gloss})`);
    g.addColorStop(0.52, `rgba(255,255,255,${0.14 * gloss})`);
    g.addColorStop(0.78, `rgba(120,86,20,${0.20 + 0.16 * (1 - gloss)})`);
    g.addColorStop(1, `rgba(30,20,4,${0.58 + 0.20 * (1 - gloss)})`);
  } else if (kind === 'ice') {
    g.addColorStop(0, 'rgba(40,80,110,0.50)');
    g.addColorStop(0.32, 'rgba(255,255,255,0.30)');
    g.addColorStop(0.60, 'rgba(210,244,255,0.16)');
    g.addColorStop(1, 'rgba(40,80,110,0.52)');
  } else {
    g.addColorStop(0, 'rgba(38,22,8,0.62)');
    g.addColorStop(0.07, 'rgba(80,50,22,0.16)');
    g.addColorStop(0.34, 'rgba(255,244,216,0.20)');
    g.addColorStop(0.55, 'rgba(255,240,205,0.10)');
    g.addColorStop(0.94, 'rgba(74,46,20,0.20)');
    g.addColorStop(1, 'rgba(38,22,8,0.64)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(left, vTop, PLANK_WIDTH, vBot - vTop);
}

// --- Ice --------------------------------------------------------------------
//
// Ice was a blue-white texture with a specular pass over it, and the owner's note was
// that it "does not read as ice". The thing that was missing is not more highlight: it
// is that ICE IS SEE-THROUGH. The bench under it has to be visible through the sheet,
// and the sheet has to have something INSIDE it — fractures and trapped bubbles at
// depth — or it is just pale wood.
//
// So an ice board is drawn at `ICE_ALPHA` over the bench, with its flaws generated once
// per board from the level's own seed (deterministic, like everything else about a
// board) and drawn in plank-local coordinates so they travel with the sheet.
const ICE_ALPHA = 0.74;

function iceFlaws(plank) {
  if (plank._ice) return plank._ice;
  // A tiny integer hash, so the flaws are fixed per board without carrying an RNG.
  let h = (plank.level.seed * 2654435761) >>> 0;
  const rnd = () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
  const half = plank.width / 2;
  const cracks = [];
  const n = Math.max(4, Math.round(plank.length / 620));
  for (let i = 0; i < n; i++) {
    const s0 = rnd() * plank.length;
    const x0 = (rnd() * 2 - 1) * half * 0.82;
    const len = 120 + rnd() * 260;
    const dir = rnd() < 0.5 ? -1 : 1;
    const pts = [[x0, s0]];
    let x = x0, sy = s0;
    const steps = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < steps; k++) {
      x += dir * (10 + rnd() * 34);
      sy += (len / steps) * (rnd() < 0.3 ? -0.5 : 1);
      pts.push([Math.max(-half + 6, Math.min(half - 6, x)), sy]);
    }
    cracks.push({ pts, deep: rnd() < 0.45 });
  }
  const bubbles = [];
  const bn = Math.max(6, Math.round(plank.length / 340));
  for (let i = 0; i < bn; i++) {
    bubbles.push({
      x: (rnd() * 2 - 1) * half * 0.86,
      s: rnd() * plank.length,
      r: 2.2 + rnd() * 5.5,
      d: rnd(),                       // how deep in the sheet it sits
    });
  }
  plank._ice = { cracks, bubbles };
  return plank._ice;
}

// Drawn inside the board's clip, over the texture and the sheen.
function drawIceDetail(ctx, L, cut, cx, bottomY) {
  const { cracks, bubbles } = iceFlaws(cut.plank);
  const top = -80, bot = L.h + 80;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const c of cracks) {
    const y0 = bottomY - c.pts[0][1];
    if (y0 < top - 400 || y0 > bot + 400) continue;
    ctx.beginPath();
    ctx.moveTo(cx + c.pts[0][0], y0);
    for (let i = 1; i < c.pts.length; i++) ctx.lineTo(cx + c.pts[i][0], bottomY - c.pts[i][1]);
    // A deep fracture is a pale plane seen through the sheet; a surface one is a
    // bright hairline catching the lamp.
    if (c.deep) {
      ctx.strokeStyle = 'rgba(178,222,245,0.38)';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    ctx.strokeStyle = c.deep ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.75)';
    ctx.lineWidth = c.deep ? 1.4 : 1.8;
    ctx.stroke();
  }

  for (const b of bubbles) {
    const y = bottomY - b.s;
    if (y < top || y > bot) continue;
    const x = cx + b.x;
    ctx.globalAlpha = 0.30 + 0.38 * (1 - b.d);
    ctx.fillStyle = 'rgba(232,250,255,1)';
    ctx.beginPath(); ctx.arc(x, y, b.r, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 0.55 * (1 - b.d);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath(); ctx.arc(x - b.r * 0.32, y - b.r * 0.34, b.r * 0.38, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}

// A jump board is delivered in pieces with holes between them. Every board has this
// list; on an ordinary board it is one piece covering the whole length, so nothing
// downstream needs to know whether the board it is drawing has holes in it.
function piecesOf(plank) {
  if (plank._pieces) return plank._pieces;
  const gaps = plank.gaps;
  const out = [];
  if (!gaps || !gaps.length) {
    out.push({ s0: 0, s1: plank.length });
  } else {
    let s = 0;
    for (const g of gaps) { out.push({ s0: s, s1: g.s0, capTop: true }); s = g.s1; }
    out.push({ s0: s, s1: plank.length, capBottom: true });
    for (let i = 1; i < out.length; i++) out[i].capBottom = true;
    for (let i = 0; i < out.length - 1; i++) out[i].capTop = true;
  }
  plank._pieces = out;
  return out;
}

// A jump in `s` bigger than this between two kerf samples means the blade was over a
// hole in the board: the trail must break there rather than draw a cut across air.
const KERF_BREAK = 120;

function kerfScreen(cut, cx, bottomY) {
  const out = [];
  for (const k of cut.kerf) out.push({ x: cx + k.x, y: bottomY - k.s, q: k.q ?? 1, s: k.s });
  return out;
}

export function drawPlank(ctx, L, cut, splitT) {
  const PLANK_WIDTH = cut.plank.width;
  const HALF_W = PLANK_WIDTH / 2;
  const mat = cut.plank.level.material;
  const tex = textures[mat.tex];
  const tint = mat.dust;
  const cx = L.cx + cut.offset;
  const bottomY = L.bladeY + cut.s;
  const length = cut.plank.length;
  const topY = bottomY - length;

  // Light is directly overhead, so the plank's shadow is tight and offset only
  // slightly — a long shadow would break the top-down read.
  // Soft-edged without ctx.filter. A canvas blur filter is re-rasterised every frame
  // and measured as the single largest cost in the frame; three nested rects at low
  // alpha are visually indistinguishable at this radius and effectively free.
  const vTop = Math.max(topY, -8);
  const vBot = Math.min(bottomY, L.h + 8);
  const icy = mat.kind === 'ice';
  const pieces = piecesOf(cut.plank);
  // Each piece's on-screen band, computed once and reused by the shadow, the body and
  // the edges. `null` means the piece is off screen this frame.
  const bands = pieces.map((p) => {
    const pt = bottomY - p.s1, pb = bottomY - p.s0;
    const t = Math.max(pt, -8), b = Math.min(pb, L.h + 8);
    return b > t ? { p, pt, pb, t, b } : null;
  });

  ctx.save();
  // A translucent sheet cannot have a solid black shadow showing through it, so ice
  // gets a lighter one thrown further clear of the board.
  ctx.fillStyle = icy ? 'rgba(0,0,0,0.09)' : 'rgba(0,0,0,0.16)';
  const shOff = icy ? 13 : 7;
  for (const z of bands) {
    if (!z) continue;
    for (let i = 3; i >= 1; i--) {
      ctx.fillRect(cx - HALF_W + shOff - i, z.t + shOff + 2 - i, PLANK_WIDTH + i * 2, (z.b - z.t) + i * 2);
    }
  }
  ctx.restore();

  if (splitT > 0) {
    drawSplitPlank(ctx, L, cut, cx, bottomY, length, tex, tint, mat, splitT, bands);
    return;
  }

  // The body, one piece at a time. The texture stays anchored to the WHOLE board's
  // top edge, not to each piece, so the grain of a board that was cut into three
  // still runs through as one board.
  for (const z of bands) {
    if (!z) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - HALF_W, z.t, PLANK_WIDTH, z.b - z.t);
    ctx.clip();
    // An ice sheet is translucent: the bench reads through it. Everything that makes
    // up the sheet itself goes under one alpha; the flaws inside it do not, because a
    // fracture is brighter than the sheet, not dimmer.
    if (icy) ctx.globalAlpha = ICE_ALPHA;
    tileTexture(ctx, tex, cx, bottomY, length, tint, L, PLANK_WIDTH);
    if (mat.kind === 'metal' || icy) {
      drawSheen(ctx, cx, topY, bottomY, cut, mat.kind, L);
    }
    plankShading(ctx, cx, bottomY, length, mat, PLANK_WIDTH, L);
    if (icy) {
      ctx.globalAlpha = 1;
      drawIceDetail(ctx, L, cut, cx, bottomY);
    }
    ctx.restore();
  }

  // Everything drawn ON the board shares one clip: the board's column, full height.
  // The line, the kerf and the finds each know about the holes themselves.
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - HALF_W, vTop, PLANK_WIDTH, vBot - vTop);
  ctx.clip();
  const guide = drawGuideLine(ctx, L, cut, cx, bottomY, mat);
  drawKerf(ctx, cut, cx, bottomY, mat);
  drawObjects(ctx, L, cut, cx, bottomY, performance.now() / 1000);
  drawLineOverFinds(ctx, L, cut, cx, bottomY, mat, guide);
  // Guidance draws LAST. An odd find sitting on the line at exactly the look-ahead
  // distance was covering the crosshair, which is the one thing on screen that must
  // never be hidden.
  drawLaser(ctx, L, cut, cx, bottomY);
  ctx.restore();

  const edge = mat.kind === 'wood' ? 'rgba(30,18,8,0.65)' : 'rgba(20,30,40,0.6)';
  for (const z of bands) {
    if (!z) continue;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - HALF_W, z.t); ctx.lineTo(cx - HALF_W, z.b);
    ctx.moveTo(cx + HALF_W, z.t); ctx.lineTo(cx + HALF_W, z.b);
    // The sawn ends of a piece. Without them a hole in the board reads as a bar of
    // bench paint laid across it rather than as the board stopping and starting.
    if (z.p.capTop && z.pt > -8) { ctx.moveTo(cx - HALF_W, z.pt); ctx.lineTo(cx + HALF_W, z.pt); }
    if (z.p.capBottom && z.pb < L.h + 8) { ctx.moveTo(cx - HALF_W, z.pb); ctx.lineTo(cx + HALF_W, z.pb); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,210,0.24)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - HALF_W + 2.5, z.t); ctx.lineTo(cx - HALF_W + 2.5, z.b);
    ctx.moveTo(cx + HALF_W - 2.5, z.t); ctx.lineTo(cx + HALF_W - 2.5, z.b);
    if (z.p.capTop && z.pt > -8) { ctx.moveTo(cx - HALF_W, z.pt + 2.5); ctx.lineTo(cx + HALF_W, z.pt + 2.5); }
    if (z.p.capBottom && z.pb < L.h + 8) { ctx.moveTo(cx - HALF_W, z.pb - 2.5); ctx.lineTo(cx + HALF_W, z.pb - 2.5); }
    ctx.stroke();
  }
}

function drawSplitPlank(ctx, L, cut, cx, bottomY, length, tex, tint, mat, t, bands) {
  const PLANK_WIDTH = cut.plank.width;
  const HALF_W = PLANK_WIDTH / 2;
  const topY = bottomY - length;
  const pts = kerfScreen(cut, cx, bottomY);
  if (pts.length < 2) return;
  const ease = 1 - Math.pow(1 - t, 3);
  const push = 175 * ease;
  const tilt = 0.11 * ease;

  for (const side of [-1, 1]) {
    ctx.save();
    const pivotY = bottomY - length * 0.5;
    ctx.translate(cx + side * push, pivotY);
    ctx.rotate(side * tilt);
    ctx.translate(-cx, -pivotY);

    ctx.beginPath();
    const far = side < 0 ? cx - HALF_W : cx + HALF_W;
    ctx.moveTo(far, bottomY);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(far, topY);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    // The half is clipped again to each piece, so a board with holes in it still has
    // them after it splits apart.
    for (const z of bands) {
      if (!z) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - HALF_W - 400, z.t, PLANK_WIDTH + 800, z.b - z.t);
      ctx.clip();
      tileTexture(ctx, tex, cx, bottomY, length, tint, L, PLANK_WIDTH);
      if (mat.kind === 'metal' || mat.kind === 'ice') {
        drawSheen(ctx, cx, topY, bottomY, cut, mat.kind, L);
      }
      plankShading(ctx, cx, bottomY, length, mat, PLANK_WIDTH, L);
      ctx.restore();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineWidth = 10;
    ctx.strokeStyle = `rgba(${tint[0] + 26},${tint[1] + 24},${tint[2] + 22},0.88)`;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,248,228,0.6)';
    ctx.stroke();
    ctx.restore();
  }
}

function drawGuideLine(ctx, L, cut, cx, bottomY, mat) {
  const plank = cut.plank;
  // The EFFECTIVE tolerance, not the level's raw one: the blade upgrade widens the
  // forgiving zone, and since that zone is shown by the glow's radius, a sharper
  // blade has to visibly widen the halo or the player has paid for nothing they can
  // see. See UPGRADES.blade in meta.js.
  const tol = cut.tol ?? plank.level.tolerance;
  // The line must run all the way off the BOTTOM of the screen, not stop a little
  // way below the blade. The whole point of the stretch behind the blade is that the
  // player can compare their kerf against the line they were supposed to follow, and
  // a line that terminates in mid-air cuts that read-back off exactly where it's most
  // useful. `+220` overshoots the bottom edge so it never ends on screen.
  const behind = (L.h - L.bladeY) + 220;
  const sMin = Math.max(0, cut.s - behind);
  const sMax = Math.min(plank.length, cut.s + L.h + 140);
  const STEP = 10;

  // Build the path ONCE. It was previously rebuilt for each of six stroke passes,
  // and the line now runs the full height of the screen, so that is several hundred
  // redundant lineTo calls per frame.
  const p2 = new Path2D();
  let first = true;
  const holes = plank.gaps && plank.gaps.length;
  for (let s = sMin; s <= sMax; s += STEP) {
    // No board, no line. The path is restarted on the far side of a hole, which is
    // what makes the next piece's line read as a separate line to jump ONTO.
    if (holes && gapAt(plank, s)) { first = true; continue; }
    const x = cx + lineAt(plank, s);
    const y = bottomY - s;
    if (first) { p2.moveTo(x, y); first = false; } else p2.lineTo(x, y);
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = 'rgba(6,18,26,0.55)';
  ctx.lineWidth = 11;
  ctx.stroke(p2);

  // The forgiving zone is shown by the SIZE OF THE GLOW rather than a filled band —
  // a filled corridor turns muddy over the material. A wide soft halo on early levels
  // tightening to a hairline on late ones reads as difficulty at a glance.
  //
  // Built from concentric translucent strokes rather than ctx.shadowBlur: shadowBlur
  // re-rasterises the entire path offscreen once per pass, and profiled at ~5.6ms per
  // frame on the now full-height line. This reads the same and costs almost nothing.
  ctx.strokeStyle = mat.glow;
  for (const [lw, a] of [[tol * 2.0, 0.13], [tol * 1.15, 0.20], [13, 0.34]]) {
    ctx.globalAlpha = a;
    ctx.lineWidth = Math.max(6, lw);
    ctx.stroke(p2);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = mat.line;
  ctx.lineWidth = 5;
  ctx.stroke(p2);
  ctx.strokeStyle = 'rgba(255,255,255,0.96)';
  ctx.lineWidth = 1.8;
  ctx.stroke(p2);
  ctx.restore();
  return p2;
}

// The finds sit ON the line and are big enough to read now, which means a pocket
// watch would hide ~100 units of the path — exactly the thing the player has to see.
// The guide reads as a projected laser (it glows), so its core is drawn again OVER
// the finds, clipped to just where they are. Costs nothing when no find is on screen.
function drawLineOverFinds(ctx, L, cut, cx, bottomY, mat, p2) {
  const objs = cut.plank.objects;
  if (!p2 || !objs || !objs.length) return;
  const clip = new Path2D();
  let any = false;
  for (const o of objs) {
    if (o.resolved && o.hit) continue;
    const y = bottomY - o.s;
    if (y < -120 || y > L.h + 120) continue;
    const x = cx + lineAt(cut.plank, o.s);
    clip.moveTo(x + FIND_EXT, y);
    clip.arc(x, y, FIND_EXT, 0, 6.2832);
    any = true;
  }
  if (!any) return;
  ctx.save();
  ctx.clip(clip);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = mat.line;
  ctx.lineWidth = 4;
  ctx.stroke(p2);
  ctx.strokeStyle = 'rgba(255,255,255,0.96)';
  ctx.lineWidth = 1.5;
  ctx.stroke(p2);
  ctx.restore();
}

// The Guide Laser upgrade. The guide line already runs the full height of the screen,
// so "more look-ahead" cannot mean more line — it means being told, now, how far the
// board still has to travel sideways for the line to meet the blade. The beam rises
// from the blade up the board, and the crosshair sits on the line `cut.laser` pixels
// further along; the gap between them IS the correction still owed.
//
// Drawn with additive concentric strokes rather than shadowBlur/filter, per the
// renderer rules in §6 — a per-frame blur here costs more than the whole saw.
function drawLaser(ctx, L, cut, cx, bottomY) {
  const ahead = cut.laser || 0;
  if (ahead <= 0 || cut.done) return;
  const plank = cut.plank;
  const bx = L.cx;                        // the blade never moves; the board does
  const pulse = 0.82 + 0.18 * Math.sin(performance.now() / 150);

  const s = Math.min(plank.length, cut.s + ahead);
  const y = bottomY - s;
  if (y < -40) return;
  const tx = cx + lineAt(plank, s);
  const gap = tx - bx;

  // Tier 3: warn before a corner the player cannot see coming yet. The warning is
  // the point of look-ahead — pushing the marker itself further up the board just
  // makes it describe a turn you cannot steer for yet.
  let alert = 0;
  if (cut.laserAlert) {
    for (let d = ahead; d < ahead + 260; d += 40) {
      if (curvatureAt(plank, cut.s + d) > 0.10) { alert = 1; break; }
    }
  }

  ctx.save();
  ctx.lineCap = 'round';
  // Deliberately NOT composited with 'lighter': additive red over pale pine washes
  // out to near-white and the laser disappears into the board. Straight alpha keeps
  // the hue on every material.
  const HUE = alert ? '255,176,32' : '255,32,72';
  const RED = (a) => `rgba(${HUE},${a})`;
  const flash = alert ? 0.65 + 0.35 * Math.sin(performance.now() / 90) : 1;

  // Beam rising from the blade to the look-ahead point.
  ctx.strokeStyle = RED(0.26 * pulse * flash);
  ctx.lineWidth = 13;
  ctx.beginPath(); ctx.moveTo(bx, L.bladeY); ctx.lineTo(bx, y); ctx.stroke();
  ctx.strokeStyle = RED(0.68 * pulse * flash);
  ctx.lineWidth = 5.5;
  ctx.beginPath(); ctx.moveTo(bx, L.bladeY); ctx.lineTo(bx, y); ctx.stroke();
  ctx.strokeStyle = `rgba(255,232,238,${0.98 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(bx, L.bladeY); ctx.lineTo(bx, y); ctx.stroke();

  // Tier 2+: the lateral gap still owed. The arrow head sits on the BEAM, not on
  // the crosshair: the crosshair is what has to travel, the beam is where it has to
  // get to, so the head points the way the board must be steered.
  if (cut.laserArrow && Math.abs(gap) > 3) {
    const dir = Math.sign(gap);
    ctx.strokeStyle = RED(0.85);
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(tx, y); ctx.lineTo(bx + dir * 6, y);
    ctx.stroke();
    ctx.fillStyle = RED(0.9);
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.lineTo(bx + dir * 14, y - 8);
    ctx.lineTo(bx + dir * 14, y + 8);
    ctx.closePath(); ctx.fill();
  }

  crosshair(ctx, tx, y, 18, RED, pulse * flash);

  // Tier 4: a smaller second pip further up the board — a hint about the next turn
  // without moving the marker you actually steer by.
  if (cut.laserFar) {
    const s2 = Math.min(plank.length, cut.s + ahead + 230);
    const y2 = bottomY - s2;
    if (y2 > -30) {
      ctx.globalAlpha = 0.55;
      crosshair(ctx, cx + lineAt(plank, s2), y2, 11, RED, pulse);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function crosshair(ctx, tx, y, r, RED, pulse) {
  ctx.strokeStyle = RED(0.9);
  ctx.lineWidth = r * 0.21;
  ctx.beginPath(); ctx.arc(tx, y, r * 0.7, 0, 6.2832); ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${0.9 * pulse})`;
  ctx.lineWidth = Math.max(1.4, r * 0.13);
  ctx.beginPath();
  ctx.moveTo(tx - r, y); ctx.lineTo(tx - r * 0.35, y);
  ctx.moveTo(tx + r * 0.35, y); ctx.lineTo(tx + r, y);
  ctx.moveTo(tx, y - r); ctx.lineTo(tx, y - r * 0.35);
  ctx.moveTo(tx, y + r * 0.35); ctx.lineTo(tx, y + r);
  ctx.stroke();
  ctx.fillStyle = RED(pulse);
  ctx.beginPath(); ctx.arc(tx, y, r * 0.21, 0, 6.2832); ctx.fill();
}

// --- Odd finds -------------------------------------------------------------
//
// Third version. The first was flat vector cartoons (clipart on photographic wood).
// The second was lit salvage drawn live from Canvas paths — but five of its six were
// small discs seen square-on (coin, marble, screw head, nail head, bottle cap), and at
// play size the owner could not tell what ANY of them were. Lighting cannot rescue an
// object whose outline does not name it.
//
// So now:
//   * Every find is chosen for its SILHOUETTE: a nail and a screw lying on their sides,
//     a skeleton key, a horseshoe, a pocket watch on its chain, and one coin with a big
//     struck numeral. Only the coin is a disc.
//   * They are pre-rendered images (tools/gen_finds.py: height fields shaded with real
//     normals, self-shadowing and reflections), the same "real image file, not
//     code-drawn" rule the wood and the saw metal already follow (§8.4).
//   * They are still lit by the lamp that actually hangs over the blade. Each strip has
//     8 frames lit from 8 directions plus one from overhead; the frame is picked from
//     where the lamp is relative to the find, corrected for the find's own rotation, and
//     neighbouring frames are cross-faded so the light swings smoothly as a board feeds
//     through. The cast shadow is baked into each frame, so it always falls away from
//     the lamp.
//   * Long finds lie ALONG the line, so a nail reads as sitting in the path of the cut.

const FIND_FRAME = 224;          // px per frame in the strip
// A frame spans -60..60 units as modelled; drawn 1.35x that. At 1x a screw was ~55px
// long on a 1280x800 screen, which is back to squinting at it.
const FIND_EXT = 60 * 1.35;
const FIND_OVERHEAD = 8;         // frame index lit from above
const findSprites = {};

export function loadFindSprites(prefix = '') {
  const names = ['coin', 'key', 'nail', 'screw', 'horseshoe', 'watch'];
  return Promise.all(names.map((n) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { findSprites[n] = img; res(); };
    img.onerror = () => { findSprites[n] = null; res(); };
    img.src = `${prefix}assets/finds/${n}.png`;
  })));
}

// How far each find may turn away from the line's direction. Round ones stay near
// upright so the coin's numeral and the watch's dial are the right way up.
const FIND_TILT = { coin: 0.45, watch: 0.3, horseshoe: 0.4, key: 0.35, nail: 0.3, screw: 0.3 };
// Long finds follow the line; the rest ignore it.
const FIND_ALONG = { key: 1, nail: 1, screw: 1 };

// How far the board travels while a sawn find's two halves part, and how far apart
// they end up. The gap is the kerf's own width, not a dramatic explosion — the halves
// are still bedded in a board that has not come apart yet.
const FIND_CUT_TRAVEL = 90;
const FIND_CUT_GAP = 7;

export function drawObjects(ctx, L, cut, cx, bottomY, t) {
  const objs = cut.plank.objects;
  if (!objs) return;
  const E = FIND_EXT;
  for (const o of objs) {
    const y = bottomY - o.s;
    if (y < -120 || y > L.h + 120) continue;
    const x = cx + lineAt(cut.plank, o.s);
    const seed = o.spin;

    // Rotation: the sprite's long axis is vertical, head toward the far end of the
    // board. The line's screen tangent is (slope, -1), so turning to follow it is
    // atan(slope).
    const slope = (lineAt(cut.plank, o.s + 20) - lineAt(cut.plank, o.s - 20)) / 40;
    const rot = (FIND_ALONG[o.type] ? Math.atan(slope) : 0)
      + Math.sin(seed * 3.1) * (FIND_TILT[o.type] ?? 0.3)
      + Math.sin(t * 1.1 + seed) * 0.02;      // barely rocks — wedged, not bobbing

    // The lighting rig: direction to the lamp over the blade, and `k` from 0 directly
    // under it (overhead frame) to 1 well up the board (raking frames only).
    const dx = L.cx - x, dy = L.bladeY - y;
    const dist = Math.hypot(dx, dy);
    const k = Math.min(1, dist / 480);
    const lampAng = dist > 1 ? Math.atan2(dy, dx) : Math.PI / 2;

    ctx.save();
    ctx.translate(x, y);
    const base = o.resolved ? 0.4 : 1;       // missed: sawn past, still in the board

    // A faint warm halo so a find is still spottable coming up a busy board.
    if (!o.resolved) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + 0.06 * Math.sin(t * 2.2 + seed);
      const hg = ctx.createRadialGradient(0, 0, 20, 0, 0, 62);
      hg.addColorStop(0, 'rgba(255,226,140,0.7)');
      hg.addColorStop(1, 'rgba(255,226,140,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(0, 0, 62, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    const img = findSprites[o.type];
    // Light direction in the sprite's own frame, as a fractional frame index.
    let f = ((lampAng - rot) / (Math.PI / 4)) % 8;
    if (f < 0) f += 8;
    const i0 = Math.floor(f) % 8, i1 = (i0 + 1) % 8, frac = f - Math.floor(f);
    const paint = (alpha) => {
      if (img) {
        const frame = (i, a) => {
          if (a <= 0.01) return;
          ctx.globalAlpha = alpha * a;
          ctx.drawImage(img, i * FIND_FRAME, 0, FIND_FRAME, FIND_FRAME, -E, -E, E * 2, E * 2);
        };
        frame(i0, 1);
        frame(i1, frac);
        frame(FIND_OVERHEAD, 1 - k);
      } else {
        // Sprites failed to load: a plain marker keeps the mechanic playable.
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#c9a14a';
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, 6.2832); ctx.fill();
      }
    };

    if (o.resolved && o.hit) {
      // SAWN IN HALF. The find used to vanish on the frame the blade reached it,
      // which threw away the one moment the mechanic is about — the player pays
      // attention to a find precisely because the blade is going to go through it.
      // Each half is clipped in screen space at the kerf, then pushed out with its
      // own side of the board, so the kerf drawn underneath shows through the gap.
      const prog = Math.min(1, Math.max(0, (cut.s - (o.hitS ?? o.s)) / FIND_CUT_TRAVEL));
      const push = FIND_CUT_GAP * (1 - Math.pow(1 - prog, 3));
      const split = (cx + (o.hitX ?? 0)) - x;   // kerf position, relative to the find
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * push, 0);
        ctx.beginPath();
        if (side < 0) ctx.rect(split - E * 2, -E * 2, E * 2, E * 4);
        else ctx.rect(split, -E * 2, E * 2, E * 4);
        ctx.clip();
        // Each half tips very slightly away from the cut as the board opens up.
        ctx.rotate(rot + side * 0.045 * prog);
        paint(1);
        ctx.restore();
      }
      // The freshly sawn faces, bright against the kerf's shadow.
      ctx.globalAlpha = 0.55 * prog;
      ctx.fillStyle = 'rgba(255,244,214,0.9)';
      ctx.fillRect(split - push - 2, -E * 0.62, 2, E * 1.24);
      ctx.fillRect(split + push, -E * 0.62, 2, E * 1.24);
      ctx.restore();
      continue;
    }

    ctx.rotate(rot);
    paint(base);
    ctx.restore();
  }
}

function drawKerf(ctx, cut, cx, bottomY, mat) {
  const pts = kerfScreen(cut, cx, bottomY);
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // No kerf samples are taken over a hole, so consecutive samples can straddle one.
  // Drawn as a single polyline that would paint a cut straight across thin air, so
  // the trail is stroked as separate runs, one per piece of board.
  const runs = [];
  let run = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].s - pts[i - 1].s > KERF_BREAK) { runs.push(run); run = []; }
    run.push(pts[i]);
  }
  runs.push(run);

  const stroke = (w, style) => {
    ctx.lineWidth = w;
    ctx.strokeStyle = style;
    for (const r of runs) {
      if (r.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y);
      ctx.stroke();
    }
  };

  if (mat.kind === 'ice') {
    stroke(15, 'rgba(150,205,235,0.45)');
    stroke(10, 'rgba(255,255,255,0.85)');
    stroke(6, '#7fb9d8');
    stroke(2.5, 'rgba(40,90,120,0.85)');
  } else if (mat.kind === 'metal') {
    stroke(15, 'rgba(120,84,20,0.4)');
    stroke(10, 'rgba(255,236,180,0.8)');
    stroke(6, '#5a4415');
    stroke(2.5, 'rgba(0,0,0,0.8)');
  } else {
    stroke(16, 'rgba(120,80,40,0.30)');
    stroke(11, 'rgba(255,238,206,0.75)');
    stroke(7, '#2b1809');
    stroke(3, 'rgba(0,0,0,0.8)');
  }

  // Scorch and tearing wherever the cut went off the line.
  for (let i = 1; i < pts.length; i++) {
    const q = Math.min(pts[i].q, pts[i - 1].q);
    if (q >= 0.8) continue;
    if (pts[i].s - pts[i - 1].s > KERF_BREAK) continue;
    const bad = 1 - q;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = 12 + bad * 12;
    ctx.strokeStyle = mat.kind === 'ice'
      ? `rgba(120,170,200,${0.30 + bad * 0.4})`
      : `rgba(40,22,10,${0.30 + bad * 0.45})`;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(90,52,20,${bad * 0.7})`;
    ctx.stroke();
  }
  ctx.restore();
}

// --- Scroll saw head ---------------------------------------------------------
//
// This is the one object on screen the player stares at for an entire run, and the
// first version got three things wrong that owner feedback caught:
//
//   1. The arm was a flat grey gradient and read as moulded plastic. It is now
//      filled with a real generated cast-iron texture (tools/gen_machine.py), the
//      same approach that made the wood work.
//   2. The blade floated entirely ON TOP of the board, which makes no physical
//      sense — a scroll saw blade passes THROUGH the workpiece. It is now drawn in
//      two passes: `drawBladeUnder` before the plank, so the uncut board occludes
//      the run ahead of the cut, and the short visible stub in the open kerf after.
//   3. The exact point of contact was hard to find, which makes the game harder in
//      the wrong way. There is now an explicit reticle locked to the blade, tinted
//      by the current accuracy band.
//
//   4. The head was a big two-lobed casting reaching down to the board, and with the
//      arm it hid the stretch of line just ahead of the blade. It is a small chuck on
//      a narrow arm now — see paintArm().

const BLADE_AHEAD = 120;      // blade run above the board, hidden by the workpiece
// How far the visible blade reaches up from the contact point, into the chuck. The
// chuck body spans y-64 .. y-38 (see paintArmHead), and the blade must finish INSIDE it:
// stop short and the blade appears to hang unattached below the machine. Short on
// purpose — everything above the contact point sits over the stretch of guide line the
// player is reading, so the machine keeps out of it. Keep in step with paintArmHead().
const BLADE_UPPER = 54;

function bladeTipDx(flex) {
  return flex * 14;
}

// Pass 1, called BEFORE the plank: the full blade, most of which the board covers.
// Drawing it at all matters — the sliver that pokes out past a narrow board's edge is
// what tells the player the blade is a real object passing through the work.
export function drawBladeUnder(ctx, L, o) {
  const { t, running, flex } = o;
  const x = L.cx;
  const y = L.bladeY;
  const bob = running ? Math.sin(t * 66) * 3 : 0;
  const dx = bladeTipDx(flex);

  ctx.save();
  ctx.lineCap = 'butt';
  // Starts AT the contact point, never below it — see drawSawHead. Everything past
  // the blade is cut kerf, not more blade.
  const path = (w) => {
    ctx.beginPath();
    ctx.moveTo(x, y + bob);
    ctx.quadraticCurveTo(x + dx * 0.5, y - BLADE_AHEAD * 0.5 + bob, x + dx, y - BLADE_AHEAD + bob);
    ctx.lineWidth = w;
    ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(8,11,15,0.9)';
  path(11);
  ctx.strokeStyle = '#59626e';
  path(7);
  ctx.strokeStyle = 'rgba(198,212,228,0.75)';
  path(2.5);
  ctx.restore();
}

// Pass 2, called AFTER the plank: everything that sits above the work.
export function drawSawHead(ctx, L, o) {
  const { t, running, intensity, flex, heat, band, cut } = o;
  const x = L.cx;
  const y = L.bladeY;
  const bob = running ? Math.sin(t * 66) * 3 : 0;
  const dx = bladeTipDx(flex);

  // NOTHING is drawn below the contact point.
  //
  // There used to be a blade stub trailing back down the open kerf, on the theory
  // that you should see the blade emerging from the cut it just made. In practice it
  // did the opposite: a strip of steel lying along the finished kerf reads as the
  // blade being BEHIND the board, which made the whole scene look like it was being
  // viewed from underneath. The cut has to look like it is going down INTO the wood,
  // so past the contact point there is only kerf.

  // --- The UPPER RUN: the stretch of blade between the head's chuck and the board.
  //
  // Without this the head hung over the work connected to nothing, and the only
  // blade on screen was the stub trailing BELOW the contact point — which reads as
  // if the board were being seen from underneath, with the blade behind it. A scroll
  // saw blade is clamped in the upper arm and passes DOWN through the workpiece, so
  // this run sits ABOVE the board and must be drawn after it.
  //
  // Drawn before drawArm() so the chuck overlaps the blade's top end and it reads as
  // gripped rather than as a line ending in mid-air.
  ctx.save();
  ctx.lineCap = 'butt';

  // The TOP END DOES NOT BOB. It is clamped in the machine, so only the cutting end
  // moves. Bobbing both ends slid the whole blade up and down inside a static casting,
  // which opened and closed a gap at the chuck — the blade visibly detaching from the
  // head every few frames. Only the contact end reciprocates now, and the top runs far
  // enough up to finish inside the chuck, so no gap is reachable at all.
  const topY = y - BLADE_UPPER;
  const topX = x + dx * 0.60;
  const upperPath = () => {
    ctx.beginPath();
    ctx.moveTo(x, y + 2 + bob);
    ctx.quadraticCurveTo(x + dx * 0.42, y - BLADE_UPPER * 0.5 + bob * 0.4, topX, topY);
  };
  const upper = (w, style, alpha) => {
    upperPath();
    ctx.lineWidth = w;
    ctx.strokeStyle = style;
    ctx.globalAlpha = alpha ?? 1;
    ctx.stroke();
  };

  // A contact shadow on the board. This is what puts the blade above the work rather
  // than painted onto it — without it the run reads as a drawn-on stripe.
  ctx.save();
  ctx.translate(4, 3);
  upper(11, 'rgba(0,0,0,0.9)', 0.34);
  ctx.restore();

  // Motion blur either side while cutting.
  if (running) {
    for (const off of [-5, 5]) {
      ctx.save();
      ctx.translate(off, 0);
      upper(12, '#cfd8e2', 0.20);
      ctx.restore();
    }
  }

  upper(13, 'rgba(6,9,13,0.92)');
  upper(9.5, heat > 0.05
    ? `rgb(${(168 + 87 * heat) | 0},${(178 - 58 * heat) | 0},${(196 - 140 * heat) | 0})`
    : '#8a95a4');
  upper(4.2, 'rgba(238,246,255,0.95)');
  upper(1.5, '#ffffff', 0.5);
  ctx.globalAlpha = 1;

  // --- TEETH. A scroll saw blade is a serrated ribbon and has to read as one: this is
  // the part actually doing the cutting, and a plain grey strip reads as a rod.
  //
  // Cut along BOTH edges, spaced tightly, following the same curve as the blade so
  // they stay on it when it flexes. They point down toward the work, which is the
  // direction this blade cuts.
  const TOOTH = 7.5;                      // pitch down the blade
  const teeth = Math.floor((BLADE_UPPER - 8) / TOOTH);
  // Sample the same quadratic the blade is stroked along.
  const at = (u) => {
    const y0 = y + 2 + bob, y1 = y - BLADE_UPPER * 0.5 + bob * 0.4;
    const mx = x + dx * 0.42;
    const iv = 1 - u;
    return [
      iv * iv * x + 2 * iv * u * mx + u * u * topX,
      iv * iv * y0 + 2 * iv * u * y1 + u * u * topY,
    ];
  };
  for (let i = 0; i < teeth; i++) {
    const u = (i + 0.5) / teeth;
    const [tx, ty] = at(u);
    // Brighter toward the contact point: those are the teeth in the cut.
    const lit = 0.55 + 0.45 * (1 - u);
    ctx.fillStyle = `rgba(240,247,255,${lit.toFixed(2)})`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(tx + side * 4.4, ty - 1.6);
      ctx.lineTo(tx + side * 8.6, ty + 1.4);
      ctx.lineTo(tx + side * 4.4, ty + 3.4);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // --- Hot contact point.
  if (running) {
    const r = 26 + intensity * 40 + heat * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,248,220,${0.6 + intensity * 0.3})`);
    g.addColorStop(0.34, `rgba(255,182,86,${0.28 + intensity * 0.34})`);
    g.addColorStop(1, 'rgba(255,140,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  drawArm(ctx, L, x, y);
  drawContactReticle(ctx, x, y, band, running, t, cut);
}

// Fills a shape with the cast-iron texture, then relights it. The texture supplies
// the surface; the gradient supplies the form.
function metalFill(ctx, name, x, y, w, h, r, lightTop, scale) {
  const tex = machine[name];
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (tex) {
    const pat = ctx.createPattern(tex, 'repeat');
    // The texture is 512px square and the arm is ~66px tall, so at 1:1 the arm only
    // ever samples one near-uniform crop and reads as flat plastic. Scaling the
    // pattern down packs several repeats of real surface variation into the part.
    const k = scale ?? 0.22;
    if (pat.setTransform) {
      try { pat.setTransform({ a: k, b: 0, c: 0, d: k, e: x, f: y }); } catch (err) { /* older engine */ }
    }
    ctx.fillStyle = pat;
    ctx.fillRect(x, y, w, h);
    // Push the contrast back up: JPEG plus a small sample is a flat sample.
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pat;
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.fillStyle = '#6f7883';
    ctx.fillRect(x, y, w, h);
  }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(255,255,255,${lightTop ?? 0.30})`);
  g.addColorStop(0.22, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.50)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // A narrow blown specular streak. Metal is a mirror; without one hot band it
  // reads as painted.
  const sg = ctx.createLinearGradient(0, y, 0, y + h);
  sg.addColorStop(0, 'rgba(255,255,255,0)');
  sg.addColorStop(0.16, 'rgba(255,255,255,0.55)');
  sg.addColorStop(0.26, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// The arm and its head are ONE assembly: a horizontal casting sweeping in from the
// right, terminating in a head directly over the blade. An earlier version drew the
// blade chuck and the hold-down foot as two separate stacked blocks, which read as a
// pair of unexplained grey boxes rather than as a machine.
// The arm and head do not change between frames — only the layout can change them —
// yet they were rebuilt every frame out of patterns, gradients, clips and blurred
// shadows. Profiling put the whole machine at roughly 50ms/frame on a 2x display.
// It is a sprite, so it is now cached as one and blitted.
const sawSprite = { canvas: null, key: '', x: 0, y: 0, w: 0, h: 0 };

function sawSpriteFor(L, scale) {
  const x = L.cx;
  const y = L.bladeY;
  // Bounds: chuck (x-17 .. x+17, y-64 .. y-38) plus the arm out to its column,
  // padded for the blurred shadows. The column is a fixed distance from the blade, so
  // these no longer depend on L.right — which also means the sprite survives a window
  // resize that only changes the visible extent.
  const pad = 26;
  const x0 = x - 17 - pad;
  const y0 = y - 68 - pad;
  const w = (x + ARM_COLUMN_X + ARM_COLUMN_R) - x0 + pad;
  const h = (y - 34) - y0 + pad + 18 + ARM_COLUMN_R;
  const key = `${Math.round(x)}|${Math.round(y)}|${scale.toFixed(2)}`
    + `|${machine.cast_iron ? 1 : 0}${machine.brushed ? 1 : 0}`;
  if (sawSprite.canvas && sawSprite.key === key) return sawSprite;

  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w * scale));
  cv.height = Math.max(1, Math.ceil(h * scale));
  const c = cv.getContext('2d');
  // Draw in stage coordinates; the transform maps them into the sprite.
  c.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  paintArm(c, L, x, y);
  paintArmHead(c, x, y);

  sawSprite.canvas = cv;
  sawSprite.key = key;
  sawSprite.x = x0;
  sawSprite.y = y0;
  sawSprite.w = w;
  sawSprite.h = h;
  return sawSprite;
}

function drawArm(ctx, L, x, y) {
  // `scale` is the real device resolution this ends up rasterised at, so the cached
  // sprite is never softer than drawing live would have been.
  const scale = Math.min(3, (L.scale || 1) * Math.min(window.devicePixelRatio || 1, 2));
  const sp = sawSpriteFor(L, scale);
  ctx.drawImage(sp.canvas, sp.x, sp.y, sp.w, sp.h);
}

// The machine is kept deliberately SLIGHT. It used to be a 60-unit arm ending in a
// 92x96 two-lobed head reaching down to the board, which together hid the last ~100
// units of guide line before the blade — the exact stretch the player steers by — and
// the owner found the line hard to read in front of the saw. Everything here sits
// above the contact point, i.e. over the line still to come, so every unit of metal
// is a unit of line the player cannot see. Now: a narrow arm and a small chuck that
// grips the top of the blade, and nothing reaching down past it.
// How far right of the blade the arm's supporting column stands. The machine table is
// 660 wide (±330 from the blade), so this puts the column on the bench just clear of
// the table's edge. The arm used to run to `L.right` and simply stop at the screen
// edge: during a cut the board, blade and chuck explain it, but on the results panel
// the board has split away and the card covers the chuck, leaving a metal bar hanging
// across the bench supported by nothing and ending nowhere — which is exactly what it
// looked like. An arm needs something holding it up.
const ARM_COLUMN_X = 430;
const ARM_COLUMN_R = 44;

// A soft shadow that works in EVERY browser. These used `ctx.filter = 'blur()'`, which
// Safari only supports from 18 (2024) — older iPhones ignore it and drew hard black
// slabs. shadowBlur is universal: the shape is drawn far off-canvas and only its shadow
// is offset back into place. shadowBlur is in device pixels and ignores the transform,
// so it is scaled by the current one; ~2x the old filter radius matches its softness.
// Only ever used while baking the cached saw sprite, so the cost is paid once.
const FAR = 20000;
function softShadow(ctx, blur, alpha, draw) {
  ctx.save();
  const m = ctx.getTransform();
  const sc = Math.hypot(m.a, m.b) || 1;
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur * 2 * sc;
  ctx.shadowOffsetX = FAR * sc;
  ctx.fillStyle = '#000';
  ctx.translate(-FAR, 0);
  draw();
  ctx.fill();
  ctx.restore();
}

function paintArm(ctx, L, x, y) {
  const armH = 26;
  const armY = y - 51 - armH / 2;
  const x0 = x + 12;
  // Ends inside the column rather than at the screen edge. On a narrow screen the
  // column sits outside the visible extent, so the arm still runs off the edge there
  // and nothing about the phone layout changes.
  const w = (x + ARM_COLUMN_X) - x0;

  // Arm shadow.
  softShadow(ctx, 4, 0.42, () => roundRect(ctx, x0 - 4, armY + 10, w, armH, 10));

  metalFill(ctx, 'cast_iron', x0, armY, w, armH, 10, 0.34, 0.16);

  ctx.save();
  roundRect(ctx, x0, armY, w, armH, 10);
  ctx.clip();
  // Cooling fins, the detail that says "casting" rather than "rounded rectangle".
  // They start well clear of the blade so the stretch nearest it stays plain.
  for (let fx = x0 + 150; fx < x0 + w; fx += 40) {
    ctx.fillStyle = 'rgba(12,16,21,0.42)';
    ctx.fillRect(fx, armY + 6, 4, armH - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(fx + 4, armY + 6, 2, armH - 12);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2;
  roundRect(ctx, x0, armY, w, armH, 10);
  ctx.stroke();

  // Tension knob, moved out along the arm to sit over the bench rather than the work.
  const kx = x + 290, ky = armY + armH / 2;
  ctx.fillStyle = '#ff8a2b';
  ctx.beginPath(); ctx.arc(kx, ky, 10, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = 'rgba(120,52,0,0.8)';
  ctx.lineWidth = 2.5; ctx.stroke();
  ctx.strokeStyle = 'rgba(90,40,0,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(kx - 4.5, ky); ctx.lineTo(kx + 4.5, ky); ctx.stroke();

  paintArmColumn(ctx, x + ARM_COLUMN_X, ky);
}

// The column the arm is cantilevered from — a cast boss bolted to the bench, seen from
// directly overhead like everything else in the scene. Drawn AFTER the arm so the arm
// disappears into it rather than crossing it, which is what makes the join read as a
// joint instead of two parts overlapping.
function paintArmColumn(ctx, cx0, cy0) {
  const r = ARM_COLUMN_R;

  softShadow(ctx, 6, 0.5, () => { ctx.beginPath(); ctx.arc(cx0 + 5, cy0 + 11, r, 0, 6.2832); });

  // Base flange, then the boss standing on it: two rings read as height from above,
  // where a single disc reads as a painted dot.
  ctx.save();
  ctx.beginPath(); ctx.arc(cx0, cy0, r, 0, 6.2832);
  ctx.clip();
  metalFill(ctx, 'cast_iron', cx0 - r, cy0 - r, r * 2, r * 2, 0, 0.3, 0.16);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx0, cy0, r - 1, 0, 6.2832); ctx.stroke();

  // Four bolts around the flange, the detail that says "bolted down".
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const bx = cx0 + Math.cos(a) * (r - 11), by = cy0 + Math.sin(a) * (r - 11);
    const bg = ctx.createRadialGradient(bx - 1.5, by - 1.5, 0, bx, by, 6);
    bg.addColorStop(0, '#f6eedb');
    bg.addColorStop(1, '#5d6672');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(bx, by, 5, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.2; ctx.stroke();
  }

  const ir = r - 17;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx0, cy0, ir, 0, 6.2832);
  ctx.clip();
  metalFill(ctx, 'brushed', cx0 - ir, cy0 - ir, ir * 2, ir * 2, 0, 0.52, 0.3);
  ctx.restore();
  // Lip highlight on the lamp side, shadow away from it, so the boss stands proud.
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx0, cy0, ir, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(cx0, cy0, ir, Math.PI * 1.9, Math.PI * 2.9); ctx.stroke();
}

// The chuck: one small block gripping the top of the blade, joined to the arm. The
// blade's upper run ends inside it (BLADE_UPPER), so it reads as clamped, not floating.
function paintArmHead(ctx, x, y) {
  const cw = 30, ch = 26;
  const cx0 = x - 15, cy0 = y - 64;

  softShadow(ctx, 4, 0.5, () => roundRect(ctx, cx0 + 3, cy0 + 9, cw, ch, 8));

  metalFill(ctx, 'cast_iron', cx0, cy0, cw, ch, 8, 0.42, 0.2);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  roundRect(ctx, cx0, cy0, cw, ch, 8);
  ctx.stroke();

  // Clamp plate across the front, brushed, where the blade is gripped.
  metalFill(ctx, 'brushed', x - 10, cy0 + ch - 11, 20, 9, 3, 0.5, 0.4);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.2;
  roundRect(ctx, x - 10, cy0 + ch - 11, 20, 9, 3);
  ctx.stroke();

  // Clamp screw.
  const sg = ctx.createRadialGradient(x - 2, cy0 + 9, 0, x, cy0 + 10, 6);
  sg.addColorStop(0, '#f6eedb');
  sg.addColorStop(1, '#5b6470');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(x, cy0 + 10, 5.5, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 3.2, cy0 + 10); ctx.lineTo(x + 3.2, cy0 + 10); ctx.stroke();
}

// An explicit sight on the contact point. The player is aiming a fixed blade at a
// moving line, and without this the exact aim point has to be inferred from the glow.
function drawContactReticle(ctx, x, y, band, running, t, cut) {
  // 'air' is the blade over a hole in a jump board. It has to read as NEUTRAL, not
  // as the worst band: the reticle's colour is the player's read on their own cut,
  // and telling them they are cutting badly while there is nothing under the blade
  // is a lie that makes the hole feel like a punishment.
  const col = band === 'air' ? [190, 206, 220]
    : band === 'perfect' ? [125, 240, 255]
      : band === 'good' ? [150, 232, 140]
        : band === 'ok' ? [255, 210, 90]
          : [255, 110, 80];
  const c = `rgb(${col[0]},${col[1]},${col[2]})`;
  const pulse = running ? 0.72 + 0.28 * Math.sin(t * 7) : 1;

  ctx.save();
  ctx.lineCap = 'round';

  // Two chevrons pointing in at the contact point from either side, clear of the
  // board's centre so they never sit on top of the guide line.
  ctx.strokeStyle = c;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.95 * pulse;
  for (const s of [-1, 1]) {
    const bx = x + s * 30;
    ctx.beginPath();
    ctx.moveTo(bx + s * 16, y - 11);
    ctx.lineTo(bx, y);
    ctx.lineTo(bx + s * 16, y + 11);
    ctx.stroke();
  }

  // A hairline across the exact contact line, so "where am I cutting" has a pixel
  // answer rather than a glow.
  ctx.globalAlpha = 0.55 * pulse;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 26, y);
  ctx.lineTo(x + 26, y);
  ctx.stroke();

  // Error tick: how far off the line the blade is right now, drawn as a short bar
  // from the contact point toward the line. It shrinks to nothing when on target.
  if (cut && running) {
    const err = -cut.err;
    if (Math.abs(err) > 1.5) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - 20);
      ctx.lineTo(x + Math.max(-90, Math.min(90, err)), y - 20);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// --- HUD -------------------------------------------------------------------

// The multiplier sits right beside the blade, where the player's eyes already are.
export function drawCombo(ctx, L, cut, mult, t) {
  if (mult <= 1) return;
  const pulse = 1 + 0.10 * Math.sin(t * 9);
  const x = L.cx - 172;
  const y = L.bladeY - 6;
  const cols = ['#7df0ff', '#7df0ff', '#8fe87c', '#ffd35c', '#ff8a3d'];
  const col = cols[Math.min(cols.length - 1, mult - 1)];

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 54px CisBody, system-ui, sans-serif';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(6,12,18,0.9)';
  ctx.strokeText(`${mult}x`, 0, 0);
  ctx.shadowColor = col;
  ctx.shadowBlur = 22;
  ctx.fillStyle = col;
  ctx.fillText(`${mult}x`, 0, 0);
  ctx.restore();

  // Timer ring showing how long the combo has been held.
  ctx.save();
  ctx.translate(x, y + 46);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-36, 0); ctx.lineTo(36, 0); ctx.stroke();
  ctx.strokeStyle = col;
  const f = Math.min(1, (cut.combo % 6) / 6);
  ctx.beginPath(); ctx.moveTo(-36, 0); ctx.lineTo(-36 + 72 * f, 0); ctx.stroke();
  ctx.restore();
}

// --- The jump prompt --------------------------------------------------------
//
// Drawn over the board, under the panels. Two parts, and both are needed:
//   * a TARGET on the next piece's line, so the player can see where they are jumping
//     TO before they have to commit; and
//   * a timing track under the blade while the blade is over the hole, because the
//     mechanic is a timing test and a timing test with no clock is a guess.
// The ideal instant is not the middle of the track — it is just before the next piece
// reaches the blade, which is the moment the jump reads as "landing on it".
const JUMP_UI_IDEAL = 0.72;
const JUMP_UI_WINDOW = 0.17;
const JUMP_WARN_AHEAD = 620;     // board units of warning before the hole arrives

export function drawJumpUi(ctx, L, cut, t) {
  const plank = cut.plank;
  if (!plank.gaps || !plank.gaps.length) return;
  const g = nextGap(plank, cut.s);
  if (!g) return;
  const cx = L.cx + cut.offset;
  const bottomY = L.bladeY + cut.s;
  const airborne = cut.air >= 0;
  const approach = clamp((cut.s - (g.s0 - JUMP_WARN_AHEAD)) / JUMP_WARN_AHEAD, 0, 1);
  if (approach <= 0) return;

  // --- The landing target, sitting on the next piece's line where it enters.
  const tx = cx + lineAt(plank, g.s1);
  const ty = bottomY - g.s1;
  if (ty > -60 && ty < L.h + 60) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6.5);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.globalAlpha = 0.35 + 0.45 * approach;
    ctx.strokeStyle = airborne ? '#8fffcf' : '#ffd873';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, 20 + 5 * pulse, 0, 6.2832);
    ctx.stroke();
    ctx.globalAlpha *= 0.8;
    ctx.beginPath();
    ctx.moveTo(-13, 12); ctx.lineTo(0, -2); ctx.lineTo(13, 12);
    ctx.stroke();
    ctx.restore();
  }

  // --- The timing track. Only while there is actually a hole under the blade.
  if (!airborne || cut.jumped[g.i]) return;
  const tw = 264, th = 15;
  const x0 = L.cx - tw / 2, y0 = L.bladeY + 104;
  ctx.save();
  ctx.fillStyle = 'rgba(6,12,16,0.78)';
  roundRect(ctx, x0 - 10, y0 - 30, tw + 20, th + 56, 14); ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, x0, y0, tw, th, th / 2); ctx.fill();

  // The window that counts as perfect.
  const zx = x0 + tw * (JUMP_UI_IDEAL - JUMP_UI_WINDOW);
  const zw = tw * JUMP_UI_WINDOW * 2;
  ctx.fillStyle = 'rgba(126,240,180,0.85)';
  roundRect(ctx, zx, y0 - 2, zw, th + 4, (th + 4) / 2); ctx.fill();

  // The marker, running the track as the hole passes the blade.
  const mx = x0 + tw * clamp(cut.airT, 0, 1);
  ctx.fillStyle = '#fff6df';
  roundRect(ctx, mx - 3.5, y0 - 8, 7, th + 16, 3.5); ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 21px CisBody, system-ui, sans-serif';
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText('TAP TO JUMP', L.cx, y0 - 15);
  ctx.restore();
}

// How much of the SPLIT track live strain is allowed to claim before real damage
// takes over. Strain must never reach the end of the bar — the end means failure.
const SPLIT_STRAIN_SPAN = 0.45;

export function drawHud(ctx, L, opts) {
  const { level, cut, coins, safeTop, acc, keys } = opts;
  const top = safeTop + 20;

  ctx.save();
  ctx.font = '800 34px CisBody, system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  const tag = level.isDaily ? 'DAILY CUT'
    : level.isEndless ? `ENDLESS  ${level.endlessBoard}` : `LEVEL ${level.n}`;
  // Level and coins are strips of masking tape stuck to the bench, written on in
  // stencil; progress is a tape measure running out along the board.
  const tw = level.isDaily ? 210 : level.isEndless ? 244 : 182;
  UI.tape(ctx, 20 + tw / 2, top + 27, tw, 54, -0.02, tag, {
    font: UI.F.stencil(36),
    ink: level.isDaily ? '#b3261e' : level.isEndless ? '#2f6b2c' : '#2a1a0c',
  });
  UI.tape(ctx, STAGE_W - 111, top + 27, 182, 54, 0.02, null, { seed: 77 });
  ctx.save();
  ctx.translate(STAGE_W - 111, top + 27);
  ctx.rotate(0.02);
  ctx.textAlign = 'right';
  ctx.font = UI.F.stencil(34);
  ctx.fillStyle = '#2a1a0c';
  ctx.fillText(`${coins}`, 74, 2);
  drawCoin(ctx, -58, 0, 16);
  ctx.restore();

  const bw = STAGE_W - 40, bx = 20, by = top + 70;
  const prog = Math.max(0.02, cut.s / cut.plank.length);
  UI.tapeMeasure(ctx, bx, by, bw, 18, prog,
    acc >= 0.9 ? '#f2c230' : acc >= 0.72 ? '#ee9a2e' : '#e0553f');

  // SPLIT meter. It shows ONE quantity in two zones. Up to STRAIN_SPAN it is live
  // strain — how far off the line the blade is right now — which costs nothing and
  // can always be walked back. Past STRAIN_SPAN it is real damage, and the board
  // splits at the end of the track.
  //
  // It used to show damage alone. Damage only moves in the 'off' band, so a player
  // who is tracking the line at all never sees the bar move, and the owner reported
  // it as "doesn't fill up or do anything" — a meter that reads as broken is worse
  // than no meter, and this one is the only warning before a run ends.
  const dy = by + 26;
  const dw = 300, dx = (STAGE_W - dw) / 2, dh = 13;
  const dmg = Math.min(1, cut.damage);
  const strain = Math.min(1, cut.strain ?? 0);
  const shown = Math.max(dmg, strain * SPLIT_STRAIN_SPAN);
  const urgent = dmg > 0.55;
  ctx.textAlign = 'right';
  ctx.font = '800 16px CisBody, system-ui, sans-serif';
  ctx.fillStyle = urgent ? '#ff8a6a' : dmg > 0.02 ? 'rgba(255,190,140,0.8)' : 'rgba(236,222,196,0.7)';
  ctx.fillText('SPLIT', dx - 10, dy + 7);
  ctx.fillStyle = 'rgba(20,12,6,0.65)';
  roundRect(ctx, dx, dy, dw, dh, dh / 2); ctx.fill();
  if (shown > 0.004) {
    const pulse = urgent ? 0.72 + 0.28 * Math.sin(performance.now() / 90) : 1;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = dmg > 0.75 ? '#ff4d3d'
      : dmg > 0.45 ? '#ff9a4d'
      : dmg > 0.02 ? '#ffd35c'
      : strain > 0.86 ? '#ffc65a'
      : strain > 0.5 ? '#c8d98a'
      : '#9fd07a';
    roundRect(ctx, dx, dy, Math.max(dh, dw * shown), dh, dh / 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // The line where strain stops and damage starts. Without it the two zones read as
  // one continuous threat and every wobble looks like it is costing the board.
  ctx.strokeStyle = dmg > 0.02 ? 'rgba(255,180,140,0.55)' : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(dx + dw * SPLIT_STRAIN_SPAN, dy - 1);
  ctx.lineTo(dx + dw * SPLIT_STRAIN_SPAN, dy + dh + 1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, dx, dy, dw, dh, dh / 2); ctx.stroke();

  // Workshop and material label, so the per-level variety is legible.
  ctx.textAlign = 'center';
  ctx.font = '700 19px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(226,240,248,0.55)';
  ctx.fillText(`${level.workshop.name.toUpperCase()}  ·  ${level.material.name.toUpperCase()}`, STAGE_W / 2, by + 60);
  ctx.restore();

  // Keys toward the next treasure chest.
  if (keys > 0) {
    ctx.save();
    for (let i = 0; i < Math.min(keys, 3); i++) drawKey(ctx, 44 + i * 34, top + 138, 13);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 22px CisBody, system-ui, sans-serif';
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`${Math.min(keys, 3)}/3`, 44 + Math.min(keys, 3) * 34, top + 139);
    ctx.restore();
  }

  if (cut.damage > 0.03) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.9, cut.damage);
    const dg = ctx.createLinearGradient(0, 0, 0, L.h);
    dg.addColorStop(0, 'rgba(255,60,40,0.6)');
    dg.addColorStop(0.42, 'rgba(255,60,40,0)');
    dg.addColorStop(0.58, 'rgba(255,60,40,0)');
    dg.addColorStop(1, 'rgba(255,60,40,0.6)');
    ctx.fillStyle = dg;
    ctx.fillRect(L.left, 0, L.right - L.left, L.h);
    ctx.restore();
  }
}

function pill(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
}

// --- The currency strip -----------------------------------------------------
//
// Coins, stars and keys, PINNED to the top of the screen on the scrolling menus rather
// than drawn into the scrolling column. It used to scroll with the content, which meant
// that on a scrolled Workshop the payout from a claimed job flew to a counter that was
// no longer on screen — the reward animation ended at the top edge, pointing at nothing.
//
// `STRIP_COIN_X/Y` is exported because the flights have to start and end exactly where
// the counter actually is; a hard-coded pair of numbers in main.js is what let them
// drift apart in the first place.
export const STRIP_H = 54;
export const STRIP_COIN_X = 62;

export function stripCoinY(safeTop) {
  return safeTop + 18 + STRIP_H / 2;
}

export function drawCurrencyStrip(ctx, L, meta, t, safeTop) {
  const x = 24, w = STAGE_W - 48, y = safeTop + 18;
  // A stained plank screwed across the top of the pegboard wall.
  UI.boardPanel(ctx, x, y, w, STRIP_H, { screws: false, seed: 4242 });
  UI.screw(ctx, x + 14, y + STRIP_H / 2, 5, 11);
  UI.screw(ctx, x + w - 14, y + STRIP_H / 2, 5, 29);
  ctx.save();

  const cy = y + STRIP_H / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = UI.F.stencil(30);
  drawCoin(ctx, STRIP_COIN_X, cy, 15);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`${meta.coins}`, STRIP_COIN_X + 24, cy + 1);

  drawStar(ctx, x + 246, cy, 15, true, t);
  ctx.fillStyle = '#f3e9d2';
  ctx.fillText(`${meta.lifetimeStars}`, x + 268, cy + 1);

  drawKey(ctx, x + 442, cy - 2, 13);
  ctx.fillStyle = '#f3e9d2';
  ctx.fillText(`${meta.keys}/3`, x + 466, cy + 1);
  ctx.restore();
}

// The sprite is modelled over -60..60 world units with the coin's own radius at 34, so
// this is what turns a requested screen radius into a draw box. See tools/gen_coin.py.
const COIN_SPRITE_SCALE = 60 / 34;

export function drawCoin(ctx, x, y, r) {
  const img = ui.coin;
  if (img) {
    const h = r * COIN_SPRITE_SCALE;
    ctx.drawImage(img, x - h, y - h, h * 2, h * 2);
    return;
  }
  // The sprite failed to load. Every coin total in the game still needs a coin beside
  // it, so the old code-drawn one stays as the fallback.
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, '#fff6cc');
  g.addColorStop(0.55, '#ffcc4d');
  g.addColorStop(1, '#d08c17');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = 'rgba(120,74,10,0.65)';
  ctx.lineWidth = Math.max(1, r * 0.13);
  ctx.stroke();
}

export function drawKey(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.5);
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#fff3bd');
  g.addColorStop(0.5, '#ffcc4d');
  g.addColorStop(1, '#c98a12');
  ctx.strokeStyle = g;
  ctx.fillStyle = g;
  ctx.lineWidth = r * 0.34;
  ctx.beginPath(); ctx.arc(0, -r * 0.45, r * 0.5, 0, 6.2832); ctx.stroke();
  ctx.fillRect(-r * 0.17, -r * 0.05, r * 0.34, r * 1.25);
  ctx.fillRect(-r * 0.17, r * 0.62, r * 0.62, r * 0.2);
  ctx.fillRect(-r * 0.17, r * 1.02, r * 0.46, r * 0.2);
  ctx.restore();
}

// Big chest shown when three keys are collected.
export function drawChest(ctx, x, y, s, openT) {
  ctx.save();
  ctx.translate(x, y);
  const lid = -openT * 0.9;
  ctx.fillStyle = '#5a3a1c';
  roundRect(ctx, -s, -s * 0.1, s * 2, s * 1.05, s * 0.12); ctx.fill();
  ctx.fillStyle = '#3d2612';
  roundRect(ctx, -s, s * 0.55, s * 2, s * 0.4, s * 0.1); ctx.fill();
  ctx.save();
  ctx.translate(0, -s * 0.1);
  ctx.rotate(lid);
  ctx.fillStyle = '#6b4622';
  roundRect(ctx, -s, -s * 0.72, s * 2, s * 0.8, s * 0.24); ctx.fill();
  ctx.fillStyle = '#8a5c2c';
  roundRect(ctx, -s * 0.94, -s * 0.66, s * 1.88, s * 0.34, s * 0.16); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ffcc4d';
  roundRect(ctx, -s * 0.16, -s * 0.06, s * 0.32, s * 0.5, s * 0.07); ctx.fill();
  ctx.restore();
}

// `variant` 'purple' is the flawless star — a 100% cut. It is deliberately a
// different COLOUR rather than a fourth gold one: a player has to be able to tell at a
// glance that they got something the normal three stars cannot express.
export function drawStar(ctx, x, y, r, filled, t, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 2) * 0.04);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.46;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (filled) {
    const purple = variant === 'purple';
    const g = ctx.createLinearGradient(0, -r, 0, r);
    if (purple) {
      g.addColorStop(0, '#f8e6ff');
      g.addColorStop(0.42, '#c56bff');
      g.addColorStop(1, '#7a2bd6');
    } else {
      g.addColorStop(0, '#fff8d4');
      g.addColorStop(0.5, '#ffd23f');
      g.addColorStop(1, '#ee9c17');
    }
    ctx.fillStyle = g;
    ctx.shadowColor = purple ? 'rgba(198,110,255,0.95)' : 'rgba(255,200,60,0.85)';
    ctx.shadowBlur = purple ? 34 : 26;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = purple ? 'rgba(70,20,120,0.6)' : 'rgba(140,84,10,0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}
