// The Build screen: a whole screen given over to the kitchen the player is fitting out.
//
// This is where coins go, so it has to be worth looking at. It is 2D: one fixed
// isometric view of the room, composited from sprites that tools/gen_kitchen.py
// renders offline in Blender (see §2 "The Build screen is 2D" for why it stopped
// being live 3D). Every part the player buys drops into the room and lands; the
// unbought remainder is a pale ghost of the finished room, so the goal is always on
// screen, and the NEXT part's ghost pulses so the player can see where it will go.
//
// Defends D1 retention: the reason to come back tomorrow is a half-fitted kitchen you
// can actually see.

import { KITCHEN_BY_ID, spriteKey } from './kitchens.js';
import { KITCHEN_ART } from './kitchen_sprites.js';
import { roundRect, drawCoin } from './render.js';
import * as UI from './ui.js';
import { currentProject, nextPart, PROJECTS } from './meta.js';

const PART_IN = 1.05;          // seconds for a bought part to drop into place

// Heights of the objects, for the depth sort only (a flower on a worktop must draw
// after the worktop). From tools/blender/kitchen_models.py.
const OBJ_H = {
  floor: 0.02, counter: 0.70, sink: 0.92, oven: 0.82, fridge: 1.40,
  cabinet: 0.53, window: 0.80, chair: 0.74, flower: 0.37,
  workbench: 0.80, pegboard: 0.70, toolchest: 0.88, lumberrack: 1.45, sawhorses: 0.57,
  stool: 0.59, shopvac: 0.62, offcuts: 0.56, radio: 0.20,
  rug: 0.01, fireplace: 1.12, sofa: 0.75, armchair: 0.81, coffeetable: 0.46,
  bookshelf: 1.70, floorlamp: 1.49, painting: 0.56, plant: 1.0, sidetable: 0.79, pouf: 0.35,
  piano: 1.14, pianobench: 0.51, drums: 1.0, guitar: 1.14, eguitar: 1.3, amp: 0.51,
  records: 0.72, speakers: 0.9, panels: 0.6,
};

// --- Art -------------------------------------------------------------------------

const img = {};
const sil = {};             // shadow-free silhouettes, for the ghost
let artLoading = null;

// The ghost must be the OBJECT's outline, not the sprite's. A sprite carries its cast
// shadow as dark translucent pixels, and flattened to the ghost's pale colour that
// shadow became a pale box on the wall behind every unbought wall cabinet. Shadow
// pixels are near-black and translucent; everything else is kept.
function silhouette(im) {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  try {
    const d = x.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 235 && Math.max(p[i], p[i + 1], p[i + 2]) < 40) p[i + 3] = 0;
    }
    x.putImageData(d, 0, 0);
  } catch (e) { /* a tainted canvas keeps the plain sprite */ }
  return c;
}

// Not awaited at boot: the Build screen is at least one tap away from launch, and
// nothing here may cost the first frame. A room drawn before its images arrive shows
// a short "unpacking" line instead of a broken picture.
export function loadKitchenArt(prefix = '') {
  if (artLoading) return artLoading;
  const names = [
    ...Object.keys(KITCHEN_ART.sprites),
    ...Object.keys(KITCHEN_ART.rooms).map((k) => `room_${k}`),
  ];
  artLoading = Promise.all(names.map((n) => new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      img[n] = im;
      if (!n.startsWith('room_')) sil[n] = silhouette(im);
      res();
    };
    im.onerror = () => { img[n] = null; res(); };
    im.src = `${prefix}assets/kitchen/${n}.png`;
  })));
  return artLoading;
}

export function kitchenArtReady(kitchenId) {
  return !!img[`room_${kitchenId}`];
}

// --- Projection --------------------------------------------------------------------
//
// The sprites were rendered by one orthographic camera. A game-space point
// (x right, y up, z toward the viewer) is (x, -z, y) in Blender space, and lands
// K * (P·R, -P·U) pixels from wherever the room's own origin landed.
const { K, R, U } = KITCHEN_ART;
// Toward the camera: R x U. Larger is nearer, so it is the painter's key.
const TOWARD = [
  R[1] * U[2] - R[2] * U[1],
  R[2] * U[0] - R[0] * U[2],
  R[0] * U[1] - R[1] * U[0],
];

