// Loop, state machine and UI.
//
// Gameplay runs on a fixed-timestep accumulator rather than raw deltaTime, because
// CrazyGames explicitly tests that physics behave identically at 144Hz and 165Hz.

import { createInput } from './input.js';
import {
  getLevel, getEndlessLevel, LEVEL_COUNT, ENDLESS_SPEEDS, ENDLESS_LINES, MATERIALS, levelTex,
} from './levels.js';
import {
  buildPlank, createCut, stepCut, accuracy, starsFor, coinsFor, comboMult,
  COMBO_TIERS, OBJECT_BONUS, JUMP_BONUS, STAR_AT, isFlawless, FLAWLESS_AT,
  tryJump, rearmJumps, gapAt, cutScore, craftBonus, craftParts, CRAFT_BONUS_MAX,
} from './plank.js';
import { clamp } from './rng.js';
import * as R from './render.js';
import * as FX from './fx.js';
import * as A from './audio.js';
import * as SDK from './sdk.js';
import * as META from './meta.js';
import { drawWorkshop, drawUpgrades } from './workshop.js';
import * as BUILD from './build.js';
import * as CHEST from './chest.js';
import * as MENU from './menu.js';
import * as UI from './ui.js';
const { drawPauseMenu, drawLevelSelect, drawHomeMenu, drawEndlessSetup } = MENU;

const TICK = 1 / 120;
const MAX_FRAME = 0.25;
const CONTINUE_COST = 60;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

let L = R.computeLayout(720, 1280);
const view = { safeTop: 0, safeBottom: 0, cw: 0, ch: 0 };
const fx = FX.createFx();
// Landing coins / stars / keys each make a sound (see fx.js updateMenuFx).
let arriveN = 0;
fx.arriveSound = (kind) => {
  if (kind === 'key') A.keyChime();
  else if (kind === 'star') A.starLand(0);
  else A.coinCollect(arriveN++);
};
const input = createInput(canvas, () => L.scale);

const meta = META.createMeta();

const game = {
  // boot | home | playing | complete | failed | ad | workshop | upgrades | build |
  // chest | levels | menu | endless
  state: 'boot',
  levelNum: 1,
  level: null,
  plank: null,
  cut: null,
  chests: 0,
  reward: null,
  scroll: 0,
  scrollMax: 0,
  dragScroll: null,
  daily: false,             // this run is the daily challenge
  // An endless run in progress, or null. Held on `game` and not in `meta` because a
  // run does not survive a reload — only its record does.
  endlessRun: null,
  endlessSel: { speed: 1, line: 1 },
  endlessOver: null,        // { boards, record } while the run-over panel is up
  // { grace, reason } — which side of the first-session / lapsed-player test this
  // session landed on. Set by load(); read only for diagnostics.
  adGrace: null,
  // Active helper effects for the current run.
  splitT: 0,
  resultT: 0,
  starsShown: 0,
  flawlessEcho: 0,
  earned: 0,
  doubled: false,
  continueUsed: false,
  hintT: 0,
  // Seconds of "3 - 2 - 1 - GO" before the board starts moving again. Dropping a
  // player straight back onto a moving board they already lost is not a continue.
  countT: 0,
  countStep: -1,
  hasSteered: false,
  buttons: [],
  pressed: null,
  slider: null,        // id of the volume slider being dragged
  toast: null,
  toastT: 0,
  time: 0,
  streakStep: 0,
  // Saw feel: the blade lags the player's steering and heats up when it's off the
  // line. Both are what make the tool feel physical rather than a cursor.
  flex: 0,
  flexVel: 0,
  heat: 0,
  lastBurstS: -999,
  sparkleT: 0,
  pendingAd: null,
  // Chests are no longer auto-credited: they are held here until the player opens
  // them, because the opening is the reward.
  pendingChests: 0,
  chestFrom: null,          // 'keys' or 'streak' — the results button says which
  chestScene: null,
  chestReturn: 'complete',
  chestOnCollect: null,
  build: BUILD.createBuild(),
  wsIntro: 1,
  menuReturn: 'playing',
  upReturn: 'workshop',
  // Where BACK goes from the Workshop. It used to always return to the results
  // panel, which is a screen that may not exist when the Workshop was opened from
  // the main menu.
  wsReturn: 'complete',
  lvScroll: 0,
  lvScrollMax: 0,
  maxLevel: 1,
  punch: null,
  coinRoll: FX.createRoll(0),
  rowsIn: 0,
};

// Dev-only affordances. Gated on the SDK reporting a `local` environment or an actual
// localhost host, so this can never appear once the game is hosted on CrazyGames.
// The play-tester package (tools/build_standalone.py) also runs on localhost, and sets
// `__testerBuild` so a tester can't wipe their save with the dev reset button.
function isDev() {
  if (window.__testerBuild) return false;
  return SDK.state.environment === 'local'
    || ['localhost', '127.0.0.1'].includes(location.hostname);
}

// --- Persistence -----------------------------------------------------------

function save() {
  meta.levelNum = game.levelNum;
  // Stamped on every save, so "last played" means the end of the last session rather
  // than its start. `load()` has already read the previous value and decided the ad
  // grace by this point, so this can never race it.
  META.touchLastPlayed(meta);
  SDK.saveData(META.serialise(meta));
}

function load() {
  META.deserialise(meta, SDK.loadData());
  // Decide the forced-ad grace BEFORE stamping this session's timestamp, or every
  // session would look like it had just been played and nobody would ever qualify.
  const g = META.adGraceFor(meta);
  SDK.applyAdGrace(g.grace);
  game.adGrace = g;
  META.touchLastPlayed(meta);
  game.levelNum = meta.levelNum;
  game.maxLevel = Math.max(meta.maxLevel || 1, meta.levelNum || 1);
  if (!meta.quests.length) META.rollQuests(meta);
  // Daily challenge resets at local midnight; a missed day breaks the streak.
  const today = META.todayKey();
  const yesterday = META.todayKey(new Date(Date.now() - 864e5));
  // The streak is measured from the last day a daily board was actually CUT. It was
  // measured from `date`, which is stamped on every boot — so a player who merely
  // opened the game each day kept a streak they never played for. Pre-`last` saves
  // fall back to the old check once.
  if (meta.daily.last && meta.daily.last !== today && meta.daily.last !== yesterday) {
    meta.daily.streak = 0;
  }
  if (meta.daily.date !== today) {
    if (!meta.daily.last && meta.daily.date !== yesterday) meta.daily.streak = 0;
    meta.daily.date = today;
    meta.daily.done = false;
  }
}

// --- Layout ----------------------------------------------------------------

function readSafeArea() {
  const probe = document.getElementById('safe-probe');
  if (!probe) return;
  const cs = getComputedStyle(probe);
  view.safeTop = parseFloat(cs.paddingTop) || 0;
  view.safeBottom = parseFloat(cs.paddingBottom) || 0;
}

function resize() {
  readSafeArea();
  // The platform manages devicePixelRatio (forced to 1 on iOS and low-memory
  // Android); read it rather than fight it, capped so high-DPR screens keep their
  // fill rate.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  view.cw = w;
  view.ch = h;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  L = R.computeLayout(w, h);
  // Safe-area insets are in CSS px; convert to logical units.
  view.safeTop /= L.scale;
  view.safeBottom /= L.scale;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

function toStage(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left - L.ox) / L.scale,
    y: (clientY - r.top - L.oy) / L.scale,
  };
}

// --- Level flow ------------------------------------------------------------

// Every board in the game — campaign, daily and endless — is started here, so the
// three cannot drift apart. `opts.keepContinue` is the endless case: the rewarded
// continue is once per RUN there, not once per board.
function beginBoard(level, opts = {}) {
  game.level = level;
  // Normally already streamed in; this puts it at the front if it has not.
  R.ensureTexture(level.material.tex);
  if (!level.isDaily && !game.endlessRun) R.ensureTexture(levelTex(game.levelNum + 1));
  game.plank = buildPlank(level);
  // The fitted saw upgrades are baked onto the cut, so buying one mid-board can
  // never change the board being cut.
  game.cut = createCut(game.plank, META.sawMods(meta));
  game.splitT = 0;
  game.resultT = 0;
  game.starsShown = 0;
  game.flawlessEcho = 0;
  game.doubled = false;
  if (!opts.keepContinue) game.continueUsed = false;
  game.streakStep = 0;
  game.hintT = opts.hint ? 4.5 : 0;
  game.hasSteered = false;
  game.flex = 0;
  game.flexVel = 0;
  game.heat = 0;
  game.lastBurstS = -999;
  game.endlessOver = null;
  game.justUnlockedEndless = false;
  game.state = 'playing';
  A.setMaterialProfile(level.material.sound);
  input.reset();
  SDK.gameplayStart();
  // EVERY board counts in, not just a revive or a resume.
  //
  // The count-in already existed for those two cases, on the reasoning that dropping a
  // player onto a board that is already moving is not a fair restart. That reasoning
  // never only applied to revives: a player who taps PLAY is dropped onto a moving
  // board too, and on the very first launch they are dropped into a game they have
  // never seen with no idea which way to drag. Three seconds costs nothing against the
  // 10-minute playtime target and buys the first four seconds of comprehension that §2
  // says conversion is won in.
  //
  // `countIn` is reused rather than reimplemented — it already holds the board still,
  // discards steering and draws the 3-2-1-GO.
  countIn(opts.count ?? 3, 'start');
  // A board that is different gets a briefing card FIRST, and the count-in waits
  // behind it until the player taps. The gimmick used to be announced only during the
  // 3-2-1, which is three seconds in which the player is looking at the numbers — so
  // it was missable, and a missed "BOARD JUMP" is learned by falling into the hole.
  // An immediate retry of the same board skips it: they have read it already.
  const brief = level.briefing || [];
  game.briefing = brief.length && game.lastBriefSeed !== level.seed ? { t: 0, items: brief } : null;
  if (game.briefing) game.lastBriefSeed = level.seed;
}

function dismissBriefing() {
  // A short floor before input counts, so the release of the tap that STARTED the
  // board (NEXT LEVEL, PLAY) cannot also dismiss the card it opened.
  if (!game.briefing || game.briefing.t < 0.45) return;
  game.briefing = null;
  input.reset();
  countIn(3, 'start');
}

function startLevel(n) {
  n = clamp(n, 1, LEVEL_COUNT);
  game.levelNum = n;
  game.maxLevel = Math.max(game.maxLevel, n);
  meta.maxLevel = game.maxLevel;
  game.daily = false;
  game.endlessRun = null;
  beginBoard(getLevel(n), { hint: n <= 2 });
  SDK.reportProgress(clamp((n / LEVEL_COUNT) * 100, 0, 100));
}

// --- Endless ---------------------------------------------------------------
//
// Unlocked by finishing the campaign. The run is a chain of boards at the difficulty
// the player chose; one ruined board ends it. Records are kept per difficulty pair,
// because surviving 20 boards on Gentle/Lazy is not the same feat as 20 on
// Reckless/Vicious.
function startEndlessRun() {
  const sel = game.endlessSel;
  meta.endless.speed = sel.speed;
  meta.endless.line = sel.line;
  save();
  game.daily = false;
  game.continueUsed = false;
  game.endlessRun = {
    speed: sel.speed,
    line: sel.line,
    board: 0,
    coins: 0,
    seed: Math.floor(Math.random() * 1e6) + 1,
    best: META.endlessBest(meta, sel.speed, sel.line),
  };
  startEndlessBoard();
}

function startEndlessBoard() {
  const r = game.endlessRun;
  beginBoard(getEndlessLevel(r.speed, r.line, r.board, r.seed), { keepContinue: true });
}

// Ends the run and banks the record. Called on a ruined board, or when the player
// walks away from a finished one.
function endEndlessRun() {
  const r = game.endlessRun;
  if (!r) return null;
  const record = META.recordEndless(meta, r.speed, r.line, r.board);
  const out = { boards: r.board, record, best: META.endlessBest(meta, r.speed, r.line) };
  game.endlessRun = null;
  save();
  return out;
}

// The main menu is not a title card over a flat colour: it is the game, running.
// A board of the player's current level feeds through the saw behind the menu, cut
// perfectly, which answers "what is this game" before anything is tapped — the
// four-second comprehension rule in §2 applies harder to a screen that now sits in
// front of gameplay than it did when there was no screen at all.
function ensureHomeBoard(force) {
  if (!force && game.homeBoard && game.homeBoard.n === game.levelNum) return;
  const lv = getLevel(clamp(game.levelNum, 1, LEVEL_COUNT));
  // NOT reseeded. This used to do `lv.seed += Math.random() * 999`, which made the
  // board idling behind the main menu a different board from the one PLAY actually
  // starts — the menu advertised a line the player then never cut. Campaign lines are
  // fixed per level by design (`seed: n * 7919 + 13` in levels.js), and the menu is a
  // preview of the real thing, so it has to show the real thing.
  const plank = buildPlank(lv);
  const cut = createCut(plank, META.sawMods(meta));
  // Start part-way in so there is already a finished kerf on screen to look at.
  cut.s = 300;
  cut.kerf = [{ s: 0, x: 0, q: 1 }];
  game.homeBoard = { n: game.levelNum, cut, plank };
}

// Feeds the menu's board at about half speed, always exactly on the line. It is a
// demonstration, not a simulation: nothing here can fail, score or be steered.
function updateHomeBoard(dt) {
  const h = game.homeBoard;
  if (!h) return;
  const c = h.cut;
  c.s += h.plank.level.speed * 0.42 * dt;
  c.offset = -lineAtDebug(h.plank, c.s);
  const last = c.kerf[c.kerf.length - 1];
  if (c.s - last.s >= 9) c.kerf.push({ s: c.s, x: -c.offset, q: 1 });
  if (c.s >= h.plank.length - 120) ensureHomeBoard(true);
}

function goHome() {
  if (game.endlessRun) endEndlessRun();
  // The menu draws the workshop behind itself, so it needs a level to take the
  // workshop from — the one the player is up to, which makes the backdrop advance
  // with their progress.
  game.level = getLevel(clamp(game.levelNum, 1, LEVEL_COUNT));
  ensureHomeBoard(true);
  game.state = 'home';
  game.endlessOver = null;
  game.scroll = 0;
  SDK.gameplayStop();
  A.updateSaw(false, 0, 0);
}

