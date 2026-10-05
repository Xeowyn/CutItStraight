// Runs on WINDOWS node with the real GPU and the real monitor refresh rate.
const puppeteer = require('\\\\wsl.localhost\\Ubuntu\\home\\xeowyn\\MyCrazyGames\\rush-hour-rampage\\node_modules\\puppeteer-core\\lib\\puppeteer\\puppeteer-core.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: false, defaultViewport: null,
    userDataDir: process.env.TEMP + '\\cis_perf\\profile', args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = (await browser.pages())[0];
  await page.evaluateOnNewDocument(() => {
    window.__testerBuild = true;
    if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.clear();
      const stars = {}; for (let i = 1; i <= 40; i++) stars[i] = 3;
      const save = JSON.stringify({ v: 11, coins: 90000, stars, maxLevel: 41, levelNum: 12, lastPlayedAt: Date.now(), stats: { boards: 60, finds: 70, perfectTurns: 60, threeStars: 30, bestCombo: 5 } });
      localStorage.setItem('woodcut.save.v1', save); localStorage.setItem('SDK_DATA_local', JSON.stringify({ data: { 'woodcut.save.v1': save } })); }
    window.__fps = (ms) => new Promise((res) => { const d = []; let last = performance.now(); const t0 = last;
      const f = (t) => { d.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else { d.shift(); d.sort((a, b) => a - b);
        res({ fps: +(d.length * 1000 / (t - t0)).toFixed(0), p50: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), worst: +d[d.length - 1].toFixed(0) }); } };
      requestAnimationFrame(f); });
  });
  await page.goto('http://localhost:8936/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gameReady && window.__gameState, { timeout: 30000 });
  await sleep(2500);
  const ev = (f, a) => page.evaluate(f, a);
  const out = {};
  out.window = await ev(() => innerWidth + 'x' + innerHeight + ' dpr ' + devicePixelRatio + ' canvas ' + document.querySelector('canvas').width + 'x' + document.querySelector('canvas').height);
  out.home = await ev(() => window.__fps(2500));
  const cutLevel = async (n, key) => {
    await ev((n) => { clearInterval(window.__steer); window.__setLevel(n); window.__steer = setInterval(() => { if (window.__briefing && window.__briefing()) window.__tapButton('brief-go'); const j = window.__jumpState && window.__jumpState(); if (j) for (const g of j.gaps) if (!j.jumped[g.i] && j.s >= g.s0 && (j.s - g.s0) / (g.s1 - g.s0) >= 0.7) window.__jump(); window.__steerToLine(0); }, 6); }, n);
    await sleep(3200);
    out[key] = await ev(() => window.__fps(4000));
    out[key].mat = await ev(() => window.__plankInfo().mat);
  };
  await cutLevel(12, 'cut_L12');
  await sleep(5000);
  out.results = await ev(() => window.__fps(2000));
  await cutLevel(8, 'cut_L8');
  await cutLevel(13, 'cut_L13');
  await cutLevel(23, 'cut_L23');
  await ev(() => { clearInterval(window.__steer); window.__goHome(); }); await sleep(500);
  await ev(() => window.__tapButton('menu-build')); await sleep(1500);
  out.build_idle = await ev(() => window.__fps(1500));
  out.build_buy = await ev(() => { window.__tapButton('buy-part'); return window.__fps(1300); });
  await ev(() => window.__goHome()); await sleep(400);
  await ev(() => window.__tapButton('menu-workshop')); await sleep(1500);
  out.rewards = await ev(() => window.__fps(1500));
  out.claim = await ev(() => { const id = window.__gameState().buttons.find((x) => x.startsWith('achclaim-') || x.startsWith('claim-')); window.__tapButton(id); return window.__fps(1200); });
  await ev(() => window.__goHome()); await sleep(300);
  await ev(() => window.__tapButton('menu-levels')); await sleep(1200);
  out.levels = await ev(() => window.__fps(1500));
  for (const k in out) console.log(k.padEnd(12), typeof out[k] === 'string' ? out[k] : JSON.stringify(out[k]));
  await browser.close();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
