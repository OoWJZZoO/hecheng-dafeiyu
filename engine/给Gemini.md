# 给 Gemini：乐谱渲染器（作曲用）

> 这份文件由 `engine/README.md` + `engine/bgm-engine.js` 拼成，方便整份贴进对话框。
> 如果支持上传文件，直接传 `engine/README.md`、`engine/bgm-engine.js`、`engine/demo.html` 三个更好。

---

# 乐谱渲染器 · 使用说明（给作曲 / 模型看）

这是游戏《合成大肥鱼》背景音乐的**渲染核心**，从工程里抽出、**不含任何曲目数据**。
拿到它就能作曲：写一份 JSON 乐谱（事件表），丢进渲染器就能听到成品、能离线渲染、能量响度。

- `bgm-engine.js` —— 渲染器本体（无依赖，600 行左右）
- `demo.html` —— 试着放 / 离线渲染 / 看时长峰值的小页面（用静态服务器打开）

> 目标：用这套渲染器**重写开始页循环曲、普通局的间歇乐章**，质量要比现在好，但必须在这个引擎的能力范围内。

---

## 1. 一分钟上手

```html
<script src="bgm-engine.js"></script>
<script>
  const score = { total: 8, echo: [0.45, 0.2, 0.9, 0.08], lpf: 9600, fade: [2.5, 1.5], master: 1.0,
    events: [
      // 铺底：C 大三和弦，4 秒
      ['d', 0.0, 4.0, [130.81, 164.81, 196.0, 261.63], 0.5, 0.12, 1850, 0.24, 0.18, 0.8, 0.38, 0.15, 0.71, 0.71, 0],
      // 旋律：E5，1.5 秒，带颤音
      ['p', 0.0, 1.5, 659.26, 0.5, 0.22, 5400, 0.01, 0.15, 0.5, 0.08, 0.95, 5.5, 18, 0.25, 0.71, 0.71, 1],
      // 铃音
      ['c', 2.0, 1.2, 1046.5, 0.14, 4200, 0.005, 0.04, 0.95, 0.08, 0, 0.71, 0.71, 0]
    ] };
  const eng = BGMEngine.create();       // 需要用户先点过页面才能出声
  eng.play(score, { loop: true });
  // 或者离线烘一遍：
  BGMEngine.measure(score).then((m) => console.log(m));   // { duration, events, peak, rms }
</script>
```

`BGMEngine.render(score, 44100)` 返回 `Promise<AudioBuffer>`（不发声，可以导出 WAV、量响度、做 A/B）。

---

## 2. 乐谱对象

```js
{
  total: 120,                       // 总长（秒）。循环曲 = 一轮的长度
  echo: [0.45, 0.20, 0.90, 0.08],   // [延迟1(秒), 增益1, 延迟2(秒), 增益2]：交叉回声 + 同侧二次回声
  lpf: 9600,                        // 母带低通（两级串联，同频）。8000 更闷、12000 更亮
  fade: [2.5, 1.5],                 // [淡出时长(秒), 指数]；循环曲给 null 或不给
  master: 1.0,                      // 整首增益（峰值归一化系数）
  chime: [0.45, 0.55, 3.0],         // 铃音的音色：[方波比例, 三角比例, 额外衰减(1/秒)]
  events: [ /* 按 t 升序 */ ]
}
```

`events` 里每条都是一个音，四类：

### 2.1 脉冲波 `'p'`（旋律、琶音、和弦点缀的主力）

```
['p', t, dur, freq, duty, amp, cutoff, a, d, s, r, e, vibHz, vibCents, vibDelay, gL, gR, lead]
```

| 字段 | 含义 | 单位 / 范围 |
|---|---|---|
| `t` | 起始时间 | 秒（相对这首开头） |
| `dur` | 时长 | 秒 |
| `freq` | 基频 | Hz（或负的 MIDI 编号不支持，直接写 Hz） |
| `duty` | 占空比 | 0.1–0.5。0.5 最厚（方波）、0.25 更亮、0.125 最细最「红白机」 |
| `amp` | 峰值电平 | 0–0.35。旋律 0.18–0.24，琶音 0.05–0.09，回声层 0.04–0.06 |
| `cutoff` | 逐音低通 | Hz。低音 800–2500，旋律 4000–7000，加亮 8000–12000 |
| `a` | 起音 | 秒。0.004–0.01 干脆，0.05–0.15 柔和 |
| `d` | 衰减 | 秒。0.05–0.3 |
| `s` | 延音电平 | 0–1，相对 `amp`。0 是拨弦感，0.6–0.8 是持续音 |
| `r` | 释音 | 秒。0.05–0.3 |
| `e` | 指数衰减速率 | 1/秒。0 = 不额外衰减；2–6 是「叮」一下就没 |
| `vibHz` | 颤音频率 | Hz，4–6.5 |
| `vibCents` | 颤音深度 | 音分，10–25 很轻、40 明显；0 = 不要颤音 |
| `vibDelay` | 颤音延迟 | 秒，0.1–0.3 |
| `gL` `gR` | 左右声像增益 | 0–1，等功率建议 `0.707/0.707` 居中、`0.95/0.3` 偏左 |
| `lead` | 走 lead 总线 | 1 = 有交叉回声（长音、点缀），0 = 干声（和弦、琶音） |

