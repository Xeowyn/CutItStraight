const { open } = require('./common.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
(async () => {
  for (const [w, h] of [[1280, 800], [430, 900], [800, 450]]) {
    const { browser, page, errors } = await open(w, h, { fresh: true, dpr: w < 600 ? 2 : 1 });
    const ev = (f, a) => page.evaluate(f, a);
    const tick = (k) => ev((k) => window.__tick(k), k);
    await ev(() => window.__tapButton('home-play')); await tick(3);
    for (let i = 0; i < 3000; i++) { if (await ev(() => { window.__steerToLine(0); window.__tick(); return window.__gameState().state; }) !== 'playing') break; }
    await tick(400);
    const b = await ev(() => window.__gameState().buttons);
    ok(b.includes('menu-build') && b.includes('workshop') && b.includes('menu-levels') && b.includes('next'), `${w}x${h} results has BUILD/REWARDS/LEVELS/NEXT [${b}]`);
    const rects = await ev(() => ['menu-build', 'workshop', 'menu-levels'].map((id) => window.__buttonRect(id)));
    ok(rects.every((r) => r.y + r.h <= h + 1 && r.x >= 0 && r.x + r.w <= w) && rects[0].x + rects[0].w <= rects[1].x && rects[1].x + rects[1].w <= rects[2].x, `${w}x${h} the three buttons are on screen and do not overlap`);
    await page.screenshot({ path: `res_${w}.png` });
    const r = rects[0]; await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); await tick(60);
    ok((await ev(() => window.__gameState().state)) === 'build', `${w}x${h} real click on BUILD opens the Build screen`);
    const c0 = await ev(() => window.__ach().coins);
    await ev(() => window.__tapButton('buy-part')); await tick(80);
    ok((await ev(() => window.__ach().coins)) < c0, `${w}x${h} can buy a part from there (${c0} coins)`);
    await page.screenshot({ path: `resb_${w}.png` });
    await ev(() => window.__tapButton('close-build')); await tick(10);
    const s = await ev(() => window.__gameState());
    ok(s.state === 'complete' && s.buttons.includes('next'), `${w}x${h} BACK returns to the results panel with NEXT LEVEL`);
    ok(errors.length === 0, `${w}x${h} no errors`);
    await browser.close();
  }
  console.log(bad ? 'FAILED' : 'ALL PASS');
})();
