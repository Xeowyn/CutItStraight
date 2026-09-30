// Background music — synthesised in WebAudio like every other sound, so it costs
// nothing to download.
//
// Built 2026-09-28 because the owner wanted music that doesn't get repetitive. So it is
// not a loop: it is a sequencer walking through SEVEN sections, each with its own key,
// groove and instruments (e-piano, plucked guitar, marimba, pads and bells, a whistled
// tune, a music box, funky bass and clav), 16 bars each at 92 BPM — about five minutes
// before the section order comes round again. Melodies are generated per pass from a
// seeded motif (A A' B A shape, so they sound composed rather than random), and the
// seed changes every pass, so even the second time through a section the tune differs.
//
// Mixed deliberately low and routed to its own bus (audio.js `musicBus`), so the
// player's MUSIC slider sets it independently of the sound effects.

let ctx = null;
let out = null;        // this module's input into the music bus
let reverb = null;     // send
let noise = null;
let timer = 0;
let nextBarTime = 0;
let barIndex = 0;
let pass = 0;
const plucks = new Map();

const BPM = 92;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS_PER_SECTION = 16;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// --- Seeded RNG so a pass's melodies are stable while it plays ------------------
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// --- Instruments ---------------------------------------------------------------
// Each takes (t, midi, dur, vel) and schedules its own nodes at time t.

function envGain(t, peak, attack, hold, release) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return g;
}

function osc(type, freq, t, stop) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(stop);
  return o;
}

function send(node, wet) {
  node.connect(out);
  if (wet > 0) {
    const s = ctx.createGain();
    s.gain.value = wet;
    node.connect(s).connect(reverb);
  }
}

// Two-operator FM electric piano: soft bell-ish attack, warm body.
function epiano(t, m, dur, vel) {
  const f = mtof(m);
  const end = t + dur + 1.2;
  const car = osc('sine', f, t, end);
  const mod = osc('sine', f, t, end);
  const idx = ctx.createGain();
  idx.gain.setValueAtTime(f * 1.6, t);
  idx.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.5);
  mod.connect(idx).connect(car.frequency);
  const g = envGain(t, 0.07 * vel, 0.006, dur * 0.4, dur * 0.6 + 1.0);
  car.connect(g);
  send(g, 0.35);
}

// Karplus-Strong plucked string, buffers cached per note.
function pluckBuffer(m) {
  if (plucks.has(m)) return plucks.get(m);
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.6);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const period = Math.max(2, Math.round(sr / mtof(m)));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  let p = 0;
  for (let i = 0; i < len; i++) {
    const nx = (p + 1) % period;
    const v = (ring[p] + ring[nx]) * 0.4965;
    d[i] = ring[p];
    ring[p] = v;
    p = nx;
  }
  plucks.set(m, buf);
  return buf;
}

function pluck(t, m, dur, vel) {
  const s = ctx.createBufferSource();
  s.buffer = pluckBuffer(m);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 3200;
  const g = envGain(t, 0.16 * vel, 0.002, Math.min(dur, 1.2), 0.25);
  s.connect(f).connect(g);
  send(g, 0.25);
  s.start(t);
  s.stop(t + Math.min(dur, 1.2) + 0.3);
}

function marimba(t, m, dur, vel) {
  const f = mtof(m);
  const a = osc('sine', f, t, t + 0.9);
  const b = osc('sine', f * 4, t, t + 0.2);
  const ga = envGain(t, 0.11 * vel, 0.003, 0, 0.55);
  const gb = envGain(t, 0.03 * vel, 0.002, 0, 0.09);
  a.connect(ga); b.connect(gb);
  send(ga, 0.3); send(gb, 0.1);
}

function bass(t, m, dur, vel) {
  const f = mtof(m);
  const end = t + dur + 0.3;
  const a = osc('triangle', f, t, end);
  const b = osc('sine', f / 2, t, end);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  const g = envGain(t, 0.13 * vel, 0.01, dur * 0.7, 0.2);
  a.connect(lp); b.connect(lp); lp.connect(g);
  send(g, 0);
}

