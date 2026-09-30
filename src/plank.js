// Plank generation and cut evaluation — the core mechanic.
//
// Coordinates: `s` runs along the plank from 0 (the leading end, which reaches the
// blade first) to `length`. The guide line's offset from the plank's centre at a
// given `s` is `lineAt(s)`. The blade is fixed on screen, so steering the plank
// horizontally is what puts the line under the blade.

import { makeRng, clamp, lerp } from './rng.js';
import { OBJECT_TYPES } from './levels.js';

// Nominal width. Real boards vary per level (see levels.js `width`); this is the
// reference the textures and the saw throat are sized against, and the fallback for
// any caller that has no plank in hand.
export const PLANK_WIDTH = 360;

const SAMPLE_STEP = 6;          // px between precomputed line samples
const EDGE_MARGIN = 38;         // keep the line off the plank's edges
const LEAD_IN = 420;            // plank travels this far dead-straight before curving

// --- Board jumps ------------------------------------------------------------
//
// A JUMP board is delivered in two or three pieces with a hole between them. Over the
// hole there is nothing under the blade, so steering does nothing — the only way onto
// the next piece's line is to TAP at the right moment and kick the feed table across.
//
// The timing is what makes it a skill: the ideal instant is just before the next piece
// reaches the blade, and tapping away from it lands the blade off the line by an amount
// proportional to how far off the tap was. Not tapping at all is not an instant loss —
// the player lands wherever they were and has to correct hard — because a gimmick that
// can end a run on one missed tap is a gimmick players quit over.
export const GAP_LEN = 260;     // hole in the board, in board units (~1.0s at base feed)
const JUMP_IDEAL = 0.72;        // where in the hole the perfect tap sits
const JUMP_WINDOW = 0.17;       // +/- this counts as perfect
const JUMP_TIME = 0.17;         // seconds the table takes to cross
// The line on a jump board swings less and is offset to one side of each piece, so a
// jump is always a real crossing and the line never has to be clamped flat against the
// board's edge to make room for it.
const JUMP_AMP_SCALE = 0.5;
const JUMP_SHIFT = 0.45;        // fraction of maxOffset each piece is pushed sideways

export function maxOffsetFor(width) {
  return Math.max(24, width / 2 - EDGE_MARGIN);
}