function finishLevel() {
  const cut = game.cut;
  SDK.gameplayStop();
  if (cut.failed) {
    // In endless a ruined board is the end of the run, not of a level. The record is
    // banked here — before the panel is drawn — so the panel can show whether the
    // run beat it.
    if (game.endlessRun && game.continueUsed) game.endlessOver = endEndlessRun();
    // A failed Daily Cut spends the day's attempt ("One board. One attempt."). The
    // streak is not broken by a failure, only by a missed day; a continue that then
    // finishes the board still pays it through the normal completion path.
    if (game.daily) { meta.daily.done = true; save(); }
    game.state = 'failed';
    game.resultT = 0;
    A.failSound();
    A.updateSaw(false, 0, 0);
    FX.shake(fx, 20);
    return;
  }
  const acc = accuracy(cut);
  // Stars are scored on the SCORE, not on accuracy alone — see craftBonus in plank.js.
  const stars = starsFor(cutScore(cut));
  const breakdown = coinsFor(cut, acc, stars, game.level);
  // A completed key set is NOT paid out here. It becomes a chest the player has to
  // open themselves on the results screen — the opening is the reward, and a number
  // that appears in a list is not one.
  game.pendingChests = game.chests;
  game.chestFrom = game.chests > 0 ? 'keys' : null;
  game.chests = 0;
  breakdown.chest = 0;
  breakdown.precision = breakdown.precision || 0;
  breakdown.ledger = breakdown.ledger || 0;
  breakdown.risk = breakdown.risk || 0;
  breakdown.streak = 0;
  // The daily board pays the streak ladder. The streak is advanced FIRST so the very
  // first daily already pays day one — a ladder whose first rung pays nothing teaches
  // the player that it does not pay.
  if (game.daily) {
    meta.daily.done = true;
    meta.daily.streak++;
    meta.daily.last = META.todayKey();
    meta.daily.best = Math.max(meta.daily.best, Math.round(acc * 100));
    const streakMult = META.dailyStreakMult(meta.daily.streak);
    breakdown.streak = Math.round(breakdown.total * (streakMult - 1));
    breakdown.total += breakdown.streak;
    // Every seventh day is a chest, which is opened by hand on the results screen
    // exactly like the star and key chests.
    if (META.dailyStreakChest(meta.daily.streak)) {
      game.pendingChests++;
      if (!game.chestFrom) game.chestFrom = 'streak';
    }
  }
  game.reward = breakdown;
  game.earned = breakdown.total;
  meta.coins += game.earned;
  // Endless boards do not write into the campaign's star record — they are not
  // campaign levels — but they do advance the run and bank lifetime stars.
  if (game.endlessRun) {
    game.endlessRun.board++;
    game.endlessRun.coins += game.earned;
  } else if (!game.daily) {
    const prev = meta.stars[game.levelNum] || 0;
    if (stars > prev) meta.stars[game.levelNum] = stars;
    // The purple star is its own record: a later 3-star cut must never take it away.
    if (isFlawless(accuracy(game.cut))) meta.flawless[game.levelNum] = true;
  }
  game.state = 'complete';
  game.resultT = 0;
  game.starsShown = 0;
  game.flawlessEcho = 0;
  game.rowsIn = 0;
  game.coinRoll = FX.createRoll(0);
  FX.setRoll(game.coinRoll, game.earned, { rate: Math.max(60, game.earned * 1.7) });

  // Feed the meta layer: stars bank toward the chest, and quest counters advance.
  META.bankStars(meta, stars);
  meta.stats.boards++;
  meta.stats.finds += cut.objectsHit;
  meta.stats.perfectTurns += cut.keys;
  if (stars === 3) meta.stats.threeStars++;
  meta.stats.bestCombo = Math.max(meta.stats.bestCombo, COMBO_TIERS[cut.peakTier].mult);

  A.updateSaw(false, 0, 0);
  A.fanfare();
  FX.confetti(fx, L.cx, L.bladeY - 60, 90);
  FX.shake(fx, 9);
  if (stars === 3) SDK.happytime();

  // Finishing the last campaign level unlocks Endless. It is celebrated properly:
  // this is the single biggest thing a player can do in the game, and the results
  // panel behind it changes its primary button to point at what they just earned.
  if (!game.endlessRun && !game.daily && game.levelNum >= LEVEL_COUNT
      && META.unlockEndless(meta)) {
    game.justUnlockedEndless = true;
    A.bigFanfare();
    FX.confetti(fx, L.cx, L.h * 0.4, 200);
    FX.flash(fx, 0.5, '255,236,190');
    FX.shake(fx, 20);
    SDK.happytime();
  }
  save();
}

// A forced ad only happens at a player-initiated transition AND only once the
// 10-minute grace period since the last ad of any kind has elapsed. See sdk.js.
function transitionTo(startFn) {
  if (SDK.adsUsable() && SDK.forcedAdDue()) {
    runAd(SDK.showMidgameAd, startFn, startFn);
  } else {
    startFn();
  }
}

function nextLevel() {
  if (game.endlessRun) { transitionTo(() => startEndlessBoard()); return; }
  // The campaign is finite now. Past the last level there is no next one, so the
  // player goes back to the menu, where Endless is waiting and unlocked.
  if (game.levelNum >= LEVEL_COUNT) { transitionTo(() => goHome()); return; }
  const n = game.levelNum + 1;
  transitionTo(() => startLevel(n));
}

function retryLevel() {
  // A ruined endless board cannot be retried — the run is over. Retry starts a fresh
  // run on the same difficulty, which is what the player actually wants next.
  if (game.endlessOver || game.endlessRun) {
    // Still holding a run here means the player was offered a continue and declined
    // it, so the run has to be banked before a new one starts.
    if (game.endlessRun) endEndlessRun();
    game.endlessOver = null;
    transitionTo(() => startEndlessRun());
    return;
  }
  transitionTo(() => startLevel(game.levelNum));
}

function runAd(request, onFinish, onError) {
  const prevState = game.state;
  // Banners must be gone before a video ad plays.
  SDK.clearBanners();
  bannerVisible = false;
  game.state = 'ad';
  A.updateSaw(false, 0, 0);
  A.setMuted(true);
  showDevSkip(true);

  let settled = false;
  const done = (fn) => {
    if (settled) return;
    settled = true;
    game.pendingAd = null;
    // Restore the PLAYER's mute too, not just the platform's — this used to forget it.
    A.setMuted(SDK.platformMuted() || !!meta.settings.muted);
    showDevSkip(false);
    // ALWAYS leave the 'ad' state before running the handler. Previously only the
    // error path restored it, so any rewarded ad whose handler didn't set a state
    // of its own — DOUBLE COINS — completed, paid out, and left the game stuck on
    // the ad cover forever. The handler can still override this afterwards.
    if (game.state === 'ad') game.state = prevState;
    fn();
  };
  const finish = () => done(() => { SDK.markAdShown(); onFinish(); });
  const fail = () => done(() => onError());

  game.pendingAd = { finish, fail };
  request({ onStart: () => { A.setMuted(true); }, onFinish: finish, onError: fail });
}

// The dev skip has to be real DOM: the SDK's local ad overlay is a fixed div at
// z-index 10000 with pointer events enabled, so anything drawn on the canvas sits
// underneath it and can never be clicked.
// Skipping has to do BOTH things: tear down the SDK's own local ad overlay, and
// settle our pending ad. Doing only the second one is what made this button look
// broken — the game resumed underneath while the grey overlay kept its countdown
// and kept eating clicks.
function devSkipAd() {
  // Sweep for a beat rather than dismissing once. The overlay is injected
  // synchronously in local mode today, but a skip pressed in the gap between
  // requesting an ad and the provider painting its cover would otherwise settle our
  // side while the overlay arrived a moment later and stayed for its full duration.
  SDK.dismissLocalAd();
  let n = 0;
  const sweep = setInterval(() => {
    SDK.dismissLocalAd();
    if (++n > 20) clearInterval(sweep);
  }, 60);
  game.pendingAd?.finish();
}

const devSkipEl = document.getElementById('devskip');
if (devSkipEl) {
  devSkipEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    devSkipAd();
  });
}
function showDevSkip(on) {
  if (!devSkipEl) return;
  devSkipEl.hidden = !(on && isDev());
}

// Resuming after a failure has to hand the board back in a state the player can
// actually save. Clearing the damage alone left the blade wherever it had wandered
// to — usually off the plank entirely — so the meter refilled within a second and
// the continue was worthless. Re-seat the cut on the line, back it up far enough to
// read the next turn, then count the player in.
function doContinue() {
  const cut = game.cut;
  cut.damage = 0;
  cut.failed = false;
  cut.done = false;
  cut.offBoard = false;
  cut.band = 'perfect';
  // Rewind a little so the player re-enters before the bit that beat them.
  cut.s = Math.max(0, cut.s - 150);
  // Never hand the board back with the blade hanging over a hole: there would be
  // nothing under it to re-seat on, and the crossing would already be half spent.
  // Put the player back on solid board in front of the hole and re-arm its jump.
  const hole = gapAt(game.plank, cut.s);
  if (hole) cut.s = Math.max(0, hole.s0 - 160);
  rearmJumps(cut);
  // The blade sits at plank-local -offset, so this puts it exactly on the line.
  cut.offset = -lineAtDebug(game.plank, cut.s);
  // Drop the kerf samples from the rewound stretch; they would otherwise draw a
  // scorched line the board no longer has.
  while (cut.kerf.length > 1 && cut.kerf[cut.kerf.length - 1].s > cut.s) cut.kerf.pop();
  cut.combo = 0;
  cut.tier = 0;
  cut.streak = 0;
  game.streakStep = 0;
  game.heat = 0;
  game.flex = 0;
  game.flexVel = 0;
  game.continueUsed = true;
  game.state = 'playing';
  countIn(3, 'resume');
  input.reset();
  SDK.gameplayStart();
}

// 3 - 2 - 1 - GO. Also used when resuming from the pause menu mid-cut, which has
// exactly the same problem: the board is moving the instant the menu closes.
function countIn(seconds = 3, reason = 'start') {
  game.countT = seconds + 0.75;      // the tail is the "GO"
  game.countStep = -1;
  game.countReason = reason;         // drives the sub-label; see drawCountIn
}

function toast(msg) {
  game.toast = msg;
  game.toastT = 2.4;
}

// --- Update ----------------------------------------------------------------

function update(dt) {
  game.time += dt;
  FX.updateFx(fx, dt);
  if (game.toastT > 0) game.toastT -= dt;
  if (game.punch) {
    game.punch.t -= dt * 4;
    if (game.punch.t <= 0) game.punch = null;
  }

  if (game.state === 'playing' && game.briefing) {
    // Briefing card up: everything is held exactly as it is for the count-in, but the
    // clock does not run — only the player's tap moves things on.
    game.briefing.t += dt;
    input.take(dt);
    input.reset();
    // Silent until the card is dismissed: the saw spinning up behind a card the
    // player has not read yet sounded like the cut had started without them.
    A.updateSaw(false, 0, 0);
  } else if (game.state === 'playing' && game.countT > 0) {
    // Counting in: the board is held still and steering is discarded, so the
    // player cannot be blamed for a drift they did not make.
    game.countT -= dt;
    input.take(dt);
    input.reset();
    const step = Math.ceil(game.countT - 0.75);
    if (step !== game.countStep) {
      game.countStep = step;
      if (step > 0) A.thunk(300 + (3 - step) * 80, 0.2, 0.14);
      else A.chime(6);
    }
    A.updateSaw(true, 0, 0.2);
    if (game.countT <= 0) { game.countT = 0; input.reset(); }
  } else if (game.state === 'playing') {
    let steer = input.take(dt);
    // The base direction was flipped in save v10 (owner, 2026-09-28): by default a
    // drag moves the saw across the board rather than the board under the saw. Old
    // saves had their invert flag flipped on load so they steer exactly as before.
    if (!meta.settings.invert) steer = -steer;
    if (Math.abs(steer) > 0.5) game.hasSteered = true;
    if (game.hintT > 0) game.hintT -= dt * (game.hasSteered ? 3 : 1);

    const cut = game.cut;
    const mat = game.level.material;
    const before = cut.band;
    const wasOffBoard = cut.offBoard;

    // `speedScale` used to be driven by the Slow-Mo consumable. The consumables are
    // gone (see meta.js), so the board always feeds at its own rate; the parameter
    // stays because stepCut takes it and the jump mechanic will want it.
    stepCut(cut, dt, steer, 1);

    const tol = cut.tol;
    const err01 = clamp(Math.abs(cut.err) / (tol * 3), 0, 1);
    // The saw idles while it is over a hole — it is running, but not cutting.
    A.updateSaw(true, cut.air >= 0 ? 0 : err01,
      cut.air >= 0 ? 0 : clamp((game.level.speed - 200) / 240, 0, 1));

    // Blade flex: a spring chasing the steering input, so the blade visibly leans and
    // whips back instead of teleporting with the plank.
    const target = clamp(steer / dt / 900, -1, 1);
    game.flexVel += (target - game.flex) * 240 * dt;
    game.flexVel *= Math.pow(0.0009, dt);
    game.flex = clamp(game.flex + game.flexVel * dt, -1.4, 1.4);

    // Blade heat builds while off the line and bleeds off when back on it.
    const heatTarget = cut.air >= 0 ? 0 : cut.band === 'off' ? 1 : cut.band === 'ok' ? 0.35 : 0;
    game.heat += (heatTarget - game.heat) * (cut.band === 'off' ? 2.2 : 1.1) * dt;

    const bx = L.cx, by = L.bladeY;
    // Over a hole in a jump board there is nothing under the blade, so nothing may
    // come off it: no spray, no cutting note, no heat. A blade throwing sawdust into
    // a hole is the single loudest tell that the hole is not really there.
    const airborne = cut.air >= 0;

    // Continuous spray is light; corners are where the drama is.
    const rate = cut.band === 'off' ? 3 : 1;
    if (airborne) { /* nothing to cut */ }
    else if (mat.kind === 'ice') FX.iceShards(fx, bx, by, rate);
    else if (mat.kind === 'metal') FX.sparks(fx, bx, by, rate);
    else FX.sawdust(fx, bx, by, rate, mat.dust, err01);

    drainEvents(cut, mat, bx, by);

    if (cut.band === 'off') {
      if (Math.random() < 0.35) FX.sparks(fx, bx, by, 3);
      FX.shake(fx, 26 * dt);
      if (before !== 'off') A.splinter();
    }

    // Leaving the board entirely is a much bigger event than drifting off the line.
    if (cut.offBoard) {
      FX.shake(fx, 90 * dt);
      if (!wasOffBoard) {
        FX.dustBurst(fx, bx, by, Math.sign(cut.err) || 1, mat.dust, 1);
        FX.sparks(fx, bx, by, 26);
        FX.popText(fx, 'OFF THE BOARD!', L.cx, L.bladeY - 250, '#ff7a5c', 46);
        A.splinter();
        A.failSound();
        FX.shake(fx, 22);
      }
    }

    // Rising chime ladder while the cut stays dead-on.
    const step = Math.floor(cut.streak / 0.85);
    if (cut.band === 'perfect' && step > game.streakStep) {
      game.streakStep = step;
      A.chime(step);
    } else if (cut.band !== 'perfect') {
      game.streakStep = Math.min(game.streakStep, Math.floor(cut.streak / 0.85));
    }

    // Gold sparkles are EARNED by holding a long perfect streak — never purchased.
    if (cut.streak > 3) {
      game.sparkleT -= dt;
      if (game.sparkleT <= 0) {
        game.sparkleT = 0.05;
        FX.goldSparkle(fx, bx, by, 2 + Math.floor(clamp(cut.streak / 3, 0, 3)));
      }
    }

    if (cut.done) finishLevel();
  } else {
    A.updateSaw(false, 0, 0);
    game.heat += (0 - game.heat) * 1.6 * dt;
    game.flex *= Math.pow(0.002, dt);
  }

  if (game.state === 'complete') {
    const before = game.resultT;
    game.resultT += dt;
    game.splitT = Math.min(1, game.splitT + dt * 1.3);
    const acc0 = accuracy(game.cut);
    // FLAWLESS is the one tier the craft bonus cannot reach — it is scored on the cut
    // itself, at full accuracy, and nothing optional on the board can buy it.
    const flawless = isFlawless(acc0);
    // A flawless cut lands a FOURTH star, in purple. Three gold stars is the ceiling
    // of the normal scale, so the reward for a perfect cut has to sit outside it.
    const slots = starsFor(cutScore(game.cut)) + (flawless ? 1 : 0);
    const shouldShow = clamp(Math.floor((game.resultT - 0.5) / 0.26), 0, slots);
    while (game.starsShown < shouldShow) {
      game.starsShown++;
      const isPurple = flawless && game.starsShown === 4;
      const sx = starSlotX(game.starsShown - 1, flawless);
      const sy = resultStarY();

      if (isPurple) {
        // The flawless beat: a real explosion, not another star chime. Everything
        // here is bigger than the gold star's landing on purpose — the player has to
        // FEEL that this was a different result.
        A.bigFanfare();
        FX.shake(fx, 22);
        FX.flash(fx, 0.55, '210,150,255');
        FX.ring(fx, sx, sy, 'rgba(198,110,255,0.95)', { to: 520, life: 0.85, width: 20 });
        FX.ring(fx, sx, sy, 'rgba(255,240,255,0.9)', { to: 300, life: 0.55, width: 12 });
        FX.ring(fx, L.cx, sy, 'rgba(242,194,48,0.8)', { to: 760, life: 1.1, width: 8 });
        FX.confetti(fx, L.cx, sy, 190);
        FX.goldSparkle(fx, sx, sy, 70);
        FX.sparks(fx, sx, sy, 60);
        // A second wave a beat later, so the celebration has a shape instead of
        // being one frame of everything at once.
        game.flawlessEcho = 0.34;
      } else {
        A.starLand(Math.max(0, game.starsShown - 1));
        FX.shake(fx, 5);
        // Each star lands with a shockwave and a spray, so three stars is three
        // distinct impacts instead of three icons fading up.
        FX.ring(fx, sx, sy, 'rgba(255,214,80,0.95)', { to: 130, life: 0.45, width: 8 });
        FX.goldSparkle(fx, sx, sy, 16);
        FX.flash(fx, 0.18, '255,224,150');
        if (game.starsShown === 3) {
          FX.confetti(fx, L.cx, sy, 70);
          FX.ring(fx, L.cx, sy, 'rgba(242,194,48,0.9)', { to: 320, life: 0.7, width: 10 });
        }
      }
    }

    // Second wave of the flawless burst.
    if (game.flawlessEcho > 0) {
      game.flawlessEcho -= dt;
      if (game.flawlessEcho <= 0) {
        const sy = resultStarY();
        FX.confetti(fx, L.cx, sy + 40, 120);
        FX.ring(fx, L.cx, sy, 'rgba(198,110,255,0.7)', { to: 640, life: 0.9, width: 14 });
        FX.goldSparkle(fx, L.cx, sy, 40);
        FX.shake(fx, 9);
      }
    }
    // The coin total ticks up audibly; each row landing gets its own blip.
    if (game.resultT > 0.95) {
      const hit = FX.updateRoll(game.coinRoll, dt);
      if (hit) A.coinCollect(4);
      else if (game.coinRoll.shown < game.coinRoll.target
               && Math.floor(before * 22) !== Math.floor(game.resultT * 22)) {
        A.coinCollect(arriveN++);
      }
    }
    const rowCount = rowsForResult();
    const nextRow = 1.05 + game.rowsIn * 0.16;
    if (game.rowsIn < rowCount && game.resultT >= nextRow) {
      game.rowsIn++;
      A.thunk(600 + game.rowsIn * 70, 0.14, 0.07);
    }
  }
  if (game.state === 'failed') game.resultT += dt;

  if (game.state === 'workshop' || game.state === 'upgrades') {
    game.wsIntro = Math.min(1.4, game.wsIntro + dt * 1.9);
  }
  if (game.state === 'build') {
    BUILD.updateBuild(game.build, dt, L);
  }
  if (game.state === 'chest' && game.chestScene) {
    CHEST.updateChest(game.chestScene, dt);
  }
  if (game.state === 'home' || game.state === 'endless') updateHomeBoard(dt);
}

