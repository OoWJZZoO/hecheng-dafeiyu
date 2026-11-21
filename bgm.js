/**
 * 《合成大肥鱼》8-bit WebAudio 现场合成 BGM 模块（零外部音频素材、采样级无缝循环）
 *
 * 包含两首无缝循环 3/4 拍圆舞曲：
 *   - normal : 普通模式（原 dream_bgm_8bit，C大调 / F Lydian，96 BPM，32小节 = 60.0s）
 *   - dream  : 美梦模式（新版白日梦变奏，G大调 / C Lydian，138 BPM，48小节 = 62.6s）
 *   两首调性均与 game.js 现有 C 五声音阶音效 (SCALE) 完全和谐。
 *
 * 接入方式（在 index.html 中于 game.js 之前引入 <script src="bgm.js"></script>）：
 *   1. 在 game.js 初始化音频或开始游戏时：
 *        if (audio) BGM.attach(audio);
 *        BGM.setMuted(!soundOn);
 *        BGM.play(M.dream ? 'dream' : 'normal');
 *   2. 在静音按钮 bSound.onclick 中联动：
 *        BGM.setMuted(!soundOn);
 *   3. 在进入/退出美梦模式时无缝切换：
 *        BGM.play(M.dream ? 'dream' : 'normal');
 *   4. 暂停页可选压低音量：
 *        BGM.setDuck(true);  // 恢复时 BGM.setDuck(false);
 */