export function buildPlank(level) {
  const rng = makeRng(level.seed);
  const { length, amplitude, frequency, zigzag } = level;
  const detail = level.detail || 0;
  const width = level.width || PLANK_WIDTH;
  const jumpCount = level.jumps || 0;
  // A narrow board is harder at the same amplitude simply because there is less
  // room, so the line's swing is capped against the board it is drawn on rather
  // than against a constant.
  const maxOffset = maxOffsetFor(width);

  // Where the board is cut into pieces. The holes are spread over the stretch that is
  // actually playable — never in the lead-in, never against the far end, where the
  // player would have no room to recover from a bad landing.
  const gaps = [];
  if (jumpCount > 0) {
    const from = LEAD_IN + 520, to = length - 520;
    if (to - from > GAP_LEN * (jumpCount + 1)) {
      const spanEach = (to - from) / jumpCount;
      let side = rng() < 0.5 ? -1 : 1;
      for (let i = 0; i < jumpCount; i++) {
        // Jittered inside its own span, so two jump boards of the same length do not
        // put the hole in the same place and become the same board.
        const mid = from + spanEach * (i + 0.5) + (rng() - 0.5) * spanEach * 0.44;
        gaps.push({ i, s0: mid - GAP_LEN / 2, s1: mid + GAP_LEN / 2, side });
        side *= -1;
      }
    }
  }
  // Piece j sits shifted to one side; `side` on a gap is the side of the piece AFTER
  // it, so the shift alternates and every jump is a full crossing.
  const shiftAmt = gaps.length ? maxOffset * JUMP_SHIFT : 0;
  const firstSide = gaps.length ? -gaps[0].side : 0;
  const shiftAt = (s) => {
    let sd = firstSide;
    for (const g of gaps) { if (s < g.s0) break; sd = g.side; }
    return sd * shiftAmt;
  };
  const ampScale = gaps.length ? JUMP_AMP_SCALE : 1;
  const inner = maxOffset - shiftAmt;

  // Smooth component: three sines at incommensurate frequencies.
  const waves = [
    { a: 0.62, f: frequency, p: rng() * Math.PI * 2 },
    { a: 0.28, f: frequency * 1.73, p: rng() * Math.PI * 2 },
    { a: 0.14, f: frequency * 2.91, p: rng() * Math.PI * 2 },
  ];

  // Detail component: a slow, small wander laid OVER whatever the line is already
  // doing. This is the late-game difficulty lever that is not simply "bigger curves" —
  // the main shape stops being enough to predict the line from, so the player has to
  // keep reading it. Its wavelength is deliberately ~300px (about a second of board at
  // full speed): shorter than that is a jitter nobody can steer, not a line to follow.
  const detailWave = { a: 0.20 * detail, f: 2.4 + 1.0 * detail, p: rng() * Math.PI * 2 };

  // Zigzag component: alternating targets joined by straight runs with rounded corners.
  const legLen = lerp(520, 250, zigzag);
  const corners = [];
  for (let s = 0, side = rng() < 0.5 ? -1 : 1; s < length + legLen * 2; s += legLen) {
    corners.push({ s, x: side * (0.45 + rng() * 0.55) });
    side *= -1;
  }

  const count = Math.ceil(length / SAMPLE_STEP) + 2;
  const pts = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const s = i * SAMPLE_STEP;

    let smooth = 0;
    for (const w of waves) smooth += w.a * Math.sin((s / 1000) * w.f * Math.PI * 2 + w.p);

    // Locate the zigzag leg containing s and interpolate with a smoothstep so
    // corners are sharp but not instantaneous.
    const gi = Math.min(corners.length - 2, Math.floor(s / legLen));
    const t = clamp((s - corners[gi].s) / legLen, 0, 1);
    const k = lerp(0.5, 0.14, zigzag);   // fraction of the leg spent turning
    const tt = clamp((t - (0.5 - k / 2)) / k, 0, 1);
    const eased = tt * tt * (3 - 2 * tt);
    const zig = lerp(corners[gi].x, corners[gi + 1].x, eased);

    let shape = lerp(smooth, zig, zigzag);
    // Added after the blend, so a zigzag board gets the wander too rather than
    // losing it to the very parameter that makes the board hard.
    if (detail > 0) {
      shape += detailWave.a * Math.sin((s / 1000) * detailWave.f * Math.PI * 2 + detailWave.p);
    }
    let x = shape * amplitude * (width / PLANK_WIDTH) * ampScale;

    // Ease the line out of dead-centre so every level starts fair.
    const intro = clamp(s / LEAD_IN, 0, 1);
    x *= intro * intro * (3 - 2 * intro);

    // On a jump board the swing is clamped against the room LEFT OVER after the
    // piece's sideways shift, so the sum still fits and neither term has to flatten
    // against the board's edge.
    pts[i] = gaps.length
      ? clamp(clamp(x, -inner, inner) + shiftAt(s) * (intro * intro * (3 - 2 * intro)), -maxOffset, maxOffset)
      : clamp(x, -maxOffset, maxOffset);
  }

  // Silly objects embedded in the board, sitting exactly on the line so that
  // collecting one requires real accuracy at that moment.
  const objects = [];
  const usable = length - LEAD_IN - 360;
  for (let i = 0; i < level.objectCount && usable > 400; i++) {
    const slot = usable / level.objectCount;
    let s = LEAD_IN + 240 + i * slot + rng() * slot * 0.55;
    // A find sitting in a hole in the board is a find embedded in thin air. Nudge it
    // clear of the nearest edge rather than dropping it, so a jump board still pays
    // the same salvage as any other.
    for (const g of gaps) {
      if (s > g.s0 - 90 && s < g.s1 + 90) s = (s < (g.s0 + g.s1) / 2) ? g.s0 - 120 : g.s1 + 120;
    }
    objects.push({
      s,
      type: OBJECT_TYPES[Math.floor(rng() * OBJECT_TYPES.length)],
      resolved: false,
      hit: false,
      spin: rng() * Math.PI * 2,
    });
  }

  return { level, length, width, pts, step: SAMPLE_STEP, objects, gaps };
}