// The stars' y in the results panel, needed by update() to place their impact rings.
// Kept in one place so the panel layout and the effects can't drift apart.
// Where each star sits. A flawless cut shows four (three gold + the purple one), so
// the row has to re-centre; keeping this in one function is what stops the drawn stars
// and their impact rings landing in different places.
function starSlotX(i, flawless) {
  const n = flawless ? 4 : 3;
  const gap = flawless ? 92 : 104;
  return L.cx + (i - (n - 1) / 2) * gap;
}

function resultStarY() {
  const rows = rowsForResult();
  const pw = R.STAGE_W - 116;
  const pad = 34;
  // Must match drawComplete's bodyH term for term. It was missing the accuracy line and
  // meter (+64 +20), which put every star's impact ring 42px below its star.
  const bodyH = 88 + (resultSubtitle() ? 30 : 0) + 130 + 64 + 20 + 46 + rows * 34 + 60;
  const chests = game.pendingChests;
  const showDouble = SDK.adsUsable() && !game.doubled;
  const btnH = (chests > 0 ? 96 : 0) + (showDouble ? 92 : 0) + 94 + 66;
  const ph = pad + bodyH + btnH + pad;
  const py = Math.max(40, (L.h - ph) / 2 - 30);
  return py + pad + 88 + (resultSubtitle() ? 30 : 0) + 62;
}

// One line of context under the title, for the two results the stars cannot express:
// how long the endless run is, and the campaign being finished. Returned rather than
// drawn so the panel's height and its contents are computed from the same source.
function resultSubtitle() {
  if (game.justUnlockedEndless) return `All ${LEVEL_COUNT} boards cut \u2014 ENDLESS UNLOCKED`;
  const r = game.endlessRun;
  if (!r) return null;
  return `${ENDLESS_SPEEDS[r.speed].name} \u00b7 ${ENDLESS_LINES[r.line].name}`
    + ` \u00b7 board ${r.board}`
    + (r.best > 0 && r.board > r.best ? '  \u2014 RECORD' : '');
}

function rowsForResult() {
  const rw = game.reward;
  if (!rw) return 1;
  return 1 + (rw.combo > 0 ? 1 : 0) + (rw.objects > 0 ? 1 : 0)
    + (rw.precision > 0 ? 1 : 0) + (rw.ledger > 0 ? 1 : 0) + (rw.risk > 0 ? 1 : 0);
}

// Everything interesting that happened this tick is queued by plank.js and turned
// into sound and particles here, so the simulation stays free of presentation.
function drainEvents(cut, mat, bx, by) {
  for (const ev of cut.events) {
    if (ev.type === 'comboUp') {
      const tier = COMBO_TIERS[ev.tier];
      A.comboUp(ev.tier);
      FX.popText(fx, `${tier.label}  ${tier.mult}x`, L.cx, L.bladeY - 250, mat.line, 50);
      FX.goldSparkle(fx, bx, by, 18);
      FX.shake(fx, 5);
    } else if (ev.type === 'comboLost') {
      if (ev.tier >= 2) {
        A.comboLost();
        FX.popText(fx, 'COMBO LOST', L.cx, L.bladeY - 200, '#ff8a6a', 34);
      }
    } else if (ev.type === 'corner') {
      FX.dustBurst(fx, bx, by, ev.dir, mat.dust, ev.power);
      if (mat.kind === 'metal') FX.sparks(fx, bx, by, 12);
      FX.shake(fx, 3 + ev.power * 5);
      if (ev.perfect) {
        // Nailing a hard turn yields a key — a currency separate from stars.
        meta.keys++;
        A.perfectTurn();
        FX.popText(fx, 'PERFECT TURN!', L.cx, L.bladeY - 310, '#ffe14d', 44);
        FX.goldSparkle(fx, bx, by, 30);
        FX.shake(fx, 9);
        if (meta.keys >= 3) {
          meta.keys = 0;
          game.chests++;
          A.keyChime();
          FX.popText(fx, 'TREASURE KEY SET!', L.cx, L.bladeY - 380, '#ffd23f', 40);
        }
      } else {
        A.thunk(180 + ev.power * 120, 0.10 + ev.power * 0.10, 0.14);
      }
    } else if (ev.type === 'jump') {
      if (!ev.ok) {
        // Never jumped. The blade lands on the new piece wherever it happened to be,
        // which is punishment enough — this just names what went wrong.
        A.comboLost();
        FX.popText(fx, 'MISSED THE JUMP', L.cx, L.bladeY - 170, '#ff9a6a', 40);
        FX.shake(fx, 9);
      } else if (ev.perfect) {
        A.perfectTurn();
        A.chime(9);
        FX.confetti(fx, bx, by, 26);
        FX.popText(fx, `PERFECT JUMP  +${JUMP_BONUS}`, L.cx, L.bladeY - 190, '#8fffcf', 44);
        FX.shake(fx, 6);
      } else {
        A.thunk(190, 0.14, 0.2);
        FX.dustBurst(fx, bx, by, Math.sign(cut.jumpTo - cut.jumpFrom) || 1, mat.dust, 0.7);
      }
    } else if (ev.type === 'object') {
      if (ev.hit) {
        A.objectHit();
        FX.confetti(fx, bx, by, 34);
        FX.popText(fx, `+${OBJECT_BONUS}`, L.cx, L.bladeY - 190, '#ffe9a8', 44);
        FX.shake(fx, 7);
      } else {
        A.thunk(140, 0.12, 0.18);
        FX.dustBurst(fx, bx, by, Math.sign(cut.err) || 1, mat.dust, 0.5);
      }
    }
  }
  cut.events.length = 0;
}

// --- Buttons ---------------------------------------------------------------

function button(id, x, y, w, h, label, style, sub, opts) {
  const b = { id, x, y, w, h, label, style, sub, ...(opts || {}) };
  game.buttons.push(b);
  return b;
}

function drawButton(b) {
  const pressed = game.pressed === b.id;
  const y = b.y + (pressed ? 3 : 0);
  // `pop` lets a caller stagger buttons in; `punch` is set briefly after a purchase
  // so the button the player just hit visibly recoils.
  const pop = b.pop ?? 1;
  const punch = (game.punch && game.punch.id === b.id) ? game.punch.t : 0;
  if (pop < 0.999 || punch > 0) {
    const sc = (0.72 + 0.28 * easeOutBack(clamp(pop, 0, 1))) * (1 + punch * 0.10);
    ctx.save();
    ctx.globalAlpha = clamp(pop * 1.5, 0, 1);
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.scale(sc, sc);
    ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    drawButtonBody(b, y, pressed);
    ctx.restore();
    return;
  }
  drawButtonBody(b, y, pressed);
}

// --- Volume sliders ----------------------------------------------------------
// The track sits right of the label. Shared by drawing and by the drag handler so
// the knob is always under the finger.
function sliderTrack(b) {
  const x0 = b.x + Math.min(122, b.w * 0.40);
  return { x0, x1: b.x + b.w - 24 };
}

// A masking-tape label and a steel rule with a brass slider, on a small board.
function drawSlider(b) {
  const { x0, x1 } = sliderTrack(b);
  const v = clamp(b.value, 0, 1);
  const cy = b.y + b.h / 2;
  const active = game.slider === b.id;
  UI.boardPanel(ctx, b.x, b.y, b.w, b.h, { screws: false, seed: b.id.length * 977 });
  ctx.save();
  if (b.muted) ctx.globalAlpha = 0.6;
  const tw = x0 - b.x - 14;
  UI.tape(ctx, b.x + 10 + tw / 2, cy, tw, Math.min(38, b.h - 24), -0.03, b.label,
    { size: Math.min(22, Math.round(b.h * 0.3)), seed: b.id.length * 31 });
  UI.rulerSlider(ctx, x0, x1, cy, v, active);
  ctx.restore();
}

let sliderPreviewT = 0;
function setSliderFrom(b, px) {
  const { x0, x1 } = sliderTrack(b);
  const v = Math.round(clamp((px - x0) / (x1 - x0), 0, 1) * 20) / 20;
  if (meta.settings[b.slider] === v) return;
  meta.settings[b.slider] = v;
  b.value = v;
  // Touching a volume slider is an unambiguous "I want sound", so it lifts a mute.
  if (meta.settings.muted) { meta.settings.muted = false; A.setMuted(false); }
  A.setVolumes(meta.settings.sfxVol, meta.settings.musicVol);
  // Let the player HEAR the effects level while they drag it.
  if (b.slider === 'sfxVol' && performance.now() - sliderPreviewT > 90) {
    sliderPreviewT = performance.now();
    A.uiClick(0.8 + v * 0.5);
  }
}

function drawButtonBody(b, y, pressed) {
  if (b.slider) { drawSlider(b); return; }
  // Used by grids that draw their own cells and only want the hit box.
  if (b.style === 'invisible') {
    if (pressed) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      R.roundRect(ctx, b.x, b.y, b.w, b.h, 20);
      ctx.fill();
      ctx.restore();
    }
    return;
  }
  // Workshop-material blocks (ui.js) — painted or raw plywood, stencilled. The old
  // glossy gradient pill with a white highlight strip was the loudest "AI-made" tell.
  const c = UI.drawBlock(ctx, b, pressed, fitFontOn, (g, cx, cy, col) => {
    if (b.icon === 'gear') drawGear(g, cx, cy, col);
    else drawSpeaker(g, cx, cy, b.icon === 'muted', col);
  });
  if (b.coin && c.coinAt) R.drawCoin(ctx, b.x + c.coinAt.x, b.y + c.coinAt.y + (pressed ? 6 : 0), 15);
}

// Sets the largest font size at or below `size` that fits `text` into `max` px.
//
// Buttons used to draw their label at a fixed size regardless of how wide the button
// was, so any label longer than its button simply ran out over the card behind it —
// "UPGRADES" spilled across the copy beside it, and a rewarded sub-label ("Watch a
// short ad") was wider than the button it sat in. A caller cannot be expected to
// re-measure every string in every language, so the button fits its own text.
function fitFontOn(g, text, max, size, weight, family = UI.FAMILY.body) {
  let px = size;
  const f = (n) => (family === UI.FAMILY.stencil ? UI.F.stencil(n)
    : `${weight} ${n}px ${family}, system-ui, sans-serif`);
  g.font = f(px);
  while (px > 11 && g.measureText(text).width > max) {
    px -= 1;
    g.font = f(px);
  }
  return px;
}

function fitFont(text, max, size, weight) {
  let px = size;
  ctx.font = `${weight} ${px}px CisBody, system-ui, sans-serif`;
  while (px > 11 && ctx.measureText(text).width > max) {
    px -= 1;
    ctx.font = `${weight} ${px}px CisBody, system-ui, sans-serif`;
  }
  return px;
}

function drawGear(ctx, cx, cy, colour = '#f3e9d2') {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = colour;
  const teeth = 8, ro = 15, ri = 10.5;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (Math.PI / teeth) * i - Math.PI / 2;
    const r = i % 2 === 0 ? ro : ri;
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  // The hub hole is part of the same path, filled even-odd — NOT punched out with
  // destination-out, which would erase whatever the gear is drawn on.
  ctx.moveTo(5.4, 0);
  ctx.arc(0, 0, 5.4, 0, 6.2832, true);
  ctx.fill('evenodd');
  ctx.restore();
}