### 2.2 三角波 `'t'`（低音）

```
['t', t, dur, freq, amp, a, d, s, r, e, gL, gR, lead]
```

和 `'p'` 同名字段含义一致，没有 duty / cutoff / 颤音。低音建议 `freq` 65–160 Hz、`amp` 0.18–0.3、`a` 0.006、`s` 0.9、`gL/gR 0.707`。

### 2.3 铃音 `'c'`（高音点缀、八音盒感）

```
['c', t, dur, freq, amp, cutoff, a, d, s, r, e, gL, gR, lead]
```

`freq` 600–2000 Hz，`amp` 0.10–0.18，`cutoff` 3500–5000，`e` 给 0（铃音自带 `chime[2]` 的衰减）。适合句尾一两个音，别连成旋律。

### 2.4 铺底和弦 `'d'`

```
['d', t, dur, [freq, freq, ...], duty, amp, cutoff, a, d, s, r, e, gL, gR, lead]
```

一个事件 = 一整个和弦（3–5 个音，内部会轻微失谐）。`freq` 用低八度（65–330 Hz）会更暖；`dur` 一小节起，`a` 0.2–0.5（慢慢涨起来）、`s` 0.8、`cutoff` 1500–2500。**这是「和声底」，铺满整首但别太响**（`amp` 0.09–0.14）。

---

## 3. 渲染器内部做了什么（写曲子时要知道的）

每个音：振荡器（波表，`p` 带逐音低通）→ 包络（1ms 精度曲线）→ 左右两个声像增益 → 总线。
整首：`L/R` 两条单声道总线 + `lead` 两条（交叉回声）→ 合成立体声 → 母带两级低通 → 淡出 → 音量。

- **没有鼓、没有噪声源**：只有上面四种音色。想要节奏感，用短 `dur` + 短 `a` + 低 `s` 的 `'p'` 当打击，或者低音 `'t'` 的正拍。
- **高音会自动压一点**（`p` 在 900 Hz 以上按 `pow(900/f, 0.45)` 衰减），所以高音写太密会「不响」。
- **同时发声数量**：峰值 60 个振荡器以内很安全（一首 3 分钟、正常密度大约 40–60）。铺底和弦一个事件算 4–5 个。
- **响度**：拿 `BGMEngine.measure(score)` 看 `peak`，目标 **≤ 0.85**（超出会削顶，把 `master` 往下调），`rms` 0.02–0.05 之间比较像现在的 BGM。
- **回声**：`lead: 1` 的音才有交叉回声；回声湿了会糊，`echo[1]`、`echo[3]` 别超过 0.25。

---

## 4. 这次要写什么

### 4.1 开始页循环曲（替换现在那首 60 秒圆舞曲）

- **60–120 秒，能无缝循环**。最后一个音可以拖过循环点——播放器会把下一轮叠上来，不会断。
- 气质：安静、耐听，玩家会听很多遍。别写太满、别写太快的旋律，留白多一点。
- 建议 3/4 或 4/4，90–110 BPM。

### 4.2 普通局的间歇乐章（2 首）

- **每首 2–2.5 分钟**，不循环；放完静 40–70 秒再放另一首，所以开头和结尾都要**渐起渐弱**，不要突然结束。
- 局内背景：比开始页更「不起眼」，旋律稀疏，织体薄一点，不要抢音效。
- 两首要有区别（一首偏安静、一首偏流动），但同调同音色。

### 4.3 调性

游戏音效全是 **C 大调五声音阶**（C D E G A）。配乐建议 **C 大调**（或 A 自然小调），转调的话别离开太远；这样合成音效落进来不会打架。

### 4.4 交回来

一份 JSON（就是上面那个 `score` 对象），外加：哪首是开始页循环、每首的 `total`。
事件按 `t` 升序排好、时间用秒。渲染器会自己处理淡出/循环，不用你在事件里做总音量包络。

---

## 5. 自检清单

1. `BGMEngine.measure()` 的 `peak` ≤ 0.85；
2. 60 秒内没有一次「所有声部同时停」；
3. 同一时刻的振荡器数不超过 60（铺底和弦按 4–5 个算）；
4. 开始页那首把 60–120 秒整段循环放两遍，接缝处不突兀；
5. 普通局那两首的头 5 秒和最后 5 秒都是渐起渐弱；
6. 用耳机和手机外放各听一遍（手机外放听不到 200 Hz 以下，低音要写高八度一点才听得见）。


---

## 附：`bgm-engine.js` 全文（无曲目数据，可直接运行）

```js
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
```