// The hole the blade is over right now, or null. Boards without jumps have an empty
// list, so this costs one property read on every other board in the game.
export function gapAt(plank, s) {
  const gaps = plank.gaps;
  if (!gaps || !gaps.length) return null;
  for (const g of gaps) if (s >= g.s0 && s < g.s1) return g;
  return null;
}

// The next hole coming up, used to warn the player before it arrives.
export function nextGap(plank, s) {
  const gaps = plank.gaps;
  if (!gaps || !gaps.length) return null;
  for (const g of gaps) if (s < g.s1) return g;
  return null;
}

// Whether `s` is over solid board — everything that draws the board asks this.
export function solidAt(plank, s) {
  return !gapAt(plank, s);
}

export function lineAt(plank, s) {
  const { pts, step } = plank;
  if (s <= 0) return pts[0];
  const fi = s / step;
  const i = Math.floor(fi);
  if (i >= pts.length - 1) return pts[pts.length - 1];
  return lerp(pts[i], pts[i + 1], fi - i);
}

// --- Cut state -------------------------------------------------------------

const DAMAGE_RATE = 0.62;
const REPAIR_RATE = 0.30;
// Per-second rates for the SPLIT meter's live strain reading (see stepCut).
const STRAIN_ATTACK = 14;
const STRAIN_RELEASE = 4.5;
const KERF_STEP = 9;            // px of travel between recorded kerf samples

// Combo tiers. Staying on the line without dropping to 'off' escalates the payout,
// which is what turns a clean run into "I'm on a roll" instead of just a score.
export const COMBO_TIERS = [
  { at: 0, mult: 1, label: '' },
  { at: 3, mult: 2, label: 'NICE!' },
  { at: 7, mult: 3, label: 'GREAT!' },
  { at: 12, mult: 4, label: 'ON FIRE!' },
  { at: 18, mult: 5, label: 'FLAWLESS!' },
];

const COMBO_COIN_RATE = 1.0;   // coins per second at 1x

// A "corner" must be a genuinely sharp turn, not any curve at all. An earlier
// threshold of 0.010 fired on level 1's gentle sine ~17 times per board, which handed
// out enough keys to pay 1000+ coins on the first level.
const CORNER_CURVATURE = 0.12;
const CORNER_SPACING = 420;
const MAX_CORNERS_PER_BOARD = 4;

// `mods` comes from META.sawMods() — the fitted saw upgrades. They are baked onto the
// cut at creation rather than read from `meta` inside the hot loop, so a purchase can
// never change the board you are halfway through, and every renderer that needs the
// effective tolerance can read `cut.tol` instead of the raw level value.
export function createCut(plank, mods = {}) {
  const level = plank.level;
  return {
    plank,
    tol: level.tolerance * (mods.tolMult ?? 1),
    speedMult: mods.speedMult ?? 1,
    damageMult: mods.damageMult ?? 1,
    repairMult: mods.repairMult ?? 1,
    laser: mods.laser ?? 0,
    laserArrow: !!mods.laserArrow,
    laserAlert: !!mods.laserAlert,
    laserFar: !!mods.laserFar,
    comboScale: mods.comboScale ?? 1,
    coinMult: mods.coinMult ?? 1,
    findMult: mods.findMult ?? 1,
    precisionPool: mods.precisionPool ?? 0,
    s: 0,                       // how far along the plank the blade has cut
    offset: 0,                  // plank's lateral position; player-controlled
    damage: 0,
    strain: 0,                  // live, harmless reading of how far off the line the blade is
    quality: 0,                 // accumulated weighted accuracy
    elapsed: 0,
    band: 'perfect',
    offBoard: false,
    err: 0,
    streak: 0,
    bestStreak: 0,
    combo: 0,                   // seconds held without dropping off the line
    tier: 0,
    peakTier: 0,
    bonusCoins: 0,
    objectsHit: 0,
    keys: 0,
    corners: 0,
    lastCornerS: -999,
    // --- Board jumps. `air` is the index of the hole the blade is over, or -1.
    air: -1,
    airT: 0,
    jumped: [],                 // per gap: was the tap made, and how good it was
    jumps: 0,
    perfectJumps: 0,
    missedJumps: 0,
    jumpT: 1,                   // 0..1 while the feed table is crossing
    jumpFrom: 0,
    jumpTo: 0,
    jumpFlash: 0,               // seconds of landing feedback left on the HUD
    jumpFlashOk: false,
    jumpCoins: 0,               // kept apart from bonusCoins so it gets its own row
    events: [],                 // drained by main.js each frame
    kerf: [{ s: 0, x: 0, q: 1 }],
    done: false,
    failed: false,
  };
}

