// A slightly sloppy bot through the first 30 levels at the new speed/curve: does it still finish them?
const { open } = require('./common.js');
(async () => {
  const { browser, page } = await open(1280, 800, { fresh: true });
  const res = [];
  for (const slop of [0, 90]) {
    const row = [];
    for (let n = 1; n <= 30; n++) {
      await page.evaluate((n) => { window.__setLevel(n); window.__tick(3); }, n);
      let st = 'timeout', acc = 0;
      for (let i = 0; i < 4000; i++) {
        const r = await page.evaluate((slop) => {
          if (window.__briefing()) window.__tapButton('brief-go');
          const j = window.__jumpState(); if (j) for (const g of j.gaps) if (!j.jumped[g.i] && j.s >= g.s0 && (j.s - g.s0) / (g.s1 - g.s0) >= 0.7) window.__jump();
          for (let k = 0; k < 4; k++) { window.__steerToLine(slop); window.__tick(); }
          const s = window.__gameState(); return [s.state, s.stars, s.acc];
        }, slop);
        if (r[0] !== 'playing') { st = r[0] === 'complete' ? r[1] + '*' : 'FAIL'; break; }
      }
      row.push(st);
    }
    console.log(`slop ${slop}:`, row.join(' '));
  }
  console.log('speed/tol:', JSON.stringify(await page.evaluate(() => [1, 5, 10, 20, 30].map((n) => window.__levelInfo(n)))));
  await browser.close();
})();
