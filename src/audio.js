// WebAudio, fully synthesised — no audio files, so nothing to download.
//
// Audio is the primary moment-to-moment feedback channel: the blade whine bends with
// tracking error, so the player hears they're drifting before they see it.
//
// iOS suspends the AudioContext when backgrounded and only allows resuming inside a
// user gesture, hence the unlock listeners at the bottom.

import { startMusic, state as musicState, MUSIC_INFO } from './music.js';

let ctx = null;
let master = null;
let sfx = null;        // every sound effect, including the saw — the SFX slider
let musicBus = null;   // music.js — the MUSIC slider
let ready = false;
let muted = false;
// 0..1 slider positions. Applied squared, because loudness is heard roughly
// logarithmically and a linear slider crowds all the change into its bottom quarter.
let sfxVol = 0.85;
let musicVol = 0.45;

const nodes = {};

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  // Honour a mute set before the first gesture created the context — setMuted() had
  // nothing to write to then, and this line used to hard-set 0.9 over it.
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  sfx = ctx.createGain();
  sfx.gain.value = sfxVol * sfxVol;
  sfx.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = musicVol * musicVol;
  musicBus.connect(master);
  startMusic(ctx, musicBus);

  // --- Motor: low sawtooth + hum, always running, gated by gain.
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.value = 78;
  const motorFilter = ctx.createBiquadFilter();
  motorFilter.type = 'lowpass';
  motorFilter.frequency.value = 420;
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0;
  motor.connect(motorFilter).connect(motorGain).connect(sfx);
  motor.start();

  // --- Blade whine: the pitch of this is the accuracy readout.
  const whine = ctx.createOscillator();
  whine.type = 'triangle';
  whine.frequency.value = 620;
  const whineGain = ctx.createGain();
  whineGain.gain.value = 0;
  whine.connect(whineGain).connect(sfx);
  whine.start();

  // --- Cutting texture: filtered noise, brighter the worse the cut.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(2);
  src.loop = true;
  const cutFilter = ctx.createBiquadFilter();
  cutFilter.type = 'bandpass';
  cutFilter.frequency.value = 1400;
  cutFilter.Q.value = 0.9;
  const cutGain = ctx.createGain();
  cutGain.gain.value = 0;
  src.connect(cutFilter).connect(cutGain).connect(sfx);
  src.start();

  Object.assign(nodes, { motor, motorGain, whine, whineGain, cutFilter, cutGain });
  ready = true;
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.9;
}

export function isMuted() {
  return muted;
}

export function setVolumes(sfxV, musicV) {
  if (typeof sfxV === 'number') sfxVol = Math.max(0, Math.min(1, sfxV));
  if (typeof musicV === 'number') musicVol = Math.max(0, Math.min(1, musicV));
  if (!ctx) return;
  sfx.gain.setTargetAtTime(sfxVol * sfxVol, ctx.currentTime, 0.03);
  musicBus.gain.setTargetAtTime(musicVol * musicVol, ctx.currentTime, 0.03);
}

export function getMusic() {
  return { ...musicState, ...MUSIC_INFO };
}

export function getVolumes() {
  return { sfx: sfxVol, music: musicVol };
}

// Any state other than running/closed is resumable. iOS Safari uses a THIRD state,
// 'interrupted' (a call, the lock button, switching apps), which this used to ignore —
// so on an iPhone the game went silent after any interruption until a reload.
export function resumeAudio() {
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
    try { ctx.resume().catch(() => {}); } catch (e) { /* resumed on the next gesture */ }
  }
}

export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

const at = () => (ctx ? ctx.currentTime : 0);