export function stepCut(cut, dt, steer, speedScale = 1) {
  if (cut.done) return;
  const lv = cut.plank.level;
  const tol = cut.tol ?? lv.tolerance;

  cut.s += lv.speed * speedScale * (cut.speedMult ?? 1) * dt;
  if (cut.jumpFlash > 0) cut.jumpFlash -= dt;

  // --- Over a hole in the board (jump boards only).
  const gap = gapAt(cut.plank, cut.s);
  if (cut.jumpT < 1) {
    // The feed table is crossing. It is driven by the jump, not by the player, and
    // it finishes even if the next piece has already arrived.
    cut.jumpT = Math.min(1, cut.jumpT + dt / JUMP_TIME);
    const e = 1 - Math.pow(1 - cut.jumpT, 3);
    cut.offset = cut.jumpFrom + (cut.jumpTo - cut.jumpFrom) * e;
  } else if (!gap) {
    cut.offset = clamp(cut.offset + steer, -420, 420);
  }
  // Steering over a hole is deliberately dead: there is no board under the blade to
  // push. That is what makes the tap the only way across, and it is also why the
  // mechanic is legible — the player feels the controls go quiet.

  if (gap) {
    cut.air = gap.i;
    cut.airT = (cut.s - gap.s0) / (gap.s1 - gap.s0);
    cut.band = 'air';
    cut.err = 0;
    cut.offBoard = false;
    return;                     // nothing to cut, nothing to damage, nothing to score
  }
  if (cut.air >= 0) {
    // Just landed on the next piece.
    const g = cut.plank.gaps[cut.air];
    cut.air = -1;
    cut.airT = 0;
    if (!cut.jumped[g.i]) {
      cut.missedJumps++;
      cut.combo = 0;
      cut.tier = 0;
      cut.jumpFlash = 0.9;
      cut.jumpFlashOk = false;
      cut.events.push({ type: 'jump', ok: false, perfect: false });
    }
  }

  cut.elapsed += dt;

  // The blade sits at plank-local x = -offset (the plank moved, not the blade).
  const bladeLocal = -cut.offset;
  const target = lineAt(cut.plank, cut.s);
  const err = bladeLocal - target;
  const abs = Math.abs(err);
  cut.err = err;

  // Bands are deliberately strict so a 3-star result is earned rather than the
  // default. Forgiveness lives in the damage meter, not in the scoring.
  let q;
  if (abs <= tol * 0.32) { cut.band = 'perfect'; q = 1; }
  else if (abs <= tol * 0.75) { cut.band = 'good'; q = 0.74; }
  else if (abs <= tol * 1.6) { cut.band = 'ok'; q = 0.34; }
  else { cut.band = 'off'; q = 0; }

  // Blade has left the board entirely — a much worse failure than merely drifting.
  cut.offBoard = Math.abs(bladeLocal) > cut.plank.width / 2;

  cut.quality += q * dt;

  if (cut.band === 'perfect') {
    cut.streak += dt;
    if (cut.streak > cut.bestStreak) cut.bestStreak = cut.streak;
  } else if (cut.band === 'off') {
    cut.streak = 0;
  }

  if (cut.band === 'off') {
    const over = (abs - tol * 1.6) / (tol * 2);
    const offBoardPenalty = cut.offBoard ? 2.2 : 1;
    cut.damage += clamp(over, 0, 3) * DAMAGE_RATE * (cut.damageMult ?? 1) * offBoardPenalty * dt;
  } else {
    cut.damage = Math.max(0, cut.damage - REPAIR_RATE * (cut.repairMult ?? 1) * dt);
  }

  // --- Strain. `damage` only moves in the 'off' band, which a player tracking the
  // line reaches perhaps once a board — so the SPLIT meter sat empty for whole runs
  // and the owner read it as broken. Strain is the same quantity a frame earlier:
  // 0 while the blade is inside the perfect band, 1 at the edge of 'off', where
  // damage takes over. It costs nothing and is never a fail condition; it exists so
  // the meter is alive in the player's peripheral vision and its meaning is learned
  // before the board is actually in danger.
  const inner = tol * 0.32, outer = tol * 1.6;
  const rawStrain = clamp((abs - inner) / Math.max(1e-6, outer - inner), 0, 1);
  // Asymmetric smoothing: snaps up so a wobble is felt at once, eases down so the
  // bar does not flicker while the blade hunts around the line.
  const k = rawStrain > cut.strain ? STRAIN_ATTACK : STRAIN_RELEASE;
  cut.strain += (rawStrain - cut.strain) * Math.min(1, k * dt);

  // --- Combo. Held as long as the cut never drops to 'off'.
  if (cut.band === 'off') {
    if (cut.tier > 0) cut.events.push({ type: 'comboLost', tier: cut.tier });
    cut.combo = 0;
    cut.tier = 0;
  } else {
    cut.combo += dt;
    // The Flywheel Drum upgrade scales the seconds needed to reach each tier.
    const scale = cut.comboScale ?? 1;
    let tier = 0;
    for (let i = COMBO_TIERS.length - 1; i >= 0; i--) {
      if (cut.combo >= COMBO_TIERS[i].at * scale) { tier = i; break; }
    }
    if (tier > cut.tier) {
      cut.tier = tier;
      cut.peakTier = Math.max(cut.peakTier, tier);
      cut.events.push({ type: 'comboUp', tier });
    }
    cut.bonusCoins += COMBO_TIERS[cut.tier].mult * COMBO_COIN_RATE * dt;
  }

  // --- Corners. Nailing a hard turn is its own reward: a perfectly-timed corner
  // yields a key, which is a separate currency from stars.
  const curve = curvatureAt(cut.plank, cut.s);
  if (curve > CORNER_CURVATURE
      && cut.s - cut.lastCornerS > CORNER_SPACING
      && cut.corners < MAX_CORNERS_PER_BOARD) {
    cut.lastCornerS = cut.s;
    cut.corners++;
    const perfect = abs <= tol * 0.35;
    if (perfect) cut.keys++;
    cut.events.push({
      type: 'corner',
      perfect,
      power: clamp(curve / 0.05, 0.2, 1),
      dir: Math.sign(lineAt(cut.plank, cut.s + 30) - lineAt(cut.plank, cut.s - 30)) || 1,
    });
  }

  // --- Silly objects embedded in the line.
  for (const o of cut.plank.objects) {
    if (o.resolved || cut.s < o.s) continue;
    o.resolved = true;
    o.hit = abs <= tol * 0.8;
    // Where and when the blade went through it. A hit find is SAWN IN HALF and the
    // two halves stay in the board (see drawObjects) instead of blinking out, so the
    // renderer needs the kerf's position at that instant and a distance-based clock
    // for the halves parting — distance, not wall time, so it is identical at 60Hz
    // and 165Hz like everything else on the fixed timestep.
    o.hitS = cut.s;
    o.hitX = bladeLocal;
    if (o.hit) cut.objectsHit++;
    cut.events.push({ type: 'object', obj: o, hit: o.hit });
  }

  // Quality is stored per sample so the kerf can be drawn ragged and scorched
  // exactly where the cut went wrong.
  const last = cut.kerf[cut.kerf.length - 1];
  if (cut.s - last.s >= KERF_STEP) cut.kerf.push({ s: cut.s, x: bladeLocal, q });

  if (cut.damage >= 1) {
    cut.damage = 1;
    cut.done = true;
    cut.failed = true;
  } else if (cut.s >= cut.plank.length) {
    cut.s = cut.plank.length;
    cut.kerf.push({ s: cut.s, x: bladeLocal, q });
    cut.done = true;
  }
}