(function (global) {
  'use strict';

  // ==========================================================================
  // 1. 乐谱数据（MIDI 音高 + 拍位）
  //    chords: normal = [bar, [midi...], bassRoot]
  //            dream  = [bar, [midi...], bassRoot, bassFifth]
  //    melody: [beatPos, durBeats, midi, velocity]
  //    chimes: [bar, [midi...]]
  // ==========================================================================
  const TRACKS = {"normal":{"name":"普通模式 · 夜空鲸梦圆舞曲 (8-bit)","bpm":96,"beatsPerBar":3,"bars":32,"totalBeats":96,"chords":[[0,[53,57,60,64],41],[1,[55,59,62,64],43],[2,[52,55,59,62],40],[3,[57,60,64,67],45],[4,[50,53,57,60,64],38],[5,[55,60,62,65],43],[6,[48,52,55,59],36],[7,[48,55,59,62],36],[8,[53,57,60,64],41],[9,[53,56,60,62],41],[10,[52,55,59,62],40],[11,[57,61,64,67],45],[12,[50,53,57,60,64],38],[13,[55,59,62,65],43],[14,[48,52,55,59],36],[15,[48,52,55,62],36],[16,[57,60,64,71],45],[17,[52,55,59,62],40],[18,[53,57,60,64],41],[19,[48,52,55,59],36],[20,[50,53,57,60],38],[21,[52,55,59,62],40],[22,[53,57,60,64],41],[23,[55,60,62,65],43],[24,[53,57,60,64],41],[25,[55,59,62,64],43],[26,[52,55,59,62],40],[27,[57,60,64,67],45],[28,[50,53,57,60,64],38],[29,[55,59,62,65],43],[30,[48,52,55,59],36],[31,[48,52,55,62],36]],"melody":[[0.0,1.5,76,0.9],[1.5,0.5,79,0.85],[2.0,1.0,81,0.94],[3.0,1.5,83,0.95],[4.5,0.5,81,0.85],[5.0,1.0,79,0.9],[6.0,2.0,76,0.92],[8.0,1.0,74,0.84],[9.0,2.5,72,0.88],[11.5,0.5,74,0.8],[12.0,1.0,76,0.9],[13.0,1.0,77,0.92],[14.0,1.0,81,0.96],[15.0,1.5,79,0.94],[16.5,0.5,77,0.84],[17.0,1.0,74,0.86],[18.0,3.0,76,0.92],[21.0,1.0,79,0.86],[22.0,1.0,83,0.88],[23.0,1.0,79,0.84],[24.0,1.5,81,0.96],[25.5,0.5,79,0.86],[26.0,1.0,76,0.9],[27.0,1.5,80,0.95],[28.5,0.5,79,0.86],[29.0,1.0,77,0.88],[30.0,1.5,79,0.94],[31.5,0.5,81,0.88],[32.0,1.0,83,0.95],[33.0,2.0,81,0.92],[35.0,1.0,79,0.86],[36.0,1.0,77,0.92],[37.0,1.0,76,0.88],[38.0,1.0,72,0.86],[39.0,1.5,74,0.9],[40.5,0.5,76,0.86],[41.0,1.0,79,0.92],[42.0,3.0,72,0.92],[45.0,1.0,76,0.84],[46.0,1.0,79,0.86],[47.0,1.0,83,0.9],[48.0,1.5,84,0.98],[49.5,0.5,83,0.88],[50.0,1.0,81,0.92],[51.0,2.0,83,0.94],[53.0,1.0,79,0.88],[54.0,1.5,81,0.95],[55.5,0.5,79,0.86],[56.0,1.0,76,0.9],[57.0,2.5,79,0.92],[59.5,0.5,76,0.84],[60.0,1.0,77,0.92],[61.0,1.0,81,0.94],[62.0,1.0,84,0.96],[63.0,1.5,83,0.94],[64.5,0.5,81,0.86],[65.0,1.0,79,0.9],[66.0,1.5,81,0.96],[67.5,0.5,84,0.92],[68.0,1.0,88,0.95],[69.0,2.5,86,0.94],[71.5,0.5,83,0.86],[72.0,1.5,84,0.96],[73.5,0.5,81,0.88],[74.0,1.0,79,0.9],[75.0,1.5,83,0.95],[76.5,0.5,81,0.86],[77.0,1.0,79,0.88],[78.0,2.0,76,0.9],[80.0,1.0,79,0.86],[81.0,2.0,81,0.92],[83.0,1.0,76,0.85],[84.0,1.0,77,0.92],[85.0,1.0,79,0.9],[86.0,1.0,81,0.94],[87.0,1.5,79,0.92],[88.5,0.5,77,0.84],[89.0,1.0,74,0.86],[90.0,3.0,76,0.9],[93.0,1.0,74,0.82],[94.0,1.0,72,0.8],[95.0,1.0,74,0.82]],"chimes":[[7,[91,95,100]],[15,[88,91,96]],[23,[86,91,93]],[31,[84,88,91]]]},"dream":{"name":"美梦模式 · 云端白日梦圆舞曲 (8-bit)","bpm":138,"beatsPerBar":3,"bars":48,"totalBeats":144,"chords":[[0,[60,64,67,71],36,43],[1,[62,66,69,71],38,45],[2,[59,62,66,69],47,42],[3,[64,67,71,74],40,47],[4,[57,60,64,67,71],45,40],[5,[62,67,69,72],38,45],[6,[55,59,62,66],43,38],[7,[55,62,66,69],43,50],[8,[60,64,67,71],36,43],[9,[60,63,67,69],36,43],[10,[59,62,66,69],47,42],[11,[64,68,71,74],40,47],[12,[57,60,64,67,71],45,40],[13,[62,66,69,72],38,45],[14,[55,59,62,66],43,38],[15,[55,59,62,65],43,50],[16,[60,64,67,71],36,43],[17,[62,66,69,72],38,45],[18,[59,62,66,69],47,42],[19,[64,67,71,74],40,47],[20,[57,60,64,67],45,40],[21,[59,62,66,69],47,42],[22,[60,64,67,71],36,43],[23,[62,67,69,72],38,45],[24,[64,67,71,74],40,47],[25,[59,62,66,69],47,42],[26,[60,64,67,71],36,43],[27,[55,59,62,66],43,38],[28,[57,60,64,67],45,40],[29,[59,62,66,69],47,42],[30,[60,64,67,71],36,43],[31,[62,66,69,72],38,45],[32,[60,64,67,71],36,43],[33,[62,66,69,71],38,45],[34,[59,62,66,69],47,42],[35,[64,67,71,74],40,47],[36,[57,60,64,67,71],45,40],[37,[62,66,69,72],38,45],[38,[55,59,62,66],43,38],[39,[64,67,71,74],40,47],[40,[60,64,67,71],36,43],[41,[60,63,67,69],36,43],[42,[59,62,66,69],47,42],[43,[64,67,71,74],40,47],[44,[57,60,64,67],45,40],[45,[62,66,69,72],38,45],[46,[55,59,62,66],43,38],[47,[55,59,62,69],43,50]],"melody":[[0.0,1.0,71,0.92],[1.0,0.5,74,0.88],[1.5,0.5,76,0.9],[2.0,1.0,79,0.96],[3.0,1.0,78,0.96],[4.0,0.5,76,0.88],[4.5,0.5,78,0.9],[5.0,1.0,74,0.92],[6.0,1.5,71,0.92],[7.5,0.5,74,0.86],[8.0,1.0,69,0.88],[9.0,1.5,67,0.9],[10.5,0.5,69,0.86],[11.0,0.5,71,0.88],[11.5,0.5,74,0.9],[12.0,1.0,76,0.94],[13.0,0.5,74,0.86],[13.5,0.5,72,0.88],[14.0,1.0,76,0.95],[15.0,1.0,74,0.94],[16.0,0.5,72,0.86],[16.5,0.5,71,0.86],[17.0,1.0,69,0.9],[18.0,2.0,71,0.94],[20.0,1.0,74,0.9],[21.0,0.5,79,0.92],[21.5,0.5,78,0.88],[22.0,0.5,76,0.88],[22.5,0.5,74,0.88],[23.0,0.5,76,0.9],[23.5,0.5,78,0.92],[24.0,1.0,79,0.98],[25.0,0.5,78,0.9],[25.5,0.5,76,0.9],[26.0,1.0,83,1.0],[27.0,1.5,81,0.96],[28.5,0.5,79,0.88],[29.0,1.0,75,0.92],[30.0,1.0,74,0.94],[31.0,0.5,76,0.9],[31.5,0.5,78,0.92],[32.0,1.0,81,0.96],[33.0,1.5,80,0.96],[34.5,0.5,78,0.88],[35.0,1.0,76,0.92],[36.0,0.5,76,0.94],[36.5,0.5,79,0.92],[37.0,1.0,83,0.98],[38.0,1.0,81,0.94],[39.0,1.0,78,0.94],[40.0,0.5,79,0.9],[40.5,0.5,81,0.94],[41.0,1.0,84,0.98],[42.0,2.0,83,0.98],[44.0,1.0,79,0.92],[45.0,1.0,77,0.94],[46.0,0.5,79,0.92],[46.5,0.5,81,0.95],[47.0,1.0,83,0.98],[48.0,1.5,88,1.0],[49.5,0.5,86,0.92],[50.0,1.0,83,0.96],[51.0,1.0,84,0.98],[52.0,0.5,83,0.9],[52.5,0.5,81,0.92],[53.0,1.0,78,0.94],[54.0,1.5,86,1.0],[55.5,0.5,83,0.92],[56.0,1.0,81,0.94],[57.0,1.5,83,0.98],[58.5,0.5,81,0.9],[59.0,1.0,79,0.92],[60.0,0.5,76,0.94],[60.5,0.5,79,0.94],[61.0,1.0,84,0.98],[62.0,1.0,83,0.95],[63.0,0.5,78,0.94],[63.5,0.5,81,0.94],[64.0,1.0,86,1.0],[65.0,1.0,83,0.95],[66.0,1.0,88,1.0],[67.0,0.5,86,0.94],[67.5,0.5,84,0.94],[68.0,1.0,83,0.96],[69.0,2.0,81,0.98],[71.0,0.5,83,0.9],[71.5,0.5,81,0.88],[72.0,0.5,79,0.92],[72.5,0.5,83,0.9],[73.0,0.5,76,0.88],[73.5,0.5,79,0.9],[74.0,0.5,83,0.94],[75.0,0.5,78,0.92],[75.5,0.5,81,0.9],[76.0,0.5,74,0.88],[76.5,0.5,78,0.9],[77.0,0.5,81,0.94],[78.0,0.5,76,0.92],[78.5,0.5,79,0.92],[79.0,0.5,84,0.96],[79.5,0.5,83,0.9],[80.0,1.0,79,0.92],[81.0,0.5,74,0.9],[81.5,0.5,79,0.92],[82.0,1.0,83,0.96],[83.0,1.0,79,0.9],[84.0,0.5,76,0.92],[84.5,0.5,79,0.92],[85.0,0.5,81,0.94],[85.5,0.5,83,0.95],[86.0,1.0,84,0.98],[87.0,0.5,78,0.94],[87.5,0.5,81,0.94],[88.0,0.5,83,0.96],[88.5,0.5,84,0.96],[89.0,1.0,86,1.0],[90.0,1.0,88,1.0],[91.0,0.5,86,0.94],[91.5,0.5,84,0.94],[92.0,1.0,83,0.96],[93.0,1.0,81,0.96],[94.0,0.5,83,0.94],[94.5,0.5,84,0.96],[95.0,1.0,86,1.0],[96.0,1.5,83,1.0],[97.5,0.5,86,0.94],[98.0,1.0,88,1.0],[99.0,1.5,90,1.0],[100.5,0.5,88,0.92],[101.0,1.0,86,0.96],[102.0,1.5,83,0.96],[103.5,0.5,86,0.92],[104.0,1.0,81,0.94],[105.0,1.5,79,0.96],[106.5,0.5,81,0.9],[107.0,1.0,83,0.94],[108.0,1.0,84,0.98],[109.0,0.5,83,0.92],[109.5,0.5,81,0.92],[110.0,1.0,88,1.0],[111.0,1.5,86,0.98],[112.5,0.5,84,0.92],[113.0,1.0,81,0.94],[114.0,2.0,83,0.98],[116.0,1.0,79,0.94],[117.0,1.5,76,0.94],[118.5,0.5,79,0.9],[119.0,1.0,83,0.94],[120.0,1.5,79,0.96],[121.5,0.5,78,0.88],[122.0,1.0,76,0.92],[123.0,1.5,75,0.94],[124.5,0.5,79,0.9],[125.0,1.0,81,0.94],[126.0,1.5,78,0.94],[127.5,0.5,76,0.88],[128.0,1.0,74,0.9],[129.0,1.5,76,0.92],[130.5,0.5,78,0.88],[131.0,1.0,79,0.92],[132.0,1.0,76,0.92],[133.0,1.0,79,0.92],[134.0,1.0,84,0.96],[135.0,1.5,83,0.94],[136.5,0.5,81,0.88],[137.0,1.0,78,0.9],[138.0,2.0,79,0.95],[140.0,1.0,74,0.88],[141.0,0.5,71,0.86],[141.5,0.5,74,0.88],[142.0,0.5,76,0.9],[142.5,0.5,74,0.88],[143.0,1.0,69,0.88]],"chimes":[[15,[91,95,98]],[23,[93,98,102]],[31,[86,90,93,98]],[47,[91,95,98]]]}};

  // ==========================================================================
  // 2. 8-bit WebAudio 合成器核心（PeriodicWave 占空比方波 + 三角波低音 + LFSR 噪点）
  // ==========================================================================
  const m2f = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  let ctx = null;
  let masterGain = null;
  let bgmBus = null;
  let waves = null;
  let noiseBufs = null;

  let currentMode = null;   // 'normal' | 'dream' | null
  let playing = false;
  let muted = false;
  let ducked = false;
  let baseVolume = 0.28;    // 默认背景音量，留出空间给游戏合成音效

  // 切歌（普通 ↔ 美梦）：旧曲子淡出 → 新曲子从头淡入（秒）。淡出期间旧曲子的调度继续跑，听起来是渐渐变小而不是戛然而止。
  // 首次开播 / 静音后重开只做短淡入。
  const SWITCH_FADE_OUT = 1.5;
  const SWITCH_FADE_IN = 1.8;
  const START_FADE_IN = 0.4;
  let pendingMode = null;   // 正在淡出、淡完要切过去的曲目
  let switchTimer = null;

  // Lookahead 精准时钟调度状态
  const STEP_BEATS = 0.5;   // 以八分音符（0.5拍）为最小调度网格，涵盖全部琶音与鼓点
  const LOOKAHEAD_SEC = 0.14;
  const TIMER_MS = 35;

  let timerId = null;
  let nextStepTime = 0;
  let stepIndex = 0;        // 当前半拍序号（0 .. totalBeats*2 - 1）
  let melIndex = new Map(); // trackKey -> Map<stepIdx, Array<note>>
  let chordMap = new Map(); // trackKey -> Map<barIdx, chord>
  let chimeMap = new Map(); // trackKey -> Map<barIdx, midi[]>

  function buildIndexes() {
    for (const key of ['normal', 'dream']) {
      const tr = TRACKS[key];
      const mm = new Map();
      for (const n of tr.melody) {
        const s = Math.round(n[0] / STEP_BEATS);
        if (!mm.has(s)) mm.set(s, []);
        mm.get(s).push(n);
      }
      melIndex.set(key, mm);

      const cm = new Map();
      for (const c of tr.chords) cm.set(c[0], c);
      chordMap.set(key, cm);

      const chm = new Map();
      for (const ch of tr.chimes) chm.set(ch[0], ch[1]);
      chimeMap.set(key, chm);
    }
  }
  buildIndexes();

  function createPulseWave(audioCtx, duty) {
    // 傅里叶级数合成标准 NES / Game Boy 占空比矩形波（12.5% / 25% / 50%）
    const harmonics = 32;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) {
      // 柔和滚降极高频泛音，既清脆又不刺耳
      const rolloff = 1 / (1 + Math.pow(n / 18, 2));
      imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty) * rolloff;
    }
    return audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function createLfsrNoiseBuffer(audioCtx, stepDiv, durSec, seed) {
    const sr = audioCtx.sampleRate;
    const len = Math.max(1, Math.floor(sr * durSec));
    const buf = audioCtx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    // 15-bit NES 风格线性反馈移位寄存器（LFSR）伪随机阶梯噪点
    let lfsr = (seed || 0x4a3b) & 0x7fff;
    let val = 1;
    for (let i = 0; i < len; i++) {
      if (i % stepDiv === 0) {
        const bit = ((lfsr >> 0) ^ (lfsr >> 1)) & 1;
        lfsr = (lfsr >> 1) | (bit << 14);
        val = (lfsr & 1) ? 1 : -1;
      }
      data[i] = val;
    }
    return buf;
  }

  function ensureAudio() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    }
    if (!masterGain) {
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0.0001 : baseVolume * (ducked ? 0.45 : 1);

      // 轻微硬件低通滤波（~8.8kHz），还原老掌机温润质感
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 8800;

      bgmBus = ctx.createGain();
      bgmBus.gain.value = 1.0;

      bgmBus.connect(lp);
      lp.connect(masterGain);
      masterGain.connect(ctx.destination);

      waves = {
        p12: createPulseWave(ctx, 0.125),
        p25: createPulseWave(ctx, 0.25),
        p50: createPulseWave(ctx, 0.50),
      };
      noiseBufs = {
        hat: createLfsrNoiseBuffer(ctx, 5, 0.04, 0x1357),
        snare: createLfsrNoiseBuffer(ctx, 16, 0.09, 0x2468),
        tick: createLfsrNoiseBuffer(ctx, 4, 0.03, 0x3579),
        fill: createLfsrNoiseBuffer(ctx, 13, 0.06, 0x468a),
      };
    }
    if (ctx.state !== 'running') {   // suspended（没点过 / 切后台）或 interrupted（iOS 被电话等打断）
      ctx.resume().catch(() => {});
    }
    return true;
  }

  function connectPan(node, panVal) {
    if (ctx.createStereoPanner && panVal !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, panVal));
      node.connect(p);
      p.connect(bgmBus);
      return p;
    }
    node.connect(bgmBus);
    return null;
  }

  function playPulse(freq, t, dur, opts) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.setPeriodicWave(waves[opts.wave || 'p25']);
    o.frequency.setValueAtTime(freq, t);

    // 长音轻微 8-bit 颤音
    let lfo = null;
    if (opts.vib && dur >= 0.36) {
      lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 5.8;
      lfoG.gain.setValueAtTime(0, t);
      lfoG.gain.setValueAtTime(0, t + 0.14);
      lfoG.gain.linearRampToValueAtTime(freq * 0.006, t + 0.26);
      lfo.connect(lfoG);
      lfoG.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.08);
    }

    const peak = (opts.vol || 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    if (opts.bell) {
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    } else {
      g.gain.exponentialRampToValueAtTime(peak * 0.52, t + Math.min(dur * 0.65, 0.25));
      g.gain.setValueAtTime(peak * 0.48, t + Math.max(0.01, dur - 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    }

    o.connect(g);
    connectPan(g, opts.pan || 0);
    o.start(t);
    o.stop(t + dur + (opts.bell ? 0.14 : 0.06));
  }

  function playTriangleBass(freq, t, dur, vol) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol * 0.92, t + Math.max(0.02, dur - 0.03));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
    o.connect(g);
    g.connect(bgmBus);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function playKick8(t, vol) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.085);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g);
    g.connect(bgmBus);
    o.start(t);
    o.stop(t + 0.12);
  }

  function playNoise8(bufKey, t, dur, vol, pan) {
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = noiseBufs[bufKey];
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(g);
    connectPan(g, pan || 0);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  // ==========================================================================
  // 3. 按半拍调度两首曲目（精确复刻 8-bit 编曲 + 零缝隙无限循环）
  // ==========================================================================
  function scheduleStep(mode, sIdx, t) {
    const tr = TRACKS[mode];
    const spb = 60 / tr.bpm;
    const beat = sIdx * STEP_BEATS;
    const bar = Math.floor(beat / tr.beatsPerBar);
    const stepInBar = sIdx % (tr.beatsPerBar * 2); // 0..5 (3/4拍每小节6个八分音符)

    const chord = chordMap.get(mode).get(bar);
    const notesAtStep = melIndex.get(mode).get(sIdx);
    const chime = chimeMap.get(mode).get(bar);

    if (mode === 'normal') {
      // --- 普通模式：舒缓星夜 8-bit 圆舞曲（96 BPM, 32小节）---
      if (notesAtStep) {
        for (const n of notesAtStep) {
          const [, durB, midi, vel] = n;
          const f = m2f(midi);
          playPulse(f, t, durB * spb * 0.96, {
            wave: 'p50', vol: 0.19 * vel, pan: 0.10, vib: true, bell: true
          });
          // 柔和 8-bit 延迟回声
          playPulse(f, t + 0.5 * spb, durB * spb * 0.85, {
            wave: 'p25', vol: 0.058 * vel, pan: -0.40, vib: false, bell: true
          });
        }
      }
      if (chord) {
        const [, notes, broot] = chord;
        const nt = notes[stepInBar % notes.length];
        const f = m2f(nt) * (stepInBar === 5 ? 2 : 1);
        const v = stepInBar === 0 ? 0.082 : (stepInBar % 2 === 0 ? 0.068 : 0.054);
        playPulse(f, t, 0.48 * spb, {
          wave: 'p12', vol: v, pan: -0.22 + 0.10 * (stepInBar % 3), bell: true
        });
        if (stepInBar === 0) {
          playTriangleBass(m2f(broot) * 2, t, 2.85 * spb, 0.24);
        }
      }
      if (chime && stepInBar === 3) {
        chime.forEach((m, j) => {
          playPulse(m2f(m), t + j * 0.35 * spb, 0.35 * spb, {
            wave: 'p12', vol: 0.045, pan: -0.38 + 0.38 * j, bell: true
          });
        });
      }
    } else {
      // --- 美梦模式：欢快起伏 8-bit 云端白日梦圆舞曲（138 BPM, 48小节）---
      const isClimax = (bar >= 16 && bar < 24) || (bar >= 32 && bar < 40);
      const isBreakdown = (bar >= 24 && bar < 28);

      if (notesAtStep) {
        for (const n of notesAtStep) {
          const [, durB, midi, vel] = n;
          const f = m2f(midi);
          const gate = isBreakdown ? 0.72 : 0.92;
          playPulse(f, t, durB * spb * gate, {
            wave: isBreakdown ? 'p50' : 'p25',
            vol: (isClimax ? 0.21 : 0.185) * vel,
            pan: 0.12,
            vib: !isBreakdown,
            bell: false
          });
          // 经典 8-bit 立体声回声
          playPulse(f, t + 0.5 * spb, durB * spb * 0.78, {
            wave: 'p12', vol: 0.052 * vel, pan: -0.38, vib: false, bell: true
          });
          // 高潮段长音叠低八度方波增加气势
          if (isClimax && durB >= 1.5) {
            playPulse(f * 0.5, t, durB * spb * 0.85, {
              wave: 'p50', vol: 0.068 * vel, pan: -0.18, vib: false, bell: false
            });
          }
        }
      }

      if (chord) {
        const [, notes, broot, b5] = chord;
        // 轻快琶音（breakdown 留白形成俏皮跳音感）
        if (!(isBreakdown && (stepInBar === 1 || stepInBar === 3 || stepInBar === 5))) {
          const nt = notes[stepInBar % notes.length];
          const f = m2f(nt) * (isClimax && stepInBar >= 4 ? 2 : 1);
          playPulse(f, t, 0.42 * spb, {
            wave: 'p12',
            vol: isClimax ? 0.086 : 0.068,
            pan: -0.24 + 0.12 * (stepInBar % 3),
            bell: true
          });
        }
        // 三角波圆舞曲低音（oom-pah-pah）
        if (stepInBar === 0) {
          playTriangleBass(m2f(broot) * 2, t, 1.35 * spb, 0.26);
        } else if (!isBreakdown && stepInBar === 4) {
          playTriangleBass(m2f(b5) * 2, t, 0.80 * spb, 0.21);
        } else if (isBreakdown && stepInBar === 2) {
          playTriangleBass(m2f(b5) * 2, t, 0.40 * spb, 0.20);
        } else if (isBreakdown && stepInBar === 4) {
          playTriangleBass(m2f(broot) * 4, t, 0.40 * spb, 0.18);
        }
      }

      // 8-bit 3/4 拍鼓组（底鼓 + 军鼓/踩镲 + 段落过门）
      if (stepInBar === 0) {
        playKick8(t, isClimax ? 0.26 : 0.20);
      }
      if (!isBreakdown) {
        if (stepInBar === 2) playNoise8('snare', t, 0.075, isClimax ? 0.11 : 0.078, 0.18);
        if (stepInBar === 4) playNoise8('snare', t, 0.060, isClimax ? 0.085 : 0.060, 0.18);
        if (bar >= 8) {
          playNoise8('hat', t, 0.026, stepInBar % 2 === 0 ? 0.052 : 0.032, -0.22);
        }
      } else if (stepInBar === 2 || stepInBar === 4) {
        playNoise8('tick', t, 0.025, 0.058, stepInBar === 2 ? 0.20 : -0.20);
      }

      // 每 8 小节结尾轻快过门加花
      if ((bar === 7 || bar === 15 || bar === 23 || bar === 31 || bar === 39) && stepInBar === 4) {
        for (let fi = 0; fi < 3; fi++) {
          playNoise8('fill', t + fi * 0.33 * spb, 0.05, 0.08 + fi * 0.015, 0);
        }
      }

      // 星光闪耀滑音
      if (chime && stepInBar === 2) {
        chime.forEach((m, j) => {
          playPulse(m2f(m), t + (0.25 + j * 0.35) * spb, 0.30 * spb, {
            wave: 'p12', vol: 0.044, pan: -0.36 + 0.24 * j, bell: true
          });
        });
      }
    }
  }

  function scheduler() {
    if (!playing || !currentMode || !ctx) return;
    const tr = TRACKS[currentMode];
    const totalSteps = tr.totalBeats * 2;
    const stepDur = (60 / tr.bpm) * STEP_BEATS;

    // 切后台回来时钟跳跃保护：避免一口气补播大量旧音符
    if (nextStepTime < ctx.currentTime - 0.5) {
      nextStepTime = ctx.currentTime + 0.04;
    }

    while (nextStepTime < ctx.currentTime + LOOKAHEAD_SEC) {
      scheduleStep(currentMode, stepIndex, nextStepTime);
      nextStepTime += stepDur;
      stepIndex = (stepIndex + 1) % totalSteps; // 精确取模，永不漂移、零缝隙无缝循环！
    }
  }

  function applyGain(rampSec) {
    if (!masterGain || !ctx) return;
    if (pendingMode && !muted) return;   // 正在淡出准备切歌：别把音量拉回去，新曲子起来时会按最新的静音 / 压低状态淡入
    const target = muted ? 0.0001 : Math.max(0.0001, baseVolume * (ducked ? 0.45 : 1));
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
    masterGain.gain.linearRampToValueAtTime(target, now + (rampSec || 0.08));
  }

  // 页面切后台自动暂停时钟，回前台平滑恢复
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!ctx || !playing) return;
      if (document.hidden) {
        if (timerId) { clearInterval(timerId); timerId = null; }
      } else {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        nextStepTime = ctx.currentTime + 0.06;
        if (!timerId) timerId = setInterval(scheduler, TIMER_MS);
      }
    });
  }

  // ==========================================================================
  // 4. 对外 API
  // ==========================================================================
  const BGM = {
    TRACKS,

    /** 绑定已有 AudioContext（例如 game.js 里的 audio），避免多实例冲突 */
    attach(audioCtx) {
      if (audioCtx && audioCtx !== ctx) {
        ctx = audioCtx;
        masterGain = null;
        bgmBus = null;
        waves = null;
        noiseBufs = null;
      }
      return BGM;
    },

    /** 播放或切换到 'normal' | 'dream'（切歌 = 旧的淡出 → 新的淡入，时长见顶部 SWITCH_FADE_*） */
    play(mode = 'normal') {
      if (!TRACKS[mode]) mode = 'normal';
      if (!ensureAudio()) return;   // 同时负责把挂起 / 被打断的 AudioContext 唤醒

      // 已经在播同一首
      if (playing && currentMode === mode) {
        if (pendingMode) {   // 刚才正在淡出准备切走，现在又要回来：取消切换，音量淡回来
          clearTimeout(switchTimer); switchTimer = null; pendingMode = null;
          applyGain(SWITCH_FADE_IN);
        }
        return;
      }
      // 已经在淡出、准备切到这一首
      if (pendingMode === mode) return;

      const switching = playing && !!masterGain;
      const fadeIn = switching ? SWITCH_FADE_IN : START_FADE_IN;

      const switchNow = () => {
        switchTimer = null;
        pendingMode = null;
        currentMode = mode;
        playing = true;
        stepIndex = 0;
        // 新曲子一律从静音开始淡入（淡出期间被别的调用改过音量也不会突然大声）
        if (masterGain) {
          const now = ctx.currentTime;
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(0.0001, now);
        }
        nextStepTime = ctx.currentTime + 0.05;
        if (timerId) { clearInterval(timerId); timerId = null; }
        // 页面在后台就不起时钟，回前台时 visibilitychange 会起
        if (!(typeof document !== 'undefined' && document.hidden)) timerId = setInterval(scheduler, TIMER_MS);
        scheduler();
        applyGain(fadeIn);
      };

      if (switching) {
        // 旧曲子的时钟不停（见顶部说明），音量线性降到 0，淡完再切
        pendingMode = mode;
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
        masterGain.gain.linearRampToValueAtTime(0.0001, now + SWITCH_FADE_OUT);
        clearTimeout(switchTimer);
        switchTimer = setTimeout(switchNow, SWITCH_FADE_OUT * 1000 + 40);
      } else {
        switchNow();
      }
    },

    /** 停止播放（可选淡出时长秒数） */
    stop(fadeSec = 0.15) {
      clearTimeout(switchTimer); switchTimer = null; pendingMode = null;   // 正在淡出切歌的也一并取消
      playing = false;
      currentMode = null;
      if (timerId) { clearInterval(timerId); timerId = null; }
      if (masterGain && ctx) {
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
        masterGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      }
    },

    /** 联动静音按钮（传 true 为静音） */
    setMuted(isMuted) {
      muted = !!isMuted;
      applyGain(0.06);
    },

    /** 暂停页 / 弹窗时柔和压低背景音乐音量 */
    setDuck(isDucked) {
      ducked = !!isDucked;
      applyGain(0.15);
    },

    /** 设置 BGM 基础音量（建议 0.18 ~ 0.35） */
    setVolume(v) {
      baseVolume = Math.max(0, Math.min(1, Number(v) || 0));
      applyGain(0.08);
    },

    get mode() { return currentMode; },
    get isPlaying() { return playing; }
  };

  global.BGM = BGM;
})(typeof window !== 'undefined' ? window : globalThis);