function funkBass(t, m, dur, vel) {
  const f = mtof(m);
  const end = t + dur + 0.2;
  const a = osc('sawtooth', f, t, end);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 6;
  lp.frequency.setValueAtTime(2000, t);
  lp.frequency.exponentialRampToValueAtTime(260, t + 0.18);
  const g = envGain(t, 0.09 * vel, 0.005, dur * 0.6, 0.12);
  a.connect(lp).connect(g);
  send(g, 0);
}

function pad(t, m, dur, vel) {
  const f = mtof(m);
  const end = t + dur + 1.6;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  const g = envGain(t, 0.028 * vel, 0.6, Math.max(0, dur - 0.6), 1.4);
  for (const det of [-7, 7]) {
    const o = osc('sawtooth', f, t, end);
    o.detune.value = det;
    o.connect(lp);
  }
  lp.connect(g);
  send(g, 0.5);
}

function bell(t, m, dur, vel) {
  const f = mtof(m);
  const end = t + 2.2;
  const car = osc('sine', f, t, end);
  const mod = osc('sine', f * 3.5, t, end);
  const idx = ctx.createGain();
  idx.gain.setValueAtTime(f * 2.2, t);
  idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.4);
  mod.connect(idx).connect(car.frequency);
  const g = envGain(t, 0.05 * vel, 0.004, 0, 1.9);
  car.connect(g);
  send(g, 0.6);
}

function musicBox(t, m, dur, vel) {
  const f = mtof(m);
  const a = osc('sine', f, t, t + 1.4);
  const b = osc('sine', f * 2.01, t, t + 0.5);
  const ga = envGain(t, 0.06 * vel, 0.002, 0, 1.2);
  const gb = envGain(t, 0.02 * vel, 0.002, 0, 0.35);
  a.connect(ga); b.connect(gb);
  send(ga, 0.55); send(gb, 0.4);
}

function whistle(t, m, dur, vel) {
  const f = mtof(m);
  const end = t + dur + 0.25;
  const o = osc('sine', f, t, end);
  // Slide into the note, then a gentle vibrato once it has settled.
  o.frequency.setValueAtTime(f * 0.97, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  const lfo = osc('sine', 5.4, t, end);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.3, dur));
  lfo.connect(depth).connect(o.frequency);
  const g = envGain(t, 0.05 * vel, 0.04, Math.max(0, dur - 0.08), 0.18);
  o.connect(g);
  send(g, 0.4);
}

function clav(t, m, dur, vel) {
  const f = mtof(m);
  const o = osc('square', f, t, t + 0.35);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f * 3;
  bp.Q.value = 1.4;
  const g = envGain(t, 0.07 * vel, 0.002, 0.03, 0.16);
  o.connect(bp).connect(g);
  send(g, 0.15);
}

// --- Drums -----------------------------------------------------------------------

function noiseHit(t, type, freq, q, peak, decay, wet = 0.1) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = envGain(t, peak, 0.001, 0, decay);
  s.connect(f).connect(g);
  send(g, wet);
  s.start(t, Math.random() * 1.5);
  s.stop(t + decay + 0.05);
}