// Per-material cutting profiles. Sawing steel should not sound like sawing pine, and
// the material is a big part of what makes each level feel like a different place.
const PROFILES = {
  softwood: { whine: 760, bend: 300, cutFreq: 900, cutSpread: 2600, cutGain: 0.05, cutQ: 0.9, motor: 72, whineType: 'triangle', whineGain: 0.035 },
  hardwood: { whine: 640, bend: 260, cutFreq: 700, cutSpread: 2200, cutGain: 0.07, cutQ: 1.3, motor: 64, whineType: 'triangle', whineGain: 0.040 },
  rotten:   { whine: 430, bend: 200, cutFreq: 480, cutSpread: 1500, cutGain: 0.10, cutQ: 0.6, motor: 58, whineType: 'sine', whineGain: 0.028 },
  // Metal was a 1560Hz SAWTOOTH over a Q 5.5 noise band swept up to 7.4kHz, and the
  // owner reported it hurt to listen to (2026-09-26). A sawtooth's harmonics run up
  // into the range the ear is most sensitive to, and a narrow resonant band up there
  // rings. Metal still sits above the woods — grindy, not shrill: a triangle an octave
  // lower, and a wider, lower noise band that opens only a little when off the line.
  metal:    { whine: 880, bend: 240, cutFreq: 1700, cutSpread: 1300, cutGain: 0.045, cutQ: 2.2, motor: 84, whineType: 'triangle', whineGain: 0.024 },
  ice:      { whine: 1180, bend: 380, cutFreq: 2600, cutSpread: 3400, cutGain: 0.045, cutQ: 3.2, motor: 70, whineType: 'sine', whineGain: 0.032 },
};

let profile = PROFILES.softwood;

export function setMaterialProfile(kind) {
  profile = PROFILES[kind] || PROFILES.softwood;
  if (ready) nodes.whine.type = profile.whineType;
}

// The saw is the one sound that never stops, so it sits well under everything else.
// The owner found it abrasive at its original level (2026-10-04). SAW_LEVEL scales the
// motor and the cutting noise (about -6 dB); the whine - a steady tone, and the part
// that grates over a whole board - comes down further (about -10 dB). The pitch still
// bends with accuracy, so it still tells the player how the cut is going.
const SAW_LEVEL = 0.5;
const WHINE_LEVEL = 0.32;

// Continuous saw sound. `err01` is normalised tracking error, 0 = dead on the line.
export function updateSaw(running, err01, speed01) {
  if (!ready) return;
  const t = at();
  const p = profile;
  const { motorGain, whine, whineGain, cutGain, cutFilter, motor } = nodes;
  if (!running) {
    motorGain.gain.setTargetAtTime(0, t, 0.08);
    whineGain.gain.setTargetAtTime(0, t, 0.08);
    cutGain.gain.setTargetAtTime(0, t, 0.08);
    return;
  }
  motor.frequency.setTargetAtTime(p.motor + speed01 * 34, t, 0.2);
  motorGain.gain.setTargetAtTime(0.13 * SAW_LEVEL, t, 0.1);
  // On the line: high, clean whine. Drifting off: pitch sags and noise opens up.
  whine.frequency.setTargetAtTime(p.whine - err01 * p.bend, t, 0.05);
  whineGain.gain.setTargetAtTime((p.whineGain + (1 - err01) * 0.03) * WHINE_LEVEL, t, 0.08);
  cutFilter.Q.setTargetAtTime(p.cutQ, t, 0.1);
  cutFilter.frequency.setTargetAtTime(p.cutFreq + err01 * p.cutSpread, t, 0.06);
  cutGain.gain.setTargetAtTime((p.cutGain + err01 * 0.14) * SAW_LEVEL, t, 0.06);
}

function env(gain, peak, attack, decay) {
  const t = at();
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export function chime(step) {
  if (!ready) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  // Pentatonic ladder so a rising streak always sounds consonant.
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const semi = scale[Math.min(scale.length - 1, step)];
  o.frequency.value = 523.25 * Math.pow(2, semi / 12);
  o.connect(g).connect(sfx);
  env(g, 0.22, 0.006, 0.30);
  o.start();
  o.stop(at() + 0.4);
}

export function splinter() {
  if (!ready) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(0.3);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2600, at());
  f.frequency.exponentialRampToValueAtTime(300, at() + 0.22);
  const g = ctx.createGain();
  s.connect(f).connect(g).connect(sfx);
  env(g, 0.36, 0.004, 0.24);
  s.start();
  s.stop(at() + 0.32);
}

export function thunk(freq, peak, dur) {
  if (!ready) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, at());
  o.frequency.exponentialRampToValueAtTime(freq * 0.4, at() + dur);
  o.connect(g).connect(sfx);
  env(g, peak, 0.005, dur);
  o.start();
  o.stop(at() + dur + 0.1);
}