function blender(x, y, z) { return [x, -z, y]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// The kitchen's items in draw order, each with its offset from the room origin in
// rendered pixels. Cached per kitchen; the layout never changes.
const planCache = new Map();
function plan(kitchenId) {
  let p = planCache.get(kitchenId);
  if (p) return p;
  const k = KITCHEN_BY_ID[kitchenId];
  p = k.items.map((it, i) => {
    const P = blender(it.x || 0, it.y || 0, it.z || 0);
    const C = blender(it.x || 0, (it.y || 0) + (OBJ_H[it.obj] || 0.5) / 2, it.z || 0);
    const key = spriteKey(it);
    return {
      i,
      key,
      dx: K * dot(P, R),
      dy: -K * dot(P, U),
      // The floor is under everything: a tile's centre sits mid-room while the
      // cabinets standing on it have centres near the wall, so depth alone would put
      // tiles over furniture.
      // A rug lies on the floorboards and under everything else.
      layer: it.obj === 'floor' ? -2 : it.obj === 'rug' ? -1 : 0,
      depth: dot(C, TOWARD),
    };
  });
  p.sort((a, b) => (a.layer - b.layer) || (a.depth - b.depth));
  planCache.set(kitchenId, p);
  return p;
}

// Draws a kitchen centred on (cx, cy), fitted inside maxW x maxH. `solid(i)` says
// whether part i is bought; `anim` is { index, t } for a part dropping in.
// Returns false if the art is not loaded yet.
function drawKitchen(ctx, kitchenId, bought, cx, cy, maxW, maxH, opts = {}) {
  const room = KITCHEN_ART.rooms[kitchenId];
  const roomImg = img[`room_${kitchenId}`];
  if (!room || !roomImg) return false;
  const s = Math.min(maxW / room.w, maxH / room.h);
  const ox = cx - (room.w * s) / 2 + room.ax * s;     // room origin on screen
  const oy = cy - (room.h * s) / 2 + room.ay * s;
  ctx.drawImage(roomImg, cx - (room.w * s) / 2, cy - (room.h * s) / 2, room.w * s, room.h * s);

  const items = plan(kitchenId);
  const place = (it) => {
    const sp = KITCHEN_ART.sprites[it.key];
    return { sp, x: ox + it.dx * s - sp.ax * s, y: oy + it.dy * s - sp.ay * s };
  };

  // Ghosts first: rendered OPAQUELY into a buffer, flattened to one pale colour and
  // composited once, so overlapping ghosts read as one even silhouette rather than a
  // stack of translucent layers (the same rule the 3D ghost learned, §6).
  const ghosts = items.filter((it) => !bought(it.i));
  if (ghosts.length && opts.ghost !== false) {
    const g = ghostCanvas(ctx.canvas);
    const gc = g.getContext('2d');
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.clearRect(0, 0, g.width, g.height);
    gc.setTransform(ctx.getTransform());
    for (const it of ghosts) {
      const im = sil[it.key] || img[it.key];
      if (!im) continue;
      const q = place(it);
      gc.drawImage(im, q.x, q.y, q.sp.w * s, q.sp.h * s);
    }
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.globalCompositeOperation = 'source-in';
    gc.fillStyle = 'rgb(236,244,250)';
    gc.fillRect(0, 0, g.width, g.height);
    gc.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opts.ghostAlpha ?? 0.22;
    ctx.drawImage(g, 0, 0);
    ctx.restore();

    // The next part pulses on top of the ghost, so the player can see where it goes.
    if (opts.nextIndex != null && opts.pulse != null) {
      const it = items.find((q) => q.i === opts.nextIndex);
      const im = it && img[it.key];
      if (im) {
        const q = place(it);
        ctx.save();
        ctx.globalAlpha = 0.18 + 0.22 * opts.pulse;
        ctx.drawImage(im, q.x, q.y, q.sp.w * s, q.sp.h * s);
        ctx.restore();
      }
    }
  }

  for (const it of items) {
    if (!bought(it.i)) continue;
    const im = img[it.key];
    if (!im) continue;
    const q = place(it);
    const w = q.sp.w * s, h = q.sp.h * s;
    if (opts.anim && opts.anim.index === it.i) {
      const t = Math.min(1, opts.anim.t / PART_IN);
      const e = easeOutBounce(t);
      const drop = (1 - e) * 520 * (maxH / 700);
      // A small squash the moment it lands, anchored at its base.
      const land = t > 0.55 ? Math.sin(Math.min(1, (t - 0.55) / 0.3) * Math.PI) : 0;
      const sy = 1 - land * 0.07, sx = 1 + land * 0.05;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 4);
      ctx.translate(q.x + w / 2, q.y + h - drop);
      ctx.scale(sx, sy);
      ctx.drawImage(im, -w / 2, -h, w, h);
      ctx.restore();
      continue;
    }
    ctx.drawImage(im, q.x, q.y, w, h);
  }
  return true;
}

