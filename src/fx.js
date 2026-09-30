// Particles, screen shake and small tweens. Pools are fixed-size so the allocator
// stays quiet during play.

const MAX_PARTICLES = 420;

export function createFx() {
  const p = new Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    p[i] = { alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, r: 0, g: 0, b: 0, grav: 1, spin: 0, rot: 0, glow: false };
  }
  return { pool: p, next: 0, shake: 0, shakeT: 0, pops: [], rings: [], flights: [], flash: 0, flashCol: '255,255,255' };
}

function spawn(fx) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const idx = (fx.next + i) % MAX_PARTICLES;
    if (!fx.pool[idx].alive) {
      fx.next = (idx + 1) % MAX_PARTICLES;
      return fx.pool[idx];
    }
  }
  fx.next = (fx.next + 1) % MAX_PARTICLES;
  return fx.pool[fx.next];
}

export function sawdust(fx, x, y, amount, tint, intensity) {
  for (let i = 0; i < amount; i++) {
    const q = spawn(fx);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const sp = 60 + Math.random() * 210 * (0.5 + intensity);
    q.alive = true;
    q.x = x + (Math.random() - 0.5) * 10;
    q.y = y + (Math.random() - 0.5) * 8;
    q.vx = Math.cos(a) * sp * 0.8;
    q.vy = Math.sin(a) * sp - 40;
    q.max = q.life = 0.35 + Math.random() * 0.5;
    q.size = 1.4 + Math.random() * 2.6;
    q.grav = 900;
    q.spin = (Math.random() - 0.5) * 14;
    q.rot = Math.random() * 6.28;
    q.glow = false;
    const j = 0.82 + Math.random() * 0.36;
    q.r = Math.min(255, tint[0] * j);
    q.g = Math.min(255, tint[1] * j);
    q.b = Math.min(255, tint[2] * j);
  }
}

// Fired when the blade rounds a corner: a heavy directional spray, so corners feel
// like an event instead of the dust just dribbling out continuously.
export function dustBurst(fx, x, y, dir, tint, power) {
  const n = 16 + Math.floor(power * 22);
  for (let i = 0; i < n; i++) {
    const q = spawn(fx);
    const a = -Math.PI / 2 + dir * (0.35 + Math.random() * 0.75) * (Math.random() < 0.75 ? 1 : -1);
    const sp = 180 + Math.random() * 420 * (0.6 + power);
    q.alive = true;
    q.x = x + (Math.random() - 0.5) * 14;
    q.y = y + (Math.random() - 0.5) * 10;
    q.vx = Math.cos(a) * sp;
    q.vy = Math.sin(a) * sp - 60;
    q.max = q.life = 0.45 + Math.random() * 0.6;
    q.size = 2 + Math.random() * 4;
    q.grav = 880;
    q.spin = (Math.random() - 0.5) * 18;
    q.rot = Math.random() * 6.28;
    q.glow = false;
    const j = 0.8 + Math.random() * 0.4;
    q.r = Math.min(255, tint[0] * j);
    q.g = Math.min(255, tint[1] * j);
    q.b = Math.min(255, tint[2] * j);
  }
}

// Earned, not bought: these appear when the player holds a long perfect streak.
export function goldSparkle(fx, x, y, amount) {
  for (let i = 0; i < amount; i++) {
    const q = spawn(fx);
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 190;
    q.alive = true;
    q.x = x + (Math.random() - 0.5) * 26;
    q.y = y + (Math.random() - 0.5) * 20;
    q.vx = Math.cos(a) * sp;
    q.vy = Math.sin(a) * sp - 90;
    q.max = q.life = 0.5 + Math.random() * 0.55;
    q.size = 1.6 + Math.random() * 2.6;
    q.grav = 240;
    q.spin = 0; q.rot = 0;
    q.glow = true;
    q.r = 255; q.g = 214 + Math.random() * 40; q.b = 110 + Math.random() * 90;
  }
}

// Ice levels shed bright shards instead of dust.
export function iceShards(fx, x, y, amount) {
  for (let i = 0; i < amount; i++) {
    const q = spawn(fx);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
    const sp = 120 + Math.random() * 340;
    q.alive = true;
    q.x = x; q.y = y;
    q.vx = Math.cos(a) * sp;
    q.vy = Math.sin(a) * sp;
    q.max = q.life = 0.3 + Math.random() * 0.5;
    q.size = 2 + Math.random() * 3.5;
    q.grav = 760;
    q.spin = (Math.random() - 0.5) * 24;
    q.rot = Math.random() * 6.28;
    q.glow = true;
    q.r = 205 + Math.random() * 50; q.g = 238 + Math.random() * 17; q.b = 255;
  }
}