export function coinBlip(i) {
  if (!ready) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = 900 + i * 55;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 3200;
  o.connect(f).connect(g).connect(sfx);
  env(g, 0.10, 0.004, 0.10);
  o.start();
  o.stop(at() + 0.18);
}

export function fanfare() {
  if (!ready) return;
  [0, 4, 7, 12].forEach((semi, i) => {
    setTimeout(() => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 523.25 * Math.pow(2, semi / 12);
      o.connect(g).connect(sfx);
      env(g, 0.24, 0.008, 0.5);
      o.start();
      o.stop(at() + 0.6);
    }, i * 85);
  });
}

// The flawless fanfare. Deliberately much bigger than fanfare(): a rising major
// arpeggio doubled an octave up, a sustained pad underneath it, and a low boom on the
// downbeat. A 100% cut should be audibly a different event from a 3-star cut, not the
// same jingle slightly louder.
export function bigFanfare() {
  if (!ready) return;

  // Low boom: the explosion.
  const boom = ctx.createOscillator();
  const bg = ctx.createGain();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(150, at());
  boom.frequency.exponentialRampToValueAtTime(38, at() + 0.5);
  boom.connect(bg).connect(sfx);
  env(bg, 0.5, 0.004, 0.62);
  boom.start();
  boom.stop(at() + 0.72);

  // Noise burst on top of the boom, so it cracks rather than just thumping.
  const len = Math.floor(ctx.sampleRate * 0.3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 1700;
  const ng = ctx.createGain();
  src.connect(nf).connect(ng).connect(sfx);
  env(ng, 0.26, 0.002, 0.3);
  src.start();

  // Arpeggio, doubled an octave up.
  [0, 4, 7, 12, 16, 19].forEach((semi, i) => {
    setTimeout(() => {
      if (!ready) return;
      for (const mul of [1, 2]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = mul === 1 ? 'triangle' : 'sine';
        o.frequency.value = 523.25 * Math.pow(2, semi / 12) * mul;
        o.connect(g).connect(sfx);
        env(g, mul === 1 ? 0.22 : 0.1, 0.006, 0.55);
        o.start();
        o.stop(at() + 0.7);
      }
    }, i * 72);
  });

  // Sustained pad so the whole thing lands as a chord rather than six blips.
  setTimeout(() => {
    if (!ready) return;
    for (const f of [261.63, 329.63, 392.0]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(g).connect(sfx);
      env(g, 0.13, 0.10, 1.5);
      o.start();
      o.stop(at() + 1.7);
    }
  }, 150);
}

// Nailing a hard corner: a bright rising two-note flourish, distinct from the combo
// chimes so it's recognisable as its own reward.
export function perfectTurn() {
  if (!ready) return;
  [0, 7].forEach((semi, i) => {
    setTimeout(() => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 1046.5 * Math.pow(2, semi / 12);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2400;
      f.Q.value = 1.2;
      o.connect(f).connect(g).connect(sfx);
      env(g, 0.20, 0.004, 0.26);
      o.start();
      o.stop(at() + 0.35);
    }, i * 70);
  });
}

// Hitting one of the silly embedded objects.
export function objectHit() {
  if (!ready) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(420, at());
  o.frequency.exponentialRampToValueAtTime(1180, at() + 0.13);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 2600;
  o.connect(f).connect(g).connect(sfx);
  env(g, 0.24, 0.005, 0.20);
  o.start();
  o.stop(at() + 0.32);
}

export function comboUp(tier) {
  if (!ready) return;
  const roots = [523.25, 659.25, 783.99, 987.77, 1174.66];
  const base = roots[Math.min(roots.length - 1, tier)];
  [0, 4, 7].forEach((semi, i) => {
    setTimeout(() => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = base * Math.pow(2, semi / 12);
      o.connect(g).connect(sfx);
      env(g, 0.19, 0.005, 0.34);
      o.start();
      o.stop(at() + 0.45);
    }, i * 55);
  });
}

export function comboLost() {
  if (!ready) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(520, at());
  o.frequency.exponentialRampToValueAtTime(180, at() + 0.28);
  o.connect(g).connect(sfx);
  env(g, 0.16, 0.006, 0.26);
  o.start();
  o.stop(at() + 0.4);
}