// The player's tap over a hole. Returns false if there is nothing to jump from, so
// the caller can fall through to whatever else a tap means.
//
// Landing error is proportional to timing error and signed by direction: tapping
// early lands the blade short of the new line, tapping late overshoots it. A perfect
// tap lands exactly on the line, which is the whole reward — no bonus coin is as
// legible as simply being on the line when the board arrives.
export function tryJump(cut) {
  if (cut.done) return false;
  const g = gapAt(cut.plank, cut.s);
  if (!g || cut.jumped[g.i]) return false;
  const t = (cut.s - g.s0) / (g.s1 - g.s0);
  const off = Math.abs(t - JUMP_IDEAL);
  const perfect = off <= JUMP_WINDOW;
  const tol = cut.tol ?? cut.plank.level.tolerance;
  const raw = -lineAt(cut.plank, g.s1 + 40);
  const dir = Math.sign(raw - cut.offset) || 1;
  const miss = perfect ? 0
    : Math.min(1, (off - JUMP_WINDOW) / (1 - JUMP_WINDOW)) * tol * 3.4 * (t < JUMP_IDEAL ? -1 : 1);
  cut.jumped[g.i] = true;
  cut.jumps++;
  if (perfect) { cut.perfectJumps++; cut.jumpCoins += JUMP_BONUS; }
  cut.jumpFrom = cut.offset;
  cut.jumpTo = clamp(raw + dir * miss, -420, 420);
  cut.jumpT = 0;
  cut.jumpFlash = 0.9;
  cut.jumpFlashOk = perfect;
  cut.events.push({ type: 'jump', ok: true, perfect, t });
  return true;
}

