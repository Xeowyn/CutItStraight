// Everything that persists between levels: what coins are FOR.
//
// Two loops, deliberately:
//   SHORT — saw upgrades. They change the cut itself (tolerance, feed, guidance,
//           payout), so coins buy something the player feels on the very next board.
//   LONG  — the Build screen. Finished boards become a birdhouse, then a kennel, a
//           shed, a lakeside cabin, an office. That is the reason to come back
//           tomorrow, which is the D1 retention number the whole game is judged on.
// Around those sit a star chest, a quest board and a daily challenge, each aimed at
// giving the player a concrete next goal rather than "play more levels".

import { LEVEL_COUNT } from './levels.js';
import { KITCHENS } from './kitchens.js';

// Consumable helpers (Slow-Mo, Steady Hand, Wood Filler) USED TO LIVE HERE and are
// deliberately gone. They were bought with coins and burned inside a run, and the owner
// never once used one: firing a helper means taking your thumb off the board, and the
// board does not stop. A consumable you have to stop playing to spend is a consumable
// nobody spends. The short coin sink is now the saw upgrades, which change the cut
// without asking the player to let go of it.

// --- Saw upgrades ----------------------------------------------------------
//
// The one rule these have to obey (guidelines §8.5): every tier must change how the
// game PLAYS, never just how it looks. Two groups:
//
//   THE MACHINE — changes what the saw does to the board (tolerance, feed speed,
//                 guidance, damage). These change the difficulty of the cut.
//   THE PAYOUT  — changes what a good cut is worth (combo speed, coin rate, find
//                 value, precision bonus). These change what the cut is FOR.
//
// Every fitted part can be switched off again from the same screen. A player who
// buys the laser and then finds it distracting must not be stuck with it — an
// upgrade you cannot remove is a downgrade you paid for. `upgradeOff` holds that,
// and `activeTier()` is what the game reads everywhere.
export const UPGRADES = {
  blade: {
    id: 'blade', group: 'machine', name: 'Tungsten Teeth', colour: '#9fe8ff',
    blurb: 'Forgives a wider wobble',
    costs: [150, 420, 900, 1800],
    // Multiplies the level's tolerance, so every accuracy band gets wider.
    tol: [1, 1.08, 1.16, 1.25, 1.35],
    effect: (t) => (t === 0 ? 'Stock blade' : `+${[0, 8, 16, 25, 35][t]}% cut tolerance`),
  },
  motor: {
    id: 'motor', group: 'machine', name: 'Geared Motor', colour: '#8fe87c',
    blurb: 'Slower feed, more thinking time',
    costs: [200, 520, 1100, 2100],
    speed: [1, 0.96, 0.92, 0.88, 0.84],
    effect: (t) => (t === 0 ? 'Stock motor' : `−${[0, 4, 8, 12, 16][t]}% feed speed`),
  },
  laser: {
    id: 'laser', group: 'machine', name: 'Guide Laser', colour: '#ff9a4d',
    blurb: 'Marks where the line will land',
    costs: [120, 380, 820, 1600],
    // Look-ahead barely moves: a marker too far up the board tells you about a
    // corner you cannot steer for yet, which is worse than no marker. Tiers add
    // CAPABILITY instead — the arrow, the corner warning, the second pip.
    look: [0, 130, 150, 170, 190],
    effect: (t) => [
      'Not fitted',
      'Spot laser on the line',
      '+ steering arrow',
      '+ corner warning',
      '+ second marker ahead',
    ][t],
  },
  dust: {
    id: 'dust', group: 'machine', name: 'Dust Extraction', colour: '#ffd35c',
    // Named after the on-screen thing it changes. "Dust extraction" on its own
    // means nothing to a player who has not read a workshop manual.
    blurb: 'The board splits more slowly',
    costs: [180, 460, 980, 1900],
    damage: [1, 0.88, 0.78, 0.68, 0.58],
    repair: [1, 1.15, 1.3, 1.5, 1.75],
    effect: (t) => (t === 0
      ? 'Full split rate'
      : `SPLIT fills ${[0, 12, 22, 32, 42][t]}% slower`),
  },

  drum: {
    id: 'drum', group: 'payout', name: 'Flywheel Drum', colour: '#ff7ad0',
    blurb: 'The multiplier climbs faster',
    costs: [260, 620, 1300, 2400],
    // Scales the SECONDS needed to reach each combo tier.
    combo: [1, 0.86, 0.74, 0.63, 0.52],
    effect: (t) => (t === 0
      ? '2x at 3s, 5x at 18s'
      : `Tiers arrive ${[0, 14, 26, 37, 48][t]}% sooner`),
  },
  ledger: {
    id: 'ledger', group: 'payout', name: 'Timber Ledger', colour: '#ffe08a',
    blurb: 'Every board sells for more',
    costs: [300, 700, 1500, 2800],
    coin: [1, 1.08, 1.17, 1.28, 1.42],
    effect: (t) => (t === 0 ? 'Standard rate' : `+${[0, 8, 17, 28, 42][t]}% coins per board`),
  },
  salvage: {
    id: 'salvage', group: 'payout', name: 'Salvage Crate', colour: '#8fd8ff',
    blurb: 'Odd finds are worth more',
    costs: [220, 560, 1200, 2200],
    find: [1, 1.5, 2.0, 2.6, 3.4],
    effect: (t) => `Odd finds pay ${Math.round(OBJECT_VALUE * [1, 1.5, 2.0, 2.6, 3.4][t])} each`,
  },
  precision: {
    id: 'precision', group: 'payout', name: 'Micrometer Gauge', colour: '#b6ff9e',
    blurb: 'Pays a bonus for a clean board',
    costs: [240, 600, 1250, 2300],
    // A pool paid out against accuracy cubed, so it only really lands on a clean cut.
    pool: [0, 45, 100, 175, 280],
    effect: (t) => (t === 0
      ? 'No precision bonus'
      : `Up to +${[0, 45, 100, 175, 280][t]} on a flawless cut`),
  },
};

