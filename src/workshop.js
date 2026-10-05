// The Workshop screen: what coins are for.
//
// Drawn as a single scrolling column of cards. `button()` is main.js's registration
// function, so hit-testing and press states stay in one place.

import { roundRect, STRIP_H } from './render.js';
import * as UI from './ui.js';
import { volumeSliders } from './menu.js';
import { adsUsable } from './sdk.js';
import { drawProjectBadge } from './build.js';
import {
  PROJECTS, STARS_PER_CHEST, UPGRADES, UPGRADE_TIERS, UPGRADE_IDS,
  currentProject, nextPart, questProgress, questDone, chestReady, dailyChestReady,
  upgradeTier, upgradeCost, canAdFit, upgradeEnabled,
  DAILY_STREAK_LEN, dailyStreakMult,
  ACHIEVEMENTS, achProgress, achEarned, attention,
} from './meta.js';

const W = 720;
const PAD = 24;

// `intro` is a 0..1 stagger set per card by drawWorkshop, so the screen assembles
// itself instead of appearing whole.
let cardIndex = 0;
let introT = 1;

function card(ctx, x, y, w, h, title) {
  const t = Math.max(0, Math.min(1, (introT - cardIndex * 0.07) / 0.3));
  cardIndex++;
  ctx.save();
  if (t < 1) {
    ctx.globalAlpha = t;
    ctx.translate(0, (1 - t) * 46);
  }
  // A stained plywood board hung on the pegboard, its name on a strip of tape.
  UI.boardPanel(ctx, x, y, w, h, { screws: false });
  UI.nail(ctx, x + w / 2, y + 9, 4);
  if (title) {
    ctx.font = UI.F.stencil(26);
    const tw = ctx.measureText(title.toUpperCase()).width + 34;
    UI.tape(ctx, x + 14 + tw / 2, y + 26, tw, 38, -0.025, title.toUpperCase(),
      { font: UI.F.stencil(26), ink: '#2a1a0c' });
  }
  ctx.restore();
}

// Body copy in these cards sits to the LEFT of a button, and nothing stopped it
// running underneath one — the supplies blurbs and the saw card's line were both
// drawn straight through their price buttons. Truncate to the room actually
// available instead of trusting the string to be short enough.
// Shrinks a size or two before it will cut a word off: these lines are the only
// place a helper's actual effect is explained, so losing the end of the sentence
// ("use it into a hard corner") costs more than a point of type size.
function clipText(ctx, text, x, y, max, size = 22, weight = 700) {
  let px = size;
  const set = () => { ctx.font = `${weight} ${px}px CisBody, system-ui, sans-serif`; };
  set();
  while (px > 17 && ctx.measureText(text).width > max) { px -= 1; set(); }
  let t = text;
  if (ctx.measureText(t).width > max) {
    while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    t = `${t}…`;
  }
  ctx.fillText(t, x, y);
  ctx.font = `${weight} ${size}px CisBody, system-ui, sans-serif`;
}

// How far down the scrolling column has to start to clear the pinned currency strip.
// Mirrors drawCurrencyStrip's own geometry, which is why STRIP_H is exported rather
// than copied as a number.
function stripInset(safeTop) {
  return safeTop + STRIP_H + 14;
}

// Progress is a tape measure running out of its case.
function bar(ctx, x, y, w, h, f) {
  UI.tapeMeasure(ctx, x, y, w, h, f);
}