let ghostBuf = null;
function ghostCanvas(target) {
  if (!ghostBuf) ghostBuf = document.createElement('canvas');
  if (ghostBuf.width !== target.width || ghostBuf.height !== target.height) {
    ghostBuf.width = target.width;
    ghostBuf.height = target.height;
  }
  return ghostBuf;
}

function easeOutBounce(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
  if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
  t -= 2.625 / d;
  return n * t * t + 0.984375;
}
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// --- State -------------------------------------------------------------------------

export function createBuild() {
  return {
    projectId: null,
    anim: null,               // { index, t }
    celebrate: 0,
    // A finished kitchen stays on screen until the player moves on. The meta has
    // already advanced to the next project the moment the last part was bought, and
    // the screen used to follow it straight away — so the payoff for finishing a
    // kitchen was played over the NEXT, empty kitchen (the 2026-09-17 audit's #4).
    showcase: null,           // { id } while a finished kitchen is being shown off
    // A finished room the player is looking back at (owner, 2026-09-28: "a way to
    // look and inspect all the previous builds"). null = the room being built.
    view: null,
    intro: 0,
  };
}

// Rooms the player can flip through: every finished one plus the one in progress.
function browsable(meta) {
  const cur = PROJECTS.indexOf(currentProject(meta));
  return PROJECTS.slice(0, Math.max(0, cur) + 1);
}

export function browseRoom(B, meta, dir) {
  if (B.showcase) return false;
  const list = browsable(meta);
  const at = list.findIndex((p) => p.id === (B.view || B.projectId));
  const next = list[at + dir];
  if (!next) return false;
  B.view = next.id === currentProject(meta).id ? null : next.id;
  B.anim = null;
  B.intro = 0;
  return true;
}

export function viewCurrentRoom(B) {
  B.view = null;
  B.intro = 0;
}

export function ensureProject(B, meta) {
  if (B.showcase) return;
  const proj = currentProject(meta);
  if (B.projectId === proj.id) return;
  B.projectId = proj.id;
  B.anim = null;
  B.celebrate = 0;
  B.intro = 0;
}

export function playPart(B, index) {
  B.anim = { index, t: 0 };
}

// Called when the last part of a kitchen is bought: hold that kitchen, complete.
export function celebrate(B) {
  B.celebrate = 2.4;
  B.showcase = { id: B.projectId };
}

export function endShowcase(B, meta) {
  B.showcase = null;
  ensureProject(B, meta);
}

export function updateBuild(B, dt) {
  B.intro = Math.min(1, B.intro + dt * 2.4);
  if (B.celebrate > 0) B.celebrate = Math.max(0, B.celebrate - dt);
  if (B.anim) {
    B.anim.t += dt;
    if (B.anim.t >= PART_IN) B.anim = null;
  }
}

export function partLanding(B) {
  return B.anim ? B.anim.t / PART_IN : -1;
}

// Where the kitchen is drawn on the Build screen — main.js aims coin flights and the
// landing ring at it.
export function viewport(L, view) {
  const top = 150 + view.safeTop;
  const bottom = L.h - 340 - view.safeBottom;
  return { x: 0, y: top, w: 720, h: Math.max(300, bottom - top) };
}

// --- Screen ------------------------------------------------------------------------