// Kept in step with OBJECT_BONUS in plank.js; only used for the shop's copy.
const OBJECT_VALUE = 35;

export const UPGRADE_TIERS = 4;
export const UPGRADE_IDS = Object.keys(UPGRADES);

export function upgradeTier(meta, id) {
  return Math.min(UPGRADE_TIERS, meta.upgrades?.[id] | 0);
}

export function upgradeEnabled(meta, id) {
  return !meta.upgradeOff?.[id];
}

// What the GAME reads: a switched-off part behaves exactly as if it were never
// bought, without losing the tier the player paid for.
export function activeTier(meta, id) {
  return upgradeEnabled(meta, id) ? upgradeTier(meta, id) : 0;
}

export function toggleUpgrade(meta, id) {
  if (upgradeTier(meta, id) <= 0) return null;
  meta.upgradeOff[id] = !meta.upgradeOff[id];
  return !meta.upgradeOff[id];
}

// The next tier's cost, or null once it's maxed out.
export function upgradeCost(meta, id) {
  const t = upgradeTier(meta, id);
  return t >= UPGRADE_TIERS ? null : UPGRADES[id].costs[t];
}

export function buyUpgrade(meta, id, free = false) {
  const cost = upgradeCost(meta, id);
  if (cost == null) return null;
  if (!free && meta.coins < cost) return null;
  meta.coins = Math.max(0, meta.coins - (free ? Math.min(meta.coins, cost) : cost));
  meta.upgrades[id] = upgradeTier(meta, id) + 1;
  // Buying a tier switches the part back on — otherwise a player who disabled it
  // and then bought the next tier would see nothing happen.
  meta.upgradeOff[id] = false;
  return { id, tier: meta.upgrades[id], cost };
}