function drawSpeaker(ctx, cx, cy, muted, colour = '#f3e9d2') {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(-11, -5); ctx.lineTo(-4, -5); ctx.lineTo(3, -12);
  ctx.lineTo(3, 12); ctx.lineTo(-4, 5); ctx.lineTo(-11, 5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  if (muted) {
    ctx.beginPath();
    ctx.moveTo(8, -7); ctx.lineTo(17, 7);
    ctx.moveTo(17, -7); ctx.lineTo(8, 7);
    ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(4, 0, 8, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(4, 0, 13, -0.9, 0.9); ctx.stroke();
  }
  ctx.restore();
}

function hitButton(p) {
  for (let i = game.buttons.length - 1; i >= 0; i--) {
    const b = game.buttons[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
  }
  return null;
}

// Screens a button can take the player to: those get a swish as well as the click.
const NAV_IDS = /^(menu-|home-|open-menu|resume|levels-back|next|retry|workshop|build-|.*-back$)/;

function onTap(b) {
  if (!b) return;
  if (b.slider) return;   // sliders are dragged, handled in the pointer listeners
  if (b.style === 'locked') A.denied();
  else A.uiClick(b.style === 'primary' || b.style === 'reward' ? 1.12 : 1);
  if (NAV_IDS.test(b.id)) A.whoosh();
  switch (b.id) {
    case 'next': nextLevel(); break;
    case 'brief-go': dismissBriefing(); break;
    case 'build-next': BUILD.endShowcase(game.build, meta); break;
    case 'build-room-prev': BUILD.browseRoom(game.build, meta, -1); break;
    case 'build-room-next': BUILD.browseRoom(game.build, meta, 1); break;
    case 'build-room-current': BUILD.viewCurrentRoom(game.build); break;
    case 'retry': retryLevel(); break;
    case 'double':
      runAd(SDK.showRewardedAd, () => {
        meta.coins += game.earned;
        game.doubled = true;
        FX.confetti(fx, L.cx, L.h * 0.42, 60);
        A.fanfare();
        save();
      }, () => toast('Ad unavailable — coins kept'));
      break;
    case 'continue-ad':
      runAd(SDK.showRewardedAd, () => doContinue(),
        () => toast('Ad unavailable — try again'));
      break;
    case 'continue-coins':
      if (meta.coins >= CONTINUE_COST) {
        meta.coins -= CONTINUE_COST;
        save();
        doContinue();
      }
      break;
    case 'mute':
      A.setMuted(!A.isMuted());
      meta.settings.muted = A.isMuted();
      save();
      break;

    // --- Workshop
    case 'workshop':
      game.wsReturn = 'complete';
      game.state = 'workshop';
      game.scroll = 0;
      game.wsIntro = 0;
      break;
    case 'close-workshop':
      // BACK has to return to whichever screen opened the Workshop. It used to always
      // go to the results panel, which does not exist when the Workshop was opened
      // from the main menu.
      game.state = game.wsReturn || 'complete';
      break;

    // --- Saw upgrades
    case 'open-upgrades':
      game.upReturn = 'workshop';
      game.wsReturn = game.wsReturn || 'complete';
      game.state = 'upgrades';
      game.scroll = 0;
      game.wsIntro = 0;
      break;
    case 'menu-upgrades':
      game.upReturn = game.state === 'home' ? 'home' : 'menu';
      game.state = 'upgrades';
      game.scroll = 0;
      game.wsIntro = 0;
      break;
    case 'upgrades-back':
      game.state = game.upReturn || 'workshop';
      game.scroll = 0;
      game.wsIntro = 0;
      break;

    // --- Build screen
    case 'open-build':
      BUILD.ensureProject(game.build, meta, L);
      BUILD.viewCurrentRoom(game.build);
      game.build.idle = 0;
      game.buildReturn = 'workshop';
      game.state = 'build';
      break;
    case 'close-build':
      game.state = game.buildReturn || 'workshop';
      game.wsIntro = 0;
      break;
    case 'buy-part': {
      const proj = META.currentProject(meta);
      const index = meta.partsBought;
      const cost = META.nextPart(meta)?.cost || 0;
      // Synced BEFORE the purchase, never after: buying the last part advances the meta
      // to the next kitchen, and syncing after it is what swapped the screen to the
      // empty next room before the finished one could be shown off.
      if (game.state === 'build') BUILD.ensureProject(game.build, meta, L);
      const r = META.buyPart(meta);
      if (!r) { toast('Not enough coins'); A.denied(); break; }
      game.punch = { id: 'buy-part', t: 1 };
      // Coins physically leave the counter and fly into the model. Spending should
      // look like spending.
      const fy = L.h - 224 - view.safeBottom;
      FX.flight(fx, 62, fy + 22, L.cx, L.h * 0.42, {
        count: Math.min(14, 5 + Math.floor(cost / 400)), stagger: 0.035, dur: 0.46, r: 13,
      });
      A.purchase();
      // If we're on the Build screen the part physically drops onto the model.
      if (game.state === 'build') {
        BUILD.playPart(game.build, index);
        setTimeout(() => {
          FX.shake(fx, 12);
          FX.ring(fx, L.cx, L.h * 0.46, 'rgba(255,214,120,0.9)', { to: 260, life: 0.5, width: 9 });
          A.thunk(220, 0.34, 0.26);
        }, 620);
      }
      FX.popText(fx, `${r.part.name.toUpperCase()} FITTED`, L.cx, L.h * 0.30, '#8fe87c', 40);
      FX.confetti(fx, L.cx, L.h * 0.36, 44);
      FX.flash(fx, 0.22, '160,255,190');
      A.fanfare();
      if (r.projectComplete) {
        FX.popText(fx, `${r.projectComplete.name.toUpperCase()} BUILT!`, L.cx, L.h * 0.22, '#63e08a', 46);
        FX.confetti(fx, L.cx, L.h * 0.34, 140);
        FX.flash(fx, 0.4, '190,255,210');
        BUILD.celebrate(game.build);
        SDK.happytime();
        // The finished kitchen stays on screen until the player taps NEXT KITCHEN —
        // see `showcase` in build.js.
      }
      save();
      break;
    }

    // --- Chests. Both sources route through the same ceremony.
    case 'open-chest': {
      const roll = META.rollStarChest(meta);
      if (!roll) break;
      openChest(
        [
          { kind: 'coins', amount: `+${roll.coins}`, label: 'coins', colour: '#ffd23f' },
          { kind: 'key', amount: `x${roll.keys}`, label: roll.keys === 1 ? 'key' : 'keys', colour: '#f2c230' },
        ],
        'STAR CHEST',
        'workshop',
        () => { META.awardStarChest(meta, roll); save(); },
      );
      break;
    }
    // The daily free chest. Rewarded where ads exist, free where they do not —
    // Basic Launch disables ads for the whole 7-21 day window in which D1 retention
    // is measured, so gating this behind an ad would switch off the return hook
    // during exactly the review that judges it.
    case 'daily-chest': {
      const roll = META.rollDailyChest(meta);
      if (!roll) { toast('Come back tomorrow'); break; }
      // Captured NOW: runAd puts the game into the `ad` state before the handler
      // runs, so reading game.state inside show() would always miss the menu.
      const back = game.state === 'menu' ? 'menu'
        : game.state === 'home' ? 'home' : 'workshop';
      const show = () => {
        openChest(
          [
            { kind: 'coins', amount: `+${roll.coins}`, label: 'coins', colour: '#ffd23f' },
            { kind: 'key', amount: `x${roll.keys}`, label: roll.keys === 1 ? 'key' : 'keys', colour: '#f2c230' },
          ],
          'DAILY CHEST',
          back,
          () => { META.awardDailyChest(meta, roll); save(); },
        );
      };
      if (SDK.adsUsable()) {
        // Never reward on adError: the chest is not consumed, so the day's claim is
        // still there to try again.
        runAd(SDK.showRewardedAd, show, () => toast('Ad unavailable — try again'));
      } else {
        show();
      }
      break;
    }
    case 'open-run-chest': {
      const n = game.pendingChests;
      if (n <= 0) break;
      const coins = n * 200;
      openChest(
        [{ kind: 'coins', amount: `+${coins}`, label: n > 1 ? `${n} chests` : 'coins', colour: '#ffd23f' }],
        n > 1 ? `${n} TREASURE CHESTS` : 'TREASURE CHEST',
        'complete',
        () => {
          meta.coins += coins;
          game.earned += coins;
          game.pendingChests = 0;
          if (game.reward) { game.reward.chest = coins; game.reward.total += coins; }
          FX.setRoll(game.coinRoll, game.earned, { rate: coins * 2 });
          save();
        },
      );
      break;
    }
    case 'chest-collect': {
      const S = game.chestScene;
      if (!S || !CHEST.chestReadyToCollect(S)) break;
      game.chestOnCollect?.();
      game.chestOnCollect = null;
      // The loot flies to the coin counter, so the balance visibly grows.
      FX.flight(fx, L.cx, L.h * 0.42, L.cx, 120, { count: 12, stagger: 0.03, dur: 0.5, r: 15 });
      A.coinBlip(5);
      game.state = game.chestReturn;
      game.chestScene = null;
      break;
    }

    // --- Main menu
    case 'home-play':
      // One tap from launch to cutting. Resumes the level the player was on rather
      // than asking them to pick anything.
      A.chime(5);
      startLevel(clamp(game.levelNum, 1, LEVEL_COUNT));
      break;
    case 'menu-home':
      goHome();
      break;
    case 'home-endless':
      if (!META.endlessUnlocked(meta)) {
        toast(`Finish all ${LEVEL_COUNT} levels to unlock Endless`);
        A.denied();
        break;
      }
      if (game.endlessRun) endEndlessRun();
      game.endlessSel = { speed: meta.endless.speed | 0, line: meta.endless.line | 0 };
      game.endlessOver = null;
      game.state = 'endless';
      SDK.gameplayStop();
      A.chime(5);
      break;
    case 'endless-back':
      goHome();
      break;
    case 'endless-start':
      A.chime(6);
      startEndlessRun();
      break;
    case 'end-run': {
      const r = endEndlessRun();
      if (r) toast(r.record ? `New record — ${r.boards} boards!` : `${r.boards} boards cut`);
      goHome();
      break;
    }

    // --- Pause menu
    case 'open-menu':
      game.menuReturn = game.state;
      game.state = 'menu';
      if (game.state === 'menu' && game.menuReturn === 'playing') SDK.gameplayStop();
      break;
    case 'resume':
      game.state = game.menuReturn === 'menu' ? 'playing' : game.menuReturn;
      if (game.state === 'playing') { input.reset(); countIn(3, 'resume'); SDK.gameplayStart(); }
      break;
    case 'menu-workshop':
      game.wsReturn = game.state === 'home' ? 'home' : 'menu';
      game.state = 'workshop';
      game.scroll = 0;
      game.wsIntro = 0;
      break;
    case 'menu-build':
      BUILD.ensureProject(game.build, meta, L);
      BUILD.viewCurrentRoom(game.build);
      game.build.intro = 0;
      game.build.idle = 0;
      game.buildReturn = game.state === 'home' ? 'home' : 'menu';
      game.state = 'build';
      break;
    case 'menu-levels':
      // Reachable from the pause menu, the Workshop and the results panel, so BACK
      // has to return to whichever one opened it rather than always to the menu.
      game.levelsReturn = game.state;
      game.state = 'levels';
      game.lvScroll = 0;
      break;
    case 'levels-back':
      game.state = game.levelsReturn || 'menu';
      break;
    case 'menu-sound': {
      const m = !A.isMuted();
      A.setMuted(m);
      meta.settings.muted = m;
      save();
      break;
    }

    // --- Settings
    case 'dev-reset':
      resetProgress();
      break;
    case 'toggle-invert':
      meta.settings.invert = !meta.settings.invert;
      A.chime(meta.settings.invert ? 5 : 2);
      toast(meta.settings.invert ? 'Steering inverted' : 'Steering normal');
      save();
      break;
    case 'daily':
      startDaily();
      break;
    default:
      if (b.id.startsWith('buyup-')) {
        fitUpgrade(b.id.slice(6), b, false);
      } else if (b.id.startsWith('offup-')) {
        const id = b.id.slice(6);
        const on = META.toggleUpgrade(meta, id);
        if (on !== null) {
          game.punch = { id: b.id, t: 1 };
          A.chime(on ? 5 : 2);
          toast(`${META.UPGRADES[id].name} ${on ? 'switched on' : 'switched off'}`);
          save();
        }
      } else if (b.id.startsWith('adup-')) {
        const id = b.id.slice(5);
        // The reward is the fitting itself, so it is only granted on adFinished.
        runAd(SDK.showRewardedAd, () => fitUpgrade(id, b, true),
          () => toast('Ad unavailable — coins kept'));
      } else if (b.id.startsWith('claim-')) {
        const q = meta.quests[+b.id.slice(6)];
        if (q && !q.claimed && META.questDone(meta, q)) {
          q.claimed = true;
          meta.coins += q.reward;
          game.punch = { id: b.id, t: 1 };
          A.fanfare();
          FX.confetti(fx, b.x + b.w / 2, b.y + b.h / 2, 50);
          FX.ring(fx, b.x + b.w / 2, b.y + b.h / 2, 'rgba(255,214,80,0.9)', { to: 200, life: 0.5, width: 7 });
          // Lands on the pinned counter, wherever the player has scrolled to.
          FX.flight(fx, b.x + b.w / 2, b.y + b.h / 2,
            R.STRIP_COIN_X, R.stripCoinY(view.safeTop),
            { count: 9, stagger: 0.035, dur: 0.5, r: 13, spread: 150 });
          FX.flash(fx, 0.2, '255,230,160');
          // Replace the board once every job is done.
          if (meta.quests.every((x) => x.claimed)) META.rollQuests(meta);
          save();
        }
      } else if (b.id.startsWith('esp-')) {
        game.endlessSel.speed = clamp(+b.id.slice(4), 0, ENDLESS_SPEEDS.length - 1);
        A.chime(3);
      } else if (b.id.startsWith('eln-')) {
        game.endlessSel.line = clamp(+b.id.slice(4), 0, ENDLESS_LINES.length - 1);
        A.chime(3);
      } else if (b.id.startsWith('level-')) {
        const n = +b.id.slice(6);
        if (n >= 1 && n <= game.maxLevel) {
          A.chime(4);
          startLevel(n);
        }
      }
      break;
  }
}

// Every chest in the game opens the same way: the player knocks the lock off it.
function openChest(loot, title, returnState, onCollect) {
  game.chestScene = CHEST.createChestScene(loot, title);
  game.chestReturn = returnState;
  game.chestOnCollect = onCollect;
  game.state = 'chest';
  A.thunk(220, 0.24, 0.3);
}

// Fitting a saw part. `free` is the rewarded-ad path: it takes whatever coins the
// player has toward the cost rather than handing the part over for nothing, so the ad
// finishes a purchase instead of replacing one.
function fitUpgrade(id, b, free) {
  const u = META.UPGRADES[id];
  const cost = META.upgradeCost(meta, id);
  if (cost == null) { toast('Already fully fitted'); return; }
  const r = META.buyUpgrade(meta, id, free);
  if (!r) { toast('Not enough coins'); A.denied(); return; }
  game.punch = { id: b.id, t: 1 };
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  // Coins leave the counter at the top of the screen and land on the part.
  if (!free) {
    FX.flight(fx, R.STRIP_COIN_X, R.stripCoinY(view.safeTop), cx, cy,
      { count: Math.min(14, 6 + Math.floor(cost / 400)), stagger: 0.035, dur: 0.46, r: 12 });
  }
  FX.ring(fx, cx, cy, u.colour, { to: 220, life: 0.5, width: 8 });
  FX.popText(fx, `${u.name.toUpperCase()} ${'I'.repeat(r.tier)}`, L.cx, cy - 70, u.colour, 38);
  FX.flash(fx, 0.18, '200,240,255');
  A.purchase();
  A.fanfare();
  // Name the mechanical effect, not the purchase — the player has to know what
  // changed about the cut.
  toast(u.effect(r.tier));
  save();
}

// Dev-only. Wipes the save and everything derived from it, so a fresh-install run
// can be tested without clearing browser storage by hand. Gated on isDev(), same as
// the ad skip, so it can never reach the hosted build.
function resetProgress() {
  if (!isDev()) return;
  SDK.clearData();
  Object.assign(meta, META.createMeta());
  META.rollQuests(meta);
  game.maxLevel = 1;
  game.levelNum = 1;
  game.chests = 0;
  game.pendingChests = 0;
  game.reward = null;
  game.build = BUILD.createBuild();
  game.scroll = 0;
  game.lvScroll = 0;
  A.setMuted(false);
  toast('Progress reset');
  A.thunk(180, 0.3, 0.3);
  // startLevel BEFORE save, not after. `save()` stamps `meta.levelNum = game.levelNum`,
  // so saving first wrote the level the player was ON back over the fresh meta — the
  // reset wiped their coins and handed their campaign position straight back on the
  // next reload, which is exactly what "reset doesn't work" looked like.
  startLevel(1);
  save();
}

// The console reset. Deliberately NOT the same path as the button: it clears both
// stores and reloads, so the next frame is a genuine cold boot rather than a live
// object graph that has been reassigned in place. That is what testing "what it is
// like to be a beginner" actually requires — first-run hints, first-run ad grace and
// all. Exposed under several names because the one thing a dev command must never do
// is make you go and look up what it was called.
function wipeProgress() {
  if (!isDev()) return 'refused: not a dev environment';
  SDK.clearData();   // clears BOTH stores; the key lives in sdk.js and only there
  location.reload();
  return 'progress wiped - reloading';
}


function startDaily() {
  // Date-seeded so everyone gets the same board, at a difficulty a bit above where
  // the player currently is.
  const seed = META.todayKey().split('-').reduce((a, b) => a * 31 + (+b), 7);
  game.daily = true;
  game.endlessRun = null;
  const lv = getLevel(Math.min(LEVEL_COUNT, Math.max(8, game.levelNum + 6)));
  lv.seed = seed;
  lv.isDaily = true;
  beginBoard(lv);
}


canvas.addEventListener('pointerdown', (e) => {
  const p = toStage(e.clientX, e.clientY);
  const b = hitButton(p);
  if (b && b.slider) {
    game.slider = b.id;
    game.pressed = null;
    setSliderFrom(b, p.x);
    return;
  }
  game.pressed = b ? b.id : null;
  // A tap anywhere on the board while the blade is over a hole is the jump. It fires
  // on pointerDOWN, not on release: it is a timing input, and waiting for the finger
  // to come up would cost the player a tenth of a second they were not told about.
  if (!b && game.state === 'playing' && game.countT <= 0 && game.cut) tryJump(game.cut);
  if (SCROLL_SCREENS.has(game.state)) game.dragScroll = { y: p.y, start: game.scroll, moved: 0 };
  if (game.state === 'levels') game.dragScroll = { y: p.y, start: game.lvScroll, moved: 0, lv: true };
});
canvas.addEventListener('pointermove', (e) => {
  if (game.slider) {
    const b = game.buttons.find((x) => x.id === game.slider);
    if (b) setSliderFrom(b, toStage(e.clientX, e.clientY).x);
    return;
  }
  if (!game.dragScroll) return;
  const p = toStage(e.clientX, e.clientY);
  const dy = p.y - game.dragScroll.y;
  game.dragScroll.moved = Math.max(game.dragScroll.moved, Math.abs(dy));
  if (game.dragScroll.lv) {
    game.lvScroll = clamp(game.dragScroll.start - dy, 0, game.lvScrollMax);
  } else {
    game.scroll = clamp(game.dragScroll.start - dy, 0, game.scrollMax);
  }
  // Once it's clearly a scroll, don't also fire the button under the finger.
  if (game.dragScroll.moved > 12) game.pressed = null;
});
const release = (e) => {
  if (game.slider) {
    game.slider = null;
    save();
    return;
  }
  // LIFTING the finger also jumps. Steering is a drag, so a player can easily be mid-
  // drag when a hole arrives, and "tap" then means lift-and-press — two actions inside
  // a one-second window. Either edge crosses the gap; `cut.jumped` makes sure only the
  // first one counts. Skipped when the press started on a button, which is a button.
  if (game.state === 'playing' && game.countT <= 0 && game.cut && !game.pressed) {
    tryJump(game.cut);
  }
  const dragged = game.dragScroll && game.dragScroll.moved > 12;
  game.dragScroll = null;

  // A tap anywhere on the chest screen is a whack on the lock — the player is the
  // one who gets it open, so the hit box is the whole screen, not a small button.
  if (game.state === 'chest' && game.chestScene && !game.pressed && !dragged) {
    hitChest();
    return;
  }
  if (!game.pressed || dragged) { game.pressed = null; return; }
  const b = hitButton(toStage(e.clientX, e.clientY));
  if (b && b.id === game.pressed) onTap(b);
  game.pressed = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', () => {
  if (game.slider) { game.slider = null; save(); }
  game.pressed = null;
  game.dragScroll = null;
});
canvas.addEventListener('wheel', (e) => {
  if (game.state === 'levels') {
    e.preventDefault();
    game.lvScroll = clamp(game.lvScroll + e.deltaY, 0, game.lvScrollMax);
    return;
  }
  if (!SCROLL_SCREENS.has(game.state)) return;
  e.preventDefault();
  game.scroll = clamp(game.scroll + e.deltaY, 0, game.scrollMax);
}, { passive: false });

function hitChest() {
  const S = game.chestScene;
  const r = CHEST.chestTap(S);
  if (!r) return;
  const cx = L.cx, cy = L.h * 0.42;
  if (r === 'hit') {
    A.thunk(150 + S.taps * 130, 0.34, 0.16);
    A.splinter();
    FX.shake(fx, 14);
    FX.ring(fx, cx, cy, 'rgba(255,214,120,0.85)', { to: 190, life: 0.4, width: 8 });
    FX.goldSparkle(fx, cx, cy, 18);
    FX.sparks(fx, cx, cy + 10, 16);
  } else {
    A.fanfare();
    A.keyChime();
    FX.shake(fx, 24);
    FX.flash(fx, 0.62, '255,226,150');
    FX.confetti(fx, cx, cy, 150);
    FX.goldSparkle(fx, cx, cy, 60);
    FX.ring(fx, cx, cy, 'rgba(255,232,150,0.95)', { to: 520, life: 0.85, width: 14 });
    FX.ring(fx, cx, cy, 'rgba(255,190,70,0.7)', { to: 380, life: 0.6, width: 9 });
  }
}

window.addEventListener('keydown', (e) => {
  // CrazyGames §4: Ctrl/Cmd+W must not close the tab while the game is fullscreen —
  // it is the reflex for "close" and would throw the run away with the tab.
  if (document.fullscreenElement && (e.ctrlKey || e.metaKey) && e.code === 'KeyW') {
    e.preventDefault();
    return;
  }
  if (e.code === 'Escape') {
    // Never preventDefault here, and never act on it while fullscreen: Escape is how
    // the player leaves fullscreen, and trapping it is an explicit CrazyGames
    // rejection trigger (§4). In fullscreen the keypress belongs to the browser and
    // the game must not also jump a screen backwards under the player.
    if (document.fullscreenElement) return;
    if (game.state === 'levels') game.state = game.levelsReturn || 'home';
    else if (game.state === 'build') game.state = game.buildReturn || 'workshop';
    else if (game.state === 'upgrades') onTap({ id: 'upgrades-back' });
    else if (game.state === 'workshop') onTap({ id: 'close-workshop' });
    else if (game.state === 'endless') goHome();
    else if (game.state === 'menu') onTap({ id: 'resume' });
    else if (game.state === 'playing') onTap({ id: 'open-menu' });
    return;
  }
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  e.preventDefault();
  if (game.state === 'playing' && game.briefing) { dismissBriefing(); return; }
  if (game.state === 'playing' && game.countT <= 0 && game.cut) { tryJump(game.cut); return; }
  if (game.state === 'chest' && game.chestScene) { hitChest(); return; }
  if (game.state === 'home') { onTap({ id: 'home-play' }); return; }
  if (game.state === 'complete') nextLevel();
  else if (game.state === 'failed') retryLevel();
});

// --- Draw ------------------------------------------------------------------

function draw() {
  game.buttons.length = 0;
  updateBanners();

  ctx.save();
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.scale, L.scale);

  // The Build and Chest screens are full takeovers: they draw their own world, so
  // the bench, plank, saw and HUD are skipped entirely rather than dimmed. A HUD
  // drawn underneath was showing through the chest's backdrop.
  const takeover = game.state === 'build' || game.state === 'chest'
    || game.state === 'levels' || game.state === 'home' || game.state === 'endless';
  if (takeover) {
    // The main menu and the endless picker draw the workshop behind themselves —
    // bench, table and saw, no board — so the first thing a player sees on launch is
    // the game, not a title card over a flat colour. All three are cached sprites.
    if (game.state === 'home' || game.state === 'endless') {
      const ws = game.level ? game.level.workshop : R.DEFAULT_WORKSHOP;
      R.drawBench(ctx, L, ws, game.time);
      R.drawSawTable(ctx, L, ws);
      R.drawBladeUnder(ctx, L, { t: game.time, running: true, flex: 0 });
      if (game.homeBoard) R.drawPlank(ctx, L, game.homeBoard.cut, 0);
      R.drawSawHead(ctx, L, {
        t: game.time, running: true, intensity: 0, flex: 0, heat: 0,
        band: 'perfect', cut: game.homeBoard ? game.homeBoard.cut : null,
      });
      if (game.state === 'home') {
        drawHomeMenu(ctx, L, meta, button, game.time, view, {
          levelNum: game.levelNum,
          maxLevel: game.maxLevel,
          endless: META.endlessUnlocked(meta),
          dailyChest: META.dailyChestReady(meta),
          adFree: !SDK.adsUsable(),
          dev: isDev(),
          campaignDone: META.endlessUnlocked(meta),
        });
      } else {
        drawEndlessSetup(ctx, L, meta, button, game.time, view, game.endlessSel);
      }
    } else if (game.state === 'build') drawBuildScreen();
    else if (game.state === 'levels') {
      game.lvScrollMax = Math.max(0, drawLevelSelect(
        ctx, L, meta, game.lvScroll, button, game.time, view, game.maxLevel,
        META.endlessUnlocked(meta)) - L.h + 40);
      game.lvScroll = clamp(game.lvScroll, 0, game.lvScrollMax);
    } else if (game.chestScene) CHEST.drawChestScene(ctx, L, game.chestScene, button, view);
    if (game.toastT > 0) drawToast();
    FX.drawFx(ctx, fx);
    FX.drawPops(ctx, fx);
    FX.drawMenuFx(ctx, fx, R.drawCoin, R.drawStar, R.drawKey, game.time);
    for (const b of game.buttons) drawButton(b);
    FX.drawFlash(ctx, fx, L.left, 0, L.right - L.left, L.h);
    ctx.restore();
    return;
  }

  const ws = game.level ? game.level.workshop : R.DEFAULT_WORKSHOP;
  R.drawBench(ctx, L, ws, game.time);

  ctx.save();
  if (fx.shake > 0.1) {
    ctx.translate(
      Math.sin(fx.shakeT * 91) * fx.shake,
      Math.cos(fx.shakeT * 77) * fx.shake * 0.7
    );
  }
  R.drawSawTable(ctx, L, ws);
  const sawOpts = {
    t: game.time,
    running: game.state === 'playing',
    intensity: game.cut ? clamp(Math.abs(game.cut.err) / (game.cut.tol * 3), 0, 1) : 0,
    flex: game.flex,
    heat: game.heat,
    band: game.cut ? game.cut.band : 'perfect',
    cut: game.cut,
  };
  // The blade passes THROUGH the board, so it is drawn in two passes either side of
  // the plank. See the comment above drawBladeUnder in render.js.
  R.drawBladeUnder(ctx, L, sawOpts);
  if (game.cut) R.drawPlank(ctx, L, game.cut, game.splitT);
  if (game.cut && game.state === 'playing' && !game.splitT) {
    R.drawJumpUi(ctx, L, game.cut, game.time);
  }
  R.drawSawHead(ctx, L, sawOpts);
  FX.drawFx(ctx, fx);
  ctx.restore();

  if (game.cut && !SCROLL_SCREENS.has(game.state)) {
    R.drawHud(ctx, L, {
      level: game.level,
      cut: game.cut,
      coins: meta.coins,
      safeTop: view.safeTop,
      acc: accuracy(game.cut),
      keys: meta.keys,
    });
    if (game.state === 'playing') {
      R.drawCombo(ctx, L, game.cut, comboMult(game.cut), game.time);
    }
  }

  // Pops belong to the play field, so they draw before any panel covers it.
  FX.drawPops(ctx, fx);

  if (game.state === 'playing') {
    if (game.hintT > 0) drawHint();
    if (game.briefing) drawBriefing();
    else if (game.countT > 0) drawCountIn();
  }
  if (game.state === 'complete') drawComplete();
  if (game.state === 'failed') drawFailed();
  if (game.state === 'ad') drawAdCover();
  if (game.state === 'workshop') {
    UI.pegboardWall(ctx, L.left, 0, L.right - L.left, L.h);
    game.scrollMax = Math.max(0, drawWorkshop(ctx, L, meta, game.scroll, button, game.time,
      game.wsIntro, !SDK.adsUsable(),
      game.wsReturn === 'home' ? 'BACK TO MENU' : 'BACK TO CUTTING',
      // + safeBottom: in the CrazyGames app (fullscreen) the last card must scroll
      // clear of the iPhone home bar, not stop under it.
      view.safeTop) - L.h + 40 + view.safeBottom);
    game.scroll = clamp(game.scroll, 0, game.scrollMax);
    R.drawCurrencyStrip(ctx, L, meta, game.time, view.safeTop);
  }
  if (game.state === 'upgrades') {
    UI.pegboardWall(ctx, L.left, 0, L.right - L.left, L.h);
    game.scrollMax = Math.max(0, drawUpgrades(
      ctx, L, meta, game.scroll, button, game.time, game.wsIntro, view.safeTop) - L.h + 40 + view.safeBottom);
    game.scroll = clamp(game.scroll, 0, game.scrollMax);
    R.drawCurrencyStrip(ctx, L, meta, game.time, view.safeTop);
  }
  if (game.state === 'menu') {
    drawPauseMenu(ctx, L, meta, button, game.time, view, game.menuReturn === 'playing', isDev(),
      META.dailyChestReady(meta), !SDK.adsUsable(), META.endlessUnlocked(meta));
  }

  if (!SCROLL_SCREENS.has(game.state) && game.state !== 'menu' && game.state !== 'ad') drawMenuButton();
  if (game.toastT > 0) drawToast();

  // Rings and flying coins sit above the panels but below the buttons, so a coin can
  // travel across a results card without hiding what the player is about to tap.
  FX.drawMenuFx(ctx, fx, R.drawCoin, R.drawStar, R.drawKey, game.time);

  for (const b of game.buttons) drawButton(b);

  FX.drawFlash(ctx, fx, L.left, 0, L.right - L.left, L.h);

  ctx.restore();
}

// Banner placement. Desktop only, in the letterbox gutters beside the 720-wide play
// column, and only on menu screens — never over gameplay. See §3 of the guidelines
// and the policy enforcement in sdk.js.
// Screens that are a scrolling column of cards, sharing game.scroll/scrollMax.
const SCROLL_SCREENS = new Set(['workshop', 'upgrades']);
const BANNER_SCREENS = new Set(['workshop', 'upgrades', 'levels', 'menu', 'build',
  'home', 'endless']);
let bannerVisible = false;

function updateBanners() {
  const want = !game.bannersOff && BANNER_SCREENS.has(game.state) && SDK.bannersAllowed();
  // Gutter width in CSS px either side of the play column.
  const gutter = L.ox;
  const fits = gutter >= 320 && view.ch >= 300;

  if (!want || !fits) {
    if (bannerVisible) { SDK.clearBanners(); bannerVisible = false; }
    return;
  }
  const w = 300, h = 250;
  const y = Math.round(view.ch / 2 - h / 2);
  // Centred in each gutter, so a banner can never sit under a button: every button
  // in the game is drawn inside the 720-wide column.
  SDK.showBanner('left', { x: Math.round((gutter - w) / 2), y }, [w, h]);
  SDK.showBanner('right', { x: Math.round(gutter + R.STAGE_W * L.scale + (gutter - w) / 2), y }, [w, h]);
  bannerVisible = true;
}

function drawBuildScreen() {
  BUILD.ensureProject(game.build, meta, L);
  BUILD.drawBuild(ctx, L, meta, game.build, button, game.time, view);
}

function drawHint() {
  const a = clamp(game.hintT / 1.2, 0, 1);
  const pulse = 0.5 + 0.5 * Math.sin(game.time * 4);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = L.h - 170 - view.safeBottom;

  UI.tape(ctx, L.cx, y, 300, 58, -0.02, 'DRAG TO STEER', { font: UI.F.stencil(40), ink: '#2a1a0c' });
  UI.tape(ctx, L.cx + 10, y + 50, 330, 38, 0.015, 'keep the saw on the blue line', { size: 20 });

  ctx.globalAlpha = a * (0.45 + pulse * 0.55);
  for (const dir of [-1, 1]) {
    const ax = L.cx + dir * (168 + pulse * 24);
    ctx.save();
    ctx.translate(ax, y);
    ctx.scale(dir, 1);
    ctx.fillStyle = '#7df0ff';
    ctx.beginPath();
    ctx.moveTo(30, 0); ctx.lineTo(-5, -26); ctx.lineTo(-5, 26);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// Stained plywood board, screwed at the corners (ui.js).
function panelBox(x, y, w, h) {
  UI.boardPanel(ctx, x, y, w, h);
}

function dim(color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(L.left, 0, L.right - L.left, L.h);
  ctx.restore();
}

function drawComplete() {
  const acc = accuracy(game.cut);
  const bonus = craftBonus(game.cut);
  const score = cutScore(game.cut);
  const stars = starsFor(score);
  const flawless = isFlawless(acc);
  const showDouble = SDK.adsUsable() && !game.doubled;
  const chests = game.pendingChests;

  const rw = game.reward
    || { base: game.earned, combo: 0, objects: 0, jumps: 0, precision: 0, ledger: 0, risk: 0, streak: 0, total: game.earned };
  const rows = [];
  rows.push(['Cut quality', rw.base, null]);
  if (rw.combo > 0) rows.push([`Combo  (peak ${COMBO_TIERS[game.cut.peakTier].mult}x)`, rw.combo, null]);
  if (rw.objects > 0) rows.push([`Odd finds  x${game.cut.objectsHit}`, rw.objects, null]);
  if (rw.jumps > 0) rows.push([`Perfect jumps  x${game.cut.perfectJumps}`, rw.jumps, null]);
  // Upgrade-sourced lines are named after the part that earned them, so a purchase
  // visibly pays out rather than quietly inflating a total.
  if (rw.risk > 0) {
    rows.push([`Endless  ${game.level.payMult.toFixed(2)}x`, rw.risk, null]);
  }
  if (rw.streak > 0) {
    rows.push([`Daily streak  ${meta.daily.streak} day${meta.daily.streak === 1 ? '' : 's'}`,
      rw.streak, null]);
  }
  if (rw.precision > 0) rows.push(['Micrometer Gauge', rw.precision, null]);
  if (rw.ledger > 0) rows.push(['Timber Ledger', rw.ledger, null]);

  const pw = R.STAGE_W - 116;
  const px = (R.STAGE_W - pw) / 2;
  const pad = 34;
  const sub = resultSubtitle();
  const bodyH = 88 + (sub ? 30 : 0) + 130 + 64 + 20 + 46 + rows.length * 34 + 60;
  const btnH = (chests > 0 ? 96 : 0) + (showDouble ? 92 : 0) + 94 + 66;
  const ph = pad + bodyH + btnH + pad;
  const py = Math.max(40, (L.h - ph) / 2 - 30);

  dim('rgba(0,0,0,0.42)');

  // The whole card springs in rather than cutting on. Everything inside it is then
  // timed off game.resultT, so the panel reads as one choreographed beat.
  const inT = clamp(game.resultT / 0.42, 0, 1);
  const panelS = 0.80 + 0.20 * easeOutBack(inT);
  ctx.save();
  ctx.translate(L.cx, py + ph / 2);
  ctx.rotate((1 - inT) * -0.05);
  ctx.scale(panelS, panelS);
  ctx.translate(-L.cx, -(py + ph / 2));
  ctx.globalAlpha = Math.min(1, inT * 1.6);

  panelBox(px, py, pw, ph);

  let cy = py + pad;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const titleIn = clamp((game.resultT - 0.10) / 0.3, 0, 1);
  const sc = 0.60 + 0.40 * easeOutBack(titleIn);
  ctx.save();
  ctx.translate(L.cx, cy + 40);
  ctx.rotate(Math.sin(game.resultT * 3.4) * 0.02 * (1 - titleIn));
  ctx.scale(sc, sc);
  const title = game.justUnlockedEndless ? 'CAMPAIGN DONE!'
    : flawless ? 'FLAWLESS!'
    : stars === 3 ? 'PERFECT CUT!' : stars === 2 ? 'GOOD CUT!' : 'CUT DONE';
  UI.sprayText(ctx, title, 0, 0, 60, game.justUnlockedEndless ? '#9fd07a'
    : flawless ? '#d9a8ff' : stars === 3 ? '#f2c230' : '#f3e9d2');
  ctx.restore();
  cy += 88;

  if (sub) {
    ctx.save();
    ctx.globalAlpha = clamp((game.resultT - 0.25) / 0.3, 0, 1);
    ctx.font = '800 23px CisBody, system-ui, sans-serif';
    ctx.fillStyle = game.justUnlockedEndless ? '#8fe87c' : '#ffd873';
    ctx.fillText(sub, L.cx, cy + 12);
    ctx.restore();
    cy += 30;
  }

  const slots = flawless ? 4 : 3;
  for (let i = 0; i < slots; i++) {
    const filled = i < game.starsShown;
    const pop = filled ? clamp((game.resultT - 0.5 - i * 0.26) / 0.22, 0, 1) : 0;
    const purple = flawless && i === 3;
    const base = flawless ? 44 : 48;
    const r = base * (filled ? 1 + (purple ? 0.7 : 0.4) * Math.sin(pop * Math.PI) : 1);
    R.drawStar(ctx, starSlotX(i, flawless), cy + 62, r, filled, game.time,
      purple ? 'purple' : null);
  }
  cy += 130;

  // --- The accuracy meter.
  //
  // A bare "Accuracy 88%" tells the player the number but not what it was worth. The
  // bar fills to the accuracy they actually cut and carries a marked gate for every
  // star, so the same glance shows which stars were cleared and — the part that
  // matters for a retry — exactly how far short of the next one they fell. "Missed
  // 3 stars by a whisker" is a reason to play again; "88%" is not.
  //
  // The bar fills to the SCORE, which is accuracy plus the craft bonus, because the
  // score is what the gates are scored against. The two are drawn as different
  // segments — the cut itself in the accuracy gradient, the bonus in gold on the end —
  // so the player can see exactly what each one was worth. A bar that quietly added
  // the bonus into the accuracy fill would be back to telling them a number they
  // cannot act on.
  const accIn = clamp((game.resultT - 0.38) / 0.5, 0, 1);
  const grow = easeOutCubic(accIn);
  const shownScore = score * grow;
  const shownAcc = Math.min(acc * grow, shownScore);

  ctx.font = '800 28px CisBody, system-ui, sans-serif';
  ctx.fillStyle = flawless ? '#d89bff' : '#f3e9d2';
  const bonusPts = Math.round(bonus * 100);
  ctx.fillText(bonusPts > 0
    ? `Accuracy  ${Math.round(shownAcc * 100)}%   +${bonusPts}% craft`
    : `Accuracy  ${Math.round(shownAcc * 100)}%`, L.cx, cy + 14);
  // Enough room for the gate stars, which sit ABOVE the bar and would otherwise run
  // into the accuracy line.
  cy += 64;

  const mw = pw - 128, mx = L.cx - mw / 2, my = cy, mh = 20;
  ctx.save();
  // Track: a steel rule.
  const tg = ctx.createLinearGradient(0, my, 0, my + mh);
  tg.addColorStop(0, '#cfd2d2');
  tg.addColorStop(1, '#7d8282');
  ctx.fillStyle = tg;
  R.roundRect(ctx, mx, my, mw, mh, 3);
  ctx.fill();

  // Fill, coloured by what it reached.
  //
  // Positions come from `xOf`, not `mw * value`. The end gates are pulled in off the
  // bar's rounded caps, so plotting values linearly put the purple gate (99.5%) nine
  // units short of where 99.5% landed: a 99% cut plus craft bonus ran straight PAST
  // an unlit fourth star, and the owner read the bar as claiming a star the panel did
  // not award. Mapping every value through the gates' own positions makes a gate and
  // its threshold the same pixel, and a cut that has not cleared the purple gate is
  // held visibly short of it.
  const g4x = mx + mw - 9;
  const xOf = (v) => v <= FLAWLESS_AT
    ? mx + (g4x - mx) * clamp(v, 0, 1) / FLAWLESS_AT
    : g4x + (mx + mw - g4x) * clamp((v - FLAWLESS_AT) / (1 - FLAWLESS_AT), 0, 1);
  const reach = flawless ? mx + mw : g4x - 11;
  const fillW = Math.max(mh, Math.min(reach, xOf(shownAcc)) - mx);
  const scoreW = Math.max(fillW, Math.min(reach, xOf(shownScore)) - mx);
  // One solid colour — tape-measure yellow, purple for a flawless cut. (The rainbow
  // gradient it replaced read as generated UI; the owner had also asked before that
  // the fill never change colour part-way, and a single colour settles that for good.)
  const fg = flawless ? '#b98ae6' : '#f2c230';
  ctx.save();
  R.roundRect(ctx, mx, my, mw, mh, 3);
  ctx.clip();
  // The whole bar is one gradient, so it never changes colour at the seam between
  // the cut and the bonus — the owner's note was that a purple bar turning orange for
  // its last few pixels looked like a fault. The craft bonus is told apart by texture
  // instead: the same colours, dimmed, under diagonal stripes.
  ctx.fillStyle = fg;
  ctx.fillRect(mx, my, scoreW, mh);
  // Rule graduations over both the steel and the filled tape.
  ctx.strokeStyle = 'rgba(25,20,12,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const tx = mx + (mw * i) / 40;
    ctx.moveTo(tx, my);
    ctx.lineTo(tx, my + (i % 5 === 0 ? mh * 0.6 : mh * 0.3));
  }
  ctx.stroke();
  if (scoreW > fillW + 0.5) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx + fillW, my, scoreW - fillW, mh);
    ctx.clip();
    ctx.fillStyle = 'rgba(22,14,8,0.32)';
    ctx.fillRect(mx + fillW, my, scoreW - fillW, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let sx = mx + fillW - mh; sx < mx + scoreW + mh; sx += 9) {
      ctx.moveTo(sx, my + mh);
      ctx.lineTo(sx + mh, my);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(mx + fillW - 1, my, 2, mh);
  }
  // A moving sheen on the filled part while it grows.
  if (accIn < 1) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(mx + scoreW - 14, my, 14, mh);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Star gates.
  //
  // The FIRST star gets a marker too, even though it has no threshold to clear. It
  // used to be left out on the reasoning that finishing the board earns it and so
  // there is nothing to mark — but that made the meter and the panel disagree out
  // loud: a three-star cut showed three stars across the top and only TWO lit stars
  // on the bar beneath it, and the owner read that, correctly, as a bug. A meter whose
  // job is to show which stars were cleared has to show all of them.
  //
  // It carries no gate LINE, because there is no threshold there to draw — just the
  // star, sitting over the head of the bar, lit from the moment the board is finished.
  // The purple gate's threshold is FLAWLESS_AT, not 1.0.
  //
  // It was 1.0, and `isFlawless` is `acc >= 0.995` — so a 99.6% cut lit the fourth
  // star at the top of the panel, printed "100%" beside it, and left the gate on the
  // bar UNLIT. The panel and the meter have to read the same thresholds, or the meter
  // is contradicting the score it sits under.
  const gates = [
    [0, 1, '#ffd23f'],
    [STAR_AT[1], 2, '#63e08a'],
    [STAR_AT[2], 3, '#ffd23f'],
    [FLAWLESS_AT, 4, '#c56bff'],
  ];
  for (const [at, n, col] of gates) {
    // Clamped inside the bar so the end markers sit on its caps rather than off them.
    const gx = n === 1 ? mx + 9 : xOf(at);
    // The purple gate is cleared by ACCURACY; the gold ones by the score. That is not
    // an inconsistency, it is the rule: the craft bonus cannot buy a flawless.
    const got = (n === 4 ? shownAcc : shownScore) >= at - 0.0005;
    // EVERY gate draws its line, the first included. Leaving it off made the first
    // star read as a stray mark floating near the start of the bar instead of as the
    // first of four markers.
    ctx.strokeStyle = got ? col : 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gx, my - 7);
    ctx.lineTo(gx, my + mh + 7);
    ctx.stroke();
    R.drawStar(ctx, gx, my - 20, 11, got, game.time, n === 4 ? 'purple' : null);
  }

  // How far short of the next star, stated in words. This is the line that turns a
  // score into a reason to tap Retry.
  const nextGate = gates.find(([at, n]) => at > 0 && (n === 4 ? acc : score) < at);
  if (nextGate && accIn > 0.9) {
    const short = Math.round((nextGate[0] - (nextGate[1] === 4 ? acc : score)) * 100);
    ctx.font = '700 19px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(236,220,190,0.8)';
    const goal = nextGate[1] === 4 ? 'FLAWLESS' : `${nextGate[1]} stars`;
    ctx.fillText(short <= 0 ? '' : `${short}% short of ${goal}`, L.cx, my + mh + 30);
  }
  ctx.restore();
  cy += mh + 46;

  // Rows cascade in from the left, one per beat, each landing with its own coin
  // blip. A list that appears all at once tells the player nothing about which line
  // is which; a list that arrives teaches the breakdown.
  ctx.font = '700 24px CisBody, system-ui, sans-serif';
  for (let i = 0; i < rows.length; i++) {
    const [label, amount] = rows[i];
    const rt = clamp((game.resultT - (1.05 + i * 0.16)) / 0.26, 0, 1);
    if (rt <= 0) { cy += 34; continue; }
    const e = easeOutBack(rt);
    ctx.save();
    ctx.globalAlpha = Math.min(1, rt * 2.2);
    ctx.translate((1 - e) * -70, 0);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(206,226,240,0.85)';
    ctx.fillText(label, px + 40, cy + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe9a8';
    ctx.font = `700 ${24 + (1 - rt) * 10}px CisBody, system-ui, sans-serif`;
    ctx.fillText(`+${amount}`, px + pw - 40, cy + 16);
    ctx.restore();
    ctx.font = '700 24px CisBody, system-ui, sans-serif';
    cy += 34;
  }

  // The total rolls up instead of being printed, and thumps on each tick.
  ctx.textAlign = 'center';
  const shown = Math.round(game.coinRoll.shown) * (game.doubled ? 2 : 1);
  const bump = 1 + game.coinRoll.bump * 0.22;
  ctx.save();
  ctx.translate(L.cx + 20, cy + 30);
  ctx.scale(bump, bump);
  ctx.font = '900 42px CisBody, system-ui, sans-serif';
  ctx.fillStyle = '#ffe9a8';
  const coinTxt = `+${shown}`;
  const tw = ctx.measureText(coinTxt).width;
  ctx.fillText(coinTxt, 0, 0);
  R.drawCoin(ctx, -tw / 2 - 32, -2, 18);
  ctx.restore();
  ctx.restore();
  cy += 60;

  const bw = pw - 68, bx = px + 34;
  // Buttons stagger in after the numbers have settled, so the player's eye is on the
  // score when it lands rather than already on the next tap.
  const btnGate = (i) => clamp((game.resultT - (1.5 + i * 0.10)) / 0.24, 0, 1);
  let bi = 0;
  if (chests > 0 && btnGate(bi) > 0.05) {
    button('open-run-chest', bx, cy, bw, 84,
      chests > 1 ? `OPEN ${chests} CHESTS` : 'OPEN TREASURE CHEST', 'reward',
      // A chest on this panel can come from three keys OR from a seven-day daily
      // streak, so the subtitle has to say which one this player earned. It used to
      // claim "3 perfect corners" unconditionally.
      game.chestFrom === 'streak' ? '7 day streak' : '3 perfect corners',
      { pop: btnGate(bi) });
  }
  if (chests > 0) { cy += 96; bi++; }
  if (showDouble) {
    if (btnGate(bi) > 0.05) {
      button('double', bx, cy, bw, 78, 'DOUBLE COINS', 'reward', '▶ Watch a short ad',
        { pop: btnGate(bi) });
    }
    cy += 92; bi++;
  }
  if (btnGate(bi) > 0.05) {
    const label = game.justUnlockedEndless ? 'PLAY ENDLESS'
      : game.endlessRun ? 'NEXT BOARD' : 'NEXT LEVEL';
    const id = game.justUnlockedEndless ? 'home-endless' : 'next';
    button(id, bx, cy, bw, 82, label, 'primary', null, { pop: btnGate(bi) });
  }
  cy += 94; bi++;
  // The Workshop is where coins actually go, so the route to it sits right next to
  // the moment the player just earned some. LEVELS shares the row: level select had
  // only ever existed behind the gear, and the owner went looking for it and could
  // not find it. The results panel is where a player decides what to do next, so a
  // route to the level list belongs on it.
  if (btnGate(bi) > 0.05) {
    const chestFlag = META.chestReady(meta) ? '  ●' : '';
    const half = (bw - 14) / 2;
    button('workshop', bx, cy, half, 66, `WORKSHOP${chestFlag}`, 'ghost', null, { pop: btnGate(bi) });
    // Mid-run, the second slot is the way OUT of the run — banking the record is a
    // decision the player has to be able to make between boards.
    if (game.endlessRun) {
      button('end-run', bx + half + 14, cy, half, 66, 'END RUN', 'ghost', null, { pop: btnGate(bi) });
    } else {
      button('menu-levels', bx + half + 14, cy, half, 66, 'LEVELS', 'ghost', null, { pop: btnGate(bi) });
    }
  }
  ctx.restore();
}

const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function drawFailed() {
  const showAd = SDK.adsUsable() && !game.continueUsed;
  const showCoins = !game.continueUsed && meta.coins >= CONTINUE_COST;
  // An endless run that has spent its continue is over: the panel reports the run
  // rather than offering a level to retry.
  const over = game.endlessOver;
  // Either state adds the MAIN MENU row — a ruined endless board has no level to
  // fall back to. The panel height has to count it, or the button hangs off the
  // bottom of the card (§6: never hardcode a panel height).
  const endless = !!(over || game.endlessRun);

  const pw = R.STAGE_W - 116;
  const px = (R.STAGE_W - pw) / 2;
  const pad = 34;
  const bodyH = 92 + 46 + (over ? 78 : 0);
  const btnH = (showAd ? 92 : 0) + (showCoins ? 84 : 0) + 80 + (endless ? 76 : 0);
  const ph = pad + bodyH + btnH + pad;
  const py = Math.max(60, (L.h - ph) / 2 - 30);

  dim('rgba(26,4,0,0.5)');
  panelBox(px, py, pw, ph);

  let cy = py + pad;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const inT = clamp(game.resultT / 0.3, 0, 1);
  const sc = 0.72 + 0.28 * (1 - Math.pow(1 - inT, 3));
  ctx.save();
  ctx.translate(L.cx, cy + 42);
  ctx.scale(sc, sc);
  const failTitle = over ? 'RUN OVER' : 'BOARD RUINED';
  UI.sprayText(ctx, failTitle, 0, 0, 60, '#e2553d');
  ctx.restore();
  cy += 92;

  ctx.font = '700 27px CisBody, system-ui, sans-serif';
  ctx.fillStyle = '#f3e9d2';
  ctx.fillText(over
    ? `${over.boards} ${over.boards === 1 ? 'board' : 'boards'} cut`
    : 'You drifted too far off the line', L.cx, cy + 16);
  cy += 46;

  if (over) {
    ctx.font = '900 30px CisBody, system-ui, sans-serif';
    ctx.fillStyle = over.record ? '#8fe87c' : 'rgba(232,214,182,0.8)';
    ctx.fillText(over.record ? 'NEW RECORD!' : `Best on this setting: ${over.best}`,
      L.cx, cy + 22);
    ctx.font = '700 21px CisBody, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,214,182,0.7)';
    ctx.fillText(`${ENDLESS_SPEEDS[game.endlessSel.speed].name}`
      + ` \u00b7 ${ENDLESS_LINES[game.endlessSel.line].name}`, L.cx, cy + 54);
    cy += 78;
  }
  ctx.restore();

  const bw = pw - 68, bx = px + 34;
  // Retry is free, always present, and the same size as the ad option — CrazyGames
  // treats a hidden or shrunken skip as a rejection trigger.
  if (showAd) {
    button('continue-ad', bx, cy, bw, 78, 'CONTINUE CUT', 'reward', '▶ Watch a short ad');
    cy += 92;
  }
  if (showCoins) {
    button('continue-coins', bx, cy, bw, 70, `CONTINUE — ${CONTINUE_COST} COINS`, 'ghost');
    cy += 84;
  }
  // The Daily Cut is one attempt, so its failed panel offers no retry of it: this
  // button used to read RETRY LEVEL and quietly drop the player into the campaign.
  button('retry', bx, cy, bw, 78,
    endless ? 'NEW RUN' : game.daily ? `BACK TO LEVEL ${game.levelNum}` : 'RETRY LEVEL', 'primary',
    endless ? 'Same speed and line' : game.daily ? 'The Daily Cut is one attempt a day' : null);
  cy += 86;
  // Endless has no level to fall back to, so it needs a way off this panel that is
  // not "play again immediately".
  if (endless) button('menu-home', bx, cy, bw, 64, 'MAIN MENU', 'ghost');
}

function drawAdCover() {
  dim('rgba(0,0,0,0.85)');
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 32px CisBody, system-ui, sans-serif';
  ctx.fillStyle = '#f3e9d2';
  ctx.fillText('Loading ad…', L.cx, L.h / 2);
  ctx.restore();
  // NO canvas dev-skip button here.
  //
  // There used to be one, and it was a trap: the SDK's ad overlay is a fixed div at
  // z-index 10000 covering the viewport, so anything drawn on the canvas sits beneath
  // it and cannot be clicked, ever. Two identical "DEV: SKIP AD" buttons on screen —
  // one live, one inert — meant the skip looked broken depending on which one you
  // happened to aim at. The real button is #devskip in index.html, which is DOM and
  // sits above the overlay.
}

// The briefing card: what is different about this board, big, in the middle of the
// screen, and it stays until the player taps. See beginBoard for why it waits.
const INK_PENCIL = '#4a4640';

function drawBriefing() {
  const B = game.briefing;
  const inT = easeOutBack(clamp(B.t / 0.35, 0, 1));
  dim('rgba(12,7,3,0.62)');
  const items = B.items;
  const pw = Math.min(640, R.STAGE_W - 48);
  const rowH = 118;
  const ph = 176 + items.length * rowH + 150;
  const px = L.cx - pw / 2;
  const py = clamp(L.bladeY - 170 - ph / 2, view.safeTop + 90, L.h - ph - 40);
  ctx.save();
  ctx.globalAlpha = clamp(B.t / 0.2, 0, 1);
  ctx.translate(L.cx, py + ph / 2);
  const sc = 0.7 + 0.3 * inT;
  ctx.scale(sc, sc);
  ctx.translate(-L.cx, -(py + ph / 2));
  // A work order on a clipboard: the gimmick is written up the way a job would be.
  const paper = UI.clipboard(ctx, px, py, pw, ph);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = UI.F.stencil(30);
  ctx.fillStyle = '#2a1a0c';
  ctx.fillText('WORK ORDER', paper.x + 26, paper.y + 40);
  ctx.textAlign = 'right';
  ctx.font = UI.F.marker(26);
  ctx.fillStyle = INK_PENCIL;
  ctx.fillText(game.endlessRun ? 'Endless' : `Level ${game.levelNum}`, paper.x + paper.w - 26, paper.y + 40);
  ctx.textAlign = 'center';
  ctx.font = UI.F.body(700, 22);
  ctx.fillStyle = INK_PENCIL;
  ctx.fillText(items.length > 1 ? 'This board is different \u2014 twice:' : 'This board is different:',
    L.cx, paper.y + 82);
  let y = py + 176;
  for (const it of items) {
    fitFontOn(ctx, it.name, pw - 80, 54, 400, UI.FAMILY.marker);
    ctx.fillStyle = '#b3261e';
    ctx.fillText(it.name, L.cx, y);
    fitFontOn(ctx, it.blurb, pw - 80, 26, 700);
    ctx.fillStyle = '#26221d';
    ctx.fillText(it.blurb, L.cx, y + 48);
    y += rowH;
  }
  ctx.restore();
  // The button only exists once the card has landed, so it cannot be hit mid-pop.
  if (B.t > 0.3) {
    const bw = Math.min(380, pw - 80);
    const b = button('brief-go', L.cx - bw / 2, py + ph - 124, bw, 92, 'GOT IT',
      'primary', 'Tap or press Space');
    b.pop = clamp((B.t - 0.3) / 0.3, 0, 1);
  }
}

// The count-in. Big, centred, and it scales down as each number lands so the beat
// is readable at a glance rather than being a number that simply changes.
function drawCountIn() {
  const step = Math.ceil(game.countT - 0.75);
  const label = step > 0 ? `${step}` : 'GO!';
  const frac = step > 0 ? (game.countT - 0.75) - (step - 1) : game.countT / 0.75;
  const pop = clamp(1 - frac, 0, 1);
  ctx.save();
  dim('rgba(12,7,3,0.34)');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(L.cx, L.bladeY - 210);
  const sc = step > 0 ? 1.5 - 0.5 * easeOutCubic(pop) : 1 + 0.18 * Math.sin(pop * Math.PI);
  ctx.scale(sc, sc);
  ctx.globalAlpha = clamp(frac * 3, 0, 1);
  UI.sprayText(ctx, label, 0, 0, 150, step > 0 ? '#f2c230' : '#9fd07a');
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '800 26px CisBody, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(243,233,210,0.85)';
  // The wording has to match why the count-in is running. "BACK ON THE LINE" is right
  // after a revive or a pause and plainly wrong at the start of a fresh board, where
  // the player has not been on the line yet — and the start of a fresh board is now
  // the common case.
  ctx.fillText(game.countReason === 'resume' ? 'BACK ON THE LINE' : 'GET READY',
    L.cx, L.bladeY - 96);
  ctx.restore();

  // The gimmick announcement.
  //
  // A level that is different has to SAY it is different before the board moves,
  // otherwise the player learns what it was by failing it — which is the wrong way to
  // teach a hundred-level campaign and reads as unfairness rather than variety. The
  // count-in is exactly the right place: the screen is already dimmed and held, and
  // the player is already looking at the middle of it.
  const lv = game.level;
  if (!lv || !lv.gimmickName || game.countReason === 'resume') return;
  ctx.save();
  ctx.textAlign = 'center';
  const inT = clamp((4 - game.countT) / 0.4, 0, 1);
  ctx.globalAlpha = easeOutCubic(inT);
  const bannerY = L.bladeY + 40;
  // Written on masking tape stuck across the bench, like every other label (ui.js).
  ctx.font = UI.F.marker(38);
  const tw = Math.min(R.STAGE_W - 60, Math.max(ctx.measureText(lv.gimmickName).width + 70, 300));
  UI.tape(ctx, L.cx, bannerY - 8, tw, 62, -0.02, lv.gimmickName, { size: 38, ink: '#b3261e' });
  ctx.font = UI.F.marker(20);
  const bw = Math.min(R.STAGE_W - 60, ctx.measureText(lv.gimmickBlurb).width + 50);
  UI.tape(ctx, L.cx + 8, bannerY + 40, bw, 38, 0.015, lv.gimmickBlurb, { size: 20 });
  ctx.restore();
}

// A gear plus the mute toggle, bottom-left. The gear is deliberately always present:
// the previous pass put settings, the Build screen and level select behind
// "finish a level, then tap WORKSHOP, then scroll", and features nobody can find are
// features nobody has.
function drawMenuButton() {
  const s = 56;
  const by = L.h - s - 20 - view.safeBottom;
  const b = button('mute', 20, by, s, s, '', 'ghost');
  b.icon = A.isMuted() ? 'muted' : 'sound';
  const g = button('open-menu', 20 + s + 12, by, s, s, '', 'ghost');
  g.icon = 'gear';
}

// A strip of masking tape, written on in marker.
function drawToast() {
  const a = clamp(game.toastT / 0.5, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  // Shrink to fit rather than growing wider than the play column — an upgrade's
  // effect line can be long, and a toast that runs off the edge is worse than a
  // small one.
  const maxW = R.STAGE_W - 96;
  let size = 30;
  ctx.font = UI.F.marker(size);
  while (ctx.measureText(game.toast).width + 64 > maxW && size > 16) {
    size -= 1;
    ctx.font = UI.F.marker(size);
  }
  const w = Math.min(maxW, ctx.measureText(game.toast).width + 64);
  UI.tape(ctx, L.cx, L.h * 0.17 + 30, w, 60, -0.018, game.toast, { size });
  ctx.restore();
}

// --- Boot ------------------------------------------------------------------

let acc = 0;
let last = performance.now();

function frame(now) {
  // Reschedule FIRST. This used to be the last statement, which meant a single
  // exception anywhere in update() or draw() permanently killed the loop — the game
  // froze on whatever had been painted so far, with no message. That is the worst
  // failure a web game can have: on CrazyGames it reads as a broken game and takes
  // the playtime and conversion numbers with it. One bad frame must never be fatal.
  requestAnimationFrame(frame);
  try {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    acc += dt;
    let guard = 0;
    while (acc >= TICK && guard++ < 240) {
      update(TICK);
      acc -= TICK;
    }
    draw();
    frameErrors.streak = 0;
    // If the game recovered on its own, take the error notice back down — but only
    // after a sustained run of good frames, so a flickering fault can't strobe it.
    if (frameErrors.shown && ++frameErrors.good > 120) {
      frameErrors.shown = false;
      frameErrors.good = 0;
      hideFatal();
    }
  } catch (err) {
    onFrameError(err);
  }
}

// Frame errors are counted, not swallowed. A one-off is logged and skipped; a
// persistent one surfaces to the player, because a game that silently does nothing
// is worse than one that admits it broke.
const frameErrors = { streak: 0, total: 0, good: 0, seen: new Set(), shown: false };

function onFrameError(err) {
  frameErrors.streak++;
  frameErrors.total++;
  const key = String(err && err.message || err);
  if (!frameErrors.seen.has(key)) {
    frameErrors.seen.add(key);
    console.error('[frame]', err);
  }
  frameErrors.good = 0;
  if (frameErrors.streak >= 30 && !frameErrors.shown) {
    frameErrors.shown = true;
    showFatal(
      'Something went wrong',
      isDev() ? key : 'Please reload the page.',
    );
  }
}

function hideFatal() {
  const el = document.getElementById('fatal');
  if (el) el.hidden = true;
}

// A DOM overlay, deliberately: if the canvas is what broke, a canvas-drawn message
// would never appear.
function showFatal(title, detail) {
  let el = document.getElementById('fatal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatal';
    document.body.appendChild(el);
  }
  el.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'fatal-title';
  h.textContent = title;
  const d = document.createElement('div');
  d.className = 'fatal-detail';
  d.textContent = detail;
  const btn = document.createElement('button');
  btn.className = 'fatal-btn';
  btn.textContent = 'RELOAD';
  btn.addEventListener('click', () => location.reload(true));
  el.append(h, d, btn);
  el.hidden = false;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game.state === 'playing') {
      SDK.gameplayStop();
      A.updateSaw(false, 0, 0);
      A.suspendAudio();
    }
  } else {
    A.resumeAudio();
    last = performance.now();
    acc = 0;
    if (game.state === 'playing') SDK.gameplayStart();
  }
});