// Called when a failed board is rewound for a rewarded continue: any hole the blade
// has been pushed back in front of must be jumpable again, or the player is handed
// back a board with an unwinnable crossing in it.
export function rearmJumps(cut) {
  for (const g of cut.plank.gaps || []) if (cut.s <= g.s1) cut.jumped[g.i] = false;
  cut.air = -1;
  cut.jumpT = 1;
  cut.jumpFlash = 0;
}

export function accuracy(cut) {
  return cut.elapsed > 0 ? clamp(cut.quality / cut.elapsed, 0, 1) : 0;
}

// Accuracy needed for each star. Exported because the results panel draws a meter
// against these rather than just printing a number — the player should be able to see
// how close the last cut came to the next star, not have to infer it.
export const STAR_AT = [0, 0.76, 0.93];

// A flawless cut. 0.995 and not 1.0 on purpose: the panel prints Math.round(acc*100),
// so anything that displays as "100%" has to actually award the flawless reward. A
// player shown 100% and given the normal three stars would be right to call it a bug.
export const FLAWLESS_AT = 0.995;

export function starsFor(score) {
  if (score >= STAR_AT[2]) return 3;
  if (score >= STAR_AT[1]) return 2;
  return 1;
}

// --- Stars are scored on more than the line ---------------------------------
//
// Accuracy is still the spine of the score and still most of it. The craft bonus is
// what the board offered BESIDES the line: the salvage in it, the combo held through
// it, and the crossings on it. Without this, everything optional on a board is worth
// only coins, and a player chasing three stars is right to ignore all of it.
//
// It is normalised over the components a given board actually HAS, so every board's
// maximum bonus is the same. Crediting the missing ones in full would make the bonus
// a flat discount on the star thresholds instead of a reward.
export const CRAFT_BONUS_MAX = 0.06;