// A rewarded ad can finish a fitting the player has nearly paid for. Gated at half
// the cost so it reads as "finish this", not "skip the economy" — and it takes the
// coins they do have, so it is never strictly better than saving up.
export const AD_FIT_FRACTION = 0.5;

export function canAdFit(meta, id) {
  const cost = upgradeCost(meta, id);
  return cost != null && meta.coins < cost && meta.coins >= Math.ceil(cost * AD_FIT_FRACTION);
}

// Everything the cut mechanic needs from the saw, in one object. Read once per
// board, in createCut, so a purchase mid-board can never change the board.
export function sawMods(meta) {
  const t = (id) => activeTier(meta, id);
  const laserT = t('laser');
  return {
    tolMult: UPGRADES.blade.tol[t('blade')],
    speedMult: UPGRADES.motor.speed[t('motor')],
    laser: UPGRADES.laser.look[laserT],
    laserArrow: laserT >= 2,
    laserAlert: laserT >= 3,
    laserFar: laserT >= 4,
    damageMult: UPGRADES.dust.damage[t('dust')],
    repairMult: UPGRADES.dust.repair[t('dust')],
    comboScale: UPGRADES.drum.combo[t('drum')],
    coinMult: UPGRADES.ledger.coin[t('ledger')],
    findMult: UPGRADES.salvage.find[t('salvage')],
    precisionPool: UPGRADES.precision.pool[t('precision')],
  };
}

// Each project is a run of parts bought in order.
//
// The projects ARE the kitchens now — the five hand-modelled buildings are gone (the
// owner's verdict was that they still did not look good enough). Derived from
// kitchens.js rather than restated here, so a part's cost and the object that part
// actually places can never drift apart; that pairing is the whole contract between
// this file and the Build screen.
//
// Importing kitchens.js costs nothing at load: it only defines data and builds no
// geometry until a mesh is asked for.
export const PROJECTS = KITCHENS.map((k) => ({
  id: k.id,
  name: k.name,
  icon: k.id,
  blurb: k.blurb,
  parts: k.items.map((it) => ({ name: it.name, cost: it.cost })),
}));

export const QUEST_TEMPLATES = [
  { id: 'boards', text: (n) => `Cut ${n} boards`, target: () => 5 + Math.floor(Math.random() * 4), reward: 120, stat: 'boards' },
  { id: 'perfect', text: (n) => `Land ${n} perfect turns`, target: () => 2 + Math.floor(Math.random() * 3), reward: 180, stat: 'perfectTurns' },
  { id: 'finds', text: (n) => `Collect ${n} odd finds`, target: () => 3 + Math.floor(Math.random() * 3), reward: 150, stat: 'finds' },
  { id: 'threestar', text: (n) => `Earn ${n}x 3-star cuts`, target: () => 2 + Math.floor(Math.random() * 2), reward: 200, stat: 'threeStars' },
  { id: 'combo', text: (n) => `Reach a ${n}x combo`, target: () => 3 + Math.floor(Math.random() * 2), reward: 160, stat: 'bestCombo', absolute: true },
];

export const STARS_PER_CHEST = 30;
const QUEST_SLOTS = 3;