// A stale cached module is indistinguishable from a broken build at runtime, and it
// produced exactly this bug: a browser holding an old render.js against a new main.js
// threw `R.drawBladeUnder is not a function` on the first frame and froze the game on
// the bench background. Checking the seams at boot turns that into an instruction.
function checkModules() {
  const required = [
    ['render.js', R, ['computeLayout', 'loadTextures', 'ensureTexture', 'streamTextures', 'loadMachineTextures', 'loadFindSprites', 'drawBench',
      'drawSawTable', 'drawPlank', 'drawBladeUnder', 'drawSawHead', 'drawHud', 'drawStar',
      'drawJumpUi', 'loadUiSprites', 'drawCurrencyStrip']],
    ['fx.js', FX, ['createFx', 'updateFx', 'drawFx', 'ring', 'flight', 'flash', 'createRoll']],
    ['meta.js', META, ['createMeta', 'serialise', 'deserialise', 'rollStarChest', 'awardStarChest',
      'sawMods', 'buyUpgrade', 'toggleUpgrade', 'activeTier',
      'dailyChestReady', 'rollDailyChest', 'awardDailyChest',
      'adGraceFor', 'touchLastPlayed']],
    ['sdk.js', SDK, ['initSdk', 'showBanner', 'clearBanners', 'bannersAllowed', 'clearData',
      'applyAdGrace']],
    ['build.js', BUILD, ['createBuild', 'ensureProject', 'drawBuild', 'updateBuild']],
    ['chest.js', CHEST, ['createChestScene', 'updateChest', 'drawChestScene']],
    // menu.js carries the launch screen now: if it is stale the game has nothing to
    // draw at boot, which is precisely the silent freeze checkModules exists to name.
    ['menu.js', MENU, ['drawHomeMenu', 'drawEndlessSetup', 'drawPauseMenu', 'drawLevelSelect']],
  ];
  const missing = [];
  for (const [file, mod, names] of required) {
    for (const n of names) {
      if (typeof mod[n] !== 'function') missing.push(`${file}:${n}`);
    }
  }
  return missing;
}