export function keyChime() {
  if (!ready) return;
  [0, 12, 19].forEach((semi, i) => {
    setTimeout(() => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880 * Math.pow(2, semi / 12);
      o.connect(g).connect(sfx);
      env(g, 0.17, 0.003, 0.42);
      o.start();
      o.stop(at() + 0.55);
    }, i * 60);
  });
}

export function failSound() {
  if (!ready) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(320, at());
  o.frequency.exponentialRampToValueAtTime(90, at() + 0.55);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1100;
  o.connect(f).connect(g).connect(sfx);
  env(g, 0.28, 0.01, 0.5);
  o.start();
  o.stop(at() + 0.7);
}

// --- UI sounds (2026-09-28) ------------------------------------------------------
// The owner asked that EVERY action make a sound. Buttons already played a 520Hz
// sine thunk, but at 90ms with a pitch drop it was a dull thump that disappeared
// under anything else playing. uiClick is a short wood-block tick with a bright
// transient, which cuts through at a low level.

export function uiClick(pitch = 1) {
  if (!ready) return;
  const t = at();
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(1250 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.05);
  const g = ctx.createGain();
  o.connect(g).connect(sfx);
  env(g, 0.2, 0.002, 0.06);
  o.start(t);
  o.stop(t + 0.1);
  const s = ctx.createBufferSource();
  s.buffer = clickNoise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 3800 * pitch;
  f.Q.value = 1.5;
  const ng = ctx.createGain();
  s.connect(f).connect(ng).connect(sfx);
  env(ng, 0.12, 0.001, 0.025);
  s.start(t);
  s.stop(t + 0.05);
}

let clickBuf = null;
function clickNoise() {
  if (!clickBuf) clickBuf = noiseBuffer(0.06);
  return clickBuf;
}

// A coin landing in the counter: two bright partials, slightly randomised so a run of
// them sparkles instead of machine-gunning the same note.
export function coinCollect(i = 0) {
  if (!ready) return;
  const t = at();
  const base = 1480 * Math.pow(2, ((i % 5) * 2 + Math.random() * 0.4) / 12);
  [[1, 0.09, 0.16], [2.4, 0.05, 0.09]].forEach(([mul, peak, dec], k) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(base * mul, t + k * 0.035);
    const g = ctx.createGain();
    o.connect(g).connect(sfx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueAtTime(0.0001, t + k * 0.035);
    g.gain.exponentialRampToValueAtTime(peak, t + k * 0.035 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.035 + dec);
    o.start(t);
    o.stop(t + 0.3);
  });
}

// Spending coins: a cash-register "ka-ching" — a mechanical clack then a bell.
export function purchase() {
  if (!ready) return;
  thunk(260, 0.18, 0.07);
  setTimeout(() => {
    if (!ready) return;
    const t = at();
    for (const [f, peak] of [[2093, 0.12], [2637, 0.08], [3136, 0.05]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      o.connect(g).connect(sfx);
      env(g, peak, 0.003, 0.5);
      o.start(t);
      o.stop(t + 0.6);
    }
  }, 70);
}

// Can't afford / locked: a soft low double-bump, never harsh.
export function denied() {
  if (!ready) return;
  thunk(200, 0.14, 0.08);
  setTimeout(() => thunk(160, 0.12, 0.1), 90);
}

// Screen change: a short airy swish.
export function whoosh() {
  if (!ready) return;
  const t = at();
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(0.3);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(600, t);
  f.frequency.exponentialRampToValueAtTime(3200, t + 0.2);
  const g = ctx.createGain();
  s.connect(f).connect(g).connect(sfx);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.07, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  s.start(t);
  s.stop(t + 0.3);
}

// A star landing on the results panel.
export function starLand(i = 0) {
  if (!ready) return;
  const t = at();
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = [784, 988, 1175, 1568][Math.min(3, i)];
  const g = ctx.createGain();
  o.connect(g).connect(sfx);
  env(g, 0.2, 0.004, 0.35);
  o.start(t);
  o.stop(t + 0.45);
  thunk(180, 0.16, 0.12);
}

// iOS: the context can only be created/resumed from inside a user gesture, and it
// drops back to suspended whenever the page is backgrounded.
function unlock() {
  initAudio();
  resumeAudio();
}
['touchend', 'pointerdown', 'click', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, unlock, { passive: true })
);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resumeAudio();
});
