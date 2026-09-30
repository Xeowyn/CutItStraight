// Pause menu and level select.
//
// These exist because the previous pass buried every new feature behind
// "finish a level -> WORKSHOP -> scroll to the bottom". Options the player has to
// hunt for are options they do not have. A gear on the HUD now reaches settings,
// the Workshop, the Build screen and level select at any moment, mid-cut included.

import { roundRect, drawCoin, drawStar, textureImage, ensureTexture } from './render.js';
import * as UI from './ui.js';
import { levelPreview, LEVEL_COUNT, ENDLESS_SPEEDS, ENDLESS_LINES, endlessPayMult } from './levels.js';

const W = 720;

// --- Main menu -------------------------------------------------------------
//
// The game used to drop the player straight into level 1 with no menu at all, on the
// conversion argument in §2. That is still the right instinct and this screen keeps
// it — PLAY is one tap, it is the biggest thing on the page, and it resumes the level
// the player was on rather than asking them to choose anything. What it fixes is the
// other half of the problem: with no home screen, level select, the Workshop and the
// Build project only existed behind a gear on the play HUD, and the owner went
// looking for them and could not find them. A player who has just launched the game
// should be able to see everything the game contains without tapping anything.

export function drawHomeMenu(ctx, L, meta, button, t, view, opts) {
  const {
    levelNum = 1, maxLevel = 1, endless = false, dailyChest = false,
    adFree = false, dev = false, campaignDone = false,
  } = opts || {};

  const pw = W - 96;
  const px = (W - pw) / 2;

  // Heights are summed first so the whole block can be centred in a viewport whose
  // logical height varies from 1150 (desktop) to ~1560 (tall phone).
  const H_HEAD = 186;
  const H_PLAY = 104;
  const H_ROW = 88;
  const H_GRID = 86;
  const GAP = 14;
  let total = H_HEAD + H_PLAY + GAP;
  if (dailyChest) total += H_ROW + GAP;
  total += H_ROW + GAP;                 // endless
  total += (H_GRID + GAP) * 2;          // 2x2 grid
  total += 66 + GAP;                    // SFX + MUSIC sliders
  total += 58;                          // invert
  if (dev) total += 66 + GAP;

  let y = Math.max(view.safeTop + 24, (L.h - total) / 2 - 20);

  ctx.save();
  // A graded veil rather than a flat one: dark enough behind the title and the
  // buttons to keep every label at full contrast, and thin enough across the middle
  // that the bench and the saw read as a real workshop behind the menu. A flat 0.78
  // fill made the backdrop look like a black screen with a stripe on it.
  const veil = ctx.createLinearGradient(0, 0, 0, L.h);
  veil.addColorStop(0, 'rgba(14,9,5,0.88)');
  veil.addColorStop(0.42, 'rgba(14,9,5,0.60)');
  veil.addColorStop(1, 'rgba(14,9,5,0.86)');
  ctx.fillStyle = veil;
  ctx.fillRect(L.left, 0, L.right - L.left, L.h);

  // Title. Drawn on its own rather than inside a card: the wood and the saw are
  // visible behind it, which is the fastest possible answer to "what is this game".
  // A stencilled plank sign rather than gradient-filled outlined text — the old
  // treatment was the generic "game title" look.
  UI.plankSign(ctx, L.cx, y + 42, 560, 92, 'CUT IT STRAIGHT', 66);
  UI.tape(ctx, L.cx + 40, y + 102, 470, 36, 0.012, 'Feed the board. Follow the line. Don\u2019t split it.',
    { size: 19 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Coins, stars and campaign progress in one strip, so the home screen answers
  // "where am I up to" without a tap.
  const sy = y + 138;
  ctx.font = '800 26px CisBody, system-ui, sans-serif';
  ctx.textAlign = 'left';
  drawCoin(ctx, px + 18, sy, 16);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`${meta.coins}`, px + 42, sy);
  drawStar(ctx, px + 176, sy, 16, true, t);
  ctx.fillStyle = '#f3e9d2';
  ctx.fillText(`${meta.lifetimeStars}`, px + 198, sy);
  ctx.textAlign = 'right';
  ctx.font = '800 22px CisBody, system-ui, sans-serif';
  ctx.fillStyle = campaignDone ? '#8fe87c' : 'rgba(232,214,182,0.8)';
  ctx.fillText(campaignDone
    ? `ALL ${LEVEL_COUNT} BOARDS CUT`
    : `LEVEL ${Math.min(maxLevel, LEVEL_COUNT)} OF ${LEVEL_COUNT}`, px + pw - 18, sy);

  // A thin progress rule under the strip: the campaign has an end now, so show it.
  const barW = pw - 36, barX = px + 18, barY = sy + 26;
  ctx.fillStyle = 'rgba(22,14,8,0.7)';
  roundRect(ctx, barX, barY, barW, 8, 4); ctx.fill();
  ctx.fillStyle = campaignDone ? '#8fe87c' : '#f2c230';
  roundRect(ctx, barX, barY, Math.max(8, barW * Math.min(1, (maxLevel - 1) / LEVEL_COUNT)), 8, 4);
  ctx.fill();
  ctx.restore();

  y += H_HEAD;

  // PLAY is deliberately the only tall button on the screen. One tap from launch to
  // cutting is the platform's limit and the top-converting shape.
  const playLabel = maxLevel > 1 ? `PLAY  \u00b7  LEVEL ${Math.min(levelNum, LEVEL_COUNT)}` : 'PLAY';
  button('home-play', px, y, pw, H_PLAY, playLabel, 'primary',
    maxLevel > 1 ? 'Carry on where you left off' : 'Follow the line with the saw');
  y += H_PLAY + GAP;

  if (dailyChest) {
    button('daily-chest', px, y, pw, H_ROW, 'DAILY FREE CHEST', 'reward',
      adFree ? 'Coins and a key, once a day' : '\u25b6 Watch a short ad');
    y += H_ROW + GAP;
  }

  if (endless) {
    button('home-endless', px, y, pw, H_ROW, 'ENDLESS MODE', 'reward',
      'Pick your own speed and line');
  } else {
    // Shown locked rather than hidden: a mode the player cannot see is a mode that
    // does not pull them through the campaign.
    button('home-endless', px, y, pw, H_ROW, 'ENDLESS MODE', 'locked',
      `Finish all ${LEVEL_COUNT} levels to unlock`);
  }
  y += H_ROW + GAP;

  const half = (pw - GAP) / 2;
  button('menu-levels', px, y, half, H_GRID, 'LEVEL SELECT', 'ghost');
  button('menu-upgrades', px + half + GAP, y, half, H_GRID, 'UPGRADE SAW', 'ghost');
  y += H_GRID + GAP;
  button('menu-build', px, y, half, H_GRID, 'BUILD', 'ghost');
  button('menu-workshop', px + half + GAP, y, half, H_GRID, 'WORKSHOP', 'ghost');
  y += H_GRID + GAP;

  // Two volume sliders instead of one SOUND ON/OFF (owner, 2026-09-28: the music was
  // drowning the effects, and on/off could not fix that).
  volumeSliders(button, meta, px, y, pw, 66, GAP);
  y += 66 + GAP;
  const inv = !!meta.settings.invert;
  button('toggle-invert', px, y, pw, 58, `INVERT STEERING: ${inv ? 'ON' : 'OFF'}`,
    inv ? 'primary' : 'ghost');
  y += 58 + GAP;

  if (dev) button('dev-reset', px, y, pw, 66, 'DEV: RESET PROGRESS', 'ghost');
}

// SFX and MUSIC side by side. Registered as buttons carrying `slider`, so they get
// hit-testing for free; main.js draws them and turns a drag into a value.
export function volumeSliders(button, meta, x, y, w, h, gap) {
  const half = (w - gap) / 2;
  const muted = !!meta.settings.muted;
  button('vol-sfx', x, y, half, h, 'SFX', 'ghost', null,
    { slider: 'sfxVol', value: meta.settings.sfxVol ?? 0.85, muted });
  button('vol-music', x + half + gap, y, half, h, 'MUSIC', 'ghost', null,
    { slider: 'musicVol', value: meta.settings.musicVol ?? 0.45, muted });
}

// --- Endless difficulty picker ---------------------------------------------
//
// Two axes, not one number. Feed speed and line complexity are the two things that
// actually decide how a board plays, and a player who finds fast boards fine but
// zigzags unreadable (or the other way round) can say so here. Both raise the coin
// multiplier, which is what stops the easiest setting being the only rational choice.

export function drawEndlessSetup(ctx, L, meta, button, t, view, sel) {
  const pw = W - 96;
  const px = (W - pw) / 2;
  const sp = ENDLESS_SPEEDS[sel.speed];
  const ln = ENDLESS_LINES[sel.line];
  const best = meta.endless.best[`${sel.speed}-${sel.line}`] || 0;

  UI.pegboardWall(ctx, L.left, 0, L.right - L.left, L.h);
  ctx.save();

  const rowsH = 2 * (54 + 82 + 40);
  const total = 150 + rowsH + 118 + 96 + 74;
  let y = Math.max(view.safeTop + 20, (L.h - total) / 2 - 10);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  UI.tape(ctx, L.cx, y + 34, 250, 64, -0.015, 'ENDLESS', { font: UI.F.stencil(46), ink: '#2a1a0c' });
  ctx.font = '700 22px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(232,214,182,0.78)';
  ctx.fillText('Boards never stop. One ruined board ends the run.', L.cx, y + 78);
  ctx.restore();
  y += 150;

  // Each axis is a row of five chips. A slider would be prettier and worse: the
  // player has to be able to see all five options and what each one is called.
  const axis = (label, idx, count, prefix, cur, name, blurb) => {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 22px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(214,190,152,0.9)';
    ctx.fillText(label, px + 4, y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f3e9d2';
    ctx.font = '900 26px CisBody, system-ui, sans-serif';
    ctx.fillText(name.toUpperCase(), px + pw - 4, y + 16);
    ctx.restore();
    y += 54;

    const gap = 10;
    const cw = (pw - gap * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      button(`${prefix}-${i}`, px + i * (cw + gap), y, cw, 74, `${i + 1}`,
        i === cur ? 'primary' : 'ghost');
    }
    y += 74 + 8;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 20px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,214,182,0.72)';
    ctx.fillText(blurb, L.cx, y + 10);
    ctx.restore();
    y += 40;
  };

  axis('BOARD SPEED', 0, ENDLESS_SPEEDS.length, 'esp', sel.speed, sp.name, sp.blurb);
  axis('LINE COMPLEXITY', 1, ENDLESS_LINES.length, 'eln', sel.line, ln.name, ln.blurb);

  // The payout multiplier, stated plainly. A harder setting has to be worth picking.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  UI.boardPanel(ctx, px, y, pw, 100);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = UI.F.stencil(40);
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(`${endlessPayMult(sel.speed, sel.line).toFixed(2)}x COINS`, L.cx, y + 38);
  ctx.font = '700 20px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(236,220,190,0.8)';
  ctx.fillText(best > 0 ? `Your best on this setting: ${best} boards`
    : 'No run on this setting yet', L.cx, y + 74);
  ctx.restore();
  y += 118;

  button('endless-start', px, y, pw, 92, 'START RUN', 'primary');
  y += 104;
  button('endless-back', px, y, pw, 70, 'BACK', 'ghost');
}

export function drawPauseMenu(ctx, L, meta, button, t, view, canResume, dev,
                              dailyChest = false, adFree = false, endless = false) {
  const pw = W - 120;
  const px = (W - pw) / 2;
  const rows = (canResume ? 8 : 7) + (dev ? 1 : 0) + (dailyChest ? 1 : 0) + (endless ? 1 : 0);
  const ph = 116 + rows * 92 + 30;
  const py = Math.max(60, (L.h - ph) / 2);

  UI.pegboardWall(ctx, L.left, 0, L.right - L.left, L.h);
  ctx.save();
  UI.boardPanel(ctx, px, py, pw, ph);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = UI.F.stencil(44);
  ctx.fillStyle = '#ffd873';
  ctx.fillText('MENU', L.cx, py + 52);

  ctx.font = '800 24px CisBody, system-ui, sans-serif';
  ctx.textAlign = 'left';
  drawCoin(ctx, px + 34, py + 96, 15);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`${meta.coins}`, px + 56, py + 96);
  drawStar(ctx, px + 176, py + 96, 15, true, t);
  ctx.fillStyle = '#f3e9d2';
  ctx.fillText(`${meta.lifetimeStars}`, px + 198, py + 96);
  ctx.restore();

  const bw = pw - 68, bx = px + 34;
  let by = py + 126;
  const row = (id, label, style, sub) => {
    button(id, bx, by, bw, 78, label, style, sub);
    by += 92;
  };

  if (canResume) row('resume', 'RESUME', 'primary');
  // The daily chest sits at the top of the menu on the day it is available and
  // vanishes once claimed, so the gear is worth opening every session rather than
  // only when something is wrong. Two taps from the cut, per §2.
  if (dailyChest) {
    row('daily-chest', 'DAILY FREE CHEST', 'reward',
      adFree ? 'Coins and a key, once a day' : '▶ Watch a short ad');
  }
  // MAIN MENU is a row and not a corner glyph: it is the screen every other screen
  // is reachable from, so it must be findable from the one menu that opens mid-cut.
  row('menu-home', 'MAIN MENU', 'ghost');
  row('menu-levels', 'LEVEL SELECT', 'ghost');
  if (endless) row('home-endless', 'ENDLESS MODE', 'reward');
  row('menu-build', 'BUILD', 'reward');
  row('menu-upgrades', 'UPGRADE THE SAW', 'ghost');
  row('menu-workshop', 'WORKSHOP', 'ghost');

  // The invert toggle lives here, in plain sight, rather than at the bottom of a
  // scrolling shop page.
  const inv = !!meta.settings.invert;
  button('toggle-invert', bx, by, bw, 78,
    `INVERT STEERING: ${inv ? 'ON' : 'OFF'}`, inv ? 'primary' : 'ghost',
    inv ? 'Drag left moves the board left' : 'Drag left moves the board right');
  by += 92;

  volumeSliders(button, meta, bx, by, bw, 78, 14);
  by += 92;

  // Only on localhost / the local SDK environment. Same gate as the ad skip, so it
  // cannot reach the hosted build.
  if (dev) {
    button('dev-reset', bx, by, bw, 78, 'DEV: RESET PROGRESS', 'ghost',
      'Wipes coins, levels, upgrades and builds');
  }
}