// Resolves either way: a timeout is logged and stepped over, never thrown, because
// nothing in the boot path is worth refusing to start the game for.
function withTimeout(promise, ms, label) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(() => {
      console.warn(`[boot] ${label} timed out after ${ms}ms — continuing without it`);
      finish();
    }, ms);
    Promise.resolve(promise)
      .catch((err) => console.warn(`[boot] ${label} failed`, err))
      .finally(() => { clearTimeout(timer); finish(); });
  });
}

async function boot() {
  try {
    await bootInner();
  } catch (err) {
    console.error('[boot] failed', err);
    // Tell the player something true instead of leaving the loading screen up.
    window.__bootFailed?.(String(err && err.message || err));
    showFatal('Couldn\u2019t start', isDev() ? String(err && err.message || err)
      : 'Something went wrong loading the game. Please reload.');
  }
}

async function bootInner() {
  const missing = checkModules();
  if (missing.length) {
    console.error('[boot] stale or incomplete modules:', missing);
    window.__bootFailed?.('Stale cached modules: ' + missing.slice(0, 3).join(', '));
    showFatal(
      'Stale files cached',
      'Your browser is holding old copies of the game. Hard-reload to fix: '
      + 'Ctrl+Shift+R (Cmd+Shift+R on Mac). Missing: ' + missing.slice(0, 3).join(', '),
    );
    return;
  }
  resize();
  // init() must complete before any other SDK call, otherwise the SDK logs
  // "CrazySDK is not initialized yet" and drops the event.
  await withTimeout(SDK.initSdk(), 8000, 'SDK init');
  SDK.loadingStart();
  // Textures are raced against a timeout. An image that 404s fires onerror and
  // resolves, but one on a stalled connection fires NEITHER — and awaiting that
  // forever is a game that never starts. Missing textures already degrade to a flat
  // fill, so starting without them beats not starting.
  // The save is read FIRST, so boot knows which boards the player is about to see.
  load();
  // Only those boards are awaited — the one behind the menu and the next two. The
  // other 45 stream in after the first frame (see below and R.ensureTexture).
  const soon = [0, 1, 2].map((k) => levelTex(game.levelNum + k));
  await withTimeout(Promise.all([
    R.loadTextures([...new Set(soon)]),
    R.loadMachineTextures(),
    R.loadFindSprites(),
    R.loadUiSprites(),
    UI.loadUiSkin(),
  ]), 10000, 'textures');
  A.setMuted(SDK.platformMuted() || !!meta.settings.muted);
  A.setVolumes(meta.settings.sfxVol, meta.settings.musicVol);
  SDK.onSettingsChange(() => A.setMuted(SDK.platformMuted() || !!meta.settings.muted));
  SDK.loadingStop();

  // The main menu, with PLAY one tap away. CrazyGames allows at most one click
  // before play and the top-converting shape is zero, so the menu is built around a
  // single dominant PLAY button that resumes the player's level — the choice is
  // there for players who want it and costs one tap for players who do not.
  game.endlessSel = { speed: meta.endless.speed | 0, line: meta.endless.line | 0 };
  goHome();
  requestAnimationFrame(frame);
  // The Build screen's and the chest's art is fetched AFTER the first frame, never
  // awaited: both are at least one tap from launch, and time-to-first-frame is where
  // §1 says conversion is won.
  setTimeout(() => { BUILD.loadKitchenArt(); CHEST.loadChestArt(); }, 400);
  // Every other board, in the order the campaign meets them from here. Derived from
  // MATERIALS, never written out: a hand-written list once left three real board
  // types unloaded for weeks, rendering as flat fills.
  setTimeout(() => {
    const order = [];
    for (let k = game.levelNum; k <= LEVEL_COUNT; k++) order.push(levelTex(k));
    R.streamTextures([...new Set([...order, ...Object.values(MATERIALS).map((m) => m.tex)])]);
  }, 900);
  // Clear the loading screen only once a frame has genuinely been drawn. The old
  // version cleared it on a bare rAF timer, which could not tell "running" from
  // "hung", and index.html's watchdog now reports the difference.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__gameReady = true;
    const el = document.getElementById('boot');
    if (el && !el.dataset.failed) el.classList.add('gone');
  }));
}

