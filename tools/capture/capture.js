// Deterministic 60 fps capture: the game runs on a virtual clock (common.js), one
// screenshot per 1/60 s of game time, so the video is smooth however slow rendering is.
const { spawn } = require('child_process');
const fs = require('fs');
const { open } = require('./common.js');
const [W, H] = (process.env.VIEW || '1920x1080').split('x').map(Number);
const OUT = process.env.OUT || `out_${W}x${H}.mp4`;
const FF = process.env.HOME + '/.cache/Cypress/15.20.1/Cypress/resources/app/node_modules/@ffmpeg-installer/linux-x64/ffmpeg';
const PROBE = !!process.env.PROBE;   // no encode; save a still every 30 frames
(async () => {
  const { browser, page } = await open(W, H);
  const ff = PROBE ? null : spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '60', '-movflags', '+faststart', '-an', OUT],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  let n = 0; const marks = [];
  const shot = async () => {
    if (PROBE) { if (n % 30 === 0) await page.screenshot({ path: `probe_${W}_${String(n).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 70 }); n++; return; }
    const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    n++;
  };
  const tick = (k = 1) => page.evaluate((k) => window.__tick(k), k);
  const tap = (id) => page.evaluate((id) => window.__tapButton(id), id);
  const mark = (s) => { marks.push(`${s}@${(n / 60).toFixed(2)}s`); };

  // 1. The cut: level 39 (SHORT SPRINT + BOARD JUMP), count-in included.
  await page.evaluate(() => window.__setLevel(39));
  await tick(45);
  await tap('brief-go');
  mark('cut');
  for (let guard = 0; guard < 900; guard++) {
    const st = await page.evaluate(() => {
      const j = window.__jumpState(), g = j && j.gaps[0];
      if (g && !j.jumped[0] && (j.s - g.s0) / (g.s1 - g.s0) >= 0.70) window.__jump();
      window.__steerToLine(0);
      window.__tick();
      return window.__gameState().state;
    });
    await shot();
    if (st !== 'playing') { mark('results:' + st); break; }
  }
  for (let i = 0; i < 215; i++) { await tick(); await shot(); }
  console.log('after cut', await page.evaluate(() => JSON.stringify([window.__gameState().stars, window.__jumpState().perfect, window.__gameState().buttons])));

  // 2. A piece dropping into the room.
  await page.evaluate(() => window.__goHome());
  await tick(20); await tap('menu-build'); await tick(50);
  mark('build');
  for (let i = 0; i < 160; i++) {
    if (i === 22) console.log('buy', await tap('buy-part'));
    await tick(); await shot();
  }

  // 3. Level select scrolling past the boards.
  await page.evaluate(() => window.__goHome());
  await tick(20); await tap('menu-levels'); await tick(50);
  mark('levels');
  await page.mouse.move(W / 2, H / 2);
  for (let i = 0; i < 200; i++) {
    const v = 9 * Math.min(1, i / 30);
    if (i > 15) await page.mouse.wheel({ deltaY: v });
    await tick(); await shot();
  }
  console.log('frames', n, (n / 60).toFixed(2) + 's', marks.join(' '));
  if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
  await browser.close();
})();
