const { open } = require('./common.js');
let bad = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad++; };
(async () => {
  const { browser, page, errors } = await open(1280, 800, { fresh: true });
  const ev = (f, a) => page.evaluate(f, a);
  const tick = (k = 1) => ev((k) => window.__tick(k), k);
  const tap = (id) => ev((id) => window.__tapButton(id), id);
  const badges = async () => { await tick(3); return ev(() => window.__badges()); };
  await tick(20);
  let b = await badges();
  ok(!b.includes('menu-upgrades') && !b.includes('menu-build'), `fresh home: nothing to buy, no badge on UPGRADES/BUILD [${b}]`);
  ok(b.includes('menu-workshop'), 'fresh home: REWARDS badged (daily chest + Daily Cut waiting)');
  // cut level 1
  await tap('home-play'); await tick(3);
  let mid = null;
  for (let i = 0; i < 2000; i++) {
    const s = await ev(() => { window.__steerToLine(0); window.__tick(); return window.__gameState().state; });
    if (i === 250) mid = await ev(() => window.__badges());
    if (s !== 'playing') break;
  }
  ok(mid && mid.length === 0, `no badge while cutting [${mid}]`);
  await tick(300);
  b = await badges();
  ok(!b.includes('open-menu') && b.includes('workshop'), `results: REWARDS badged, gear never [${b}]`);
  await page.screenshot({ path: 'b_results.png' });
  await ev(() => window.__goHome()); await tick(20);
  b = await badges();
  ok(b.includes('menu-workshop') && b.includes('menu-build'), `home after level 1: REWARDS + BUILD (89 coins >= 60 part) [${b}]`);
  ok(!b.includes('menu-upgrades'), 'UPGRADE SAW not badged (cheapest part costs more than 89)');
  await page.screenshot({ path: 'b_home.png' });
  // claim everything -> achievements badge clears
  await tap('menu-workshop'); await tick(60);
  const wb = await badges();
  ok(wb.some((x) => x.startsWith('achclaim-')) && wb.includes('daily') && wb.includes('daily-chest'), `claim/open buttons carry the badge [${wb}]`);
  for (let i = 0; i < 10; i++) { const id = await ev(() => window.__gameState().buttons.find((x) => x.startsWith('achclaim-'))); if (!id) break; await tap(id); await tick(5); }
  const left = await ev(() => window.__gameState().buttons.filter((x) => x.startsWith('achclaim-')).length);
  ok(left === 0, 'no CLAIM buttons left after claiming');
  await tap('close-workshop'); await tick(5);
  // buy build parts until unaffordable -> build badge clears
  await tap('menu-build'); await tick(60);
  for (let i = 0; i < 6; i++) { await tap('buy-part'); await tick(40); }
  const att = await ev(() => window.__attention());
  await ev(() => window.__goHome()); await tick(20);
  b = await badges();
  ok(att.build === false && !b.includes('menu-build'), `build badge clears when the next part is unaffordable [${b}]`);
  await ev(() => window.__grant(5000)); await tick(5);
  b = await badges();
  ok(b.includes('menu-upgrades') && b.includes('menu-build'), `with coins: UPGRADE SAW + BUILD badged [${b}]`);
  ok(errors.length === 0, 'no errors');
  console.log(bad ? 'BADGE FAIL' : 'BADGE PASS');
  await browser.close();
})();
