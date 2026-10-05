// Every button on the home menu, pause menu and achievements page must be inside the viewport.
const { open } = require('./common.js');
(async () => {
  let bad = 0;
  for (const [w, h] of [[1280, 800], [1920, 1080], [907, 510], [800, 450], [430, 900], [390, 844]]) {
    const { browser, page, errors } = await open(w, h, { fresh: false });
    await page.evaluate(() => { window.__unlockEndless(); window.__tick(20); });
    for (const scr of ['home', 'pause']) {
      if (scr === 'pause') await page.evaluate(() => { window.__tapButton('home-play'); window.__tick(200); window.__tapButton('brief-go'); window.__tick(150); window.__tapButton('open-menu'); window.__tick(20); });
      const r = await page.evaluate(() => window.__gameState().buttons.map((id) => ({ id, ...window.__buttonRect(id) })));
      const out = r.filter((b) => b.y < -1 || b.y + b.h > h + 1).map((b) => b.id);
      const has = r.some((b) => b.id === (scr === 'home' ? 'menu-workshop' : 'menu-home'));
      console.log(`${out.length || !has ? 'FAIL' : 'PASS'} ${w}x${h} ${scr}: ${r.length} buttons, off-screen: [${out}]`);
      if (out.length || !has) bad++;
      await page.screenshot({ path: `fit_${w}_${scr}.png` });
    }
    if (errors.length) bad++;
    await browser.close();
  }
  console.log(bad ? 'FIT FAIL' : 'FIT PASS');
})();