// Returns the total content height so main.js can clamp scrolling.
export function drawWorkshop(
  ctx, L, meta, scroll, button, t, intro = 1, adFree = false, backLabel = 'BACK TO CUTTING',
  safeTop = 0) {
  const x = PAD;
  const w = W - PAD * 2;
  // The column starts below the pinned currency strip. Everything here scrolls; the
  // strip does not, so the content has to begin clear of it or the title rides under it.
  let y = 20 - scroll + stripInset(safeTop);
  cardIndex = 0;
  introT = intro;

  ctx.save();
  ctx.textBaseline = 'middle';

  // Header
  ctx.textAlign = 'center';
  UI.tape(ctx, W / 2, y + 26, 300, 62, -0.015, 'REWARDS', { font: UI.F.stencil(44), ink: '#2a1a0c' });
  y += 66;

  // The coin / star / key row used to live here, in the scrolling column. It is now
  // PINNED to the top of the screen by main.js (R.drawCurrencyStrip) — see the comment
  // there for why. The column is inset below it instead (stripInset).

  // --- Daily free chest. Placed ABOVE the star chest because it is the one card
  // that expires: it is the reason to open the game tomorrow, and a return hook
  // sitting below three other cards is a return hook the player never finds.
  if (dailyChestReady(meta)) {
    const dch = 118;
    card(ctx, x, y, w, dch, 'Daily Chest');
    ctx.textAlign = 'left';
    ctx.font = '800 25px CisBody, system-ui, sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('Free chest is waiting', x + 22, y + 66);
    ctx.font = '700 22px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,226,198,0.92)';
    clipText(ctx, 'Coins and a key. One a day.', x + 22, y + 94, w - 262);
    // adFree is decided by main.js from the SDK: with ads unavailable the chest is
    // still given, it just stops claiming an ad is coming. A rewarded button that
    // cannot run an ad is an explicit CrazyGames violation (§3, Adblock).
    button('daily-chest', x + w - 238, y + 40, 216, 66, 'OPEN', 'reward',
      adFree ? null : '▶ Watch a short ad', { badge: true });
    y += dch + 16;
  }

  // --- Star chest
  const chh = 118;
  card(ctx, x, y, w, chh, 'Star Chest');
  const f = Math.min(1, meta.starsBanked / STARS_PER_CHEST);
  ctx.textAlign = 'left';
  ctx.font = '700 22px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(236,220,190,0.8)';
  ctx.fillText(`${meta.starsBanked} / ${STARS_PER_CHEST} stars`, x + 22, y + 66);
  bar(ctx, x + 22, y + 86, w - 220, 14, f, '#ffd23f');
  if (chestReady(meta)) {
    button('open-chest', x + w - 182, y + 44, 160, 56, 'OPEN', 'reward', null, { badge: true });
  }
  y += chh + 16;

  // --- Quests
  const qh = 62 + meta.quests.length * 66;
  card(ctx, x, y, w, qh, "Old Mac's Jobs");
  let qy = y + 54;
  for (let i = 0; i < meta.quests.length; i++) {
    const q = meta.quests[i];
    const prog = questProgress(meta, q);
    const done = questDone(meta, q);
    ctx.textAlign = 'left';
    ctx.font = '700 22px CisBody, system-ui, sans-serif';
    ctx.fillStyle = q.claimed ? 'rgba(140,160,175,0.6)' : '#f3e9d2';
    ctx.fillText(q.text, x + 22, qy + 14);
    ctx.font = '700 22px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,226,198,0.92)';
    ctx.fillText(`${prog}/${q.target}`, x + 22, qy + 40);
    bar(ctx, x + 92, qy + 33, w - 300, 10, prog / q.target, done ? '#63e08a' : '#5fb9e8');
    if (q.claimed) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(140,160,175,0.7)';
      ctx.fillText('CLAIMED', x + w - 24, qy + 26);
    } else if (done) {
      button(`claim-${i}`, x + w - 176, qy - 2, 154, 52, `${q.reward}`, 'reward', null,
        { coin: true, badge: true });
    } else {
      ctx.textAlign = 'right';
      ctx.font = '800 21px CisBody, system-ui, sans-serif';
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(`+${q.reward}`, x + w - 24, qy + 26);
    }
    qy += 66;
  }
  y += qh + 16;

  // --- Daily challenge.
  //
  // The streak used to be the words "N day streak" and nothing else, and it paid
  // nothing. It is a LADDER now — seven rungs, the days already cut filled in, today's
  // rung pulsing, the seventh carrying a chest — because a chain the player can see is
  // a chain they do not want to break, and that is what the feature is for.
  const dh = 174;
  card(ctx, x, y, w, dh, 'Daily Cut');
  ctx.textAlign = 'left';
  ctx.font = '700 22px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(236,220,190,0.8)';
  ctx.fillText(meta.daily.done ? 'Done — come back tomorrow' : 'One board. One attempt.', x + 22, y + 58);

  const streak = meta.daily.streak || 0;
  // Which rung today is: the one after the last day cut, wrapping every seven.
  const inCycle = streak % DAILY_STREAK_LEN;
  const todayRung = meta.daily.done ? (inCycle === 0 ? DAILY_STREAK_LEN - 1 : inCycle - 1) : inCycle;
  const rungW = 44, gap = 10;
  const lx = x + 22, ly = y + 82;
  for (let i = 0; i < DAILY_STREAK_LEN; i++) {
    const rx = lx + i * (rungW + gap);
    const done = i < inCycle || (meta.daily.done && i === todayRung);
    const isToday = i === todayRung && !meta.daily.done;
    const last = i === DAILY_STREAK_LEN - 1;
    if (i > 0) {
      ctx.strokeStyle = done ? 'rgba(255,154,77,0.8)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(rx - gap - 2, ly + 22); ctx.lineTo(rx + 2, ly + 22);
      ctx.stroke();
    }
    const pulse = isToday ? 0.72 + 0.28 * Math.sin(t * 5) : 1;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = done ? (last ? '#ffd23f' : '#ff9a4d')
      : isToday ? 'rgba(255,214,120,0.22)' : 'rgba(255,255,255,0.08)';
    roundRect(ctx, rx, ly, rungW, 44, 12); ctx.fill();
    if (isToday) {
      ctx.strokeStyle = '#ffd873';
      ctx.lineWidth = 3;
      roundRect(ctx, rx, ly, rungW, 44, 12); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = '900 22px CisBody, system-ui, sans-serif';
    ctx.fillStyle = done ? '#2a1606' : isToday ? '#ffe9a8' : 'rgba(232,214,182,0.5)';
    // The seventh rung is the chest day and says so, in the one character that reads
    // at this size.
    ctx.fillText(last ? '\u2605' : `${i + 1}`, rx + rungW / 2, ly + 23);
  }
  ctx.textAlign = 'left';
  ctx.font = '700 22px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(240,226,198,0.92)';
  const mult = dailyStreakMult(streak + (meta.daily.done ? 0 : 1));
  ctx.fillText(meta.daily.done
    ? `${streak} day streak \u00b7 keep it alive tomorrow`
    : `${streak} day streak \u00b7 today pays ${mult.toFixed(2)}x`, x + 22, ly + 66);
  if (!meta.daily.done) {
    button('daily', x + w - 200, y + 40, 178, 60, 'PLAY', 'reward', null, { badge: true });
  }
  y += dh + 20;

  y = achievementCards(ctx, L, meta, button, x, y, w) + 8;
  ctx.textAlign = 'left';

  // The label has to name where BACK actually goes: the Workshop is reachable from
  // the results panel, the pause menu and the main menu, and "BACK TO CUTTING" is a
  // lie on the last of those.
  button('close-workshop', x, y, w, 76, backLabel, 'primary');
  y += 96;

  ctx.restore();
  return y + scroll;
}