boot();

// Test hooks, localhost only — nothing is exposed once the game is hosted.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.__gameState = () => ({
    state: game.state,
    level: game.levelNum,
    s: game.cut ? Math.round(game.cut.s) : 0,
    length: game.plank ? Math.round(game.plank.length) : 0,
    damage: game.cut ? +game.cut.damage.toFixed(3) : 0,
    strain: game.cut ? +game.cut.strain.toFixed(3) : 0,
    band: game.cut ? game.cut.band : null,
    acc: game.cut ? +accuracy(game.cut).toFixed(3) : 0,
    score: game.cut ? +cutScore(game.cut).toFixed(3) : 0,
    craft: game.cut ? +craftBonus(game.cut).toFixed(4) : 0,
    craftParts: game.cut ? craftParts(game.cut).map((x) => `${x.key}:${x.got.toFixed(2)}`) : [],
    stars: game.cut ? starsFor(cutScore(game.cut)) : 0,
    coins: meta.coins,
    buttons: game.buttons.map((b) => b.id),
    layout: { w: L.w, h: Math.round(L.h), scale: +L.scale.toFixed(3), bladeY: Math.round(L.bladeY) },
  });
  // Simulates a competent player tracking the line, so a run can be driven headlessly.
  window.__steerToLine = (slop = 0) => {
    if (game.state !== 'playing') return;
    const target = -lineAtDebug(game.plank, game.cut.s + 40);
    const sgn = meta.settings.invert ? 1 : -1;
    input.state.dx += sgn * ((target - game.cut.offset) * 0.35 + (Math.random() - 0.5) * slop);
  };
  // A button's box in CLIENT pixels, so a test can drive it with real pointer events.
  window.__buttonRect = (id) => {
    const b = game.buttons.find((x) => x.id === id);
    if (!b) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + L.ox + b.x * L.scale, y: r.top + L.oy + b.y * L.scale,
      w: b.w * L.scale, h: b.h * L.scale };
  };
  window.__settings = () => ({ ...meta.settings, vol: A.getVolumes(), muted: A.isMuted(), music: A.getMusic() });
  window.__buildView = () => ({ view: game.build.view, project: game.build.projectId,
    buttons: game.buttons.map((b) => b.id).filter((i) => i.startsWith('build-')) });
  window.__tapButton = (id) => {
    const b = game.buttons.find((x) => x.id === id);
    if (b) onTap(b);
    return !!b;
  };
  window.__setLevel = (n) => startLevel(n);
  window.__goHome = () => goHome();
  window.__endless = () => (game.endlessRun
    ? { ...game.endlessRun, sel: { ...game.endlessSel } }
    : { run: null, sel: { ...game.endlessSel }, over: game.endlessOver });
  window.__unlockEndless = () => { META.unlockEndless(meta); save(); };
  window.__levelInfo = (n) => {
    const lv = getLevel(n);
    return {
      n, speed: +lv.speed.toFixed(1), tol: +lv.tolerance.toFixed(1),
      amp: +lv.amplitude.toFixed(1), zig: +lv.zigzag.toFixed(2),
      detail: +lv.detail.toFixed(2), length: lv.length, width: lv.width,
      seconds: +(lv.length / lv.speed).toFixed(1), material: lv.material.name,
    };
  };
  window.__levelCount = () => LEVEL_COUNT;
  window.__bankStars = (n) => { META.bankStars(meta, n); save(); };
  window.__rawOffset = () => (game.cut ? game.cut.offset : 0);
  window.__jumpState = () => (game.cut ? {
    gaps: (game.plank.gaps || []).map((x) => ({ i: x.i, s0: Math.round(x.s0), s1: Math.round(x.s1) })),
    air: game.cut.air,
    airT: +game.cut.airT.toFixed(3),
    jumped: [...game.cut.jumped],
    jumps: game.cut.jumps,
    perfect: game.cut.perfectJumps,
    missed: game.cut.missedJumps,
    s: Math.round(game.cut.s),
  } : null);
  window.__jump = () => tryJump(game.cut);
  window.__finds = () => (game.plank
    ? game.plank.objects.map((o) => ({
      type: o.type, s: Math.round(o.s), resolved: !!o.resolved, hit: !!o.hit,
      hitS: o.hitS != null ? Math.round(o.hitS) : null,
    }))
    : []);
  window.__plankInfo = () => (game.plank
    ? { n: game.levelNum, w: game.plank.width, len: game.plank.length, mat: game.level ? game.level.material.name : null }
    : null);
  window.__push = (dx) => { input.state.dx += dx; };
  // Reports where the guide line actually starts and stops on screen, so the
  // "it must not end mid-screen" requirement can be asserted rather than eyeballed.
  window.__guideExtent = () => {
    if (!game.cut) return null;
    const behind = (L.h - L.bladeY) + 220;
    const sMin = Math.max(0, game.cut.s - behind);
    const bottomY = L.bladeY + game.cut.s;
    return {
      lineEndsAtY: Math.round(bottomY - sMin),
      screenBottom: Math.round(L.h),
      plankBottomY: Math.round(bottomY),
      // The line runs to whichever comes first: the plank's own end, or off-screen.
      reachesOffScreen: (bottomY - sMin) >= L.h || bottomY >= L.h,
    };
  };
  window.__giveChests = (n) => { game.pendingChests = n; };
  // Saw upgrades. Exposed so a test can assert the fitted parts actually reach the
  // cut rather than only the shop UI.
  window.__sawMods = () => META.sawMods(meta);
  window.__cutMods = () => (game.cut ? {
    tol: +game.cut.tol.toFixed(2),
    speedMult: game.cut.speedMult,
    damageMult: game.cut.damageMult,
    repairMult: game.cut.repairMult,
    laser: game.cut.laser,
    rawTol: game.level.tolerance,
  } : null);
  window.__upgrades = () => ({ ...meta.upgrades });
  window.__upgradeOff = () => ({ ...meta.upgradeOff });
  window.__reset = () => resetProgress();
  window.__countT = () => +game.countT.toFixed(2);
  window.__setInvert = (v) => { meta.settings.invert = !!v; save(); };
  // Used when capturing the store preview video: ad placeholders must not appear in
  // promotional material.
  window.__bannerDebug = () => SDK.bannerDebug();
  window.__setBanners = (on) => {
    game.bannersOff = !on;
    if (!on) { SDK.clearBanners(); }
  };
  window.__buildState = () => ({
    project: game.build.projectId,
    parts: meta.partsBought,
    animating: !!game.build.anim,
    showcase: game.build.showcase ? game.build.showcase.id : null,
  });
  window.__briefing = () => (game.briefing
    ? { items: game.briefing.items.map((i) => i.name), t: +game.briefing.t.toFixed(2) } : null);
  window.__chestState = () => (game.chestScene
    ? { stage: game.chestScene.stage, taps: game.chestScene.taps,
        lid: +game.chestScene.lid.toFixed(2),
        collect: CHEST.chestReadyToCollect(game.chestScene) }
    : null);
  window.__grant = (n) => { meta.coins += n; save(); };
  window.__dailyChest = () => ({
    ready: META.dailyChestReady(meta),
    date: meta.dailyChest.date,
    claimed: meta.dailyChest.claimed,
    adsUsable: SDK.adsUsable(),
  });
  // Pretends a day passed, so the once-a-day path is testable without waiting.
  window.__expireDailyChest = () => { meta.dailyChest.date = null; save(); };
  window.__setStreak = (n, done) => { meta.daily.streak = n; meta.daily.done = !!done; };
  window.__daily = () => ({
    streak: meta.daily.streak, done: meta.daily.done,
    reward: game.reward ? { streak: game.reward.streak, total: game.reward.total } : null,
    pendingChests: game.pendingChests,
  });
  window.__scrollTo = (y) => { game.scroll = Math.min(y, game.scrollMax); };
  window.__expireAdGrace = () => SDK.expireAdGrace();
  // Reports which side of the first-session / lapsed-player test this session fell on,
  // and how long the forced-ad clock still has to run.
  window.__adGrace = () => ({ ...game.adGrace, msUntilForcedAd: SDK.msUntilForcedAd(),
    forcedAdDue: SDK.forcedAdDue(), lastPlayedAt: meta.lastPlayedAt });
  window.__meta = () => JSON.parse(JSON.stringify(META.serialise(meta)));
  window.__scroll = (y) => { game.scroll = clamp(y, 0, game.scrollMax); };
  window.__lvScroll = () => Math.round(game.lvScroll);
  window.__lvScrollSet = (y) => { game.lvScroll = clamp(y, 0, game.lvScrollMax); };
  // Overwrites fields on the live cut, so a results panel can be staged at an exact
  // accuracy and craft bonus (the meter's edge cases) without playing for one.
  window.__rigCut = (fields) => { if (game.cut) Object.assign(game.cut, fields); };
  // Ends the current board immediately, for exercising the results flow.
  window.__finish = () => {
    if (game.state !== 'playing') return;
    game.cut.s = game.plank.length;
    game.cut.done = true;
    finishLevel();
  };
}

