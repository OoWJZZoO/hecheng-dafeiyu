/**
 * 《合成大肥鱼》乐谱渲染器 · 核心（剥离版）
 * ============================================================================
 * 从游戏 bgm.js 里抽出来的渲染核心，**不含任何曲目数据**，可以直接丢给模型作曲、本地试听、离线渲染。
 *
 * 能力：
 *   · 4 种音色：脉冲波（可调占空比 + 逐音低通 + 逐音包络 + 颤音 + 声像）／三角波／铃音／铺底和弦
 *   · 每首一条混音链：L/R 两条单声道总线 + lead 两条带交叉回声的总线 → 立体声 → 母带两级低通 → 淡出 → 音量
 *   · 播放器：lookahead 排音（每 35ms 排未来 140ms），支持循环、结尾淡出、暂停/停止
 *   · 离线渲染：OfflineAudioContext 一次性烘成 AudioBuffer（量响度、做 A/B、导出都靠它）
 *
 * 用法（浏览器）：
 *   <script src="bgm-engine.js"></script>
 *   const eng = BGMEngine.create();                 // 内部自己建 AudioContext
 *   eng.play(score, { loop: true });                // 现场放（用户点过页面之后才行）
 *   const buf = await BGMEngine.render(score, 44100); // 离线烘，不发声
 *
 * 曲谱格式见同目录 README.md；这里只放机制，不放曲子。
 * ============================================================================
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. 波形：把「理想波形 + 谐波截断」做成 PeriodicWave
  //    脉冲波和 16 级量化三角波都是先在一个周期里取 4096 个点，再做离散傅里叶，
  //    只保留前 256 次谐波 → 没有混叠（逐采样生成的方波会带混叠，高音发「毛」）。
  // ---------------------------------------------------------------------------
  const WAVE_N = 4096, WAVE_H = 256;
  const waveCache = new WeakMap();
  const cosTab = new Float64Array(WAVE_N), sinTab = new Float64Array(WAVE_N);
  for (let i = 0; i < WAVE_N; i++) { cosTab[i] = Math.cos(2 * Math.PI * i / WAVE_N); sinTab[i] = Math.sin(2 * Math.PI * i / WAVE_N); }

  // numpy 的 round 是「四舍六入五成双」
  const roundEven = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
  const triQ = (ph) => roundEven((2 * Math.abs(2 * ph - 1) - 1) * 7.5) / 7.5;
  const pulse = (ph, duty) => (ph < duty ? 1 : -1) - (2 * duty - 1);

  function scoreWave(c, name, fn) {
    let m = waveCache.get(c);
    if (!m) waveCache.set(c, (m = {}));
    if (m[name]) return m[name];
    const x = new Float64Array(WAVE_N);
    for (let i = 0; i < WAVE_N; i++) x[i] = fn(i / WAVE_N);
    const re = new Float32Array(WAVE_H + 1), im = new Float32Array(WAVE_H + 1);
    for (let k = 1; k <= WAVE_H; k++) {
      let a = 0, b = 0;
      for (let i = 0, j = 0; i < WAVE_N; i++, j = (j + k) & (WAVE_N - 1)) { a += x[i] * cosTab[j]; b += x[i] * sinTab[j]; }
      re[k] = 2 * a / WAVE_N; im[k] = 2 * b / WAVE_N;
    }
    return (m[name] = c.createPeriodicWave(re, im, { disableNormalization: true }));
  }

  // ---------------------------------------------------------------------------
  // 2. 包络：按「脚本式 ADSR」逐毫秒取一点，交给 setValueCurveAtTime
  //    a=起音(秒)  d=衰减(秒)  su=延音电平(0..1)  r=释音(秒)  e=指数衰减速率(1/秒)
  //    和逐采样算包络的脚本相比只差 1ms 的精度，听不出。
  // ---------------------------------------------------------------------------
  const SR_PY = 44100;
  function envCurve(dur, amp, a, d, su, r, e, chimeDecay) {
    const n = Math.round(dur * SR_PY);
    const an = Math.min(Math.floor(a * SR_PY), n), dn = Math.min(Math.floor(d * SR_PY), Math.max(0, n - an));
    const rn = Math.min(Math.floor(r * SR_PY), n), rs = Math.max(0, n - rn), rl = n - rs;
    const pts = Math.max(2, Math.ceil(dur * 1000) + 1);
    const out = new Float32Array(pts);
    for (let i = 0; i < pts; i++) {
      const k = Math.min(n - 1, Math.round(i / (pts - 1) * (n - 1)));
      let v = su;
      if (k < an) v = k / an;
      else if (k < an + dn) v = su + (1 - su) * Math.pow(1 - (k - an) / dn, 1.6);
      else if (e > 0) v = su * Math.exp(-(k - an - dn) / SR_PY * e);
      if (rn > 0 && k >= rs) v *= rl > 1 ? 1 - (k - rs) / (rl - 1) : 1;
      if (chimeDecay) v *= Math.exp(-k / SR_PY * chimeDecay);
      out[i] = v * amp;
    }
    return out;
  }

  function lowpass(c, f) {
    const b = c.createBiquadFilter();
    b.type = 'lowpass';
    b.frequency.value = f;
    b.Q.value = -3.0103;   // 低通的 Q 以 dB 计：−3.01 dB = 1/√2，巴特沃斯
    return b;
  }

  // ---------------------------------------------------------------------------
  // 3. 一首的混音图
  //    L / R 两条单声道总线（lead 另有两条）→ 立体声 → 母带两级低通 → 淡出 → 音量
  //    echo = [延迟1(秒), 增益1, 延迟2(秒), 增益2]：交叉回声 + 同侧二次回声
  // ---------------------------------------------------------------------------
  function buildScoreGraph(c, dest, S, vol) {
    const mono = () => { const g = c.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; return g; };
    const L = mono(), R = mono(), leadL = mono(), leadR = mono();
    leadL.connect(L); leadR.connect(R);
    const echo = (from, to, d, g) => {
      const dl = c.createDelay(2); dl.delayTime.value = d;
      const gg = c.createGain(); gg.gain.value = g;
      from.connect(dl); dl.connect(gg); gg.connect(to);
    };
    echo(leadR, L, S.echo[0], S.echo[1]);
    echo(leadL, R, S.echo[0], S.echo[1]);
    echo(leadL, L, S.echo[2], S.echo[3]);
    echo(leadR, R, S.echo[2], S.echo[3]);
    const mg = c.createChannelMerger(2);
    L.connect(mg, 0, 0); R.connect(mg, 0, 1);
    const lp1 = lowpass(c, S.lpf), lp2 = lowpass(c, S.lpf), fade = c.createGain(), out = c.createGain();
    out.gain.value = vol;
    mg.connect(lp1); lp1.connect(lp2); lp2.connect(fade); fade.connect(out); out.connect(dest);
    return { L, R, leadL, leadR, fade, out, vol };
  }

  // ---------------------------------------------------------------------------
  // 4. 排一个音（事件格式见 README）
  //    p 脉冲  ['p', t, dur, freq, duty, amp, cutoff, a, d, s, r, e, vibHz, vibCents, vibDelay, gL, gR, lead]
  //    t 三角  ['t', t, dur, freq, amp, a, d, s, r, e, gL, gR, lead]
  //    c 铃音  ['c', t, dur, freq, amp, cutoff, a, d, s, r, e, gL, gR, lead]
  //    d 铺底  ['d', t, dur, [freq,...], duty, amp, cutoff, a, d, s, r, e, gL, gR, lead]
  // ---------------------------------------------------------------------------
  function scoreEvent(c, G, S, ev, t0) {
    const kind = ev[0], dur = ev[2];
    let src, curve, gl;
    const osc = (wave, f) => {
      const o = c.createOscillator();
      o.setPeriodicWave(wave); o.frequency.value = f;
      o.start(t0); o.stop(t0 + dur + 0.02);
      return o;
    };
    if (kind === 'p') {
      const f = ev[3], duty = ev[4];
      const o = osc(scoreWave(c, 'p' + duty, (ph) => pulse(ph, duty)), f);
      if (ev[13] > 0 && dur > ev[14] + 0.06) {
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = ev[12];
        lg.gain.setValueAtTime(0, t0);
        lg.gain.setValueAtTime(0, t0 + ev[14]);
        lg.gain.linearRampToValueAtTime(ev[13], t0 + ev[14] + 0.2);
        lfo.connect(lg); lg.connect(o.detune);
        lfo.start(t0); lfo.stop(t0 + dur + 0.02);
      }
      const lp = lowpass(c, ev[6]);
      o.connect(lp); src = lp;
      const comp = f < 900 ? 1 : Math.max(0.74, Math.pow(900 / f, 0.45));   // 高音自然压一点，别刺
      curve = envCurve(dur, ev[5] * comp, ev[7], ev[8], ev[9], ev[10], ev[11], 0);
      gl = ev.slice(15);
    } else if (kind === 't') {
      src = osc(scoreWave(c, 'tq', triQ), ev[3]);
      curve = envCurve(dur, ev[4], ev[5], ev[6], ev[7], ev[8], ev[9], 0);
      gl = ev.slice(10);
    } else if (kind === 'c') {
      const [sq, tri, dec] = S.chime;
      const o = osc(scoreWave(c, 'c' + sq, (ph) => sq * (ph < 0.5 ? 1 : -1) + tri * (2 * Math.abs(2 * ph - 1) - 1)), ev[3]);
      const lp = lowpass(c, ev[5]);
      o.connect(lp); src = lp;
      curve = envCurve(dur, ev[4], ev[6], ev[7], ev[8], ev[9], ev[10], dec);
      gl = ev.slice(11);
    } else {   // 'd'
      const fs = ev[3], duty = ev[4];
      const sum = c.createGain();
      sum.gain.value = 1 / Math.max(1, Math.pow(fs.length, 0.65));
      const w = scoreWave(c, 'd' + duty, (ph) => 0.22 * pulse(ph, duty) + 0.78 * triQ(ph));
      fs.forEach((f, i) => osc(w, f * (1 + (i - (fs.length - 1) / 2) * 0.0007)).connect(sum));   // 轻微失谐，更宽
      const lp1 = lowpass(c, ev[6]), lp2 = lowpass(c, ev[6]);
      sum.connect(lp1); lp1.connect(lp2); src = lp2;
      curve = envCurve(dur, ev[5], ev[7], ev[8], ev[9], ev[10], ev[11], 0);
      gl = ev.slice(12);
    }
    const env = c.createGain();
    env.gain.value = 0;
    env.gain.setValueCurveAtTime(curve, t0, dur);
    src.connect(env);
    const l = c.createGain(), r = c.createGain();
    l.gain.value = gl[0]; r.gain.value = gl[1];
    env.connect(l); env.connect(r);
    l.connect(gl[2] ? G.leadL : G.L); r.connect(gl[2] ? G.leadR : G.R);
  }

  // 结尾淡出：[时长(秒), 曲线指数]，指数越大收得越快
  function scoreFade(c, G, S, at) {
    const n = 200, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) cv[i] = Math.pow(1 - i / (n - 1), S.fade[1]);
    G.fade.gain.cancelScheduledValues(0);
    G.fade.gain.setValueAtTime(1, 0);
    G.fade.gain.setValueCurveAtTime(cv, at, S.fade[0]);
  }

  // ---------------------------------------------------------------------------
  // 5. 曲谱默认值 / 校验
  // ---------------------------------------------------------------------------
  function normalize(score) {
    if (!score || !Array.isArray(score.events)) throw new Error('score.events 必须是数组');
    const S = {
      total: score.total,
      echo: score.echo || [0.45, 0.20, 0.90, 0.08],
      lpf: score.lpf || 9600,
      fade: score.fade || [2.5, 1.5],
      master: score.master == null ? 1 : score.master,
      chime: score.chime || [0.45, 0.55, 3.0],
      events: score.events,
    };
    if (!(S.total > 0)) {
      let last = 0;
      for (const e of S.events) last = Math.max(last, (e[1] || 0) + (e[2] || 0));
      S.total = last + 0.3;
    }
    return S;
  }

  // ---------------------------------------------------------------------------
  // 6. 实时播放器：lookahead 排音 + 夹时间 + 逐音隔离 + 循环 + 结尾淡出
  // ---------------------------------------------------------------------------
  const LOOKAHEAD_SEC = 0.14, TIMER_MS = 35;

  function Engine(audioCtx, opts) {
    const AC = global.AudioContext || global.webkitAudioContext;
    this.ctx = audioCtx || new AC();
    this.dest = (opts && opts.destination) || this.ctx.destination;
    this._st = null;
    this._timer = null;
  }

  Engine.prototype.play = function (score, opt) {
    opt = opt || {};
    this.stop(0.02);
    const ctx = this.ctx;
    if (ctx.state !== 'running' && ctx.resume) ctx.resume().catch(() => {});
    const S = normalize(score);
    const gain = opt.gain == null ? 1 : opt.gain;
    const G = buildScoreGraph(ctx, this.dest, S, S.master * gain);
    const st = {
      S, G, gain,
      startAt: ctx.currentTime + (opt.delay == null ? 0.06 : opt.delay),
      idx: 0, cycle: 0,
      loop: !!opt.loop,
      fadeSet: false,
      done: false,
    };
    this._st = st;
    const tick = () => {
      if (this._st !== st || st.done) return;
      const now = ctx.currentTime, horizon = now + LOOKAHEAD_SEC;
      const E = st.S.events;
      try {
        while (st.idx < E.length) {
          const ev = E[st.idx];
          const when = st.startAt + ev[1] + st.cycle * st.S.total;
          if (when >= horizon) break;
          try { scoreEvent(ctx, st.G, st.S, ev, Math.max(when, now + 0.008)); } catch (e) { /* 一个音坏了只丢它 */ }
          st.idx++;
        }
        if (!st.loop && st.S.fade && !st.fadeSet && st.startAt + st.S.total - st.S.fade[0] < horizon) {
          try { scoreFade(ctx, st.G, st.S, Math.max(st.startAt + st.S.total - st.S.fade[0], now + 0.02)); } catch (e) {}
          st.fadeSet = true;
        }
        if (st.idx >= E.length) {
          if (st.loop) { st.idx = 0; st.cycle++; }
          else if (now >= st.startAt + st.S.total) { st.done = true; }
        }
      } catch (e) { /* 整拍失败也不让定时器停 */ }
    };
    tick();
    this._timer = setInterval(tick, TIMER_MS);
  };

  Engine.prototype.stop = function (fadeSec) {
    const st = this._st;
    this._st = null;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (!st) return;
    const ctx = this.ctx, now = ctx.currentTime, d = fadeSec == null ? 0.15 : fadeSec;
    try {
      const g = st.G.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.linearRampToValueAtTime(0.0001, now + d);
      setTimeout(() => { try { st.G.out.disconnect(); } catch (e) {} }, (d + 0.4) * 1000);
    } catch (e) {}
  };

  Object.defineProperty(Engine.prototype, 'duration', {
    get() { return this._st ? this._st.S.total : 0; },
  });

  // ---------------------------------------------------------------------------
  // 7. 离线渲染：一次烘成 AudioBuffer（不发声、不用等实时）
  // ---------------------------------------------------------------------------
  function renderOffline(score, sampleRate, onCtx) {
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error('没有 OfflineAudioContext'));
    const S = normalize(score);
    const sr = sampleRate || 44100;
    const secs = S.total + Math.max(0.3, S.fade ? S.fade[0] : 0);
    const off = new OAC(2, Math.ceil(sr * secs), sr);
    const G = buildScoreGraph(off, off.destination, S, S.master);
    for (const ev of S.events) {
      try { scoreEvent(off, G, S, ev, Math.max(0.005, ev[1])); } catch (e) {}
    }
    if (S.fade) { try { scoreFade(off, G, S, Math.max(0.01, S.total - S.fade[0])); } catch (e) {} }
    if (onCtx) onCtx(off, G);
    return off.startRendering();
  }

  global.BGMEngine = {
    create(audioCtx, opts) { return new Engine(audioCtx, opts); },
    Engine,
    render: renderOffline,
    /** 量一首曲子的时长 / 事件数 / 峰值（离线渲染，Promises<{duration, events, peak, rms}>） */
    measure(score, sampleRate) {
      return renderOffline(score, sampleRate || 44100).then((buf) => {
        let peak = 0, sum = 0, n = 0;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i]; n++; }
        }
        return { duration: +buf.duration.toFixed(2), events: score.events.length, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4) };
      });
    },
    // 需要自己拼播放器时可以直接用这几块
    buildScoreGraph, scoreEvent, scoreFade, normalize, scoreWave, envCurve, lowpass,
  };
})(typeof window !== 'undefined' ? window : globalThis);
