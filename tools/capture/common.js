const puppeteer = require('/home/xeowyn/MyCrazyGames/rush-hour-rampage/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js');
const CHROME = process.env.HOME + '/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome';
// open(w, h, { fresh }) boots the game on a VIRTUAL clock: every __tick() is exactly
// 1/60 s of game time however long rendering takes. `fresh` starts with no save;
// otherwise a mid-campaign save is seeded (level 39, 4200 coins, stars on 1-60).
exports.open = async (w, h, opts = {}) => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.touch });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  // "call throttled" is an artifact of the virtual clock, not a game fault: sdk.js spaces
  // gameplayStart/Stop by performance.now(), which these tests run far faster than the
  // real time the SDK itself measures against.
  page.on('console', (m) => { if (m.type() === 'error' && !/call throttled/.test(m.text())) { errors.push(m.text()); console.log('CONSOLE', m.text()); } });
  await page.evaluateOnNewDocument((fresh) => {
    window.__testerBuild = true;
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      if (!fresh) {
        const stars = {}; for (let i = 1; i <= 60; i++) stars[i] = (i * 7) % 5 === 0 ? 2 : 3;
        const save = JSON.stringify({ v: 11, coins: 4200, stars, maxLevel: 61, levelNum: 39, lastPlayedAt: Date.now() });
        localStorage.setItem('woodcut.save.v1', save);
        localStorage.setItem('SDK_DATA_local', JSON.stringify({ data: { 'woodcut.save.v1': save } }));
      }
    }
    let vt = 1000, id = 0; const q = new Map();
    performance.now = () => vt;
    window.requestAnimationFrame = (cb) => { q.set(++id, cb); return id; };
    window.cancelAnimationFrame = (i) => q.delete(i);
    window.__tick = (n = 1) => { for (let k = 0; k < n; k++) { vt += 1000 / 60; const c = [...q.values()]; q.clear(); for (const f of c) f(vt); } };
  }, !!opts.fresh);
  const boot = async () => {
    for (let i = 0; i < 600; i++) {
      if (await page.evaluate(() => { window.__tick(); return !!window.__gameReady && !!window.__gameState; })) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error('game did not boot');
  };
  await page.goto('http://localhost:8936/', { waitUntil: 'domcontentloaded' });
  await boot();
  return { browser, page, errors, boot };
};