const DRUM = {
  kick(t, v) {
    const o = osc('sine', 120, t, t + 0.35);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = envGain(t, 0.26 * v, 0.002, 0.02, 0.26);
    o.connect(g);
    send(g, 0);
  },
  snare(t, v) {
    noiseHit(t, 'bandpass', 1900, 0.7, 0.10 * v, 0.16, 0.25);
    const o = osc('triangle', 190, t, t + 0.12);
    const g = envGain(t, 0.06 * v, 0.001, 0, 0.09);
    o.connect(g);
    send(g, 0.1);
  },
  rim(t, v) {
    const o = osc('triangle', 1650, t, t + 0.06);
    const g = envGain(t, 0.05 * v, 0.001, 0, 0.04);
    o.connect(g);
    send(g, 0.2);
  },
  hat(t, v) { noiseHit(t, 'highpass', 7200, 0.8, 0.035 * v, 0.04, 0.05); },
  openHat(t, v) { noiseHit(t, 'highpass', 6800, 0.8, 0.03 * v, 0.22, 0.1); },
  shaker(t, v) { noiseHit(t, 'bandpass', 5200, 1.2, 0.03 * v, 0.07, 0.05); },
  clap(t, v) {
    for (let i = 0; i < 3; i++) noiseHit(t + i * 0.011, 'bandpass', 1400, 1.1, 0.07 * v, 0.07, 0.3);
  },
  stomp(t, v) {
    const o = osc('sine', 90, t, t + 0.25);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    const g = envGain(t, 0.2 * v, 0.003, 0, 0.2);
    o.connect(g);
    send(g, 0.15);
    noiseHit(t, 'lowpass', 600, 0.7, 0.05 * v, 0.06, 0.1);
  },
};

// --- Harmony ---------------------------------------------------------------------

const Q = {
  maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10], sus2: [0, 2, 7], add9: [0, 4, 7, 14],
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// [root midi (octave 3), quality] per bar, repeated to fill the section.
const SECTIONS = [
  { // 1. Morning coffee — e-piano and a brushed shaker, C major.
    name: 'morning', key: 60, scale: MAJOR, swing: 0.12,
    prog: [[48, 'maj7'], [45, 'm7'], [50, 'm7'], [43, 'dom7']],
    chords: 'epianoComp', bass: 'rootFifth', lead: 'epiano', leadOct: 12, drums: 'brush',
    density: 0.45,
  },
  { // 2. Workbench — plucked guitar arpeggios, walking upright bass, G major.
    name: 'workbench', key: 55, scale: MAJOR, swing: 0.18,
    prog: [[43, 'maj'], [40, 'min'], [48, 'maj'], [50, 'maj']],
    chords: 'pluckArp', bass: 'walk', lead: 'pluck', leadOct: 12, drums: 'rimGroove',
    density: 0.5,
  },
  { // 3. Sawdust — marimba melody over pizzicato-ish plucks, F major, brighter.
    name: 'sawdust', key: 53, scale: MAJOR, swing: 0,
    prog: [[41, 'maj'], [50, 'min'], [46, 'maj'], [48, 'maj'], [41, 'maj'], [45, 'min'], [46, 'maj'], [48, 'sus2']],
    chords: 'pluckStab', bass: 'rootFifth', lead: 'marimba', leadOct: 24, drums: 'light',
    density: 0.62,
  },
  { // 4. Night shift — minor, slow pads and bells, sparse hats.
    name: 'night', key: 57, scale: MINOR, swing: 0,
    prog: [[45, 'm7'], [41, 'maj7'], [48, 'maj'], [43, 'maj'], [50, 'm7'], [45, 'min'], [52, 'maj'], [52, 'dom7']],
    chords: 'padHold', bass: 'longRoot', lead: 'bell', leadOct: 12, drums: 'sparse',
    density: 0.3,
  },
  { // 5. Whistle while you work — folky whistled tune, strummed guitar, stomp-clap, D major.
    name: 'whistle', key: 62, scale: MAJOR, swing: 0.08,
    prog: [[50, 'maj'], [43, 'maj'], [45, 'maj'], [50, 'maj'], [47, 'min'], [43, 'maj'], [45, 'sus2'], [45, 'maj']],
    chords: 'strum', bass: 'rootFifth', lead: 'whistle', leadOct: 12, drums: 'stompClap',
    density: 0.48,
  },
  { // 6. Music box — a breather: pad and music-box arpeggio only, Eb major.
    name: 'musicbox', key: 63, scale: MAJOR, swing: 0,
    prog: [[51, 'add9'], [48, 'm7'], [44, 'maj7'], [46, 'sus2']],
    chords: 'padHold', bass: 'none', lead: 'musicBox', leadOct: 12, drums: 'none',
    density: 0.0, arp: true,
  },
  { // 7. Clocking off — funky bass, clav, full kit, C minor-ish dorian.
    name: 'funk', key: 60, scale: [0, 2, 3, 5, 7, 9, 10], swing: 0.1,
    prog: [[48, 'm7'], [48, 'm7'], [53, 'dom7'], [53, 'dom7'], [51, 'maj7'], [50, 'm7'], [55, 'dom7'], [55, 'dom7']],
    chords: 'clavChop', bass: 'funk', lead: 'epiano', leadOct: 12, drums: 'funk',
    density: 0.42,
  },
];