// --- Upgrades screen -------------------------------------------------------
//
// Its own screen rather than more cards on the Workshop column: eight parts with
// four tiers each is too much to read sideways, and the whole point of the feature
// is that the player can see what a tier will do to the cut before paying for it.
//
// Every bought part carries an ON/OFF switch. That is not a nicety — the laser in
// particular is a matter of taste, and an aid you cannot turn off is something the
// player paid to be stuck with.
const GROUPS = [
  { id: 'machine', title: 'THE MACHINE', sub: 'Changes how the saw cuts' },
  { id: 'payout', title: 'THE PAYOUT', sub: 'Changes what a good cut is worth' },
];

export function drawUpgrades(ctx, L, meta, scroll, button, t, intro = 1, safeTop = 0) {
  const x = PAD;
  const w = W - PAD * 2;
  let y = 20 - scroll + stripInset(safeTop);
  cardIndex = 0;
  introT = intro;

  ctx.save();
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'center';
  UI.tape(ctx, W / 2, y + 26, 250, 62, -0.015, 'THE SAW', { font: UI.F.stencil(44), ink: '#2a1a0c' });
  y += 56;
  ctx.font = '700 21px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(240,226,198,0.92)';
  ctx.fillText('Every part changes how it plays. None of it is paint.', W / 2, y + 10);
  y += 38;

  // Coins are on the pinned strip at the top of the screen — see drawCurrencyStrip.

  // At most ONE rewarded-ad offer is on screen at a time — the first part the
  // player is already halfway to paying for. Eight "watch an ad" buttons stacked up
  // reads as an ad wall, which is exactly the presentation §3 warns about.
  // No ad offer at all while ads are switched off (Basic Launch — see sdk.js ADS_ALLOWED).
  const adTarget = adsUsable() ? (UPGRADE_IDS.find((id) => canAdFit(meta, id)) || null) : null;

  for (const grp of GROUPS) {
    ctx.textAlign = 'left';
    ctx.font = '900 25px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(226,206,172,0.9)';
    ctx.fillText(grp.title, x + 4, y + 16);
    ctx.font = '700 22px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(240,226,198,0.92)';
    ctx.fillText(grp.sub, x + 4, y + 42);
    y += 62;

    for (const id of UPGRADE_IDS) {
      const u = UPGRADES[id];
      if (u.group !== grp.id) continue;
      const tier = upgradeTier(meta, id);
      const cost = upgradeCost(meta, id);
      const maxed = cost == null;
      const adFit = id === adTarget;
      const on = upgradeEnabled(meta, id);
      const h = adFit ? 246 : 158;

      card(ctx, x, y, w, h, null);

      ctx.textAlign = 'left';
      ctx.font = UI.F.stencil(32);
      ctx.fillStyle = tier > 0 && !on ? 'rgba(236,224,200,0.5)' : '#f3e9d2';
      ctx.fillText(u.name, x + 22, y + 32);

      // Tier pips: the clearest possible read of "how much of this have I bought".
      for (let i = 0; i < UPGRADE_TIERS; i++) {
        const px = x + 22 + i * 26;
        // Dabs of the part's own paint colour, one per tier fitted.
        ctx.fillStyle = i < tier ? (on ? u.colour : 'rgba(236,224,200,0.35)') : 'rgba(243,233,210,0.2)';
        roundRect(ctx, px, y + 52, 20, 12, 2);
        ctx.fill();
      }

      // The left column is clipped short of the buttons: a blurb that slides under
      // one is the kind of thing that only shows up on one screen size.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 16, y + 68, w - 196, 92);
      ctx.clip();
      ctx.font = '700 22px CisBody, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(240,226,198,0.92)';
      ctx.fillText(u.blurb, x + 22, y + 88);

      ctx.font = '800 22px CisBody, system-ui, sans-serif';
      ctx.fillStyle = tier === 0 ? 'rgba(240,226,198,0.92)' : on ? '#8fe87c' : 'rgba(214,190,152,0.7)';
      ctx.fillText(tier > 0 && !on ? 'Switched off' : `Fitted: ${u.effect(tier)}`, x + 22, y + 118);
      if (!maxed) {
        ctx.font = '700 21px CisBody, system-ui, sans-serif';
        ctx.fillStyle = '#ffd873';
        ctx.fillText(`Next: ${u.effect(tier + 1)}`, x + 22, y + 142);
      }
      ctx.restore();

      if (maxed) {
        ctx.textAlign = 'right';
        ctx.font = '900 22px CisBody, system-ui, sans-serif';
        ctx.fillStyle = '#8fe87c';
        ctx.fillText('FULLY FITTED', x + w - 24, y + 46);
      } else {
        button(`buyup-${id}`, x + w - 168, y + 22, 146, 58, `${cost}`,
          meta.coins >= cost ? 'primary' : 'ghost', null, { coin: true });
      }
      if (tier > 0) {
        button(`offup-${id}`, x + w - 168, y + (maxed ? 76 : 88), 146, 50,
          on ? 'ON' : 'OFF', on ? 'primary' : 'ghost', null, { small: true });
      }
      // The rewarded-ad placement from §3: finish a fitting the player has already
      // half paid for. Labelled with the real reward, and never the cheaper path.
      if (adFit) {
        button(`adup-${id}`, x + 22, y + 168, w - 44, 62,
          'FIT IT NOW', 'reward', '▶ Watch a short ad');
      }
      y += h + 14;
    }
    y += 10;
  }

  button('upgrades-back', x, y, w, 76, 'BACK', 'primary');
  y += 96;

  ctx.restore();
  return y + scroll;
}

