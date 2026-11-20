'use strict';
// 网页版冒烟测试（2026-11-14）：把主要流程走一遍，截图 + 收集报错。改了渲染 / 主循环之后跑一遍。
//   普通局丢球 → 灌水 → 暂停 → 失败 → 结束页绶带带堆进美梦 → 长按连丢 → 摇一摇；
//   大肥鱼相消的时停（?debug 的 dfyFish）；镀金教程（时停 + 幕布开孔）；桌面视口和大屏（画布放大 2 倍那条路）。
// 用法：NODE_PATH=$(npm root -g) node tools/smoke_web.cjs . <截图输出目录> [--gpu] [--only 1,3]
const http = require('http'), fs = require('fs'), path = require('path');
// playwright：先按正常方式找（NODE_PATH=$(npm root -g) 或本地装的），找不到再试 Windows 的全局 npm 目录
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(path.join(process.env.APPDATA || '', 'npm/node_modules/playwright')); } })();
const DIR = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3] || 'smoke'), GPU = process.argv.includes('--gpu');
fs.mkdirSync(OUT, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  try { const b = fs.readFileSync(path.join(DIR, u)); const t = mime[path.extname(u)] || 'application/octet-stream'; res.setHeader('Content-Type', t + (/^(text\/|application\/(javascript|json))/.test(t) ? '; charset=utf-8' : '')); res.setHeader('Cache-Control', 'no-store'); res.end(b); } catch (e) { res.writeHead(404); res.end('404'); }
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: GPU ? 'chromium' : undefined, args: GPU ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] : [] });
  const errors = [];
  const open = async (query, tutSeen = true, vp = { width: 400, height: 860 }, dpr = 3) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(query + ' :: ' + String(e).slice(0, 400)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(query + ' :: console.' + m.type() + ': ' + m.text().slice(0, 300)); });
    await page.addInitScript((seen) => { try { localStorage.setItem('dfy_sound', '0'); if (seen) localStorage.setItem('dfy_tut', JSON.stringify({ gold: 1, shake: 1, dream: 1, water: 1 })); } catch (e) {} }, tutSeen);
    await page.goto(base + '/index.html' + query);
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    return { ctx, page };
  };
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
  const info = (page) => page.evaluate(() => window.dfyInfo());
  const tap = async (page, x, y) => { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); };
  const log = (...a) => console.log(...a);

  const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null, want = (n) => !ONLY || ONLY.includes(String(n));
  // ---- 1. 普通局：开始页 → 丢球 → 灌水 → 暂停 → 失败 → 带堆进美梦 → 摇一摇
  if (want(1)) {
    const { ctx, page } = await open('?dream&fps');
    await shot(page, '01-start');
    await page.evaluate(() => window.dfyStart(false));
    await page.waitForTimeout(500);
    for (let i = 0; i < 9; i++) { await tap(page, 80 + (i * 67) % 250, 400); await page.waitForTimeout(520); }
    await shot(page, '02-normal-play');
    log('normal play', JSON.stringify((({ state, balls, score, grid }) => ({ state, balls, score, grid }))(await info(page))));
    // 灌水
    await page.evaluate(() => { window.dfyFill('full'); });
    await page.waitForTimeout(6000);
    await page.evaluate(() => window.dfyShake(2));
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('bShake').click());
    await page.waitForTimeout(2600);
    await shot(page, '03-water-full');
    log('water', JSON.stringify((await info(page)).water));
    await page.waitForTimeout(2400);
    await shot(page, '04-water-drain');
    await page.waitForTimeout(2500);
    log('after water', JSON.stringify((({ state, balls, score, water }) => ({ state, balls, score, water }))(await info(page))));
    // 暂停 / 继续
    await page.evaluate(() => document.getElementById('bPause').click());
    await page.waitForTimeout(500);
    await shot(page, '05-pause');
    await page.evaluate(() => document.getElementById('bResume').click());
    await page.waitForTimeout(300);
    // 失败 → 结束页
    await page.evaluate(() => window.dfyFill('fail'));
    await page.waitForFunction(() => window.dfyInfo().state === 'over', null, { timeout: 30000 });
    await page.waitForTimeout(2600);
    await shot(page, '06-over');
    // 带堆进美梦（结束页绶带的月亮位置不好点，直接走它的回调等价物：确认框路径在暂停页，这里用 sashOver 的 pointer 事件）
    const r = await page.evaluate(() => { const el = document.getElementById('sashOver'), b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, shown: el.style.display }; });
    await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(600);
    await shot(page, '07-dream-thaw');
    log('dream import', JSON.stringify((({ state, dream, thaw, balls, grid }) => ({ state, dream, thaw, balls, grid }))(await info(page))));
    await page.waitForTimeout(2500);
    // 长按连丢 2 秒
    await page.mouse.move(200, 400); await page.mouse.down(); await page.waitForTimeout(700);
    for (let i = 0; i < 26; i++) { await page.mouse.move(200 + Math.sin(i / 3) * 130, 400); await page.waitForTimeout(50); }
    await page.mouse.up();
    await shot(page, '08-dream-drops');
    // 摇一摇
    await page.evaluate(() => window.dfyShake(1));
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('bShake').click());
    await page.waitForTimeout(900);
    await page.mouse.move(200, 490); await page.mouse.down();
    for (let i = 0; i < 30; i++) { await page.mouse.move(200 + (i % 2 ? 60 : -60), 490 + (i % 3 - 1) * 20); await page.waitForTimeout(60); if (i === 12) await shot(page, '09-dream-shake'); }
    await page.mouse.up();
    log('shaking', JSON.stringify((({ state, shaking, box, balls }) => ({ state, shaking, box, balls }))(await info(page))));
    await page.waitForTimeout(3500);
    await shot(page, '10-dream-after-shake');
    log('after shake', JSON.stringify((({ state, shaking, balls, score }) => ({ state, shaking, balls, score }))(await info(page))));
    log('fps box:', JSON.stringify(await page.evaluate(() => [...document.body.children].filter((e) => e.style && e.style.zIndex === '98').map((e) => e.textContent))));
    await ctx.close();
  }
  // ---- 2. 调试：大肥鱼相消的时停（普通 + 镀金）
  if (want(2)) {
    const { ctx, page } = await open('?debug&dream');
    await page.evaluate(() => window.dfyStart(false));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.dfyFish(1));
    for (let i = 0; i < 60; i++) { await page.waitForTimeout(50); const st = await page.evaluate(() => { const c = document.getElementById('cv'); return window.dfyInfo().balls; }); if (st < 2) break; if (i === 20) await shot(page, '11-fish-falling'); }
    await shot(page, '12-fish-after');
    await page.waitForTimeout(700);
    await shot(page, '13-fish-title');
    log('fish', JSON.stringify((({ state, balls, score, shakes }) => ({ state, balls, score, shakes }))(await info(page))));
    await ctx.close();
  }
  // ---- 3. 教程：镀金课（时停 + 幕布开孔）
  if (want(3)) {
    const { ctx, page } = await open('?dream&tutorial&gold', false);
    await page.evaluate(() => window.dfyStart(false));
    await page.waitForTimeout(400);
    for (let i = 0; i < 40; i++) { if ((await info(page)).state === 'tut') break; await tap(page, 60 + (i * 97) % 280, 400); await page.waitForTimeout(560); }
    await page.waitForTimeout(1600);
    await shot(page, '14-tut-gold');
    log('tut', JSON.stringify((({ state, balls }) => ({ state, balls }))(await info(page))));
    if ((await info(page)).state === 'tut') await page.evaluate(() => document.getElementById('bTutOk').click());
    await page.waitForTimeout(500);
    for (let i = 0; i < 4; i++) { await tap(page, 120 + i * 40, 400); await page.waitForTimeout(520); }
    await shot(page, '15-after-tut');
    log('after tut', JSON.stringify((({ state, balls, score, golds }) => ({ state, balls, score, golds: golds.length }))(await info(page))));
    await ctx.close();
  }
  // ---- 4. 桌面视口（p < 1，间接/平滑）和大屏（kc = 2）各丢几个
  if (want(4)) for (const [name, vp, dpr] of [['desk', { width: 1100, height: 700 }, 1.25], ['big', { width: 800, height: 1600 }, 3]]) {
    const { ctx, page } = await open('?dream', true, vp, dpr);
    await page.evaluate(() => window.dfyStart(true));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.dfyFill('full'));
    await page.waitForTimeout(5000);
    await shot(page, '16-' + name + '-dream');
    log(name, JSON.stringify((({ state, balls, grid }) => ({ state, balls, grid }))(await info(page))), await page.evaluate(() => { const c = document.getElementById('cv'); return c.width + 'x' + c.height + ' css ' + c.style.width; }));
    await ctx.close();
  }
  // ---- 5. 开始页 ↔ 游戏来回切（画布不重设尺寸，只在「直接画」和「先画中间画面再放大」之间换）+ 窗口缩放
  if (want(5)) {
    const { ctx, page } = await open('?dream');
    const dims = () => page.evaluate(() => { const c = document.getElementById('cv'); return c.width + 'x' + c.height + ' css ' + c.style.width; });
    await page.evaluate(() => document.getElementById('bStart').click());
    await page.waitForTimeout(400);
    for (let i = 0; i < 6; i++) { await tap(page, 90 + i * 45, 400); await page.waitForTimeout(520); }
    await shot(page, '17-play');
    await page.evaluate(() => document.getElementById('bPause').click()); await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('bRestart').click()); await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('bCfmYes').click()); await page.waitForTimeout(700);
    await shot(page, '18-back-to-menu'); log('menu', await dims());
    await page.evaluate(() => document.getElementById('bStart').click());
    await page.waitForTimeout(400);
    for (let i = 0; i < 4; i++) { await tap(page, 120 + i * 50, 400); await page.waitForTimeout(520); }
    await shot(page, '19-play-again'); log('play again', await dims());
    await page.setViewportSize({ width: 400, height: 800 }); await page.waitForTimeout(500);
    await shot(page, '20-resized-height');
    await page.setViewportSize({ width: 360, height: 800 }); await page.waitForTimeout(500);
    for (let i = 0; i < 3; i++) { await tap(page, 100 + i * 60, 380); await page.waitForTimeout(520); }
    await shot(page, '21-resized-width'); log('resized', await dims());
    await ctx.close();
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  await browser.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