export function sparks(fx, x, y, amount) {
  for (let i = 0; i < amount; i++) {
    const q = spawn(fx);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 3.0;
    const sp = 180 + Math.random() * 380;
    q.alive = true;
    q.x = x; q.y = y;
    q.vx = Math.cos(a) * sp;
    q.vy = Math.sin(a) * sp;
    q.max = q.life = 0.18 + Math.random() * 0.3;
    q.size = 1.2 + Math.random() * 1.8;
    q.grav = 620;
    q.spin = 0; q.rot = 0;
    q.glow = true;
    q.r = 255; q.g = 180 + Math.random() * 60; q.b = 80 + Math.random() * 80;
  }
}

export function confetti(fx, x, y, amount) {
  const cols = [[255, 196, 61], [255, 122, 66], [86, 214, 168], [96, 178, 255], [255, 255, 255]];
  for (let i = 0; i < amount; i++) {
    const q = spawn(fx);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.8;
    const sp = 220 + Math.random() * 460;
    const c = cols[(Math.random() * cols.length) | 0];
    q.alive = true;
    q.x = x; q.y = y;
    q.vx = Math.cos(a) * sp;
    q.vy = Math.sin(a) * sp;
    q.max = q.life = 0.8 + Math.random() * 0.7;
    q.size = 3 + Math.random() * 4;
    q.grav = 780;
    q.spin = (Math.random() - 0.5) * 20;
    q.rot = Math.random() * 6.28;
    q.glow = false;
    q.r = c[0]; q.g = c[1]; q.b = c[2];
  }
}

// --- Menu juice ------------------------------------------------------------
//
// The play field already had weight — dust, sparks, shake. The menus did not, so a
// results screen or a purchase read as a spreadsheet updating. Everything below
// exists to give UI events the same physical impact the cut has.

// An expanding shockwave. Cheap, and it is what makes a star landing or a purchase
// feel like it hit something.
export function ring(fx, x, y, colour, opts = {}) {
  fx.rings.push({
    x, y, colour,
    r: opts.from ?? 8,
    to: opts.to ?? 150,
    life: opts.life ?? 0.5,
    max: opts.life ?? 0.5,
    width: opts.width ?? 7,
    fill: !!opts.fill,
  });
}

// A coin (or star, or key) that physically travels from one place to another —
// from the coin counter to the thing bought, or from a chest to the counter. Money
// that moves is money the player notices leaving or arriving.
export function flight(fx, x0, y0, x1, y1, opts = {}) {
  const n = opts.count ?? 1;
  for (let i = 0; i < n; i++) {
    fx.flights.push({
      x0, y0, x1, y1,
      kind: opts.kind || 'coin',
      r: opts.r ?? 14,
      delay: (opts.delay ?? 0) + i * (opts.stagger ?? 0.045),
      life: 0,
      dur: (opts.dur ?? 0.5) + Math.random() * 0.12,
      // A lateral arc, so a burst of ten coins doesn't travel as one line.
      arc: (Math.random() - 0.5) * (opts.spread ?? 180),
      lift: -(opts.lift ?? 120) - Math.random() * 70,
      done: false,
      onArrive: opts.onArrive,
    });
  }
}

export function flash(fx, amount, colour) {
  fx.flash = Math.min(1, fx.flash + amount);
  if (colour) fx.flashCol = colour;
}

