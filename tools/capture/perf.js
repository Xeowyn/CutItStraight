// Real-time frame-rate measurement of the effect-heavy moments (no virtual clock).
const puppeteer = require('/home/xeowyn/MyCrazyGames/rush-hour-rampage/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js');
const CHROME = process.env.HOME + '/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.evaluateOnNewDocument(() => {
    window.__testerBuild = true;
    if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.clear();
      const stars = {}; for (let i = 1; i <= 30; i++) stars[i] = 3;
      const save = JSON.stringify({ v: 11, coins: 90000, stars, maxLevel: 31, levelNum: 12, lastPlayedAt: Date.now(), stats: { boards: 60, finds: 70, perfectTurns: 60, threeStars: 30, bestCombo: 5 } });
      localStorage.setItem('woodcut.save.v1', save); localStorage.setItem('SDK_DATA_local', JSON.stringify({ data: { 'woodcut.save.v1': save } })); }
    window.__fps = (ms) => new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const t0 = last;
      const f = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else res({ fps: +(n * 1000 / (t - t0)).toFixed(1), worstMs: +worst.toFixed(0) }); };
      requestAnimationFrame(f); });
  });
  await page.goto('http://localhost:8936/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gameReady && window.__gameState);
  await sleep(1500);
  const ev = (f, a) => page.evaluate(f, a);
  const out = {};
  out.home_idle = await ev(() => window.__fps(1500));
  // Build: idle, then a purchase
  await ev(() => window.__tapButton('menu-build')); await sleep(1500);
  out.build_idle = await ev(() => window.__fps(1500));
  out.build_purchase = await ev(() => { window.__tapButton('buy-part'); return window.__fps(1200); });
  await sleep(800);
  out.build_purchase2 = await ev(() => { window.__tapButton('buy-part'); return window.__fps(1200); });
  // Achievement claim (same coin flight as a quest claim)
  await ev(() => window.__goHome()); await sleep(400);
  await ev(() => window.__tapButton('menu-achievements') || window.__tapButton('menu-rewards') || window.__tapButton('menu-workshop')); await sleep(1500);
  out.rewards_idle = await ev(() => window.__fps(1200));
  out.claim_flight = await ev(() => { const id = window.__gameState().buttons.find((x) => x.startsWith('achclaim-')); window.__tapButton(id); return window.__fps(1000); });
  // Levels screen
  await ev(() => window.__goHome()); await sleep(300);
  await ev(() => window.__tapButton('menu-levels')); await sleep(1200);
  out.levels = await ev(() => window.__fps(1200));
  // Cutting: plain start, then with a combo running
  await ev(() => { window.__setLevel(12); window.__steer = setInterval(() => { if (window.__briefing && window.__briefing()) window.__tapButton('brief-go'); window.__steerToLine(0); }, 8); });
  await sleep(3200);
  out.cut_no_combo = await ev(() => window.__fps(1500));
  await sleep(3500);
  out.cut_combo = await ev(() => window.__fps(2500));
  await sleep(6000);
  out.results_stars = await ev(() => window.__fps(1500));
  for (const k in out) console.log(k.padEnd(18), String(out[k].fps).padStart(5), 'fps   worst frame', out[k].worstMs, 'ms');
  await browser.close();
})();