// The reset commands sit OUTSIDE the hostname gate above, because that gate is the
// wrong one for them. `isDev()` also accepts an SDK `local` environment, which is what
// `?useLocalSdk=true` produces on a LAN address — so a phone or a second machine
// pointed at this dev server had `isDev()` true, the reset button drawn, and no
// `__reset` defined at all. These self-gate at CALL time instead (both refuse unless
// `isDev()`), which also means they do not depend on the SDK having finished its init
// by the time this module is evaluated.
window.resetProgress = () => wipeProgress();
window.__reset = () => wipeProgress();
window.wipeSave = () => wipeProgress();
// In-place variant: rewinds to a fresh save WITHOUT a reload, for when a test is
// holding page state it does not want to lose.
window.__resetNoReload = () => { resetProgress(); return 'reset in place'; };

if (['localhost', '127.0.0.1'].includes(location.hostname)
    || new URLSearchParams(location.search).has('useLocalSdk')) {
  // Printed once, at boot, because a dev command nobody can remember the name of is a
  // dev command that does not exist.
  console.log(
    '%cWoodcut dev%c  resetProgress()  — wipe all progress and reload (also __reset(), wipeSave())\n'
    + '             __resetNoReload() — same, without reloading\n'
    + '             __expireAdGrace() — make the next transition run a forced ad\n'
    + '             __setLevel(n) · __grant(coins) · __meta()',
    'background:#c2410c;color:#fff;border-radius:3px;padding:0 5px;font-weight:700',
    'color:#888',
  );
}

function lineAtDebug(plank, s) {
  const { pts, step } = plank;
  const fi = Math.max(0, Math.min(pts.length - 1.001, s / step));
  const i = Math.floor(fi);
  return pts[i] + (pts[Math.min(i + 1, pts.length - 1)] - pts[i]) * (fi - i);
}