const LEADS = { epiano, pluck, marimba, bell, whistle, musicBox };

// --- Parts ----------------------------------------------------------------------

function chordNotes(root, q, octaveUp = 12) {
  return Q[q].map((iv) => root + octaveUp + iv);
}

function playChords(kind, t0, root, q, R, swing) {
  const notes = chordNotes(root, q);
  const at = (step) => t0 + step * BEAT / 2 + (step % 2 ? swing * BEAT : 0);
  switch (kind) {
    case 'epianoComp':
      notes.forEach((n) => epiano(t0, n, BEAT * 1.6, 0.8));
      if (R() < 0.7) notes.forEach((n) => epiano(at(5), n, BEAT * 1.2, 0.55));
      break;
    case 'pluckArp': {
      const seq = [0, 1, 2, 1, 2, 3 % notes.length, 2, 1];
      seq.forEach((i, s) => pluck(at(s), notes[i % notes.length], BEAT, s % 2 ? 0.55 : 0.8));
      break;
    }
    case 'pluckStab':
      [0, 3, 4, 7].forEach((s) => notes.forEach((n) => pluck(at(s), n, BEAT * 0.4, 0.45)));
      break;
    case 'padHold':
      notes.forEach((n) => pad(t0, n, BAR, 1));
      break;
    case 'strum':
      [0, 2, 3, 5, 6].forEach((s, k) => {
        const order = k % 2 ? [...notes].reverse() : notes;
        order.forEach((n, i) => pluck(at(s) + i * 0.012, n, BEAT, k === 0 ? 0.7 : 0.45));
      });
      break;
    case 'clavChop':
      [1, 3, 4, 6, 7].forEach((s) => notes.forEach((n) => clav(at(s), n + 12, BEAT * 0.25, 0.7)));
      notes.forEach((n) => pad(t0, n, BAR, 0.5));
      break;
    default: break;
  }
}

function playBass(kind, t0, root, q, nextRoot, swing) {
  const fifth = root + 7;
  const at = (step) => t0 + step * BEAT / 2 + (step % 2 ? swing * BEAT : 0);
  switch (kind) {
    case 'rootFifth':
      bass(at(0), root, BEAT * 1.4, 1);
      bass(at(4), fifth - 12 >= 28 ? fifth - 12 : fifth, BEAT * 0.9, 0.8);
      bass(at(6), root, BEAT * 0.8, 0.7);
      break;
    case 'walk': {
      const third = root + Q[q][1];
      const approach = nextRoot + (nextRoot > root ? -1 : 1);
      [root, third, fifth, approach].forEach((n, i) => bass(t0 + i * BEAT, n, BEAT * 0.85, i ? 0.8 : 1));
      break;
    }
    case 'longRoot':
      bass(t0, root, BAR * 0.95, 0.9);
      break;
    case 'funk':
      [[0, 0], [3, 12], [4, 0], [6, 10], [7, 7]].forEach(([s, iv]) =>
        funkBass(at(s), root - 12 + iv, BEAT * 0.4, s === 0 ? 1 : 0.8));
      break;
    default: break;
  }
}

