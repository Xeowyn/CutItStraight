// CrazyGames SDK wrapper.
//
// This calls the REAL SDK. It is deliberately not a mock — the two prior games in this
// studio sat for weeks behind fully-faked wrappers that no review round caught, and
// that was the actual thing blocking submission (see CRAZYGAMES_GUIDELINES.md §8).
//
// When the SDK object genuinely isn't present (opened as a bare file, offline), every
// call degrades to a no-op and saving falls back to localStorage, but nothing here
// pretends an ad played.

const SDK = () => (typeof window !== 'undefined' ? window.CrazyGames?.SDK : null);

// ADS MASTER SWITCH. Basic Launch forbids ads OUTRIGHT: the portal's QA checker flags
// ANY call into the ad module — a harmless clearAllBanners() was enough to get
// "Ads were detected in your game ... Your submission will be rejected" (2026-09-28).
// The old plan of "integrate from day one, ads sit inert until Full Launch" was wrong.
// With this false, the game never touches SDK.ad or SDK.banner: no requestAd, no
// requestBanner, no clearAllBanners, no hasAdblock — and every rewarded offer falls
// back to its ad-free form through adsUsable() (daily chest just opens, DOUBLE COINS
// and continue-by-ad are hidden, no forced midgame ads).
// Flip to true ONLY when CrazyGames moves the game to Full Launch.
export const ADS_ALLOWED = false;

export const state = {
  available: false,
  environment: 'disabled',
  adblock: false,
  system: null,
  inCrazyApp: false,
  adsEnabled: false,
  gameplayActive: false,
};

const LS_KEY = 'woodcut.save.v1';

export async function initSdk() {
  const sdk = SDK();
  if (!sdk) {
    console.warn('[sdk] CrazyGames SDK not present — running standalone.');
    return state;
  }
  try {
    await sdk.init();
    state.available = true;
    state.environment = sdk.environment || 'disabled';
    try {
      state.system = sdk.user?.getSystemInfo ?? null;
      const appType = state.system?.applicationType;
      state.inCrazyApp = appType === 'apple_store' || appType === 'google_play_store';
    } catch (e) { /* system info is optional */ }
    try {
      state.adblock = ADS_ALLOWED ? await sdk.ad?.hasAdblock?.() : false;
    } catch (e) { state.adblock = false; }
    state.adsEnabled = ADS_ALLOWED && (state.environment === 'crazygames' || state.environment === 'local');
    console.info('[sdk] ready', {
      environment: state.environment,
      adblock: state.adblock,
      inCrazyApp: state.inCrazyApp,
    });
  } catch (err) {
    console.warn('[sdk] init failed', err);
  }
  return state;
}

export function loadingStart() { try { SDK()?.game?.loadingStart?.(); } catch (e) {} }
export function loadingStop() { try { SDK()?.game?.loadingStop?.(); } catch (e) {} }

// gameplayStart/Stop must bracket actual play — CrazyGames measures conversion and
// playtime from these, and they are what Basic Launch is judged on.
//
// The SDK DROPS (does not queue) a second call of the same method inside 1s, logging
// "gameplayStart() call throttled". Pause -> RESUME inside a second therefore used to
// leave the platform believing play had stopped while the player was cutting. So we
// record what the SDK was actually told, and when a call would be throttled we retry
// once the window has passed with whatever the game wants by then.
const GAMEPLAY_THROTTLE_MS = 1000;
const gameplaySent = { active: false, at: { start: -Infinity, stop: -Infinity }, timer: 0 };

function syncGameplay() {
  gameplaySent.timer = 0;
  const want = state.gameplayActive;
  if (want === gameplaySent.active) return;
  const key = want ? 'start' : 'stop';
  const wait = gameplaySent.at[key] + GAMEPLAY_THROTTLE_MS + 50 - performance.now();
  if (wait > 0) {
    gameplaySent.timer = setTimeout(syncGameplay, wait);
    return;
  }
  gameplaySent.at[key] = performance.now();
  gameplaySent.active = want;
  try { SDK()?.game?.[want ? 'gameplayStart' : 'gameplayStop']?.(); } catch (e) {}
}

export function gameplayStart() {
  if (state.gameplayActive) return;
  state.gameplayActive = true;
  if (!gameplaySent.timer) syncGameplay();
}

export function gameplayStop() {
  if (!state.gameplayActive) return;
  state.gameplayActive = false;
  if (!gameplaySent.timer) syncGameplay();
}

export function happytime() { try { SDK()?.game?.happytime?.(); } catch (e) {} }

export function reportProgress(pct) {
  try { SDK()?.game?.reportGameCompletedPercentage?.(Math.round(pct)); } catch (e) {}
}

export function platformMuted() {
  try { return !!SDK()?.game?.settings?.muteAudio; } catch (e) { return false; }
}

export function onSettingsChange(fn) {
  try { SDK()?.game?.addSettingsChangeListener?.(fn); } catch (e) {}
}