// --- Level select ----------------------------------------------------------

const COLS = 4;
const CELL = 150;
const GAP = 12;

// Returns total content height so main.js can clamp scrolling.
export function drawLevelSelect(ctx, L, meta, scroll, button, t, view, maxLevel,
                                endless = false) {
  const gridW = COLS * CELL + (COLS - 1) * GAP;
  const x0 = (W - gridW) / 2;
  let y = 30 - scroll;

  UI.pegboardWall(ctx, L.left, 0, L.right - L.left, L.h);
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  UI.tape(ctx, W / 2, y + 26, 330, 62, -0.015, 'LEVEL SELECT', { font: UI.F.stencil(44), ink: '#2a1a0c' });
  y += 62;

  ctx.font = '700 21px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(232,214,182,0.7)';
  ctx.fillText(
    `Level ${Math.min(maxLevel, LEVEL_COUNT)} of ${LEVEL_COUNT}  ·  ${meta.lifetimeStars} stars earned`,
    W / 2, y + 12);
  y += 44;
  ctx.restore();

  // Show everything reached plus a row of what's coming. The list IS finite now — it
  // ends at LEVEL_COUNT and hands over to Endless — so it is never padded past it.
  const shown = Math.min(LEVEL_COUNT, Math.ceil((maxLevel + 4) / COLS) * COLS);

  for (let i = 0; i < shown; i++) {
    const n = i + 1;
    const cx = x0 + (i % COLS) * (CELL + GAP);
    const cy = y + Math.floor(i / COLS) * (CELL + GAP);
    if (cy > L.h + CELL || cy + CELL < -CELL) continue;   // cheap cull while scrolling

    const locked = n > maxLevel;
    const stars = meta.stars[n] || 0;
    const prev = levelPreview(n);

    // Each level is an offcut of the board it is cut from, so the grid reads as a
    // stack of real timber — and shows off the board variety the campaign has.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#3a2616';
    roundRect(ctx, cx, cy, CELL, CELL, 5);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, cx, cy, CELL, CELL, 5);
    ctx.clip();
    const img = textureImage(prev.tex);
    if (img) {
      const sx = (n * 97) % Math.max(1, img.width - 256);
      const sy = (n * 211) % Math.max(1, img.height - 256);
      ctx.drawImage(img, sx, sy, 256, 256, cx, cy, CELL, CELL);
    } else {
      ensureTexture(prev.tex);
      ctx.fillStyle = prev.colour;
      ctx.fillRect(cx, cy, CELL, CELL);
    }
    // Sawn end-grain edge along the bottom, and a light top arris.
    ctx.fillStyle = 'rgba(30,16,6,0.35)';
    ctx.fillRect(cx, cy + CELL - 9, CELL, 9);
    ctx.fillStyle = 'rgba(255,245,225,0.25)';
    ctx.fillRect(cx, cy, CELL, 2);
    if (locked) {
      ctx.fillStyle = 'rgba(20,12,6,0.72)';
      ctx.fillRect(cx, cy, CELL, CELL);
    }
    ctx.restore();
    if (n === maxLevel && !locked) {
      // "You are here": a pencil ring, as a carpenter would mark the next board.
      ctx.save();
      ctx.strokeStyle = '#d23a2a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cx + CELL / 2, cy + CELL / 2, CELL / 2 + 4, CELL / 2 + 1, -0.05, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }

    // Level number on a strip of tape; the board name stencilled small under it.
    UI.tape(ctx, cx + CELL / 2, cy + 40, 92, 46, ((n * 37) % 9 - 4) * 0.012, `${n}`,
      { size: 30, alpha: locked ? 0.55 : 1, seed: n * 7919 });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = UI.F.body(800, 15);
    ctx.fillStyle = locked ? 'rgba(236,224,200,0.4)' : '#f6eedb';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;
    ctx.fillText(prev.material.toUpperCase(), cx + CELL / 2, cy + 86);
    ctx.shadowColor = 'transparent';
    if (locked) UI.padlock(ctx, cx + CELL / 2, cy + 110, 1, 'rgba(236,224,200,0.6)');
    else {
      // A flawless cut earns a 4th, purple star — the same one the results panel
      // awards — so the grid shows which boards were cut perfectly.
      const flawless = !!(meta.flawless && meta.flawless[n]);
      const count = flawless ? 4 : 3;
      const gapX = flawless ? 27 : 30;
      for (let s = 0; s < count; s++) {
        const purple = flawless && s === 3;
        drawStar(ctx, cx + CELL / 2 + (s - (count - 1) / 2) * gapX, cy + 118,
          purple ? 13 : flawless ? 11 : 12, purple || s < stars, t, purple ? 'purple' : null);
      }
    }
    ctx.restore();

    if (!locked) button(`level-${n}`, cx, cy, CELL, CELL, '', 'invisible');
  }

  y += Math.ceil(shown / COLS) * (CELL + GAP) + 16;

  // Endless sits at the end of the ladder, where a player scrolling to see what is
  // left will actually find it.
  if (endless) {
    button('home-endless', x0, y, gridW, 84, 'ENDLESS MODE', 'reward',
      'Your own speed and line, no end');
  } else {
    button('home-endless', x0, y, gridW, 84, 'ENDLESS MODE', 'locked',
      `Unlocked by finishing level ${LEVEL_COUNT}`);
  }
  y += 98;

  button('levels-back', x0, y, gridW, 76, 'BACK', 'primary');
  return y + 96 + scroll;
}