// --- Achievements ------------------------------------------------------------
//
// The last section of the REWARDS page. One card per achievement: name, what to do,
// a tape-measure of how far along it is, and the reward. An earned one carries a CLAIM
// button; rewards are never paid silently, because the claim is what makes the page
// worth opening. Claimable cards sort to the top, then the ones in progress (nearest
// first), then the claimed.
function achievementCards(ctx, L, meta, button, x, y, w) {
  ctx.textAlign = 'center';
  UI.tape(ctx, W / 2, y + 26, 340, 54, 0.012, 'ACHIEVEMENTS', { font: UI.F.stencil(36), ink: '#2a1a0c' });
  y += 52;
  ctx.font = '700 22px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(240,226,198,0.92)';
  ctx.fillText(`${achEarned(meta)} of ${ACHIEVEMENTS.length} earned`, W / 2, y + 12);
  y += 40;

  const rank = (a) => {
    const st = meta.ach[a.id] | 0;
    if (st === 1) return 0;
    if (st === 2) return 3;
    return 1 + (1 - achProgress(meta, a) / a.goal) * 0.99;
  };
  const list = ACHIEVEMENTS.map((a, i) => ({ a, r: rank(a), i }))
    .sort((p, q) => p.r - q.r || p.i - q.i);

  const H = 124;
  for (const { a } of list) {
    // Cards well off screen are skipped: there are 27 and only ~8 are ever visible.
    if (y > L.h + 40 || y + H < -40) { y += H + 12; cardIndex++; continue; }
    const st = meta.ach[a.id] | 0;
    const cur = achProgress(meta, a);
    // The stagger is per card and the intro clock stops at 1.4, so without a cap the
    // twentieth card would never finish fading in.
    if (cardIndex > 6) cardIndex = 6;
    card(ctx, x, y, w, H, null);

    ctx.textAlign = 'left';
    ctx.font = UI.F.stencil(30);
    ctx.fillStyle = st === 2 ? 'rgba(243,233,210,0.6)' : st === 1 ? '#ffd873' : '#f3e9d2';
    ctx.fillText(a.name.toUpperCase(), x + 22, y + 32);
    ctx.fillStyle = st === 2 ? 'rgba(232,214,182,0.55)' : 'rgba(232,214,182,0.9)';
    clipText(ctx, a.desc, x + 22, y + 64, w - 250, 22, 700);

    if (st === 0) {
      bar(ctx, x + 22, y + 86, w - 300, 20, cur / a.goal);
      ctx.font = '800 20px CisBody, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(243,233,210,0.9)';
      ctx.fillText(`${cur} / ${a.goal}`, x + w - 268, y + 97);
    }

    if (st === 1) {
      button(`achclaim-${a.id}`, x + w - 212, y + 30, 190, 64, `CLAIM +${a.reward}`, 'reward', null,
        { badge: true });
    } else {
      ctx.textAlign = 'right';
      ctx.font = UI.F.stencil(26);
      ctx.fillStyle = st === 2 ? '#8fe87c' : 'rgba(255,233,168,0.75)';
      ctx.fillText(st === 2 ? 'CLAIMED' : `+${a.reward}`, x + w - 24, y + (st === 2 ? 62 : 97));
    }
    y += H + 12;
  }

  return y;
}