// --- Save data -------------------------------------------------------------
// SDK data syncs across devices and migrates guest progress on login. localStorage is
// the fallback, and is also written every time so progress survives an SDK outage.

export function saveData(obj) {
  const json = JSON.stringify(obj);
  try { localStorage.setItem(LS_KEY, json); } catch (e) {}
  try { SDK()?.data?.setItem?.(LS_KEY, json); } catch (e) {}
}

// Dev-only wipe, used by the reset-progress button. Clears both stores rather than
// writing a null over them, so the next load genuinely looks like a first install.
export function clearData() {
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  try { SDK()?.data?.removeItem?.(LS_KEY); } catch (e) {}
  try { SDK()?.data?.setItem?.(LS_KEY, ''); } catch (e) {}
}

export function loadData() {
  let json = null;
  try { json = SDK()?.data?.getItem?.(LS_KEY) ?? null; } catch (e) {}
  if (!json) {
    try { json = localStorage.getItem(LS_KEY); } catch (e) {}
  }
  if (!json) return null;
  try { return JSON.parse(json); } catch (e) { return null; }
}

// --- Ad policy -------------------------------------------------------------
//
// Forced (midgame) ads are far more restricted than CrazyGames requires, on purpose.
// Their own guidance is that ad volume beyond natural placement suppresses playtime,
// and playtime is the multiplier on every impression.
//
//   * No forced ad for the first 10 minutes of a session — but ONLY for a session
//     that is worth spending that on: the player's first ever, or the return of
//     someone who has been away a week or more. See `adGraceFor` in meta.js for why.
//     An established player's session starts with the clock already elapsed.
//   * One is only ever allowed at a player-initiated transition — tapping Next Level,
//     or Retry after a failed board. Never mid-cut, never on load. This does not
//     depend on the grace and is not negotiable.
//   * ANY ad resets the clock, including a rewarded one the player chose. So
//     watching voluntary ads actively pushes forced ads further away, which lines
//     the player's incentive up with ours.

const FORCED_AD_GRACE_MS = 10 * 60 * 1000;
// Starts graced so that nothing can slip an ad in during boot, before the save has
// been read and `applyAdGrace` has had its say. Opening the gate is always an explicit
// act; closing it is the default.
let lastAdAt = Date.now();

// Called once, straight after the save loads. `grace` false means this is an ordinary
// returning player and the ten minutes are not spent on them.
export function applyAdGrace(grace) {
  lastAdAt = grace ? Date.now() : 0;
}

export function markAdShown() {
  lastAdAt = Date.now();
}

// Dev-only: pretend the 10-minute grace has already elapsed, so the next
// player-initiated transition really does run a forced midgame ad. Testing the forced
// path otherwise means sitting through ten minutes of play.
export function expireAdGrace() {
  lastAdAt = 0;
}

export function forcedAdDue() {
  return Date.now() - lastAdAt >= FORCED_AD_GRACE_MS;
}

export function msUntilForcedAd() {
  return Math.max(0, FORCED_AD_GRACE_MS - (Date.now() - lastAdAt));
}

// --- Ads -------------------------------------------------------------------
//
// Contract for both ad types: the caller pauses the game and mutes audio on start, and
// resumes on BOTH finish and error. A rewarded ad grants its reward only on adFinished
// — never on adError.

// Watchdogs. An ad provider that never calls back would otherwise leave the player
// staring at a cover screen forever, so we always resume the game on our own timer.
const AD_START_TIMEOUT = 9000;    // no adStarted and no terminal callback by now
const AD_TOTAL_TIMEOUT = 125000;  // ad started but never finished

function requestAd(type, { onStart, onFinish, onError }) {
  const sdk = SDK();
  if (!ADS_ALLOWED || !sdk?.ad?.requestAd || !state.adsEnabled) {
    onError?.({ code: 'unavailable' });
    return;
  }
  let settled = false;
  let timer = null;
  const settle = (fn, arg) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn?.(arg);
  };
  const arm = (ms, code) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.warn(`[sdk] ad ${code} after ${ms}ms — resuming game`);
      settle(onError, { code });
    }, ms);
  };

  arm(AD_START_TIMEOUT, 'noResponse');
  try {
    sdk.ad.requestAd(type, {
      adStarted: () => {
        if (settled) return;
        arm(AD_TOTAL_TIMEOUT, 'stalled');
        onStart?.();
      },
      adFinished: () => settle(onFinish),
      adError: (err) => settle(onError, err || { code: 'other' }),
    });
  } catch (err) {
    settle(onError, { code: 'other', err });
  }
}

// Midgame ads are requested only on a player-initiated transition (the Next Level tap),
// never on level load and never during play. The SDK enforces its own 1-per-3-minutes
// cap and silently ignores early requests, so we don't add frequency logic here.
export function showMidgameAd(handlers) {
  requestAd('midgame', handlers);
}

export function showRewardedAd(handlers) {
  requestAd('rewarded', handlers);
}

export function adsUsable() {
  return state.adsEnabled && !state.adblock;
}

