// The treasure chest ceremony.
//
// The player opens it. That is the whole point: a chest that pops itself and prints
// a number is a notification, whereas three deliberate whacks on a stuck lock is a
// moment. Used by every chest source — the three-keys chest earned during a cut, the
// star chest, the daily chest and the seventh-day streak chest.
//
// 2D since 2026-09-21. The chest is a set of frames rendered offline in Blender by
// tools/gen_chest.py (the CC0 model with its painted texture, real shadows and a heap
// of gold inside): the lid at seven angles, plus each latch and the padlock as their
// own sprites so each one can be knocked off on its own tap. It was drawn live by the
// in-game 3D rasteriser, which could give a face only one flat colour and had no depth
// buffer, and the owner's verdict was that it still did not look good.

import { roundRect, drawCoin, drawKey, drawStar } from './render.js';
import { CHEST_ART } from './chest_sprites.js';
import * as UI from './ui.js';

const TAPS_TO_OPEN = 3;
// The lid's resting angle, degrees. The burst overshoots toward the last frame.
const LID_REST = 104;
// Rendered frame pixels -> logical units on screen.
const SCALE = 0.84;

const img = {};
let loading = null;

export function loadChestArt(prefix = '') {
  if (loading) return loading;
  loading = Promise.all(Object.keys(CHEST_ART.rects).map((n) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { img[n] = im; res(); };
    im.onerror = () => { img[n] = null; res(); };
    im.src = `${prefix}assets/chest/${n}.png`;
  })));
  return loading;
}

// `loot` is an array of { kind: 'coins'|'key'|'star', label, amount, colour }.
export function createChestScene(loot, title) {
  loadChestArt();
  return {
    title: title || 'TREASURE CHEST',
    loot,
    taps: 0,
    t: 0,
    stage: 'closed',     // closed -> burst -> loot
    hit: 0,              // decaying impact, drives the shake
    lid: 0,              // lid angle in degrees
    glow: 0,
    burstT: 0,
    popped: [],          // { i, t, vx, vy, spin } — latches knocked off
    lockT: -1,           // the padlock falls once the last latch goes
  };
}

export function chestTap(S) {
  if (S.stage !== 'closed') return null;
  S.taps++;
  S.hit = 1;
  const side = S.taps - 2;           // -1, 0, +1: latches fly away from the middle
  S.popped.push({
    i: S.taps - 1,
    t: 0,
    vx: (side || (Math.random() - 0.5)) * (260 + Math.random() * 120),
    vy: 620 + Math.random() * 160,
    spin: (side || 1) * (6 + Math.random() * 4),
  });
  if (S.taps >= TAPS_TO_OPEN) {
    S.stage = 'burst';
    S.burstT = 0;
    S.lockT = 0;
    return 'open';
  }
  return 'hit';
}

export function updateChest(S, dt) {
  S.t += dt;
  S.hit = Math.max(0, S.hit - dt * 3.4);
  S.glow += ((S.taps / TAPS_TO_OPEN) - S.glow) * Math.min(1, dt * 6);
  for (const p of S.popped) p.t += dt;
  if (S.lockT >= 0) S.lockT += dt;
  if (S.stage !== 'closed') {
    S.burstT += dt;
    // Snaps past its resting angle and settles back — a linear open reads as a lid
    // being placed rather than one bursting off.
    const t = Math.min(1, S.burstT / 0.5);
    const e = 1 - Math.pow(1 - t, 3);
    const settle = Math.sin(Math.min(1, S.burstT / 0.95) * Math.PI);
    S.lid = Math.min(118, e * LID_REST + settle * 13);
    if (S.burstT > 0.75) S.stage = 'loot';
  }
}

export function chestReadyToCollect(S) {
  return S.stage === 'loot' && S.burstT > 1.0;
}

// Draws one named image from the shared frame, whose top-left is at (fx, fy).
function blit(ctx, name, fx, fy, alpha = 1) {
  const im = img[name];
  if (!im) return false;
  const [x, y, w, h] = CHEST_ART.rects[name];
  if (alpha < 1) { ctx.save(); ctx.globalAlpha *= alpha; }
  ctx.drawImage(im, fx + x * SCALE, fy + y * SCALE, w * SCALE, h * SCALE);
  if (alpha < 1) ctx.restore();
  return true;
}