export function updateMenuFx(fx, dt) {
  fx.time = (fx.time || 0) + dt;
  for (let i = fx.rings.length - 1; i >= 0; i--) {
    const r = fx.rings[i];
    r.life -= dt;
    if (r.life <= 0) fx.rings.splice(i, 1);
  }
  for (let i = fx.flights.length - 1; i >= 0; i--) {
    const f = fx.flights[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    f.life += dt;
    if (f.life >= f.dur) {
      if (!f.done) {
        f.done = true;
        f.onArrive?.();
        // Every coin/star/key that lands makes a sound (owner, 2026-09-28: "make sure
        // everything has a sound effect ... getting coins"). Rate-limited so a burst
        // of twelve coins is a sparkle, not a wall of noise.
        if (fx.arriveSound && fx.time - (fx.lastArrive || -1) > 0.045) {
          fx.lastArrive = fx.time;
          fx.arriveSound(f.kind);
        }
      }
      fx.flights.splice(i, 1);
    }
  }
  fx.flash = Math.max(0, fx.flash - dt * 2.6);
}

// Drawn above panels but below buttons, so flying coins pass over the results card.
export function drawMenuFx(ctx, fx, drawCoinFn, drawStarFn, drawKeyFn, t) {
  ctx.save();
  for (const r of fx.rings) {
    const u = 1 - r.life / r.max;
    const rad = r.r + (r.to - r.r) * (1 - Math.pow(1 - u, 3));
    ctx.globalAlpha = Math.max(0, 1 - u) * 0.85;
    ctx.strokeStyle = r.colour;
    ctx.lineWidth = r.width * (1 - u * 0.7);
    ctx.beginPath();
    ctx.arc(r.x, r.y, rad, 0, 6.2832);
    if (r.fill) {
      ctx.globalAlpha *= 0.22;
      ctx.fillStyle = r.colour;
      ctx.fill();
      ctx.globalAlpha /= 0.22;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const f of fx.flights) {
    if (f.delay > 0) continue;
    const u = Math.min(1, f.life / f.dur);
    const e = u * u * (3 - 2 * u);
    const x = f.x0 + (f.x1 - f.x0) * e + Math.sin(u * Math.PI) * f.arc;
    const y = f.y0 + (f.y1 - f.y0) * e + Math.sin(u * Math.PI) * f.lift;
    const sc = 1 + Math.sin(u * Math.PI) * 0.35;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(u * 6 * (f.arc > 0 ? 1 : -1));
    ctx.scale(sc, sc);
    ctx.shadowColor = 'rgba(255,206,90,0.9)';
    ctx.shadowBlur = 14;
    if (f.kind === 'star') drawStarFn?.(ctx, 0, 0, f.r, true, t);
    else if (f.kind === 'key') drawKeyFn?.(ctx, 0, 0, f.r);
    else drawCoinFn?.(ctx, 0, 0, f.r);
    ctx.restore();
  }
  ctx.restore();
}

export function drawFlash(ctx, fx, x, y, w, h) {
  if (fx.flash <= 0.001) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(${fx.flashCol},${fx.flash * 0.5})`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// A number that rolls up to its target instead of appearing. Kept as a tiny value
// object so callers can hold one per counter.
export function createRoll(value = 0) {
  return { shown: value, target: value, bump: 0 };
}

export function setRoll(roll, target, opts = {}) {
  if (target === roll.target) return;
  roll.target = target;
  roll.rate = opts.rate || Math.max(24, Math.abs(target - roll.shown) * 1.8);
}

export function updateRoll(roll, dt) {
  roll.bump = Math.max(0, roll.bump - dt * 4);
  if (roll.shown === roll.target) return false;
  const dir = Math.sign(roll.target - roll.shown);
  const step = (roll.rate || 200) * dt;
  roll.shown += dir * step;
  if ((dir > 0 && roll.shown >= roll.target) || (dir < 0 && roll.shown <= roll.target)) {
    roll.shown = roll.target;
    roll.bump = 1;
    return true;
  }
  roll.bump = Math.max(roll.bump, 0.35);
  return false;
}

export function shake(fx, amount) {
  fx.shake = Math.min(26, fx.shake + amount);
}

export function popText(fx, text, x, y, color, size) {
  fx.pops.push({ text, x, y, color, size: size || 40, life: 0.9, max: 0.9 });
}

export function updateFx(fx, dt) {
  for (const q of fx.pool) {
    if (!q.alive) continue;
    q.life -= dt;
    if (q.life <= 0) { q.alive = false; continue; }
    q.vy += q.grav * dt;
    q.vx *= 1 - 1.6 * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.rot += q.spin * dt;
  }
  fx.shake *= Math.pow(0.0015, dt);
  if (fx.shake < 0.1) fx.shake = 0;
  fx.shakeT += dt;
  for (let i = fx.pops.length - 1; i >= 0; i--) {
    fx.pops[i].life -= dt;
    if (fx.pops[i].life <= 0) fx.pops.splice(i, 1);
  }
  updateMenuFx(fx, dt);
}

export function drawFx(ctx, fx) {
  ctx.save();
  for (const q of fx.pool) {
    if (!q.alive) continue;
    const t = q.life / q.max;
    ctx.globalAlpha = Math.min(1, t * 1.8);
    ctx.fillStyle = `rgb(${q.r | 0},${q.g | 0},${q.b | 0})`;
    if (q.glow) {
      ctx.shadowColor = `rgb(${q.r | 0},${q.g | 0},${q.b | 0})`;
      ctx.shadowBlur = 10;
    } else {
      ctx.shadowBlur = 0;
    }
    if (q.spin !== 0) {
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.fillRect(-q.size, -q.size * 0.6, q.size * 2, q.size * 1.2);
      ctx.restore();
    } else {
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
  }
  ctx.restore();
}

export function drawPops(ctx, fx) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of fx.pops) {
    const t = 1 - p.life / p.max;
    const rise = -70 * (1 - Math.pow(1 - t, 3));
    const scale = t < 0.18 ? 0.5 + (t / 0.18) * 0.62 : 1.12 - (t - 0.18) * 0.14;
    ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    ctx.save();
    ctx.translate(p.x, p.y + rise);
    ctx.scale(scale, scale);
    ctx.font = `900 ${p.size}px CisBody, system-ui, sans-serif`;
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(28,20,14,0.85)';
    ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