export function createMeta() {
  return {
    coins: 0,
    levelNum: 1,
    stars: {},                 // level -> best stars
    flawless: {},              // level -> true once cut FLAWLESS (the purple 4th star); save v11
    keys: 0,
    upgrades: { blade: 0, motor: 0, laser: 0, dust: 0, drum: 0, ledger: 0, salvage: 0, precision: 0 },
    // Bought but switched off. Keyed the same as `upgrades`.
    upgradeOff: {},
    projectIndex: 0,
    partsBought: 0,
    completedProjects: [],
    starsBanked: 0,            // toward the next chest
    lifetimeStars: 0,
    quests: [],
    stats: { boards: 0, perfectTurns: 0, finds: 0, threeStars: 0, bestCombo: 1 },
    daily: { date: null, done: false, streak: 0, best: 0, last: null },
    // Free chest, one per local day. Separate from `daily` (the daily BOARD) on
    // purpose: a player who skips the challenge should still have a reason to open
    // the game tomorrow.
    dailyChest: { date: null, claimed: 0 },
    // Player-facing options. Inverted steering is a real accessibility need — some
    // players read the plank as the thing they push, others as the thing the world
    // moves under — and it costs one sign flip to support both.
    // sfxVol / musicVol are the two volume sliders (0..1), added in save v10.
    settings: { invert: false, muted: false, sfxVol: 0.85, musicVol: 0.45 },
    maxLevel: 1,
    // Endless. Unlocked by finishing the campaign; `speed` and `line` remember the
    // last difficulty the player chose so the picker opens where they left it, and
    // `best` records the longest run per combination — a record per setting, because
    // a run on Gentle/Lazy is not the same achievement as one on Reckless/Vicious.
    endless: { unlocked: false, speed: 1, line: 1, best: {}, runs: 0, boards: 0 },
    // When the player last had the game open, as an epoch ms stamp, and whether they
    // have ever played at all. These exist for ONE purpose: deciding whether this
    // session gets the 10-minute forced-ad grace (see `adGraceFor` below and §3 of the
    // guidelines). Null here is what a genuine first install looks like.
    lastPlayedAt: null,
  };
}

// --- Forced-ad grace -------------------------------------------------------
//
// The 10-minute grace is expensive — it is the single biggest voluntary cut we make to
// midgame revenue — so it is spent where it actually buys something. It buys a first
// impression, and it buys back a player who had drifted off. It buys nothing at all
// from someone who played an hour ago and already knows the game.
//
//   * First session ever  -> grace. Nothing matters more than this session.
//   * Away 7+ days        -> grace. A returning lapsed player is the most fragile
//                            player there is, and an ad inside their first minute is
//                            the cheapest possible way to lose them a second time.
//   * Anyone else         -> no grace. Forced ads are still limited to ONE per ten
//                            minutes and still only at a player-initiated transition,
//                            so the worst case is one ad on the first Next Level tap.
export const LAPSED_MS = 7 * 24 * 60 * 60 * 1000;

export function adGraceFor(meta, now = Date.now()) {
  const last = meta.lastPlayedAt;
  if (!last) return { grace: true, reason: 'first-session' };
  // A clock that has gone backwards (timezone change, a device with a bad clock)
  // must not be readable as "away for a week" OR as a negative age; treat it as a
  // fresh visit and give the grace, which is the side that cannot cost a player.
  const away = now - last;
  if (away < 0) return { grace: true, reason: 'clock-skew' };
  if (away >= LAPSED_MS) return { grace: true, reason: 'returning-lapsed' };
  return { grace: false, reason: 'active-player' };
}