// The lid at any angle: the two nearest rendered frames, cross-faded. The lower frame
// is drawn fully and the upper faded in over it, so the chest itself never goes
// translucent — only the lid, which is the part that is moving, blurs between two.
function drawLid(ctx, deg, fx, fy) {
  const A = CHEST_ART.lidAngles;
  let i = 0;
  while (i < A.length - 2 && deg > A[i + 1]) i++;
  const f = Math.max(0, Math.min(1, (deg - A[i]) / (A[i + 1] - A[i])));
  if (f < 0.98) blit(ctx, `lid_${i}`, fx, fy);
  if (f > 0.02) blit(ctx, `lid_${i + 1}`, fx, fy, f < 0.98 ? f : 1);
}

export function drawChestScene(ctx, L, S, button, view) {
  const cx = L.cx;
  const cy = L.h * 0.42;
  // The frame is placed so the chest's base point sits a fixed distance below cy,
  // whatever the crop — so the chest does not jump when frames change.
  const [bx0, by0] = CHEST_ART.base;
  const fx0 = cx - bx0 * SCALE;
  const fy0 = cy + 150 - by0 * SCALE;
  const at = (p) => [fx0 + p[0] * SCALE, fy0 + p[1] * SCALE];

  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 760);
  const warm = 0.16 + S.glow * 0.32 + (S.stage !== 'closed' ? 0.34 : 0);
  g.addColorStop(0, `rgba(${60 + warm * 190 | 0},${44 + warm * 150 | 0},${18 + warm * 60 | 0},0.96)`);
  g.addColorStop(0.42, 'rgba(22,18,14,0.97)');
  g.addColorStop(1, 'rgba(6,8,11,0.99)');
  ctx.fillStyle = g;
  ctx.fillRect(L.left, 0, L.right - L.left, L.h);
  ctx.restore();

  // Light shafts out of the open mouth.
  const [mx, my] = at(CHEST_ART.mouth);
  if (S.stage !== 'closed') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const a = Math.min(1, S.burstT * 2.4) * 0.5;
    for (let i = 0; i < 9; i++) {
      const ang = -Math.PI / 2 + (i - 4) * 0.19 + Math.sin(S.t * 1.4 + i) * 0.03;
      const len = 620;
      ctx.globalAlpha = a * (0.28 + 0.22 * Math.sin(S.t * 3 + i * 1.7));
      const grad = ctx.createLinearGradient(mx, my, mx + Math.cos(ang) * len, my + Math.sin(ang) * len);
      grad.addColorStop(0, 'rgba(255,226,140,0.85)');
      grad.addColorStop(1, 'rgba(255,190,70,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(ang - 0.075) * len, my + Math.sin(ang - 0.075) * len);
      ctx.lineTo(mx + Math.cos(ang + 0.075) * len, my + Math.sin(ang + 0.075) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = UI.F.stencil(46);
  ctx.fillStyle = '#ffd873';
  ctx.fillText(S.title, cx, 92 + view.safeTop);
  ctx.restore();

  // --- The chest itself. Shake and squash about its base, so a whack reads as a
  // weight being hit rather than a picture wobbling.
  const shakeX = S.hit * Math.sin(S.t * 90) * 14;
  const shakeY = S.hit * Math.cos(S.t * 77) * 7;
  // A slow idle rock while it waits to be hit, so the screen is never a still.
  const rock = S.stage === 'closed' ? Math.sin(S.t * 1.6) * 0.012 : 0;
  const [bx, by] = at(CHEST_ART.base);
  ctx.save();
  ctx.translate(bx + shakeX, by + shakeY);
  ctx.rotate(rock);
  ctx.scale(1 + S.hit * 0.07, 1 - S.hit * 0.09);
  ctx.translate(-bx, -by);

  if (!img.lid_0) {
    ctx.textAlign = 'center';
    ctx.font = '800 26px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,233,168,0.7)';
    ctx.fillText('…', cx, cy);
  }
  drawLid(ctx, S.lid, fx0, fy0);

  // Ironmongery still in place.
  for (let i = 0; i < TAPS_TO_OPEN; i++) {
    if (!S.popped.some((q) => q.i === i)) blit(ctx, `latch_${i}`, fx0, fy0);
  }
  if (S.lockT < 0) blit(ctx, 'lock', fx0, fy0);
  ctx.restore();

  // Glow leaking from the seam as the lock weakens.
  if (S.glow > 0.02 && S.stage === 'closed') {
    const [ax, ay] = at(CHEST_ART.seam[0]);
    const [bx2, by2] = at(CHEST_ART.seam[1]);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = S.glow * (0.5 + 0.5 * Math.sin(S.t * 9));
    ctx.strokeStyle = 'rgba(255,220,130,0.9)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5 + S.glow * 8;
    ctx.beginPath();
    ctx.moveTo(ax + shakeX, ay + shakeY - 4);
    ctx.lineTo(bx2 + shakeX, by2 + shakeY - 4);
    ctx.stroke();
    ctx.restore();
  }

  // Knocked-off latches tumble away under gravity, turning about their own centre.
  for (const p of S.popped) {
    if (p.t > 1.4) continue;
    const [px, py] = at(CHEST_ART.latch[p.i]);
    const dx = p.vx * p.t;
    const dy = -p.vy * p.t + 1500 * p.t * p.t;
    ctx.save();
    ctx.translate(px + dx, py + dy);
    ctx.rotate(p.spin * p.t);
    ctx.translate(-px, -py);
    blit(ctx, `latch_${p.i}`, fx0, fy0, Math.max(0, 1 - p.t / 1.4));
    ctx.restore();
  }
  // The padlock drops straight off once the last latch goes.
  if (S.lockT >= 0 && S.lockT < 1.2) {
    const [lx, ly] = at(CHEST_ART.lock);
    ctx.save();
    ctx.translate(lx, ly + 900 * S.lockT * S.lockT);
    ctx.rotate(S.lockT * 2.2);
    ctx.translate(-lx, -ly);
    blit(ctx, 'lock', fx0, fy0, Math.max(0, 1 - S.lockT / 1.2));
    ctx.restore();
  }

  // --- Prompt / loot
  if (S.stage === 'closed') {
    const pulse = 0.62 + 0.38 * Math.sin(S.t * 5);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = pulse;
    ctx.font = UI.F.stencil(44);
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(20,12,4,0.85)';
    const msg = S.taps === 0 ? 'TAP TO OPEN' : S.taps === 1 ? 'AGAIN!' : 'ONE MORE!';
    ctx.strokeText(msg, cx, L.h - 260 - view.safeBottom);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(msg, cx, L.h - 260 - view.safeBottom);
    ctx.globalAlpha = 1;

    // Lock-strength pips.
    const n = TAPS_TO_OPEN;
    const w = 56, gap = 12;
    let px = cx - (n * w + (n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < S.taps ? '#ffd23f' : 'rgba(255,255,255,0.18)';
      roundRect(ctx, px, L.h - 214 - view.safeBottom, w, 12, 6);
      ctx.fill();
      px += w + gap;
    }
    ctx.restore();
    return;
  }

  // Loot cards rise out of the chest's mouth and land in a row.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = S.loot.length;
  const cw = Math.min(230, (720 - 80) / n - 14);
  const gap = 14;
  let lx = cx - (n * cw + (n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) {
    const item = S.loot[i];
    const delay = 0.16 + i * 0.13;
    const t = Math.max(0, Math.min(1, (S.burstT - delay) / 0.45));
    if (t <= 0) { lx += cw + gap; continue; }
    const e = 1 - Math.pow(1 - t, 3);
    const sc = 0.5 + 0.5 * e + Math.sin(t * Math.PI) * 0.14;
    const yy = L.h - 300 - view.safeBottom;
    const py = my + (yy - my) * e;
    const ppx = mx + (lx + cw / 2 - mx) * e;

    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2);
    ctx.translate(ppx, py);
    ctx.scale(sc, sc);
    // A kraft price tag per item, strung to the chest.
    UI.priceTag(ctx, -cw / 2, -84, cw, 168);

    if (item.kind === 'coins') drawCoin(ctx, 0, -18, 30);
    else if (item.kind === 'key') drawKey(ctx, 0, -28, 26);
    else if (item.kind === 'star') drawStar(ctx, 0, -18, 30, true, S.t);
    else {
      ctx.fillStyle = item.colour || '#7df0ff';
      roundRect(ctx, -26, -46, 52, 48, 12);
      ctx.fill();
    }

    ctx.font = UI.F.stencil(34);
    ctx.fillStyle = '#23170c';
    ctx.fillText(item.amount, 0, 30);
    ctx.font = UI.F.marker(20);
    ctx.fillStyle = '#3a2a1a';
    ctx.fillText(item.label, 0, 58);
    ctx.restore();
    lx += cw + gap;
  }
  ctx.restore();

  if (chestReadyToCollect(S)) {
    button('chest-collect', 96, L.h - 150 - view.safeBottom, 720 - 192, 86, 'COLLECT', 'reward');
  }
}

export { TAPS_TO_OPEN };