function playDrums(kind, t0, R, swing, barInSection) {
  const at = (step) => t0 + step * BEAT / 2 + (step % 2 ? swing * BEAT : 0);
  const at16 = (s) => t0 + s * BEAT / 4 + (s % 2 ? swing * BEAT * 0.5 : 0);
  const last = barInSection === BARS_PER_SECTION - 1;
  switch (kind) {
    case 'brush':
      for (let s = 0; s < 8; s++) DRUM.shaker(at(s), s % 2 ? 0.6 : 1);
      DRUM.kick(at(0), 0.6);
      DRUM.rim(at(6), 0.7);
      break;
    case 'rimGroove':
      DRUM.kick(at(0), 0.8); DRUM.kick(at(5), 0.55);
      DRUM.rim(at(2), 1); DRUM.rim(at(6), 1);
      for (let s = 0; s < 8; s++) DRUM.hat(at(s), s % 2 ? 0.5 : 0.9);
      break;
    case 'light':
      DRUM.kick(at(0), 0.7); DRUM.kick(at(4), 0.5);
      DRUM.clap(at(4), 0.5);
      for (let s = 0; s < 8; s++) DRUM.shaker(at(s), 0.7);
      break;
    case 'sparse':
      DRUM.kick(at(0), 0.5);
      DRUM.hat(at(3), 0.6); DRUM.hat(at(7), 0.6);
      if (barInSection % 4 === 3) DRUM.openHat(at(6), 0.8);
      break;
    case 'stompClap':
      DRUM.stomp(at(0), 1); DRUM.stomp(at(4), 0.9);
      DRUM.clap(at(2), 0.9); DRUM.clap(at(6), 0.9);
      for (let s = 0; s < 8; s++) DRUM.shaker(at(s), 0.5);
      break;
    case 'funk':
      DRUM.kick(at(0), 1); DRUM.kick(at(3), 0.7); DRUM.kick(at(5), 0.6);
      DRUM.snare(at(2), 1); DRUM.snare(at(6), 1);
      for (let s = 0; s < 16; s++) DRUM.hat(at16(s), s % 4 === 2 ? 0.9 : 0.45);
      if (R() < 0.3) DRUM.snare(at16(15), 0.4);
      break;
    default: break;
  }
  // A fill into the next section, so the change of instruments lands on purpose.
  if (last && kind !== 'none') {
    for (let s = 8; s < 16; s++) DRUM.snare(at16(s), 0.25 + (s - 8) * 0.08);
  }
}

// Motif: a two-bar rhythm + scale-degree contour, reused as A, A', B, A so the tune
// has a shape a listener can follow.
function makeMotif(R, density) {
  const hits = [];
  for (let s = 0; s < 16; s++) {
    const strong = s % 4 === 0;
    if (R() < (strong ? 0.75 : density * 0.8)) hits.push(s);
  }
  if (!hits.length) hits.push(0);
  let deg = Math.floor(R() * 5);
  const degs = hits.map(() => {
    deg += Math.round((R() - 0.5) * 4);
    deg = Math.max(-2, Math.min(9, deg));
    return deg;
  });
  return { hits, degs };
}

function degreeToMidi(sec, deg, chordRoot, q) {
  const sc = sec.scale;
  const oct = Math.floor(deg / sc.length);
  const idx = ((deg % sc.length) + sc.length) % sc.length;
  let m = sec.key + sec.leadOct - 12 + oct * 12 + sc[idx];
  // Pull strong-beat notes toward the nearest chord tone so the melody sits on the
  // harmony instead of fighting it.
  const tones = Q[q].map((iv) => (chordRoot + iv) % 12);
  if (!tones.includes(m % 12)) {
    for (const d of [1, -1, 2, -2]) if (tones.includes((m + d + 120) % 12)) { m += d; break; }
  }
  return m;
}

