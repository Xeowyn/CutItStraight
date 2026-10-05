const { open } = require('./common.js');
const [W, H] = (process.env.VIEW || '1280x800').split('x').map(Number);
const TAG = `${W}`;
let bad = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) bad++; };
(async () => {
  const { browser, page, errors, boot } = await open(W, H, { fresh: true, dpr: W < 600 ? 2 : 1 });
  const ev = (f, a) => page.evaluate(f, a);
  const tick = (k = 1) => ev((k) => window.__tick(k), k);
  const tap = (id) => ev((id) => window.__tapButton(id), id);
  const st = () => ev(() => window.__gameState());
  const ach = () => ev(() => window.__ach());
  const shot = (n) => page.screenshot({ path: `s_${TAG}_${n}.png` });
  const cutBoard = async (opts = {}) => {
    let start = null;
    for (let i = 0; i < 3000; i++) {
      const s = await ev((o) => {
        if (window.__briefing()) window.__tapButton('brief-go');
        const j = window.__jumpState();
        if (j) for (const g of j.gaps) if (!j.jumped[g.i] && j.s >= g.s0 && (j.s - g.s0) / (g.s1 - g.s0) >= 0.70) window.__jump();
        if (o.ruin) window.__push(60); else window.__steerToLine(0);
        window.__tick();
        return window.__gameState().state;
      }, opts);
      if (opts.shotAt && i === opts.shotAt) await shot(opts.shotName);
      if (s !== 'playing') return { state: s, frames: i };
    }
    return { state: 'timeout' };
  };

  await tick(30); await shot('01_home');
  ok((await ach()).ach['first-cut'] === undefined, 'fresh save has no achievements');
  const hb = (await st()).buttons;
  ok(hb.includes('menu-workshop') && hb.includes('home-settings') && hb.length <= 6, `home has REWARDS + SETTINGS and ${hb.length} buttons [${hb}]`);

  // Count-in length on level 1
  await tap('home-play'); await tick(2);
  let f = 0; while ((await ev(() => window.__countT())) > 0 && f < 400) { await tick(); f++; }
  ok(f > 60 && f < 130, `count-in takes ${(f / 60).toFixed(2)}s (was 3.75s)`);
  let r = await cutBoard({ shotAt: 200, shotName: '02_play' });
  ok(r.state === 'complete', `level 1 cut -> ${r.state} after ${(r.frames / 60).toFixed(1)}s`);
  await tick(20); await shot('03_results_toast');
  await tick(240); await shot('04_results');
  let a = await ach();
  ok(a.ach['first-cut'] === 1, 'First Cut earned by actually cutting level 1');
  ok(a.ach['three-star'] === 1, 'Clean Work earned (3 stars)');

  // Levels 2..10
  for (let n = 2; n <= 10; n++) { for (let k = 0; k < 40 && !(await tap('next')); k++) await tick(15); await tick(3); r = await cutBoard(); if (r.state !== 'complete') { console.log('level', n, r.state); break; } }
  a = await ach();
  ok(a.stats.boards === 10 && a.ach['boards-10'] === 1, `10 boards -> Getting the Hang of It (boards=${a.stats.boards})`);
  ok(a.ach['level-10'] === 1, 'Warmed Up (finish level 10)');
  console.log('after 10 levels:', JSON.stringify(a.stats), 'earned:', Object.keys(a.ach).join(','), 'coins', a.coins);

  // Ruin a board
  await ev(() => window.__setLevel(3)); await tick(3);
  r = await cutBoard({ ruin: true });
  await tick(90); await shot('05_failed');
  a = await ach();
  ok(r.state === 'failed' && a.stats.fails === 1, `ruined board counted (state ${r.state}, fails ${a.stats.fails})`);

  // Perfect jump on the first jump level
  await ev(() => window.__setLevel(26)); await tick(3);
  const hasGap = await ev(() => window.__jumpState().gaps.length);
  r = await cutBoard();
  a = await ach();
  ok(hasGap > 0 && a.stats.perfectJumps >= 1 && a.ach['jump-1'] === 1, `Leap of Faith on level 26 (gaps ${hasGap}, perfectJumps ${a.stats.perfectJumps})`);

  // Chest
  await ev(() => window.__giveChests(1)); await tick(300);
  await tap('open-run-chest'); await tick(40);
  for (let i = 0; i < 12; i++) {
    const L = (await st()).layout;
    const box = await ev(() => { const c = document.querySelector('canvas').getBoundingClientRect(); return { x: c.left, y: c.top, w: c.width, h: c.height }; });
    await page.mouse.click(box.x + box.w / 2, box.y + (L.h * 0.42) * L.scale);
    await tick(45);
    const cs = await ev(() => window.__chestState());
    if (!cs) break;
    if (cs.collect) { const b = (await st()).buttons; await tap(b.find((x) => /collect|chest/.test(x)) || b[0]); await tick(30); }
  }
  a = await ach();
  ok(a.stats.chests === 1, `chest opening counted (chests ${a.stats.chests}, state ${(await st()).state})`);

  // Buy things: grant coins, first build part + first saw upgrade
  await ev(() => { window.__grant(5000); window.__goHome(); }); await tick(20);
  await tap('menu-build'); await tick(60); await shot('06_build'); await tap('buy-part'); await tick(60);
  await ev(() => window.__goHome()); await tick(20);
  await tap('menu-upgrades'); await tick(60); await shot('07_upgrades'); await tap('buyup-blade'); await tick(30);
  a = await ach();
  ok(a.ach['parts-1'] === 1, 'Moving In (first Build part)');
  ok(a.ach['saw-1'] === 1, 'Tool Time (first saw upgrade)');

  // The page itself
  await ev(() => window.__goHome()); await tick(30); await shot('08_home_claim');
  await tap('menu-workshop'); await tick(70); await shot('09_rewards');
  await ev(() => window.__scrollSet(420)); await tick(5); await shot('09b_rewards_ach');
  let s = await st();
  ok(s.state === 'workshop', 'REWARDS page opens from home');
  const claimBtn = s.buttons.find((b) => b.startsWith('achclaim-'));
  const before = (await ach()).coins;
  const rect = await ev((id) => window.__buttonRect(id), claimBtn);
  await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2); await tick(60);
  a = await ach();
  ok(a.coins > before && a.ach[claimBtn.slice(9)] === 2, `real click on CLAIM pays (${before} -> ${a.coins})`);
  await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2); await tick(20);
  await ev(() => window.__scrollSet(99999)); await tick(10); await shot('10_ach_bottom');
  ok((await st()).buttons.includes('close-workshop'), 'BACK reachable at the bottom');
  await tap('close-workshop'); await tick(10);
  ok((await st()).state === 'home', 'BACK returns home');

  // Survives a reload
  const pre = await ach();
  await page.reload({ waitUntil: 'load' }); await boot();
  const post = await ach();
  ok(JSON.stringify(pre.ach) === JSON.stringify(post.ach) && post.coins === pre.coins, 'achievements + coins persist across reload');

  // Pause-menu route + other screens for review
  await tap('home-play'); await tick(160); await tap('open-menu'); await tick(20); await shot('11_pause');
  const pb = (await st()).buttons;
  ok(pb.includes('resume') && pb.includes('menu-home') && pb.includes('toggle-invert') && pb.includes('vol-sfx')
    && !pb.includes('menu-workshop') && !pb.includes('menu-build'), `gear = settings + quit only [${pb}]`);
  await tap('resume'); await tick(5);
  ok((await st()).state === 'playing', 'RESUME returns to the cut');
  await tap('open-menu'); await tick(10); await tap('menu-home'); await tick(10);
  ok((await st()).state === 'home', 'QUIT LEVEL leaves the level for the main menu');
  await ev(() => window.__goHome()); await tick(20); await tap('home-settings'); await tick(20); await shot('12_settings');
  const sb = (await st()).buttons;
  ok(sb.includes('vol-sfx') && sb.includes('vol-music') && sb.includes('toggle-invert') && sb.includes('resume'), `settings panel has volume, invert, back [${sb}]`);
  await tap('resume'); await tick(5);
  ok((await st()).state === 'home', 'settings BACK returns home');
  // Daily Cut + star chest + jobs still reachable on REWARDS
  await tap('menu-workshop'); await tick(70);
  const wb = (await st()).buttons;
  ok(wb.includes('daily'), `Daily Cut reachable on REWARDS [${wb.filter((x) => !x.startsWith('achclaim')).join(',')}]`);
  await ev(() => window.__goHome()); await tick(20); await tap('menu-levels'); await tick(40); await shot('13_levels');
  ok(errors.length === 0, `no console/page errors (${errors.length})`);
  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  await browser.close();
})();
