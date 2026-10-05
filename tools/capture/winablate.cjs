const puppeteer = require('\\\\wsl.localhost\\Ubuntu\\home\\xeowyn\\MyCrazyGames\\rush-hour-rampage\\node_modules\\puppeteer-core\\lib\\puppeteer\\puppeteer-core.js');
const fs = require('fs');
const ROOT = '\\\\wsl.localhost\\Ubuntu\\home\\xeowyn\\CrazyGames\\WoodCuttingGame\\';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noop = (call) => [call, '(()=>0)('];
const V = {
  baseline: [],
  no_draw: [['src/main.js', '    try {\n      draw();', '    try {\n      ctx.fillStyle="#333";ctx.fillRect(0,0,50,50);']],
  no_plank: [['src/main.js', 'if (game.cut) R.drawPlank(ctx, L, game.cut, game.splitT);', '']],
  no_texture: [['src/render.js', '    tileTexture(ctx, tex, cx, bottomY, length, tint, L, PLANK_WIDTH);', '']],
  no_shading: [['src/render.js', '    plankShading(ctx, cx, bottomY, length, mat, PLANK_WIDTH, L);', '']],
  no_guide: [['src/render.js', '  const guide = drawGuideLine(ctx, L, cut, cx, bottomY, mat);', '  const guide = null;'], ['src/render.js', '  drawLineOverFinds(ctx, L, cut, cx, bottomY, mat, guide);', '']],
  no_kerf: [['src/render.js', '  drawKerf(ctx, cut, cx, bottomY, mat);', '']],
  no_bench: [['src/main.js', '  const ws = game.level ? game.level.workshop : R.DEFAULT_WORKSHOP;\n  R.drawBench(ctx, L, ws, game.time);\n\n  ctx.save();', '  const ws = game.level ? game.level.workshop : R.DEFAULT_WORKSHOP;\n  ctx.fillStyle="#432";ctx.fillRect(0,0,9999,9999);\n\n  ctx.save();']],
  no_table: [['src/main.js', '  R.drawSawTable(ctx, L, ws);\n  const sawOpts', '  const sawOpts']],
};
(async () => {
  for (const [name, subs] of Object.entries(V)) {
    const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: false, defaultViewport: null,
      userDataDir: process.env.TEMP + '\\cis_perf\\profile', args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--mute-audio'] });
    const page = (await browser.pages())[0];
    await page.setRequestInterception(true);
    page.on('request', (rq) => {
      const rel = new URL(rq.url()).pathname.replace(/^\//, '');
      const mine = subs.filter((s) => s[0] === rel);
      if (!mine.length) return rq.continue();
      let src = fs.readFileSync(ROOT + rel.replace(/\//g, '\\'), 'utf8');
      for (const [, a, b] of mine) { if (!src.includes(a)) console.log('  !! missing pattern', name, a.slice(0, 40)); src = src.replace(a, b); }
      rq.respond({ status: 200, contentType: 'text/javascript', body: src });
    });
    await page.evaluateOnNewDocument(() => { window.__testerBuild = true; });
    await page.goto('http://localhost:8936/', { waitUntil: 'domcontentloaded' });
    try { await page.waitForFunction(() => window.__gameState, { timeout: 20000 }); } catch (e) { console.log(name, 'boot failed'); await browser.close(); continue; }
    await sleep(2000);
    const r = await page.evaluate(async () => {
      window.__setLevel(12);
      setInterval(() => { if (window.__briefing()) window.__tapButton('brief-go'); window.__steerToLine(0); }, 6);
      await new Promise((r) => setTimeout(r, 3000));
      return new Promise((res) => { const d = []; let last = performance.now(); const t0 = last;
        const f = (t) => { d.push(t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res(Math.round(d.length / 3) + ' fps  p50 ' + d[d.length >> 1].toFixed(1) + 'ms'); } };
        requestAnimationFrame(f); });
    });
    console.log(name.padEnd(12), r);
    await browser.close();
  }
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
