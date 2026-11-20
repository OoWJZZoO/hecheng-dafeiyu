'use strict';
// 网页版性能测量（2026-11-14）。在 Chromium 里模拟手机视口，量每帧 JS 耗时（物理 / 其余）、帧间隔、节奏。
// 需要 playwright（全局装的就行）：NODE_PATH=$(npm root -g) node tools/perf_web.cjs . [选项]
//
//   node tools/perf_web.cjs <站点目录> [--scene 场景] [选项]
//   场景：
//     dream-pile   还原 --pile 里的一堆（默认 tools/perf_pile.json：美梦快堆满、150 个球），长按连丢着量（默认）
//     normal-idle / dream-idle   开一局不丢东西，量空场的底噪
//     fall         空的美梦容器里丢一个球，逐帧记它画在哪：看节奏匀不匀（配 --gpu --hz 90 之类）
//     sat-check    新旧分离轴算法同时算、逐次比较（应当 bad / axisDiff / signDiff 全是 0）
//     make-pile    虚拟时钟快进、长按连丢到快堆满，把场上的东西存成 --pile（要重新做一堆基准时用）
//   选项：
//     --throttle 4     主线程降速几倍（CDP），拿电脑模拟慢手机
//     --gpu            用带 GPU 的新 headless（画布走显卡；不加就是软件光栅，相当于「画布没有硬件加速」的浏览器）
//     --hz 90          只在凑够一个周期时才放行一帧，粗略模拟别的刷新率（要比真实刷新率低；配 --gpu）
//     --secs 8  --vw 400 --vh 860 --dpr 3  --query "fps&nosat"  --shot x.png
//     --profile x.cpuprofile   采 CPU profile，并打印自身耗时前 30 名
//     --trace          每半秒打印球数 / 碰撞对数 / 单步物理耗时
//     --dump x.txt     逐帧数据（帧间隔 JS 物理 步数）
// 注意：
//   · 页面里换了固定种子的 Math.random、教程全标成看过、静音；同一堆东西才好比改前改后。
//   · 笔记本连着跑会降频，后几秒的数会变差好几倍：两次测量之间歇 20 秒，或者交替着测。
//   · --gpu 时帧率跟显示器走（180Hz 的屏就是 180）；软件光栅固定 60。
const http = require('http'), fs = require('fs'), path = require('path');
// playwright：先按正常方式找（NODE_PATH=$(npm root -g) 或本地装的），找不到再试 Windows 的全局 npm 目录
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(path.join(process.env.APPDATA || '', 'npm/node_modules/playwright')); } })();
const args = process.argv.slice(2);
const DIR = path.resolve(args[0] || '.');
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const SCENE = opt('scene', 'dream-pile'), THROTTLE = +opt('throttle', 1), GPU = !!opt('gpu', false), PROFILE = opt('profile', ''), SECS = +opt('secs', 8);
const VW = +opt('vw', 400), VH = +opt('vh', 860), DPR = +opt('dpr', 3), SHOT = opt('shot', ''), QUERY = opt('query', ''), PILE = opt('pile', path.join(__dirname, 'perf_pile.json')), CTXPROF = !!opt('ctxprof', false);
const FILL_TOP = +opt('filltop', -260), NODROP = !!opt('nodrop', false), HZ = +opt('hz', 0);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const f = path.join(DIR, u);
  try {
    const b = fs.readFileSync(f);
    const t = mime[path.extname(f)] || 'application/octet-stream';
    res.setHeader('Content-Type', t + (/^(text\/|application\/(javascript|json))/.test(t) ? '; charset=utf-8' : ''));
    res.setHeader('Cache-Control', 'no-store');
    res.end(b);
  } catch (e) { res.writeHead(404); res.end('404'); }
});
const stat = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)} | p50 ${q(0.5).toFixed(1)} | p95 ${q(0.95).toFixed(1)} | max ${s[s.length - 1].toFixed(1)}`;
};
// 页面里的插桩：固定随机种子、可切换的虚拟时钟（快进用）、rAF/物理计时、合成指针
function inject(cfg) {
  try { localStorage.setItem('dfy_tut', JSON.stringify({ gold: 1, shake: 1, dream: 1, water: 1 })); localStorage.setItem('dfy_sound', '0'); } catch (e) {}   // 教程都当看过（不然会时停）、静音
  let s = 0x2545F491;
  Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const P = window.__perf = { on: false, frames: [], phys: 0, physN: 0, engine: null, fast: 0, ctx: {}, sweep: false };
  const realNow = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window);
  let skew = 0, frozen = null;                       // frozen：快进时一帧里的时间定住
  performance.now = () => frozen !== null ? frozen : realNow() + skew;
  let queue = [], pending = false, lastT = 0, hzAcc = 0, lastReal = 0;
  const sweepX = (t) => cfg.vw / 2 + Math.sin(t / 2300) * cfg.vw * 0.36 + Math.sin(t / 610) * cfg.vw * 0.08;
  const ptr = (type, x) => { const cv = document.getElementById('cv'); (type === 'pointerdown' ? cv : window).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: cfg.vh * 0.45, pointerId: 7, pointerType: 'touch', bubbles: true })); };
  P.down = () => { ptr('pointerdown', cfg.vw / 2); P.sweep = true; P.downAt = performance.now(); };
  P.up = () => { P.sweep = false; ptr('pointerup', cfg.vw / 2); };
  const runFrame = (t) => {
    if (P.sweep && t - P.downAt > 600) ptr('pointermove', sweepX(t));   // 长按连丢开始后左右扫
    const cbs = queue; queue = [];
    const t0 = realNow();
    P.phys = 0; P.physN = 0;
    for (const cb of cbs) cb(t);
    const t1 = realNow();
    if (P.on) P.frames.push([t - lastT, t1 - t0, P.phys, P.physN]);
    lastT = t;
  };
  const pump = (rt) => {
    pending = false;
    if (cfg.hz && !P.fast) {            // 模拟别的刷新率：只在凑够一个周期时才放行（测帧节奏用，不是真的高刷）
      hzAcc += rt - lastReal; lastReal = rt;
      const per = 1000 / cfg.hz;
      if (hzAcc < per - 0.5) { pending = true; raf(pump); return; }
      hzAcc = Math.min(hzAcc - per, per);
    }
    if (P.fast) {
      let vt = realNow() + skew;
      const until = realNow() + 12;      // 每个真实帧里尽量多跑几步虚拟帧
      do { frozen = vt; runFrame(vt); vt += 1000 / 60; } while (P.fast && queue.length && realNow() < until);
      skew = vt - realNow(); frozen = null;
    } else runFrame(rt + skew);
    if (queue.length && !pending) { pending = true; raf(pump); }
  };
  window.requestAnimationFrame = (cb) => { queue.push(cb); if (!pending) { pending = true; raf(pump); } return 0; };
  const hook = () => {
    if (!window.Matter) return false;
    const E = window.Matter.Engine, up = E.update;
    E.update = function (...a) { P.engine = a[0]; const t0 = realNow(); const r = up.apply(this, a); P.phys += realNow() - t0; P.physN++; return r; };
    return true;
  };
  const iv = setInterval(() => { if (hook()) clearInterval(iv); }, 2);
  P.bodies = () => P.engine ? window.Matter.Composite.allBodies(P.engine.world).filter((b) => b.tier !== undefined) : [];
  P.snap = () => P.bodies().map((b) => ({ tier: b.tier, x: +b.position.x.toFixed(2), y: +b.position.y.toFixed(2), angle: +b.angle.toFixed(4), gold: !!b.gold }));
  P.top = () => { let t = Infinity; for (const b of P.bodies()) if (Math.abs(b.velocity.y) < 0.5 && realNow() + skew - b.born > 600) t = Math.min(t, b.bounds.min.y); return t; };
  if (cfg.ctxprof) {
    const C = CanvasRenderingContext2D.prototype;
    for (const name of ['drawImage', 'fillRect', 'clearRect', 'putImageData', 'getImageData']) {
      const f = C[name];
      C[name] = function (...a) {
        const t0 = realNow(); const r = f.apply(this, a); const dt = realNow() - t0;
        let key = name + ' → ' + this.canvas.width + 'x' + this.canvas.height;
        if (name === 'drawImage') { const src = a[0]; key += ' ⇐ ' + (src.tagName === 'CANVAS' ? 'canvas ' : 'img ') + (src.naturalWidth || src.width) + 'x' + (src.naturalHeight || src.height); }
        if (P.on) { const e = P.ctx[key] || (P.ctx[key] = [0, 0]); e[0] += dt; e[1]++; }
        return r;
      };
    }
    for (const name of ['width', 'height']) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name);
      Object.defineProperty(HTMLCanvasElement.prototype, name, { get: d.get, set(v) { if (P.on) { const k = 'resize canvas (' + name + ')'; const e = P.ctx[k] || (P.ctx[k] = [0, 0]); const t0 = realNow(); d.set.call(this, v); e[0] += realNow() - t0; e[1]++; } else d.set.call(this, v); } });
    }
  }
}
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const launchArgs = GPU ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu-rasterization'] : [];
  launchArgs.push('--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling', '--disable-hang-monitor');
  const browser = await chromium.launch({ headless: true, channel: GPU ? 'chromium' : undefined, args: launchArgs });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.addInitScript(inject, { vw: VW, vh: VH, ctxprof: CTXPROF, hz: HZ });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(base + '/index.html?dream' + (QUERY ? '&' + QUERY : ''));
  await page.waitForFunction(() => typeof window.dfyStart === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const info = () => page.evaluate(() => window.dfyInfo());
  const dream = SCENE.startsWith('dream') || SCENE === 'make-pile';

  if (SCENE === 'make-pile') {
    // 虚拟时钟快进：长按连丢 + 左右扫，直到落稳的最高点到 FILL_TOP（世界坐标；美梦红线在 -376），存堆
    await page.evaluate(() => window.dfyStart(true));
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__perf.fast = 1; window.__perf.down(); });
    let top = Infinity, n = 0, st = 'play';
    for (let i = 0; i < 2400 && top > FILL_TOP && st === 'play'; i++) {
      await page.waitForTimeout(250);
      [top, n, st] = await page.evaluate(() => [window.__perf.top(), window.__perf.bodies().length, window.dfyInfo().state]);
      if (i % 20 === 0) console.log('fill', i, 'balls', n, 'top', Math.round(top), st);
    }
    await page.evaluate(() => { window.__perf.up(); window.__perf.fast = 0; });
    const pile = await page.evaluate(() => window.__perf.snap());
    const hist = {}; for (const p of pile) hist[p.tier] = (hist[p.tier] || 0) + 1;
    fs.writeFileSync(PILE || 'pile.json', JSON.stringify(pile));
    console.log('pile', pile.length, 'golds', pile.filter((p) => p.gold).length, 'tiers', JSON.stringify(hist), 'top', Math.round(top), st);
    if (SHOT) await page.screenshot({ path: SHOT });
    await browser.close(); server.close(); return;
  }

  if (SCENE === 'sat-check') {
    const pile = JSON.parse(fs.readFileSync(PILE, 'utf8'));
    await page.evaluate((p) => window.dfyPile(p), pile);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const C = window.Matter.Collision, fast = C._overlapAxes, ref = C._overlapAxesRef, tmp = { overlap: 0, axis: null };
      const S = window.__sat = { calls: 0, bad: 0, maxErr: 0, axisDiff: 0, signDiff: 0, sample: [] };
      C._overlapAxes = function (r, a, b, ax) {
        fast.call(C, r, a, b, ax); ref.call(C, tmp, a, b, ax); S.calls++;
        const e = Math.abs(r.overlap - tmp.overlap);
        if (e > S.maxErr) S.maxErr = e;
        if (e > 1e-9) { S.bad++; if (S.sample.length < 5) S.sample.push([r.overlap, tmp.overlap, a.length, b.length, ax.length]); }
        if ((r.overlap <= 0) !== (tmp.overlap <= 0)) S.signDiff++;
        if (r.axis !== tmp.axis) S.axisDiff++;
      };
      window.__perf.fast = 1; window.__perf.down();
    });
    for (let i = 0; i < +opt('rounds', 40); i++) { await page.waitForTimeout(500); if (i === 10) await page.evaluate(() => { window.dfyShake && window.dfyShake(3); }); }
    const r = await page.evaluate(() => { window.__perf.up(); window.__perf.fast = 0; return { ...window.__sat, balls: window.__perf.bodies().length, state: window.dfyInfo().state }; });
    console.log('SAT check', JSON.stringify(r)); if (errors.length) console.log(errors);
    await browser.close(); server.close(); return;
  }
  if (SCENE === 'fall') {
    // 节奏测试：空的美梦容器里丢一个球，记每帧它被画在哪（取这一帧所有精灵 drawImage 里最靠下的那个的 y），看逐帧位移匀不匀
    await page.evaluate(() => window.dfyStart(true));
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const P = window.__perf, C = CanvasRenderingContext2D.prototype, di = C.drawImage;
      P.fall = []; P.fy = -1e9;
      C.drawImage = function (...a) { const src = a[0]; if (src && src.tagName === 'IMG' && this.canvas.id === 'cv' || (src && src.tagName === 'IMG' && this.canvas.width > 500)) { const f = this.getTransform().f; if (f > P.fy) P.fy = f; } return di.apply(this, a); };
      const raf0 = window.requestAnimationFrame;
      const tick = (t) => { if (P.rec) P.fall.push([t, P.fy]); P.fy = -1e9; raf0(tick); };
      raf0(tick);
    });
    await page.mouse.move(VW / 2, VH * 0.45); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up();
    await page.evaluate(() => { window.__perf.rec = true; });
    await page.waitForTimeout(1100);
    const fall = await page.evaluate(() => { window.__perf.rec = false; return window.__perf.fall; });
    // 逐帧速度（像素/毫秒），去掉头几帧；匀加速运动的速度应当是一条直线：拟合直线后看残差
    const pts = fall.filter((f) => f[1] > -1e8).slice(3, 3 + 90), v = [];
    for (let i = 1; i < pts.length; i++) { const dt = pts[i][0] - pts[i - 1][0]; if (dt > 0) v.push([pts[i][0], (pts[i][1] - pts[i - 1][1]) / dt, pts[i][1] - pts[i - 1][1], dt]); }
    const n = v.length, mx = v.reduce((a, q) => a + q[0], 0) / n, my = v.reduce((a, q) => a + q[1], 0) / n;
    const k = v.reduce((a, q) => a + (q[0] - mx) * (q[1] - my), 0) / v.reduce((a, q) => a + (q[0] - mx) ** 2, 0);
    const res = v.map((q) => q[1] - (my + k * (q[0] - mx))), rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / n);
    const zero = v.filter((q) => Math.abs(q[2]) < 1e-6).length;
    const gaps = v.map((q) => q[3]).sort((a, b) => a - b);
    console.log(`[${path.basename(DIR)}] fall ${GPU ? 'gpu' : 'soft'} hz=${HZ || 'native'} frames ${n} (median gap ${gaps[n >> 1].toFixed(2)}ms)  没动的帧 ${zero}  速度残差 rms ${(rms / my * 100).toFixed(1)}% of mean  逐帧位移(px): ` + v.slice(20, 44).map((q) => q[2].toFixed(1)).join(' '));
    if (errors.length) console.log(errors);
    await browser.close(); server.close(); return;
  }
  if (SCENE === 'dream-pile') {
    const pile = JSON.parse(fs.readFileSync(PILE, 'utf8'));
    await page.evaluate((p) => window.dfyPile(p), pile);
    await page.waitForTimeout(3500);        // 解冻 0.9 秒 + 落稳
  } else {
    await page.evaluate((d) => window.dfyStart(d), dream);
    await page.waitForTimeout(800);
  }
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.waitForTimeout(400);
  const before = await info();
  if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const drops = SCENE === 'dream-pile' && !NODROP;
  await page.evaluate((d) => { const P = window.__perf; P.frames.length = 0; P.ctx = {}; P.on = true; if (d) P.down(); }, drops);
  if (opt('trace', false)) {
    for (let i = 0; i < SECS * 2; i++) {
      await page.waitForTimeout(500);
      console.log('  t=' + (i + 1) / 2, JSON.stringify(await page.evaluate(() => { const P = window.__perf, e = P.engine, bs = P.bodies(); const fr = P.frames.slice(-20); return { balls: bs.length, pairs: e.pairs.list.length, active: e.pairs.list.filter((p) => p.isActive).length, maxSpeed: +Math.max(...bs.map((b) => b.speed)).toFixed(1), minY: Math.round(Math.min(...bs.map((b) => b.bounds.min.y))), phys: +(fr.reduce((a, f) => a + f[2], 0) / Math.max(1, fr.reduce((a, f) => a + f[3], 0))).toFixed(1), state: window.dfyInfo().state }; })));
    }
  } else
  await page.waitForTimeout(SECS * 1000);
  const { frames, ctxp } = await page.evaluate((d) => { const P = window.__perf; if (d) P.up(); P.on = false; return { frames: P.frames, ctxp: P.ctx }; }, drops);
  let top = null;
  if (PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    fs.writeFileSync(PROFILE, JSON.stringify(profile));
    const self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map((n) => [n.id, n]));
    let total = 0;
    profile.samples.forEach((id, i) => { const n = byId.get(id), k = n.callFrame.functionName + ' ' + path.basename(n.callFrame.url || '').split('?')[0] + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); total += dt[i] || 0; });
    top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const after = await info();
  if (SHOT) await page.screenshot({ path: SHOT });
  const fr = frames.slice(5);
  if (opt('dump', '')) fs.writeFileSync(opt('dump', ''), frames.map((f) => f.map((v) => +v.toFixed(2)).join(' ')).join(';'));
  const steps = fr.reduce((a, f) => a + f[3], 0), dur = fr.reduce((a, f) => a + f[0], 0);
  console.log(`[${path.basename(DIR)}] ${SCENE} throttle×${THROTTLE}${GPU ? ' gpu' : ''} ${VW}x${VH}@${DPR} grid ${after.grid} balls ${before.balls}→${after.balls} golds ${before.golds.length}→${after.golds.length}`);
  console.log(`  fps ${(fr.length / dur * 1000).toFixed(1)}  steps/s ${(steps / dur * 1000).toFixed(1)}  frames ${fr.length}`);
  console.log('  gap  ' + stat(fr.map((f) => f[0])));
  console.log('  js   ' + stat(fr.map((f) => f[1])));
  console.log('  phys ' + stat(fr.map((f) => f[2])) + `   (per step ${(fr.reduce((a, f) => a + f[2], 0) / Math.max(1, steps)).toFixed(2)})`);
  console.log('  rest ' + stat(fr.map((f) => f[1] - f[2])));
  if (errors.length) console.log('  ERRORS', errors);
  if (CTXPROF) for (const [k, [t, n]] of Object.entries(ctxp).sort((a, b) => b[1][0] - a[1][0]).slice(0, 22)) console.log(`  ${(t / fr.length).toFixed(3).padStart(7)} ms/frame ${(n / fr.length).toFixed(1).padStart(7)} calls/frame  ${k}`);
  if (top) console.log(top.join('\n'));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