function playLead(sec, t0, barInSection, root, q, motifs) {
  const fn = LEADS[sec.lead];
  if (!fn) return;
  if (sec.arp) {
    // Music-box arpeggio: steady eighths up and down the chord.
    const notes = chordNotes(root, q, 24);
    const seq = [...notes, ...notes.slice(1, -1).reverse()];
    for (let s = 0; s < 8; s++) fn(t0 + s * BEAT / 2, seq[s % seq.length], BEAT / 2, s === 0 ? 1 : 0.7);
    return;
  }
  // Four-bar phrase shape: A A' B A over bars, silent for the first two bars of a
  // section so each section's groove is heard on its own before the tune arrives.
  if (barInSection < 2) return;
  const phrase = Math.floor(barInSection / 2) % 4;
  const m = phrase === 2 ? motifs.b : motifs.a;
  const half = barInSection % 2;
  const shift = phrase === 1 ? 1 : 0;
  m.hits.forEach((s, i) => {
    if ((s >= 8) !== !!half) return;
    const step = s - half * 8;
    const next = m.hits[i + 1] ?? 16;
    const len = Math.min(4, next - s) * BEAT / 2;
    const swing = step % 2 ? sec.swing * BEAT : 0;
    fn(t0 + step * BEAT / 2 + swing, degreeToMidi(sec, m.degs[i] + shift, root, q), len, 0.9);
  });
}

// --- Sequencer --------------------------------------------------------------------

const motifCache = new Map();
function motifsFor(sectionIdx) {
  const key = `${pass}:${sectionIdx}`;
  if (!motifCache.has(key)) {
    const R = rng(pass * 97 + sectionIdx * 13 + 5);
    const sec = SECTIONS[sectionIdx];
    motifCache.set(key, { a: makeMotif(R, sec.density), b: makeMotif(R, sec.density) });
    if (motifCache.size > 20) motifCache.delete(motifCache.keys().next().value);
  }
  return motifCache.get(key);
}

function scheduleBar(t0) {
  const total = SECTIONS.length * BARS_PER_SECTION;
  const inCycle = barIndex % total;
  if (inCycle === 0 && barIndex > 0) pass++;
  const si = Math.floor(inCycle / BARS_PER_SECTION);
  const bar = inCycle % BARS_PER_SECTION;
  const sec = SECTIONS[si];
  const [root, q] = sec.prog[bar % sec.prog.length];
  const [nextRoot] = sec.prog[(bar + 1) % sec.prog.length];
  const R = rng(barIndex * 7919 + pass * 31);
  playChords(sec.chords, t0, root, q, R, sec.swing);
  playBass(sec.bass, t0, root, q, nextRoot, sec.swing);
  playDrums(sec.drums, t0, R, sec.swing, bar);
  playLead(sec, t0, bar, root, q, motifsFor(si));
  state.section = sec.name;
  state.bar = bar;
  barIndex++;
}

export const state = { playing: false, section: null, bar: 0 };

function tick() {
  if (!ctx || ctx.state !== 'running') return;
  // Nothing is scheduled while the page is hidden: timers are throttled there, and
  // a tab in the background should be quiet anyway.
  if (document.hidden) { nextBarTime = 0; return; }
  const now = ctx.currentTime;
  if (nextBarTime < now) nextBarTime = now + 0.1;
  while (nextBarTime < now + 0.6) {
    scheduleBar(nextBarTime);
    nextBarTime += BAR;
  }
}

function makeReverb() {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2.2);
  const ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  return conv;
}

// Starts at a random section, so a player who opens the game every day doesn't hear
// the same opening every time.
export function startMusic(audioCtx, destination) {
  if (ctx) return;
  ctx = audioCtx;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 3;
  comp.connect(destination);
  out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(comp);
  reverb = makeReverb();
  const rv = ctx.createGain();
  rv.gain.value = 0.5;
  reverb.connect(rv).connect(comp);
  const len = Math.floor(ctx.sampleRate * 2);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  pass = Math.floor(Math.random() * 1000);
  barIndex = Math.floor(Math.random() * SECTIONS.length) * BARS_PER_SECTION;
  state.playing = true;
  timer = setInterval(tick, 100);
  tick();
}

export const MUSIC_INFO = {
  sections: SECTIONS.map((s) => s.name),
  secondsPerCycle: SECTIONS.length * BARS_PER_SECTION * BAR,
};