export function craftParts(cut) {
  const plank = cut.plank;
  const finds = plank.objects ? plank.objects.length : 0;
  const gaps = plank.gaps ? plank.gaps.length : 0;
  // The combo component is normalised against the highest tier THIS board can reach,
  // not against the top of the table. Tier 4 needs 18 unbroken seconds and most
  // campaign boards are 9-17 seconds long, so scoring against the absolute maximum
  // would quietly make short boards worth less craft than long ones for the same
  // flawless run.
  const dur = plank.length / Math.max(1, plank.level.speed * (cut.speedMult ?? 1));
  const scale = cut.comboScale ?? 1;
  let maxTier = 0;
  for (let i = COMBO_TIERS.length - 1; i >= 0; i--) {
    if (COMBO_TIERS[i].at * scale <= dur) { maxTier = i; break; }
  }
  const out = [{
    key: 'combo',
    label: 'Combo',
    got: maxTier > 0 ? clamp(cut.peakTier / maxTier, 0, 1) : 1,
  }];
  if (finds > 0) out.push({ key: 'finds', label: 'Salvage', got: clamp(cut.objectsHit / finds, 0, 1) });
  if (gaps > 0) out.push({ key: 'jumps', label: 'Jumps', got: clamp(cut.perfectJumps / gaps, 0, 1) });
  return out;
}

export function craftBonus(cut) {
  const parts = craftParts(cut);
  if (!parts.length) return 0;
  let sum = 0;
  for (const p of parts) sum += p.got;
  return CRAFT_BONUS_MAX * (sum / parts.length);
}

// What the stars are actually scored against.
export function cutScore(cut) {
  const acc = accuracy(cut);
  // The craft bonus may never manufacture a FLAWLESS. That tier means the CUT was
  // perfect, and nothing else in the game is allowed to buy it.
  return Math.min(acc + craftBonus(cut), Math.max(acc, FLAWLESS_AT - 0.0005));
}

export function isFlawless(acc) {
  return acc >= FLAWLESS_AT;
}

// How hard the line is turning at `s`, normalised. Used to fire a sawdust burst
// exactly as the blade rounds a corner rather than dribbling dust constantly.
export function curvatureAt(plank, s) {
  const d = 26;
  const a = lineAt(plank, s - d);
  const b = lineAt(plank, s);
  const c = lineAt(plank, s + d);
  return Math.abs(a - 2 * b + c) / d;
}

export const OBJECT_BONUS = 35;
// A clean crossing pays, so the timing is worth learning rather than worth avoiding.
export const JUMP_BONUS = 45;

// Breakdown is returned so the results panel can show WHERE the coins came from —
// a single total teaches the player nothing about what to do more of.
export function coinsFor(cut, acc, stars, level) {
  const base = 8 + Math.round(acc * 34);
  const starBonus = stars * 9;
  const levelBonus = Math.min(20, Math.floor(level.n / 3));
  const combo = Math.round(cut.bonusCoins);
  const objects = Math.round(cut.objectsHit * OBJECT_BONUS * (cut.findMult ?? 1));
  const jumps = Math.round(cut.jumpCoins ?? 0);
  // Micrometer Gauge. Cubed so it pays for a genuinely clean board rather than for
  // merely finishing one: 100% accuracy pays the pool, 80% pays about half of it.
  const precision = Math.round((cut.precisionPool ?? 0) * Math.pow(clamp(acc, 0, 1), 3));
  const core = base + starBonus + levelBonus;
  const sub = core + combo + objects + precision + jumps;
  // Endless pays for the difficulty the player CHOSE. Shown as its own line, because
  // the multiplier is the whole reason to pick a hard setting and it has to be
  // visible earning its keep.
  const risk = Math.round(sub * ((level.payMult ?? 1) - 1));
  // Timber Ledger applies to the whole board, and is shown as its own line so the
  // player can see the upgrade earning its keep.
  const ledger = Math.round((sub + risk) * ((cut.coinMult ?? 1) - 1));
  return {
    base: core,
    combo,
    objects,
    jumps,
    precision,
    risk,
    ledger,
    total: sub + risk + ledger,
  };
}

export function comboMult(cut) {
  return COMBO_TIERS[cut.tier].mult;
}