export function touchLastPlayed(meta, now = Date.now()) {
  meta.lastPlayedAt = now;
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function rollQuests(meta) {
  const pool = QUEST_TEMPLATES.slice();
  const out = [];
  while (out.length < QUEST_SLOTS && pool.length) {
    const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const target = t.target();
    out.push({
      id: t.id,
      text: t.text(target),
      target,
      reward: t.reward,
      stat: t.stat,
      absolute: !!t.absolute,
      start: t.absolute ? 0 : meta.stats[t.stat],
      claimed: false,
    });
  }
  meta.quests = out;
}

export function questProgress(meta, q) {
  const cur = meta.stats[q.stat];
  const val = q.absolute ? cur : cur - q.start;
  return Math.max(0, Math.min(q.target, val));
}

export function questDone(meta, q) {
  return questProgress(meta, q) >= q.target;
}

export function currentProject(meta) {
  return PROJECTS[Math.min(meta.projectIndex, PROJECTS.length - 1)];
}

export function nextPart(meta) {
  const p = currentProject(meta);
  return meta.partsBought < p.parts.length ? p.parts[meta.partsBought] : null;
}

export function buyPart(meta) {
  const part = nextPart(meta);
  if (!part || meta.coins < part.cost) return null;
  meta.coins -= part.cost;
  meta.partsBought++;
  const proj = currentProject(meta);
  if (meta.partsBought >= proj.parts.length) {
    meta.completedProjects.push(proj.id);
    if (meta.projectIndex < PROJECTS.length - 1) {
      meta.projectIndex++;
      meta.partsBought = 0;
    }
    return { part, projectComplete: proj };
  }
  return { part, projectComplete: null };
}


export function bankStars(meta, n) {
  meta.starsBanked += n;
  meta.lifetimeStars += n;
}

export function chestReady(meta) {
  return meta.starsBanked >= STARS_PER_CHEST;
}

// Split into a roll and an award so the chest ceremony can show the loot BEFORE it
// lands in the player's balance — the player has to be the one who opens it.
// The second reward used to be a random consumable. With those gone it is KEYS, which
// is a better prize anyway: keys are the currency that opens the in-run treasure chest,
// so the reward points back at playing rather than at a shop.
export function rollStarChest(meta) {
  if (!chestReady(meta)) return null;
  return { coins: 350, keys: 2 };
}

export function awardStarChest(meta, roll) {
  if (!roll) return;
  meta.starsBanked = Math.max(0, meta.starsBanked - STARS_PER_CHEST);
  meta.coins += roll.coins;
  meta.keys += roll.keys;
}

// --- Daily free chest ------------------------------------------------------
//
// One per local day, the reason to open the game tomorrow rather than the reason to
// keep playing today — so it is deliberately claimable in two taps from the gear and
// pays enough to buy a helper outright.
//
// It is offered on a rewarded ad where ads exist, but it must NEVER require one:
// Basic Launch runs with ads disabled for 7-21 days, which is exactly the window in
// which CrazyGames measures the D1 retention this feature is here to defend. A
// return hook that only functions after Full Launch does not defend the metric it
// was built for.
// --- The daily streak -------------------------------------------------------
//
// The streak used to be a number printed on a card and nothing else: it counted up,
// it reset if you missed a day, and it paid nothing either way. A counter with no
// consequence is not a retention hook, it is a statistic — and D1 retention is one of
// the three prime metrics this game is built around.
//
// So the streak now pays, on a seven-day ladder, and the Workshop card shows the ladder
// rather than the number. The multiplier is deliberately modest: the daily board is one
// board a day, and it must not become the only sensible way to earn.
export const DAILY_STREAK_LEN = 7;

export function dailyStreakMult(streak) {
  return 1 + 0.12 * Math.min(streak, DAILY_STREAK_LEN);
}

// Every seventh day pays a chest on top — a thing the player opens, not a number that
// appears in a list.
export function dailyStreakChest(streak) {
  return streak > 0 && streak % DAILY_STREAK_LEN === 0;
}

export function dailyChestReady(meta, d = new Date()) {
  return meta.dailyChest.date !== todayKey(d);
}

export function rollDailyChest(meta, d = new Date()) {
  if (!dailyChestReady(meta, d)) return null;
  // Scales gently with progress so it is still worth opening at level 60, but it is
  // never the fastest coin per minute — that has to stay the cut itself.
  const coins = 120 + Math.min(40, meta.levelNum) * 12;
  return { coins, keys: 1 };
}

export function awardDailyChest(meta, roll, d = new Date()) {
  if (!roll) return;
  meta.dailyChest.date = todayKey(d);
  meta.dailyChest.claimed++;
  meta.coins += roll.coins;
  meta.keys += roll.keys;
}

export function serialise(meta) {
  return {
    v: 11,
    coins: meta.coins,
    levelNum: meta.levelNum,
    stars: meta.stars,
    flawless: meta.flawless,
    keys: meta.keys,
    upgrades: meta.upgrades,
    upgradeOff: meta.upgradeOff,
    projectIndex: meta.projectIndex,
    partsBought: meta.partsBought,
    completedProjects: meta.completedProjects,
    starsBanked: meta.starsBanked,
    lifetimeStars: meta.lifetimeStars,
    quests: meta.quests,
    stats: meta.stats,
    daily: meta.daily,
    dailyChest: meta.dailyChest,
    settings: meta.settings,
    maxLevel: meta.maxLevel,
    endless: meta.endless,
    lastPlayedAt: meta.lastPlayedAt,
  };
}

export function deserialise(meta, d) {
  if (!d) return;
  meta.coins = d.coins | 0;
  meta.levelNum = Math.max(1, d.levelNum | 0);
  meta.stars = d.stars || {};
  // Pre-v11 saves never recorded a flawless cut, so those levels show 3 stars until the
  // player cuts them flawless again.
  meta.flawless = d.flawless || {};
  meta.keys = d.keys | 0;
  // `d.helpers` (the removed consumables) is intentionally ignored on load.
  // Saves written before v5 have no upgrades block; the defaults stand.
  Object.assign(meta.upgrades, d.upgrades || {});
  Object.assign(meta.upgradeOff, d.upgradeOff || {});
  meta.projectIndex = d.projectIndex | 0;
  meta.partsBought = d.partsBought | 0;
  meta.completedProjects = d.completedProjects || [];
  meta.starsBanked = d.starsBanked | 0;
  meta.lifetimeStars = d.lifetimeStars | 0;
  meta.quests = Array.isArray(d.quests) ? d.quests : [];
  Object.assign(meta.stats, d.stats || {});
  Object.assign(meta.daily, d.daily || {});
  // Pre-v7 saves have no daily chest; the defaults leave one waiting, which is the
  // right way round for a returning player.
  Object.assign(meta.dailyChest, d.dailyChest || {});
  Object.assign(meta.settings, d.settings || {});
  // v10 flipped the BASE steering direction (owner, 2026-09-28: new players start with
  // the other direction). An older save keeps exactly the steering it had, by flipping
  // its invert flag to compensate.
  if ((d.v | 0) < 10 && d.settings) meta.settings.invert = !meta.settings.invert;
  meta.maxLevel = Math.max(1, d.maxLevel | 0);
  // Pre-v8 saves have no endless block. A player who already finished the campaign
  // before this existed is unlocked on load rather than being asked to do it again.
  Object.assign(meta.endless, d.endless || {});
  if (!meta.endless.best) meta.endless.best = {};
  if ((meta.stars[LEVEL_COUNT] || 0) > 0) meta.endless.unlocked = true;
  // Pre-v9 saves have no lastPlayedAt. They are by definition NOT first sessions —
  // there is a save — so they must not be handed the first-session grace. Stamping
  // them as "played just now" makes the very next session an ordinary one, which is
  // the correct reading of an existing player.
  meta.lastPlayedAt = typeof d.lastPlayedAt === 'number' ? d.lastPlayedAt : Date.now();
}

// --- Endless ---------------------------------------------------------------

export const ENDLESS_KEY = (speed, line) => `${speed}-${line}`;

// Finishing the last campaign level is the unlock. Checked against the star record
// rather than maxLevel, because maxLevel only means the level was STARTED.
export function endlessUnlocked(meta) {
  return !!meta.endless.unlocked || (meta.stars[LEVEL_COUNT] || 0) > 0;
}

export function unlockEndless(meta) {
  const first = !meta.endless.unlocked;
  meta.endless.unlocked = true;
  return first;
}

// Returns true if this run beat the record for the difficulty it was played on.
export function recordEndless(meta, speed, line, boards) {
  const key = ENDLESS_KEY(speed, line);
  meta.endless.runs++;
  meta.endless.boards += boards;
  const best = meta.endless.best[key] || 0;
  if (boards > best) {
    meta.endless.best[key] = boards;
    return true;
  }
  return false;
}

export function endlessBest(meta, speed, line) {
  return meta.endless.best[ENDLESS_KEY(speed, line)] || 0;
}