export function drawBuild(ctx, L, meta, B, button, t, view) {
  const past = !B.showcase && B.view ? B.view : null;
  const showId = B.showcase ? B.showcase.id : (past || B.projectId);
  const proj = PROJECTS.find((p) => p.id === showId) || currentProject(meta);
  const part = B.showcase || past ? null : nextPart(meta);
  const bought = B.showcase || past ? proj.parts.length : meta.partsBought;
  const rooms = browsable(meta);
  const roomAt = rooms.findIndex((p) => p.id === showId);
  const v = viewport(L, view);

  // Backdrop in THIS kitchen's colours, so finishing one and starting the next is a
  // visible change of room.
  const pal = (KITCHEN_BY_ID[showId] || {}).palette
    || { bg0: '#26333f', bg1: '#18222c', bg2: '#0d141a' };
  const g = ctx.createRadialGradient(L.cx, v.y + v.h * 0.45, 40, L.cx, v.y + v.h * 0.45, 640);
  g.addColorStop(0, pal.bg0);
  g.addColorStop(0.55, pal.bg1);
  g.addColorStop(1, pal.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(L.left, 0, L.right - L.left, L.h);

  // Soft floor glow under the room, so it sits in the space instead of on a void.
  ctx.save();
  const fg0 = ctx.createRadialGradient(L.cx, v.y + v.h * 0.72, 10, L.cx, v.y + v.h * 0.72, 380);
  fg0.addColorStop(0, 'rgba(0,0,0,0.38)');
  fg0.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fg0;
  ctx.beginPath();
  ctx.ellipse(L.cx, v.y + v.h * 0.72, 380, 110, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- The room
  const introS = 0.9 + 0.1 * easeOutCubic(B.intro);
  const bob = B.celebrate > 0 ? Math.sin(t * 9) * 4 * (B.celebrate / 2.4) : 0;
  ctx.save();
  ctx.globalAlpha = B.intro;
  ctx.translate(L.cx, v.y + v.h / 2 + bob);
  ctx.scale(introS, introS);
  ctx.translate(-L.cx, -(v.y + v.h / 2));
  const ok = drawKitchen(ctx, showId, (i) => i < bought, L.cx, v.y + v.h / 2,
    v.w * 0.94, v.h * 0.96, {
      anim: B.anim,
      nextIndex: part ? meta.partsBought : null,
      pulse: 0.5 + 0.5 * Math.sin(t * 4),
    });
  ctx.restore();
  if (!ok) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 26px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(236,220,190,0.7)';
    ctx.fillText('Unpacking the room…', L.cx, v.y + v.h / 2);
    ctx.restore();
  }

  // --- Header
  ctx.save();
  ctx.textBaseline = 'middle';
  const hg = ctx.createLinearGradient(0, 0, 0, 150 + view.safeTop);
  hg.addColorStop(0, 'rgba(16,10,6,0.94)');
  hg.addColorStop(1, 'rgba(16,10,6,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(L.left, 0, L.right - L.left, 150 + view.safeTop);

  ctx.textAlign = 'center';
  // The room's name on a plank sign, like the one over the home screen.
  UI.plankSign(ctx, L.cx, 54 + view.safeTop, 440, 74, proj.name.toUpperCase(), 46);

  ctx.font = '800 24px CisBody, system-ui, sans-serif';
  ctx.fillStyle = B.showcase || past ? '#63e08a' : 'rgba(236,220,190,0.8)';
  ctx.font = UI.F.body(800, 24);
  ctx.fillText(B.showcase ? 'COMPLETE!'
    : past ? `\u2713 BUILT  \u00b7  ROOM ${roomAt + 1} OF ${PROJECTS.length}`
      : `${bought} / ${proj.parts.length} PARTS`,
    L.cx, 110 + view.safeTop);

  // Part pips — the whole project at a glance.
  const n = proj.parts.length;
  const gap = 8;
  const pw = Math.min(44, (620 - (n - 1) * gap) / n);
  let bx = L.cx - (n * pw + (n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) {
    const done = i < bought;
    const isNew = B.anim && B.anim.index === i;
    const pop = isNew ? 1 + 0.5 * Math.sin(Math.min(1, B.anim.t / 0.4) * Math.PI) : 1;
    ctx.save();
    ctx.translate(bx + pw / 2, 138 + view.safeTop);
    ctx.scale(pop, pop);
    ctx.fillStyle = done ? '#63e08a' : 'rgba(255,255,255,0.16)';
    roundRect(ctx, -pw / 2, -5, pw, 10, 5);
    ctx.fill();
    ctx.restore();
    bx += pw + gap;
  }
  ctx.restore();

  // Flip between finished rooms and the current one. Only drawn when there is
  // somewhere to go, so a first-room player sees no dead arrows.
  if (!B.showcase && rooms.length > 1) {
    const ay = 26 + view.safeTop;
    if (roomAt > 0) button('build-room-prev', 18, ay, 70, 70, '\u25c0', 'ghost');
    if (roomAt >= 0 && roomAt < rooms.length - 1) {
      button('build-room-next', 720 - 88, ay, 70, 70, '\u25b6', 'ghost');
    }
  }

  // --- Footer
  const fy = L.h - 322 - view.safeBottom;
  ctx.save();
  const ffg = ctx.createLinearGradient(0, fy - 40, 0, L.h);
  ffg.addColorStop(0, 'rgba(16,10,6,0)');
  ffg.addColorStop(0.3, 'rgba(16,10,6,0.92)');
  ffg.addColorStop(1, 'rgba(16,10,6,0.98)');
  ctx.fillStyle = ffg;
  ctx.fillRect(L.left, fy - 40, L.right - L.left, L.h - fy + 40);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '800 26px CisBody, system-ui, sans-serif';
  drawCoin(ctx, 52, fy + 22, 16);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`${meta.coins}`, 78, fy + 22);
  ctx.restore();

  const bw = 720 - 96;
  if (past) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 26px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(236,220,190,0.85)';
    ctx.fillText(`Finished \u2014 all ${proj.parts.length} pieces`, L.cx, fy + 70);
    ctx.restore();
    button('build-room-current', 48, fy + 96, bw, 88,
      `BACK TO ${currentProject(meta).name.toUpperCase()}`, 'primary');
  } else if (B.showcase) {
    const more = currentProject(meta).id !== B.showcase.id;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = UI.F.stencil(32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(more ? `Next: ${currentProject(meta).name}` : 'Every room built!', L.cx, fy + 70);
    ctx.restore();
    if (more) button('build-next', 48, fy + 96, bw, 88, 'NEXT ROOM', 'primary');
  } else if (part) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = UI.F.stencil(32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Next: ${part.name}`, L.cx, fy + 70);
    ctx.restore();
    const afford = meta.coins >= part.cost;
    button('buy-part', 48, fy + 96, bw, 88, `${part.cost}`,
      afford ? 'primary' : 'ghost', null, { coin: true });
  } else {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = UI.F.stencil(36);
    ctx.fillStyle = '#63e08a';
    ctx.fillText('COMPLETE!', L.cx, fy + 128);
    ctx.restore();
  }
  button('close-build', 48, fy + 202, bw, 76, 'BACK', 'ghost');
}

// A small picture of a project for the Workshop card: the same compositor at badge
// size, cached per (project, parts, size) because it only changes when a part is
// bought and it sits behind a scrolling list.
const badgePixels = new Map();
export function drawProjectBadge(ctx, x, y, size, projectId, partsBought) {
  const pxKey = `${projectId}|${partsBought}|${Math.round(size)}`;
  let cv = badgePixels.get(pxKey);
  if (!cv) {
    if (!kitchenArtReady(projectId)) { loadKitchenArt(); return; }
    cv = document.createElement('canvas');
    const scale = 2;
    cv.width = Math.ceil(size * scale);
    cv.height = Math.ceil(size * scale);
    const c = cv.getContext('2d');
    c.setTransform(scale, 0, 0, scale, 0, 0);
    drawKitchen(c, projectId, (i) => i < partsBought, size / 2, size / 2, size * 0.96, size * 0.96,
      { ghostAlpha: 0.3 });
    if (badgePixels.size > 24) badgePixels.clear();
    badgePixels.set(pxKey, cv);
  }
  ctx.drawImage(cv, x - size / 2, y - size / 2, size, size);
}

export { PROJECTS };