// The local SDK paints its demo ad as `div#local-overlay` — fixed, z-index 10000,
// pointer-events on — and runs its own countdown to completion. Resolving OUR ad
// promise therefore did nothing visible: the dev skip button restored the game state
// underneath, but the grey overlay stayed on top swallowing every click until the
// demo timer ran out on its own. Tearing the element down is the only thing that
// actually ends the local ad.
//
// Guarded on the local environment, so on a real CrazyGames host this finds nothing
// and is a no-op. It must never be able to dismiss a real ad.
export function dismissLocalAd() {
  if (state.environment !== 'local'
    && !['localhost', '127.0.0.1'].includes(location.hostname)) return false;
  let gone = false;
  document.querySelectorAll('#local-overlay').forEach((el) => { el.remove(); gone = true; });
  return gone;
}

// --- Banners ---------------------------------------------------------------
//
// Every constraint here is a §3 rule, enforced in code rather than trusted to
// discipline, because banner violations are a rejection trigger:
//
//   * Desktop side panels and full-screen menus ONLY. Never during gameplay.
//   * At most 2 containers on screen.
//   * >= 30s between refreshes of the same container.
//   * <= 120 refreshes per session per size.
//   * Cleared before any video ad plays.
//   * Never inside the CrazyGames mobile app — banners aren't served there.

const BANNER_MIN_REFRESH_MS = 30000;
const BANNER_MAX_PER_SESSION = 120;
const MAX_CONTAINERS = 2;

const banners = new Map();          // id -> { el, size, lastAt, shown }
let bannerRefreshCount = 0;

export function bannersAllowed() {
  return ADS_ALLOWED
    && state.available
    && !state.adblock
    && !state.inCrazyApp
    && (state.environment === 'crazygames' || state.environment === 'local')
    && bannerRefreshCount < BANNER_MAX_PER_SESSION;
}

// `rect` is in CSS pixels. The caller owns placement; this owns policy.
export function showBanner(id, rect, size = [300, 250]) {
  if (!bannersAllowed()) return false;
  if (!banners.has(id) && banners.size >= MAX_CONTAINERS) return false;

  let entry = banners.get(id);
  if (!entry) {
    const el = document.createElement('div');
    el.id = `banner-${id}`;
    el.style.cssText = 'position:fixed;z-index:5;overflow:hidden;'
      + 'border-radius:10px;background:rgba(8,12,16,0.55);pointer-events:auto;';
    document.body.appendChild(el);
    entry = { el, size, lastAt: 0, shown: false };
    banners.set(id, entry);
  }
  const [w, h] = size;
  entry.el.style.left = `${Math.round(rect.x)}px`;
  entry.el.style.top = `${Math.round(rect.y)}px`;
  entry.el.style.width = `${w}px`;
  entry.el.style.height = `${h}px`;
  const now = Date.now();
  // The 30s floor is measured from the last REQUEST, whatever happened since. It used
  // to be skipped whenever `shown` was false — and clearBanners() sets it false, so
  // every pause/resume flip re-requested at once (measured 2 -> 14 refreshes in a few
  // seconds). A container cleared inside the window simply stays empty until it ends.
  if (now - entry.lastAt < BANNER_MIN_REFRESH_MS) {
    entry.el.hidden = !entry.shown;
    return entry.shown;
  }
  entry.el.hidden = false;
  entry.lastAt = now;
  entry.shown = true;
  bannerRefreshCount++;
  try {
    // requestBanner returns a PROMISE, and it rejects whenever the container does
    // not fill — which is the normal case in local mode and a routine one in
    // production. A bare try/catch only guards the synchronous throw, so the
    // rejection escaped as "Uncaught (in promise)" on every desktop load. An unfilled
    // banner is not an error the player or a reviewer should ever see in the console.
    const r = SDK()?.banner?.requestBanner?.({
      id: entry.el.id,
      width: w,
      height: h,
    });
    if (r && typeof r.catch === 'function') r.catch(() => { entry.shown = false; });
  } catch (err) {
    entry.shown = false;
  }
  return true;
}

export function hideBanner(id) {
  const entry = banners.get(id);
  if (!entry) return;
  entry.el.hidden = true;
}

// Called before every video ad and whenever gameplay resumes. Clearing rather than
// merely hiding is what the platform asks for.
export function clearBanners() {
  for (const [, entry] of banners) {
    entry.el.hidden = true;
    entry.shown = false;
  }
  // Not even a clear while ads are off: this exact call is what the Basic Launch
  // checker flagged as "ads detected".
  if (!ADS_ALLOWED) return;
  try {
    const r = SDK()?.banner?.clearAllBanners?.();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (err) { /* no banner API */ }
}

export function bannerDebug() {
  return {
    allowed: bannersAllowed(),
    containers: banners.size,
    refreshes: bannerRefreshCount,
    visible: [...banners.entries()].filter(([, e]) => !e.el.hidden).map(([k]) => k),
  };
}
