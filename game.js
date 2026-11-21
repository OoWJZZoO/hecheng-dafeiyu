// 合成大肥鱼 —— 掉落合成玩法，美术来自《按下发送之后》像素素材
(() => {
'use strict';
const { Engine, Bodies, Body, Composite, Events, Vertices } = Matter;

// ---------------------------------------------------------------- 物理提速：分离轴检测（2026-11-14）
// Matter 的 Collision._overlapAxes 对每条轴都把两个多边形的全部顶点投影一遍（20 边形 × 20 条轴 × 40 个点），
// 美梦堆满时占物理耗时的三分之一。这里换成结果相同的快算法：
//   · 自己的轴投自己的顶点：哪个顶点最大 / 最小是固定的（刚体怎么转怎么挪都不变），每条轴记一次，以后只算这 2 个点；
//   · 对方的顶点：凸多边形在一个方向上的投影沿着边界是单峰的，从上一条轴的极值点出发往大的一边爬，平均只看两三个点。
// 求出来的重叠量和轴跟原版一样（只可能差在浮点末位上），碰撞、合成、手感都不变；原函数留在 _overlapAxesRef 上（?nosat 用回原版，对照测试用）。
// 前提：碰撞箱是凸多边形、顶点按顺序排（精灵凸包、墙、木盖都是）。
(() => {
  const C = Matter.Collision;
  if (!C || typeof C._overlapAxes !== 'function') return;
  C._overlapAxesRef = C._overlapAxes;
  if (/[?&]nosat\b/.test(location.search)) return;
  const ownExtremes = (V, axes) => {
    const n = V.length, m = axes.length, hi = new Int32Array(m), lo = new Int32Array(m);
    for (let i = 0; i < m; i++) {
      const ax = axes[i].x, ay = axes[i].y;
      let mx = -Infinity, mn = Infinity;
      for (let j = 0; j < n; j++) { const d = V[j].x * ax + V[j].y * ay; if (d > mx) { mx = d; hi[i] = j; } if (d < mn) { mn = d; lo[i] = j; } }
    }
    return { n, hi, lo };
  };
  C._overlapAxes = function (result, VA, VB, axes) {
    const nB = VB.length, nAx = axes.length, lastB = nB - 1;
    let ext = axes._ext;
    if (ext === undefined || ext.n !== VA.length) ext = axes._ext = ownExtremes(VA, axes);
    const hi = ext.hi, lo = ext.lo;
    let overlapMin = Number.MAX_VALUE, best = 0, iMax = 0, iMin = 0;
    for (let i = 0; i < nAx; i++) {
      const axis = axes[i], ax = axis.x, ay = axis.y;
      let v = VA[hi[i]];
      const maxA = v.x * ax + v.y * ay;
      v = VA[lo[i]];
      const minA = v.x * ax + v.y * ay;
      // 对方的最大值：从上一条轴的最大点出发，往投影变大的那一边爬到头
      let j = iMax; v = VB[j];
      let maxB = v.x * ax + v.y * ay;
      let k = j === lastB ? 0 : j + 1; v = VB[k];
      let d = v.x * ax + v.y * ay;
      if (d > maxB) {
        do { maxB = d; j = k; k = k === lastB ? 0 : k + 1; v = VB[k]; d = v.x * ax + v.y * ay; } while (d > maxB);
      } else {
        k = j === 0 ? lastB : j - 1; v = VB[k]; d = v.x * ax + v.y * ay;
        while (d > maxB) { maxB = d; j = k; k = k === 0 ? lastB : k - 1; v = VB[k]; d = v.x * ax + v.y * ay; }
      }
      iMax = j;
      // 对方的最小值：同理往小的一边爬
      j = iMin; v = VB[j];
      let minB = v.x * ax + v.y * ay;
      k = j === lastB ? 0 : j + 1; v = VB[k];
      d = v.x * ax + v.y * ay;
      if (d < minB) {
        do { minB = d; j = k; k = k === lastB ? 0 : k + 1; v = VB[k]; d = v.x * ax + v.y * ay; } while (d < minB);
      } else {
        k = j === 0 ? lastB : j - 1; v = VB[k]; d = v.x * ax + v.y * ay;
        while (d < minB) { minB = d; j = k; k = k === 0 ? lastB : k - 1; v = VB[k]; d = v.x * ax + v.y * ay; }
      }
      iMin = j;
      const oAB = maxA - minB, oBA = maxB - minA, o = oAB < oBA ? oAB : oBA;
      if (o < overlapMin) { overlapMin = o; best = i; if (o <= 0) break; }
    }
    result.axis = axes[best];
    result.overlap = overlapMin;
  };
})();

// ---------------------------------------------------------------- 文案
// 除按钮、署名页外的文案都在 text.json，构建（tools/build.py）后生成 text.js，这里读 window.TEXT
const TX = window.TEXT;
const fmt = (str, vars = {}) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k]);   // 把 {n} {a} {b} {date} 换成数字/日期
document.title = TX.标题.游戏名;

// ---------------------------------------------------------------- 配置
// 2026-11-13 屏幕适配（和微信版 wxgame 分支同步；README「屏幕适配」）：容器加高、普通模式系数 0.8 → 0.85。
// 构图从 360×640 加高到 360×704：顶栏、红线、出生点都不动，容器底和底部的东西整体下移 64。
// 容器在屏幕上高 556（原 492），世界面积不变（556/0.85² ≈ 492/0.8²），难度和原来一样；
// 构图外面露出来的地方用高背景 bg_tall.png 补齐（#backdrop），不给玩法。
const W = 360, H = 704;              // 逻辑分辨率（竖屏）
const WALL_L = 14, WALL_R = W - 14;  // 容器内壁
const FLOOR = 676;                   // 容器底（原 612）
const NEXT_X = W - 36, NEXT_Y = 84;   // 「下一个」预告的位置（右侧、顶栏图标键下面）
const DROP_Y = 118;                  // 待放下的位置
const DANGER_Y = 150;                // 红线
const DANGER_RISK = 1000;            // 好险！：红线上方连续撑这么久、之后解除（没失败）才算（ms）
const TEX = 2;                       // 精灵 1 个像素 = 2 个逻辑像素

// ---------------------------------------------------------------- 模式（普通 / 美梦）
// 美梦模式：物理世界里容器边长 ×2（面积 ×4），精灵的物理大小一点不变（手感、碰撞箱、合成逻辑都和普通模式一样）；
// 画面上再整体 ×0.5（摄像机缩放），所以屏幕上容器还是那么大、精灵缩到 1/4 面积，红线按比例上移，离得很远。
// 为了缩小后精灵像素仍然方正（不重新像素化、不丢像素），美梦模式把画布内部网格加密一倍（见 GRID）：
// 精灵 1 像素 = 2 世界像素 = 1 逻辑像素 = 3 个 1080×1920 画布格，整数。
// 普通模式（2026-11-10 起）也用同一套摄像机：容器边长 ×1.25（用户嫌原来太难合出大肥鱼），画面 ×0.8；画布网格同样加密一倍。
// 0.8 倍下精灵 1 像素 = 1.6 逻辑像素 = 4.8 个画布格，不是整数（美梦是正好 3 格），像素会有一点点忽粗忽细，用户接受了 1.25 这个数。
// 2026-11-13 容器加高后系数改 0.85（容器边长 ×1/0.85，世界面积和原来相同）：精灵 1 像素 = 1.7 逻辑像素。美梦不变（×2）。
// 2026-11-14 普通模式加了「灌水」、金豆好拿了，作为补偿系数 0.85 → 0.92（用户定）：世界容器小一圈（面积约 -15%），精灵 1 像素 = 1.84 逻辑像素。
// 展示模式（?showcase）要看精灵实际大小，仍用 1 倍。
const DREAM_K = 2;                                      // 容器边长倍数（美梦，相对原来的屏幕容器，没跟着普通模式变）
const NORMAL_K = /[?&]showcase\b/.test(location.search) ? 1 : 1 / 0.92;
const worldY = (v, k = DREAM_K) => FLOOR - (FLOOR - v) * k;   // 把「屏幕上离地面多远」换成放大后世界里的高度
const NORMAL = { dream: false, cam: 1 / NORMAL_K, k: NORMAL_K, wl: WALL_L, wr: WALL_L + (WALL_R - WALL_L) * NORMAL_K, floor: FLOOR,
  top: worldY(DANGER_Y - 30, NORMAL_K), danger: worldY(DANGER_Y, NORMAL_K), dropY: worldY(DROP_Y, NORMAL_K), cd: 450, vy: 2 };
const DREAM = { dream: true, cam: 1 / DREAM_K, k: DREAM_K, wl: WALL_L, wr: WALL_L + (WALL_R - WALL_L) * DREAM_K, floor: FLOOR,
  top: worldY(DANGER_Y - 30), danger: worldY(DANGER_Y), dropY: worldY(DROP_Y),
  cd: 90,            // 丢球最短间隔（毫秒）；另外还要等上一个球离开出生点，见 cdReady
  vy: 7 };          // 出手初速：快点离开出生点，连丢的间隔就能再短（画面缩半后看起来只有原来一半快，不突兀）
let M = NORMAL;                                         // 当前模式
// 世界坐标 ↔ 屏幕逻辑坐标（普通模式两者相同）
// 美梦里摇一摇时容器整体有个偏移 box（世界单位，见 stepShake），画面、特效都跟着它走
const toScrX = (x) => M.k !== 1 ? WALL_L + (x - WALL_L + box.x) * M.cam : x;
const toScrY = (y) => M.k !== 1 ? FLOOR + (y - FLOOR + box.y) * M.cam : y;
const fromScrX = (x) => M.k !== 1 ? WALL_L + (x - WALL_L) * M.k - box.x : x;
const FPS_ON = /[?&]fps\b/.test(location.search);       // 帧率小窗（见 fpsFrame）
const DREAM_TEST = /[?&]dream\b/.test(location.search);   // 测试：美梦入口一直开着（每次刷新后第一次结束页按「刚解锁」放一遍出场动画）
const THAW_MS = 900;                                    // 进美梦时旧局的堆先悬在半空这么久再解冻

const TIERS = [
  { r: 14,  color: '#f3e6cf' },
  { r: 19,  color: '#e7efe2' },
  { r: 25,  color: '#f2c58a' },
  { r: 31,  color: '#dfe9f5' },
  { r: 38,  color: '#f4dcb4' },
  { r: 46,  color: '#f6d2c4' },
  { r: 55,  color: '#cfe0f5' },
  { r: 64,  color: '#fbe0bf' },
  { r: 74,  color: '#f7d9d2' },
  { r: 85,  color: '#d8e6fa' },
  { r: 98,  color: '#b9d4f4' },
];
TIERS.forEach((t, k) => { t.name = TX.物品[k].全名; });   // 全名在 text.json 的「物品」里
const DROPPABLE = 5;
// 镀金：只有包子会生成时就镀金；合成时任一方镀金，结果就镀金（一路传到镀金大肥鱼）
// 测试开关：网址带 ?gold 时每个包子都镀金
const GOLD_TEST = /[?&]gold\b/.test(location.search);
// 镀金小笼包的保底（参考二游卡池）：只数小笼包。基础 2%；连续 20 个没出镀金后，
// 从第 21 个起每个再 +5%；第 32 个必出，出了清零。综合约 5.0%（每轮平均 19.9 个）；一半的轮次 23 个小笼包内出，
// 九成 28 个内、九成半 29 个内（纯 2% 要 114 个才九成）；吃满保底（第 32 个才出）约 0.70%。
// 2026-11-10 用户定的：基础 2%、综合 5% 左右、吃满保底在 0.5%–1% 之间。算分布：.scratch/gold_params.py（不进 git）
const GOLD_BASE = 0.02, GOLD_SOFT = 20, GOLD_STEP = 0.05, GOLD_HARD = 32;
const GOLD_UNLUCKY = 29;   // 非酋成就：连续 29 个小笼包没镀金（等价于「第 30 个及以后才出」，约 3.4% 的轮次；用户要的 3%–5%）
// 镀金限时（2026-11-10 用户定的「护送镀金」）：前 6 级（小笼包～小螃蟹）的镀金「没干透」，有倒计时，
// 合成一次就按新的那级重新计时，到点没合掉就褪回普通；合出第一个人物（第 7 级惊喜小鲸）那一下「镀牢」，之后永久镀金、一路传到大肥鱼。
// 平滑：小笼包褪得最快，越往上越慢（泡面丢到的机会少；小螃蟹丢不了，要再合一只出来，给得最长）。倒计时只在物理在走的时候走（暂停、大肥鱼时停、解冻悬空都不走）。
// 原因：以前「任一方镀金结果就镀金」且金子不会丢，一条大肥鱼平均要吃进 60 多个小笼包（约 3 个镀金的），机器人实测 98% 大肥鱼都镀金。
const GOLD_LIFE = [0, 1, 2, 3, 4, 5].map(k => Math.round(6000 * 1.25 ** k));   // 毫秒，按级：小笼包 6 秒，每升一级 ×1.25（6 / 7.5 / 9.4 / 11.7 / 14.6 / 18.3 秒，5 = 小螃蟹）
const GOLD_LOCK = GOLD_LIFE.length;                         // 合出这一级（6 = 惊喜小鲸，第一个人物）就镀牢
const GOLD_BLINK = 1500;                             // 最后这么久开始闪
let goldPity = 0;   // 上次镀金之后已经摇出了几个普通小笼包（摇的时候数，决定概率）
// 成就用。镀金类成就（g1/g7/g8/g9）按「丢下」的时候数，不按摇出来的时候数：
// dropStreak 连续丢下几个镀金小笼包，plainRun 上次镀金丢下后又丢了几个普通小笼包，runFish 本局大肥鱼数
// （2026-11-14 删掉 g6「一蒸笼金包子」——单局丢 8 个镀金小笼包纯靠熬，位置让给灌水的 w1「水漫金山」）
let dropStreak = 0, plainRun = 0, runFish = 0, chain = 0, dropId = 0;
let curElig = false, nextElig = false, rollElig = false;   // 这个小笼包是不是参与过保底摇号的（开局前几个不参与，不数进 plainRun）
const FISH_PTS = [200, 648, 1588];   // 大肥鱼相消：普通+普通 / 镀金+普通 / 镀金+镀金

// 碰撞箱：有精灵凸包（sprites/shapes.js）就按物件形状，没有就先用圆占位
const SHAPES = window.SHAPES || {};
TIERS.forEach((t, k) => {
  const sh = SHAPES[k];
  if (!sh) { t.half = t.r; t.top = t.r; return; }
  const v = sh.hull.map(([x, y]) => ({ x: x * TEX, y: y * TEX }));
  const c = Vertices.centre(v);
  t.verts = v.map(p => ({ x: p.x - c.x, y: p.y - c.y }));   // 相对质心
  t.ox = -c.x; t.oy = -c.y;                                  // 精灵左上角相对质心
  t.w = sh.w * TEX; t.h = sh.h * TEX;
  t.half = Math.max(...t.verts.map(p => Math.abs(p.x)));     // 放下时离墙的距离
  t.top = Math.max(...t.verts.map(p => -p.y));
});                 // 随机掉落的只有前 5 级

// ---------------------------------------------------------------- 画布
const cv = document.getElementById('cv');
const vctx = cv.getContext('2d');
// 画面本体画在哪（2026-11-14 改）：画布一格不到 2 个物理像素（kc = 1，手机上几乎都是）时直接画在 cv 上；
// kc > 1（很大的屏）才先画在 scr 上、再最近邻放大 kc 倍贴到 cv。原来一律先画 scr 再整幅拷到 cv，
// 手机上是 1080×2112 一比一的拷贝，每帧白拷 228 万像素。
const scr = document.createElement('canvas'), sctx = scr.getContext('2d');
let ctx = vctx;       // 当前往哪画：大肥鱼时停、顶层特效时会临时换成别的图层
let direct = true;    // true = 直接画 cv
let cvRect = null;   // 画布在窗口里的位置（见 cvBox；窗口变了就作废）
const wrap = document.getElementById('wrap');
// 顶层画布：盖在顶栏（#hud）上面，只画要「飞到顶栏键上」的东西（攒能量豆的金豆），不挡点击
const fxTop = document.createElement('canvas');
fxTop.id = 'fxTop'; fxTop.style.cssText = 'position:absolute;left:0;top:0;width:360px;height:' + H + 'px;pointer-events:none;visibility:hidden';
document.getElementById('ui').appendChild(fxTop);
const fxCtx = fxTop.getContext('2d');
// fxShown：这层平时是空的，空着就藏起来（visibility）——它和游戏画布一样大，一直摆着的话浏览器每帧都要多合成一整屏的透明图层
let fxDirty = false, fxShown = false;
// 「copy」合成能不能用（画一个图形的同时把画布其余地方清成透明）：能用的话，每帧「清空画布 + 铺容器的半透明底」并成一步
// （见 render）。开机在一张小画布上实测一下，不对就走老路
const COPY_OK = (() => {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 4;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#f00'; g.fillRect(0, 0, 4, 4);
    g.globalCompositeOperation = 'copy'; g.fillStyle = 'rgba(0,255,0,.5)'; g.fillRect(2, 2, 2, 2);
    const d = g.getImageData(0, 0, 4, 4).data, i = 15 * 4;
    return d[3] === 0 && d[i] === 0 && d[i + 1] > 200 && d[i + 3] > 120 && d[i + 3] < 136;
  } catch (e) { return false; }
})();
// 画面固定画在 W×H 的 FINE 倍（540×1056）上，再整体放大到屏幕：所有设备看到的是同一张图。
// 放大倍数一般不是整数（2026-11-13 起画面按受限边撑满，不再吸附整数倍）：先最近邻放大到不超过实际倍数的整数 k 倍，
// 剩下不到 2 倍的那一点交给浏览器最近邻（image-rendering: pixelated）——边缘锐利，个别行/列多一个物理像素。
// 只有实际倍数不到 1（窗口太小，只能缩小）时才让浏览器平滑缩小（html.smooth），否则最近邻缩小会整行丢像素。
// 2026-11-14 修：原来 k 向上取整再平滑缩小，倍数刚过整数时（比如每格 1.1 个物理像素）等于放大 2 倍再缩回一半，
// 相邻像素混在一起，界面小字和画面都糊（用户在网页端发现的）。
const FINE = 1.5;
// 画布内部的网格密度（每逻辑像素几格）。普通模式 = FINE；美梦模式 = FINE×2（1080×1920）。
// 界面上的字、图标的放大倍数、屏幕缩放仍然按 FINE 算（所以界面不受影响），只有画布本体的分辨率换了；
// 画布上的字/标题/成就条都是按 1/FINE 逻辑像素一格画的，换成 2 倍密度后正好每格对应 2 格，样子不变。
let GRID = FINE;
let scale = 1;
// 手机上点开意见便签的输入框会弹键盘：有的浏览器把窗口高度缩掉一半，游戏跟着整体缩小，输入框缩成一点点。
// 所以输入框有焦点、而且只有高度变了时不重排（skipResize 也给后面重贴像素字的 resize 监听看），失焦后补一次。
let lastIW = innerWidth, skipResize = false, resizeOwed = false;   // resizeOwed：打字时真的跳过过一次重排，失焦后才要补
function resize() {
  skipResize = document.activeElement?.id === 'noteText' && innerWidth === lastIW;
  if (skipResize) { resizeOwed = true; return; }
  resizeOwed = false;
  lastIW = innerWidth;
  const dpr = devicePixelRatio || 1;
  const r = Math.min(innerWidth / W, innerHeight / H) * dpr / FINE;   // 一个画面像素最多占几个物理像素
  // 2026-11-13 起不再吸附整数倍：游戏画面按先顶到的那一边精确撑满（竖屏手机撑满宽、桌面宽屏上下顶到浏览器边），
  // 用户宁可要撑满也不要为了整数倍被背景挤在中间。非整数倍：先最近邻放大到 k = floor(n) 倍，余下的交给浏览器最近邻。
  const n = r;
  const k = Math.max(1, Math.floor(n + 1e-6));
  scale = n * FINE / dpr;
  document.documentElement.classList.toggle('smooth', n < 1 - 1e-6);
  window.PixUI.zoom = k;
  window.PixUI.dev = scale * dpr;   // 一个逻辑像素占几个物理像素
  const p = n * FINE / GRID, kc = Math.max(1, Math.floor(p + 1e-6));   // 画布一格占几个物理像素 / 取整放大倍数（不超过 p）
  direct = kc === 1;
  // 画布尺寸没变就不重设（重设 = 重新分配 + 清空）：手机浏览器收放地址栏 / 工具栏时会连着来一串 resize，
  // 大多数时候画布格数根本没变，原来每来一次就把三张 1080×2112 的画布重新分配一遍
  const gw = W * GRID, gh = H * GRID;
  if (direct) { if (scr.width !== 1) scr.width = scr.height = 1; }   // 用不着的中间画面缩成 1×1，不占内存
  else if (scr.width !== gw || scr.height !== gh) { scr.width = gw; scr.height = gh; }
  if (cv.width !== gw * kc || cv.height !== gh * kc) { cv.width = gw * kc; cv.height = gh * kc; }
  ctx = direct ? vctx : sctx;
  cv.style.imageRendering = p < 1 - 1e-6 ? 'auto' : 'pixelated';   // 美梦模式画布密度翻倍，屏幕不够细时 p < 1，只能平滑缩小
  vctx.setTransform(1, 0, 0, 1, 0, 0); vctx.globalAlpha = 1;   // 画布没重设尺寸时上下文状态还留着上一种模式的，这里摆正
  vctx.imageSmoothingEnabled = false;
  vctx.globalCompositeOperation = direct ? 'source-over' : 'copy';   // 画面是透明底（背景在 #backdrop 上），整幅贴过去时要连透明一起盖
  cv.style.width = W * scale + 'px'; cv.style.height = H * scale + 'px';
  if (fxTop.width !== cv.width || fxTop.height !== cv.height) { fxTop.width = cv.width; fxTop.height = cv.height; }
  fxTop.style.imageRendering = cv.style.imageRendering || 'pixelated';
  fxCtx.setTransform(GRID * kc, 0, 0, GRID * kc, 0, 0); fxCtx.imageSmoothingEnabled = false; fxDirty = true;
  wrap.style.width = W * scale + 'px'; wrap.style.height = H * scale + 'px';
  ctx.setTransform(GRID, 0, 0, GRID, 0, 0);
  ctx.imageSmoothingEnabled = false;
  document.getElementById('ui').style.transform = `scale(${scale})`;
  bdW = -1; cvRect = null;
}
// 构图外面（上下、两侧）：全屏的 #backdrop 画布按构图同样的对齐和倍数画高背景（最近邻），超出高背景的上下按最边上一行延伸、
// 左右超出（桌面宽屏）留原版深棕底色。只在尺寸变了时重画。遮罩不在这里压暗：.ov 的底色（::before）和教程幕布
// 本身就铺满整个窗口，只有一层，构图边缘不会出现两层压暗相接的细线（2026-11-13 用户发现的幕布接缝）。
// 2026-11-14 起游戏画布里不再画背景（透明底）：构图里面的背景也是这张 #backdrop，游戏画布叠在上面，
// 每帧省一次整幅背景贴图；同一张图，对齐方式和原来画在画布里的一样。
const backdrop = document.getElementById('backdrop'), bdCtx = backdrop.getContext('2d');
let bdW = -1, bdH = 0, bdDpr = 0, bdScale = 0, bdReady = false;
function syncBackdrop() {
  const dpr = devicePixelRatio || 1, ready = ok(bg);
  if (innerWidth === bdW && innerHeight === bdH && dpr === bdDpr && scale === bdScale && ready === bdReady) return;   // 每帧都会来问一次，数字直接比
  bdW = innerWidth; bdH = innerHeight; bdDpr = dpr; bdScale = scale; bdReady = ready;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (backdrop.width !== w || backdrop.height !== h) { backdrop.width = w; backdrop.height = h; }
  const g = bdCtx; g.imageSmoothingEnabled = false;
  g.fillStyle = '#2b1d16'; g.fillRect(0, 0, w, h);
  if (ready) {
    const r = wrap.getBoundingClientRect(), G = 2 * scale * dpr;   // 一个背景格占几个物理像素
    const ox = Math.round(r.left * dpr) - BG_X0 * G, oy = Math.round(r.top * dpr) - BG_Y0 * G;
    const iw = bg.naturalWidth, ih = bg.naturalHeight, IW = iw * G, IH = ih * G;
    g.drawImage(bg, ox, oy, IW, IH);
    if (oy > 0) g.drawImage(bg, 0, 0, iw, 1, ox, 0, IW, Math.ceil(oy));                       // 顶上：天空最上一行（平涂）
    if (oy + IH < h) g.drawImage(bg, 0, ih - 1, iw, 1, ox, Math.floor(oy + IH), IW, h - Math.floor(oy + IH));   // 底下：最下一行海面
  }
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- 素材
const SPRITE_V = 14;   // 改了 sprites/ 里的图就加一，不然浏览器读缓存（14：第 10 级钢盆小鲸，第 7 级换回旧惊喜小鲸；12：镀金大肥鱼蓝色保持原色）
// 简易的短连接静态服务器偶发会丢个别请求（浏览器报 net::ERR_EMPTY_RESPONSE）。
// 一张图只加载一次的话，那格就永久破图，所以失败后换 URL 重试两次（加 retry 参数绕开坏缓存）。
const IMG_TRIES = 2;
function retryImg(i, src) {
  const n = +(i.dataset.try || 0);
  if (n < IMG_TRIES) {
    i.dataset.try = String(n + 1);
    i.src = src + (src.includes('?') ? '&' : '?') + 'retry=' + (n + 1);
  } else {
    i.dataset.giveup = '1';
    i.dispatchEvent(new Event('giveup'));
  }
}
const img = (src) => { const i = new Image(); i.onerror = () => retryImg(i, src); i.src = src; return i; };
const sprites = TIERS.map((_, k) => img(`sprites/t${String(k + 1).padStart(2, '0')}.png?v=${SPRITE_V}`));
// 高背景（tools/make_bg_tall.py）：构图原点在图里 (BG_X0, BG_Y0) 格（1 格 = 2 逻辑像素）。
// 整张（构图里面、外面）都由 #backdrop 画（syncBackdrop），游戏画布是透明底、叠在它上面。
const bg = img('sprites/bg_tall.png?v=4');
const BG_X0 = 40, BG_Y0 = 40;
// 镀金版精灵：tools/gild.py 预先生成（深金覆膜，饭团海苔/碗/杯子/人脸保留原色），四周各大 1 像素
const gSprites = TIERS.map((_, k) => img(`sprites/g${String(k + 1).padStart(2, "0")}.png?v=${SPRITE_V}`));
const ok = (i) => i.complete && i.naturalWidth > 0;
// 成就头像图集（tools/make_ach_icons.py 生成；版本号由 tools/build.py 按文件哈希换）
const achAtlas = img('sprites/ach.png?v=4839c655');

// 见过的物品/角色（浏览器本地存储）。没见过的在开始页和图鉴里显示成问号
const seen = new Set((() => { try { return JSON.parse(localStorage.getItem('dfy_seen') || '[]'); } catch { return []; } })());
// ?debug：图鉴 22 格全部点亮（只在内存里，不写存档；markSeen 见全了会直接返回）
if (/[?&]debug\b/.test(location.search)) for (let k = 0; k < TIERS.length; k++) { seen.add(k); seen.add('g' + k); }
const SHORT = TX.物品.map(x => x.简称);
const LOCK_NAME = TX.通用.未解锁名;
const spriteSrc = (k, gold = false) => `sprites/${gold ? 'g' : 't'}${String(k + 1).padStart(2, '0')}.png?v=${SPRITE_V}`;
const seenKey = (k, gold) => gold ? 'g' + k : k;   // 图鉴：普通存 k，镀金存 'gk'
// 未解锁：只画物品轮廓（剪影，外圈深棕描边）；问号是单独一层（见 fillCell），所有格子同一个，不随物品形状变
const lockCache = new Map();
const LOCK_FILL = new Set([2]);                       // 面窝：去掉中间的孔
const LOCK_NUDGE = { 4: '4%,-7%', 10: '7%,-4%' };     // 泡面、大肥鱼：剪影往右上挪一点，问号在里面更居中
const Q = [   // 问号层：奶白问号 + 深棕描边，按界面 2 逻辑像素一格贴
  '.ooooo.',
  'oowwwoo',
  'owwowwo',
  'oooowwo',
  '..owwoo',
  '..owoo.',
  '..ooo..',
  '..owo..',
  '..ooo..',
];
function lockImg(k, cb, gold = false) {
  const ck = seenKey(k, gold);
  if (lockCache.has(ck)) return cb(lockCache.get(ck));
  const src = spriteSrc(k, gold);
  const im = new Image();
  im.onerror = () => retryImg(im, src);
  im.onload = () => {
    const w = im.naturalWidth, h = im.naturalHeight;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, w, h), op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d.data[(y * w + x) * 4 + 3] > 100;
    // 面窝：剪影把中间的孔填上（从边框往里泛洪，够不着的透明像素算孔）
    let a = op;
    if (LOCK_FILL.has(k)) {
      const outside = new Uint8Array(w * h), st = [];
      for (let x = 0; x < w; x++) st.push([x, 0], [x, h - 1]);
      for (let y = 0; y < h; y++) st.push([0, y], [w - 1, y]);
      while (st.length) {
        const [x, y] = st.pop();
        if (x < 0 || y < 0 || x >= w || y >= h || outside[y * w + x] || op(x, y)) continue;
        outside[y * w + x] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !outside[y * w + x];
    }
    const out = g.createImageData(w, h);
    const put = (x, y, r, gg, b) => { const i = (y * w + x) * 4; out.data.set([r, gg, b, 255], i); };
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!a(x, y)) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      const edge = !a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1);
      if (edge) put(x, y, 0x4a, 0x2e, 0x20); else put(x, y, 0x8a, 0x6a, 0x52);
    }
    g.putImageData(out, 0, 0);
    const url = c.toDataURL(); lockCache.set(ck, url); cb(url);
  };
  im.src = src;
}
const ladder = document.getElementById('ladder');
const ladderCells = TIERS.map(() => {
  const d = document.createElement('div');
  d.innerHTML = '<img alt=""><span class="lbl"></span>';
  ladder.appendChild(d);
  return d;
});

// 界面上的像素字和图标（PixUI 见 pixui.js；u = 一个像素占几个逻辑像素）
// 大字（u=2）和背景共用 2 逻辑像素一格的网格；小字（u=1）如果也压到逻辑像素网格上，笔画会粘连，
// 所以小字画在画面的细网格上（1 格 = 1/FINE 逻辑像素，和画布同一个网格），所有设备一样。
const PX = window.PixUI;
const fine = () => FINE;
const fineList = new Map();
function putText(el, str, opt, u) {
  fineList.set(el, () => putText(el, str, opt, u));   // 窗口缩放后放大倍数 k 可能变，重贴
  if (opt.cell) return PX.put(el, PX.text(str, opt), opt.cell, str);   // 自带格子大小（逻辑像素）的字，不走 u 的两档
  if (u >= 2) return PX.put(el, PX.text(str, opt), u, str);
  const f = fine();
  PX.put(el, PX.text(str, { ...opt, px: opt.px * f, ow: Math.round(f), thr: Math.min(opt.thr ?? 110, 70) }), 1 / f, str);
}
// 窗口缩放后重贴全部像素字（一遍要 100 多毫秒）。2026-11-14 改：只在字图真的要换时才重贴，并且等缩放停下来（150 毫秒没有新的 resize）再贴。
// 字图只跟两样有关：先放大几倍（PX.zoom）、各档字是不是「够大可以直接最近邻」（put 里的 crisp：u × PX.dev ≥ 2.5）；
// 手机上收放地址栏只改高度，这两样多半不变。原来每来一个 resize 就整套重贴，工具栏一动就连着卡几下。
const pixKey = () => { const d = PX.dev || 1; return [PX.zoom || 1, d >= 0.833, d >= 1.25, d >= 1.667, d >= 1.875, d >= 2.5, d >= 3.75, d >= 5].join(); };
let pixDone = pixKey(), pixTimer = 0;
addEventListener('resize', () => {
  if (skipResize) return;
  clearTimeout(pixTimer);
  if (pixKey() === pixDone) return;
  pixTimer = setTimeout(() => { pixDone = pixKey(); for (const redo of fineList.values()) redo(); textCache.clear(); }, 150);
});

// 署名页这类长段落：按 DOM 里的 <b>/<a> 拆成几段，在物理像素网格上排版换行；链接上盖透明 <a> 保持可点
function putPara(el, runs, maxW, px = 12, align = 'left') {
  const f = fine();
  fineList.set(el, () => putPara(el, runs, maxW, px, align));
  const { canvas, links } = PX.para(runs, { px: px * f, maxW: maxW * f, align });
  PX.put(el, canvas, 1 / f, runs.map(r => r.t).join(''));
  el.style.position = 'relative';
  for (const l of links) for (const r of l.rects) {
    const a = document.createElement('a');
    a.href = l.href; a.target = '_blank'; a.rel = 'noopener'; a.className = 'plink';
    // B站 Toy 版：不能用普通链接跳走，B站 空间链接改走 toy.navigate（站外链接在 markup 里已经去掉了）
    const mid = window.TOY && /space\.bilibili\.com\/(\d+)/.exec(l.href);
    if (mid) a.onclick = (e) => { e.preventDefault(); window.TOY.space(mid[1]); };
    Object.assign(a.style, { left: r.x / f + 'px', top: r.y / f + 'px', width: r.w / f + 'px', height: r.h / f + 'px' });
    el.appendChild(a);
  }
}
// 署名页段落：数据里 **粗体**、[文字](网址) 的简易标记 → 排版用的分段
function markup(str) {
  const out = [], re = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ t: str.slice(last, m.index) });
    // B站 Toy 版不许跳站外：站外链接只留文字（tools/build_toy.py 打包时也会把 text.js 里的站外链接去掉）
    if (m[2] && window.TOY && !/^https?:\/\/[\w.]*bilibili\.com\//.test(m[3])) out.push({ t: m[2] });
    else out.push(m[1] ? { t: m[1], bold: true } : { t: m[2], color: '#2a6fb0', href: m[3] });
    last = re.lastIndex;
  }
  if (last < str.length) out.push({ t: str.slice(last) });
  return out;
}
const TITLE = { px: 20, fill: '#ffe08a', fill2: '#f5a742', hi: '#fff6c8' };
// 按钮字：原来是 11 格字、每格 2 逻辑像素，笔画挤在 11 格里粘成一团；现在是 16.5 格字、每格 4/3 逻辑像素（cell），占的版面一样，
// 仍是方块像素，但笔画和间隙分得开。字模用现成的 16.5_400 一档（即 11 号 ×1.5）
const TITLE2 = { px: 21, cell: 4 / 3, bold: false, fill: '#4a2e20', outline: null, shadow: false, thr: 70 };   // 页面标题（署名/图鉴/成就）：同样的思路，21 格字 × 4/3，字模见 make_font.py 的 (21, 400)
const BTN = { px: 16.5, cell: 4 / 3, bold: false, fill: '#4a2e20', outline: null, shadow: false, thr: 70 };
const setPix = (id, str, opt, u = 2) => putText(document.getElementById(id), str, opt, u);
// 结束页 / 暂停页卡片上的「最高分 n」：普通局整行棕字；美梦局字一样、分数染成蓝紫（绶带夜空色，奶白卡片上用深一档的
// DREAM_BEST_CARD；HUD 在天空上用亮一档的 DREAM_BEST_COL），一眼和普通最高分区分开
const DREAM_BEST_CARD = '#5c56b0';
function putBest(id, tmpl, n, dream) {
  const el = document.getElementById(id), opt = { ...BODY, fill: '#8a6a52' };
  if (!dream) return setPix(id, fmt(tmpl, { n }), opt, 1);
  for (const c of el.children) fineList.delete(c);
  fineList.set(el, () => putBest(id, tmpl, n, dream));
  const [pre, post = ''] = tmpl.split('{n}'), parts = [];
  if (pre.trim()) parts.push([pre.trim(), opt, 0]);
  parts.push([String(n), { ...opt, fill: DREAM_BEST_CARD, bold: true }, pre.endsWith(' ') ? 4 : 0]);
  if (post.trim()) parts.push([post.trim(), opt, post.startsWith(' ') ? 4 : 0]);
  el.replaceChildren(...parts.map(([t, o, ml]) => { const sp = document.createElement('span'); sp.style.display = 'flex'; sp.style.marginLeft = ml + 'px'; putText(sp, t, o, 1); return sp; }));
}
// 一行小字里 [方括号] 里的字换成 hl 样式（比如标红警告），其余用 opt
function putMarked(id, str, opt, hl) {
  const el = document.getElementById(id);
  for (const c of el.children) fineList.delete(c);
  fineList.set(el, () => putMarked(id, str, opt, hl));
  const parts = str.split(/\[(.+?)\]/).map((t, i) => [t, i % 2 ? hl : opt]).filter(([t]) => t);
  el.replaceChildren(...parts.map(([t, o]) => { const sp = document.createElement('span'); sp.style.display = 'flex'; putText(sp, t, o, 1); return sp; }));
}
for (const str of TX.署名页.段落) {
  const p = document.createElement('p');
  document.querySelector('.credit').appendChild(p);
  putPara(p, markup(str), 240);
}
// 图标按钮的悬停提示
for (const [id, key] of [['bSound', '声音'], ['bPause', '暂停'], ['bShake', '晃动'], ['bCredit1', '署名'], ['bCredit2', '署名'], ['bCredit3', '署名'], ['noteTab', '意见']]) document.getElementById(id).title = TX.鼠标悬停提示[key];
setPix('tTitle', TX.标题.游戏名, TITLE);
setPix('tOver', TX.标题.结束页, TITLE);
setPix('tSub', TX.标题.副标题, { px: 12, bold: false, fill: '#fff6e0', thr: 90 }, 1);
setPix('tCredit', TX.署名页.标题, TITLE2);
setPix('bBack', TX.按钮.返回, BTN);
const BODY = { px: 12, bold: false, fill: '#4a2e20', outline: null, shadow: false, thr: 80 };
const SCORE_BIG = { px: 20, fill: '#ffe08a', fill2: '#f5a742', hi: '#fff6c8' };
const LBL = { px: 10, bold: false, fill: '#6b4a36', outline: null, shadow: false, thr: 100 };
// 开始页进化表和图鉴格子共用：按是否见过填图和名字
function fillCell(d, k, gold = false) {
  const sk = seenKey(k, gold), on = seen.has(sk), im = d.querySelector(':scope > img');   // 不能用 querySelector('img')：选中时垫底小牌子里也有一张 img
  // canvas 读回不可靠的设备（pixui.js READ_OK）：剪影做不出来，直接贴原图、用 CSS 压成暗色（html.noread img.lk）
  im.classList.toggle('lk', !on && !PX.readOk);
  if (on || !PX.readOk) im.src = spriteSrc(k, gold); else lockImg(k, (u) => { if (!seen.has(sk)) im.src = u; }, gold);
  im.style.transform = !on && LOCK_NUDGE[k] ? `translate(${LOCK_NUDGE[k]})` : '';
  let q = d.querySelector('.q');
  if (!q) { q = document.createElement('span'); q.className = 'q'; d.appendChild(q); }
  q.style.display = on ? 'none' : 'block';
  if (!on && !q.firstChild) PX.put(q, PX.bitmap(Q, { o: '#4a2e20', w: '#fff6e0' }), 2, '?');
  d.title = on ? `${gold ? TX.图鉴.镀金前缀 : ''}${TIERS[k].name}` : LOCK_NAME;
  putText(d.querySelector('.lbl'), on ? SHORT[k] : LOCK_NAME, LBL, 1);
}
// 重画 11 格要 100 多毫秒（像素字 + 剪影），所以只在图鉴有变化（seen.size 变了）或强制时才重画。原来每次回开始页/结束页都重画，从意见页点「返回」会卡一下（2026-11-10 修）
let ladderSeen = -1;
const refreshLadder = (force = false) => { if (!force && ladderSeen === seen.size) return; ladderSeen = seen.size; ladderCells.forEach((d, k) => fillCell(d, k)); };
fineList.set('q', () => { for (const q of document.querySelectorAll('.q')) q.textContent = ''; refreshLadder(true); dexCells?.forEach((d, k) => fillCell(d, k, dexGold)); });
refreshLadder();
// 美梦模式也解锁图鉴（2026-11-11 用户改；成就仍不解锁）。「图鉴集齐」成就 m2 走 unlock()，美梦里被拦住，
// 所以要是最后几格是在美梦里集齐的，回到普通局下一次 markSeen 时补发
function markSeen(k, gold = false) {
  const sk = seenKey(k, gold);
  if (!seen.has(sk)) { seen.add(sk); localStorage.setItem('dfy_seen', JSON.stringify([...seen])); }
  if (!M.dream && !achDone.m2 && seen.size >= TIERS.length * 2 && TIERS.every((_, i) => seen.has(i) && seen.has('g' + i))) unlock('m2');
}

// ---------------------------------------------------------------- 成就（设计见 成就设计.md）
// 终身记录，存 localStorage.dfy_ach = {id: 首次达成时间}。?debug / ?gold / ?showcase 下不记。
// 头像：sprites/ach.png 图集（tools/make_ach_icons.py 生成，位置表 sprites/ach.js 的 ACH_ICONS）；hint: 隐藏成就没达成时显示的谜语
// 顺序就是成就页（9 列 × 3 行）里的顺序：第 1 行单局表现，第 2 行合成与大肥鱼，第 3 行镀金与终章（隐藏成就 g9 放最末）
const ACH = [
  { id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }, { id: 's5' }, { id: 'm1' }, { id: 'm3' }, { id: 'f4' }, { id: 'w1' },
  { id: 'c6' }, { id: 'c7' }, { id: 'c8' }, { id: 'c9' }, { id: 'c10' }, { id: 'c11' }, { id: 'f1' }, { id: 'f2' }, { id: 'f3' },
  { id: 'g1' }, { id: 'g2' }, { id: 'g3' }, { id: 'g4' }, { id: 'g5' }, { id: 'g7' }, { id: 'g8' }, { id: 'm2' }, { id: 'g9' },
];
// 名字、说明、隐藏成就的提示在 text.json 的「成就名单」里，按 id 对上
for (const a of ACH) { const t = TX.成就名单[a.id]; a.name = t.名; a.desc = fmt(t.说明, { n: t.分数 }); if (t.分数) a.score = t.分数; a.story = t.故事; if (t.提示) a.hint = t.提示; }
const achDone = (() => { try { return JSON.parse(localStorage.getItem('dfy_ach') || '{}'); } catch { return {}; } })();
if (/[?&]debug\b/.test(location.search)) for (const a of ACH) if (!achDone[a.id]) achDone[a.id] = Date.now();   // ?debug：成就全部已达成（不写存档，achOn() 在 debug 下为假）
const achOn = () => !/[?&](debug|gold|showcase)\b/.test(location.search);
const achQueue = [];
let achRun = 0;   // 本局新达成几个（结束页显示）
function unlock(id) {
  if (M.dream || achDone[id] || !achOn()) return;   // 美梦模式不解锁成就
  achDone[id] = Date.now();
  localStorage.setItem('dfy_ach', JSON.stringify(achDone));
  achQueue.push(ACH.find(a => a.id === id));
  achRun++;
}
function addScore(p) {
  score += p;
  for (const a of ACH) if (a.score && score >= a.score) unlock(a.id);
  // 分数换金豆（美梦：2500 / 10000 / 之后每 1 万；普通：800 / 3000 / 之后每 3000，见 BEAN_RULE），从分数那儿飞过去
  const m = shakeMilestoneOf(score);
  if (m > shakeMilestone) { grantShake(m - shakeMilestone, 44, 26); shakeMilestone = m; }
  syncShakeChip();
}
setPix('overLbl', TX.结束页.本局得分, { ...BODY, fill: '#8a6a52' }, 1);
setPix('overUnit', TX.结束页.分数单位, { ...BODY, px: 13, bold: true, fill: '#b07818' }, 1);
setPix('overMaxLbl', TX.结束页.最大合成, { ...BODY, fill: '#8a6a52' }, 1);
['tHow1', 'tHow2', 'tHow3'].forEach((id, i) => setPix(id, TX.开始页.玩法[i], BODY, 1));
setPix('tGoal', TX.开始页.目标, { ...BODY, fill: '#c0532f', bold: true }, 1);
setPix('tGold', TX.开始页.镀金说明, { ...BODY, fill: '#b07818', bold: true }, 1);
setPix('tPause', TX.标题.暂停页, TITLE);
setPix('bResume', TX.按钮.继续, BTN);
setPix('bDex', TX.按钮.图鉴, BTN);
setPix('bRestart', TX.按钮.放弃本局, BTN);
setPix('bCfmYes', TX.按钮.确定放弃, BTN);
setPix('bCfmNo', TX.按钮.取消, BTN);
setPix('cfm1', TX.放弃确认.标题, { ...BODY, px: 13, bold: true }, 1);
setPix('cfm2', TX.放弃确认.说明, { ...BODY, fill: '#8a6a52' }, 1);
setPix('dcf1', TX.美梦.进入确认标题, { ...BODY, px: 13, bold: true }, 1);
putMarked('dcf2', TX.美梦.进入确认警告, BODY, { ...BODY, fill: '#c8402f', bold: true });
setPix('dcf3', TX.美梦.进入确认说明, { ...BODY, px: 10, fill: '#8a6a52' }, 1);
setPix('bDreamYes', TX.美梦.进入, BTN);
setPix('bDreamNo', TX.按钮.取消, BTN);
setPix('wipe1', TX.清空存档.标题, { ...BODY, px: 13, bold: true }, 1);
setPix('wipe2', TX.清空存档.说明, BODY, 1);
putMarked('wipe3', TX.清空存档.警告, BODY, { ...BODY, fill: '#c8402f', bold: true });
setPix('bWipeYes', TX.清空存档.确定, BTN);
setPix('bWipeNo', TX.按钮.取消, BTN);
setPix('pScoreLbl', TX.暂停页.当前得分, { ...BODY, fill: '#8a6a52' }, 1);
setPix('tDex', TX.图鉴.标题, TITLE2);
setPix('bDexBack', TX.按钮.返回, BTN);
// 开始页「开始」、结束页「再来一局」：两侧一对来回跳的箭头 › 字 ‹；图鉴/成就/返回是「图标 + 字」的副按钮
function putGo(id, str) {
  const b = document.getElementById(id);
  b.innerHTML = '<span class="arw"></span><span class="txt"></span><span class="arw r"></span>';
  PX.put(b.children[0], PX.icon('next'), 2);
  PX.put(b.children[2], PX.icon('prev'), 2);
  putText(b.children[1], str, BTN);
}
putGo('bStart', TX.按钮.开始);
putGo('bRetry', TX.按钮.再来一局);
for (const [id, ic, key] of [['bDex1', 'book', '图鉴'], ['bAch1', 'cup', '成就'], ['bAch2', 'cup', '成就'], ['bHome', 'home', '返回']]) {
  const b = document.getElementById(id);
  b.innerHTML = '<span></span><span></span>';
  PX.put(b.children[0], PX.icon(ic), 2);
  putText(b.children[1], TX.按钮[key], BTN);
}
// 意见页卡片顶上的图钉（同便签图标上的那颗，放大一号）
const NOTE_PIN = ['.####.', '#kxxx#', '#kxxx#', '#xxxz#', '.####.'];
const NOTE_PIN_PAL = { '#': '#2b2622', 'x': '#c8402f', 'k': '#ff9a7a', 'z': '#8a2a20' };
// i 按钮：结束页的是正方形，边长跟开始按钮一样高（和再来一局同高）；开始页、暂停页的在右下角
const putIcons = () => {
  const h = document.getElementById('bStart').offsetHeight || 34;
  for (const id of ['bCredit1', 'bCredit2', 'bCredit3']) PX.put(document.getElementById(id), PX.icon('info'), 2, TX.鼠标悬停提示.署名);
  PX.put(document.getElementById('bPause'), PX.icon('pause'), 2, TX.鼠标悬停提示.暂停);
  putChipIcon();
  PX.put(document.getElementById('noteTab'), PX.icon('note'), 2, TX.鼠标悬停提示.意见);
  PX.put(document.getElementById('notePin'), PX.bitmap(NOTE_PIN, NOTE_PIN_PAL), 2);
};
function putChipIcon() { const w = !M.dream; PX.put(document.querySelector('#bShake .ic'), PX.icon(w ? 'water' : 'shake'), 2, w ? TX.鼠标悬停提示.灌水 : TX.鼠标悬停提示.晃动); }
putIcons(); fineList.set('icons', putIcons);

// ---------------------------------------------------------------- 声音（8-bit 方波，现场合成）
let audio = null, soundOn = localStorage.getItem('dfy_sound') !== '0';
function beep(freqs, dur = 0.08, type = 'square', vol = 0.06) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    freqs.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = f;
      const s = t0 + i * dur;
      g.gain.setValueAtTime(vol, s); g.gain.exponentialRampToValueAtTime(0.0001, s + dur * 1.6);
      o.connect(g).connect(audio.destination); o.start(s); o.stop(s + dur * 1.7);
    });
  } catch (e) {}
}
const SCALE = [262, 294, 330, 392, 440, 523, 587, 659, 784, 880, 1047, 1175];
const sfxDrop = () => beep([180], 0.05, 'triangle', 0.08);
const sfxMerge = (k) => beep([SCALE[k], SCALE[k + 1] || 1319], 0.06);
const sfxBig = () => beep([523, 659, 784, 1047, 1319], 0.09);
const sfxOver = () => beep([392, 330, 262, 196], 0.14, 'triangle', 0.09);
// 镀金：方波琶音 + 高八度三角波「叮」
const sfxGold = (k) => { const f = SCALE[k] || 1047; beep([f, f * 1.26, f * 1.5, f * 2], 0.045, 'square', 0.05); setTimeout(() => beep([f * 4, f * 3], 0.06, 'triangle', 0.05), 160); };
const sfxGoldFade = () => beep([1568, 1175, 880, 659], 0.05, 'triangle', 0.035);
const sfxGoldLock = () => { beep([523, 1047], 0.05, 'square', 0.05); setTimeout(() => beep([1568, 2093, 2637], 0.05, 'triangle', 0.05), 120); };
const sfxGoldDrop = () => beep([1568, 2093], 0.04, 'triangle', 0.05);
const sfxGoldAppear = () => beep([2093, 2637, 3136], 0.035, 'triangle', 0.035);
const sfxFish = () => { sfxBig(); setTimeout(() => beep([1568, 2093, 2637], 0.05, 'triangle', 0.04), 460); };
const sfxGoldFish = () => { beep([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0.08, 'square', 0.06); setTimeout(() => beep([2093, 2637, 3136, 4186], 0.05, 'triangle', 0.05), 650); };
// 摇一摇：开始时一串往上走的「嗡」（梦），每次猛地一甩「哐」一声（越猛越低越响），结束时下滑
const sfxShakeOn = () => beep([392, 523, 659, 880], 0.045, 'square', 0.04);
const sfxShakeEnd = () => beep([659, 523, 392], 0.05, 'triangle', 0.05);
const sfxShakeGet = () => beep([1047, 1568], 0.05, 'triangle', 0.05);
// 用掉金豆 / 灌水（2026-11-14）：豆飞出去「咻」、扑通、木盖「咔哒」、涨水一串往上的咕嘟、退水往下的咕噜
const sfxBeanSpend = () => beep([1568, 1175], 0.04, 'triangle', 0.045);
const sfxSplash = () => beep([880, 587, 1175], 0.04, 'triangle', 0.055);
const sfxLid = () => beep([196, 147], 0.035, 'square', 0.05);
const sfxWaterRise = () => beep([262, 330, 392, 494, 587, 698], 0.07, 'square', 0.028);
const sfxWaterEnd = () => beep([587, 494, 392, 330, 262], 0.07, 'triangle', 0.04);
const sfxJolt = (m) => {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const T = audio.currentTime, v = Math.min(1, m / 9);
    sweep(150 - v * 50, 55, 0.12, 'triangle', 0.05 + v * 0.05, T);
    noise(0.12, 0.03 + v * 0.04, 700, T);
  } catch (e) {}
};
const bSound = document.getElementById('bSound');
const syncSound = () => PX.put(bSound, PX.icon(soundOn ? 'sound' : 'mute'), 2, soundOn ? TX.鼠标悬停提示.声音开 : TX.鼠标悬停提示.声音关);
fineList.set('sound', () => syncSound());
bSound.onclick = () => { soundOn = !soundOn; localStorage.setItem('dfy_sound', soundOn ? '1' : '0'); syncSound(); beep([660]); };
syncSound();

// ---------------------------------------------------------------- 物理
let engine, world;
let score, best = +localStorage.getItem('dfy_best') || 0, maxTier;
let cur, next, curGold = false, nextGold = false, aimX = W / 2, canDrop, state = 'title', overTimer = 0, effects = [], shake = 0;
let flash = 0, slow = 0, scoreGlow = 0;

// ---- 美梦模式的存档：dfy_dream = {miss: 连续几局没合出大肥鱼, unlocked: 是否已解锁入口, entered: 是否进过美梦（没进过绶带就蹦跶诱导）}；dfy_dream_best = 美梦模式自己的最高分（和正式最高分分开）
const dreamSave = (() => { try { return { miss: 0, unlocked: false, ...JSON.parse(localStorage.getItem('dfy_dream') || '{}') }; } catch { return { miss: 0, unlocked: false }; } })();
let dreamBest = +localStorage.getItem('dfy_dream_best') || 0;
if (DREAM_TEST) { dreamSave.unlocked = true; dreamSave.miss = 2; dreamSave.entered = false; }   // 测试：每次刷新都当没进过，看诱导动效
const saveDream = () => { if (!DREAM_TEST) localStorage.setItem('dfy_dream', JSON.stringify({ miss: dreamSave.miss, unlocked: dreamSave.unlocked, entered: dreamSave.entered })); };
let lastPile = [];    // 上一局结束时场上的东西，进美梦模式时整堆搬进去
let thaw = null;      // 进美梦后旧局的堆悬空冻结中：{t, bodies}
let cdUntil = 0, lastDropped = null, lastDropAt = 0;   // 丢球冷却
let box = { x: 0, y: 0, vx: 0, vy: 0 };   // 美梦摇一摇：容器的偏移和速度（世界单位，每步）

function newGame(pile) {
  engine = Engine.create({ gravity: { y: 1.4 } });
  engine.positionIterations = 10; engine.velocityIterations = 8;
  world = engine.world;
  const o = { isStatic: true, friction: 0.6, restitution: 0.1 };
  const midX = (M.wl + M.wr) / 2, spanY = (M.floor - M.top) * 3;
  Composite.add(world, [
    Bodies.rectangle(midX, FLOOR + 50, (M.wr - M.wl) * 4, 100, o),
    Bodies.rectangle(M.wl - 50, M.floor - spanY / 2 + 200, 100, spanY, o),
    Bodies.rectangle(M.wr + 50, M.floor - spanY / 2 + 200, 100, spanY, o),
  ]);
  Events.on(engine, 'collisionStart', onCollide);
  Events.on(engine, 'collisionActive', onCollide);
  fishStop = null; fishQueue.length = 0; score = 0; maxTier = 0; effects = []; shake = 0; overTimer = 0; flash = 0; slow = 0; scoreGlow = 0;
  cur = randTier(true); curGold = false; next = randTier(); nextGold = false; aimX = midX; canDrop = true; goldPity = 0;
  cdUntil = 0; lastDropped = null; thaw = null; fillJob = null; autoFire = false; locking = []; tutRun.clear();
  shk = null; shkTally = null; shakeGraceUntil = 0; box = { x: 0, y: 0, vx: 0, vy: 0 }; wat = null; watTally = null; watStain = 0;
  shakeTutAt = 0; tutShakeFly = null;   // 「摇一摇」教程等这局第一颗金豆飞进九宫格后再弹（见 grantShake / loop）
  shakes = shakesShown = 0; shakeMilestone = 0;   // 开局不送金豆（门槛见 BEAN_RULE）
  curElig = nextElig = rollElig = false; dropStreak = 0; plainRun = 0; runFish = 0; chain = 0; achRun = 0; achQueue.length = 0; toast = null; achWait = 0;
  markSeen(cur); markSeen(next);
  if (pile && pile.length) importPile(pile);
  state = 'play';
}

// 把上一局（失败的那局）场上的东西整堆复制进美梦容器：整体平移，每个的相对位置和角度原样保留（不加任何随机量，不然会炸开）。
// 水平方向：旧容器正中 → 新容器正中；竖直方向：整堆放在新容器高度的正中。先冻成静态悬着，THAW_MS 后解冻，靠重力落下散开，大批合成。
function importPile(pile) {
  const dx = (M.wl + M.wr) / 2 - (NORMAL.wl + NORMAL.wr) / 2;   // 堆来自普通局（普通容器的正中）
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pile) { y0 = Math.min(y0, p.y - TIERS[p.tier].r); y1 = Math.max(y1, p.y + TIERS[p.tier].r); }
  const dy = (M.top + M.floor) / 2 - (y0 + y1) / 2;
  const bodies = [];
  for (const p of pile) {
    const b = makeBall(p.tier, p.x + dx, p.y + dy, p.gold);
    Body.setAngle(b, p.angle);
    Body.setStatic(b, true);
    b.imported = true;
    bodies.push(b);
    if (p.tier > maxTier) maxTier = p.tier;   // 名字大字只在合出比这堆更高级的东西时才报
  }
  thaw = { t: 0, bodies };
  canDrop = false;
}
// ---- 测试用（网址带 ?dream 才有按钮）：快速填满 / 快速失败，不用一个个丢。
// 往容器里持续砸随机球（每帧 1 个，2–6 级），直到已经落稳的最高点到目标高度：
//   full = 红线下面一小截（填满但还没失败，用来试「差一点」和红线闪烁）；fail = 红线上面（真实走一遍红线判定 → 1.5 秒后结束页）。
let fillJob = null;
function stepFill(now) {
  if (!fillJob) return;
  // 普通局容器小，在空中还没落稳的球也要算进去，所以放慢节奏（每 4 帧一个）、目标留宽一点、用小一点的球，免得填过头直接失败
  const target = fillJob.mode === 'fail' ? M.danger - 60 : M.danger + (M.dream ? 140 : 220);
  let top = Infinity;
  for (const b of Composite.allBodies(world)) if (b.tier !== undefined && now - b.born > 300 && Math.abs(b.velocity.y) < 0.5) top = Math.min(top, b.bounds.min.y);
  if (top <= target || ++fillJob.n > 1500) { fillJob = null; return; }
  if (!M.dream && fillJob.n % 4) return;
  const tier = M.dream ? 2 + Math.floor(Math.random() * 5) : 1 + Math.floor(Math.random() * 4), t = TIERS[tier];
  const x = M.wl + t.half + Math.random() * (M.wr - M.wl - 2 * t.half);
  const b = makeBall(tier, x, M.dropY - Math.random() * 100, Math.random() < 0.1);
  b.dropped = true; Body.setVelocity(b, { x: 0, y: 4 });
}
if (DREAM_TEST) window.dfyFill = (mode = 'full') => { if (state === 'play' && !thaw && !fishStop) fillJob = { mode, n: 0 }; };
// ---- 金豆：两种模式共用左侧的九宫格（最多 SHAKE_MAX 颗，满了再得就浪费），美梦里用来「摇一摇」，普通模式里用来「灌水」（2026-11-14）
// 开局不送，分数换（门槛见 BEAN_RULE），大肥鱼也给（shakeFishGain / fishMakeGain）。
// ---- 美梦模式：摇一摇（资源驱动 + 拖动把手亲手摇）
// 用法：点左侧的键用掉 1 颗 → 金豆飞进屏幕正中 → 出现一个半透明的「小容器」把手（代表整个容器），按住拖动，
// 大容器就跟着往那个方向挪（弹簧跟随，最多挪 BOX_MAX）；来回甩就是摇。限时 SHAKE_MS，按住或拖动的那一刻开始倒计时
// （一直不碰，SHAKE_IDLE 后也开始）。
// 物理做法：墙不动（Matter 里挪静态体不传速度会穿模），而是在「容器参考系」里给每个球加惯性力 = -容器加速度，
// 画面上整个世界层再平移 box。容器猛地往右一甩，球就往左甩；往上一顶再停，球就被抛起来——和真摇一个箱子一样，
// 拖着不动（匀速/静止）则不起作用。摇的时候和之后一小会儿不判红线。
// 分数门槛（两种模式各一套）：美梦第一颗 2500、第二颗 10000、之后每 1 万分；
// 普通第一颗 800、第二颗 3000、之后每 3000 分（6000、9000、12000…，2026-11-14 用户定：普通局分数难攒）
const BEAN_RULE = { dream: { first: 2500, second: 10000, every: 10000 }, normal: { first: 800, second: 3000, every: 3000 } };
const SHAKE_MAX = 9;
const beanRule = (dream = M.dream) => dream ? BEAN_RULE.dream : BEAN_RULE.normal;
// 分数一共换过几颗金豆（两套规则的 second 都正好等于 every，所以第二颗起就是 floor(s / every)）
const shakeMilestoneOf = (s, R = beanRule()) => (s >= R.first ? 1 : 0) + Math.floor(s / R.every);
// 键上那条进度条：离下一颗豆还差多少（0..1）。第一颗按 first 算，第二颗按 second - first 的差值算，之后按 every
function shakeScoreProgress(s, R = beanRule()) {
  if (s < R.first) return s / R.first;
  if (s < R.second) return (s - R.first) / (R.second - R.first);
  return (s % R.every) / R.every;
}
// 大肥鱼相消给的豆：美梦（2026-11-11）普通 + 普通 1 颗、一金一普通 50% 1 颗 / 50% 2 颗、双金 2 颗；
// 普通模式（2026-11-14）普通 + 普通 2 颗，只要带镀金（一金一普通、双金）统一 3 颗
const shakeFishGain = (golds, dream = M.dream) => dream ? (golds === 1 ? (Math.random() < 0.5 ? 1 : 2) : golds === 2 ? 2 : 1) : golds ? 3 : 2;
// 普通模式合出大肥鱼也给豆（美梦不给）：普通 1 颗，镀金 50% 1 颗 / 50% 2 颗
const fishMakeGain = (gold) => gold ? (Math.random() < 0.5 ? 1 : 2) : 1;
const SHAKE_MS = 4000, SHAKE_IDLE = 2500, SHAKE_GRACE = 1500;
const STICK_R = 40;                                   // 把手最多拖开多远（屏幕逻辑像素）
const STICK_X = W / 2, STICK_Y = 400;                 // 把手在屏幕正中（容器中部）
const BOX_MAX = { x: 20, up: 24, down: 10 };          // 容器最多挪多远（屏幕逻辑像素；往下留得少，底下没地方）
// 弹簧跟随：刚度、阻尼、每步最大加速度、最大速度（世界单位）。跟得紧（接近临界阻尼），容器的速度就由手指的速度决定：
// 猛地一划 = 容器猛地冲过去、到头一下刹住（刹车集中在 1–2 步里），慢慢拖 = 几乎没加速度、不起作用。
// （第一版 0.3/0.55/5：加速度上限太低，快划和慢划出来的容器运动几乎一样，猛划不「猛」。）
const BOX_K = 0.6, BOX_D = 1.0, BOX_AMAX = 20, BOX_VMAX = 26;
const SHAKE_GAIN = 0.9, BALL_VMAX = 20;               // 惯性力倍数；球速上限（防甩飞穿墙）
const SLAM_A = 7, SLAM_LIFT = 0.22, SLAM_LMAX = 4;                   // 急刹（一步里速度掉了 SLAM_A 以上）时额外把球往上颠一下（越猛颠越高），堆死的也会被颠散
let shakes = 0, shakesShown = 0, shakeMilestone = 0, shakeGraceUntil = 0;
let shk = null;        // 摇着：{t 已摇 ms, idle 等待 ms, started, drag:{pid, x0, y0}|null, kx/ky 把手偏移, mx/my 显示用的把手位置, merges, lastJolt, jdir}
let shkTally = null;   // 刚摇完：{until, n, x, y}，到时数一下摇出几次合成
// 用掉一颗金豆：九宫格里最后一颗亮着的豆飞出去（spend 特效，画在顶层画布），沿弧线落到 (x1, y1)（屏幕坐标）。
// 2026-11-14 用户要求：灌水、摇一摇都先放这段「豆飞进容器」（原来只在摇一摇教程第①格里有），落地了技能才开始。
const SPEND_MS = 520;
function spendBean(x1, y1) {
  const [x0, y0] = beanAt(Math.max(0, shakesShown - 1)), n = Math.round(SPEND_MS / STEP);
  shakes--; shakesShown = Math.max(0, shakesShown - 1);
  effects.push({ kind: 'spend', scr: true, x0, y0, x1, y1, life: n, max: n });
  sfxBeanSpend();
}
function startShake() {
  if (!M.dream || state !== 'play' || thaw || fishStop || shk || shakes <= 0) return;
  spendBean(STICK_X, STICK_Y);
  // wait：金豆还在飞（摇杆等它落到屏幕正中才出现，见 stepShake）
  shk = { t: 0, idle: 0, started: false, wait: SPEND_MS, drag: null, kx: 0, ky: 0, mx: 0, my: 0, merges: 0, lastJolt: 0, jx: 0, jy: 0, born: Infinity };
  shakeGraceUntil = Infinity; pointerDown = false; autoFire = false;
  syncShakeChip();
}
function endShake(now) {
  shkTally = { until: now + 1200, n: shk.merges };
  shk = null;
  shakeGraceUntil = now + SHAKE_GRACE;
  sfxShakeEnd(); syncShakeChip();
}
// 每个物理步：把手 → 目标偏移 → 弹簧跟随 → 容器加速度 → 反向加到每个球上
function stepShake(now) {
  if (!M.dream) return;
  const S = shk;
  let tx = 0, ty = 0;
  if (S && S.wait > 0) {   // 金豆还在往屏幕正中飞：到了才亮出摇杆
    if ((S.wait -= STEP) <= 0) { S.born = performance.now(); sfxShakeOn(); twinkles(STICK_X, STICK_Y, 30, 10, NIGHT_STARS, true); }
  } else if (S) {
    if (!S.started && (S.idle += STEP) >= SHAKE_IDLE) S.started = true;
    if (S.started) S.t += STEP;
    if (!S.drag) { S.kx = 0; S.ky = 0; }
    tx = S.kx / STICK_R; ty = S.ky / STICK_R;
    if (S.t >= SHAKE_MS) endShake(now);
  }
  const k = M.k, X = tx * BOX_MAX.x * k, Y = (ty < 0 ? ty * BOX_MAX.up : ty * BOX_MAX.down) * k;
  const cl = (v, m) => Math.max(-m, Math.min(m, v));
  const vx0 = box.vx, vy0 = box.vy;
  box.vx = cl(box.vx + cl((X - box.x) * BOX_K - box.vx * BOX_D, BOX_AMAX), BOX_VMAX);
  box.vy = cl(box.vy + cl((Y - box.y) * BOX_K - box.vy * BOX_D, BOX_AMAX), BOX_VMAX);
  box.x += box.vx; box.y += box.vy;
  // 硬上限：甩过头最多比设计值多 10%（顶到上限就把这个方向的速度掐掉——这一下急停也算进加速度，球照样被甩出去）
  const lx = BOX_MAX.x * k * 1.1, lu = BOX_MAX.up * k * 1.1, ld = BOX_MAX.down * k * 1.1;
  if (box.x > lx || box.x < -lx) { box.x = Math.sign(box.x) * lx; box.vx = 0; }
  if (box.y < -lu) { box.y = -lu; box.vy = 0; } else if (box.y > ld) { box.y = ld; box.vy = 0; }
  const ax = box.vx - vx0, ay = box.vy - vy0;   // 这一步容器实际的加速度
  if (!S && Math.abs(box.x) + Math.abs(box.y) + Math.abs(box.vx) + Math.abs(box.vy) < 0.05) { box.x = box.y = box.vx = box.vy = 0; return; }
  // 惯性力（慢动作时物理走得慢，力也按比例缩）。急刹（加速度和原来的速度反向）时还把球往上颠一下：
  // 真摇箱子时一下撞停，里面的东西不只是横着冲过去，还会被撞得跳起来、整堆散开
  const g = SHAKE_GAIN * (slow > 0 ? 0.3 : 1);
  const brake = Math.max(0, -(ax * vx0 + ay * vy0) / (Math.hypot(vx0, vy0) || 1));
  const lift = brake > SLAM_A ? Math.min(SLAM_LMAX, (brake - SLAM_A * 0.5) * SLAM_LIFT) * g : 0;   // 上限：连着猛甩也别把球颠出容器口
  if (Math.abs(ax) + Math.abs(ay) > 0.05) for (const b of Composite.allBodies(world)) {
    if (b.tier === undefined || b.isStatic) continue;
    const j = 0.85 + Math.random() * 0.3;   // 每个球差一点点，打散互相顶死的受力
    let vx = b.velocity.x - ax * g * j, vy = b.velocity.y - ay * g * j - lift * (0.4 + Math.random() * 0.6);
    const sp = Math.hypot(vx, vy);
    if (sp > BALL_VMAX) { vx *= BALL_VMAX / sp; vy *= BALL_VMAX / sp; }
    Body.setVelocity(b, { x: vx, y: vy });
    if (lift) Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - .5) * 0.15);
  }
  // 猛地一甩（加速度大、并且方向和上次甩的反过来，或者隔了一阵）：哐一声 + 容器两边扬起灰；急刹越猛屏幕震得越凶
  const am = Math.hypot(ax, ay);
  if (S && am > 5) {
    const turned = ax * S.jx + ay * S.jy < 0 || now - S.lastJolt > 260;
    if (turned && now - S.lastJolt > 90) {
      S.lastJolt = now; S.jx = ax; S.jy = ay;
      const v = am / k, slam = brake > SLAM_A;   // v：换回屏幕像素
      sfxJolt(v * 1.3);
      shake = Math.max(shake, slam ? Math.min(9, 2 + v * 0.7) : 2);
      joltDust(ax, ay, slam ? 12 : 6);
    }
  }
}
// 甩的方向那一侧（容器被「撞停」的那面墙）冒一撮奶白小灰
function joltDust(ax, ay, n = 6) {
  const L = toScrX(M.wl), R = toScrX(M.wr), T = toScrY(M.top), F = toScrY(M.floor);
  for (let i = 0; i < n; i++) {
    let x, y, vx, vy;
    if (Math.abs(ax) >= Math.abs(ay)) {   // 左右甩：从容器左右两边往外喷
      const side = ax > 0 ? L - 6 : R + 6;
      x = side; y = T + Math.random() * (F - T); vx = (ax > 0 ? -1 : 1) * (0.6 + Math.random()); vy = -0.3 - Math.random() * 0.5;
    } else {                              // 上下甩：从底边两角喷
      x = Math.random() < 0.5 ? L + Math.random() * 30 : R - Math.random() * 30; y = F + 4; vx = (Math.random() - .5) * 1.6; vy = -0.4 - Math.random() * 0.6;
    }
    effects.push({ kind: 'dust', scr: true, x, y, vx, vy, life: 14 + Math.random() * 10 | 0, max: 24 });
  }
}
// 攒到能量豆：n 颗金豆从来源处（分数 / 两条大肥鱼消失的地方）沿弧线飞到顶栏的九宫格，到了才亮（新亮的先白闪一下，键弹一下）。
// 九宫格满了就不飞了，只在键上冒一下星。
// 这一局的第一颗豆：记下这次飞行的特效，等它最后一颗落进九宫格、动画放完，再弹「摇一摇」教程（见 loop 的 fly 分支）。
function grantShake(n, sx, sy) {
  if (n <= 0) return;
  n = Math.min(n, SHAKE_MAX - shakes);
  if (n <= 0) { twinkles(BEAN_X, BEAN_Y, 12, 4, NIGHT_STARS, true); return; }
  const first = shakes === 0;
  shakes += n;
  const e = { kind: 'fly', scr: true, x0: sx, y0: sy, x: sx, y: sy, n, slot: shakes - n, life: 46, max: 46 };
  effects.push(e);
  const tid = beanTut();   // 美梦弹「摇一摇」、普通弹「灌水」
  if (first && !tutShakeFly && (TUT_TEST ? !tutRun.has(tid) : !tutDone[tid] && !DEBUG && !SHOWCASE)) tutShakeFly = e;
}
// 一颗豆落进格子：这一格亮（先白闪）、叮一声、键弹一下。几颗豆一颗一颗落、一颗一颗亮
let beanFlashT = 0;
function beanArrive() {
  const from = shakesShown;
  shakesShown = Math.min(shakes, shakesShown + 1);
  beanFlash = { from, to: shakesShown };
  clearTimeout(beanFlashT); beanFlashT = setTimeout(() => { beanFlash = null; shakeChipN = -1; syncShakeChip(); }, 260);
  sfxShakeGet(); syncShakeChip(true);
}
// 摇一摇键（C2 样式，2026-11-14 起网页版和微信版一样）：在左侧分数栏「最高」那行下面，纵向中心和右侧「下一个」预告（NEXT_Y = 84）同高。
// 方键 17.33..43.33、九宫格 53.33..79.33（都是 26 高，71..97），进度条在九宫格下沿；方键外描边左沿 15.33 和分数字描边外沿对齐
// （index.html #hud .chip 的 left）。CHIP 是整块（含进度条）的中心，教程孔对它；BEAN 是九宫格中心，金豆往这儿飞。
const CHIP_X = 48.33, CHIP_Y = 86;
const BEAN_X = 66.33, BEAN_Y = 84;   // 九宫格的中心
const beanAt = (i) => [BEAN_X + (i % 3 - 1) * 8, BEAN_Y + (Math.floor(Math.min(i, SHAKE_MAX - 1) / 3) - 1) * 8];   // 第 i 颗豆在屏幕上的位置（豆子往这儿飞）
// 九宫格能量豆：3×3，每颗 3×3 像素、间隔 1 像素（一像素 = 2 逻辑像素，整块 22×22）。从第一行第一格开始，按读书顺序（从左往右、从上往下）亮。
// 亮的豆：金色带左上高光、右下暗部；空格：凹进去的浅木色；刚飞到的那几颗先白闪
const BEAN_PAL = { h: '#fff1a8', o: '#ffd25e', d: '#c88a1e', s: '#c4ae88', e: '#e2cfa8', w: '#ffffff' };
const BEAN_ON = ['hho', 'hod', 'odd'], BEAN_OFF = ['sss', 'see', 'see'], BEAN_NEW = ['www', 'www', 'www'];
let beanFlash = null;
// C2 样式：九宫格带 1 格深棕描边（13×13，豆和豆之间也隔一道），直接浮在天空上也看得清空格
function beanGrid(n) {
  const rows = Array.from({ length: 13 }, () => Array(13).fill('#'));
  for (let i = 0; i < SHAKE_MAX; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const art = i >= n ? BEAN_OFF : beanFlash && i >= beanFlash.from && i < beanFlash.to ? BEAN_NEW : BEAN_ON;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) rows[row * 4 + 1 + y][col * 4 + 1 + x] = art[y][x];
  }
  return PX.bitmap(rows.map(r => r.join('')), { '#': '#4a2e20', ...BEAN_PAL });
}
let shakeChipN = -1, shakeChipCls = '';
let chipWater = null;
function syncShakeChip(got = false) {
  const el = document.getElementById('bShake');
  if (!el) return;
  if (chipWater !== !M.dream) {   // 普通模式是灌水键、美梦是摇一摇键：同一个位置、同一个九宫格，只换图标和「进行中」的底色
    chipWater = !M.dream; el.classList.toggle('water', chipWater);
    el.title = chipWater ? TX.鼠标悬停提示.灌水 : TX.鼠标悬停提示.晃动;
    putChipIcon();
  }
  if (shakesShown !== shakeChipN || beanFlash) { shakeChipN = shakesShown; PX.put(el.querySelector('.n'), beanGrid(shakesShown), 2); }
  const cls = shk || wat ? 'on' : shakes > 0 ? 'ready' : 'empty';
  if (cls !== shakeChipCls) { el.classList.remove('on', 'ready', 'empty'); el.classList.add(cls); shakeChipCls = cls; }
  if (got) { el.classList.remove('got'); void el.offsetWidth; el.classList.add('got'); }
  const bar = document.getElementById('shakeBar'), full = shakes >= SHAKE_MAX;
  if (bar && score !== undefined) {
    bar.firstElementChild.style.width = full ? '100%' : Math.floor(shakeScoreProgress(score) * 13) * 2 + 'px';   // 离下一颗豆还差多少分：按 2 像素一格走；豆满了整条金色慢闪
    bar.classList.toggle('full', full);
  }
}
function endThaw() {
  for (const b of thaw.bodies) Body.setStatic(b, false);
  thaw = null; canDrop = true; shake = Math.max(shake, 5); beep([392, 523, 784], 0.05);
}

// ---- 普通模式：灌水（2026-11-14 用户设计）
// 点左侧的键用掉 1 颗金豆，全程不用再操作：金豆从九宫格飞进容器底（扑通）→ 容器顶上推进来一块木盖（显式加，物理上是一块静态板，
// 浮上来的东西顶在它底下、不会冒出框）→ 水从框底一直涨到盖子底下（涨满）→ 泡一会儿 → 退水 → 木盖抽走（显式抽走）。
// 浮力按等级递减（WATER_B）：越小浮得越快，小的先从缝里钻上去聚在盖子底下，同级的更容易碰到；退水时再一层层落回去，整堆重排一遍。
// 灌水期间不能丢球、不判失败（退水后再宽限 SHAKE_GRACE），也不算「好险！」。镀金倒计时照走（等水退的时候金子可能会褪）。
const WATER = { lidIn: 320, rise: 1100, hold: 2800, drain: 1300, lidOut: 320 };   // 各段时长（毫秒，从金豆落地算起）
const W_LID = WATER.lidIn, W_RISE = W_LID + WATER.rise, W_HOLD = W_RISE + WATER.hold, W_DRAIN = W_HOLD + WATER.drain, W_END = W_DRAIN + WATER.lidOut;
const WATER_B = [1.7, 1.65, 1.6, 1.55, 1.5, 1.42, 1.3, 1.27, 1.24, 1.2, 1.1];   // 浮力倍数（相对重力），按等级递减：食物 → 小螃蟹 → 人物 → 大肥鱼
const WATER_DRAG = 0.08;     // 水的阻力：泡在水里的部分每步速度衰减这么多（定住上浮的终速，免得冲得太猛）
const WATER_G = 1.4 * 0.001; // 和引擎重力一样（gravity.y × 默认 scale）
const WATER_STAIN = 1000;    // 退水后墙内侧的水渍淡掉的时长
let wat = null;        // 灌水中：{ t 从金豆落地算起的毫秒（飞豆时为负）, lid 盖子 Body|null, merges 合成次数, golds 镀金合成次数, level 水位 0..1 }
let watTally = null;   // 刚灌完：{until, n}，到时数一下灌出几次合成
let watStain = 0;      // 水渍还剩多少毫秒
const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
function waterLevel(t) {
  if (t < W_LID) return 0;
  if (t < W_RISE) return smooth((t - W_LID) / WATER.rise);
  if (t < W_HOLD) return 1;
  if (t < W_DRAIN) return 1 - smooth((t - W_HOLD) / WATER.drain);
  return 0;
}
// 盖子横着滑进/滑出（0 = 盖好，1 = 完全在框右边外面）
function lidSlide(t) {
  if (t < 0) return 1;
  if (t < W_LID) return 1 - smooth(t / WATER.lidIn);
  if (t < W_DRAIN) return 0;
  return smooth((t - W_DRAIN) / WATER.lidOut);
}
function startWater() {
  if (M.dream || state !== 'play' || thaw || fishStop || wat || shakes <= 0) return;
  spendBean(toScrX((M.wl + M.wr) / 2), toScrY(M.floor) - 6);
  wat = { t: -SPEND_MS, lid: null, merges: 0, golds: 0, level: 0 };
  shakeGraceUntil = Infinity; pointerDown = false; canDrop = false;
  syncShakeChip();
}
function endWater(now) {
  watTally = { until: now + 1200, n: wat.merges };   // 灌水期间的合成 + 退完以后 1.2 秒内的
  wat = null; watStain = WATER_STAIN;
  shakeGraceUntil = now + SHAKE_GRACE;
  syncShakeChip();
}
// 每个物理步之前：推进时间线、放事件（扑通 / 盖上 / 退水 / 抽盖），按浸没比例给每个球加浮力（力，和重力一样跟着步长积分）
function stepWater(now, dt) {
  if (watStain > 0) watStain -= dt;
  const S = wat;
  if (!S) return;
  const t0 = S.t; S.t += S.t < 0 ? STEP : dt;   // 金豆飞的那段（负的）按真实时间走，和顶层的飞豆对上
  const cross = (v) => t0 < v && S.t >= v;
  const cx = (M.wl + M.wr) / 2;
  if (cross(0)) { waterSplash(cx); sfxSplash(); }
  if (cross(W_LID)) {   // 盖子推到位：放一块静态板，底边正好是容器口
    S.lid = Bodies.rectangle(cx, M.top - 40, M.wr - M.wl + 60, 80, { isStatic: true, friction: 0.3, restitution: 0.05 });
    Composite.add(world, S.lid);
    sfxLid(); shake = Math.max(shake, 3); sfxWaterRise();
  }
  if (cross(W_HOLD)) sfxWaterEnd();
  if (cross(W_DRAIN)) { if (S.lid) Composite.remove(world, S.lid); S.lid = null; sfxLid(); }   // 抽盖：先把板拿掉，画面上再滑出去
  if (S.t >= W_END) { endWater(now); return; }
  const lv = S.level = waterLevel(S.t);
  if (lv <= 0) return;
  const wy = M.floor - (M.floor - M.top) * lv;
  for (const b of Composite.allBodies(world)) {
    if (b.tier === undefined || b.isStatic) continue;
    const y0 = b.bounds.min.y, y1 = b.bounds.max.y, f = Math.max(0, Math.min(1, (y1 - wy) / Math.max(1, y1 - y0)));
    b.wetF = f;
    if (!f) continue;
    b.force.y -= b.mass * WATER_G * WATER_B[b.tier] * f;
    b.force.x += b.mass * WATER_G * (Math.random() - 0.5) * 0.12 * f;   // 一点点横向扰动，顶死的堆也能松开
  }
}
// 每个物理步之后：水里的阻力（按浸没比例），速度封顶
function stepWaterDrag(dt) {
  if (!wat || wat.level <= 0) return;
  const d = WATER_DRAG * dt / STEP;
  for (const b of Composite.allBodies(world)) {
    const f = b.wetF;
    if (!f || b.tier === undefined || b.isStatic) continue;
    let vx = b.velocity.x * (1 - d * f), vy = b.velocity.y * (1 - d * f);
    const sp = Math.hypot(vx, vy);
    if (sp > BALL_VMAX) { vx *= BALL_VMAX / sp; vy *= BALL_VMAX / sp; }
    Body.setVelocity(b, { x: vx, y: vy });
    Body.setAngularVelocity(b, b.angularVelocity * (1 - d * 0.75 * f));
  }
}
// 金豆落进容器底：一圈水花 + 往上溅的水滴
const WATER_PAL = ['#ffffff', '#bfe0d4', '#6f9c8c', '#456053'];   // 水花：白 → 浅海绿 → 海平线色
function waterSplash(cx) {
  const y = M.floor - 6;
  effects.push({ kind: 'ring', x: cx, y, r: 4, vr: 3, life: 18, max: 18, pal: WATER_PAL });
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 1.5 + Math.random() * 2.5;
    effects.push({ kind: 'p', x: cx + (Math.random() - 0.5) * 12, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 24 + Math.random() * 14, color: WATER_PAL[1 + (Math.random() * 3 | 0)] });
  }
  for (let i = 0; i < 8; i++) effects.push({ kind: 'bub', x: cx + (Math.random() - 0.5) * 40, y: y - Math.random() * 10, vy: -(0.8 + Math.random()) * M.k, ph: Math.random() * 6, big: i % 3 === 0, life: 80, max: 80 });
}

let firstDrops = 0;
function randTier(first) {
  // 开局前几个只出小的，之后在 1–5 级里随机（越小越常见）
  const cap = firstDrops < 4 ? 3 : DROPPABLE;
  const w = [5, 4, 3, 2, 1.4].slice(0, cap);
  let r = Math.random() * w.reduce((a, b) => a + b);
  for (let k = 0; k < w.length; k++) { r -= w[k]; if (r <= 0) return k; }
  return 0;
}
// 摇出下一个是不是镀金。只管概率和保底；g1/g7/g8/g9 在 drop() 里按丢下的时候判
function rollGold(tier) {
  rollElig = false;
  if (tier !== 0 || firstDrops < 3) return false;
  rollElig = true;
  if (GOLD_TEST) return true;
  const k = goldPity + 1;                                   // 这是上次镀金后的第 k 个小笼包
  const p = k >= GOLD_HARD ? 1 : GOLD_BASE + Math.max(0, k - GOLD_SOFT) * GOLD_STEP;
  if (Math.random() < p) {
    goldPity = 0;
    return true;
  }
  goldPity++;
  return false;
}

// 镀金倒计时：到点褪回普通，散一圈金粉
function stepGoldTimers() {
  for (const b of Composite.allBodies(world)) {
    if (!b.gold || !b.gLeft || b.merging) continue;
    if ((b.gLeft -= STEP) > 0) continue;
    b.gold = false; b.gLeft = 0;
    const r = TIERS[b.tier].r;
    for (let i = 0; i < 10 + r / 3; i++) {   // 金粉往上飘散
      const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 1.2;
      effects.push({ kind: 'p', x: b.position.x + Math.cos(a) * r * 0.6, y: b.position.y + Math.sin(a) * r * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, life: 26 + Math.random() * 16, color: SPARK[1 + (Math.random() * 3 | 0)] });
    }
    twinkles(b.position.x, b.position.y, r, 4);
    sfxGoldFade();
  }
}
// 镀金还剩多少「金」：1 = 满；褪到后半段分档变淡，最后 GOLD_BLINK 毫秒闪（越到后面闪得越快）。像素风，分档不平滑
function goldAlpha(b) {
  if (!b.gLeft) return 1;
  const life = GOLD_LIFE[b.tier], left = b.gLeft;
  if (left <= GOLD_BLINK) {
    const per = left < 600 ? 120 : 220;
    return Math.floor(left / per) % 2 ? 1 : 0.2;
  }
  const f = left / life;
  return f > 0.6 ? 1 : f > 0.45 ? 0.8 : 0.6;
}
function makeBall(tier, x, y, gold = false) {
  const t = TIERS[tier];
  const opt = { restitution: 0.15, friction: 0.35, frictionStatic: 0.6, frictionAir: 0.008, density: 0.0012, slop: 0.02 };
  const b = t.verts ? Bodies.fromVertices(x, y, [t.verts], opt) : Bodies.circle(x, y, t.r, opt);
  Body.setPosition(b, { x, y });
  b.tier = tier; b.gold = gold; b.born = performance.now(); b.pop = 0;
  b.px = x; b.py = y; b.pa = 0; b.lerp = false;   // 上一步的位置 / 角度（画面插值用，loop 里每步记）；lerp = false：还没走过一步，别插值
  b.gLeft = gold && tier < GOLD_LOCK ? GOLD_LIFE[tier] : 0;   // 镀金剩余时间（0 = 不限时：普通的，或已镀牢）
  Composite.add(world, b);
  return b;
}

// 能不能丢下一个。普通模式：固定冷却 M.cd。美梦模式：最短 M.cd，并且上一个球要已经离开出生点（和下一个不重叠）——
// 冷却太短时新球会和上一个叠在一起出生，同级的会当场合成、不同级的会被引擎弹飞。球越小让得越快，所以小球能近乎连丢。
function cdReady(now) {
  if (now < cdUntil) return false;
  if (!M.dream) return true;
  const b = lastDropped;
  if (!b || b.removed || now - lastDropAt > 700) return true;   // 上一个已经合没了 / 保底：别卡死
  const t = TIERS[cur], nr = Math.max(t.half, t.top) + 2;
  const x = Math.max(M.wl + t.half, Math.min(M.wr - t.half, aimX));
  if (b.bounds.max.x < x - nr || b.bounds.min.x > x + nr) return true;   // 左右错开就不会叠
  return b.bounds.min.y > M.dropY + nr;
}
function drop() {
  if (state !== 'play' || !canDrop || fishStop || thaw || shk || wat) return;
  const r = TIERS[cur].half;
  const x = Math.max(M.wl + r, Math.min(M.wr - r, aimX));
  const b = makeBall(cur, x, M.dropY, curGold);
  b.dropped = true;
  Body.setVelocity(b, { x: 0, y: M.vy });
  lastDropped = b; lastDropAt = performance.now();
  if (curGold) { sfxGoldDrop(); twinkles(x, M.dropY, 10, 6); } else sfxDrop();
  firstDrops++; chain = 0; b.cid = ++dropId;
  if (curElig) {   // 成就按「丢下」判：镀金小笼包丢进框里才算（g1 见到、g7 连着两个）；连着 GOLD_UNLUCKY 个普通的丢下去算脸黑 g8
    if (curGold) {
      if (plainRun >= GOLD_HARD - 1) unlock('g9');   // 吃满硬保底：前面 31 个普通的都丢完了，这个是第 32 个
      plainRun = 0; dropStreak++;
      unlock('g1');
      if (dropStreak >= 2) unlock('g7');
    } else {
      dropStreak = 0;
      if (++plainRun >= GOLD_UNLUCKY) unlock('g8');
    }
  }
  canDrop = false; cdUntil = performance.now() + M.cd;
  cur = next; curGold = nextGold; curElig = nextElig; next = randTier(); nextGold = rollGold(next); nextElig = rollElig; markSeen(next, nextGold);
  if (debugPick) { cur = debugPick.tier; curGold = debugPick.gold; curElig = false; }
  if (nextGold) sfxGoldAppear();
}

function onCollide(ev) {
  for (const p of ev.pairs) {
    const a = p.bodyA, b = p.bodyB;
    if (a.tier === undefined || a.tier !== b.tier || a.merging || b.merging) continue;
    a.merging = b.merging = true;
    queueMerge(a, b);
  }
}
const mergeQueue = [];
function queueMerge(a, b) { mergeQueue.push([a, b]); }
function doMerges() {
  while (mergeQueue.length) {
    const [a, b] = mergeQueue.shift();
    const tier = a.tier, golds = (a.gold ? 1 : 0) + (b.gold ? 1 : 0), gold = golds > 0;
    const x = (a.position.x + b.position.x) / 2, y = (a.position.y + b.position.y) / 2;
    if (tier === TIERS.length - 1) {          // 两条大肥鱼：先时停亮相，再一起消失，大加分
      // 已经在时停里（同一步有两对大肥鱼相撞）：排队，等这一对演完再演下一对。
      // 2026-11-21 修：原来直接覆盖 fishStop，前一对永远不会被删、merging 标记也不会清，两条鱼贴在一起再也不合（玩家反馈「卡死」）
      if (fishStop) fishQueue.push([a, b]);
      else startFishStop(a, b, x, y, golds);
      continue;
    }
    Composite.remove(world, a); Composite.remove(world, b);
    a.removed = b.removed = true;
    if (shk) shk.merges++; else if (shkTally) shkTally.n++;   // 摇的时候和摇完那一小会儿合成的都算「摇出来的」
    if (wat) { wat.merges++; if (gold && ++wat.golds >= 5) unlock('w1'); } else if (watTally) watTally.n++;   // 灌水同理；w1：一次灌水里镀金合成 5 次
    burst(x, y, TIERS[tier].color, TIERS[tier].r);
    const nt = tier + 1, last = nt === TIERS.length - 1;
    const nb = makeBall(nt, x, y, gold);
    nb.pop = 1;
    Body.setVelocity(nb, { x: (a.velocity.x + b.velocity.x) / 2, y: Math.min(0, (a.velocity.y + b.velocity.y) / 2) });
    // 镀金 ×2（合出大肥鱼 ×3）；两个都是镀金的（双金）再 ×1.5
    const pts = Math.round((nt + 1) * (nt + 2) / 2 * (gold ? (last ? 3 : 2) : 1) * (golds === 2 ? 1.5 : 1));
    addScore(pts);
    if (nt >= 5) unlock('c' + (nt + 1));
    if (gold) { unlock('g2'); if (golds === 2) unlock('g3'); if (nt === 5) unlock('g4'); if (last) unlock('g5'); }
    if (last && ++runFish >= 3) unlock('f4');
    if (last && !M.dream) grantShake(fishMakeGain(gold), toScrX(x), toScrY(y));   // 普通模式合出大肥鱼给金豆：普通 1 颗、镀金 1 或 2 颗
    if (a.cid === dropId || b.cid === dropId) { nb.cid = dropId; if (++chain >= 4) unlock('m1'); }   // 只数刚丢下那个引出的连锁
    markSeen(nt, gold);   // 图鉴解锁；艺术字只看本局第一次（first），与图鉴无关
    const first = nt > maxTier;
    if (first) maxTier = nt;
    fxMerge(x, y, nt, gold, pts, first);
    if (gold && nt === GOLD_LOCK) { nb.lockT = 0; locking.push(nb); }   // 镀牢：精灵内部的一次性动效（paintLock），走游戏时间
  }
}

// ---------------------------------------------------------------- 特效
// 镀牢（2026-11-10 重做，原来是头顶飘「镀牢了！」小标题）：合出镀金的第一个人物（惊喜小鲸）那一下，
// 动效全在精灵自己身上，像金子「凝固」：整只先白闪 → 白色从脚底往上退、退过的地方露出金色，交界一道亮金熔线 →
// 凝住那一下轮廓亮闪、金星围一圈、叮一声、精灵顿一下 → 两道粗反光飞快扫过。教程第三格用的是同一个 paintLock。
const LOCK_MS = 1000, LOCK_SET = 560;   // 全长 / 凝住的那一刻（毫秒）
let locking = [];                        // 正在放镀牢动效的球（lockT = 已放了多少毫秒）
function stepLocking() {
  if (!locking.length) return;
  const dt = slow > 0 ? STEP * 0.3 : STEP;   // 跟物理一样吃慢动作
  for (const b of locking) {
    const t0 = b.lockT; b.lockT += dt;
    if (t0 < LOCK_SET && b.lockT >= LOCK_SET && !b.removed) {
      const r = TIERS[b.tier].r, { x, y } = b.position;
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; twinkles(x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05, 4, 1); }
      shake = Math.max(shake, 4); sfxGoldLock();
    }
  }
  locking = locking.filter(b => !b.removed && b.lockT < LOCK_MS);
}
// 镀牢动效画进 cx（已经画好了镀金精灵 + 反光带，宽高 = 镀金精灵像素）；t = 放到第几毫秒
const lockEdgeCache = new Map();
function lockEdge(gs) {   // 精灵的一圈外轮廓（亮金白），凝住那一下闪
  if (lockEdgeCache.has(gs)) return lockEdgeCache.get(gs);
  const w = gs.width, h = gs.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(gs, 0, 0);
  const d = g.getImageData(0, 0, w, h).data, a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 100;
  const out = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a(x, y) && !(a(x - 1, y) && a(x + 1, y) && a(x, y - 1) && a(x, y + 1))) out.data.set([255, 251, 224, 255], (y * w + x) * 4);
  g.putImageData(out, 0, 0);
  lockEdgeCache.set(gs, c);
  return c;
}
function paintLock(cx, gs, t) {
  if (t >= LOCK_MS) return;
  const w = gs.width, h = gs.height;
  cx.globalCompositeOperation = 'source-atop';
  if (t < 90) { cx.fillStyle = 'rgba(255,255,255,.95)'; cx.fillRect(0, 0, w, h); }
  else if (t < LOCK_SET) {                                  // 白色从脚底往上退，交界是熔线（亮金白 + 熔金）
    const p = (t - 90) / (LOCK_SET - 90), front = Math.round(h + 2 - p * (h + 6));
    cx.fillStyle = 'rgba(255,253,236,.93)'; cx.fillRect(0, 0, w, Math.max(0, front - 2));
    cx.fillStyle = '#fff6c0'; cx.fillRect(0, front - 2, w, 2);
    cx.fillStyle = 'rgba(255,204,74,.9)'; cx.fillRect(0, front, w, 2);
  } else {
    if (t < LOCK_SET + 80) { cx.fillStyle = 'rgba(255,244,180,.4)'; cx.fillRect(0, 0, w, h); }   // 凝住：整只亮一下
    const p = (t - LOCK_SET - 40) / (LOCK_MS - LOCK_SET - 40);                                     // 两道粗反光飞快扫过
    for (const [off, bw] of [[0, 5], [0.3, 3]]) {
      const q = (p - off) / 0.7; if (q < 0 || q > 1) continue;
      const x0 = q * (w + h + 20) - h - 10;
      cx.fillStyle = 'rgba(255,255,245,.95)';
      for (let yy = 0; yy < h; yy++) cx.fillRect(Math.round(x0 + yy * 0.6), yy, bw, 1);
    }
  }
  cx.globalCompositeOperation = 'source-over';
  if (t >= LOCK_SET && t < LOCK_SET + 180 && Math.floor((t - LOCK_SET) / 45) % 2 === 0) cx.drawImage(lockEdge(gs), 0, 0);   // 轮廓闪两下
}
// 凝住那一下精灵「顿」一下（放大一点再回去）
const lockScale = (t) => t >= LOCK_SET && t < LOCK_SET + 140 ? 1 + 0.08 * (1 - (t - LOCK_SET) / 140) : 1;
// 合出 nt 级（first = 第一次合出这级，角色要报名字）
function fxMerge(x, y, nt, gold, pts, first) {
  const last = nt === TIERS.length - 1, r = TIERS[nt].r;
  if (last) return gold ? fxGoldFish(x, y, pts) : fxFish(x, y);
  if (gold) {
    const big = nt / (TIERS.length - 1);              // 0~1，越高级越夸张
    goldBurst(x, y, r, big);
    scoreGlow = 50;
    if (nt < GOLD_LOCK) scoreNum(x, y - r * 0.6, pts);              // 物品（最低一档）：3×5 点阵加法数字
    else floatText(x, y - r * 0.6, `+${pts}`, 24, '#ffe98a');       // 人物那几档保持原来的字体大字
    if (nt >= 4) { flash = 0.2 + big * 0.4; flashCol = FLASH_GOLD; slow = 100 + big * 220; }
    shake = Math.max(shake, 2 + big * 8);
    sfxGold(nt);
  } else sfxMerge(nt);
  if (first && nt >= 5) nameTitle(x, y - r, nt);    // 镀金也要报名字（位置会自动错开，不会被分数顶掉）
}
// 普通大肥鱼：明面上的主要目标，要有分量——蓝白版的大标题、冲击波、白光、短暂慢动作。
// 但比镀金大肥鱼收一档：没有金星雨、闪光淡、慢动作短、音效短
function fxFish(x, y) {
  goldBurst(x, y, TIERS[TIERS.length - 1].r, 0.8, BLUE);
  goldTitle(x, y + 40, TX.合成特效标题.大肥鱼, 'blue');
  flash = 0.5; flashCol = FLASH_BLUE; slow = 300; shake = 12; sfxFish();
}
function fxGoldFish(x, y, pts) {
  goldBurst(x, y, TIERS[TIERS.length - 1].r, 1);
  floatText(x, y, `+${pts}`, 28, '#ffe98a');
  goldTitle(x, y + 40, TX.合成特效标题.镀金大肥鱼);
  coinRain(70); slow = 700; flash = 0.9; flashCol = FLASH_GOLD; shake = 16; scoreGlow = 150; sfxGoldFish();
}
// 两条大肥鱼相消前的时停：物理和特效全冻住，其余压暗 + 集中线；两条鱼原地从接触点扩散变白、再扩散消失，让玩家看清是这两条撞上了；结束时才炸开
let fishStop = null;
const fishQueue = [];   // 时停期间又撞上的大肥鱼对（见 doMerges），endFishStop 里接着演
const FISH_STOP_MS = [560, 660, 760];
function startFishStop(a, b, x, y, golds) {
  // x/y/ax…是世界坐标（endFishStop 放特效用）；sx/sy/sax…是屏幕逻辑坐标（时停画面是画在屏幕上的，美梦模式里两者不同）
  fishStop = { a, b, x, y, golds, t: 0, dur: FISH_STOP_MS[golds], ax: a.position.x, ay: a.position.y, bx: b.position.x, by: b.position.y,
    sx: toScrX(x), sy: toScrY(y), sax: toScrX(a.position.x), say: toScrY(a.position.y), sbx: toScrX(b.position.x), sby: toScrY(b.position.y) };
  sfxStop(golds, FISH_STOP_MS[golds]);
}
function endFishStop() {
  const { a, b, x, y, golds } = fishStop; fishStop = null;
  Composite.remove(world, a); Composite.remove(world, b);
  burst(x, y, TIERS[a.tier].color, TIERS[a.tier].r);
  const pts = FISH_PTS[golds];
  addScore(pts);
  unlock(['f1', 'f2', 'f3'][golds]);
  grantShake(shakeFishGain(golds), toScrX(x), toScrY(y));   // 大肥鱼相消给金豆：美梦 1 / 随机 1–2 / 2；普通 2，带镀金 3
  flash = 1; // 白闪一下再交给下面的配色
  fxFishPair(x, y, golds, pts);
  const pal = golds ? SPARK : BLUE, r = TIERS[a.tier].r;
  effects.push({ kind: 'ring', x, y, r: r * 0.2, vr: 7, life: 30, max: 30, pal });   // 额外一圈大冲击波
  // 排队的下一对（时停里物理是冻住的，它们还在原地）；已经不在场上的跳过
  while (fishQueue.length) {
    const [c, d] = fishQueue.shift(), live = Composite.allBodies(world);
    if (!live.includes(c) || !live.includes(d)) continue;
    startFishStop(c, d, (c.position.x + d.position.x) / 2, (c.position.y + d.position.y) / 2, (c.gold ? 1 : 0) + (d.gold ? 1 : 0));
    break;
  }
}
// 时停音效：跟着画面两段走——变白（前 40%）、碎散（48%~88%）
function sfxStop(g, dur) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const T = audio.currentTime, D = dur / 1000, tW = T, tS = T + D * 0.48, lenS = D * 0.4;
    const up = g ? 1.26 : 1;   // 镀金整体高一个大三度，更亮
    // 冻结 + 碎晶：「啾」地一下音高急降（时间被按住），变白时细碎上行闪音，碎散时噼啪 + 叮叮
    sweep(1760 * up, 330, 0.14, 'square', 0.035, tW);
    for (let i = 0; i < 7; i++) tone(1047 * up * Math.pow(2, i / 6), 0.05, 'triangle', 0.018, tW + 0.08 + i * D * 0.045);
    noise(lenS * 0.8, 0.05, 4000, tS);
    for (let i = 0; i < 12; i++) tone(2093 * up * Math.pow(2, Math.floor(Math.random() * 12) / 12), 0.06, 'triangle', 0.03, tS + Math.random() * lenS);
  } catch (e) {}
}
function tone(f, len, type, vol, at, tail = 0) {
  const o = audio.createOscillator(), gn = audio.createGain();
  o.type = type; o.frequency.value = f;
  gn.gain.setValueAtTime(vol, at); gn.gain.exponentialRampToValueAtTime(0.0001, at + len + tail);
  o.connect(gn).connect(audio.destination); o.start(at); o.stop(at + len + tail + 0.02);
}
function sweep(f0, f1, len, type, vol, at) {
  const o = audio.createOscillator(), gn = audio.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + len);
  gn.gain.setValueAtTime(vol, at); gn.gain.exponentialRampToValueAtTime(0.0001, at + len * 1.2);
  o.connect(gn).connect(audio.destination); o.start(at); o.stop(at + len * 1.3);
}
let noiseBuf = null;
function noiseSrc() {
  if (!noiseBuf) {   // 8-bit 味的噪声：每 8 个采样换一次值（采样保持），比白噪声粗
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const d = noiseBuf.getChannelData(0); let v = 0;
    for (let i = 0; i < d.length; i++) { if (i % 8 === 0) v = Math.random() * 2 - 1; d[i] = v; }
  }
  const n = audio.createBufferSource(); n.buffer = noiseBuf; return n;
}
function noise(len, vol, hp, at) {   // 碎裂的噼啪：高通噪声，音量一顿一顿往下掉
  const n = noiseSrc(), f = audio.createBiquadFilter(), gn = audio.createGain();
  f.type = 'highpass'; f.frequency.value = hp;
  for (let i = 0; i < 6; i++) gn.gain.setValueAtTime(vol * (1 - i / 6) * (i % 2 ? 0.4 : 1), at + len * i / 6);
  gn.gain.setValueAtTime(0, at + len);
  n.connect(f).connect(gn).connect(audio.destination); n.start(at); n.stop(at + len + 0.02);
}
function drawFishStop(now) {
  const S = fishStop, k = Math.min(1, S.t / S.dur), gold = S.golds > 0, P = gold ? SPARK : BLUE;
  // 压暗（阶梯式）
  ctx.fillStyle = `rgba(16,20,36,${(Math.min(1, S.t / 120) * 0.6).toFixed(2)})`;
  ctx.fillRect(0, 0, W, H);
  // 集中线：每 3 帧换一组，从屏幕边缘指向撞击点
  const seed = Math.floor(S.t / 50);
  ctx.fillStyle = gold ? 'rgba(255,233,138,.55)' : 'rgba(220,239,255,.5)';
  for (let i = 0; i < 28; i++) {
    const a = (i / 28 + ((seed * 9301 + i * 49297) % 233) / 233 / 28) * Math.PI * 2;
    const r0 = 150 + ((seed * 31 + i * 17) % 60), r1 = 520;
    for (let d = r0; d < r1; d += 6) ctx.fillRect(Math.round((S.sx + Math.cos(a) * d) / 2) * 2, Math.round((S.sy + Math.sin(a) * d) / 2) * 2, 2, 2);
  }
  // 两条鱼原地不动，按 8×8 的粗像素块处理：从接触点按 BFS 一圈圈变白（前沿一圈用浅色），
  // 再一圈圈「碎」掉：前沿两圈先变成棋盘格镂空，然后每块化成一颗像素碎屑往外飘散
  if (!S.dist) fishStopPrep(S);
  const ease = (u) => Math.max(0, Math.min(1, u));
  const dW = S.maxD * ease(k / 0.4), dG = S.maxD * ease((k - 0.48) / 0.4);
  const C = FS_CELL, GW = S.gw, wc = gold ? '#fff6d0' : '#ffffff', edge = P[2];
  for (const c of S.cells) {
    const d = S.dist[c], x = (c % GW) * C, y = (c / GW | 0) * C;
    if (S.part[c]) { if (d > dW) ctx.drawImage(fishLayer, x, y, C, C, x, y, C, C); continue; }
    if (d < dG) {                        // 碎掉：只生成一次碎屑
      if (!S.gone[c]) { S.gone[c] = 1; fishShard(S, x + C / 2, y + C / 2, gold); }
      continue;
    }
    if (d > dW) { ctx.drawImage(fishLayer, x, y, C, C, x, y, C, C); continue; }
    ctx.fillStyle = d > dW - 1.5 && dW < S.maxD ? edge : wc;   // 扩散走完后前沿那圈也要变白
    if (dG > 0 && d < dG + 2) {          // 将要碎的两圈：棋盘格镂空（越靠前越稀）
      const sparse = d < dG + 1;
      for (let yy = 0; yy < C; yy += 2) for (let xx = 0; xx < C; xx += 2) {
        const on = ((xx + yy) / 2) % 2 === 0;
        if (sparse ? (on && (xx + yy) % 4 === 0) : on) ctx.fillRect(x + xx, y + yy, 2, 2);
      }
    } else ctx.fillRect(x, y, C, C);
  }
}
const FS_CELL = 8;
// 碎屑：一块 6×6 → 4 → 2 的像素方块，从接触点往外飞、略往上飘，走 effects（时停里单独推进）
function fishShard(S, x, y, gold) {
  const dx = x - S.sx, dy = y - S.sy, l = Math.hypot(dx, dy) || 1, sp = 0.6 + Math.random() * 1.4;
  effects.push({ kind: 'px', scr: true, x, y, vx: dx / l * sp + (Math.random() - .5) * .6, vy: dy / l * sp - 0.6 - Math.random() * .8,
    life: 26 + Math.random() * 18 | 0, max: 44, pal: gold ? SPARK : BLUE });
}
function stepShard(e) { e.x += e.vx; e.y += e.vy; e.vx *= 0.97; e.vy = e.vy * 0.97 - 0.02; }
function drawShard(e) {
  const sz = e.life > 28 ? 6 : e.life > 14 ? 4 : 2, c = e.life > 30 ? '#ffffff' : e.pal[e.life > 14 ? 1 : 2];
  ctx.fillStyle = c; ctx.fillRect(Math.round(e.x / 2) * 2 - sz / 2, Math.round(e.y / 2) * 2 - sz / 2, sz, sz);
}
// 时停开始时：把两条鱼画到离屏图层，切成 8×8 的块（块里一半以上有颜色才算），按块做 BFS 距离场。
// 先只在鱼身上走（顺着鱼形流），走不到的（两条鱼之间有缝）再用穿过空白的 BFS 补。8/4 邻接交替，前沿是像素八边形
function fishStopPrep(S) {
  fishLayer.width = W; fishLayer.height = H;
  const main = ctx; ctx = fishCtx;
  for (const [b, bx, by] of [[S.a, S.sax, S.say], [S.b, S.sbx, S.sby]]) drawBall(b.tier, bx, by, b.angle, M.cam, 1, b.gold, (b.id % 7) / 7);
  ctx = main;
  const C = FS_CELL, px = fishCtx.getImageData(0, 0, W, H).data;
  const GW = W / C, GH = H / C, N = GW * GH, solid = new Uint8Array(N), any = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    const x0 = (c % GW) * C, y0 = (c / GW | 0) * C; let n = 0;
    for (let yy = 0; yy < C; yy++) for (let xx = 0; xx < C; xx++) if (px[((y0 + yy) * W + x0 + xx) * 4 + 3] > 20) n++;
    solid[c] = n * 2 >= C * C; any[c] = n > 0;
  }
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = N4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  const bfs = (seeds, pass) => {
    const d = new Int32Array(N).fill(-1); let q = seeds.slice();
    for (const c of q) d[c] = 0;
    for (let lv = 0; q.length; lv++) {
      const nq = [], nb = lv % 2 ? N4 : N8;
      for (const c of q) {
        const x = c % GW, y = c / GW | 0;
        for (const [dx, dy] of nb) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue;
          const n = Y * GW + X; if (d[n] >= 0 || !pass(n)) continue;
          d[n] = lv + 1; nq.push(n);
        }
      }
      q = nq;
    }
    return d;
  };
  const cx = S.sx / C, cy = S.sy / C, dist2 = (c) => Math.hypot(c % GW + .5 - cx, (c / GW | 0) + .5 - cy);
  let best = 1e9;
  for (let c = 0; c < N; c++) if (solid[c]) best = Math.min(best, dist2(c));
  const seeds = [];
  for (let c = 0; c < N; c++) if (solid[c] && dist2(c) <= best + 1) seeds.push(c);
  const d1 = bfs(seeds, (n) => solid[n]), d2 = bfs(seeds, () => true);
  S.gw = GW; S.cells = []; S.dist = new Int32Array(N).fill(-1); S.gone = new Uint8Array(N); S.maxD = 1;
  for (let c = 0; c < N; c++) if (solid[c]) { S.dist[c] = d1[c] >= 0 ? d1[c] : d2[c]; S.maxD = Math.max(S.maxD, S.dist[c]); S.cells.push(c); }
  // 边上不到一半的块：原样画，按旁边最近的实块算距离；变白时直接舍掉（变白后轮廓是粗像素块）
  S.part = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (any[c] && !solid[c]) {
    const x = c % GW, y = c / GW | 0; let m = -1;
    for (const [dx, dy] of N8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue; const v = S.dist[Y * GW + X]; if (v >= 0 && (m < 0 || v < m)) m = v; }
    if (m >= 0) { S.dist[c] = m; S.part[c] = 1; S.cells.push(c); }
  }
  S.maxD += 1;
}
const fishLayer = document.createElement('canvas'), fishCtx = fishLayer.getContext('2d', { willReadFrequently: true });
// 两条大肥鱼相消：普通的也和镀金的同一套排版（大号分数 + 标题），只是蓝白配色、程度低一档
function fxFishPair(x, y, golds, pts) {
  const r = TIERS[TIERS.length - 1].r;
  shake = 14 + golds * 6;
  if (golds) {
    goldBurst(x, y, r, 1); coinRain(40 + golds * 40); slow = 600; flash = 0.85; flashCol = FLASH_GOLD; scoreGlow = 120;
    floatText(x, y, `+${pts}`, 28, '#ffe98a');
    goldTitle(x, y + 40, golds === 2 ? TX.合成特效标题.双金大肥鱼 : TX.合成特效标题.镀金双响);
    sfxGoldFish();
  } else {
    goldBurst(x, y, r, 0.9, BLUE); slow = 300; flash = 0.5; flashCol = FLASH_BLUE; scoreGlow = 60;
    floatText(x, y, `+${pts}`, 26, '#dcefff');
    goldTitle(x, y + 40, TX.合成特效标题.大肥鱼双响, 'blue');
    sfxFish();
  }
}
function burst(x, y, color, r) {
  const n = 8 + Math.floor(r / 6);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.5;
    effects.push({ kind: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 30 + Math.random() * 15, color });
  }
}
// 文字类特效（分数大字、金字标题、名字）都是屏幕上的东西：美梦模式里创建时就把世界坐标换成屏幕坐标，字不跟着缩小
function floatText(x, y, text, size = 16, color = '#ffe08a') {
  x = toScrX(x) + (Math.random() - .5) * 16; y = toScrY(y);
  if (size > 16) y = freeY(x, y, text.length * size * 0.62, size * 1.3);
  effects.push({ kind: 't', scr: true, x, y, text, size, color, life: size > 16 ? 90 : 70 });
}
// 金物品合成的加分数字（2026-11-11 用户要求）：最低那一档（原来 18 号字体）换成 3×5 点阵 + 深描边，
// 和教程「分数翻倍」那排同款字形；人物（24）和大肥鱼（26/28）那几档不动。
// 2026-11-11 用户嫌大，最后定在「一格 4 画面像素 + 半格描边 2 像素」：数字高 5 格 ≈ 13.3 逻辑像素，
// 描边正好是字格的一半（严格等比），格子和描边都是整数画面像素，所以不糊。美梦模式 GRID=3，按比例换成 8 / 4。
// 数字串按「画面像素」画一次缓存，1:1 贴，放大后不糊。
const scoreNumCache = new Map();
function scoreNumCanvas(str) {
  const key = str + '|' + GRID;
  if (scoreNumCache.has(key)) return scoreNumCache.get(key);
  const cell = Math.round(GRID * 8 / 3), o = cell / 2, pad = Math.ceil(o), w = (str.length * 4 - 1) * cell + pad * 2, h = 5 * cell + pad * 2;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const stamp = (col, ox, oy) => {
    g.fillStyle = col;
    let x = pad + ox;
    for (const ch of str) {
      const d = ch === '+' ? 10 : +ch;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (TUT_DIG[d * 5 + j][i] === '#') g.fillRect(x + i * cell, pad + oy + j * cell, cell, cell);
      x += 4 * cell;
    }
  };
  for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]]) stamp('#5a3a14', dx, dy);
  stamp('#ffe98a', 0, 0);
  scoreNumCache.set(key, c);
  return c;
}
function scoreNum(x, y, pts) {
  x = toScrX(x); y = toScrY(y);
  const c = scoreNumCanvas('+' + pts);
  y = freeY(x, y, c.width / GRID, c.height / GRID);
  effects.push({ kind: 'num', scr: true, x, y, str: '+' + pts, life: 80, max: 80 });
}
function drawScoreNum(e) {
  const c = scoreNumCanvas(e.str), m = ctx.getTransform();   // 保留抖动那层平移，只把缩放换成 1（按画面像素贴）
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, m.e, m.f);
  ctx.drawImage(c, Math.round(e.x * GRID - c.width / 2), Math.round(e.y * GRID - c.height / 2));
  ctx.restore();
}
// 镀金特效：金色星星（十字像素，会闪）、像素冲击波、金星雨
const SPARK = ['#fff8d6', '#ffe98a', '#f2c94c', '#cf9a2c'];
const BLUE = ['#ffffff', '#dcefff', '#9fd0ff', '#5aa6e8'];          // 普通大肥鱼用的蓝白星
// 美梦的配色一律跟入口绶带走（夜空）：深蓝底 + 金缝线 + 金星金月。之前摇一摇这些地方用的是淡紫，2026-11-10 统一换掉
const NIGHT = { o: '#120e2a', f: '#2c2858', h: '#4a4590', s: '#1f1b44', gold: '#ffd25e', pale: '#fff1c8' };
const DREAM_BEST_COL = '#aeb8ff';   // 美梦局内「最高」后面的分数颜色（淡蓝紫，绶带夜空色的亮版）
const NIGHT_STARS = ['#ffffff', '#fff1c8', '#ffd25e', '#c88a1e'];   // 美梦的金星（摇一摇、飞图标、美梦标题、入口绶带）
const FLASH_GOLD = '255,240,180', FLASH_BLUE = '225,242,255';
let flashCol = FLASH_GOLD;
function twinkles(x, y, r, n, pal, scr = false) {   // scr：x/y/r 已经是屏幕坐标
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * r;
    effects.push({ kind: 's', scr, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: -0.2, g: 0, life: 18 + Math.random() * 20, big: Math.random() < 0.3, pal });
  }
}
function goldBurst(x, y, r, big, pal) {
  const n = 18 + Math.floor(r / 2) + Math.floor(big * 30);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * (2.5 + big * 3);
    effects.push({ kind: 's', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, g: 0.08, drag: 0.96, life: 40 + Math.random() * 30, big: Math.random() < 0.35, pal });
  }
  effects.push({ kind: 'ring', x, y, r: r * 0.6, vr: 3 + big * 3, life: 22, max: 22, pal });
  if (big > 0.5) effects.push({ kind: 'ring', x, y, r: r * 0.3, vr: 2 + big * 2, life: 30, max: 30, pal });
}
// 金字标题：弹出（先大一号、发白光）→ 流光扫过 → 周围冒星 → 缓缓上浮，最后闪烁消失
const titleCache = new Map();
const TITLE_STYLE = {
  gold: { px: 13, fill: '#ffe98a', fill2: '#f0a428', hi: '#fffbe0', outline: '#4a2e14' },
  goldW: { px: 13, fill: '#ffffff', fill2: '#fff4b0', outline: '#fff4b0' },
  blue: { px: 13, fill: '#ffffff', fill2: '#9fd0ff', hi: '#ffffff', outline: '#24324a' },
  blueW: { px: 13, fill: '#ffffff', fill2: '#e8f4ff', outline: '#e8f4ff' },
  dream: { px: 13, fill: '#fff1c8', fill2: '#ffd25e', hi: '#ffffff', outline: '#120e2a' },   // 夜空：金字 + 深蓝描边（和绶带同色）
  dreamW: { px: 13, fill: '#ffffff', fill2: '#fff1c8', outline: '#fff1c8' },
};
function titleCanvas(text, white, theme = 'gold') {
  const st = theme + (white ? 'W' : ''), key = text + '|' + st;
  if (!titleCache.has(key)) titleCache.set(key, PX.text(text, TITLE_STYLE[st]));
  return titleCache.get(key);
}
function goldTitle(x, y, text, theme = 'gold') {
  const c = titleCanvas(text, false, theme);
  x = toScrX(x); y = toScrY(y);
  x = Math.max(WALL_L + c.width + 4, Math.min(WALL_R - c.width - 4, x));   // 别出框
  y = freeY(x, y, c.width * 2, c.height * 2);
  effects.push({ kind: 'title', scr: true, x, y, text, theme, life: 130, max: 130 });
}
// 大字/标题防重叠：新出现的和场上还没消失的撞上了，就往上挪到它头顶
function textBox(e) {
  if (e.kind === 't') return { w: e.text.length * e.size * 0.62, h: e.size * 1.3 };
  if (e.kind === 'num') { const c = scoreNumCanvas(e.str); return { w: c.width / GRID, h: c.height / GRID }; }   // 画布是画面像素，换回逻辑像素
  if (e.kind === 'title') { const c = titleCanvas(e.text, false, e.theme); return { w: c.width * 2, h: c.height * 2 }; }
  if (e.kind === 'name') { const c = nameCanvas(e.tier); return { w: c.width * NAME_U, h: c.height * NAME_U }; }
  return null;
}
function freeY(x, y, w, h) {
  for (let tries = 0; tries < 8; tries++) {
    let moved = false;
    for (const e of effects) {
      const b = textBox(e);
      if (!b || e.life < 10) continue;
      if (Math.abs(x - e.x) < (w + b.w) / 2 && Math.abs(y - e.y) < (h + b.h) / 2) { y = e.y - (h + b.h) / 2 - 6; moved = true; }
    }
    if (!moved) break;
  }
  return Math.max(h / 2 + 4, y);
}
function drawTitle(e) {
  const age = e.max - e.life;
  if (e.life < 24 && Math.floor(e.life / 3) % 2) return;              // 退场闪烁
  const white = age < 5;
  const c = titleCanvas(e.text, white, e.theme);
  const u = age < 4 ? 3 : age < 7 ? 2.5 : 2;                          // 弹出：大 → 回弹 → 正常
  const w = c.width, h = c.height;
  glintCv.width = w; glintCv.height = h;
  glintCtx.drawImage(c, 0, 0);
  if (!white) {                                                         // 流光：斜带从左扫到右，循环
    const p = ((age - 6) % 50) / 50 * (w + h + 20) - h - 10;
    glintCtx.globalCompositeOperation = 'source-atop';
    glintCtx.fillStyle = 'rgba(255,255,255,.9)';
    for (let yy = 0; yy < h; yy++) glintCtx.fillRect(Math.round(p + yy * 0.5), yy, 2, 1);
    glintCtx.globalCompositeOperation = 'source-over';
  }
  const dw = w * u, dh = h * u;
  ctx.drawImage(glintCv, snapF(e.x - dw / 2), snapF(e.y - dh / 2), dw, dh);
}
// 首次合出角色（小螃蟹起）时的名字标题：开始页同款简称，奶白→角色主题色，深色描边。
// 刻意比「镀金大肥鱼」收敛：字小一号、弹出幅度小且不发白光、流光只扫一次、不冒星星、停留更短
// 名字画在每格 2 个画面像素（4/3 逻辑像素）的网格上：11px 一格 2 逻辑像素时「惊」「鲸」这类字笔画挤不下会粘连
const NAME_U = 2 / FINE;
const snapF = (v) => Math.round(v * FINE) / FINE;   // 对齐到画面像素，放大后的点阵才不会错半格
const nameCache = new Map();
function nameCanvas(tier) {
  if (!nameCache.has(tier)) nameCache.set(tier, PX.text(SHORT[tier], { px: 16.5, bold: false, thr: 80, fill: '#fff6e0', fill2: TIERS[tier].color, outline: '#4a2e20' }));
  return nameCache.get(tier);
}
function nameTitle(x, y, tier) {
  const c = nameCanvas(tier);
  x = toScrX(x); y = toScrY(y);
  x = Math.max(WALL_L + c.width * NAME_U / 2 + 4, Math.min(WALL_R - c.width * NAME_U / 2 - 4, x));
  y = freeY(x, y, c.width * NAME_U, c.height * NAME_U);
  effects.push({ kind: 'name', scr: true, x, y, tier, life: 80, max: 80 });
}
function drawName(e) {
  const age = e.max - e.life;
  if (e.life < 16 && Math.floor(e.life / 3) % 2) return;              // 退场闪烁
  const c = nameCanvas(e.tier), w = c.width, h = c.height;
  const u = (age < 4 ? 1.25 : 1) * NAME_U;                                         // 轻轻弹一下
  glintCv.width = w; glintCv.height = h;
  glintCtx.drawImage(c, 0, 0);
  if (age >= 4 && age < 24) {                                           // 流光只扫一次
    const p = (age - 4) / 20 * (w + h + 10) - h - 5;
    glintCtx.globalCompositeOperation = 'source-atop';
    glintCtx.fillStyle = 'rgba(255,255,255,.75)';
    for (let yy = 0; yy < h; yy++) glintCtx.fillRect(Math.round(p + yy * 0.5), yy, 2, 1);
    glintCtx.globalCompositeOperation = 'source-over';
  }
  const dw = w * u, dh = h * u;
  ctx.drawImage(glintCv, snapF(e.x - dw / 2), snapF(e.y - dh / 2), dw, dh);
}
// 成就横条：顶部滑下来，停 2 秒收回。排场比报名字还小；正在时停/慢动作或标题还没飘走时先排队（最多等 3 秒）
let toast = null, achWait = 0;
const T_IN = 8, T_HOLD = 120, T_OUT = 8;
const sfxAch = () => beep([988, 1319], 0.06, 'triangle', 0.04);
function stepToast() {
  if (!toast) {
    if (!achQueue.length) return;
    if (achWait < 0) { achWait++; return; }   // 两条之间空几帧
    const busy = slow > 0 || effects.some(e => (e.kind === 'title' || e.kind === 'name') && e.life > 10);
    if (busy && achWait < 180) { achWait++; return; }
    toast = { a: achQueue.shift(), t: 0 }; achWait = 0; sfxAch();
  }
  if (++toast.t > T_IN + T_HOLD + T_OUT) { toast = null; achWait = -12; }
}
function toastText(str, px, color, bold = false) {   // 奶白底上的小字：无描边，画在细网格上（同 putText）
  const key = `toast|${str}|${px}|${color}|${bold}`;
  if (!textCache.has(key)) textCache.set(key, PX.text(str, { px: px * FINE, bold, fill: color, outline: null, shadow: false, ow: Math.round(FINE), thr: 70 }));
  return textCache.get(key);
}
const toastIcon = document.createElement('canvas');
const even = v => Math.ceil(v / 2) * 2;
// 横条版式（2026-11-09 用户从 A 三行 / B 两行 / C 标题带 / D 金徽章 里挑了 C）：
// 顶上一条金色标题带「获得成就」，下面左头像、右名字 + 说明。宽度固定 172（给顶栏左右的分数、图标键让位），说明太长就换行、高度自适应
const TOAST_W = 172, TOAST_X0 = 44, TOAST_PAD = 8, TOAST_STRIP = 14, TOAST_MINH = 40;   // 宽、文字起点（头像牌 4–36 之后）、右留白、标题带高、正文最小高
const TOAST_TW = TOAST_W - TOAST_X0 - TOAST_PAD;                                           // 文字可用宽度
const toastWide = (str, px, bold) => toastText(str, px, '#000', bold).width / FINE;
// 按宽度折行：一行放得下就不折；两行时找最均匀的断点（不让一行只剩两三个字），不把标点留在行首
function toastWrap(str, px, bold) {
  if (toastWide(str, px, bold) <= TOAST_TW) return [str];
  const chars = [...str], lines = [];
  while (chars.length) {
    let rest = chars.join('');
    if (toastWide(rest, px, bold) <= TOAST_TW) { lines.push(rest); break; }
    let best = 1, bestW = Infinity;
    for (let i = 1; i < chars.length; i++) {
      const w1 = toastWide(chars.slice(0, i).join(''), px, bold);
      if (w1 > TOAST_TW) break;
      if ('，。、！？；：）」』…'.includes(chars[i])) continue;
      const w2 = toastWide(chars.slice(i).join(''), px, bold), m = w2 <= TOAST_TW ? Math.max(w1, w2) : TOAST_TW * 2 - w1;
      if (m < bestW) { bestW = m; best = i; }
    }
    lines.push(chars.splice(0, best).join(''));
  }
  return lines;
}
const toastLayouts = new Map();
function toastLayout(a) {
  if (toastLayouts.has(a.id)) return toastLayouts.get(a.id);
  const lab = toastText(TX.成就.横幅, 10, '#fff6e0');
  const nm = toastWrap(a.name, 13, true).map(s => toastText(s, 13, '#4a2e20', true)), ds = toastWrap(a.desc, 10, false).map(s => toastText(s, 10, '#8a6a52'));
  const NH = 15, DH = 12, tot = nm.length * NH + ds.length * DH;
  const body = Math.max(TOAST_MINH, even(tot + 10)), top = (body - tot) / 2, items = [[lab, (TOAST_W - lab.width / FINE) / 2, TOAST_STRIP / 2]];
  nm.forEach((c, i) => items.push([c, TOAST_X0, TOAST_STRIP + top + NH * (i + 0.5)]));
  ds.forEach((c, i) => items.push([c, TOAST_X0, TOAST_STRIP + top + NH * nm.length + DH * (i + 0.5)]));
  const L = { w: TOAST_W, h: TOAST_STRIP + body, iy: TOAST_STRIP + even((body - 32) / 2), items };
  toastLayouts.set(a.id, L);
  return L;
}
// 画一块横条（x、y 左上角；t：出场帧数，用来在刚落下时闪星；st：金星数组）
function drawToastBox(a, L, x, y, t, st) {
  const c = ctx, w = L.w, h = L.h;
  // 像素框：四角缺一格，底边加厚当投影（和界面 .px 同款）
  c.fillStyle = '#4a2e20';
  c.fillRect(x, y - 2, w, 2); c.fillRect(x, y + h, w, 6);
  c.fillRect(x - 2, y, 2, h); c.fillRect(x + w, y, 2, h);
  c.fillStyle = '#fff6e0'; c.fillRect(x, y, w, h);
  c.fillStyle = '#ead9b6'; c.fillRect(x, y + h - 2, w, 2);
  c.fillStyle = '#c48a2c'; c.fillRect(x, y, w, TOAST_STRIP);              // 顶上金色标题带
  c.fillStyle = '#e9b850'; c.fillRect(x, y, w, 2);
  c.fillStyle = '#9a6a1c'; c.fillRect(x, y + TOAST_STRIP - 2, w, 2);
  // 图标底：和成就页「已达成」小牌子同色（浅金底、金边），镀金头像在上面才看得清
  const ix = x + 4, iy = y + L.iy;
  c.fillStyle = '#c48a2c'; c.fillRect(ix, iy, 32, 32);
  c.fillStyle = '#fff0bf'; c.fillRect(ix + 2, iy + 2, 28, 28);
  c.fillStyle = '#ffe3a0'; c.fillRect(ix + 2, iy + 20, 28, 10);
  if (paintAchIcon(toastIcon, a.id, true)) {           // 头像 1:1（和成就格里一样大），镀金的照样扫反光带
    const iw = toastIcon.width / FINE, ih = toastIcon.height / FINE;   // 一个头像像素 = 画布细网格的一格（1/FINE 逻辑像素），同成就页
    c.drawImage(toastIcon, snapF(ix + 16 - iw / 2), snapF(iy + 16 - ih / 2), iw, ih);
    if (ACH_ICONS[a.id].s.g) {                            // 镀金头像冒金星（同图鉴：概率同一个公式，奶白底上用深一档的金）
      const r = Math.max(iw, ih) / 2, tk = fxTick;   // 冒星和推进按「走了几步」算（不按画了几帧，高刷屏上才不会快一倍）
      for (let n = 0; n < tk; n++) if (Math.random() < sparkRate(a.id, r)) { const an = Math.random() * Math.PI * 2, dd = Math.random() * r * 0.9; st.push(newSpark(a.id, Math.cos(an) * dd, Math.sin(an) * dd)); }
      for (let i = st.length - 1; i >= 0; i--) {
        const s = st[i]; s.y -= 0.2 * tk; if ((s.life -= tk) <= 0) { st.splice(i, 1); continue; }
        const col = sparkColor(s), sx = Math.round((ix + 16 + s.x) / 2) * 2, sy = Math.round((iy + 16 + s.y) / 2) * 2;
        c.fillStyle = col; c.fillRect(sx, sy, 2, 2);
        if (s.big && s.life % 8 < 6) { c.fillRect(sx - 2, sy, 6, 2); c.fillRect(sx, sy - 2, 2, 6); c.fillStyle = '#fff4b0'; c.fillRect(sx, sy, 2, 2); }
      }
    }
  }
  for (const [img, tx, ty] of L.items) c.drawImage(img, snapF(x + tx), snapF(y + ty - img.height / FINE / 2), img.width / FINE, img.height / FINE);
  if (t > T_IN && t < T_IN + 30) {                     // 刚落下时图标上闪两颗星
    c.fillStyle = (t >> 2) % 2 ? '#fff' : '#ffe98a';
    c.fillRect(ix + 28, iy, 2, 2); c.fillRect(ix + 2, iy + 26, 2, 2);
  }
}
function drawToast() {
  if (!toast || state === 'over') return;
  const t = toast.t, a = toast.a, L = toastLayout(a);
  const k = t < T_IN ? t / T_IN : t > T_IN + T_HOLD ? 1 - (t - T_IN - T_HOLD) / T_OUT : 1;
  const x = Math.round((W - L.w) / 4) * 2, y = Math.round((-L.h - 12 + (L.h + 18) * k) / 2) * 2;
  drawToastBox(a, L, x, y, t, toast.stars || (toast.stars = []));
}
function coinRain(n) {
  for (let i = 0; i < n; i++) effects.push({ kind: 's', scr: true, x: WALL_L + Math.random() * (WALL_R - WALL_L), y: -10 - Math.random() * 220, vx: (Math.random() - .5) * .4, vy: 1.5 + Math.random() * 2, g: 0.03, life: 170, big: Math.random() < 0.4 });
}
function drawSpark(e) {
  // 十字星：2×2 像素一格对齐到美术网格；闪烁时换颜色
  const P = e.pal || SPARK, c = P[(Math.floor(e.life / 3) + (e.big ? 1 : 0)) % P.length];
  const x = Math.round(e.x / 2) * 2, y = Math.round(e.y / 2) * 2;
  ctx.fillStyle = c; ctx.fillRect(x, y, 2, 2);
  if (e.big && e.life % 8 < 6) { ctx.fillRect(x - 2, y, 6, 2); ctx.fillRect(x, y - 2, 2, 6); ctx.fillStyle = '#fff'; ctx.fillRect(x, y, 2, 2); }
}
function drawRing(e) {
  const k = 1 - e.life / e.max, n = Math.max(16, Math.floor(e.r / 2));
  const P = e.pal || SPARK;
  ctx.fillStyle = k < 0.5 ? P[0] : P[2];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    ctx.fillRect(Math.round((e.x + Math.cos(a) * e.r) / 2) * 2, Math.round((e.y + Math.sin(a) * e.r) / 2) * 2, 2, 2);
  }
}

// ---------------------------------------------------------------- 输入
// 画布在窗口里的位置：只在窗口变了时重新量。原来每个 pointermove 都量一次（手机触摸一秒上百次），页面有改动没排版时还会逼浏览器当场重排
addEventListener('resize', () => { cvRect = null; });
const cvBox = () => cvRect || (cvRect = cv.getBoundingClientRect());
function toLocal(e) {   // 指针位置 → 世界 x（美梦模式里屏幕上的 x 要放大回世界坐标）
  const r = cvBox();
  return fromScrX((e.clientX - r.left) / r.width * W);
}
let pointerDown = false;
// 美梦模式长按连丢：按下之后一直「几乎不动」满 HOLD_MS 才开始自动连丢；这一按里只要挪动过（超过 HOLD_MOVE），
// 就当是在拖着瞄准，之后再停住也不会自动连丢，松手照常丢一个（用户要求：动过再停下不要自动放）。
// 开始连丢后手指可以继续左右拖，边拖边丢；松手不再多丢一个。普通模式没有这个功能。
const HOLD_MS = 450, HOLD_MOVE = 10;   // 毫秒；离按下的位置超过这么多 CSS 像素就算「动过」
let holdStart = 0, holdX = 0, holdY = 0, holdMoved = false, autoFire = false;
// 指针 → 屏幕逻辑坐标
const toScrPt = (e) => { const r = cvBox(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
// 摇一摇时：在画布任何地方按下都算抓住把手。鼠标、触屏都是绝对位置——把手 = 指针相对摇杆中心（屏幕正中）的位置，
// 超出圈就贴着圈边；指针在哪钮就在哪，最直观（用户要求；摇杆就在屏幕正中，手指挡住也分得清方向）
function stickDown(e) { shk.drag = { pid: e.pointerId }; shk.started = true; stickMove(e); }
function stickMove(e) {
  const p = toScrPt(e);
  let dx = p.x - STICK_X, dy = p.y - STICK_Y;
  const l = Math.hypot(dx, dy);
  if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
  shk.kx = dx; shk.ky = dy;
}
cv.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  if (shk) { stickDown(e); return; }
  pointerDown = true; autoFire = false; holdStart = performance.now(); holdX = e.clientX; holdY = e.clientY; holdMoved = false; aimX = toLocal(e);
});
addEventListener('pointermove', (e) => {
  if (shk) { if (shk.drag && shk.drag.pid === e.pointerId) stickMove(e); return; }
  if (state === 'play' && (pointerDown || e.pointerType === 'mouse')) aimX = toLocal(e);
  if (pointerDown && !autoFire && Math.hypot(e.clientX - holdX, e.clientY - holdY) > HOLD_MOVE) holdMoved = true;
});
addEventListener('pointerup', (e) => {
  if (shk && shk.drag && shk.drag.pid === e.pointerId) { shk.drag = null; return; }   // 松手：把手弹回中间，容器跟着弹回（最后再晃一下）
  if (!pointerDown) return;
  pointerDown = false; aimX = toLocal(e);
  if (autoFire) autoFire = false; else drop();
});
addEventListener('pointercancel', () => { pointerDown = false; autoFire = false; if (shk) shk.drag = null; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());   // 手机长按会弹菜单/取消指针，不要
// 2026-11-14 用户要求：非调试模式的键盘操作全部删掉（只剩 ?showcase 的调试快捷键）

// ---------------------------------------------------------------- 绘制
// 镀金精灵：tools/gild.py 预生成（sprites/gNN.png，四周各大 1 像素，画的时候往外扩 TEX）。
// 前 5 个食物局部深金，小螃蟹/角色/大肥鱼薄金。反光带每帧在精灵像素网格上画。
const glintCv = document.createElement('canvas'), glintCtx = glintCv.getContext('2d');   // 标题 / 名字的流光用
function goldSprite(tier) { return ok(gSprites[tier]) ? gSprites[tier] : null; }
// 反光带：一条每行往右错 0.6 像素的斜带（主带 bw 宽，隔 2 像素再跟 1 像素的淡线），每 2.2 秒从左外扫到右外。
// 2026-11-14 提速（画出来的像素和原来逐行 fillRect 的一样）：
//   · 带子预先画成小图：第 yy 行在 round(p + yy × 0.6)，p 的整数部分只是整体平移，小数部分只在 0.1 / 0.3 / 0.5 / 0.7 / 0.9
//     这几个点上才改变台阶的样子，所以按小数部分分 6 档各存一张，贴的时候一次 drawImage（原来每个镀金球每帧 2h 次 fillRect）；
//   · 画布尺寸没变就只清空、不重设（重设尺寸 = 重新分配）；
//   · 游戏里的镀金球不再逐帧现合成，改查预先合成好的图集（glintAtlas）。
const GLINT_ONE = [[0, 3, .85, .4]], GLINT_TWIN = [[0, 3, .85, .4], [.12, 2, .6, .3]];   // [相位差, 主带宽, 主带透明度, 淡线透明度]
const GLINT_FRAC = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95];   // 6 档小数部分的代表值
const glintBands = new Map();
function glintBand(h, B, frac) {
  const q = frac < 0.1 ? 0 : frac < 0.3 ? 1 : frac < 0.5 ? 2 : frac < 0.7 ? 3 : frac < 0.9 ? 4 : 5, bw = B[1], key = h * 100 + bw * 10 + q;
  let c = glintBands.get(key);
  if (!c) {
    const f = GLINT_FRAC[q];
    c = document.createElement('canvas'); c.width = Math.round(f + (h - 1) * 0.6) + bw + 3; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = `rgba(255,255,240,${B[2]})`;
    for (let yy = 0; yy < h; yy++) g.fillRect(Math.round(f + yy * 0.6), yy, bw, 1);
    g.fillStyle = `rgba(255,255,240,${B[3]})`;
    for (let yy = 0; yy < h; yy++) g.fillRect(Math.round(f + yy * 0.6) + bw + 2, yy, 1, 1);
    glintBands.set(key, c);
  }
  return c;
}
const glintP = (w, h, phase, off) => ((performance.now() / 2200 + phase + off) % 1) * (w + h + 40) - h - 20;   // 带子第 0 行的 x
// 把镀金精灵连同反光带画进 cv（宽高 = 精灵像素）。游戏里、图鉴、成就头像、教程共用
// twin：「出彩」（g9 既非又欧专属）——主反光带后面再跟一道细一点、淡一点的
function paintGlint(cv, cx, gs, phase, twin = false) {
  const w = gs.width, h = gs.height;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } else cx.clearRect(0, 0, w, h);
  cx.globalCompositeOperation = 'source-over';
  cx.drawImage(gs, 0, 0);
  for (const B of twin ? GLINT_TWIN : GLINT_ONE) {
    const p = glintP(w, h, phase, B[0]), P = Math.floor(p), band = glintBand(h, B, p - P);
    if (P + band.width <= 0 || P >= w) continue;
    cx.globalCompositeOperation = 'source-atop';
    cx.drawImage(band, P, 0);
  }
  cx.globalCompositeOperation = 'source-over';
}
const glintLayers = [];
function glintLayer(tier) {   // 每级一张现合成用的小画布（现在只有镀牢动效那 1 秒用）
  let L = glintLayers[tier];
  if (!L) { const c = document.createElement('canvas'); L = glintLayers[tier] = { cv: c, cx: c.getContext('2d') }; }
  return L;
}
// 游戏里的镀金球（2026-11-14）：「镀金精灵 + 反光带」在带子扫到每个位置时的样子预先合成好，排成一张图集
// （每级一张，第一次用到那一级的镀金时做；最后一格是没有带子的原样）。画的时候按带子这一刻的位置取一格：一次 drawImage，源图不变。
// 原来每个镀金球每帧都在小画布上现合成再贴——小画布每帧都在变，每贴一次浏览器就得重新上传一次贴图，
// 美梦里几十个镀金球时这是绘制里最贵的一项。图集里带子按整数像素走（台阶的样子固定，和逐帧现算的最多差 1 像素）；
// 图鉴、成就头像、教程仍然逐帧现算（paintGlint）。占内存：11 级全做出来约 380 万像素（15MB），按需才做。
const glintAtlases = [];
function glintAtlas(tier, gs) {
  let A = glintAtlases[tier];
  if (A && A.gs === gs) return A;
  const w = gs.width, h = gs.height, band = glintBand(h, GLINT_ONE[0], 0.5);
  const P0 = 1 - band.width, n = w - P0;   // 带子第 0 行的 x 在 P0 … w - 1 时和精灵有交集，共 n 格；第 n 格 = 没带子
  const cw = w + 1, ch = h + 1, cols = Math.max(1, Math.ceil(Math.sqrt((n + 1) * ch / cw)));   // 格子之间空 1 像素；排成差不多正方
  const c = document.createElement('canvas'); c.width = cols * cw; c.height = Math.ceil((n + 1) / cols) * ch;
  const g = c.getContext('2d');
  for (let i = 0; i <= n; i++) {
    const x = (i % cols) * cw, y = ((i / cols) | 0) * ch;
    g.drawImage(gs, x, y);
    if (i === n) break;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.globalCompositeOperation = 'source-atop'; g.drawImage(band, x + P0 + i, y);
    g.restore();
  }
  return glintAtlases[tier] = { gs, src: c, w, h, cw, ch, cols, n, P0 };
}
// 把镀金球（带这一刻的反光带）贴到 ctx 当前的变换下；dx, dy, dw, dh = 镀金精灵要占的位置
function drawGlint(tier, gs, phase, dx, dy, dw, dh) {
  const A = glintAtlas(tier, gs);
  let i = Math.floor(glintP(A.w, A.h, phase, 0)) - A.P0;
  if (i < 0 || i > A.n) i = A.n;
  ctx.drawImage(A.src, (i % A.cols) * A.cw, ((i / A.cols) | 0) * A.ch, A.w, A.h, dx, dy, dw, dh);
}
// 成就头像：图集里每个头像一到两层（n 普通层、g 镀金层，同尺寸叠着画）。镀金层和游戏里一样扫反光带（glint = false 时不扫，没达成的灰头像用）
// 头像像素 1:1 画进 cv（cv 的宽高 = 头像像素），放大交给 CSS / drawImage
const ACH_ICONS = window.ACH_ICONS || {};
// 「出彩」：压轴隐藏成就 g9 既非又欧专属（用户 2026-11-09 从 5 个方案里挑的）——反光扫两道，金星换彩虹色、冒得多一倍
const ACH_RAINBOW = new Set(['g9']), RAINBOW = ['#ff6b6b', '#ffb347', '#ffe156', '#7be07b', '#6bc6ff', '#b38bff'];
const sparkRate = (id, r) => (0.04 + r / 3000) * (ACH_RAINBOW.has(id) ? 2 : 1);
const newSpark = (id, x, y) => ({ x, y, life: 18 + Math.random() * 20, big: Math.random() < 0.3, rb: ACH_RAINBOW.has(id), col: Math.floor(Math.random() * RAINBOW.length) });
const sparkColor = s => s.rb ? RAINBOW[(s.col + Math.floor(s.life / 4)) % RAINBOW.length] : DEX_SPARK[(Math.floor(s.life / 3) + (s.big ? 1 : 0)) % DEX_SPARK.length];
const achGoldCv = new Map(), achGlint = document.createElement('canvas'), achGlintCtx = achGlint.getContext('2d');
function achGoldLayer(id, sz) {   // 镀金层单独切成一张小画布，给 paintGlint 当源图
  const key = id + sz;
  if (!achGoldCv.has(key)) {
    const m = ACH_ICONS[id][sz], c = document.createElement('canvas');
    c.width = m.w; c.height = m.h;
    c.getContext('2d').drawImage(achAtlas, m.g[0], m.g[1], m.w, m.h, 0, 0, m.w, m.h);
    achGoldCv.set(key, c);
  }
  return achGoldCv.get(key);
}
// sz：'s' 小档（最长边 22，成就格、横条）/ 'b' 大档（最长边 44，详情）。两档是各自从原图像素化的，都 1:1 显示
function paintAchIcon(cv, id, glint, phase = 0, sz = 's') {
  const m = ACH_ICONS[id] && ACH_ICONS[id][sz];
  if (!m || !ok(achAtlas)) return false;
  if (cv.width !== m.w || cv.height !== m.h) { cv.width = m.w; cv.height = m.h; }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, m.w, m.h);
  if (m.n) g.drawImage(achAtlas, m.n[0], m.n[1], m.w, m.h, 0, 0, m.w, m.h);
  if (m.g) {
    if (glint) { paintGlint(achGlint, achGlintCtx, achGoldLayer(id, sz), phase, ACH_RAINBOW.has(id)); g.drawImage(achGlint, 0, 0); }
    else g.drawImage(achAtlas, m.g[0], m.g[1], m.w, m.h, 0, 0, m.w, m.h);
  }
  return true;
}
function drawBall(tier, x, y, angle, s = 1, alpha = 1, gold = false, phase = 0, gA = 1, lk) {
  const t = TIERS[tier], r = t.r * s, sp = sprites[tier];
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(angle);
  const gs = gold && goldSprite(tier);
  if (gs && t.verts) {
    if (lk !== undefined) s *= lockScale(lk);
    ctx.scale(s, s);
    if (gA < 1) { if (ok(sp)) ctx.drawImage(sp, t.ox, t.oy, t.w, t.h); ctx.globalAlpha = alpha * gA; }   // 正在褪色：底下垫普通的，镀金层变淡
    // 反光：一条 3 像素宽的斜带扫过，每 2.2 秒一次（查图集，见 glintAtlas）
    if (lk === undefined) drawGlint(tier, gs, phase, t.ox - TEX, t.oy - TEX, t.w + TEX * 2, t.h + TEX * 2);
    else {   // 刚镀牢：精灵内部的一次性动效，这 1 秒现合成
      const G = glintLayer(tier);
      paintGlint(G.cv, G.cx, gs, phase);
      paintLock(G.cx, gs, lk);
      ctx.drawImage(G.cv, t.ox - TEX, t.oy - TEX, t.w + TEX * 2, t.h + TEX * 2);
    }
  } else if (ok(sp) && t.verts) {
    ctx.scale(s, s);
    ctx.drawImage(sp, t.ox, t.oy, t.w, t.h);
  } else {                                 // 素材还没做好时的占位
    ctx.fillStyle = t.color; ctx.strokeStyle = '#4a2e20'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.rotate(-angle); ctx.fillStyle = '#4a2e20';
    ctx.font = `bold ${Math.max(8, Math.min(16, r / 2.4))}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.name, 0, 0);
  }
  ctx.restore();
}

// 画布上的字也走像素字：大字一个像素 = 2 逻辑像素（和背景一样），小字 = 1 逻辑像素（中文太小会糊）
const textCache = new Map();
function drawText(text, x, y, size, color = '#fff6e0', align = 'center') {
  const u = size >= 20 ? 2 : 1 / fine();   // 小字走物理像素网格，见 putText
  const key = `${text}|${size}|${color}|${u}`;
  let c = textCache.get(key);
  if (!c) {
    c = PX.text(text, { px: size / u, fill: color, bold: u === 2 || size >= 14, thr: u < 1 ? 70 : 100, ow: u < 1 ? Math.round(1 / u) : 1 });
    if (textCache.size > 400) textCache.delete(textCache.keys().next().value);   // LRU：整体清空会让下一帧把整屏文字重新光栅化，正好卡在出分那一下
    textCache.set(key, c);
  }
  const w = c.width * u, h = c.height * u;
  const snap = snapF;   // 对齐到画面像素
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.drawImage(c, snap(x0), snap(y - h / 2), w, h);
  return w;
}

// ---- 摇一摇的画面
// 一个干净的像素摇杆，配色同入口绶带（夜空）：深蓝半透明底盘 + 一圈金缝线 + 一圈粗的金色计时环
// （顺时针一格格褪掉，最后 1 秒变红闪）+ 奶白圆钮（深蓝描边、下半淡金）。
// 底盘正上方一个大号倒计时数字（4、3、2、1），每过一秒「嗒」一声，最后一秒声音更高。
// 还没碰时圆钮自己左右晃、两边的箭头一闪一闪，下面写「按住拖动，摇晃容器」。
let stickFade = 0, stickLast = null;
const px2 = (v) => Math.round(v / 2) * 2;
function pixDisc(cx, cy, r, col) {   // 2 像素一格的实心圆
  ctx.fillStyle = col; cx = px2(cx); cy = px2(cy);
  for (let y = -r; y < r; y += 2) { const hw = px2(Math.sqrt(Math.max(0, r * r - (y + 1) * (y + 1)))); ctx.fillRect(cx - hw, cy + y, hw * 2, 2); }
}
// 2 像素一格的粗圆环（r0..r1），col(f) 按「从正上方顺时针转过的比例 f（0..1）」给颜色，返回 null 不画
function pixArc(cx, cy, r0, r1, col) {
  cx = px2(cx); cy = px2(cy);
  for (let y = -r1; y < r1; y += 2) for (let x = -r1; x < r1; x += 2) {
    const d = Math.hypot(x + 1, y + 1);
    if (d < r0 || d >= r1) continue;
    const c = col((Math.atan2(x + 1, -(y + 1)) / (Math.PI * 2) + 1) % 1);
    if (c) { ctx.fillStyle = c; ctx.fillRect(cx + x, cy + y, 2, 2); }
  }
}
const STICK_TIMER = { r0: STICK_R + 8, r1: STICK_R + 16 };   // 计时环：4 格粗
const STICK_STARS = [[-26, -20, 0], [24, -26, 1.1], [30, 16, 2.2], [-20, 26, 0.6], [4, 34, 1.7]];   // 底盘里的小金星：偏移、闪烁相位
function drawStick(now) {
  const S = shk;
  if (S) { stickLast = { t: S.t, started: S.started, drag: !!S.drag }; stickFade = 1; }
  else stickFade = Math.max(0, stickFade - 0.08);
  const a = S ? Math.min(1, (now - S.born) / 160) : stickFade;
  if (a <= 0) return;
  const L = stickLast;
  // 圆钮的显示位置：跟着把手偏移（松手后弹回），还没碰时自己左右晃当示范
  let kx = S ? S.kx : 0, ky = S ? S.ky : 0;
  if (S && !S.started) kx = Math.sin(now / 180) * STICK_R * 0.55;
  if (S) { S.mx += (kx - S.mx) * 0.6; S.my += (ky - S.my) * 0.6; kx = S.mx; ky = S.my; }
  const cx = STICK_X, cy = STICK_Y, { r0, r1 } = STICK_TIMER;
  const left = Math.max(0, 1 - L.t / SHAKE_MS), hurry = L.started && L.t > SHAKE_MS - 1000, blink = hurry && Math.floor(now / 110) % 2 === 0;
  ctx.save(); ctx.globalAlpha = a;
  // 底盘 + 计时环（环外一圈深色描边，在什么背景上都看得清）
  pixArc(cx, cy, r0 - 2, r1 + 2, () => 'rgba(18,14,42,.8)');                 // 计时环的深蓝底（环外环内各 1 格描边）
  pixDisc(cx, cy, r0 - 2, 'rgba(44,40,88,.42)');                             // 底盘里面淡一点，看得见后面的堆
  pixArc(cx, cy, r0 - 8, r0 - 6, (f) => Math.floor(f * 64) % 2 ? 'rgba(255,210,94,.8)' : null);   // 金缝线（虚线，同绶带）
  for (const [sx, sy, ph] of STICK_STARS) {                                  // 底盘里几颗一闪一闪的小金星（夜空）
    const tw = (now / 420 + ph) % 3;
    if (tw > 2) continue;
    ctx.fillStyle = tw < 1 ? NIGHT.gold : NIGHT.pale;
    const X = px2(cx + sx), Y = px2(cy + sy);
    ctx.fillRect(X, Y, 2, 2);
    if (tw > 0.6 && tw < 1.4) { ctx.fillRect(X - 2, Y, 6, 2); ctx.fillRect(X, Y - 2, 2, 6); }
  }
  const on = blink ? NIGHT.pale : hurry ? '#ff7a6b' : NIGHT.gold, head = hurry ? '#ffd0c8' : '#ffffff';
  pixArc(cx, cy, r0, r1, (f) => f < left - 0.025 ? on : f < left ? head : 'rgba(255,241,200,.14)');
  // 倒计时大字（底盘正上方；按下之前也显示总秒数）
  const sec = Math.ceil((SHAKE_MS - L.t) / 1000 - 1e-6);
  if (S && S.started && S.sec !== undefined && sec < S.sec && sec > 0) beep([sec === 1 ? 1568 : 1175], 0.035, 'square', 0.035);   // 每过一秒嗒一声
  if (S) S.sec = sec;
  const ty = cy - r1 - 22;
  pixDisc(cx, ty, 18, 'rgba(18,14,42,.72)');
  drawText(String(Math.max(1, sec)), cx, ty, 28, hurry ? (blink ? NIGHT.pale : '#ff7a6b') : NIGHT.pale);
  // 还没碰：两边的箭头一闪一闪（往左右甩）
  if (!L.started && Math.floor(now / 300) % 2) {
    ctx.fillStyle = NIGHT.gold;
    for (const d of [-1, 1]) {
      const ax = px2(cx + d * (r1 + 10));
      for (let j = 0; j < 3; j++) { const h = 10 - j * 4; ctx.fillRect(ax + d * j * 2 - 1, px2(cy - h / 2), 2, h); }
    }
  }
  // 圆钮：投影 + 深蓝描边 + 奶白钮面（下半淡金）+ 左上高光，按住时大一号；钮面上一对深蓝小箭头
  const R = L.drag ? 18 : 16, bx = cx + kx, by = cy + ky;
  pixDisc(bx, by + 4, R, 'rgba(18,14,42,.5)');
  pixDisc(bx, by, R, NIGHT.o);
  pixDisc(bx, by, R - 2, '#f0cf7a');
  pixDisc(bx, by - 2, R - 4, '#fff6e0');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(px2(bx - R / 2) - 2, px2(by - R / 2), 4, 2); ctx.fillRect(px2(bx - R / 2) - 2, px2(by - R / 2) + 2, 2, 2);
  ctx.fillStyle = NIGHT.f;
  for (const d of [-1, 1]) { const ax = px2(bx + d * 6); ctx.fillRect(ax, px2(by) - 4, 2, 6); ctx.fillRect(ax + d * 2, px2(by) - 2, 2, 2); }
  if (S && !S.started) { ctx.fillStyle = 'rgba(18,14,42,.78)'; ctx.fillRect(cx - 62, cy + r1 + 10, 124, 20); drawText(TX.美梦.摇杆提示, cx, cy + r1 + 20, 12, NIGHT.pale); }
  ctx.restore();
}
// 容器在动时，运动方向的反侧拖几道白色速度线
function drawBoxMotion() {
  const vx = box.vx * M.cam, vy = box.vy * M.cam, sp = Math.hypot(vx, vy);
  if (sp < 1.2) return;
  const L = toScrX(M.wl), R = toScrX(M.wr), T = toScrY(M.top), F = toScrY(M.floor);
  ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, sp / 8).toFixed(2)})`;
  const len = Math.min(24, sp * 4) | 0;
  if (Math.abs(vx) > 1) {
    const x = vx > 0 ? L - 14 : R + 14, d = vx > 0 ? -1 : 1;
    for (let i = 0; i < 5; i++) { const y = px2(T + (F - T) * (i + 0.5) / 5); ctx.fillRect(px2(d > 0 ? x : x - len), y, px2(len), 2); }
  }
  if (Math.abs(vy) > 1) {
    const y = vy > 0 ? T - 8 : F + 16;
    for (let i = 0; i < 6; i++) { const x = px2(L + (R - L) * (i + 0.5) / 6); ctx.fillRect(x, px2(vy > 0 ? y - len : y), 2, px2(len)); }
  }
}
// 灌水（世界层，画在球上面）：半透明的水分三档平涂（越深越暗，不用渐变）、水面一行亮线带像素波浪、墙内侧的水渍，最上面是木盖。
// 坐标都对齐到 2 屏幕逻辑像素（= 2k 世界像素），和木框一样是方块像素
function drawWater(now) {
  const k = M.k, L = M.wl, R = M.wr, T = M.top, F = M.floor, q = (v) => Math.round(v / (2 * k)) * 2 * k;
  const S = wat;
  if (S && S.level > 0) {
    // 涨满时从盖子底边起画（取整不能留一像素的缝）
    const wy = S.level >= 0.999 ? T : q(F - (F - T) * S.level), h = F - wy, d1 = q(wy + (F - T) * 0.22), d2 = q(wy + (F - T) * 0.55);
    // 颜色取背景海面（2026-11-14 用户嫌原来的浅蓝太淡）：海平线 #456053 → 近海 #194b4d → #0c3e43 → 深处 #002830
    ctx.fillStyle = 'rgba(25,75,77,.5)'; ctx.fillRect(L, wy, R - L, h);
    if (d1 < F) { ctx.fillStyle = 'rgba(12,62,67,.18)'; ctx.fillRect(L, d1, R - L, F - d1); }
    if (d2 < F) { ctx.fillStyle = 'rgba(0,40,48,.18)'; ctx.fillRect(L, d2, R - L, F - d2); }
    // 水面：一行亮线，按 4 像素一段上下错 0/±2 像素（波浪往右走）；下面一行深一点的边。
    // 涨满（水面碰到盖子底）就不画水面：波浪往下错的那几段会在盖子底下露出一道道空隙（2026-11-14 用户要求看起来完全填满）
    const seg = 4 * k, ph = now / 240;
    if (wy > T + 2 * k) for (let x = L; x < R; x += seg) {
      const off = Math.round(Math.sin((x - L) / (22 * k) + ph) * 1.2) * 2 * k, w = Math.min(seg, R - x);
      ctx.fillStyle = 'rgba(176,214,196,.9)'; ctx.fillRect(x, wy + off - 2 * k, w, 2 * k);
      ctx.fillStyle = 'rgba(69,96,83,.75)'; ctx.fillRect(x, wy + off, w, 2 * k);
    }
  }
  if (watStain > 0 && !(S && S.level > 0)) {   // 退完水：墙内侧一道深色水渍，1 秒内分两档淡掉
    ctx.fillStyle = `rgba(12,62,67,${watStain > WATER_STAIN / 2 ? 0.45 : 0.22})`;
    ctx.fillRect(L, T, 2 * k, F - T); ctx.fillRect(R - 2 * k, T, 2 * k, F - T);
  }
  if (S) {   // 木盖：盖在容器口上，两头搭在木框上；滑进来 / 抽出去（往右）
    const ox = q(lidSlide(S.t) * (R - L + 40 * k));
    if (ox < R - L + 40 * k) drawLid(L - 10 * k + ox, R + 10 * k + ox, T, k);
  }
}
function drawLid(x0, x1, T, k) {
  const top = T - 10 * k, w = x1 - x0;
  ctx.fillStyle = '#4a2e20'; ctx.fillRect(x0, top, w, 10 * k);                        // 深棕描边
  ctx.fillStyle = '#8a5a36'; ctx.fillRect(x0 + 2 * k, top + 2 * k, w - 4 * k, 6 * k);  // 木板
  ctx.fillStyle = '#b07a4c'; ctx.fillRect(x0 + 2 * k, top + 2 * k, w - 4 * k, 2 * k);  // 上沿亮边
  ctx.fillStyle = '#4a2e20';
  for (let x = x0 + 48 * k; x < x1 - 20 * k; x += 56 * k) ctx.fillRect(Math.round(x / (2 * k)) * 2 * k, top + 2 * k, 2 * k, 6 * k);   // 木板接缝
  ctx.fillStyle = '#c99a66'; ctx.fillRect(x0 + 10 * k, top + 4 * k, 2 * k, 2 * k); ctx.fillRect(x1 - 12 * k, top + 4 * k, 2 * k, 2 * k);   // 两颗钉子
}
function drawBubble(e) {   // 水里的气泡：小的 2×2 淡点，大的 6×6 空心小方圈（缺角），最后一段变淡
  const x = px2(e.x), y = px2(e.y), a = e.life < 20 ? 0.35 : 0.6;
  ctx.fillStyle = `rgba(191,224,212,${a})`;
  if (!e.big) { ctx.fillRect(x, y, 2, 2); return; }
  ctx.fillRect(x - 2, y - 4, 4, 2); ctx.fillRect(x - 2, y + 2, 4, 2); ctx.fillRect(x - 4, y - 2, 2, 4); ctx.fillRect(x + 2, y - 2, 2, 4);
  ctx.fillStyle = `rgba(255,255,255,${a + 0.2})`; ctx.fillRect(x - 2, y - 2, 2, 2);   // 左上一点高光
}
function drawDust(e) {
  const sz = e.life > 14 ? 4 : 2;
  ctx.fillStyle = e.life > 8 ? '#fff6e0' : '#e2cfa8';
  ctx.fillRect(px2(e.x) - sz / 2, px2(e.y) - sz / 2, sz, sz);
}
// 攒到的能量豆：n 颗金豆（和九宫格里的一样，放大画，带深棕描边）一颗跟一颗沿弧线飞到自己要亮的那一格。
// 为了显眼：出发时大一号、身后拖一串由亮到暗的金色残影、外面一圈一闪一闪的光晕、十字星芒；落进格子时炸一圈小金星（bpop）。
// 都画在顶栏上面那层画布（fxTop）上，不然飞到键那儿会钻到键底下（顶栏是盖在游戏画布上的网页元素）
let beanCv = null;
const FLY_LAG = 0.07;   // 后一颗比前一颗晚出发多少（占整段的比例）
// 第 i 颗豆的进度（0..1）：一颗跟一颗，最后一颗正好在 life 用完时到
function flyK(e, i, life = e.life) { const k = 1 - life / e.max; return Math.min(1, Math.max(0, (k - i * FLY_LAG) / (1 - (e.n - 1) * FLY_LAG))); }
function flyPos(e, i, kk) {
  const qq = kk * kk * (3 - 2 * kk), [tx, ty] = beanAt(e.slot + i), gap = 17;
  return [e.x0 + (tx - e.x0) * qq + (i - (e.n - 1) / 2) * gap * (1 - qq), e.y0 + (ty - e.y0) * qq - Math.sin(kk * Math.PI) * 40];
}
function drawFly(e, now) {
  for (let i = 0; i < e.n; i++) {
    const kk = flyK(e, i);
    if (kk >= 1) continue;   // 已经落进格子了（格子里那颗会白闪）
    drawFlyBean(kk, (u) => flyPos(e, i, u), now, kk < 0.12 ? 4 : kk > 0.8 ? 2 : 3);
  }
}
// 一颗飞行中的金豆：pos(u) 给出进度 u 时的位置（残影沿来路往回取）。s = 放大倍数
function drawFlyBean(kk, pos, now, s) {
  if (!beanCv) beanCv = PX.bitmap(['.###.', '#hho#', '#hod#', '#odd#', '.###.'], { '#': '#4a2e20', ...BEAN_PAL });
  const pulse = Math.floor(now / 70) % 2, w = beanCv.width * s;
  // 残影：沿来路往回取几个点，由亮到暗、由大到小
  for (let j = 6; j >= 1; j--) {
    const kb = Math.max(0, kk - j * 0.035);
    if (kb <= 0) continue;
    const [bx, by] = pos(kb), sz = j < 3 ? 4 : 2;
    ctx.fillStyle = NIGHT_STARS[Math.min(3, j >> 1)];
    ctx.fillRect(px2(bx) - sz / 2, px2(by) - sz / 2, sz, sz);
  }
  const [x, y] = pos(kk);
  pixDisc(x, y, w / 2 + 6 + pulse * 2, 'rgba(255,241,168,.45)');   // 光晕（一闪一闪）
  pixDisc(x, y, w / 2 + 2, 'rgba(255,255,255,.55)');
  // 十字星芒：横竖两道白光，长短交替
  const L = px2(w / 2 + (pulse ? 10 : 6));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px2(x) - L, px2(y) - 1, L * 2, 2); ctx.fillRect(px2(x) - 1, px2(y) - L, 2, L * 2);
  ctx.drawImage(beanCv, px2(x - w / 2), px2(y - w / 2), w, w);
}
// 用掉的金豆：从九宫格那一格先白闪一下，往上一跳再沿弧线落向目标（灌水 = 容器底，摇一摇 = 屏幕正中的摇杆），落地炸一圈金星
function drawSpend(e, now) {
  const kk = 1 - e.life / e.max;
  if (kk < 0.08) { const [x, y] = [e.x0, e.y0]; ctx.fillStyle = '#ffffff'; ctx.fillRect(px2(x) - 3, px2(y) - 3, 6, 6); }
  const pos = (u) => {
    const q = u * u;   // 先慢后快（往下落）
    return [e.x0 + (e.x1 - e.x0) * smooth(u), e.y0 + (e.y1 - e.y0) * q - Math.sin(Math.min(1, u * 1.6) * Math.PI) * 26];
  };
  drawFlyBean(kk, pos, now, kk < 0.15 ? 2 : kk > 0.85 ? 4 : 3);
}
// 金豆落进格子：一圈 8 颗小金星往外炸，中间白闪
function drawBeanPop(e) {
  const t = 1 - e.life / e.max, r = 3 + t * 12;
  if (t < 0.3) pixDisc(e.x, e.y, 8, 'rgba(255,255,255,.8)');
  ctx.fillStyle = NIGHT_STARS[Math.min(3, Math.floor(t * 4))];
  for (let a = 0; a < 8; a++) {
    const ang = a / 8 * Math.PI * 2, sz = t < 0.5 && a % 2 === 0 ? 4 : 2;
    ctx.fillRect(px2(e.x + Math.cos(ang) * r) - sz / 2, px2(e.y + Math.sin(ang) * r) - sz / 2, sz, sz);
  }
}
// 世界层 → 画布的变换（缩放 wA、平移 wE / wF，已乘上 GRID）：render 开头算一次，画普通精灵时直接拿它拼矩阵
let wA = 1, wE = 0, wF = 0;
const spReady = TIERS.map(() => false);   // 各级精灵图载好没有（每个球每帧都问一次图片状态太啰嗦，载完就不再问）
let spAll = false, bgOK = false;
let shakeX = 0, shakeY = 0, shakeSeq = 0;   // 震屏这一步的偏移；shakeSeq：算到第几步了
let fxTick = 0, fxSeq = 0;                  // 从上次画到现在走了几步（成就横条上的金星按它推进）
function render(now) {
  const g = GRID, k = M.k, lk = lerpK;
  if (!spAll) { spAll = true; for (let i = 0; i < sprites.length; i++) if (!(spReady[i] = ok(sprites[i]))) spAll = false; }
  fxTick = stepSeq - fxSeq; fxSeq = stepSeq;
  // 震屏：偏移和衰减按「步」算（每走一步换一次偏移、衰减一次），不按画了几帧算——原来写在这里每帧衰减，
  // 120Hz 的屏上震动只有 60Hz 屏的一半长。背景不跟着震（2026-11-13，背景在 #backdrop 上）
  if (shakeSeq !== stepSeq) {
    if (shake > 0) {
      shakeX = (Math.random() - .5) * shake; shakeY = (Math.random() - .5) * shake;
      for (let n = stepSeq - shakeSeq; n > 0 && shake > 0; n--) { shake *= 0.85; if (shake < .5) shake = 0; }
    } else shakeX = shakeY = 0;
    shakeSeq = stepSeq;
  }
  // 画布是透明底：背景（整张高背景）在后面的 #backdrop 上，这里只清空，不再每帧整幅贴一遍背景。背景图没载到时垫原来的天蓝。
  // 清空和下面「容器的半透明底」并成一步（oneFill）：用 copy 合成画那块底，画布其余地方顺带清成透明，
  // 省掉「先整幅清空、再在 160 多万像素上做一遍半透明混合」
  if (!bgOK) bgOK = ok(bg);
  const oneFill = COPY_OK && bgOK;
  ctx.setTransform(g, 0, 0, g, 0, 0);
  ctx.globalAlpha = 1;
  if (!oneFill) { ctx.clearRect(0, 0, W, H); if (!bgOK) { ctx.fillStyle = '#9fc7e6'; ctx.fillRect(0, 0, W, H); } }
  // ---- 世界层（容器、球、瞄准线）：套摄像机缩放（世界 → 屏幕：×cam，容器左下角对齐），摇一摇时整个容器再平移（对齐到 1 逻辑像素）
  if (k !== 1) {
    const bx = lk < 1 ? boxPX + (box.x - boxPX) * lk : box.x, by = lk < 1 ? boxPY + (box.y - boxPY) * lk : box.y;
    wA = g * M.cam;
    wE = g * (shakeX + WALL_L * (1 - M.cam) + Math.round(bx / 2) * 2 * M.cam);
    wF = g * (shakeY + FLOOR * (1 - M.cam) + Math.round(by / 2) * 2 * M.cam);
  } else { wA = g; wE = g * shakeX; wF = g * shakeY; }
  ctx.setTransform(wA, 0, 0, wA, wE, wF);
  const L = M.wl, R = M.wr, T = M.top, F = M.floor, hh = F - T;   // k = 一个屏幕像素占几个世界像素：木框、虚线粗细都乘它，屏幕上看起来和普通模式一样
  // 容器：半透明奶油底 + 木框
  ctx.fillStyle = 'rgba(255,246,224,0.55)';
  if (oneFill) { ctx.globalCompositeOperation = 'copy'; ctx.fillRect(L, T, R - L, hh); ctx.globalCompositeOperation = 'source-over'; }
  else ctx.fillRect(L, T, R - L, hh);
  ctx.fillStyle = '#8a5a36'; ctx.fillRect(L - 8 * k, T, 8 * k, hh + 8 * k);
  ctx.fillRect(R, T, 8 * k, hh + 8 * k); ctx.fillRect(L - 8 * k, F, R - L + 16 * k, 10 * k);
  ctx.fillStyle = '#4a2e20';
  ctx.fillRect(L - 10 * k, T, 2 * k, hh + 12 * k); ctx.fillRect(R + 8 * k, T, 2 * k, hh + 12 * k);
  ctx.fillRect(L - 10 * k, F + 10 * k, R - L + 20 * k, 2 * k);
  ctx.fillStyle = '#b07a4c'; ctx.fillRect(L - 6 * k, T, 2 * k, hh + 6 * k); ctx.fillRect(R + 2 * k, T, 2 * k, hh + 6 * k);

  // 红线（有东西靠近时闪）
  const near = state === 'play' && world && now > shakeGraceUntil && Composite.allBodies(world).some(b => b.tier !== undefined && !isFresh(b, now) && b.bounds.min.y < M.danger + 40 * k);
  if (near || state === 'over') {
    ctx.fillStyle = (Math.floor(now / 200) % 2) ? '#e24a3b' : 'rgba(226,74,59,.35)';
    for (let x = L; x < R; x += 12 * k) ctx.fillRect(x, M.danger, 8 * k, 3 * k);
  }

  // 球：位置在上一步和这一步之间按 lk 插值（见 loop）。普通精灵（绝大多数）直接设好矩阵贴一张图，
  // 不走 save / translate / rotate / scale / restore 那一串；镀金的、素材没载到的走 drawBall
  if (world) {
    const bodies = Composite.allBodies(world), fs = fishStop;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], tier = b.tier;
      if (tier === undefined || fs && (b === fs.a || b === fs.b)) continue;
      let x = b.position.x, y = b.position.y, a = b.angle, s = 1;
      if (lk < 1 && b.lerp) { x = b.px + (x - b.px) * lk; y = b.py + (y - b.py) * lk; a = b.pa + (a - b.pa) * lk; }
      if (b.pop > 0) { const p = Math.max(0, b.pop - 0.08); s = 1 + Math.sin((1 - p) * Math.PI) * 0.12 - p * 0.25; }   // 合成出来弹一下（b.pop 每步衰减，见 stepVisual）
      const t = TIERS[tier];
      if (!b.gold && t.verts && spReady[tier]) {
        const c = Math.cos(a) * wA * s, sn = Math.sin(a) * wA * s;
        ctx.setTransform(c, sn, -sn, c, wA * x + wE, wA * y + wF);
        ctx.drawImage(sprites[tier], t.ox, t.oy, t.w, t.h);
      } else {
        ctx.setTransform(wA, 0, 0, wA, wE, wF);
        drawBall(tier, x, y, a, s, 1, b.gold, (b.id % 7) / 7, b.gold ? goldAlpha(b) : 1, b.lockT < LOCK_MS ? b.lockT : undefined);
      }
    }
    ctx.setTransform(wA, 0, 0, wA, wE, wF);
  }

  if (wat || watStain > 0) drawWater(now);

  // 待放下的 + 瞄准线（教程时停时也画：幕布的圆孔就开在它上面）
  if (state === 'play' || state === 'tut') {
    const r = TIERS[cur].half;
    const x = Math.max(L + r, Math.min(R - r, aimX));
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    if (!shk && !wat) for (let y = M.dropY + TIERS[cur].r * 0.7 + 4; y < F; y += 10 * k) ctx.fillRect(Math.round(x) - k, y, 2 * k, 5 * k);
    drawBall(cur, x, M.dropY, 0, 1, (M.dream ? !thaw && !shk : canDrop) ? 1 : 0.45, curGold);
  }

  // ---- 屏幕层（特效、HUD）：只带震屏的偏移
  ctx.setTransform(g, 0, 0, g, g * shakeX, g * shakeY);
  if (M.dream && (shk || box.vx || box.vy)) drawBoxMotion();
  if (fishStop) drawFishStop(now);
  // 特效（世界里的粒子/火花/冲击波按世界坐标存，画的时候换成屏幕位置，大小不缩；文字类和时停碎屑本来就是屏幕坐标，见 scr）。
  // 换坐标是临时改这个特效自己的 x / y / r、画完改回去（原来每个特效每帧复制一份对象，满屏金星时全是垃圾回收）
  const conv = k !== 1;
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i], kd = e.kind, cvt = conv && !e.scr;
    let ox = 0, oy = 0, or = 0;
    if (cvt) { ox = e.x; oy = e.y; e.x = toScrX(ox); e.y = toScrY(oy); if (e.r !== undefined) { or = e.r; e.r = or * M.cam; } }
    if (kd === 's') drawSpark(e);
    else if (kd === 'p') { ctx.fillStyle = e.color; ctx.fillRect(Math.round(e.x), Math.round(e.y), 4, 4); ctx.fillStyle = '#4a2e20'; ctx.fillRect(Math.round(e.x) + 4, Math.round(e.y) + 2, 1, 2); }
    else if (kd === 'ring') drawRing(e);
    else if (kd === 'px') drawShard(e);
    else if (kd === 'dust') drawDust(e);
    else if (kd === 'fly' || kd === 'bpop' || kd === 'spend') {}   // 飞的金豆、落格的星爆画在顶层画布上（render 最后）
    else if (kd === 'bub') drawBubble(e);
    else if (kd === 'title') drawTitle(e);
    else if (kd === 'name') drawName(e);
    else if (kd === 'num') drawScoreNum(e);
    else drawText(e.text, e.x, e.y, e.size || 16, e.color || '#ffe08a');
    if (cvt) { e.x = ox; e.y = oy; if (e.r !== undefined) e.r = or; }
  }
  // 镀金合成的闪光：整屏淡金色，几帧内退掉（阶梯式，不是平滑渐变）
  if (flash > 0) {
    ctx.fillStyle = `rgba(${flashCol},${(Math.ceil(flash * 4) / 4 * 0.55).toFixed(2)})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (shk || stickFade > 0) drawStick(now);
  // HUD
  if (state !== 'title' && DEBUG) {
    drawText(fmt(TX.调试.分数, { n: score }), 16, 100, 13, scoreGlow > 0 && Math.floor(scoreGlow / 4) % 2 === 0 ? '#ffe98a' : '#fff6e0', 'left');
  } else if (state !== 'title') {
    drawText(String(score), 16, 26, 28, scoreGlow > 0 && Math.floor(scoreGlow / 4) % 2 === 0 ? '#ffe98a' : '#fff6e0', 'left');
    const hi = Math.max(M.dream ? dreamBest : best, score);
    if (!M.dream) drawText(fmt(TX.局内.最高分, { n: hi }), 16, 54, 13, '#ffe08a', 'left');
    else {   // 美梦：字和普通局一样写「最高」，分数染成淡蓝紫（取绶带的夜空色调，亮到在天空背景上看得清），一眼和普通最高分区分开
      const [pre, post = ''] = TX.美梦.局内最高分.split('{n}');
      let x = 16;
      if (pre.trim()) x += drawText(pre.trim(), x, 54, 13, '#ffe08a', 'left') + (pre.endsWith(' ') ? 4 : 0);
      x += drawText(String(hi), x, 54, 13, DREAM_BEST_COL, 'left');
      if (post.trim()) drawText(post.trim(), x + (post.startsWith(' ') ? 4 : 0), 54, 13, '#ffe08a', 'left');
    }
    // 下一个：放在右侧、顶栏图标键下面，虚化（半透明）当预告，不再写「下一个」字样
    const nr = TIERS[next].r, sc = Math.min(1, 18 / nr);
    drawBall(next, NEXT_X, NEXT_Y, 0, sc, 0.55, nextGold);
    if (state === 'showcase') drawText(fmt(TX.调试.展示, { page: showPage + 1, total: showPages.length, mode: showGold ? TX.调试.展示模式镀金 : TX.调试.展示模式普通 }), W / 2, 80, 12, '#fff6e0');
  }
  ctx.setTransform(g, 0, 0, g, 0, 0);
  // 顶层：飞向顶栏的金豆、成就横幅（临时把 ctx 换成顶层画布，画法和主画布一样）。
  // 成就横幅 2026-11-13 起也画在这层：顶栏键（暂停/声音、美梦的摇一摇牌子）是盖在游戏画布上的界面元素，
  // 横幅画在游戏画布上会被它们压住（微信版键挪到了胶囊左边，正好和横幅重叠，用户发现的），横幅要盖住键。
  let flying = false;
  if (state === 'play') for (let i = 0; i < effects.length; i++) { const kd = effects[i].kind; if (kd === 'fly' || kd === 'bpop' || kd === 'spend') { flying = true; break; } }
  const toastOn = !!toast && state !== 'over';
  if (flying || toastOn || fxDirty) {
    fxCtx.save(); fxCtx.setTransform(1, 0, 0, 1, 0, 0); fxCtx.clearRect(0, 0, fxTop.width, fxTop.height); fxCtx.restore();
    const main = ctx; ctx = fxCtx;
    drawToast();
    if (flying) for (const e of effects) { const kd = e.kind; if (kd === 'fly') drawFly(e, now); else if (kd === 'spend') drawSpend(e, now); else if (kd === 'bpop') drawBeanPop(e); }
    ctx = main; fxDirty = flying || toastOn;
    if (fxDirty !== fxShown) { fxShown = fxDirty; fxTop.style.visibility = fxShown ? 'visible' : 'hidden'; }   // 画空了就藏起来
  }
}

function isFresh(b, now) { return b.dropped && now - b.born < 1200 && b.position.y < M.danger + 60 && b.velocity.y > 0.3 || now - b.born < 400; }

// ---------------------------------------------------------------- 主循环
// 逻辑固定 60 步/秒（物理、特效、计时都按步走）；画面跟着屏幕的刷新率走：每帧把球画在「上一步 → 这一步」之间、按时间插值的位置上。
// 2026-11-14 加的插值。原来每帧「攒够 16.7 毫秒就走一步」然后直接画：屏幕不是 60Hz（90 / 120 / 144Hz 的手机、会变的刷新率）时，
// 一帧里走 0 步、1 步还是 2 步来回变，球一顿一顿地动——不是算不过来，是节奏对不上（群友的小米 15 一进游戏就觉得卡）。
// 插值之后屏幕多少 Hz 球都是匀速的（60Hz 的屏和原来一样）。跟着改的：凡是原来「每画一帧」推进一次的东西
// （合成弹一下、震屏衰减、镀金冒星、气泡）都改成每步推进一次，不然高刷屏上快一倍、密一倍。
let last = performance.now(), acc = 0, testFreeze = false;
if (DREAM_TEST) window.dfyFreeze = (on = true) => { testFreeze = on; };
const STEP = 1000 / 60;
// 追帧：机器慢、一帧要补好几步时，最多补 MAX_STEPS 步；补着补着已经花掉 STEP_BUDGET 毫秒也不再补，剩下的时间丢掉（游戏略微放慢）。
// 原来最多补 6 步：物理本来就算不过来的时候越补越慢（一帧 6 步物理 → 这一帧更长 → 下一帧还要 6 步），帧数直接掉到个位数。
const MAX_STEPS = 3, STEP_BUDGET = 30;
let stepSeq = 0;            // 一共走了多少步
let physLive = false;       // 最近一步物理有没有真的在走（暂停、时停、教程时没走：不插值，直接画当前位置）
let lerpK = 1;              // 这一帧画在上一步（0）和这一步（1）之间的哪儿
let boxPX = 0, boxPY = 0;   // 上一步的容器偏移（摇一摇），插值用
// 每一步都要走的画面状态（暂停、时停时也走，和原来写在 render 里时一样）：合成出来「弹一下」的进度
function stepVisual() {
  if (!world) return;
  const bodies = Composite.allBodies(world);
  for (let i = 0; i < bodies.length; i++) { const b = bodies[i]; if (b.pop > 0) b.pop = Math.max(0, b.pop - 0.08); }
}
// 每一步随机冒的小东西：镀金的金星、解冻前的白星、水里的气泡。原来在 render 里按「每画一帧」的概率冒；
// 教程 / 大肥鱼时停时走不到这里（和原来的 spawn 条件一样），不会只冒不消、越堆越多（2026-11-11 用户发现的那团金光）
function ambient() {
  if (!world) return;
  const bodies = Composite.allBodies(world);
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b.gold || b.tier === undefined) continue;
    const r = TIERS[b.tier].r;
    if (goldAlpha(b) === 1 && Math.random() < 0.04 + r / 3000) twinkles(b.position.x, b.position.y, r * 0.9, 1);
  }
  // 解冻前悬空的旧堆：冒点白星提示「马上要掉了」
  if (thaw && Math.random() < 0.5) { const b = thaw.bodies[Math.floor(Math.random() * thaw.bodies.length)]; twinkles(b.position.x, b.position.y, TIERS[b.tier].r * 0.8, 1, BLUE); }
  // 灌水时水里冒气泡（底下、泡着的球身上）
  if (wat && wat.level > 0.05) {
    const wy = M.floor - (M.floor - M.top) * wat.level;
    if (Math.random() < 0.12) effects.push({ kind: 'bub', x: M.wl + 6 * M.k + Math.random() * (M.wr - M.wl - 12 * M.k), y: M.floor - 4 * M.k, vy: -(0.8 + Math.random() * 1.0) * M.k, ph: Math.random() * 6, big: Math.random() < 0.3, life: 90, max: 90 });
    if (Math.random() < 0.12) {
      const wet = bodies.filter(b => b.wetF > 0.6 && b.tier !== undefined && b.position.y > wy + 20 * M.k);
      const b = wet[Math.floor(Math.random() * wet.length)];
      if (b) effects.push({ kind: 'bub', x: b.position.x + (Math.random() - 0.5) * TIERS[b.tier].r, y: b.bounds.min.y, vy: -(0.8 + Math.random() * 0.8) * M.k, ph: Math.random() * 6, big: Math.random() < 0.2, life: 70, max: 70 });
    }
  }
  // 手上的、预告的是镀金的：也冒星
  if (state === 'play' && curGold && Math.random() < 0.08) { const r = TIERS[cur].half; twinkles(Math.max(M.wl + r, Math.min(M.wr - r, aimX)), M.dropY, 16, 1); }
  // 预告在屏幕坐标上（scr = true）。原来没标，普通 / 美梦模式里被当成世界坐标又缩了一遍，星星冒到预告左下方去了
  if (state !== 'title' && !DEBUG && nextGold && Math.random() < 0.05) twinkles(NEXT_X, NEXT_Y, 14, 1, undefined, true);
}
function pruneEffects() {   // 去掉放完的特效（原地压紧，不每步新建数组）
  let n = 0;
  for (let i = 0; i < effects.length; i++) { const e = effects[i]; if (e.life > 0) effects[n++] = e; }
  effects.length = n;
}
// 帧间隔先「捋平」再用。屏幕是按固定周期刷新的，可浏览器给的时间戳有的只精确到毫秒（Safari）、有的带一两毫秒的抖动，
// 直接拿去插值，球会跟着时间戳的毛刺微微发抖。所以估一个刷新周期 framePer（对得上的那些帧间隔的滑动平均）：
// 这一帧的间隔和它的整数倍（1 倍 = 正常，2、3 倍 = 中间丢了帧）差不到四分之一个周期，就按整数倍算；
// 对不上（刷新率变了、卡了一下）就照实际间隔算，并把周期改估成这一帧的。长期平均和真实时间一致，不会越走越偏。
let framePer = STEP;
function frameGap(gap) {
  const n = Math.round(gap / framePer);
  if (n >= 1 && n <= 4 && Math.abs(gap - n * framePer) < framePer * 0.25) {
    framePer += (gap / n - framePer) * 0.05;
    return n * framePer;
  }
  if (gap >= 3 && gap <= 50) framePer = gap;
  return gap;
}
function loop(now) {
  const gap = now - last; last = now;
  if (gap > 0) acc += Math.min(100, frameGap(gap));
  syncBackdrop();
  const tLoop = performance.now();
  let steps = 0, physMs = 0;
  while (acc >= STEP) {
    if (steps >= MAX_STEPS || steps && performance.now() - tLoop > STEP_BUDGET) { acc %= STEP; break; }   // 追不上：不再补，剩下的时间丢掉
    steps++; acc -= STEP; stepSeq++; physLive = false;
    stepVisual();
    if (testFreeze && state === 'play') continue;   // ?dream 测试：dfyFreeze(true) 定格画面（截图看动效用）
    if (state === 'play' && fishStop) {      // 时停：物理、特效、计时全部冻住
      fishStop.t += STEP;
      for (const e of effects) if (e.kind === 'px') { stepShard(e); e.life--; }
      pruneEffects();
      if (fishStop.t >= fishStop.dur) endFishStop();
      continue;
    }
    if (state === 'play') {
      const dt = slow > 0 ? STEP * 0.3 : STEP;
      // 记下这一步之前每个球在哪（画的时候在它和新位置之间插值）
      const bodies = Composite.allBodies(world);
      for (let i = 0; i < bodies.length; i++) { const b = bodies[i]; b.px = b.position.x; b.py = b.position.y; b.pa = b.angle; b.lerp = true; }
      boxPX = box.x; boxPY = box.y;
      stepWater(now, dt);                    // 灌水：浮力是力，要在 update 之前加
      const tPhys = FPS_ON ? performance.now() : 0;
      Engine.update(engine, dt);             // 镀金大合成时短暂慢动作
      if (FPS_ON) physMs += performance.now() - tPhys;
      physLive = true;
      stepWaterDrag(dt);
      stepToast();
      doMerges();
      if (!thaw) stepGoldTimers();
      stepLocking();
      stepFill(now);
      stepShake(now);
      if (shkTally && now >= shkTally.until) {   // 摇完数一数：摇出 3 次以上合成就飘一个紫色标题
        if (shkTally.n >= 3) { const c = titleCanvas(fmt(TX.美梦.摇出合成, { n: shkTally.n }), false, 'dream'); effects.push({ kind: 'title', scr: true, x: W / 2, y: freeY(W / 2, 250, c.width * 2, c.height * 2), text: fmt(TX.美梦.摇出合成, { n: shkTally.n }), theme: 'dream', life: 110, max: 110 }); beep([784, 988, 1175, 1568], 0.05, 'square', 0.04); }
        shkTally = null;
      }
      if (watTally && now >= watTally.until) {   // 灌完数一数：灌出 3 次以上合成就飘一个蓝白标题
        const n = watTally.n;
        if (n >= 3) { const txt = fmt(TX.灌水.灌出合成, { n }), c = titleCanvas(txt, false, 'blue'); effects.push({ kind: 'title', scr: true, x: W / 2, y: freeY(W / 2, 250, c.width * 2, c.height * 2), text: txt, theme: 'blue', life: 110, max: 110 }); beep([659, 784, 988, 1319], 0.05, 'square', 0.04); }
        watTally = null;
      }
      if (thaw && (thaw.t += STEP) >= THAW_MS) endThaw();
      else if (!canDrop && !thaw && !wat && cdReady(now)) canDrop = true;
      if (tutWantGold()) { tutFocusGold(); break; }   // 镀金小笼包第一次到待发射位（能放了）：时停 + 教程
      if (tutWantShake(now)) { tutFocusShake(); break; }   // 这局第一颗金豆落格：摇一摇 / 灌水的用法（左侧金豆键上开孔）

      // 美梦长按连丢：按下后没动过、满 HOLD_MS，之后每次冷却好了就丢一个（aimX 跟着手指走）
      if (M.dream && pointerDown && !thaw && !shk) {
        if (!autoFire && !holdMoved && now - holdStart >= HOLD_MS) autoFire = true;
        if (autoFire && canDrop) drop();
      }
      // 结束判定：有球（不是刚放下的）顶部在红线上方持续 1.5 秒（晃动期间和之后一小会儿不判）
      // 摇一摇、灌水期间和之后一小会儿（宽限）不判红线，计时清零，也不算「好险！」（不然一灌水就白送）
      const graced = now <= shakeGraceUntil;
      const over = !graced && Composite.allBodies(world).some(b => b.tier !== undefined && !isFresh(b, now) && b.bounds.min.y < M.danger && Math.abs(b.velocity.y) < 1.5);
      if (!over && !graced && overTimer >= DANGER_RISK) unlock('m3');   // 好险！：撑过一阵又解除，没等到失败
      overTimer = over ? overTimer + STEP : 0;
      if (overTimer > 1500 && !DEBUG) gameOver();
    }
    if (state === 'tut') continue;           // 教程时停：特效、闪光、慢动作也一起冻住
    if (slow > 0) slow -= STEP;
    if (flash > 0) flash = Math.max(0, flash - 0.05);
    if (scoreGlow > 0) scoreGlow--;
    ambient();
    for (const e of effects) {
      e.life--;
      if (e.kind === 'p') { e.x += e.vx; e.y += e.vy; e.vy += 0.15; }
      else if (e.kind === 's') { e.x += e.vx; e.y += e.vy; e.vy += e.g; if (e.drag) { e.vx *= e.drag; e.vy *= e.drag; } }
      else if (e.kind === 'ring') e.r += e.vr;
      else if (e.kind === 'px') stepShard(e);
      else if (e.kind === 'dust') { e.x += e.vx; e.y += e.vy; e.vx *= 0.92; e.vy *= 0.92; }
      else if (e.kind === 'bub') {   // 气泡：往上冒、左右轻摆，到水面就破（没水了直接没）
        e.y += e.vy; e.ph += 0.15; e.x += Math.sin(e.ph) * 0.35 * M.k;
        const wy = wat && wat.level > 0 ? M.floor - (M.floor - M.top) * wat.level : Infinity;
        if (e.y <= wy + 2 * M.k) e.life = 0;
      }
      else if (e.kind === 'fly') {
        for (let i = 0; i < e.n; i++) if (flyK(e, i) >= 1 && flyK(e, i, e.life + 1) < 1) {
          const [x, y] = beanAt(e.slot + i); effects.push({ kind: 'bpop', scr: true, x, y, life: 16, max: 16 }); beanArrive();
          // 这一局第一颗豆的最后一颗也落进九宫格了：等白闪/金星（约 0.3 秒）放完再弹「摇一摇」教程
          if (e === tutShakeFly && i === e.n - 1) { tutShakeFly = null; shakeTutAt = now + 600; }
        }
      }
      else if (e.kind === 'bpop') {}
      else if (e.kind === 'spend') { if (e.life === 1) twinkles(e.x1, e.y1, 10, 8, NIGHT_STARS, true); }   // 用掉的金豆落地：冒一圈金星
      else if (e.kind === 'name') e.y -= 0.6;   // 和分数大字同速，叠在一起时不会互相追上
      else if (e.kind === 'title') { e.y -= 0.15; if (e.life % 5 === 0 && e.life > 24) twinkles(e.x, e.y, titleCanvas(e.text, false, e.theme).width, 2, e.theme === 'blue' ? BLUE : e.theme === 'dream' ? NIGHT_STARS : undefined, !!e.scr); }
      else e.y -= 0.6;
    }
    pruneEffects();
  }
  lerpK = physLive ? Math.min(1, acc / STEP) : 1;
  const tDraw = FPS_ON ? performance.now() : 0;
  render(now);
  if (!direct) vctx.drawImage(scr, 0, 0, cv.width, cv.height);   // kc > 1：最近邻放大 kc 倍贴到屏幕（kc = 1 时已经直接画在 cv 上了）
  if (FPS_ON) fpsFrame(gap, tDraw - tLoop, physMs, performance.now() - tDraw, steps);
  requestAnimationFrame(loop);
}
// ---------------------------------------------------------------- 帧率小窗（网址加 ?fps）
// 左下角一小块字（英文）：屏幕刷新率（Hz）、实际帧率（fps）、最长一帧（max）、每帧逻辑 / 其中物理 / 绘制各花几毫秒（logic / phys / draw）、
// 每秒走几步（steps/s，正常 60）、球数（balls）、画布大小（cv，「via scr」= 先画中间画面再放大）、窗口大小 @ 像素比。
// 有人说卡的时候请他在网址后面加 ?fps（已有问号就加 &fps）截个图：一眼分得出是刷新率、物理算不过来还是画得慢。
const fpsS = { el: null, t: 0, n: 0, gaps: [], worst: 0, logic: 0, phys: 0, draw: 0, steps: 0 };
function fpsFrame(gap, logicMs, physMs, drawMs, steps) {
  const S = fpsS;
  if (!S.el) {
    S.el = document.createElement('div');
    S.el.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:98;pointer-events:none;white-space:pre;font:11px/1.35 monospace;color:#b8ffb0;background:rgba(0,0,0,.62);padding:3px 5px';
    document.body.appendChild(S.el);
  }
  S.n++; S.t += gap; S.gaps.push(gap); S.worst = Math.max(S.worst, gap); S.logic += logicMs; S.phys += physMs; S.draw += drawMs; S.steps += steps;
  if (S.t < 500) return;
  const sorted = S.gaps.sort((a, b) => a - b), med = sorted[sorted.length >> 1] || 16.7;
  const balls = world ? Composite.allBodies(world).length - 3 : 0, f = (v) => (v / S.n).toFixed(1);
  // 小窗里的字只用英文和数字：tools/make_font.py 会把 game.js 里所有字符串的字收进字模图，这里写中文会白白多做一批用不上的字模
  S.el.textContent = [
    `${Math.round(1000 / med)}Hz  fps ${(S.n / S.t * 1000).toFixed(0)}  max ${S.worst.toFixed(0)}ms`,
    `logic ${f(S.logic)}ms (phys ${f(S.phys)})  draw ${f(S.draw)}ms  ${(S.steps / S.t * 1000).toFixed(0)} steps/s`,
    `balls ${Math.max(0, balls)}  cv ${cv.width}x${cv.height}${direct ? '' : ' via scr'}  ${innerWidth}x${innerHeight}@${(devicePixelRatio || 1).toFixed(2)}`,
  ].join('\n');
  S.n = 0; S.t = 0; S.gaps.length = 0; S.worst = 0; S.logic = 0; S.phys = 0; S.draw = 0; S.steps = 0;
}

// ---------------------------------------------------------------- 界面
const $ = (id) => document.getElementById(id);
let show = (id) => { for (const o of document.querySelectorAll('.ov')) o.classList.toggle('show', o.id === id); };
let creditBack = 'ovStart';
// 这局分数破了最高分就记下（普通局记正式最高分，美梦局只记美梦最高分）。结束页和「放弃本局」都走这里。返回是不是新纪录
function keepBest() {
  const bestNow = M.dream ? dreamBest : best;
  if (!(score > bestNow && score > 0)) return false;
  if (M.dream) { dreamBest = score; localStorage.setItem('dfy_dream_best', dreamBest); }
  else { best = score; localStorage.setItem('dfy_best', best); }
  if (window.TOY && achOn() && !DREAM_TEST) window.TOY.best();   // B站 Toy 版：新纪录交给排行榜（调试网址下不交）
  return true;
}
// 美梦入口的「连败」计数：普通局打到结束页、或者暂停页「放弃本局」都算一局（有人眼看要输就点放弃，不能白丢这一局）。
// 这局合出过大肥鱼（runFish > 0）连败清零；连着两局没合出 → 当场永久解锁（不必非得进结束页）。调试网址下不数。返回是不是刚解锁
function countMiss() {
  if (M.dream || !(achOn() || DREAM_TEST)) return false;
  if (!DREAM_TEST) dreamSave.miss = runFish > 0 ? 0 : dreamSave.miss + 1;
  const fresh = !dreamSave.unlocked && dreamSave.miss >= 2;
  if (fresh) dreamSave.unlocked = true;
  saveDream();
  return fresh;
}
const snapPile = () => Composite.allBodies(world).filter(b => b.tier !== undefined).map(b => ({ tier: b.tier, gold: b.gold, x: b.position.x, y: b.position.y, angle: b.angle }));
function gameOver() {
  state = 'over'; sfxOver();
  // 美梦模式：分数只进自己的最高分，不碰正式最高分（成就、图鉴在 unlock / markSeen 里已经拦了）
  const bestNow = M.dream ? dreamBest : best;
  const rec = keepBest();
  // 美梦入口（见 countMiss）：刚解锁的这一次，结束页卡片右上角的夜空绶带出场更隆重（多冒星、叮一声、闪三下）
  let fresh = false;
  if (!M.dream && (achOn() || DREAM_TEST)) {
    lastPile = snapPile();
    fresh = countMiss();
    if (DREAM_TEST && !dreamSave.shown) { dreamSave.shown = true; fresh = true; }
  }
  const bestEl = $('overBest');
  bestEl.classList.toggle('rec', rec);
  setPix('tOver', M.dream ? TX.美梦.结束页标题 : TX.标题.结束页, TITLE);
  if (rec) setPix('overBest', TX.结束页.新纪录, { ...BODY, fill: '#c8402f', bold: true }, 1);
  else putBest('overBest', M.dream ? TX.美梦.结束页最高分 : TX.结束页.最高分, bestNow, M.dream);
  // 普通局：解锁后卡片右上角挂夜空绶带进美梦（带着这局的堆）；美梦局结束页没有（回普通走「返回」）
  overSash.show(!M.dream && dreamSave.unlocked, { fresh, delay: 1220, cond: () => state === 'over' });   // 700ms 后弹页面，再等卡片弹完
  $('overMaxImg').src = `sprites/t${String(maxTier + 1).padStart(2, '0')}.png?v=${SPRITE_V}`;
  setPix('overMax', SHORT[maxTier], { ...BODY, px: 13, bold: true }, 1);
  setPix('overScore', '0', SCORE_BIG);
  $('overAch').style.display = achRun ? 'flex' : 'none';
  if (achRun) setPix('overAch', fmt(TX.结束页.本局新成就, { n: achRun }), { ...BODY, fill: '#b07818', bold: true }, 1);
  toast = null;
  setTimeout(() => {
    show('ovOver');
    // 分数从 0 滚到最终值
    const t0 = performance.now(), dur = Math.min(900, 300 + score * 2);
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur), v = Math.round(score * (1 - (1 - p) ** 3));
      setPix('overScore', String(v), SCORE_BIG);
      if (p < 1 && state === 'over') requestAnimationFrame(tick);
      else if (p >= 1) beep(rec ? [784, 988, 1319] : [660], 0.06);
    };
    requestAnimationFrame(tick);
  }, 700);
}
// dream：进美梦模式；pile：把上一局的堆搬进去（只有从普通局结束页进来才带）
function start(dream = false, pile = null) {
  M = dream ? DREAM : NORMAL;
  if (dream && !dreamSave.entered) { dreamSave.entered = true; saveDream(); }   // 进过一次美梦，绶带就不再蹦跶诱导
  const g = M.k !== 1 ? FINE * 2 : FINE;
  if (g !== GRID) { GRID = g; resize(); }   // 缩放的模式（美梦、现在的普通）画布网格加密一倍，见 GRID
  firstDrops = pile ? 4 : 0;               // 带堆进来时不再走开局只出小球的那几个
  newGame(pile); show(null); syncShakeChip(); beep([523, 784], 0.07); if (SHOWCASE) showcase();
  // 「摇一摇」一课不再按开局时间弹：等这局第一颗金豆飞进九宫格、动画放完才弹（grantShake / loop 里记 shakeTutAt）
}

// ---------------------------------------------------------------- 美梦入口：卡片右上角的夜空绶带（开始页、普通局结束页、普通局暂停页）；flip（右下角）留着备用
// 「半彩蛋」：不写字，一条深蓝夜空色的斜带，金色缝线，正中一弯金月亮，带上几颗星一闪一闪。两头伸出卡片边一点、折到卡片后面（露出背面小三角）。
// 整条在像素网格上画（一格 = 2 逻辑像素，和按钮同网格）；月亮按 4/3 逻辑像素一格（和按钮字同网格）。
// 格坐标（「角」坐标系）：cx = 0 是卡片右边框那一列（往左为负、进卡片）；cy = 0 是这个角那条边框的最外一行，往卡片里为正。
// 右下角就是右上角上下翻过来（flip）；底边框是 6 像素厚（卡片的投影边），所以右下角的带子离角略近。
// 从没进过美梦（dreamSave.entered 为假）时加诱导：隔一会儿蹦一下、反光更勤、星星多、月亮上飘 z。刚解锁那次：展开 + 闪三下 + 一圈金星炸开 + 叮一声。
const SASH_PAL = { o: '#120e2a', f: '#2c2858', h: '#4a4590', s: '#1f1b44', st: '#ffd25e', k: '#17132f', g: '#6a64c0' };
const SASH_HOVER = { ...SASH_PAL, f: '#38327a', h: '#5c56b0', s: '#29245a' };
const SASH_M = 6;                          // 画布四周留白（格）：给星星、z、投影
// 尺寸 z：带子在 d = cy - cx 上的范围 [d0, d1]；e 伸出卡片边的格数。开始页、结束页用大号；暂停页卡片窄，用小号（2026-11-10 用户嫌大）
// stitch：金缝线每几格一针（0 = 不缝）；side：只缝哪一边（'h' 上边、's' 下边，不写 = 两边）
// 小号每 5 格一针：窄带上照大号每 3 格太碎、不缝又太素，2026-11-10 用户在 2/3/4/5/6 格、只缝外侧几档里挑的
const SASH_BIG = { d0: 12, d1: 30, e: 3, stitch: 3 }, SASH_SMALL = { d0: 8, d1: 22, e: 2, stitch: 5 };
const Z_BMP = ['####', '..#.', '.#..', '####'];
function sashMask(cx, cy, z) {
  const d = cy - cx, D0 = z.d0, D1 = z.d1, E = z.e;
  if (d >= D0 && d <= D1 && cy >= -E && cx <= E) return 'b';
  if (d > D1 && ((cy < 0 && cy >= -E && cx >= -E - D1) || (cx > 0 && cx <= E && cy <= D1 + E))) return 'k';   // 两头折到后面的背面三角
  return null;
}
// 按屏幕方向推出每格颜色（高光在上、暗边在下，翻过来也一样）
function sashCells(flip, z) {
  const dir = flip ? -1 : 1, m = (x, sy) => sashMask(x, sy * dir, z), isB = (x, y) => m(x, y) === 'b';
  const cells = [];
  let l = 99, r = -99, t = 99, b = -99;
  for (let sy = -60; sy < 60; sy++) for (let x = -60; x < 20; x++) if (m(x, sy)) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, sy); b = Math.max(b, sy); }
  const edge = (x, y) => isB(x, y) && !(isB(x - 1, y) && isB(x + 1, y) && isB(x, y - 1) && isB(x, y + 1));
  // 底层（不跟着蹦）：折到后面的背面三角 + 带子伸出卡片边的那几截。平时被正面盖住看不见；正面往上蹦时从底下露出来，
  // 像缎带被拉起、背面还绕在卡片边上，不会露出「浮着的小布条」的空隙。
  const inner = z.inner ?? (flip ? 3 : 1);   // 卡片里面从这一行开始（右上角上边框 1 格；右下角底边框 6 像素 = 3 格；教程里的小样例 1 格 = 1 像素，边框占 2 格）
  const inBack = (x, y) => { const v = m(x, y); return v === 'k' || (v === 'b' && (y * dir < inner || x >= 0)); };
  const back = [];
  for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) if (inBack(x, y))
    back.push({ x, y, c: [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inBack(x + dx, y + dy)) ? 'o' : 'k' });
  for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) {
    const v = m(x, y); if (v !== 'b') continue;
    let c;
    if (edge(x, y)) c = 'o';
    else if (edge(x, y - 1) || edge(x + 1, y)) c = 'h';
    else if (edge(x, y + 1) || edge(x - 1, y)) c = 's';
    else c = 'f';
    cells.push({ x, y, c });
  }
  // 金缝线：高光/暗边再往里一格，隔两格一针
  const at = new Map(cells.map(q => [q.x + ',' + q.y, q]));
  const ty = (x, y) => (at.get(x + ',' + y) || {}).c;
  const P = z.stitch, sideOk = (n) => z.side ? n === z.side : n === 'h' || n === 's';
  if (P) for (const q of cells) if (q.c === 'f' && (((q.x + q.y) % P) + P) % P === 0 && [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => sideOk(ty(q.x + dx, q.y + dy)))) q.st = 1;
  // 不画卡片上的投影：试过一格半透明深棕「压痕」，用户嫌不好看，卡片保持原本的纸面
  // 月亮中心：带子中线在两刀之间的中点（连续格坐标，换成屏幕方向）
  const dc = (z.d0 + z.d1) / 2, X = (1 - dc) / 2, Y = (1 + dc) / 2;
  // 带上的星：沿中线两侧挑几格（避开月亮），各自错开闪
  const stars = [[-9, 0, 0], [7, -1, 1], [-14, 3, 2], [12, 2, 3]].map(([a, o, i]) => {   // a 沿带子、o 横向偏移（格）
    const cx = Math.round(X + a / 2 + o / 2), cy = Math.round(Y + a / 2 - o / 2);
    return { x: cx, y: flip ? -cy : cy, i };
  }).filter(s => m(s.x, s.y) === 'b' && !edge(s.x, s.y));
  return { cells, back, stars, l, r, t, b, moon: [X, flip ? 1 - Y : Y], W: r - l + 1 + SASH_M * 2, H: b - t + 1 + SASH_M * 2, isHit: (x, y) => !!m(x, y) };
}
// 一条绶带 = 一个 canvas。flip：右下角；ov：所在页面（不显示就停动画）；go：点了做什么
function makeSash(el, flip, ov, go, z = SASH_BIG) {
  const S = { on: false, fresh: false, t0: 0, hover: false, raf: 0, sparks: [], zs: [], moon: null };
  const q = sashCells(flip, z);
  const bk = document.createElement('canvas'); bk.className = 'sash back'; el.parentNode.insertBefore(bk, el);   // 底层：背面 + 投影，不蹦
  for (const c of [el, bk]) {
    c.style.right = -2 * (q.r + 1 + SASH_M) + 'px';
    if (flip) c.style.bottom = -(4 + 2 * (q.b + 1 + SASH_M)) + 'px'; else c.style.top = 2 * (q.t - SASH_M) - 2 + 'px';
    c.style.width = q.W * 2 + 'px'; c.style.height = q.H * 2 + 'px';
  }
  const lure = () => !dreamSave.entered;
  function draw(now) {
    // 走了几个 60 帧的「步」（金星按它冒、按它飘；原来每画一帧算一次，高刷屏上快一倍）
    S.acc = (S.acc || 0) + (S.last ? Math.min(6, (now - S.last) / STEP) : 1); S.last = now;
    const steps = Math.floor(S.acc); S.acc -= steps;
    const k = PX.zoom || 1, cs = 2 * FINE;   // 一格 = 2 逻辑像素 = 3 个细网格像素
    const Wp = Math.round(q.W * cs * k), Hp = Math.round(q.H * cs * k);
    for (const c of [el, bk]) if (c.width !== Wp || c.height !== Hp) { c.width = Wp; c.height = Hp; }
    const g = el.getContext('2d'), gb = bk.getContext('2d'); g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, Wp, Hp); gb.clearRect(0, 0, Wp, Hp);
    const fx = (x) => Math.round((x - q.l + SASH_M) * cs * k), fy = (y) => Math.round((y - q.t + SASH_M) * cs * k), cw = Math.round(cs * k);
    const age = now - S.t0, unroll = Math.min(1, age / 320), pal = S.hover ? SASH_HOVER : SASH_PAL, lu = lure();
    const s0 = q.l + (flip ? -q.b : q.t), s1 = q.r + (flip ? -q.t : q.b);           // 沿带子方向（左上 → 右下 / 左下 → 右上）
    const along = (c) => c.x + (flip ? -c.y : c.y);
    const lim = s0 - 1 + unroll * (s1 - s0 + 2);
    const per = lu ? 1600 : 4000, gp = ((age + per - 800) % per) / 500, gs = gp <= 1 ? s0 - 6 + gp * (s1 - s0 + 12) : -999;   // 反光沿带子扫
    const flashOn = S.fresh && age > 350 && age < 1300 && Math.floor((age - 350) / 160) % 2 === 0;
    // 诱导时隔 2.2 秒蹦一下（整格：上 2 → 1 → 2 → 落回）。蹦在画布里做、不用 CSS 挪整张图：
    // 这样底层能把正面「扫过」的地方用背面色补上——带子两头的边是斜的台阶，只把正面整体上移的话，台阶底下会漏出一格背景
    const ht = (age % 2200) / 2200, hop = lu && unroll >= 1 ? (ht < 0.82 || ht >= 0.94 ? 0 : ht < 0.86 || ht >= 0.90 ? 2 : 1) : 0;
    const fyH = (y) => fy(y - hop);
    for (const c of q.back) { if (along(c) > lim) continue; gb.fillStyle = pal[c.c]; gb.fillRect(fx(c.x), fy(c.y), cw, cw); }
    gb.fillStyle = pal.k;
    for (let o = 1; o <= hop; o++) for (const c of q.back) gb.fillRect(fx(c.x), fy(c.y - o), cw, cw);
    for (const c of q.cells) {
      if (along(c) > lim) continue;
      let col = c.st ? pal.st : pal[c.c];
      if ((c.c === 'f' || c.c === 'h') && !c.st && (Math.abs(along(c) - gs) < 2 || flashOn)) col = pal.g;
      g.fillStyle = col; g.fillRect(fx(c.x), fyH(c.y), cw, cw);
    }
    if (unroll < 0.55) return;
    // 带上的星：一闪一闪（亮时金十字、暗时一个奶白点）
    for (const s of q.stars) {
      const on = Math.floor((age / 400 + s.i * 1.3)) % 3 !== 0, X = fx(s.x), Y = fyH(s.y), u = Math.round(cw / 3);
      g.fillStyle = on ? '#ffe9a0' : '#8f88d8'; g.fillRect(X + u, Y + u, u, u);
      if (on && s.i % 2 === 0) { g.fillRect(X, Y + u, u * 3, u); g.fillRect(X + u, Y, u, u * 3); }
    }
    // 月亮（4/3 逻辑像素一格 = 2 个细网格像素）；诱导时每 2.4 秒点一下头
    if (!S.moon) S.moon = PX.icon('moon');
    const mw = S.moon.width * 2, mh = S.moon.height * 2, nod = lu && (age % 2400) > 1900 && (age % 2400) < 2100 ? -2 : 0;
    const mx = Math.round((q.moon[0] - q.l + SASH_M) * cs - mw / 2), my = Math.round((q.moon[1] - hop - q.t + SASH_M) * cs - mh / 2) + nod;
    g.drawImage(S.moon, mx * k, my * k, mw * k, mh * k);
    // 诱导：月牙尖上隔一会儿飘一个 z
    if (lu && unroll >= 1 && (!S.zs.length || now - S.zs[S.zs.length - 1].t > 1100)) S.zs.push({ t: now });
    S.zs = S.zs.filter(z => now - z.t < 1800);
    for (const z of S.zs) {
      const p = (now - z.t) / 1800, st = Math.floor(p * 9) / 9, zx = mx + mw - 4 + Math.round(st * 10) * 2, zy = my - 4 - Math.round(st * 12) * 2;
      if (p > 0.85 && Math.floor(now / 80) % 2) continue;   // 快消失时闪一闪
      g.fillStyle = '#fff1c8';
      Z_BMP.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') g.fillRect((zx + i * 2) * k, (zy + j * 2) * k, 2 * k, 2 * k); }));
    }
    // 金星：平时偶尔冒，诱导时多，刚解锁时一圈炸开
    for (let n = 0; n < steps; n++) if (unroll >= 1 && Math.random() < (S.fresh && age < 1500 ? 0.35 : lu ? 0.12 : 0.025)) {
      const c = q.cells[Math.random() * q.cells.length | 0];
      S.sparks.push({ x: c.x + (Math.random() * 6 - 3), y: c.y + (Math.random() * 6 - 3), vx: 0, vy: -0.12, life: 16 + Math.random() * 16 | 0, big: Math.random() < 0.4 });
    }
    for (let i = S.sparks.length - 1; i >= 0; i--) {
      const s = S.sparks[i]; s.x += s.vx * steps; s.y += s.vy * steps; if ((s.life -= steps) <= 0) { S.sparks.splice(i, 1); continue; }
      const c = SASH_SPARK[(Math.floor(s.life / 3) + (s.big ? 1 : 0)) % SASH_SPARK.length], X = fx(s.x), Y = fy(s.y), u = Math.round(cw / 1.5);
      g.fillStyle = c; g.fillRect(X, Y, u, u);
      if (s.big && s.life % 8 < 6) { g.fillRect(X - u, Y, u * 3, u); g.fillRect(X, Y - u, u, u * 3); }
    }
  }
  function loop(now) {
    S.raf = 0;
    if (!S.on || !$(ov).classList.contains('show')) return;
    draw(now);
    S.raf = requestAnimationFrame(loop);
  }
  function hit(e) {
    const r = el.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * q.W) + q.l - SASH_M, y = Math.floor((e.clientY - r.top) / r.height * q.H) + q.t - SASH_M;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (q.isHit(x + dx, y + dy)) return true;
    return false;
  }
  el.addEventListener('pointermove', (e) => { const h = hit(e); if (h !== S.hover) { S.hover = h; el.style.cursor = h ? 'pointer' : ''; } });
  el.addEventListener('pointerleave', () => { S.hover = false; el.classList.remove('press'); });
  el.addEventListener('pointerdown', (e) => { if (hit(e)) el.classList.add('press'); });
  el.addEventListener('pointerup', (e) => { const was = el.classList.contains('press'); el.classList.remove('press'); if (was && hit(e)) go(); });
  el.title = TX.鼠标悬停提示.美梦;
  fineList.set(el, () => { S.moon = null; });
  const api = {
    // on：显示不显示；fresh：刚解锁（隆重出场）；delay：等卡片弹出；quiet：不出声（刚打开网页时）
    show(on, { fresh = false, delay = 0, quiet = false, cond = () => true } = {}) {
      S.on = on; S.fresh = fresh; S.sparks = []; S.zs = []; el.style.display = bk.style.display = 'none';
      if (!on) return;
      setTimeout(() => {
        if (!S.on || !cond()) return;
        el.style.display = bk.style.display = 'block'; S.t0 = performance.now(); S.last = 0;
        if (fresh) for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; S.sparks.push({ x: q.moon[0], y: q.moon[1], vx: Math.cos(a) * 0.5, vy: Math.sin(a) * 0.5, life: 24 + (i % 3) * 4, big: i % 2 === 0 }); }
        if (!quiet) beep(fresh ? [523, 659, 784, 1047, 1319] : [784, 1047], 0.05, 'triangle', 0.04);
        if (!S.raf) S.raf = requestAnimationFrame(loop);
        // 第一次看到绶带：等它出场动画放完（刚解锁那次要展开 + 闪三下，约 1.3 秒），时停弹「美梦」一课，孔开在月亮上
        const t0 = S.t0;
        setTimeout(() => { if (S.on && S.t0 === t0 && el.style.display === 'block' && cond() && $(ov).classList.contains('show')) tutFocusSash(api, ov); }, fresh ? 1500 : 450);
      }, delay);
    },
    // 月亮（带子正中）在屏幕上的位置（逻辑坐标），给教程聚焦用；r 按带子宽窄取，盖住月亮和两边一截带子
    focus() {
      const u = $('ui').getBoundingClientRect(), s = u.width / W, b = el.getBoundingClientRect();
      return { x: (b.left - u.left) / s + (q.moon[0] - q.l + SASH_M) * 2, y: (b.top - u.top) / s + (q.moon[1] - q.t + SASH_M) * 2, r: z === SASH_SMALL ? 22 : 28 };
    },
    // 从别的页（图鉴、成就、署名、意见）回来时：页面藏起来那会儿动画循环自己停了，这里接上
    wake() { if (S.on && el.style.display === 'block' && !S.raf) { S.last = 0; S.raf = requestAnimationFrame(loop); } },
  };
  return api;
}
const SASH_SPARK = NIGHT_STARS;   // 金星（夜空配金）
const startSash = makeSash($('sashStart'), false, 'ovStart', () => start(true));          // 开始页：空容器进美梦
const overSash = makeSash($('sashOver'), false, 'ovOver', () => start(true, lastPile));   // 普通局结束页（也是右上角）：带着这局的堆进美梦
const pauseSash = makeSash($('sashPause'), false, 'ovPause', () => show('ovDream'), SASH_SMALL);     // 普通局暂停页：先弹确认（进去就回不到普通模式），确认后带着当前的堆进美梦
startSash.show(dreamSave.unlocked, { delay: 300, quiet: true });

// 回开始页（结束页「返回」、暂停页「放弃本局」）：场上清空，模式回普通（美梦的画布网格也还原）。
// 放弃本局不进结束页，但破了的最高分照样记、普通局照样算一局连败（见 bCfmYes）；fresh：刚因为这次放弃解锁了美梦，开始页绶带隆重出场
function toMenu(fresh = false) {
  M = NORMAL;
  if (GRID !== FINE) { GRID = FINE; resize(); }
  state = 'title'; world = engine = null; effects = []; toast = null; shk = null; fishStop = null; fishQueue.length = 0; thaw = null; fillJob = null; autoFire = false; pointerDown = false;
  show('ovStart'); startSash.show(dreamSave.unlocked, { fresh, delay: fresh ? 420 : 120, quiet: !fresh }); syncShakeChip(); beep([523, 392], 0.06);
}
if (DREAM_TEST) window.dfyStart = (dream = false) => start(dream);   // 控制台直接开一局（测结束页用）
// ?dream：带着一堆现成的东西开局（[{tier, x, y, angle, gold}]，坐标是该模式的世界坐标），性能测试用——同一堆东西才好比改前改后
if (DREAM_TEST) window.dfyPile = (pile, dream = true) => { const dx = dream ? (DREAM.wl + DREAM.wr) / 2 - (NORMAL.wl + NORMAL.wr) / 2 : 0; start(dream, pile.map(p => ({ ...p, x: p.x - dx }))); };

// ---------------------------------------------------------------- 临时展示模式（网址加 ?showcase）
// 把 11 级全摆进容器看效果：G 切换普通/镀金，B 随机一个放镀金合成特效，F 放镀金大肥鱼庆祝特效
const SHOWCASE = /[?&]showcase\b/.test(location.search);

// ---------------------------------------------------------------- 调试模式（网址加 ?debug）
// 顶部两排缩略图：上排普通、下排镀金。点一个，当前要放下的就换成它，并一直保持（方便连丢两个同级看合成特效）；
// 再点一次取消。「随机」恢复正常掉落，「清空」清掉场上物品。调试时堆过红线也不结束。
const DEBUG = /[?&]debug\b/.test(location.search);
// debug: dfyFish(golds 0/1/2) drops two big fish to preview the clear time-stop
if (DEBUG) window.dfyFish = (g = 0) => { const L = TIERS.length - 1; makeBall(L, 120, 520, g > 0); makeBall(L, 250, 520, g > 1); };
let debugPick = null;
// debug: dfyInfo() 返回当前模式/状态/球数，给自动化测试看
if (DREAM_TEST) window.dfyEnd = () => { if (state === 'play') gameOver(); };
if (DREAM_TEST) window.dfyShake = (n = 1) => { if (state === 'play') { shakes = Math.min(SHAKE_MAX, shakes + n); shakesShown = Math.min(SHAKE_MAX, shakesShown + n); syncShakeChip(); } };   // ?dream：直接结束当前局（测美梦入口用，不受 ?debug 影响成就/图鉴记录）
if (DREAM_TEST) window.dfyShakeTally = (n = 7) => { shkTally = { until: 0, n }; };   // ?dream：马上飘一个「摇出 n 次合成」标题（看美梦标题配色用）
if (DREAM_TEST) window.dfyScore = (n = 0) => { if (state === 'play') addScore(n); };   // ?dream：直接加分（测第一颗 2500 / 第二颗 10000 的金豆门槛用）
if (DREAM_TEST) window.dfyTut = () => TS ? { beans: TS.beans, slots: [...TS.slots], scoreSlot: TS.scoreSlot, fx: TS.fx.length, fxSlots: TS.fx.map(f => f.slot), poofs: TS.poofs.length, hold: !!TS.holdUntil, holdScore: TS.holdScore } : null;   // ?dream：摇一摇教程的九宫格/飞豆/满格状态
if (DEBUG || DREAM_TEST) window.dfyInfo = () => ({ state, dream: M.dream, grid: GRID, canDrop, thaw: !!thaw, score, shakes, milestone: shakeMilestone, shaking: !!shk, water: wat ? { t: Math.round(wat.t), level: +wat.level.toFixed(2), lid: !!wat.lid, merges: wat.merges, golds: wat.golds } : null, box: { ...box }, balls: world ? Composite.allBodies(world).filter(b => b.tier !== undefined).length : 0,
  golds: world ? Composite.allBodies(world).filter(b => b.gold).map(b => [b.tier, Math.round(b.gLeft)]) : [],   // 场上镀金的 [级, 剩余毫秒（0 = 不限时）]
  maxY: world ? Math.max(...Composite.allBodies(world).filter(b => b.tier !== undefined).map(b => b.position.y), -1e9) : 0,
  bv: world ? (() => { const bs = Composite.allBodies(world).filter(b => b.tier !== undefined); const s = (f) => +(bs.reduce((a, b) => a + f(b), 0) / (bs.length || 1)).toFixed(2); return { vx: s(b => b.velocity.x), vy: s(b => b.velocity.y), sp: s(b => Math.hypot(b.velocity.x, b.velocity.y)), out: bs.filter(b => b.position.x < M.wl || b.position.x > M.wr || b.position.y > M.floor).length }; })() : null });   // bv：场上球的平均速度（测摇一摇手感用）
if (DEBUG) {
  const ui = document.getElementById('ui');
  const bar = document.createElement('div');
  bar.id = 'dbgBar';
  bar.style.cssText = 'position:absolute;left:6px;top:4px;width:274px;pointer-events:auto;display:none;' +
    'background:rgba(43,29,22,.55);padding:2px;box-sizing:border-box';
  const cells = [];
  const mkCell = (inner, title, onClick) => {
    const c = document.createElement('div');
    c.title = title;
    c.style.cssText = 'width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;vertical-align:top;box-sizing:border-box';
    c.appendChild(inner);
    c.onpointerdown = (e) => { e.stopPropagation(); onClick(); };
    bar.appendChild(c);
    return c;
  };
  const refresh = () => {
    for (const c of cells) {
      const on = debugPick && debugPick.tier === c.tier && debugPick.gold === c.gold;
      c.el.style.background = on ? 'rgba(255,233,138,.85)' : 'transparent';
    }
  };
  const pick = (tier, gold) => {
    debugPick = debugPick && debugPick.tier === tier && debugPick.gold === gold ? null : { tier, gold };
    if (debugPick && state === 'play') { cur = tier; curGold = gold; }
    refresh();
  };
  for (const gold of [false, true]) {
    TIERS.forEach((t, k) => {
      const im = document.createElement('img');
      const src = `sprites/${gold ? 'g' : 't'}${String(k + 1).padStart(2, '0')}.png?v=${SPRITE_V}`;
      im.onerror = () => retryImg(im, src);
      im.src = src;
      im.style.cssText = 'max-width:20px;max-height:20px;image-rendering:pixelated;pointer-events:none';
      const el = mkCell(im, `${gold ? TX.图鉴.镀金前缀 : ''}${t.name}`, () => pick(k, gold));
      cells.push({ el, tier: k, gold });
    });
    bar.appendChild(document.createElement('br'));
  }
  const btn = (label, onClick) => {
    const b = document.createElement('div');
    b.className = 'btn sub px';
    b.style.cssText = 'display:inline-flex;margin:4px 6px 2px 2px;padding:2px 6px 3px;min-width:0';
    putText(b, label, { px: 10, bold: false, fill: '#4a2e20', outline: null, shadow: false, thr: 70 }, 1);
    b.onpointerdown = (e) => { e.stopPropagation(); onClick(); };
    bar.appendChild(b);
  };
  btn(TX.调试.随机, () => { debugPick = null; refresh(); });
  btn(TX.调试.清空, () => { if (world) for (const b of Composite.allBodies(world)) if (b.tier !== undefined) Composite.remove(world, b); });
  btn(TX.调试.结束, () => { if (state === 'play') { if (!score) score = 2333; gameOver(); } });   // 看结束页；没得分时用 2333 演示
  ui.appendChild(bar);
  const _show = show;
  show = (id) => { _show(id); bar.style.display = id ? 'none' : 'block'; };
}
let showGold = true, showPage = 0, showPages = null;
// 按实际大小排：小的在前，一排排往上摞，摞不下就翻到下一页（N 翻页）
function layoutPages() {
  const gap = 6, maxW = WALL_R - WALL_L - gap * 2, TOP = 92;
  const pages = [[]];
  let rows = [], row = [], x = 0;
  const rowH = (r) => Math.max(...r.map(k => TIERS[k].h + TEX * 2));
  const flushRow = () => { if (row.length) rows.push(row); row = []; x = 0; };
  for (let k = 0; k < TIERS.length; k++) {
    const w = TIERS[k].w + TEX * 2;
    if (x + w > maxW) flushRow();
    row.push(k); x += w + gap;
  }
  flushRow();
  let used = 0;
  for (const r of rows) {
    const h = rowH(r) + gap;
    if (used + h > FLOOR - TOP && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(r); used += h;
  }
  return pages;
}
function showcase() {
  state = 'showcase';
  showPages = showPages || layoutPages();
  for (const b of Composite.allBodies(world)) if (b.tier !== undefined) Composite.remove(world, b);
  const gap = 6;
  let bottom = FLOOR - gap;
  for (const row of showPages[showPage]) {
    const ws = row.map(k => TIERS[k].w + TEX * 2), total = ws.reduce((a, b) => a + b) + gap * (row.length - 1);
    let left = (WALL_L + WALL_R - total) / 2;
    const rh = Math.max(...row.map(k => TIERS[k].h + TEX * 2));
    row.forEach((k, i) => {
      const t = TIERS[k];
      const b = makeBall(k, 0, 0, showGold);
      Body.setStatic(b, true);
      Body.setPosition(b, { x: left + TEX - t.ox, y: bottom - rh / 2 - t.h / 2 - t.oy });
      left += ws[i] + gap;
    });
    bottom -= rh + gap;
  }
}
function showcaseBodies() { return Composite.allBodies(world).filter(b => b.tier !== undefined); }
addEventListener('keydown', (e) => {
  if (state !== 'showcase') return;
  const k = e.key.toLowerCase(), bs = showcaseBodies();
  if (k === 'g') { showGold = !showGold; for (const b of bs) b.gold = showGold; }
  else if (k === 'n') { showPage = (showPage + 1) % showPages.length; showcase(); }
  else if (k === 'b' || k === 'f') {
    const b = k === 'f' ? (bs.find(b => b.tier === TIERS.length - 1) || bs[bs.length - 1]) : bs[Math.floor(Math.random() * bs.length)];
    const nt = b.tier, last = nt === TIERS.length - 1;
    b.gold = showGold; b.pop = 1;
    if (!showGold) burst(b.position.x, b.position.y, TIERS[Math.max(0, nt - 1)].color, TIERS[Math.max(0, nt - 1)].r);
    fxMerge(b.position.x, b.position.y, nt, showGold, (nt + 1) * (nt + 2) / 2 * (showGold ? (last ? 3 : 2) : 1), true);
  }
});
const hudPause = (on) => { $('bPause').style.display = on ? 'flex' : 'none'; };
// 测试按钮（仅 ?dream，普通局和美梦局进行中都有）：填满 / 失败（见 stepFill）、进美梦（普通局里：带着当前场上的堆直接进）/ 回普通（美梦局里）
let dreamBar = null, dreamSwitch = null;
if (DREAM_TEST) {
  dreamBar = document.createElement('div');
  dreamBar.style.cssText = 'position:absolute;left:96px;top:74px;display:none;gap:6px;pointer-events:auto';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:12px sans-serif;padding:3px 8px;background:#e9dcc4;border:2px solid #4a2e20;color:#4a2e20;cursor:pointer';
    b.onpointerdown = (e) => { e.stopPropagation(); fn(); };
    dreamBar.appendChild(b);
    return b;
  };
  mk('填满', () => window.dfyFill('full'));
  mk('失败', () => window.dfyFill('fail'));
  mk('+豆', () => { if (state === 'play') grantShake(1, W / 2, 300); });   // 美梦给摇一摇、普通给灌水（走真实的飞豆）
  dreamSwitch = mk('进美梦', () => {
    if (state !== 'play') return;
    if (M.dream) return start(false);
    lastPile = snapPile();
    start(true, lastPile);
  });
  document.getElementById('ui').appendChild(dreamBar);
}
const NOTE_ON = false;   // 意见便签总开关（见下方「意见便签」一节；开源版没有后端，关掉）
{
  const _show = show;
  show = (id) => {
    if (id === 'ovStart' || id === 'ovOver') refreshLadder();
    _show(id);
    if (id === 'ovStart') startSash.wake(); else if (id === 'ovOver') overSash.wake(); else if (id === 'ovPause') pauseSash.wake();
    $('noteTab').classList.toggle('show', NOTE_ON && /^ov(Start|Over|Pause)$/.test(id));   // 意见便签：和角落 i 键同进同出（开始/结束/暂停页才有，2026-11-10 用户要求对齐）
    $('tutTab').classList.toggle('show', /^ov(Start|Over|Pause)$/.test(id));    // 教程「?」键：同上
    $('rankTab').classList.toggle('show', !!window.TOY && /^ov(Start|Over|Pause)$/.test(id));   // 排行榜键：只有 B站 Toy 版有，占便签的位置
    hudPause(id === null && state === 'play');
    const dm = id === null && state === 'play';   // 2026-11-14 起普通模式也有（灌水）
    $('bShake').style.display = dm ? 'flex' : 'none'; $('shakeBar').style.display = dm ? 'block' : 'none';
    if (dreamBar) { dreamBar.style.display = id === null && state === 'play' ? 'flex' : 'none'; dreamSwitch.textContent = M.dream ? '回普通' : '进美梦'; }
  };
}
function pause() {
  if (state !== 'play' || fishStop) return;
  state = 'paused'; pointerDown = false; if (shk) shk.drag = null;
  setPix('pScore', String(score), SCORE_BIG);
  putBest('pBest', M.dream ? TX.美梦.暂停页最高分 : TX.暂停页.最高分, Math.max(M.dream ? dreamBest : best, score), M.dream);
  show('ovPause'); beep([440], 0.05);
  pauseSash.show(!M.dream && dreamSave.unlocked, { quiet: true, cond: () => state === 'paused' });   // 美梦局的暂停页没有（已经在梦里了）
}
function resume() { state = 'play'; last = performance.now(); show(null); }
function openCredit(back) { creditBack = back; show('ovCredit'); }

// ---------------------------------------------------------------- 意见便签
// 开始/结束/暂停页（有角落 i 键的页）右下角贴着一张便签，和 i 同进同出（#noteTab，show() 管显示）；
// 点开是一张大便签，写了发 POST feedback 给同源的意见接口。
// 开源版（GitHub Pages 是纯静态托管，没有后端）把它整个关掉：NOTE_ON = false，入口不显示；
// 页面、输入框、发送逻辑都留着，自己部署时配好接口、把 NOTE_ON 改成 true 即可。
// 输入框是系统字体的原生 textarea（玩家什么字都可能打，离线字模拼不出来）；草稿存 localStorage，关了页面也不丢。
const NOTE_MAX = 300;
const NOTE_PAGES = new Set(['ovStart', 'ovOver', 'ovPause']);   // 有角落 i 键（bCredit1/2/3）的页，便签只在这几页贴着（show() 里同一组写成正则）
// B站 Toy 版不许有未经授权的自由输入：tools/build_toy.py 打包时把下面 toy-strip 标记之间的便签代码（和 index.html 里的输入框）整段删掉
// <toy-strip>
const noteEl = $('noteText');
let noteBack = 'ovStart', noteBusy = false;
noteEl.maxLength = NOTE_MAX; noteEl.placeholder = TX.意见.输入框提示;
noteEl.value = localStorage.getItem('dfy_note_draft') || '';
setPix('tNote', TX.意见.标题, TITLE2);
setPix('note1', TX.意见.说明1, { ...BODY, fill: '#8a6a52' }, 1);
setPix('note2', TX.意见.说明2, { ...BODY, fill: '#8a6a52' }, 1);
setPix('bNoteSend', TX.按钮.发送, BTN);
setPix('bNoteBack', TX.按钮.返回, BTN);
const getNoteCid = () => localStorage.getItem('dfy_cid') || (() => { const c = Math.random().toString(36).slice(2, 10); localStorage.setItem('dfy_cid', c); return c; })();   // 匿名随机号（便签关着时不生成，发送时才取）
function noteCount() {
  const n = noteEl.value.length;
  setPix('noteCount', fmt(TX.意见.字数, { n, total: NOTE_MAX }), { ...LBL, fill: n >= NOTE_MAX ? '#c0532f' : '#a08560' }, 1);
}
function noteSay(key, fill = '#8a6a52') {
  const el = $('noteMsg');
  if (!key) { fineList.delete(el); el.replaceChildren(); return; }
  setPix('noteMsg', TX.意见[key], { ...BODY, fill, bold: true }, 1);
}
noteCount();
noteEl.addEventListener('input', () => { localStorage.setItem('dfy_note_draft', noteEl.value); noteCount(); if (!noteBusy) noteSay(null); });
noteEl.addEventListener('keydown', (e) => e.stopPropagation());   // 打字不漏给 ?showcase 的调试快捷键（游戏本身已经没有键盘操作）
noteEl.addEventListener('blur', () => setTimeout(() => { if (resizeOwed) dispatchEvent(new Event('resize')); }, 50));   // 键盘收起：把输入时跳过的重排补上。没跳过就不补——补一次会把全部像素字重贴一遍，点「返回」会卡一下（2026-11-10 修）
function openNote() {
  noteBack = [...document.querySelectorAll('.ov.show')].map(o => o.id).find(id => id !== 'ovNote') || 'ovStart';
  noteSay(null); noteCount();
  show('ovNote'); beep([660, 880], 0.04);
  if (matchMedia('(pointer: fine)').matches) setTimeout(() => noteEl.focus(), 0);   // 电脑上直接能打字；手机上等玩家自己点，不突然弹键盘
}
function closeNote() {
  noteEl.blur(); show(noteBack);
  if (noteBack === 'ovDex') dexFxSync(); else if (noteBack === 'ovAch') achFxSync();
}
async function sendNote() {
  if (noteBusy) return;
  const text = noteEl.value.trim();
  if (!text) { noteSay('空', '#c0532f'); return; }
  noteBusy = true; $('bNoteSend').classList.add('busy'); noteSay('发送中');
  let key = '失败';
  try {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 12000);
    const v = (document.querySelector('script[src^="game.js"]')?.getAttribute('src') || '').split('v=')[1] || '';
    const r = await fetch('feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal: ac.signal,
      body: JSON.stringify({ text, cid: getNoteCid(), page: noteBack, mode: M.dream ? 'dream' : 'normal', state, score, best, v,
        screen: `${innerWidth}x${innerHeight}@${devicePixelRatio || 1}` }),
    });
    clearTimeout(to);
    if (r.ok) key = '成功'; else if (r.status === 429) key = '太快';
  } catch (e) {}
  noteBusy = false; $('bNoteSend').classList.remove('busy');
  if (key === '成功') {
    noteEl.value = ''; localStorage.removeItem('dfy_note_draft'); noteCount();
    noteSay('成功', '#4a8a3a'); beep([523, 659, 784], 0.06, 'triangle', 0.05);
  } else { noteSay(key, '#c0532f'); beep([330, 262], 0.07); }
}
$('noteTab').onclick = openNote;
$('bNoteSend').onclick = sendNote;
$('bNoteBack').onclick = closeNote;
$('noteTab').classList.toggle('show', NOTE_ON && [...document.querySelectorAll('.ov.show')].some(o => NOTE_PAGES.has(o.id)));   // 刚打开网页：开始页已经显示着（没走 show()）
// </toy-strip>

// ---------------------------------------------------------------- 排行榜（只在 B站 Toy 版里有，2026-11-21）
// toy.js 提供 window.TOY（GitHub Pages 版没有这个文件，入口不出现）。两个榜：1 = 普通模式最高分，2 = 美梦模式最高分（各算各的）。
// 入口是开始/结束/暂停页左下角的方键（占原来意见便签的位置）。名次、分数用像素字；昵称是玩家的 B站 昵称，
// 什么字都可能有，离线字模拼不出来，用系统字体（同便签输入框）。榜单拉一次缓存一分钟，不轮询（toy.js）。
if (window.TOY) {
  const TOY = window.TOY;
  const RANK_COL = ['#c88a1e', '#7d8796', '#a8642e'];   // 前三名名次：金、银、铜
  let rankBack = 'ovStart', rankBoard = 1, rankSeq = 0;
  const clearPix = (el) => { for (const c of el.querySelectorAll('*')) fineList.delete(c); fineList.delete(el); el.replaceChildren(); };
  const pixSpan = (str, opt) => { const sp = document.createElement('span'); sp.style.display = 'flex'; putText(sp, str, opt, 1); return sp; };
  const avatarUrl = (u) => {
    if (!u) return '';
    if (u.startsWith('//')) u = 'https:' + u;
    if (/hdslb\.com\/bfs\//.test(u) && !u.includes('@')) u += '@64w_64h';   // B站 图床按尺寸取小图
    return u;
  };
  function rankMsg(key, fill = '#8a6a52') {
    const el = $('rankList'); clearPix(el);
    const d = document.createElement('div'); d.className = 'rankMsg';
    d.appendChild(pixSpan(TX.排行榜[key], { ...BODY, fill }));
    el.appendChild(d);
  }
  function rankRow(it) {
    const r = document.createElement('div'); r.className = 'rrow';
    const no = document.createElement('span'); no.className = 'rno';
    no.appendChild(pixSpan(String(it.rank), { ...BODY, bold: true, fill: RANK_COL[it.rank - 1] || '#8a6a52' }));
    const av = document.createElement('img'); av.className = 'rav'; av.alt = ''; av.referrerPolicy = 'no-referrer';
    av.onerror = () => { av.removeAttribute('src'); };   // 没头像 / 加载失败：只剩底色方块，不显示破图标
    const au = avatarUrl(it.avatar);
    if (au) av.src = au;
    const nm = document.createElement('span'); nm.className = 'rnm'; nm.textContent = it.nickname || '';
    const sc = document.createElement('span'); sc.className = 'rsc';
    sc.appendChild(pixSpan(String(it.score), { ...BODY, bold: true }));
    r.append(no, av, nm, sc);
    return r;
  }
  function rankMine(mine, err) {
    const el = $('rankMine'); clearPix(el);
    const opt = { ...BODY, fill: '#8a6a52' };
    if (!mine) { if (err === 'login') el.appendChild(pixSpan(TX.排行榜.未登录, opt)); return; }
    if (!mine.ranked) { el.appendChild(pixSpan(TX.排行榜.未上榜, opt)); return; }
    el.append(pixSpan(fmt(TX.排行榜.我的名次, { n: mine.rank }), { ...opt, bold: true }), pixSpan(fmt(TX.排行榜.分数, { n: mine.score }), { ...opt, bold: true }));
  }
  async function loadRank(board) {
    rankBoard = board;
    $('bRank1').classList.toggle('on', board === 1); $('bRank2').classList.toggle('on', board === 2);
    const seq = ++rankSeq;
    rankMsg('加载中'); clearPix($('rankMine'));
    const r = await TOY.rank(board);
    if (seq !== rankSeq) return;   // 加载途中切了榜
    if (r.list && r.list.length) {
      const el = $('rankList'); clearPix(el);
      for (const it of r.list) el.appendChild(rankRow(it));
      el.scrollTop = 0;
    } else if (r.list) rankMsg('空');
    else rankMsg(r.err === 'busy' ? '太快' : '失败', '#c0532f');
    rankMine(r.mine, r.err);
  }
  function openRank(back) {
    rankBack = back;
    if (back !== 'ovStart') rankBoard = M.dream ? 2 : 1;   // 结束页 / 暂停页点进来：先看这局所在模式的榜
    show('ovRank'); beep([660, 880], 0.04);
    loadRank(rankBoard);
  }
  setPix('tRank', TX.排行榜.标题, TITLE2);
  setPix('bRank1', TX.排行榜.普通, BTN);
  setPix('bRank2', TX.排行榜.美梦, BTN);
  setPix('bRankBack', TX.按钮.返回, BTN);
  const putRankIcon = () => PX.put($('rankTab'), PX.icon('podium'), 2, TX.鼠标悬停提示.排行榜);
  putRankIcon(); fineList.set('rankIcon', putRankIcon);
  $('rankTab').title = TX.鼠标悬停提示.排行榜;
  $('rankTab').onclick = () => openRank([...document.querySelectorAll('.ov.show')].map(o => o.id).find(id => NOTE_PAGES.has(id)) || 'ovStart');
  $('bRank1').onclick = () => { if (rankBoard !== 1) { beep([660], 0.03); loadRank(1); } };
  $('bRank2').onclick = () => { if (rankBoard !== 2) { beep([660], 0.03); loadRank(2); } };
  $('bRankBack').onclick = () => show(rankBack);
  $('rankTab').classList.toggle('show', [...document.querySelectorAll('.ov.show')].some(o => NOTE_PAGES.has(o.id)));
}

// ---------------------------------------------------------------- 教程（2026-11-10）
// 通用组件：一课 = 标题 + 几排「相框动画 + 一两行字」（相框左右交替）+ 底部按钮。相框里的动画都是用现成精灵现画的，不占体积。
// 两种打开方式：
//   聚焦（focus）：第一次遇到某样东西时时停，整屏盖幕布（#tutVeil），只在那样东西上开个圆孔，下面弹出这一课，
//                 点「知道了」才继续（不做「点任意处继续」，用户要求；按钮弹出后先藏 TUT_WAIT 毫秒，防连点跳过）。
//   回看：开始/结束/暂停页的「?」键（和 i、意见便签同进同出），普通页面，按钮是「返回」。
// 现在三课：镀金小笼包第一次到待发射位 / 第一次看到夜空绶带（美梦入口）/ 美梦里第一次开局（摇一摇）。
// 看过的记在 localStorage.dfy_tut（调试网址下只记在内存里）。
// 测试：网址加 ?tutorial，每局该弹的课都弹（配 ?gold 更快：开局第 4 个起都是镀金）。
const TUT_TEST = /[?&]tutorial\b/.test(location.search);
const tutRun = new Set();   // ?tutorial 下本局已经弹过的课（newGame 清空）
const tutDone = (() => { try { return JSON.parse(localStorage.getItem('dfy_tut') || '{}'); } catch { return {}; } })();
let shakeTutAt = 0;        // 这局第一颗金豆落进九宫格后，隔一会儿才弹「摇一摇」这一课（见 grantShake / loop）
let tutShakeFly = null;    // 第一颗金豆那次飞行的 fly 特效（等最后一颗到达再排教程）
const beanTut = () => M.dream ? 'shake' : 'water';   // 金豆的那一课：美梦是摇一摇，普通是灌水
// 相框里一个精灵像素 = 1 逻辑像素（游戏里普通模式是 1.6）。2026-11-11 用户嫌 4/3 时相框太大、左右交错的相框横向叠在一起，
// 在「第二格只留两个」和「精灵缩小一号」里选了后者。1.5 个画面像素不是整数，像素会有一点忽粗忽细（同游戏里 0.8 倍），用户接受
const TUT_U = 1;
const TUT_FW = 96, TUT_FH = 56;     // 相框大小（精灵像素 = 逻辑像素）：卡片内宽 232，两排相框横向之间空出 40
const TUT_ROW_GAP = 4;               // 相框和字的间距（和 index.html 的 .tutRow gap 对上）。2026-11-11 从 8 改成 4：字用满「相框边到卡片边」的空间，美梦课那行 12 个字才刚好排成两行
const TUT_FL = TUT_FH - 4;           // 相框里地板上沿
// 第二排相框里摇一摇键（C2）的左上角；九宫格在它右边 36。第 i 格中心（i < 0 = 九宫格正中，满格时鱼豆去那儿消失）
const TUT_KEY_X = 17, TUT_KEY_Y = 20;
const tutCellX = (i) => TUT_KEY_X + 36 + (i >= 0 ? 5 + (i % 3) * 8 : 13), tutCellY = (i) => TUT_KEY_Y + (i >= 0 ? 5 + Math.floor(i / 3) * 8 : 13);
const TUT_WAIT = 1000;               // 聚焦弹出后，按钮先藏这么久
const spW = (k) => TIERS[k].w / TEX, spH = (k) => TIERS[k].h / TEX;
const tutTmp = document.createElement('canvas'), tutTmpCtx = tutTmp.getContext('2d');
// 缩小的镀金精灵（相框里的大肥鱼画成 0.45 倍）——1 像素的金边缩下去就没了，看不出哪条是镀金的。
// 另做一张纯金剪影，在缩小画的时候垫在底下、往外扩 1 逻辑像素，相当于把金边补粗到看得见（只在缩小时用，1 倍照原样）。
const tutGoldSil = new Map();
function tutGoldRim(k) {
  if (tutGoldSil.has(k)) return tutGoldSil.get(k);
  const gs = goldSprite(k);
  if (!gs) { tutGoldSil.set(k, null); return null; }
  const c = document.createElement('canvas'); c.width = gs.width; c.height = gs.height;
  const q = c.getContext('2d');
  q.drawImage(gs, 0, 0);
  q.globalCompositeOperation = 'source-in'; q.fillStyle = '#f0b828'; q.fillRect(0, 0, c.width, c.height);   // 同镀金精灵外圈亮金
  tutGoldSil.set(k, c);
  return c;
}
// 相框里画一个精灵：脚底中心 (cx, fy)。o.gold 镀金（扫反光，o.phase 相位）、o.gA 镀金浓度（褪色，底下垫普通的）、o.lock 镀牢动效放到第几毫秒
function tutSprite(g, k, cx, fy, o = {}) {
  const sc = o.s || 1, w = spW(k) * sc, h = spH(k) * sc, x = Math.round(cx - w / 2), y = Math.round(fy - h), sp = sprites[k], gs = o.gold && goldSprite(k);
  if (!gs) { if (ok(sp)) g.drawImage(sp, x, y, w, h); return; }
  paintGlint(tutTmp, tutTmpCtx, gs, o.phase || 0);
  if (o.lock !== undefined) paintLock(tutTmpCtx, gs, o.lock);
  const gA = o.gA ?? 1;
  if (gA < 1 && ok(sp)) g.drawImage(sp, x, y, w, h);
  if (sc < 0.9) { const rim = tutGoldRim(k), ro = sc < 0.6 ? 2 : 1; if (rim) g.drawImage(rim, x - ro, y - ro, w + 2 * ro, h + 2 * ro); }   // 缩小时补粗金边（0.45 倍下 1 像素金边会被缩没；0.75 倍补 1 像素就够，2 像素太粗）
  g.globalAlpha = gA; g.drawImage(tutTmp, x - 1, y - 1, w + 2, h + 2); g.globalAlpha = 1;   // 镀金精灵四周各大 1 像素（和游戏里一样，跟着缩放）
}
// 相框里的小特效（精灵像素坐标）：十字金星、冲击波、金粉
function tutStars(st, x, y, r, n, burst = false, pal = SPARK) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = burst ? 0 : Math.random() * r, sp = burst ? 0.4 + Math.random() * 0.9 : 0;
    st.fx.push({ k: 's', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (burst ? 0.3 : 0.12), life: 16 + Math.random() * 18, big: Math.random() < 0.35, pal });
  }
}
function tutDust(st, x, y, r) {
  for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2; st.fx.push({ k: 'p', x: x + Math.cos(a) * r * 0.5, y: y + Math.sin(a) * r * 0.5, vx: Math.cos(a) * 0.3, vy: -0.4 - Math.random() * 0.5, life: 20 + Math.random() * 14, c: SPARK[1 + (Math.random() * 3 | 0)] }); }
}
function tutFx(g, st, n) {
  for (let i = st.fx.length - 1; i >= 0; i--) {
    const e = st.fx[i];
    e.life -= n; if (e.life <= 0) { st.fx.splice(i, 1); continue; }
    if (e.k === 'ring') { e.r += e.vr * n; const m = 18; g.fillStyle = e.life > e.max / 2 ? SPARK[0] : SPARK[2]; for (let j = 0; j < m; j++) { const a = j / m * Math.PI * 2; g.fillRect(Math.round(e.x + Math.cos(a) * e.r), Math.round(e.y + Math.sin(a) * e.r), 1, 1); } continue; }
    e.x += e.vx * n; e.y += e.vy * n;
    const x = Math.round(e.x), y = Math.round(e.y);
    if (e.k === 'p') { g.fillStyle = e.c; g.fillRect(x, y, 2, 2); continue; }
    const P = e.pal || SPARK; g.fillStyle = P[(Math.floor(e.life / 3) + (e.big ? 1 : 0)) % P.length]; g.fillRect(x, y, 1, 1);
    if (e.big && Math.floor(e.life) % 8 < 6) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); g.fillStyle = '#fff'; g.fillRect(x, y, 1, 1); }
  }
}
const tutPhaseNow = () => 1 - (performance.now() / 2200) % 1;   // 让反光带「此刻」正好从左边开始扫（paintGlint 的相位）
// 第 1 格：镀金小笼包从上面掉到普通小笼包上，合成镀金饭团（和游戏里一样是「丢下去」的）
function tutRowMerge(g, t, st) {
  // 2026-11-11 用户：去掉末尾「退场闪一闪」（每 90ms 隐一下），并从末尾截短 400ms（2800 → 2400）；落下的节奏不变。
  const L = 2400, T = t % L, cx = TUT_FW / 2, h0 = spH(0), hover = 600, fall = 380;
  if (T < st.T) st.merged = false;
  st.T = T;
  if (T < hover + fall) {
    tutSprite(g, 0, cx, TUT_FL);
    const p = Math.max(0, (T - hover) / fall), y = 4 + h0 + p * p * (TUT_FL - h0 - 4 - h0);
    if (T < hover) { g.fillStyle = 'rgba(255,255,255,.7)'; for (let yy = y + 3; yy < TUT_FL - h0 - 2; yy += 5) g.fillRect(cx, Math.round(yy), 1, 3); }   // 瞄准线
    tutSprite(g, 0, cx, y, { gold: true, phase: 0.3 });
    return;
  }
  const a = T - hover - fall;
  if (!st.merged) { st.merged = true; st.phase = tutPhaseNow(); const y = TUT_FL - h0; tutStars(st, cx, y, 0, 14, true); st.fx.push({ k: 'ring', x: cx, y, r: 4, vr: 0.6, life: 14, max: 14 }); }
  tutSprite(g, 1, cx, TUT_FL - (a < 70 ? 2 : a < 140 ? 1 : 0), { gold: true, phase: st.phase });
  if (Math.random() < 0.04) tutStars(st, cx, TUT_FL - spH(1) / 2, spW(1) / 2, 1);
}
// 第 2 格（2026-11-11 新增）：分数翻倍。三组「两个同级碰上」并排、同时从上面掉下来（和左边第一格同一套落法）：
// 普通+普通 / 一金+普通 / 双金；合上那一下各自弹出这一合的分数，一眼比出 ×1 / ×2 / ×3。
// 每轮换一种物品当料（小笼包 → 饭团 → 面窝，合出来的高一级），分数用游戏里 doMerges 的同一条公式。
const TUT_SCORE_K = [0, 1, 2];                                           // 每轮拿来合的那一级
const TUT_SCORE_L = 1900, TUT_SCORE_PRE = 480, TUT_SCORE_FALL = 340;     // 一轮多久 / 悬停 / 下落
const TUT_SCORE_X = [16, 48, 80];                                        // 三组的中心 x
const tutScorePts = (k, golds) => {                                      // 同 doMerges：基础 (nt+1)(nt+2)/2，一金 ×2，双金再 ×1.5
  const nt = k + 1;
  return Math.round((nt + 1) * (nt + 2) / 2 * (golds ? 2 : 1) * (golds === 2 ? 1.5 : 1));
};
function tutRowScore(g, t, st) {
  const round = Math.floor(t / TUT_SCORE_L) % TUT_SCORE_K.length, T = t % TUT_SCORE_L;
  const k = TUT_SCORE_K[round], nt = k + 1, sc = Math.min(1, 18 / spH(k));   // 两个叠起来最高 36 像素：面窝缩到 0.75，上面才留得下下落和分数的空
  const h = spH(k) * sc, h2 = spH(nt) * sc;
  if (st.round !== round) { st.round = round; st.hit = [0, 0, 0]; }
  const app = T - TUT_SCORE_PRE - TUT_SCORE_FALL, y0 = 4 + h, yEnd = TUT_FL - h;
  for (let i = 0; i < 3; i++) {
    const cx = TUT_SCORE_X[i];
    if (app < 0) {   // 底下的等着，上面的从悬停位置掉下来（中间、右边落下来的是镀金的；双金那列底下也是）
      tutSprite(g, k, cx, TUT_FL, { s: sc, gold: i === 2, phase: 0.2 + i * 0.25 });
      const p = Math.max(0, (T - TUT_SCORE_PRE) / TUT_SCORE_FALL), y = y0 + p * p * (yEnd - y0);
      if (T < TUT_SCORE_PRE) { g.fillStyle = 'rgba(255,255,255,.7)'; for (let yy = y + 4; yy < yEnd - 2; yy += 5) g.fillRect(cx, Math.round(yy), 1, 3); }
      tutSprite(g, k, cx, y, { s: sc, gold: i > 0, phase: 0.45 + i * 0.2 });
      continue;
    }
    if (!st.hit[i]) {   // 合上：金星 + 冲击环 + 弹出这一合的分数
      st.hit[i] = 1;
      if (!i) st.phase = tutPhaseNow();   // 三列同时合上，共用同一个反光相位
      tutStars(st, cx, TUT_FL - h2 / 2, 0, 10, true);
      st.fx.push({ k: 'ring', x: cx, y: TUT_FL - h2 / 2, r: 3, vr: 0.55, life: 13, max: 13 });
    }
    const pop = app < 60 ? 2 : app < 130 ? 1 : 0;
    tutSprite(g, nt, cx, TUT_FL - pop, { s: sc, gold: i > 0, phase: st.phase + i * 0.15 });
    const sy = TUT_FL - h2 - 14 - Math.min(4, Math.round(app / 70));   // 从头顶再往上弹 4 像素
    const pts = '+' + tutScorePts(k, i);
    if (i) tutNumOut(g, pts, cx, sy, '#ffe98a', '#5a3a14', 2); else tutNum(g, pts, cx, sy, '#5a3a24', 2);
  }
}
// 第 3 格：镀金小笼包、面窝、小螃蟹放着不动，各自褪色（游戏里 6 / 9.4 / 14.6 秒，这里压到约 1/5 长，比例照旧：越大撑得越久）
const TUT_FADE_K = [0, 2, 5], TUT_FADE = [1300, 2000, 3000], TUT_BLINK = 450;   // 褪色格末尾的闪是「褪色到消失」，照旧
function tutRowFade(g, t, st) {
  const L = 4400, T = t % L;
  const ws = TUT_FADE_K.map(spW), gap = (TUT_FW - ws.reduce((a, b) => a + b)) / 4;
  if (T < st.T || !st.faded) { st.faded = [false, false, false]; if (st.T !== undefined) TUT_FADE_K.forEach((k, i) => tutStars(st, st.xs[i], TUT_FL - spH(k) / 2, spW(k) / 2, 4)); }
  st.T = T;
  let x = gap; st.xs = [];
  TUT_FADE_K.forEach((k, i) => {
    const cx = x + ws[i] / 2; x += ws[i] + gap; st.xs.push(cx);
    const left = TUT_FADE[i] - T;
    if (left > 0) {
      const f = left / TUT_FADE[i];
      const gA = left <= TUT_BLINK ? (Math.floor(left / (left < 180 ? 60 : 110)) % 2 ? 1 : 0.2) : f > 0.6 ? 1 : f > 0.45 ? 0.8 : 0.6;   // 同 goldAlpha：分档变淡，最后闪
      tutSprite(g, k, cx, TUT_FL, { gold: true, gA, phase: i * 0.3 });
    } else {
      if (!st.faded[i]) { st.faded[i] = true; tutDust(st, cx, TUT_FL - spH(k) / 2, spW(k) / 2); }
      tutSprite(g, k, cx, TUT_FL);
    }
  });
}
// 第 4 格：普通小螃蟹掉到镀金小螃蟹上，合出镀金小鲸，放一遍镀牢动效（和游戏里同一个 paintLock），之后一直金着
function tutRowLock(g, t, st) {
  // 同上：末尾不闪，从 3800 截到 3400（截短 400ms），镀牢动效本身不动
  const L = 3400, T = t % L, cx = TUT_FW / 2, h5 = spH(5), fall = 420, pre = 300;
  if (T < st.T) st.merged = false;
  st.T = T;
  if (T < pre + fall) {
    tutSprite(g, 5, cx, TUT_FL, { gold: true, phase: 0.6 });   // 镀金的在下面等着，普通的从上面掉下来
    const p = Math.max(0, (T - pre) / fall), y = p * p * (TUT_FL - h5);
    tutSprite(g, 5, cx, y);
    return;
  }
  const a = T - pre - fall, h6 = spH(6);
  if (!st.merged) { st.merged = true; st.phase = tutPhaseNow(); st.set = false; tutStars(st, cx, TUT_FL - h5, 0, 10, true); }
  if (a >= LOCK_SET && !st.set) { st.set = true; for (let i = 0; i < 14; i++) { const an = i / 14 * Math.PI * 2; tutStars(st, cx + Math.cos(an) * spW(6) * 0.55, TUT_FL - h6 / 2 + Math.sin(an) * h6 * 0.55, 1, 1); } }
  tutSprite(g, 6, cx, TUT_FL, { gold: true, phase: st.phase, lock: a });
  if (a > LOCK_MS && Math.random() < 0.05) tutStars(st, cx, TUT_FL - h6 / 2, spW(6) / 2, 1);
}
// ---- 「美梦」一课（2026-11-11）：第一次看到夜空绶带时弹。交代三件事：容器更大精灵更小 / 按住连放 / 不解锁成就、最高分另记
// （摇一摇以后单独一课，用户说先不放进来）。美梦里精灵画成 2/3（一个精灵像素 = 2k 画布像素，整数，不忽粗忽细）
const TUT_DS = 2 / 3;
function tutWalls(g, l, r, top = 8) {   // 容器两面木墙（内壁 l..r），立在地板上
  for (const x of [l - 2, r + 1]) { g.fillStyle = '#8a5a36'; g.fillRect(x, top, 2, TUT_FL - top); g.fillStyle = '#c99a66'; g.fillRect(x, top, 1, TUT_FL - top); }
}
// 第 1 格：两个框框并排比大小（用户定的配图）——左边普通容器（木墙），右边美梦容器（夜空墙 + 金缝线），边长约 1.84 倍（2026-11-14 普通系数改 0.92 后跟着改，原来 1.6）；
// 两边精灵一样大（都画 2/3），各自往里落几个：一眼看出美梦的框框能装多得多（进了游戏，屏幕上框一样大，所以精灵显得小）
const TUT_BOX_N = { l: 6, r: 30, top: 28 }, TUT_BOX_D = { l: 44, r: 88, top: 7 };   // 普通 24×24、美梦 44×45
const TUT_IN_N = [[2, 15, TUT_FL], [0, 25, TUT_FL], [1, 19, TUT_FL - 15]];   // [级, 中心 x, 脚底 y]（2/3 大小）
const TUT_IN_D = [[2, 54, TUT_FL], [1, 70, TUT_FL], [0, 82, TUT_FL], [0, 52, TUT_FL - 16], [1, 66, TUT_FL - 12], [0, 81, TUT_FL - 8], [2, 60, TUT_FL - 24]];
function tutRowBig(g, t, st) {
  const L = 4200, T = t % L, B = TUT_BOX_D;
  tutWalls(g, TUT_BOX_N.l, TUT_BOX_N.r, TUT_BOX_N.top);
  for (const x of [B.l - 2, B.r + 1]) {   // 美梦的墙：夜空色 + 金缝线（同绶带）
    g.fillStyle = NIGHT.o; g.fillRect(x, B.top, 2, TUT_FL - B.top);
    g.fillStyle = NIGHT.h; g.fillRect(x, B.top, 1, TUT_FL - B.top);
    g.fillStyle = NIGHT.gold; for (let y = B.top + 2; y < TUT_FL - 1; y += 5) g.fillRect(x + (x < B.l ? 1 : 0), y, 1, 2);
  }
  if (Math.random() < 0.03) tutStars(st, B.r + 1, B.top + Math.random() * (TUT_FL - B.top), 1, 1, false, NIGHT_STARS);
  const drop = (list, top, t0, gap) => list.forEach(([k, x, fy], i) => {
    const a = T - t0 - i * gap; if (a < 0) return;
    const p = Math.min(1, a / 260), h = spH(k) * TUT_DS, y = top + h + p * p * (fy - top - h);
    tutSprite(g, k, x, y, { s: TUT_DS });
  });
  drop(TUT_IN_N, TUT_BOX_N.top - 6, 200, 420);
  drop(TUT_IN_D, B.top - 4, 300, 300);
}
// 第 2 格：按住不动 → 待放的那个四周一圈圈往外扩的波纹（电脑、手机都通用，不画鼠标也不画手指）→ 一个接一个连着往下掉
const TUT_RAIN = [[1, 48, TUT_FL], [0, 36, TUT_FL], [0, 60, TUT_FL], [2, 74, TUT_FL], [1, 23, TUT_FL], [0, 48, TUT_FL - 12], [1, 37, TUT_FL - 8], [0, 59, TUT_FL - 8], [0, 14, TUT_FL]];
const TUT_HOLD = 700, TUT_GAP = 230;
function tutRowHold(g, t, st) {
  const L = TUT_HOLD + TUT_RAIN.length * TUT_GAP + 1300, T = t % L, c = 48, dy = 18, fall = 240;
  tutWalls(g, 11, 85);
  const n = T < TUT_HOLD ? 0 : Math.min(TUT_RAIN.length, Math.floor((T - TUT_HOLD) / TUT_GAP) + 1);   // 已经放出去几个
  TUT_RAIN.forEach(([k, x, fy], i) => {
    if (i >= n) return;
    const p = Math.min(1, (T - TUT_HOLD - i * TUT_GAP) / fall), h = spH(k) * TUT_DS;
    tutSprite(g, k, Math.round(c + (x - c) * p), dy + p * p * (fy - dy), { s: TUT_DS });
  });
  // 按着的这段时间：待放的那个身上一圈圈波纹往外扩、变淡（每 360ms 一圈），松手（这一轮放完）就停
  const holding = T < TUT_HOLD + TUT_RAIN.length * TUT_GAP, oy = dy - 6;
  if (holding) for (let w = Math.floor(T / 360); w >= 0 && w > Math.floor(T / 360) - 3; w--) {
    const a = (T - w * 360) / 1000; if (a > 1) continue;
    const R = Math.round(5 + a * 14), m = Math.max(12, R * 4);
    g.fillStyle = `rgba(255,246,224,${(0.95 * (1 - a)).toFixed(2)})`;
    for (let j = 0; j < m; j++) { const an = j / m * Math.PI * 2; g.fillRect(Math.round(c + Math.cos(an) * R), Math.round(oy + Math.sin(an) * R * 0.8), 1, 1); }
  }
  if (holding && n < TUT_RAIN.length) tutSprite(g, TUT_RAIN[n][0], c, dy, { s: TUT_DS });   // 待放的
}
// 第 3 格（用户定的配图）：上面一条染灰的「获得成就」横幅（同游戏里的成就横条，缩小）从顶上滑下来，落下时抖一下——美梦里拿不到；
// 下面两个最高分：左边普通（棕字），右边美梦（蓝紫字 DREAM_BEST_CARD，同结束页），中间一个红色「≠」；美梦那个一路涨，普通那个纹丝不动
const TUT_DIG = ['###', '#.#', '#.#', '#.#', '###', '.#.', '##.', '.#.', '.#.', '###', '###', '..#', '###', '#..', '###', '###', '..#', '###', '..#', '###', '#.#', '#.#', '###', '..#', '..#',
  '###', '#..', '###', '..#', '###', '###', '#..', '###', '#.#', '###', '###', '..#', '.#.', '.#.', '.#.', '###', '#.#', '###', '#.#', '###', '###', '#.#', '###', '..#', '###',
  '...', '.#.', '###', '.#.', '...'];   // 10 = 「+」（分数飘字用）
function tutNum(g, str, cx, y, col, s = 2) {   // 3×5 小数字（s 倍），居中；'+' 也认
  const w = (str.length * 4 - 1) * s; let x = Math.round(cx - w / 2);
  g.fillStyle = col;
  for (const ch of str) { const d = ch === '+' ? 10 : +ch; for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (TUT_DIG[d * 5 + j][i] === '#') g.fillRect(x + i * s, y + j * s, s, s); x += 4 * s; }
}
// 带 1 像素深色描边的小数字：浅色相框上金字也读得清（游戏里的 +N 飘字也是这套：亮字 + 深描边）
function tutNumOut(g, str, cx, y, fill, edge, s = 2) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) tutNum(g, str, cx + dx, y + dy, edge, s);
  tutNum(g, str, cx, y, fill, s);
}
let tutCup = null;
function tutRowNoAch(g, t, st) {
  const L = 3600, T = t % L;
  g.fillStyle = '#d4e1e3'; g.fillRect(0, 0, TUT_FW, TUT_FH);   // 这格不要地板
  // 灰横幅：72×22（标题带 5 + 正文），直接在位上出现，像被锁住一样左右微微震一下；
  // 不做从上面滑下来的弹出（那看着像刚解锁成就，用户 2026-11-11 改）
  const bw = 72, bh = 22, bx0 = (TUT_FW - bw) / 2, by = 4, jt = T - 120;
  const jx = jt >= 0 && jt < 390 ? [0, 1, -1, 1, -1, 1, 0][Math.min(6, Math.floor(jt / 55))] : 0;
  const bx = bx0 + jx;
  g.fillStyle = '#5a5450'; g.fillRect(bx - 1, by - 1, bw + 2, bh + 2); g.fillRect(bx, by + bh + 1, bw, 2);   // 深灰描边 + 底边投影
  g.fillStyle = '#d8d4cc'; g.fillRect(bx, by, bw, bh);
  g.fillStyle = '#a19c94'; g.fillRect(bx, by, bw, 5);                                    // 标题带（游戏里是金色）
  g.fillStyle = '#c8c3ba'; g.fillRect(bx + 26, by + 2, bw - 52, 1);                      // 带上那行小字（示意）
  g.fillStyle = '#bdb8af'; g.fillRect(bx + 3, by + 7, 13, 13);                           // 头像牌
  if (!tutCup) tutCup = PX.icon('cup');
  g.globalAlpha = 0.35; g.filter = 'grayscale(1)'; g.drawImage(tutCup, bx + 4, by + 8); g.filter = 'none'; g.globalAlpha = 1;
  g.fillStyle = '#9a958d'; g.fillRect(bx + 20, by + 9, 34, 3); g.fillStyle = '#b4afa6'; g.fillRect(bx + 20, by + 15, 46, 2);   // 名字 + 说明（灰条示意）
  // 两个最高分
  const sc = String(Math.round(Math.min(1, Math.max(0, (T - 500) / 2400)) * 25800)), y = 36;
  tutNum(g, '3920', 22, y, '#6b4a36');
  tutNum(g, sc, 70, y, DREAM_BEST_CARD);
  if (Math.random() < 0.05) tutStars(st, 70, y + 5, 18, 1, false, NIGHT_STARS);
  const ne = Math.floor(T / 500) % 2 ? '#e0503c' : '#c8402f';   // 「≠」：两道横 + 一道斜杠
  g.fillStyle = ne; g.fillRect(41, y + 3, 7, 1); g.fillRect(41, y + 6, 7, 1);
  for (let i = 0; i < 7; i++) g.fillRect(47 - i, y + 1 + i * 1.3 | 0, 1, 1);
}
// ---- 「摇一摇」一课（2026-11-11）：美梦里第一次真正开局时弹（顶栏正中键第一次有用的时候）。
// 三格都用美梦的夜空配色（NIGHT + 金）：① 顶栏键和能量豆、金豆怎么攒；② 摇杆（按住左右甩、4 秒）；
// ③ 把堆摇散、摇出连锁合成，摇的时候不判红线。小元素全部 1 精灵像素 = 1 逻辑像素，和相框其它课同一套。
const TUT_SH = { o: '#120e2a', f: '#2c2858', h: '#4a4590', gold: '#ffd25e', pale: '#fff1c8', red: '#ff7a6b' };
const TUT_SH_BEAN = { '#': '#4a2e20', h: '#fff1a8', o: '#ffd25e', d: '#c88a1e' };
// 切角方片（像素圆角）：横竖两块叠成，切角大小 cut
function tutShape(g, x, y, w, h, cut, c) {
  g.fillStyle = c;
  g.fillRect(x + cut, y, w - cut * 2, h);
  g.fillRect(x, y + cut, cut, h - cut * 2);
  g.fillRect(x + w - cut, y + cut, cut, h - cut * 2);
}
// 奶白键：深棕 2 像素描边 + 奶白面 + 底下 6 像素实心底影（同游戏 .px 的 box-shadow：0 6px 0 0）；base=false 只要键、不要底影
function tutPanel(g, x, y, w, h, edge, fill, cut = 3, base = true) {
  if (base) { g.fillStyle = edge; g.fillRect(x + 2, y + h - 2, w - 4, 6); }   // 底影：面底往下 6 像素（含 2 像素下描边，露在外面 4 像素）
  tutShape(g, x, y, w, h, cut, edge);
  tutShape(g, x + 2, y + 2, w - 4, h - 4, Math.max(1, cut - 2), fill);
}
function tutDisc(g, cx, cy, r, c) {   // 1 像素一格的实心圆
  g.fillStyle = c;
  for (let y = -r; y < r; y++) {
    const hw = Math.floor(Math.sqrt(Math.max(0, r * r - (y + 0.5) * (y + 0.5))));
    g.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2, 1);
  }
}
function tutStarPx(g, x, y, c, big = false) {
  g.fillStyle = c; g.fillRect(x, y, 1, 1);
  if (big) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); }
}
// 顶栏九宫格能量豆（和游戏里一样 3×3、每颗 3×3 像素；从左上按读书顺序亮）。s=2 是键上的原尺寸，s=1 给缩小版
function tutBeans(g, x, y, n, flash = -1, s = 2) {
  const ON = ['hho', 'hod', 'odd'], OFF = ['sss', 'see', 'see'], NEW = ['www', 'www', 'www'];
  const pal = { h: '#fff1a8', o: '#ffd25e', d: '#c88a1e', s: '#c4ae88', e: '#e2cfa8', w: '#ffffff' };
  for (let i = 0; i < 9; i++) {
    const art = i === flash ? NEW : i < n ? ON : OFF, X = x + (i % 3) * 4 * s, Y = y + Math.floor(i / 3) * 4 * s;
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) { g.fillStyle = pal[art[j][k]]; g.fillRect(X + k * s, Y + j * s, s, s); }
  }
}
// 按实际占用的槽位画（九宫格里任意格都可能先亮——第三排鱼豆会飞到后面的格子；不能只画前 n 格）
// 摇一摇键（C2 样式）：方键（图标）+ 右边描边九宫格。s = 每格几逻辑像素（2 = 游戏里原尺寸，1 = 缩小版）。
// 方键 13s 见方，隔 5s 是 13s 见方的九宫格（1 格深棕描边）；返回九宫格左上角 gx。
// fill：方键面色（摇的时候暖金）；alpha：图标和九宫格的透明度（没豆时 0.55，键面不淡）；jit：图标抖动的横向偏移
function tutShakeKey(g, kx, ky, { s = 2, fill = '#fff6e0', base = true, alpha = 1, slots = null, n = 0, flash = -1, jit = 0, icon = 'shake', jy = 0 } = {}) {
  // 键面照游戏里 .px 的画法按 s 等比画（2026-11-14 用户指出缩小版的边框没跟着缩）：描边 = s 宽、四角各缺 s×s（box-shadow 不盖角），
  // 面顶高光 / 面底暗线各 s 高，底下的厚边 3s（base = false 时不画，只削去阴影）
  const K = 13 * s, gx = kx + K + 5 * s, on = fill !== '#fff6e0', wet = icon === 'water';
  g.fillStyle = '#4a2e20';
  g.fillRect(kx - s, ky, K + 2 * s, K); g.fillRect(kx, ky - s, K, K + 2 * s);
  if (base) g.fillRect(kx, ky + K, K, 3 * s);
  g.fillStyle = fill; g.fillRect(kx, ky, K, K);
  g.fillStyle = on ? (wet ? '#eef7f3' : '#fff6d0') : '#fffdf4'; g.fillRect(kx, ky, K, s);            // 面顶高光（同游戏 .px 的 inset）
  g.fillStyle = on ? (wet ? '#8fc4b4' : '#e8c070') : '#e2cfa8'; g.fillRect(kx, ky + K - s, K, s);    // 面底暗线
  g.globalAlpha = alpha;
  const ic = PX.ICONS[icon];   // 图标在方键里居中（同游戏里 flex 居中）
  tutShakeRect(g, kx + Math.floor((13 - ic[0].length) / 2 * s) + jit, ky + Math.floor((13 - ic.length) / 2 * s) + jy, s, icon);
  g.fillStyle = '#4a2e20'; g.fillRect(gx, ky, K, K);
  if (slots) tutBeansSlots(g, gx + s, ky + s, slots, flash, s); else tutBeans(g, gx + s, ky + s, n, flash, s);
  g.globalAlpha = 1;
  return gx;
}
function tutBeansSlots(g, x, y, slots, flash = -1, s = 2) {
  const ON = ['hho', 'hod', 'odd'], OFF = ['sss', 'see', 'see'], NEW = ['www', 'www', 'www'];
  const pal = { h: '#fff1a8', o: '#ffd25e', d: '#c88a1e', s: '#c4ae88', e: '#e2cfa8', w: '#ffffff' };
  const on = new Set(slots);
  for (let i = 0; i < 9; i++) {
    const art = i === flash ? NEW : on.has(i) ? ON : OFF, X = x + (i % 3) * 4 * s, Y = y + Math.floor(i / 3) * 4 * s;
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) { g.fillStyle = pal[art[j][k]]; g.fillRect(X + k * s, Y + j * s, s, s); }
  }
}
function tutBean(g, x, y, s = 2) {   // 飞行的金豆（5×5，带深棕描边，同 drawFly）
  const rows = ['.###.', '#hho#', '#hod#', '#odd#', '.###.'];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
    const c = TUT_SH_BEAN[rows[j][i]];
    if (c) { g.fillStyle = c; g.fillRect(Math.round(x + i * s), Math.round(y + j * s), s, s); }
  }
}
// 相框里飞的金豆：照游戏里 drawFly 同一套——出发时大一号、身后一串由亮到暗的金色残影、
// 外面一圈一闪一闪的光晕、长短交替的十字星芒，再画 5×5 带深棕描边的豆子（同九宫格）。
// (x, y) = 豆子中心，k = 飞行进度 0..1（和游戏里一样：前 12% 大一号、后 18% 小一号），(vx, vy) = 来路方向（残影拖在身后）
function tutBeanFly(g, x, y, k, T, vx = 0, vy = 0) {
  const pulse = Math.floor(T / 70) % 2, w = 5 * (k < 0.12 ? 4 : k > 0.82 ? 2 : 3);
  const vl = Math.hypot(vx, vy);
  if (vl > 0.01) for (let j = 6; j >= 1; j--) {   // 残影：沿来路往回取几个点，由亮到暗、由大到小
    const d = j * w * 0.22, bx = x - vx / vl * d, by = y - vy / vl * d, sz = j < 3 ? 4 : 2;
    g.fillStyle = NIGHT_STARS[Math.min(3, j >> 1)];
    g.fillRect(Math.round(bx) - sz / 2, Math.round(by) - sz / 2, sz, sz);
  }
  tutDisc(g, x, y, w / 2 + 6 + pulse * 2, 'rgba(255,241,168,.45)');
  tutDisc(g, x, y, w / 2 + 2, 'rgba(255,255,255,.55)');
  const rl = Math.round(w / 2 + (pulse ? 10 : 6));   // 十字星芒：横竖两道白光，长短交替
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(x) - rl, Math.round(y) - 1, rl * 2, 2);
  g.fillRect(Math.round(x) - 1, Math.round(y) - rl, 2, rl * 2);
  tutBean(g, x - w / 2, y - w / 2, w / 5);
}
// 把精灵水平翻转画（大鱼相消：两条大肥鱼面对面）：cx 是精灵中心 x，fy 是脚底 y；o.gold / o.phase 同 tutSprite
function tutSpriteFlip(g, k, cx, fy, o = {}) {
  const sc = o.s || 1, w = spW(k) * sc, h = spH(k) * sc, x = Math.round(cx - w / 2), y = Math.round(fy - h), sp = sprites[k], gs = o.gold && goldSprite(k);
  if (!gs) {
    if (!ok(sp)) return;
    g.save(); g.translate(x + w, y); g.scale(-1, 1); g.drawImage(sp, 0, 0, w, h); g.restore();
    return;
  }
  paintGlint(tutTmp, tutTmpCtx, gs, o.phase || 0);
  if (sc < 0.9) { const rim = tutGoldRim(k); if (rim) { g.save(); g.translate(x - 2 + w + 4, y - 2); g.scale(-1, 1); g.drawImage(rim, 0, 0, w + 4, h + 4); g.restore(); } }
  g.save(); g.translate(x - 1 + w + 2, y - 1); g.scale(-1, 1); g.drawImage(tutTmp, 0, 0, w + 2, h + 2); g.restore();
}
// 木框（同游戏里的容器，可带摇一摇的偏移）
function tutWoodWalls(g, l, r, top, bx = 0, by = 0) {
  for (const x of [l - 2 + bx, r + 1 + bx]) {
    g.fillStyle = '#8a5a36'; g.fillRect(x, top + by, 2, TUT_FL - top);
    g.fillStyle = '#c99a66'; g.fillRect(x, top + by, 1, TUT_FL - top);
  }
}
// 一圈 1 像素的计时边（从左上顺时针），frac 是还剩多少；用完的部分画成暗线，边界加一个亮头
function tutPerim(g, x, y, w, h, frac, on, off) {
  const per = 2 * (w + h), n = Math.round(per * frac);
  const at = (i) => i < w ? [x + i, y] : i < w + h ? [x + w - 1, y + i - w] : i < 2 * w + h ? [x + w - 1 - (i - w - h), y + h - 1] : [x, y + h - 1 - (i - 2 * w - h)];
  for (let i = 0; i < per; i++) { const [px, py] = at(i); g.fillStyle = i < n ? on : off; g.fillRect(px, py, 1, 1); }
  if (n > 0 && n < per) { const [px, py] = at(n); g.fillStyle = '#fff6e0'; g.fillRect(px - 0, py - 0, 2, 2); }
}
// 摇一摇图标：和这一页其它元素一样，按 1 像素一格 fillRect 画（s = 每格几逻辑像素），不用 drawImage 缩放贴图（同微信版）
function tutShakeRect(g, x, y, s = 1, icon = 'shake') {
  const rows = PX.ICONS[icon], pal = PX.ICON_PAL;
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
    const c = pal[rows[j][i]];
    if (c) { g.fillStyle = c; g.fillRect(x + i * s, y + j * s, s, s); }
  }
}
// 第 1 格：消耗一颗金豆开启 → 整框猛摇 4 秒：一框的精灵被甩得乱跳、连出 3 次合成（8 个小的 → 5 个更大的）
const TUT_COST_L = 6000;
function tutRowShakeCost(g, t, st) {
  const L = TUT_COST_L, T = t % L, start = 520, go = start + 480, end = go + 4000;
  const shakeOn = T >= go && T < end;
  const amp = shakeOn ? 5.5 * Math.exp(-(T - go) / 1800) + 1 : 0;
  const bx = Math.round(Math.sin((T - go) / 65) * amp), by = shakeOn ? Math.round(Math.sin((T - go) / 47) * 1.5) : 0;
  const prev = Math.max(0, T - 55), amp0 = prev >= go && prev < end ? 5.5 * Math.exp(-(prev - go) / 1800) + 1 : 0;
  const dx = bx - Math.round(Math.sin((prev - go) / 65) * amp0);
  const l = 10, r = 86, top = 24, moving = T >= go && T < end, move = moving ? Math.min(1, (T - go) / 180) : 1;
  // 地板（跟着框走）
  g.fillStyle = '#8a5a36'; g.fillRect(l + bx, TUT_FL + by, r - l, 4);
  g.fillStyle = '#b07a4c'; g.fillRect(l + bx, TUT_FL + by, r - l, 1);
  // 8 个物件挤满整个框：3 个面窝打底、2 个饭团、3 个小笼包（前后错开，看起来像真的堆）
  const pile = [
    { k: 2, x: 24, seed: 0 }, { k: 2, x: 72, seed: 1 },
    { k: 1, x: 40, seed: 2 }, { k: 1, x: 56, seed: 3 }, { k: 1, x: 80, seed: 4 },
    { k: 0, x: 14, seed: 5 }, { k: 0, x: 44, seed: 6 }, { k: 0, x: 68, seed: 7 },
  ].map((p, i) => ({ ...p, id: i }));
  // 3 次合成：小笼包+小笼包→饭团，饭团+饭团→面窝，面窝+面窝→白米饭
  const merges = [
    { at: 1500, ids: [5, 6], k: 1, x: 29 },
    { at: 2000, ids: [2, 3], k: 2, x: 48 },
    { at: 2500, ids: [0, 1], k: 3, x: 62 },
  ];
  const dead = new Set();
  for (const m of merges) if (T >= m.at) for (const id of m.ids) dead.add(id);
  // 每个精灵：跟着框的偏移 + 自己的相位乱跳，再往框里夹一下（不会飞出墙外）
  const draw = (k, x, seed, pop = 0) => {
    const half = spW(k) / 2;
    const wob = moving ? Math.sin((T - go) / (80 + seed * 9) + seed) * 3.5 * move : 0;
    const hop = moving ? Math.abs(Math.sin((T - go) / (95 + seed * 7) + seed * 0.7)) * (4 + seed % 4) * move : 0;
    const xx = Math.max(l + half, Math.min(r - half, x + bx + wob - Math.max(-4, Math.min(4, dx * 1.3))));
    tutSprite(g, k, xx, TUT_FL + by - hop - pop);
  };
  for (const p of pile) if (!dead.has(p.id)) draw(p.k, p.x, p.seed);
  // 合成结果（更大的物件）从合成处冒出来；合成处炸一圈金星
  for (let i = 0; i < merges.length; i++) {
    const m = merges[i];
    if (T < m.at) continue;
    const a = T - m.at;
    draw(m.k, m.x, 20 + i, a < 160 ? 2 : 0);
    if (a < 420) {
      const q = a / 420, rad = 3 + q * 15;
      g.globalAlpha = Math.max(0, 0.65 - q * 0.65); tutDisc(g, m.x + bx, TUT_FL - 10, 8, '#fff1c8'); g.globalAlpha = 1;
      for (let j = 0; j < 10; j++) {
        const an = j / 10 * Math.PI * 2;
        tutStarPx(g, Math.round(m.x + bx + Math.cos(an) * rad), Math.round(TUT_FL - 10 + Math.sin(an) * rad), j % 2 ? TUT_SH.pale : TUT_SH.gold, q < 0.4 && j % 3 === 0);
      }
      g.globalAlpha = Math.max(0, 0.8 - q * 0.8); const ring = 2 + q * 13;
      for (let j = 0; j < 22; j++) { const an = j / 22 * Math.PI * 2; g.fillStyle = q < 0.5 ? TUT_SH.gold : TUT_SH.pale; g.fillRect(Math.round(m.x + bx + Math.cos(an) * ring), Math.round(TUT_FL - 10 + Math.sin(an) * ring), 1, 1); }
      g.globalAlpha = 1;
    }
  }
  tutWoodWalls(g, l, r, top, bx, by);
  // 框外一圈金色计时边：4 秒从满到空（最后 1 秒变红闪）
  const left = T < go ? 1 : Math.max(0, 1 - (T - go) / 4000);
  const hurry = T >= go && T > end - 1000, blink = hurry && Math.floor(T / 110) % 2 === 0;
  const onCol = blink ? TUT_SH.pale : hurry ? TUT_SH.red : TUT_SH.gold;
  tutPerim(g, l - 3 + bx, top - 3 + by, r - l + 6, TUT_FL - top + 6, left, onCol, 'rgba(74,46,32,.35)');
  // 甩动时框外拖白速度线
  if (Math.abs(dx) > 1) {
    g.fillStyle = 'rgba(255,255,255,.55)';
    const side = dx > 0 ? l + bx - 6 : r + bx + 4;
    for (let i = 0; i < 3; i++) g.fillRect(side, 24 + i * 9, Math.min(7, Math.abs(dx) * 3), 1);
  }
  // 顶栏键：1 颗金豆 → 消耗掉；摇的时候键面变暖金、木箱图标抖
  const kOn = T >= start && T < end + 220, jit = kOn ? Math.round(Math.sin(T / 40)) : 0;
  const kx = 33, ky = 5;   // 缩小版 C2 键（方键 13 + 空 5 + 九宫格 13 = 31 宽，居中在相框 96 里）；小键不要底影（用户 2026-11-11：压在框顶上不好看）
  const gx = tutShakeKey(g, kx, ky, { s: 1, fill: kOn ? '#ffeaa0' : '#fff6e0', base: false, n: T >= start + 120 ? 0 : 1, flash: T >= start + 40 && T < start + 220 ? 0 : -1, jit });
  // 被消耗的金豆：从键里掉进框里（和游戏里飞豆同一套残影/光晕/星芒），砸出一圈金星，框就开始猛摇
  if (T >= start && T < go) {
    const k = (T - start) / (go - start), e = k * k * (3 - 2 * k);
    const bxx = gx + 2 - 2 * e, byy = ky + 2 + 18 * e;   // 从九宫格第一格掉出来
    const k0 = Math.max(0, k - 0.06), e0 = k0 * k0 * (3 - 2 * k0);
    tutBeanFly(g, bxx, byy, k, T, bxx - (gx + 2 - 2 * e0), byy - (ky + 2 + 18 * e0));
    if (k > 0.7) {
      const q = (k - 0.7) / 0.3;
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; tutStarPx(g, Math.round(bxx + Math.cos(a) * (3 + q * 9)), Math.round(byy + Math.sin(a) * (3 + q * 9)), i % 2 ? TUT_SH.pale : TUT_SH.gold, q < 0.4 && i % 3 === 0); }
    }
  }
  // 摇完：框外冒一圈金星
  if (T >= end && T < end + 300) {
    const a = (T - end) / 300, rad = 20 + a * 16;
    for (let i = 0; i < 12; i++) { const an = i / 12 * Math.PI * 2; tutStarPx(g, Math.round(48 + Math.cos(an) * rad), Math.round(34 + Math.sin(an) * rad * 0.65), i % 2 ? TUT_SH.pale : TUT_SH.gold, a < 0.4 && i % 3 === 0); }
  }
}

// 摇一摇第二排 / 第三排共享的状态：九宫格已经填了哪些格（槽位）、金豆飞行、满格清零。
// 第二排自己涨分到门槛也会加豆；第三排的豆也飞进同一个九宫格。九宫格满了：第三排的豆照飞、飞到格子就消失（不削减产出）；
// 第二排下一次到门槛时发现格子满了 → 停一会儿 → 清零重开。
// 关键：每颗豆在起飞时就**占住一个具体的格**（slot），飞行途中别的豆不能占同一格；到格时填自己那一格。
// 之前用「已点亮数 + 在飞数量」现算目标，第二排自己的豆不在这个数里，到了又按「下一个空格」填，所以会瞄错格。
const TUT_BEAN_MAX = 9;
let TS = null;
const tsNew = (L = TUT.shake) => ({ slots: [], beans: 0, scoreSlot: -1, flash: -1, flashUntil: 0, bobUntil: 0, fx: [], poofs: [], holdUntil: 0, holdScore: 0, at: L.beans, icon: L.icon });
const tsEnsure = () => (TS || (TS = tsNew()));
function tsFreeSlot() {   // 下一个空槽：已填的、在飞的鱼豆、第二排自己在飞的那颗，都算被占
  if (!TS) return -1;
  const used = new Set(TS.slots);
  for (const f of TS.fx) if (f.slot >= 0) used.add(f.slot);
  if (TS.scoreSlot >= 0) used.add(TS.scoreSlot);
  for (let i = 0; i < TUT_BEAN_MAX; i++) if (!used.has(i)) return i;
  return -1;
}
function tsFill(t, slot) {   // 这颗豆到了，填它起飞时占的那一格（不再按当前数量找下一格）
  if (!TS || slot < 0 || slot >= TUT_BEAN_MAX || TS.slots.includes(slot)) return false;
  TS.slots.push(slot); TS.slots.sort((a, b) => a - b); TS.beans = TS.slots.length;
  TS.flash = slot; TS.flashUntil = t + 220; TS.bobUntil = t + 180;
  return true;
}
function tsHold(t, score) {
  if (!TS || TS.holdUntil) return;
  TS.holdUntil = t + 1200; TS.holdScore = score;   // 「稍微等一下，然后从头开始」
}
function tsClearBeans(t = 0) {
  if (!TS) return;
  TS.slots = []; TS.beans = 0; TS.scoreSlot = -1; TS.flash = -1; TS.flashUntil = 0; TS.bobUntil = 0;
  TS.poofs.length = 0;
  // 九宫格刷新时，在途的鱼豆立刻改瞄新九宫格的空格并占住（不能留着旧的格号，最后会瞄错/填错）。
  // 目标不瞬移：记下旧目标，飞行里用 40–220ms 把目标平滑挪到新格，位置和速度都连续（无大顿挫）。
  const cv2 = tutCur && tutCur.rows && tutCur.rows[1] && tutCur.rows[1].cv;
  TS.fx.forEach((f, i) => {
    const slot = i < TUT_BEAN_MAX ? i : -1;
    const oldX = f.x1, oldY = f.y1;
    f.slot = slot;
    if (cv2) {
      f.x1 = cv2.offsetLeft + tutCellX(slot);
      f.y1 = cv2.offsetTop + tutCellY(slot);
      f.oldX1 = oldX; f.oldY1 = oldY;
      f.blendT0 = t;
      f.blendDur = Math.max(1, Math.min(260, f.dur - (t - f.t0)));   // 在剩余路程内平滑挪到新格（到格时目标刚好到位；起点切线为 0，不顿挫）
    }
  });
}

// 第 2 格（2026-11-11 用户定，按「动画设计哲学」拆成一轮一颗豆；摇一摇、灌水两课共用，门槛和图标取 TS.at / TS.icon）：
// 0 颗（键是游戏里没豆的淡色状态，先停 0.4 秒）→ 2500 第 1 颗 → 10000 第 2 颗 → 20000 … → 80000 第 9 颗填满九宫格（灌水是 800 / 3000 / 6000 … 24000）。
// 每一轮循环只推进一颗豆：分数从上一颗的门槛涨到下一颗，条满、顿一下、金豆飞进新格子；下一轮从下一颗开始。
// 0→2500 是原本速度，之后每轮都按 4 倍速涨。九宫格满了空等 1.6 秒，再回到 0 颗那一轮。
// 这样玩家看一两轮就懂「满条 → 一颗豆」，继续看会看到更高的门槛，不用在一轮里把 9 颗都等完。
const beanAtList = (R) => Array.from({ length: 9 }, (_, i) => i === 0 ? R.first : i === 1 ? R.second : R.second + (i - 1) * R.every);   // 第 1..9 颗金豆的分数
const TUT_IDLE = 400, TUT_GROW0 = 1200, TUT_PAUSE = 650, TUT_FULL = 1600;             // ms：开头空豆停留 / 0→第一颗 时长 / 每颗豆的停顿 / 满格停留
// 「原本」的涨分速度 = 第一颗门槛 / TUT_GROW0；之后每轮 4 倍速
const tutStageGrow = (s) => { const A = TS.at; return s === 0 ? TUT_GROW0 : (A[s] - A[s - 1]) / (A[0] / TUT_GROW0) / 4; };   // s = 0..8
const tutStageDur = (s) => s === 9 ? TUT_FULL : (s === 0 ? TUT_IDLE : 0) + tutStageGrow(s) + TUT_PAUSE;
function tutRowShakeScore(g, t, st) {
  tsEnsure();
  if (st.stage === undefined) { st.stage = 0; st.t0 = 0; st.awarded = false; st.landed = false; st.slot = -1; }
  if (TS.holdUntil) {   // 满格停留：分数停在门槛，等 1.2 秒后清零重开
    if (t < TS.holdUntil) { tutShakeHold(g, t); return; }
    tsClearBeans(t); TS.holdUntil = 0; TS.holdScore = 0;
    st.stage = 0; st.t0 = t; st.awarded = false; st.landed = false; st.slot = -1;
  }
  let guard = 0;
  while (t - st.t0 >= tutStageDur(st.stage) && guard++ < 40) {
    const prev = st.stage;
    st.t0 += tutStageDur(st.stage);
    st.stage = (st.stage + 1) % 10;
    st.awarded = false; st.landed = false; st.slot = -1;
    if (prev === 9) tsClearBeans(t);   // 满格那一轮结束：九宫格清零，在途鱼豆改瞄新格
  }
  const stage = st.stage, el = t - st.t0, full = stage === 9, A = TS.at;
  const from = full ? A[8] : (stage ? A[stage - 1] : 0);
  const to = full ? A[8] : A[stage];
  const idle = stage === 0 ? TUT_IDLE : 0, growDur = full ? 1 : tutStageGrow(stage);
  const pauseStart = idle + growDur, pauseT = el - pauseStart, inPause = !full && el >= pauseStart;
  let p = 0, score = from, beanK = -1;
  if (full) { p = 1; score = A[8]; }
  else if (el < idle) { p = 0; score = 0; }
  else if (!inPause) { p = (el - idle) / growDur; score = from + (to - from) * p; }
  else {
    const flight = TUT_PAUSE * 0.7;
    beanK = Math.min(1, pauseT / flight);
    p = 1; score = to;
    if (!st.awarded) {   // 这一轮到门槛：先占一个空槽（含在飞的鱼豆/自己）；没有空槽就等清零
      st.awarded = true;
      const slot = tsFreeSlot();
      if (slot < 0) tsHold(t, to); else { st.slot = slot; TS.scoreSlot = slot; }
    }
    if (beanK >= 1 && st.slot >= 0 && !st.landed) {
      st.landed = true;
      if (!tsFill(t, st.slot)) tsHold(t, to);   // 填自己起飞时占的那一格
      TS.scoreSlot = -1;
    }
  }
  if (TS.holdUntil) { tutShakeHold(g, t); return; }
  const grow = !full && el >= idle && !inPause;
  const bob = t < TS.bobUntil ? -1 : 0;
  const slots = TS.slots;
  const flash = t < TS.flashUntil ? TS.flash : -1;
  // C2 键：方键 17..43、九宫格 53..79（26 见方，ky 起），进度条在九宫格下沿（和游戏里一样）。位置常量见 TUT_KEY_X/Y
  const kx = TUT_KEY_X, ky = TUT_KEY_Y + bob, gx = kx + 36;
  const bx = gx, by = ky + 28, bw = 26;   // 进度条（金条）的左上角/宽度
  const cellX = (i) => gx + 5 + (i % 3) * 8, cellY = (i) => ky + 5 + Math.floor(i / 3) * 8;   // 九宫格第 i 格的中心
  g.fillStyle = '#d4e1e3'; g.fillRect(0, 0, TUT_FW, TUT_FH);   // 这一格不要地板，只有键
  // 键 + 九宫格：没豆时图标和格子淡到 55%（同游戏 .chip.empty；键面和进度条不淡）
  tutShakeKey(g, kx, ky, { slots, flash, alpha: slots.length > 0 ? 1 : 0.55, icon: TS.icon });
  // 九宫格下沿的进度条：先铺 2 像素深棕框（30×6），再挖 26×2 的凹槽，最后填金
  g.fillStyle = '#4a2e20'; g.fillRect(bx - 2, by - 2, bw + 4, 6);
  g.fillStyle = '#8a6a52'; g.fillRect(bx, by, bw, 2);
  g.fillStyle = TUT_SH.gold; g.fillRect(bx, by, Math.floor(bw * Math.min(1, p) / 2) * 2, 2);
  if (slots.length >= TUT_BEAN_MAX && p >= 1 && Math.floor(t / 500) % 2 === 0) { g.fillStyle = '#fff1a8'; g.fillRect(bx, by, bw, 2); }   // 九宫格满了：整条金色慢闪
  // 分数化成小粒子从上面的分数数字流进进度条（只在涨分时）：从方键和九宫格之间的空当落下去
  if (grow) {
    for (let i = 0; i < 7; i++) {
      const q = (((el - idle) / 620) + i * 0.14) % 1, sx = 44 + (i * 3) % 8, sy = 12, tx = bx + 2 + (i * 7) % (bw - 4);
      const x = sx + (tx - sx) * q * q, y = sy + (by - sy) * q;
      g.globalAlpha = 0.35 + 0.65 * Math.sin(q * Math.PI);
      g.fillStyle = i % 2 ? TUT_SH.pale : TUT_SH.gold; g.fillRect(Math.round(x), Math.round(y), 2, 2);
      g.globalAlpha *= 0.45; g.fillRect(Math.round(x), Math.round(y - 3), 1, 2);
      g.globalAlpha = 1;
    }
  }
  // 条满 / 豆到手：条尾炸一圈金星
  if (inPause && pauseT < 260) {
    const a = pauseT / 260, r = 2 + a * 9, ex = bx + bw, ey = by + 1;
    for (let i = 0; i < 8; i++) { const an = i / 8 * Math.PI * 2; tutStarPx(g, Math.round(ex + Math.cos(an) * r), Math.round(ey + Math.sin(an) * r), i % 2 ? TUT_SH.pale : TUT_SH.gold, a < 0.5 && i % 2 === 0); }
  }
  // 顿一下：第二排自己的金豆从条尾沿弧线飞进新格子（第三排的鱼豆走卡片上层 overlay，见 tutShakeFx）
  if (inPause && st.slot >= 0 && beanK >= 0 && beanK < 1) {
    const sx = bx + bw, sy = by + 1, tx = cellX(st.slot), ty = cellY(st.slot);
    const pos = (u) => { const q = u * u * (3 - 2 * u); return [sx + (tx - sx) * q, sy + (ty - sy) * q - Math.sin(u * Math.PI) * 4 + 0]; };   // 进度条在九宫格下面：从条尾往上弧进格子
    const [x, y] = pos(beanK), [px, py] = pos(Math.max(0, beanK - 0.06));
    tutBeanFly(g, x, y, beanK, t, x - px, y - py);
  }
  // 落格：新亮的那一格白闪 + 一圈金星
  if (inPause && st.slot >= 0 && beanK >= 1 && pauseT - TUT_PAUSE * 0.7 < 260) {
    const a = (pauseT - TUT_PAUSE * 0.7) / 260, cx = cellX(st.slot), cy = cellY(st.slot), r = 2 + a * 9;
    for (let i = 0; i < 8; i++) { const an = i / 8 * Math.PI * 2; tutStarPx(g, Math.round(cx + Math.cos(an) * r), Math.round(cy + Math.sin(an) * r), i % 2 ? TUT_SH.pale : TUT_SH.gold, a < 0.4 && i % 2 === 0); }
    g.globalAlpha = Math.max(0, 0.9 - a * 1.4); g.fillStyle = '#ffffff'; g.fillRect(cx - 3, cy - 3, 6, 6); g.globalAlpha = 1;
  }
  // 分数上涨数字：每一轮从上一颗门槛数到下一颗；落格瞬间白闪一下。画在最后，飞豆光晕不会糊住数字。
  const sc = String(Math.round(score));
  const flashNum = inPause && st.landed && pauseT - TUT_PAUSE * 0.7 < 200;
  tutNum(g, sc, 49, 3, '#4a2e20');                                                       // 深棕投影（浅色天空上也读得清）
  tutNum(g, sc, 48, 2, flashNum ? '#ffffff' : '#f0b828');                                // 亮金数字
  if (grow && Math.random() < 0.06) tutStars(st, 48 + (Math.random() - .5) * 34, 7, 5, 1, false, NIGHT_STARS);
}
// 满格停留：九宫格满了、第二排又到门槛——分数停在门槛、条满着，停 1.2 秒后清零重开
function tutShakeHold(g, t) {
  const kx = TUT_KEY_X, ky = TUT_KEY_Y, gx = kx + 36, bx = gx, by = ky + 28, bw = 26;
  g.fillStyle = '#d4e1e3'; g.fillRect(0, 0, TUT_FW, TUT_FH);
  tutShakeKey(g, kx, ky, { slots: TS.slots, icon: TS.icon });
  g.fillStyle = '#4a2e20'; g.fillRect(bx - 2, by - 2, bw + 4, 6);
  g.fillStyle = Math.floor(t / 500) % 2 ? '#f0b828' : '#fff1a8'; g.fillRect(bx, by, bw, 2);   // 满格：金条慢闪
  const sc = String(Math.round(TS.holdScore));
  tutNum(g, sc, 49, 3, '#4a2e20');
  tutNum(g, sc, 48, 2, '#f0b828');
}
// 第 3 格（2026-11-11 用户定）：大肥鱼相消三幕轮播——两个普通 / 一金一普通 / 双金。
// 每一幕都按游戏里的时停效果做：靠近 → 压暗 + 集中线 → 鱼从接触点变白 → 碎成像素碎屑 →
// 白闪/冲击环 → 游戏里的标题（普通是蓝白「大肥鱼双响」，带金的是金字「镀金双响」/「双金大肥鱼」）→ 金豆飞出来。
// 金豆数和游戏里一致：普通 + 普通 1 颗；一金一普通 随机 1 或 2 颗（每一轮重摇）；双金 2 颗。
const TUT_FISH_L = 3000;   // 每一幕的时长（三幕一轮 = 9 秒）
// n：这一幕给几颗豆（函数 = 每轮重摇）。摇一摇用美梦的规则，灌水用普通模式的规则（shakeFishGain 第二个参数指定模式）
const TUT_FISH_SCENES = [
  { g: [false, false], title: TX.合成特效标题.大肥鱼双响, theme: 'blue', n: 1 },
  { g: [true, false], title: TX.合成特效标题.镀金双响, theme: 'gold', n: () => shakeFishGain(1, true) },   // 50% 1 颗 / 50% 2 颗
  { g: [true, true], title: TX.合成特效标题.双金大肥鱼, theme: 'gold', n: 2 },
];
// 灌水课（普通模式）：合出大肥鱼 1 颗、合出镀金大肥鱼 1 或 2 颗、普通双响 2 颗、带镀金的双响 3 颗
const TUT_WFISH_SCENES = [
  { make: true, g: [false, false], title: TX.合成特效标题.大肥鱼, theme: 'blue', n: 1 },
  { make: true, g: [true, false], title: TX.合成特效标题.镀金大肥鱼, theme: 'gold', n: () => fishMakeGain(true) },
  { g: [false, false], title: TX.合成特效标题.大肥鱼双响, theme: 'blue', n: 2 },
  { g: [true, false], title: TX.合成特效标题.镀金双响, theme: 'gold', n: 3 },
];
let tutFishLayer = null, tutFishCtx = null;
function tutFishPair(g, nl, nr, s, fy, gl, T) {
  const w = spW(10) * s;
  tutSpriteFlip(g, 10, nl - w / 2, fy, { s, gold: gl[0], phase: (T / 2200 + 0.15) % 1 });
  tutSprite(g, 10, nr + w / 2, fy, { s, gold: gl[1], phase: (T / 2200 + 0.55) % 1 });
}
const tutRowShakeFish = (g, t, st) => tutRowFishBeans(g, t, st, TUT_FISH_SCENES);
const tutRowWaterFish = (g, t, st) => tutRowFishBeans(g, t, st, TUT_WFISH_SCENES);
function tutRowFishBeans(g, t, st, SC) {
  const L = TUT_FISH_L * SC.length, T = t % L;
  const si = Math.floor(T / TUT_FISH_L), T0 = T - si * TUT_FISH_L, S = SC[si];
  if (st.scene !== si) { st.scene = si; st.sh = null; st.spawn = []; st.beans = typeof S.n === 'function' ? S.n() : S.n; }   // 随机的那幕每轮重摇（同游戏里的随机）
  const goldPair = S.g[0] || S.g[1], hitT = 620, n = st.beans;
  if (S.make) tutFishMake(g, T0, st, S, si);
  else {
  const p = Math.min(1, T0 / hitT), s = 0.45;
  const nl = 38 + 12 * p, nr = 58 - 12 * p, fy = 52;
  const dark = T0 < hitT ? 0 : T0 < 2500 ? 0.58 : Math.max(0, 0.58 * (1 - (T0 - 2500) / 500));   // 压暗一直持续到这一幕结束，别留一帧空蓝天
  // 两条鱼从两边靠近，鼻尖撞在一起（带金的那条会扫反光）
  if (T0 < hitT) tutFishPair(g, nl, nr, s, fy, S.g, T0 + si * TUT_FISH_L);
  // 时停：整格压暗 + 从撞击点射出的集中线（带金的一对用金色线，普通的用蓝白线，同游戏）
  if (dark > 0) {
    g.fillStyle = `rgba(16,20,36,${dark.toFixed(2)})`; g.fillRect(0, 0, TUT_FW, TUT_FH);
    if (T0 >= hitT) {
      const seed = Math.floor(T0 / 50);
      g.fillStyle = goldPair ? 'rgba(255,233,138,.55)' : 'rgba(220,239,255,.5)';
      for (let i = 0; i < 18; i++) {
        const a = (i / 18 + ((seed * 9301 + i * 49297) % 233) / 233 / 18) * Math.PI * 2, r0 = 14 + ((seed * 31 + i * 17) % 20);
        for (let d = r0; d < 62; d += 5) g.fillRect(Math.round(48 + Math.cos(a) * d), Math.round(30 + Math.sin(a) * d), 1, 1);
      }
    }
  }
  // 撞上的白闪（先压暗再闪，鱼在闪之后变白）
  if (T0 >= hitT && T0 < hitT + 90) { g.globalAlpha = 0.55 * (1 - (T0 - hitT) / 90); g.fillStyle = '#ffffff'; g.fillRect(0, 0, TUT_FW, TUT_FH); g.globalAlpha = 1; }
  // 鱼从接触点整只变白（用离屏层 source-atop 上色），然后就不画鱼了——它们是碎掉的
  if (T0 >= hitT && T0 < hitT + 150) {
    if (!tutFishLayer) { tutFishLayer = document.createElement('canvas'); tutFishLayer.width = TUT_FW; tutFishLayer.height = TUT_FH; tutFishCtx = tutFishLayer.getContext('2d'); }
    tutFishCtx.clearRect(0, 0, TUT_FW, TUT_FH);
    tutFishPair(tutFishCtx, nl, nr, s, fy, S.g, T0 + si * TUT_FISH_L);
    tutFishCtx.globalCompositeOperation = 'source-atop';
    tutFishCtx.fillStyle = `rgba(255,255,255,${Math.min(1, (T0 - hitT) / 80).toFixed(2)})`;
    tutFishCtx.fillRect(0, 0, TUT_FW, TUT_FH);
    tutFishCtx.globalCompositeOperation = 'source-over';
    g.drawImage(tutFishLayer, 0, 0);
  }
  // 白闪核心 + 冲击环（普通蓝白、带金金色）+ 小星
  if (T0 >= hitT && T0 < hitT + 520) {
    const q = (T0 - hitT) / 520, rad = 4 + q * 32;
    g.globalAlpha = Math.max(0, 0.9 - q * 1.6); tutDisc(g, 48, 30, 8 + q * 5, '#ffffff'); g.globalAlpha = 1;
    g.globalAlpha = Math.max(0, 0.85 - q * 0.85);
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * Math.PI * 2;
      g.fillStyle = goldPair ? (i % 2 ? '#fff1c8' : '#ffd25e') : (i % 2 ? '#dcefff' : '#9fd0ff');
      g.fillRect(Math.round(48 + Math.cos(a) * rad), Math.round(30 + Math.sin(a) * rad), 1, 1);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; tutStarPx(g, Math.round(48 + Math.cos(a) * (6 + q * 22)), Math.round(30 + Math.sin(a) * (6 + q * 22)), goldPair ? TUT_SH.gold : '#dcefff', q < 0.4 && i % 2 === 0); }
  }
  // 两条鱼碎成 30 颗像素碎屑（普通蓝白、带金金色，掺一点白），从撞击点往外飞、略微下落
  if (T0 >= hitT + 40 && T0 < hitT + 700) {
    if (!st.sh || T0 < st.shT) {
      st.sh = []; st.shT = hitT + 40;
      const cols = goldPair ? ['#ffffff', '#fff1c8', '#ffd25e', '#e8b84a'] : ['#ffffff', '#dcefff', '#9fd0ff', '#5aa6e8'];
      for (let i = 0; i < 30; i++) {
        const side = i % 2, x = side ? 14 + Math.random() * 32 : 50 + Math.random() * 34, y = 20 + Math.random() * 28;
        const dx = x - 48, dy = y - 30, l = Math.hypot(dx, dy) || 1, sp = 10 + Math.random() * 22;
        st.sh.push({ x, y, vx: dx / l * sp + (Math.random() - .5) * 6, vy: dy / l * sp - 8 - Math.random() * 8, c: i % 9 === 0 ? (goldPair ? '#ffffff' : '#ffe98a') : cols[i % 4] });
      }
    }
    const k = (T0 - st.shT) / 660;
    for (const q of st.sh) {
      if (k > 1) break;
      const x = q.x + q.vx * k, y = q.y + q.vy * k + 14 * k * k, sz = k < 0.35 ? 6 : k < 0.65 ? 4 : 2;
      if (x < -6 || x > TUT_FW + 6 || y < -6 || y > TUT_FH + 6) continue;
      g.fillStyle = q.c; g.fillRect(Math.round(x) - sz / 2, Math.round(y) - sz / 2, sz, sz);
    }
  }
  }
  // 游戏里的标题从下面弹出来（普通蓝白、带金金字，文字和配色都取自游戏同一套 TITLE_STYLE）
  if (T0 >= 900) {
    const tc = titleCanvas(S.title, false, S.theme);
    const a = Math.min(1, (T0 - 900) / 160), y = 33 - Math.min(2, (T0 - 900) / 90);
    const ta = T0 < 2700 ? 1 : Math.max(0, 1 - (T0 - 2700) / 300);   // 标题也留到这一幕结束再退干净
    g.globalAlpha = a * ta; g.drawImage(tc, Math.round(48 - tc.width / 2), Math.round(y)); g.globalAlpha = 1;
    for (const [sx, sy, ph] of [[12, 24, 0], [84, 22, 1.2], [20, 40, 2.1], [78, 42, 0.5]]) {
      const tw = (T0 / 360 + ph) % 3;
      if (tw < 1.2) tutStarPx(g, sx, sy, tw < 0.6 ? TUT_SH.pale : TUT_SH.gold, tw > 0.4 && tw < 1);
    }
  }
  // 产出的金豆从撞击点飞出来：颗数=游戏里这次相消给的豆数。现在它们不再飞出相框消失，
  // 而是走卡片上层 overlay（tutShakeFx）飞进第二排的九宫格；九宫格满了也照样飞，到了格子再消失。
  if (T0 >= 800) {
    tsEnsure();
    const R = tutCur && tutCur.rows;
    for (let j = 0; j < n; j++) {
      const at = 800 + j * 130;
      if (T0 < at || st.spawn[j] || !R || R.length < 3) continue;
      st.spawn[j] = true;
      const cv2 = R[1].cv, cv3 = R[2].cv;
      const dir = n === 1 ? 0 : j === 0 ? -1 : 1;
      const x0 = cv3.offsetLeft + 48 + dir * 8, y0 = cv3.offsetTop + 30;
      const slot = tsFreeSlot();   // 起飞前先占住一个具体的格；没有空槽就去中心、到了消失
      const x1 = cv2.offsetLeft + tutCellX(slot);
      const y1 = cv2.offsetTop + tutCellY(slot);
      TS.fx.push({ x0, y0, x1, y1, t0: t, dur: 1200, slot });
    }
  }
}

// 灌水课第三排的「合出大肥鱼」幕：两只饭盆小鲸从两边撞上 → 白闪 + 冲击环 → 大肥鱼（普通 / 镀金）弹出来顿一下；标题和金豆走上面的共用流程
function tutFishMake(g, T0, st, S, si) {
  const hitT = 620, p = Math.min(1, T0 / hitT), s = 0.45, fy = 50, gold = S.g[0];
  if (T0 < hitT) {
    const w = spW(9) * s, nl = 30 + 14 * p, nr = 66 - 14 * p;
    tutSpriteFlip(g, 9, nl - w / 2 + 4, fy, { s, gold, phase: 0.2 });
    tutSprite(g, 9, nr + w / 2 - 4, fy, { s, phase: 0.6 });
    return;
  }
  const a = T0 - hitT, pop = a < 200 ? 1 + 0.18 * Math.sin(a / 200 * Math.PI) : 1, fade = T0 > 2700 ? Math.max(0, 1 - (T0 - 2700) / 300) : 1;
  g.globalAlpha = fade;
  tutSprite(g, 10, 48, fy + (pop - 1) * 10, { s: s * pop, gold, phase: (T0 / 2200 + si * 0.3) % 1 });
  g.globalAlpha = 1;
  if (a < 90) { g.globalAlpha = 0.6 * (1 - a / 90); g.fillStyle = '#ffffff'; g.fillRect(0, 0, TUT_FW, TUT_FH); g.globalAlpha = 1; }
  if (a < 520) {
    const q = a / 520, rad = 4 + q * 30;
    g.globalAlpha = Math.max(0, 0.85 - q * 0.85);
    for (let i = 0; i < 28; i++) { const an = i / 28 * Math.PI * 2; g.fillStyle = gold ? (i % 2 ? '#fff1c8' : '#ffd25e') : (i % 2 ? '#dcefff' : '#9fd0ff'); g.fillRect(Math.round(48 + Math.cos(an) * rad), Math.round(32 + Math.sin(an) * rad), 1, 1); }
    g.globalAlpha = 1;
    for (let i = 0; i < 10; i++) { const an = i / 10 * Math.PI * 2; tutStarPx(g, Math.round(48 + Math.cos(an) * (6 + q * 20)), Math.round(32 + Math.sin(an) * (6 + q * 20)), gold ? TUT_SH.gold : '#dcefff', q < 0.4 && i % 2 === 0); }
  }
}
// 灌水课第 1 格（2026-11-14）：消耗一颗金豆 → 豆落进框底（扑通）→ 框顶推上木盖 → 水涨满 → 小的先浮到盖子底下，
// 两个小笼包碰到合成饭团、再和被顶在下面的饭团合成面窝 → 退水，一框三个面窝落回去 → 抽盖。每一轮左右镜像换一次（换一处合成）
const TUT_WATER_L = 5400;
const TUT_W = { key: 500, splash: 1000, lid: 1300, rise: 2300, m1: 2350, m2: 2750, drain: 3500, dry: 4300, open: 4600 };
const TUT_W_SC = 0.75;   // 精灵画 0.75 倍：框里 28 像素高，浮起来才看得出距离
const TUT_W_TOP = 24, TUT_W_L = 10, TUT_W_R = 86;
// [级, 原位 x, 原位脚底 y, 浮起来的 x, 浮起来的脚底 y]；浮起来的脚底 = 盖底 24 + 精灵高
const tutWH = (k) => spH(k) * TUT_W_SC;
const TUT_W_PILE = [
  [2, 22, TUT_FL, 22, TUT_W_TOP + tutWH(2)],
  [2, 74, TUT_FL, 74, TUT_W_TOP + tutWH(2)],
  [1, 48, TUT_FL, 48, TUT_FL - 1],
  [0, 36, TUT_FL - 12, 44, TUT_W_TOP + tutWH(0)],
  [0, 60, TUT_FL - 12, 53, TUT_W_TOP + tutWH(0)],
];
function tutRowWaterCost(g, t, st) {
  const L = TUT_WATER_L, T = t % L, round = Math.floor(t / L), mir = round % 2 === 1, X = (x) => mir ? 96 - x : x, E = TUT_W;
  const l = TUT_W_L, r = TUT_W_R, top = TUT_W_TOP;
  if (st.round !== round) { st.round = round; st.m1 = st.m2 = st.sp = false; }
  // 水位
  const lv = T < E.lid ? 0 : T < E.rise ? smooth((T - E.lid) / (E.rise - E.lid)) : T < E.drain ? 1 : T < E.dry ? 1 - smooth((T - E.drain) / (E.dry - E.drain)) : 0;
  const wy = Math.round(TUT_FL - (TUT_FL - top) * lv);
  // 每个物件：涨水时按等级先后浮上去（小的先、快），退水时落回去
  const rise = (k) => smooth((T - E.lid - 150 - k * 180) / (500 + k * 220));
  const fall = (k) => { const u = Math.max(0, Math.min(1, (T - E.drain - 200 - (2 - k) * 120) / 360)); return u * u; };
  const at = (k, x0, y0, x1, y1, x2 = x0, y2 = y0) => {   // 原位 → 浮起 → 落到 (x2, y2)
    if (T < E.drain) { const u = rise(k); return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]; }
    const u = fall(k); return [x1 + (x2 - x1) * u, y1 + (y2 - y1) * u];
  };
  const S = TUT_W_SC, draw = (k, x, y) => tutSprite(g, k, Math.round(X(x)), Math.round(y), { s: S });
  const [a, b, c, d, e] = TUT_W_PILE;
  const bob = lv >= 1 ? Math.round(Math.sin(T / 160)) : 0;   // 顶在盖子下面的轻轻晃
  draw(a[0], ...at(a[0], a[1], a[2], a[3], a[4]));
  draw(b[0], ...at(b[0], b[1], b[2], b[3], b[4]));
  // 两个小笼包浮到盖子底下碰上 → 饭团（m1）；它再和被顶在底下的饭团碰上 → 面窝（m2），退水后落到正中
  if (T < E.m1 || T >= L) { draw(d[0], ...at(d[0], d[1], d[2], d[3], d[4])); draw(e[0], ...at(e[0], e[1], e[2], e[3], e[4])); }
  if (T < E.m2) {
    draw(c[0], ...at(c[0], c[1], c[2], c[3], c[4]));
    if (T >= E.m1) draw(1, 48.5, top + tutWH(1) + bob);
  } else {
    const u = T < E.drain ? 0 : fall(2), y0 = top + tutWH(2) + 6 * (1 - smooth((T - E.m2) / 300)), y = y0 + (TUT_FL - y0) * u;   // 刚合出来时在下面一点，再浮到盖子底下
    draw(2, 48, T < E.drain ? y0 + bob : y);
  }
  const burst = (x, y) => { tutStars(st, X(x), y, 0, 12, true, SPARK); st.fx.push({ k: 'ring', x: X(x), y, r: 3, vr: 0.6, life: 14, max: 14 }); };
  if (T >= E.m1 && !st.m1) { st.m1 = true; burst(48.5, top + 6); }
  if (T >= E.m2 && !st.m2) { st.m2 = true; burst(48, top + 18); }
  // 水（同游戏：背景海面的青绿，半透明盖在物件上）+ 水面亮线
  if (lv > 0) {
    g.fillStyle = 'rgba(25,75,77,.5)'; g.fillRect(l, wy, r - l, TUT_FL - wy);
    g.fillStyle = 'rgba(0,40,48,.16)'; g.fillRect(l, Math.round(wy + (TUT_FL - wy) * 0.5), r - l, TUT_FL - Math.round(wy + (TUT_FL - wy) * 0.5));
    if (lv < 1) for (let x = l; x < r; x += 4) { const off = Math.round(Math.sin(x / 9 + T / 200)); g.fillStyle = 'rgba(176,214,196,.95)'; g.fillRect(x, wy + off - 1, 4, 1); }
    if (Math.random() < 0.25) st.fx.push({ k: 'p', x: l + 2 + Math.random() * (r - l - 4), y: TUT_FL - 2, vx: 0, vy: -0.5 - Math.random() * 0.4, life: Math.max(4, (TUT_FL - wy) / 0.7 - 4), c: 'rgba(191,224,212,.8)' });
  }
  tutWoodWalls(g, l, r, top);
  // 木盖：从右边滑进来盖住框口，退完水再抽出去
  const lidOff = T < E.splash ? 1 : T < E.lid ? 1 - smooth((T - E.splash) / (E.lid - E.splash)) : T < E.dry ? 0 : T < E.open ? smooth((T - E.dry) / (E.open - E.dry)) : 1;
  if (lidOff < 1) {
    const ox = Math.round(lidOff * (r - l + 8)) * (mir ? -1 : 1), x0 = l - 3 + ox;
    g.fillStyle = '#4a2e20'; g.fillRect(x0, top - 4, r - l + 6, 4);
    g.fillStyle = '#8a5a36'; g.fillRect(x0 + 1, top - 3, r - l + 4, 2);
    g.fillStyle = '#b07a4c'; g.fillRect(x0 + 1, top - 3, r - l + 4, 1);
  }
  // 键：1 颗金豆 → 用掉；灌水时键面淡海绿、图标上下动
  const kOn = T >= E.key && T < E.open, kx = 33, ky = 5;
  const gx = tutShakeKey(g, kx, ky, { s: 1, icon: 'water', fill: kOn ? '#cfe6df' : '#fff6e0', base: false, n: T >= E.key + 120 ? 0 : 1, flash: T >= E.key + 40 && T < E.key + 220 ? 0 : -1, jy: kOn && Math.floor(T / 250) % 2 ? -1 : 0 });
  // 用掉的金豆：从九宫格第一格掉进框底（同游戏的飞豆），落地溅一圈水花
  if (T >= E.key && T < E.splash) {
    const k = (T - E.key) / (E.splash - E.key), q = k * k;
    const x0 = gx + 2, y0 = ky + 2, x1 = X(48), y1 = TUT_FL - 4;
    const bx = x0 + (x1 - x0) * smooth(k), by = y0 + (y1 - y0) * q, k0 = Math.max(0, k - 0.06);
    tutBeanFly(g, bx, by, k, T, bx - (x0 + (x1 - x0) * smooth(k0)), by - (y0 + (y1 - y0) * k0 * k0));
  }
  if (T >= E.splash && !st.sp) {
    st.sp = true;
    for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 0.5 + Math.random() * 0.8; st.fx.push({ k: 'p', x: X(48), y: TUT_FL - 3, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 0.4, life: 18 + Math.random() * 10, c: i % 2 ? '#bfe0d4' : '#6f9c8c' }); }
    st.fx.push({ k: 'ring', x: X(48), y: TUT_FL - 3, r: 2, vr: 0.7, life: 12, max: 12 });
  }
}
const TUT = {
  gold: { title: TX.教程.镀金.标题, rows: [
    [tutRowMerge, TX.教程.镀金.合成],
    [tutRowScore, TX.教程.镀金.分数, 11],   // 一行 11 个字，12 号会折行（同摇一摇、美梦第三格）
    [tutRowFade, TX.教程.镀金.褪色],
    [tutRowLock, TX.教程.镀金.镀牢],
  ] },
  // 灌水（2026-11-14，普通模式）：强调色取深海青（和摇一摇的深绿、美梦的蓝紫区分开）
  water: { title: TX.教程.灌水.标题, accent: '#256f8f', sub: TX.教程.灌水.副标题, px: 11, beans: beanAtList(BEAN_RULE.normal), icon: 'water', rows: [[tutRowWaterCost, TX.教程.灌水.消耗], [tutRowShakeScore, TX.教程.灌水.进度], [tutRowWaterFish, TX.教程.灌水.大鱼]] },
  dream: { title: TX.教程.美梦.标题, accent: DREAM_BEST_CARD, rows: [[tutRowBig, TX.教程.美梦.容器], [tutRowHold, TX.教程.美梦.连放], { draw: tutRowNoAch, text: TX.教程.美梦.不记账, px: 11 }] },
  // 摇一摇的强调色（标题、粗体字）2026-11-14 从浅金 #f0b828 换成深绿（用户要求）；副标题见 openTut
  // beans / icon：第二排的金豆门槛和键上的图标（两课共用第二、三排的画法）
  shake: { title: TX.教程.摇一摇.标题, accent: '#2f7a45', sub: TX.教程.摇一摇.副标题, px: 11, beans: beanAtList(BEAN_RULE.dream), icon: 'shake', rows: [[tutRowShakeCost, TX.教程.摇一摇.消耗], [tutRowShakeScore, TX.教程.摇一摇.进度], [tutRowShakeFish, TX.教程.摇一摇.相消]] },
};
const TUT_TXT = { ...BODY, fill: '#6b4a36' };
const TUT_CARD_W = 232;   // 卡片内宽（和 index.html 的 .card.tut 对上）：连边框在内要落在容器木框里面，不压木框
const tutDom = new Map();   // 每课的 DOM 只搭一次（像素字窗口缩放时由 fineList 重贴）
// ---- 美梦一课卡片右上角的示例绶带（2026-11-11 用户要求）：回看时页面上没有真绶带，玩家会忘了怎么进美梦。
// 画一条半尺寸的夜空绶带（1 格 = 1 逻辑像素，真绶带是 2）：同一套 sashCells 配色、金缝线、星和金月；只是示例，不响应点击。
// 月亮另做 9×10 的小月牙：真绶带的月亮是 11×12、一个美术像素 4/3 逻辑像素，缩一半不是整数，直接缩放会糊。
const TUT_SASH_Z = { d0: 8, d1: 32, e: 6, stitch: 7, inner: 2 };   // inner 2：卡片上边框 2 像素 = 2 格（小样例 1 格 = 1 像素）
const tutSashQ = sashCells(false, TUT_SASH_Z);
const TUT_MOON_PAL = { '#': SASH_PAL.o, h: '#fff1a8', o: '#f0b828', d: '#c88a1e' };
const TUT_MOON_BMP = [
  '..###....',
  '.#hhh#...',
  '.#hh#....',
  '#ho#.....',
  '#ho#.....',
  '#hoo#....',
  '#hooo##..',
  '.#oooood#',
  '..##dd##.',
  '....##...',
];
let tutMoonImg = null;
let tutNoteBuilt = false;
function tutBuildNote() {
  if (tutNoteBuilt) return;
  tutNoteBuilt = true;
  const note = $('tutSashNote');
  const tx = document.createElement('div'); tx.className = 'tutSashTxt';
  const L = TUT.dream;
  // 11 号小字的强调只用标题同色（不加粗也够读）；文案居中在标题正下方；末尾的箭头是用户手点的点阵（TUT_ARROW_PX），见下面的 tutArrowFrame。
  putPara(tx, markup(TX.教程.美梦.绶带提示).map(r => ({ t: r.t, color: r.bold ? L.accent : TUT_TXT.fill })), 206, 11, 'center');
  note.append(tx);
}
function tutSashSetup() {
  const el = $('tutSash');
  el.style.right = -(tutSashQ.r + 1 + SASH_M) + 'px';
  el.style.top = -(TUT_SASH_Z.inner - tutSashQ.t + SASH_M) + 'px';
  el.style.width = tutSashQ.W + 'px';
  el.style.height = tutSashQ.H + 'px';
  tutSashFrame(0);   // 先画一帧，别等下一次 rAF 才出现
}
function tutSashFrame(t) {
  const q = tutSashQ, el = $('tutSash'), u = Math.max(1, Math.round(PX.dev || 1));   // 1 格 = 1 逻辑像素，按物理像素画，任何缩放都不糊
  if (el.width !== q.W * u || el.height !== q.H * u) { el.width = q.W * u; el.height = q.H * u; }
  const g = el.getContext('2d');
  g.setTransform(u, 0, 0, u, 0, 0); g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, q.W, q.H);
  const fx = (x) => x - q.l + SASH_M, fy = (y) => y - q.t + SASH_M, pal = SASH_PAL;
  for (const c of q.back) { g.fillStyle = pal[c.c]; g.fillRect(fx(c.x), fy(c.y), 1, 1); }
  const s0 = q.l + q.t, s1 = q.r + q.b, ph = (t % 5200) / 5200;
  const gs = ph > 0.1 && ph < 0.34 ? s0 - 8 + (ph - 0.1) / 0.24 * (s1 - s0 + 16) : -999;   // 每 5.2 秒一道反光（比真绶带安静）
  for (const c of q.cells) {
    let col = c.st ? pal.st : pal[c.c];
    if ((c.c === 'f' || c.c === 'h') && !c.st && Math.abs(c.x + c.y - gs) < 1.5) col = pal.g;
    g.fillStyle = col; g.fillRect(fx(c.x), fy(c.y), 1, 1);
  }
  for (const s of q.stars) {   // 带上的 4 颗星一闪一闪
    const on = Math.floor(t / 460 + s.i * 1.3) % 3 !== 0;
    g.fillStyle = on ? '#ffe9a0' : '#8f88d8'; g.fillRect(fx(s.x), fy(s.y), 1, 1);
    if (on && s.i % 2 === 0) { g.fillRect(fx(s.x) - 1, fy(s.y), 3, 1); g.fillRect(fx(s.x), fy(s.y) - 1, 1, 3); }
  }
  if (!tutMoonImg) tutMoonImg = PX.bitmap(TUT_MOON_BMP, TUT_MOON_PAL);
  g.drawImage(tutMoonImg, Math.round(fx(q.moon[0]) - tutMoonImg.width / 2), Math.round(fy(q.moon[1]) - tutMoonImg.height / 2));
}
// 小字末尾 → 绶带的长弧线箭头（2026-11-11 用户手点的点阵，源图是 .scratch/tut_arrow_edit_1x.png 里的 #B5E61D 绿）。
// 坐标是 #tutArrow 画布坐标（252×84，1 格 = 1 逻辑像素）；游戏里统一染成暖金 #d99a28。
const TUT_ARROW_PX = (`
  235,17 233,18 234,18 235,18 231,19 232,19 233,19 234,19 235,19 233,20 234,20 235,20
  232,21 233,21 235,21 232,22 231,23 231,24 230,25 229,26 229,27 228,28 228,29 227,30
  226,31 226,32 225,33 224,34 223,35 223,36 222,37 221,38 220,39 218,40 219,40 216,41
  217,41 214,42 215,42 212,43 213,43 209,44 210,44 211,44 205,45 206,45 207,45 208,45
`).trim().split(/\s+/).map(s => { const [x, y] = s.split(','); return [+x, +y]; });
// 箭头是固定点阵、和时间无关：画过一次就留着，只有画布尺寸（跟着屏幕倍数 u）变了才重画（改尺寸会清空画布）。
// 2026-11-14 照微信版性能意见改（wxgame/validation/浏览器main性能意见.md 第 3 条）。
let tutArrowPainted = false;
function tutArrowFrame() {
  const ar = $('tutArrow'), u = Math.max(1, Math.round(PX.dev || 1)), W = 252, H = 84;
  if (ar.width !== W * u || ar.height !== H * u) { ar.width = W * u; ar.height = H * u; tutArrowPainted = false; }
  if (tutArrowPainted) return;
  tutArrowPainted = true;
  const g = ar.getContext('2d');
  g.setTransform(u, 0, 0, u, 0, 0); g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#d99a28';
  for (const [x, y] of TUT_ARROW_PX) g.fillRect(x, y, 1, 1);
}
function tutBuild(id) {
  if (tutDom.has(id)) return tutDom.get(id);
  const L = TUT[id], rows = L.rows.map((entry, i) => {
    const [draw, text, rpx] = Array.isArray(entry) ? entry : [entry.draw, entry.text, entry.px];   // 行可以带自己的字号（美梦第三行单独用 11 号）
    const row = document.createElement('div'); row.className = 'tutRow' + (i % 2 ? ' flip' : '');
    const cv = document.createElement('canvas'); cv.className = 'px';
    cv.style.width = TUT_FW * TUT_U + 'px'; cv.style.height = TUT_FH * TUT_U + 'px';
    const tx = document.createElement('div'); tx.className = 'tutTxt';
    row.append(cv, tx);
    // **粗体** 是加粗 + 标题同色（同署名页的写法）；粗体短语加 nobr 不拆行（美梦课第三行的「分开记」否则会只剩一个「记」掉到下一行）。
    // 居中在「本行相框靠字的那条边」和「整张卡片的纸边」之间，见 tutAlignRows；文字区用满这段空间（TUT_ROW_GAP 4）。
    // 字号：行自己的 px > 整课的 L.px > 12；摇一摇一行 12 个字用 11 号，美梦第三行也单独用 11 号。
    putPara(tx, markup(text).map(r => r.bold ? { t: r.t, bold: true, nobr: true, color: L.accent || '#b07818' } : { t: r.t, color: TUT_TXT.fill }), TUT_CARD_W - TUT_FW * TUT_U - TUT_ROW_GAP, rpx || L.px || 12, 'center');
    return { row, cv, draw, st: { fx: [] } };
  });
  const d = { rows };
  tutDom.set(id, d);
  return d;
}
// 每行文字居中在「本行相框靠字的那条边」和「整张卡片的纸边」之间（不是内容边：卡片左右各有 10 像素内边距，
// 用纸边居中，字两侧的空隙才对称；2026-11-11 用户指出之前看起来贴相框，就是因为用了内容边）。
// 文本区比居中范围少一个 gap，图片还多 4px 留白、字的墨迹也不一定刚好在正中，所以显示后按真实 offset 量一次、取整平移。
const TUT_CARD_PAD = 10;   // 和 index.html 的 .card.tut padding 左右对上
function tutAlignRows() {
  // 先把每行的位置都量完、再统一写 transform：边量边写会让浏览器每行都重新排版一次（2026-11-14 照微信版性能意见第 2 条改）
  const rows = [...$('tutRows').querySelectorAll('.tutRow')], textW = TUT_CARD_W - TUT_FW * TUT_U - TUT_ROW_GAP;
  const shifts = rows.map((row, i) => {
    const f = row.querySelector('canvas'), tx = row.querySelector('.tutTxt'), im = tx && tx.querySelector('img');
    if (!f || !tx || !im) return null;
    const base = row.offsetLeft;   // 换算到行内坐标：行宽就是卡片内容宽 232
    const fl = f.offsetLeft - base, fr = fl + f.offsetWidth, tl = tx.offsetLeft - base + im.offsetLeft;
    const own = i % 2 ? fl : fr;                                                   // 本行相框靠字的那条边
    const other = i % 2 ? -TUT_CARD_PAD : TUT_CARD_W + TUT_CARD_PAD;              // 对侧的卡片纸边（含内边距）
    const shift = Math.round((own + other) / 2 - (tl + textW / 2));
    return { tx, transform: shift ? `translateX(${shift}px)` : '' };
  });
  for (const v of shifts) if (v) v.tx.style.transform = v.transform;
}
let tutCur = null, tutRaf = 0, tutLast = 'gold';
const tutCur0 = () => tutList().includes(tutLast) ? tutLast : tutList()[0];
// 回看时能翻的课：镀金一直有；美梦解锁了才有（没解锁不剧透半彩蛋）
const tutList = () => Object.keys(TUT).filter(id => (id !== 'dream' && id !== 'shake') || dreamSave.unlocked);
// 回看时返回/翻页按钮锚在「所有教程卡片里最高的那张」下面（含还没解锁的课），翻课时按钮不上下跳（2026-11-11 用户要求）。
// 布局一点不动：卡片还是按原来的「卡片 + 18 + 按钮」整块居中（卡片位置和以前完全一样），只把按钮行往下挪
// 「最高卡片和这张卡片的高度差 / 2」——这样按钮落在最高卡片下面 18 像素处，矮卡片和按钮之间的空当变大。
// 聚焦弹窗不套这条（用户只要回看）。卡片高度和窗口缩放无关（宽固定、相框和字都是固定逻辑像素），量一次缓存。
let tutMaxH = 0;
function tutMaxCardH() {
  if (tutMaxH) return tutMaxH;
  const ov = $('ovTut'), card = ov.querySelector('.card'), rows = $('tutRows');
  const keep = [...rows.children], keepDream = card.classList.contains('dream'), keepShake = card.classList.contains('shake'), vis = ov.style.visibility;
  ov.style.visibility = 'hidden';   // 量的时候别闪
  for (const id of Object.keys(TUT)) {
    const d = tutBuild(id);
    if (id === 'dream') tutBuildNote();
    rows.replaceChildren(...d.rows.map(r => r.row));
    card.classList.toggle('dream', id === 'dream');
    card.classList.toggle('shake', !!TUT[id].sub);
    tutPutSub(id);
    tutMaxH = Math.max(tutMaxH, card.getBoundingClientRect().height / scale);
  }
  rows.replaceChildren(...keep);
  card.classList.toggle('dream', keepDream);
  card.classList.toggle('shake', keepShake);
  if (tutCur && TUT[tutCur.id].sub) tutPutSub(tutCur.id);
  ov.style.visibility = vis;
  return tutMaxH;
}
// 副标题（摇一摇「仅在美梦模式下可用」、灌水「仅在普通模式下可用」）：标题下一行 11 号小字，两课共用 #tutShakeNote
function tutPutSub(id) { if (TUT[id].sub) putPara($('tutShakeNote'), [{ t: TUT[id].sub, color: TUT_TXT.fill }], 206, 11, 'center'); }
function openTut(id, focus = null, back = null) {
  const d = tutBuild(id);
  tutCur = { id, focus, back, t0: performance.now(), last: 0, rows: d.rows }; tutLast = id;
  const list = focus ? [] : tutList();
  for (const b of [$('bTutPrev'), $('bTutNext')]) b.style.display = list.length > 1 ? '' : 'none';
  for (const r of d.rows) r.st = { fx: [] };
  $('tutRows').replaceChildren(...d.rows.map(r => r.row));
  setPix('tTut', TUT[id].title, { ...TITLE2, fill: TUT[id].accent || '#b07818' });   // 每课的强调色：镀金是金棕，美梦是夜空蓝紫，摇一摇是深绿
  // 示例绶带只在回看里出现：首次弹出时真绶带就在幕布的孔里，再画一条信息重复、还容易被当成两个入口（用户要求）
  const cardEl = $('ovTut').querySelector('.card');
  cardEl.classList.toggle('dream', id === 'dream' && !focus);
  cardEl.classList.toggle('shake', !!TUT[id].sub);    // 摇一摇 / 灌水：副标题 + 卡片上层的飞豆画布 #tutBeanFx
  tutPutSub(id);
  if (TUT[id].beans) TS = tsNew(TUT[id]);              // 每次打开都从 0 颗、第二排第一轮开始
  if (id === 'dream' && !focus) { tutBuildNote(); tutSashSetup(); }
  const ov = $('ovTut'), btn = $('bTutOk');
  ov.classList.toggle('focus', !!focus);
  ov.style.paddingTop = focus ? Math.round(focus.y + focus.r + 20) + 'px' : '';
  setPix('bTutOk', focus ? TX.按钮.知道了 : TX.按钮.返回, BTN);
  btn.classList.remove('pop');
  btn.classList.toggle('wait', !!focus);
  if (focus) setTimeout(() => { if (tutCur && tutCur.focus === focus) { btn.classList.remove('wait'); btn.classList.add('pop'); beep([784], 0.04, 'triangle', 0.04); } }, TUT_WAIT);
  if (focus && focus.under) {   // 盖在开始/结束/暂停页上：底下那页不藏（绶带在孔里接着动），角上的 i、便签、? 先收起来
    ov.classList.add('show'); $('ui').classList.add('tutOver');   // tutOver：底下那页角上的 i 也藏起来（它压在幕布上面）
    for (const e of ['noteTab', 'tutTab', 'rankTab']) $(e).classList.remove('show');
  } else show('ovTut');
  // 回看：按钮行锚在最高卡片下面——卡片位置一点不动，只把按钮行按高度差往下挪；聚焦弹窗不挪（用户只要回看）。
  // 用 position:relative 的 top 挪，不用 transform：transform 会把按钮行提成独立图层，悬停重绘时像素字会被重新栅格化，
  // 字会抖/变形（2026-11-11 用户发现的「返回键字形抖动」就是这个）。
  const btnsEl = ov.querySelector('.btns');
  btnsEl.style.marginTop = '';
  if (focus) btnsEl.style.top = '';
  else { const dy = (tutMaxCardH() - cardEl.getBoundingClientRect().height / scale) / 2; btnsEl.style.top = dy ? dy + 'px' : ''; }
  if (focus) {   // 孔下面放不下（孔在屏幕偏下）就整张卡片挪到孔上面，箭头也翻过来朝下
    const card = ov.querySelector('.card'), h = ov.querySelector('.btns').offsetTop + ov.querySelector('.btns').offsetHeight - card.offsetTop;
    focus.above = focus.y + focus.r + 20 + h > H - 6;
    if (focus.above) ov.style.paddingTop = Math.max(6, Math.round(focus.y - focus.r - 20 - h)) + 'px';
  }
  tutAlignRows();   // 卡片显示出来以后才量得到每行的真实位置
  if (!tutRaf) tutRaf = requestAnimationFrame(tutFrame);
}
function tutFlip(d) {   // 回看翻页
  const list = tutList(), C = tutCur; if (!C || C.focus || list.length < 2) return;
  openTut(list[(list.indexOf(C.id) + d + list.length) % list.length], null, C.back); beep([660], 0.03);
}
// 摇一摇：第三排大肥鱼产出的金豆飞过整张卡片，落进第二排的九宫格。画在卡片最上层（#tutBeanFx），
// 所以可以越过相框和文字。九宫格满了也照样飞，到了格子位置再消失（不削减第三排的产出，和游戏内不同）。
function tutShakeFx(t) {
  const el = $('tutBeanFx'); if (!el || !TS) return;
  const card = el.parentElement, u = Math.max(1, Math.round(3 * (PX.zoom || 1)));
  const W = card.clientWidth, H = card.clientHeight;
  if (el.width !== Math.round(W * u) || el.height !== Math.round(H * u)) { el.width = Math.round(W * u); el.height = Math.round(H * u); }
  const g = el.getContext('2d'); g.setTransform(u, 0, 0, u, 0, 0); g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, W, H);
  for (let i = TS.fx.length - 1; i >= 0; i--) {
    const f = TS.fx[i], k = (t - f.t0) / f.dur;
    if (k < 0) continue;
    if (k >= 1) {
      TS.fx.splice(i, 1);
      if (!(f.slot >= 0 && tsFill(t, f.slot))) TS.poofs.push({ x: f.x1, y: f.y1, t0: t });   // 有槽就填自己那一格；没槽/被占就在九宫格处消失
      continue;
    }
    let tx = f.x1, ty = f.y1;
    if (f.blendT0 !== undefined) {   // 九宫格刷新改瞄：目标在 40–220ms 内平滑移到新格，不瞬移
      const b = Math.min(1, (t - f.blendT0) / f.blendDur), q = b * b * (3 - 2 * b);
      tx = f.oldX1 + (f.x1 - f.oldX1) * q; ty = f.oldY1 + (f.y1 - f.oldY1) * q;
    }
    const e = k * k * (3 - 2 * k), x = f.x0 + (tx - f.x0) * e, y = f.y0 + (ty - f.y0) * e - Math.sin(k * Math.PI) * 34;
    const k2 = Math.max(0, k - 0.06), e2 = k2 * k2 * (3 - 2 * k2);
    const x2 = f.x0 + (tx - f.x0) * e2, y2 = f.y0 + (ty - f.y0) * e2 - Math.sin(k2 * Math.PI) * 34;
    tutBeanFly(g, x, y, k, t, x - x2, y - y2);
  }
  for (let i = TS.poofs.length - 1; i >= 0; i--) {   // 满格时在九宫格处炸一圈小金星
    const p = TS.poofs[i], a = (t - p.t0) / 360;
    if (a >= 1) { TS.poofs.splice(i, 1); continue; }
    const r = 2 + a * 10;
    for (let j = 0; j < 8; j++) { const an = j / 8 * Math.PI * 2; tutStarPx(g, Math.round(p.x + Math.cos(an) * r), Math.round(p.y + Math.sin(an) * r), j % 2 ? TUT_SH.pale : TUT_SH.gold, a < 0.4 && j % 2 === 0); }
    g.globalAlpha = Math.max(0, 0.8 - a); g.fillStyle = '#ffffff'; g.fillRect(p.x - 2, p.y - 2, 4, 4); g.globalAlpha = 1;
  }
}
function tutFrame(now) {
  tutRaf = 0;
  const C = tutCur;
  if (!C || !$('ovTut').classList.contains('show')) return;
  tutRaf = requestAnimationFrame(tutFrame);
  const n = Math.min(6, (now - (C.last || now)) / STEP); C.last = now;   // 过了几个 60 帧的「步」（特效按这个推进）
  const t = Math.max(0, now - C.t0), k = PX.zoom || 1, u = 3 * k;   // 夹到 0：rAF 的时间戳可能比 openTut 里的 performance.now() 早一点点，负的 t 会让 t % 循环长度变成负数（第 3 格取不到幕）
  for (const r of C.rows) {
    const cv = r.cv;
    if (cv.width !== TUT_FW * u || cv.height !== TUT_FH * u) { cv.width = TUT_FW * u; cv.height = TUT_FH * u; }
    const g = cv.getContext('2d');
    g.setTransform(u, 0, 0, u, 0, 0); g.imageSmoothingEnabled = false;
    g.fillStyle = '#d4e1e3'; g.fillRect(0, 0, TUT_FW, TUT_FH);                   // 天空色上盖半透明奶油（同游戏里的容器）
    g.fillStyle = '#b07a4c'; g.fillRect(0, TUT_FL, TUT_FW, 1);                    // 木地板
    g.fillStyle = '#8a5a36'; g.fillRect(0, TUT_FL + 1, TUT_FW, TUT_FH - TUT_FL - 1);
    r.draw(g, t, r.st);
    tutFx(g, r.st, n);
  }
  if (TUT[C.id].beans) tutShakeFx(t);   // 第三排鱼豆飞过卡片、落进第二排九宫格（画在卡片上层）
  if (C.id === 'dream' && !C.focus) {
    tutSashFrame(t);
    tutArrowFrame();
  }
  if (C.focus) tutVeil(t);
}
// 幕布：2 逻辑像素一格的半透明深棕，焦点处挖一个像素圆孔（先从大往小收一下），孔边一圈转着的金色虚线，孔下一个上下跳的金箭头
// 幕布上的金色虚线圈：半径 R 的一圈格子（和微信版同一份），按 R 缓存
const tutVeilRings = new Map();
function tutVeilRing(R) {
  let ring = tutVeilRings.get(R);
  if (ring) return ring;
  ring = [];
  for (let y = -R - 2; y < R + 2; y++) for (let x = -R - 2; x < R + 2; x++) {
    const d = Math.hypot(x + 0.5, y + 0.5);
    if (d >= R + 0.5 && d < R + 1.5) ring.push({ x, y, a: Math.atan2(y + 0.5, x + 0.5) / (Math.PI * 2) + 1 });
  }
  if (tutVeilRings.size >= 4) tutVeilRings.delete(tutVeilRings.keys().next().value);
  tutVeilRings.set(R, ring); return ring;
}
const TUT_ARROW = ['..#..', '.###.', '#####', '.###.', '.###.'];
// 2026-11-14：幕布按设备分辨率画——一格（2 逻辑像素）= U 个设备像素，格边界取整，画布尺寸正好等于它在屏幕上的尺寸，
// 贴的时候 1:1、不再缩放。原来画在 CW×CH 的小画布上再整体放大：微信版这张图每帧都变，渲染层不给它做 CPU 最近邻，
// 交给 drawImage 硬件放大，安卓上是双线性插值，聚光孔边缘发糊（用户在手机上发现的）。网页版同样画法，浏览器里也是 1:1。
// 内容没变就不重画（虚线圈转动按 40ms 一档走），省得每帧重填一整屏。
let tutVeilKey = '';
function tutVeil(t) {
  // 幕布画布往四周伸出去盖住整个窗口（构图外面露出来的背景也被同一张幕布盖住，没有交界线）。
  // pad = 每边多出几格（1 格 = 2 逻辑像素）；微信版 innerWidth/scale 正好是构图宽，pad 为 0，构图外由渲染层补。
  const exX = Math.max(0, innerWidth / scale - W), exY = Math.max(0, innerHeight / scale - H);
  const px = exX > 0.5 ? Math.ceil(exX / 4) + 1 : 0, py = exY > 0.5 ? Math.ceil(exY / 4) + 1 : 0;
  const cv = $('tutVeil'), F = tutCur.focus, CW = W / 2 + px * 2, CH = H / 2 + py * 2;
  const U = 2 * (PX.dev || 1), X = (i) => Math.round(i * U), DW = X(CW), DH = X(CH);
  if (cv.width !== DW || cv.height !== DH) {
    cv.width = DW; cv.height = DH; tutVeilKey = '';
    Object.assign(cv.style, { left: -px * 2 + 'px', top: -py * 2 + 'px', width: CW * 2 + 'px', height: CH * 2 + 'px' });
  }
  const cx = Math.round(F.x / 2) + px, cy = Math.round(F.y / 2) + py, R0 = Math.ceil(F.r / 2);
  const R = t < 300 ? R0 + Math.round((1 - t / 300) * 40 / 4) * 4 : R0;   // 光圈收拢（按 4 格一档跳，像素味）
  const veil = `rgba(26,17,12,${Math.min(0.74, t / 160 * 0.74).toFixed(2)})`;
  window.TUT_VEIL = veil;   // 微信版：构图外面渲染层补的背景条按这个颜色压暗（renderer.js overlayDims；网页版的幕布画布直接盖满整个窗口，不用这个）
  const step = t < 300 ? -1 : Math.floor(t / 40), tt = t < 300 ? t : step * 40;
  const key = [DW, DH, cx, cy, R, veil, step, F.above ? 1 : 0].join('|');
  if (key === tutVeilKey) return;
  tutVeilKey = key;
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  const cell = (x, y, w = 1, h = 1) => [X(x), X(y), X(x + w) - X(x), X(y + h) - X(y)];   // 格 → 设备像素矩形（边界取整）
  g.clearRect(0, 0, DW, DH);
  g.fillStyle = veil;
  g.fillRect(0, 0, DW, DH);
  for (let y = -R; y < R; y++) { const hw = Math.round(Math.sqrt(Math.max(0, R * R - (y + 0.5) * (y + 0.5)))); g.clearRect(...cell(cx - hw, cy + y, hw * 2, 1)); }
  if (t < 300) return;
  g.fillStyle = '#ffd25e';
  for (const p of tutVeilRing(R)) {
    const a = (p.a + tt / 6000) % 1;
    if (Math.floor(a * 28) % 2) continue;
    g.fillRect(...cell(cx + p.x, cy + p.y));
  }
  const bob = Math.floor(tt / 300) % 2, ay = F.above ? cy - R - 8 - bob : cy + R + 3 + bob;   // 卡片在孔上面时箭头在孔上、朝下
  TUT_ARROW.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') g.fillRect(...cell(cx - 2 + i, ay + (F.above ? 4 - j : j))); }));
}
function closeTut() {
  const C = tutCur;
  if (!C || $('bTutOk').classList.contains('wait')) return;
  tutCur = null; $('ui').classList.remove('tutOver');
  if (C.focus && C.focus.under) { show(C.focus.under); beep([523, 784], 0.05, 'triangle', 0.04); }   // 盖在页面上的：回那一页（暂停页还是暂停着）
  else if (C.focus) { state = 'play'; last = performance.now(); acc = 0; show(null); beep([523, 784], 0.05, 'triangle', 0.04); }
  else { show(C.back || 'ovStart'); beep([660], 0.04); }
}
// 要不要弹「镀金」这一课：镀金小笼包到了待发射位、而且能放了（不在解冻/摇一摇/大肥鱼时停里）
function tutWantGold() {
  if (!curGold || !canDrop || thaw || shk || wat || fishStop) return false;
  return TUT_TEST ? !tutRun.has('gold') : !tutDone.gold && !DEBUG && !SHOWCASE;
}
function tutFocusGold() {
  state = 'tut'; pointerDown = false; autoFire = false; acc = 0;   // 手指可能还按着：吃掉这一按，松手不会把它丢出去
  if (TUT_TEST) tutRun.add('gold');
  else { tutDone.gold = Date.now(); if (achOn()) localStorage.setItem('dfy_tut', JSON.stringify(tutDone)); }
  const t = TIERS[cur], x = Math.max(M.wl + t.half, Math.min(M.wr - t.half, aimX));
  openTut('gold', { x: toScrX(x), y: toScrY(M.dropY), r: Math.max(t.half, t.top) * M.cam + 10 });
  beep([1568, 1175, 784], 0.04, 'triangle', 0.035); setTimeout(sfxGoldAppear, 200);   // 时停「啾」一下，再一声镀金的叮
}
// 要不要弹金豆这一课（美梦「摇一摇」、普通「灌水」，beanTut）：这局第一颗金豆已经飞进九宫格、动画放完（shakeTutAt），
// 并且没有正在按/摇/灌水/时停。只在玩家能放球的时候弹，别打断刚丢出去的那一下。
function tutWantShake(now) {
  if (!shakeTutAt || now < shakeTutAt || thaw || shk || wat || fishStop || pointerDown || autoFire || toast) return false;
  if (state !== 'play' || !canDrop) return false;
  const id = beanTut();
  return TUT_TEST ? !tutRun.has(id) : !tutDone[id] && !DEBUG && !SHOWCASE;
}
function tutFocusShake() {
  const id = beanTut();
  state = 'tut'; pointerDown = false; autoFire = false; acc = 0;
  if (TUT_TEST) tutRun.add(id);
  else { tutDone[id] = Date.now(); if (achOn()) localStorage.setItem('dfy_tut', JSON.stringify(tutDone)); }
  // 孔开在金豆键上（键 60×26，圆心 (CHIP_X, CHIP_Y)；在左侧「最高」下面）；卡片落在孔下面
  openTut(id, { x: CHIP_X, y: CHIP_Y, r: 36 });
  // show('ovTut') 会把顶栏键藏起来（它只在「无遮罩 + 局内」显示）；这一课要在孔里看见真键，单独把它亮出来。
  // 关教程时 closeTut 走 show(null)，会按正常规则重新显隐。
  $('bShake').style.display = 'flex'; $('shakeBar').style.display = 'block';
  beep([1568, 1175, 784], 0.04, 'triangle', 0.035);
  setTimeout(() => { if (tutCur && tutCur.id === id) (id === 'shake' ? sfxShakeOn : sfxSplash)(); }, 260);   // 孔里的真键跟着音效响一下
}
// 绶带第一次露出来（makeSash 里调）：开始页、结束页、暂停页三处位置和大小都不一样，孔按绶带自己报的月亮位置开
function tutFocusSash(sash, ov) {
  if (tutCur || (TUT_TEST ? tutRun.has('dream') : tutDone.dream || DEBUG || SHOWCASE)) return;
  if ([...document.querySelectorAll('.ov.show')].some(o => o.id !== ov)) return;   // 上面还盖着别的（确认框之类）就下次再说
  if (TUT_TEST) tutRun.add('dream');
  else { tutDone.dream = Date.now(); if (achOn()) localStorage.setItem('dfy_tut', JSON.stringify(tutDone)); }
  openTut('dream', { ...sash.focus(), under: ov });
  beep([1568, 1175, 784], 0.04, 'triangle', 0.035);
}
$('bTutOk').onclick = closeTut;
$('bTutPrev').onclick = () => tutFlip(-1);
$('bTutNext').onclick = () => tutFlip(1);
PX.put($('bTutPrev'), PX.icon('prev'), 2); PX.put($('bTutNext'), PX.icon('next'), 2);
$('tutTab').onclick = () => openTut(tutCur0(), null, [...document.querySelectorAll('.ov.show')].map(o => o.id).find(id => id !== 'ovTut') || 'ovStart');
$('tutTab').title = TX.鼠标悬停提示.教程;
const putTutIcon = () => PX.put($('tutTab'), PX.bitmap(Q, { o: '#4a2e20', w: '#fff6e0' }), 2, TX.鼠标悬停提示.教程);
putTutIcon(); fineList.set('tutIcon', putTutIcon);
$('tutTab').classList.toggle('show', [...document.querySelectorAll('.ov.show')].some(o => NOTE_PAGES.has(o.id)));
// 图鉴：4 列格子，点一个见过的看全名和分值
let dexBack = 'ovPause', dexSel = -1;
var dexGold = false;   // 图鉴第二页：镀金版
var dexCells; dexCells = TIERS.map((_, k) => {
  const d = document.createElement('div');
  d.innerHTML = '<span class="plate"></span><img class="face" alt=""><span class="lbl"></span>';
  d.onclick = () => { dexSel = k; renderDexInfo(); };
  $('dexGrid').appendChild(d);
  return d;
});
// 第 12 格放翻页键
const dexFlip = document.createElement('div');
dexFlip.className = 'flip';
dexFlip.innerHTML = '<div class="icon px" id="bDexFlip"></div>';
$('dexGrid').appendChild(dexFlip);
// 进来 / 翻页时默认选中当前页见过的最大的一个（一个都没见过就选第一个，显示「没见过」），详情区不空着
const dexDefaultSel = () => { for (let k = TIERS.length - 1; k >= 0; k--) if (seen.has(seenKey(k, dexGold))) return k; return 0; };
dexFlip.firstChild.onclick = () => { dexGold = !dexGold; dexSel = dexDefaultSel(); renderDex(); beep([660], 0.04); };
const seenCount = (gold) => TIERS.filter((_, k) => seen.has(seenKey(k, gold))).length;
function renderDexInfo() {
  // 选中：垫和成就页同款的像素小牌子（深棕缺角边），普通页米白、镀金页金色
  dexCells.forEach((d, k) => { d.classList.toggle('on', k === dexSel); setPlate(d.firstChild, [30, 32], k === dexSel ? (dexGold ? 'gold' : 'paper') : null, true); });
  const box = $('dexInfo'); box.innerHTML = '';
  const line = (str, opt) => { const e = document.createElement('div'); e.className = 'ptxt'; box.appendChild(e); putText(e, str, opt, 1); };
  if (dexSel < 0) return line(TX.图鉴.没选中时, { ...BODY, fill: '#8a6a52' });
  if (!seen.has(seenKey(dexSel, dexGold))) return line(dexGold ? TX.图鉴.没见过镀金 : TX.图鉴.没见过, { ...BODY, fill: '#8a6a52' });
  line(`${dexGold ? TX.图鉴.镀金前缀 : ''}${TIERS[dexSel].name}`, { ...BODY, px: 13, bold: true, fill: dexGold ? '#b07818' : '#4a2e20' });
  // 小故事：普通页是物品自己的一句话，镀金页是「金手指国王」的故事分成 11 段（text.json 的「物品」里），自动换行、居中
  const story = (dexGold ? TX.物品[dexSel].镀金故事 : TX.物品[dexSel].故事);
  const e = document.createElement('div'); e.className = 'ptxt'; box.appendChild(e);
  putPara(e, [{ t: story, color: '#8a6a52' }], 236, 12, 'center');
}
// 图鉴镀金页的特效：和游戏里一样，已见过的镀金精灵每 2.2 秒扫一道反光带，并随机冒十字金星。
// 反光带画在盖住图片的同尺寸画布上（精灵像素网格，缩小显示就等比缩小）；金星画在盖住整个格子网格的一张画布上，
// 一个画布像素 = 2 逻辑像素，和游戏里的星一样大。只在图鉴开着、翻到镀金页时跑。
const dexFxCv = document.createElement('canvas'), dexStars = [];
const DEX_SPARK = ['#ffd84a', '#f0b828', '#d4961e', '#f0b828'];   // 图鉴底是奶油色，游戏里的浅金星（#fff8d6…）看不见，换深一档的金
dexFxCv.id = 'dexFx'; $('dexGrid').style.position = 'relative'; $('dexGrid').appendChild(dexFxCv);
let dexFxRaf = 0, dexFxLast = 0, dexFxAcc = 0;
const dexFxActive = () => dexGold && $('ovDex').classList.contains('show');
function dexFxSync() {
  dexCells.forEach((d, k) => {
    const im = d.querySelector(':scope > img'), on = dexGold && seen.has(seenKey(k, true)) && goldSprite(k);   // 同 fillCell：只取格子的直接子 img
    if (on && !d._fx) { d._fx = document.createElement('canvas'); d._fx.className = 'fxface'; d.appendChild(d._fx); }
    if (d._fx) d._fx.style.display = on ? 'block' : 'none';
    im.style.visibility = on ? 'hidden' : '';
  });
  dexStars.length = 0;
  dexFxCv.getContext('2d').clearRect(0, 0, dexFxCv.width, dexFxCv.height);   // 翻回普通页时清掉残留的金星
  if (dexFxActive() && !dexFxRaf) { dexFxLast = 0; dexFxRaf = requestAnimationFrame(dexFxFrame); }
}
function dexFxFrame(now) {
  dexFxRaf = 0;
  if (!dexFxActive()) return;
  dexFxRaf = requestAnimationFrame(dexFxFrame);
  const dt = Math.min(100, now - (dexFxLast || now)); dexFxLast = now;
  dexFxAcc += dt / 16.67;
  const steps = Math.floor(dexFxAcc); dexFxAcc -= steps;
  const grid = $('dexGrid'), gw = grid.offsetWidth, gh = grid.offsetHeight;
  if (dexFxCv.width !== Math.ceil(gw / 2) || dexFxCv.height !== Math.ceil(gh / 2)) {
    dexFxCv.width = Math.ceil(gw / 2); dexFxCv.height = Math.ceil(gh / 2);
    dexFxCv.style.width = gw + 'px'; dexFxCv.style.height = gh + 'px';
  }
  // 先把所有格子的几何一次量完，再统一写叠层画布的位置、画图：边读 offset 边写 style 会让浏览器每个格子都同步重排一次
  // （2026-11-14 照微信版性能意见第 1 条改；叠层是绝对定位，写它不改变格子布局，所以先读后写结果一样）
  const geo = dexCells.map((d, k) => {
    const cv = d._fx;
    if (!cv || cv.style.display === 'none') return null;
    const im = d.querySelector(':scope > img'), gs = goldSprite(k);
    if (!gs || !im.offsetWidth) return null;
    const w = im.offsetWidth, h = im.offsetHeight, left = im.offsetLeft, top = im.offsetTop;
    return { cv, gs, w, h, left, top, cx: d.offsetLeft + left + w / 2, cy: d.offsetTop + top + h / 2 };
  });
  geo.forEach((v, k) => {
    if (!v) return;
    const { cv, gs, w, h, left, top, cx, cy } = v;
    cv.style.left = left + 'px'; cv.style.top = top + 'px';
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    paintGlint(cv, cv.getContext('2d'), gs, (k % 7) / 7);
    // 冒星：概率和游戏里同一个公式，半径取图片显示出来的大小
    const r = Math.max(w, h) / 2;
    for (let i = 0; i < steps; i++) {
      if (Math.random() >= 0.04 + r / 3000) continue;
      const a = Math.random() * Math.PI * 2, dd = Math.random() * r * 0.9;
      dexStars.push({ x: cx + Math.cos(a) * dd, y: cy + Math.sin(a) * dd, life: 18 + Math.random() * 20, big: Math.random() < 0.3 });
    }
  });
  const g = dexFxCv.getContext('2d');
  g.clearRect(0, 0, dexFxCv.width, dexFxCv.height);
  for (let i = dexStars.length - 1; i >= 0; i--) {
    const s = dexStars[i];
    s.y -= 0.2 * steps; s.life -= steps;
    if (s.life <= 0) { dexStars.splice(i, 1); continue; }
    const c = DEX_SPARK[(Math.floor(s.life / 3) + (s.big ? 1 : 0)) % DEX_SPARK.length], x = Math.round(s.x / 2), y = Math.round(s.y / 2);
    g.fillStyle = c; g.fillRect(x, y, 1, 1);
    if (s.big && s.life % 8 < 6) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); g.fillStyle = '#fff4b0'; g.fillRect(x, y, 1, 1); }
  }
}
function renderDex() {
  dexCells.forEach((d, k) => fillCell(d, k, dexGold));
  dexFxSync();
  setPix('dexCount', fmt(TX.图鉴.已发现, { a: seenCount(false) + seenCount(true), b: TIERS.length * 2 }), { ...BODY, fill: '#b07818', bold: true }, 1);
  PX.put($('bDexFlip'), PX.icon(dexGold ? 'prev' : 'next'), 2, dexGold ? TX.鼠标悬停提示.上一页 : TX.鼠标悬停提示.下一页);
  renderDexInfo();
}
function openDex(back) {
  dexBack = back; dexGold = false; dexSel = dexDefaultSel();
  renderDex();
  show('ovDex');
}
// 成就页：和图鉴同一种布局——上面 9 列密排 27 个头像（不分组），下面是选中那个的详情（左大头像、右文字）
// 头像：专门做的头像（sprites/ach.png，见 tools/make_ach_icons.py），成就格里用小档（30 像素）、详情用大档（60 像素），都画在细网格上（1 像素 = 1/FINE 逻辑像素）
let achBack = 'ovStart', achSel = -1;
setPix('tAch', TX.成就.标题, TITLE2);
setPix('bAch', TX.按钮.成就, BTN);
setPix('bAchBack', TX.按钮.返回, BTN);
// 已达成放头像；没达成的灰掉（CSS 滤镜，镀金的也不扫光不冒星）；隐藏且没达成的放问号。big = 详情大图（大档）
function achIcon(box, a, big = false) {
  if (a.hint && !achDone[a.id]) return PX.put(box, PX.bitmap(Q, { o: '#4a2e20', w: '#fff6e0' }), big ? 4 : 2, '?');
  const sz = big ? 'b' : 's', m = ACH_ICONS[a.id] && ACH_ICONS[a.id][sz], cv = document.createElement('canvas');
  cv.className = 'sp';
  // 一个头像像素 = 画面细网格的一格（1/FINE 逻辑像素，和小字同一个网格），整数个物理像素，不糊不丢像素
  if (m) { cv.style.width = m.w / fine() + 'px'; cv.style.height = m.h / fine() + 'px'; }
  cv.dataset.id = a.id; cv.dataset.sz = sz;
  if (m && m.g && achDone[a.id]) cv.dataset.fx = String(ACH.indexOf(a) % 7 / 7);   // 镀金且已达成：交给 achFxFrame 每帧扫光、冒星（值 = 反光带相位，错开）
  paintAchIcon(cv, a.id, false, 0, sz);
  box.replaceChildren(cv);
}
// 镀金头像特效（同图鉴镀金页）：反光带每 2.2 秒扫一道，随机冒十字金星。金星画在盖住整张成就卡的画布上，一个画布像素 = 2 逻辑像素
const achCard = $('achGrid').parentElement, achFxCv = document.createElement('canvas'), achStars = [];
achFxCv.id = 'achFx';
{ const clip = document.createElement('div'); clip.id = 'achFxClip'; clip.appendChild(achFxCv); achCard.appendChild(clip); }   // 外面包一层裁切：画布尺寸取整后可能比卡片多出零点几像素，直接放进卡片会顶出原生滚动条
let achFxRaf = 0, achFxLast = 0, achFxAcc = 0;
const achShown = () => $('ovAch').classList.contains('show');
function achFxSync() {
  achStars.length = 0;
  achFxCv.getContext('2d').clearRect(0, 0, achFxCv.width, achFxCv.height);
  if (achShown() && !achFxRaf) { achFxLast = 0; achFxRaf = requestAnimationFrame(achFxFrame); }
}
function achFxFrame(now) {
  achFxRaf = 0;
  if (!achShown()) return;
  achFxRaf = requestAnimationFrame(achFxFrame);
  const dt = Math.min(100, now - (achFxLast || now)); achFxLast = now;
  achFxAcc += dt / 16.67;
  const steps = Math.floor(achFxAcc); achFxAcc -= steps;
  const cw = achCard.clientWidth, ch = achCard.clientHeight;   // 内边距盒（不含边框），不然画布比卡片里面大、卡片冒滚动条
  if (achFxCv.width !== Math.ceil(cw / 2) || achFxCv.height !== Math.ceil(ch / 2)) {
    achFxCv.width = Math.ceil(cw / 2); achFxCv.height = Math.ceil(ch / 2);
    achFxCv.style.width = cw + 'px'; achFxCv.style.height = ch + 'px';
  }
  const cr = achCard.getBoundingClientRect(), u = achCard.offsetWidth / cr.width;   // 界面整体有 transform 缩放：屏幕坐标换回卡片里的逻辑像素
  const ox = achCard.clientLeft - achCard.scrollLeft, oy = achCard.clientTop - achCard.scrollTop;   // 画布贴着内边距盒的左上角
  for (const cv of achCard.querySelectorAll('canvas.sp[data-fx]')) {
    paintAchIcon(cv, cv.dataset.id, true, +cv.dataset.fx, cv.dataset.sz);
    const r0 = cv.getBoundingClientRect();
    if (!r0.width) continue;
    const r = Math.max(r0.width, r0.height) * u / 2, cx = (r0.left - cr.left) * u - ox + r0.width * u / 2, cy = (r0.top - cr.top) * u - oy + r0.height * u / 2;
    for (let i = 0; i < steps; i++) {
      if (Math.random() >= sparkRate(cv.dataset.id, r)) continue;
      const an = Math.random() * Math.PI * 2, dd = Math.random() * r * 0.9;
      achStars.push(newSpark(cv.dataset.id, cx + Math.cos(an) * dd, cy + Math.sin(an) * dd));
    }
  }
  const g = achFxCv.getContext('2d');
  g.clearRect(0, 0, achFxCv.width, achFxCv.height);
  for (let i = achStars.length - 1; i >= 0; i--) {
    const s = achStars[i];
    s.y -= 0.2 * steps; s.life -= steps;
    if (s.life <= 0) { achStars.splice(i, 1); continue; }
    const c = sparkColor(s), x = Math.round(s.x / 2), y = Math.round(s.y / 2);
    g.fillStyle = c; g.fillRect(x, y, 1, 1);
    if (s.big && s.life % 8 < 6) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); g.fillStyle = '#fff4b0'; g.fillRect(x, y, 1, 1); }
  }
}
achAtlas.addEventListener('load', () => { if (achShown()) { renderAch(); achFxSync(); } });   // 图集晚到（慢网）时补画一遍
// 头像底板：像素小牌子（缺角深边 + 左上高光 + 右下阴影 + 上浅下深两档底色），代替原来的纯色底。
// n = 边长（美术像素，界面上 ×2），可以给 [宽, 高] 做长方形；kind：gold 已达成 / gray 没达成（详情大图）/ paper 没达成且选中；sel = 选中时外框换深棕
const PLATE = {
  gold: { o: '#c48a2c', h: '#fffbe6', s: '#e9b850', f: '#fff0bf', d: '#ffe3a0' },
  gray: { o: '#c9b892', h: '#fbf5e8', s: '#dccdb0', f: '#efe6d2', d: '#e8dcc4' },
  paper: { o: '#c9b892', h: '#fffdf6', s: '#e6d9be', f: '#fbf3e2', d: '#f6ebd5' },
};
const plateCache = new Map();
function plate(n, kind, sel) {
  const [w, h] = Array.isArray(n) ? n : [n, n];
  const key = `${w}x${h}|${kind}|${sel}`;
  if (plateCache.has(key)) return plateCache.get(key);
  const P = { ...PLATE[kind], ...(sel ? { o: '#4a2e20' } : {}) }, X = w - 1, Y = h - 1, rows = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      const cornerOut = (x === 0 || x === X) && (y === 0 || y === Y);
      r += cornerOut ? '.' : x === 0 || y === 0 || x === X || y === Y ? 'o'
        : (x === 1 || x === X - 1) && (y === 1 || y === Y - 1) ? 'o'                 // 内角再补一格，缺角更圆
        : x === 1 || y === 1 ? 'h' : x === X - 1 || y === Y - 1 ? 's'
        : y > h * 0.62 ? 'd' : 'f';
    }
    rows.push(r);
  }
  const c = PX.bitmap(rows, P);
  plateCache.set(key, c);
  return c;
}
function setPlate(el, n, kind, sel) {
  const k = kind ? `${kind}|${sel}` : '';
  if (el.dataset.k === k) return;
  el.dataset.k = k;
  if (kind) PX.put(el, plate(n, kind, sel), 2); else el.replaceChildren();
}
function cellPlate(d, i) {
  const on = !!achDone[ACH[i].id], sel = i === achSel;
  setPlate(d.firstChild, 13, on ? 'gold' : sel ? 'paper' : null, sel);
}
const achCells = ACH.map((a, i) => {
  const d = document.createElement('div');
  d.innerHTML = '<span class="plate"></span><span class="ic"></span>';
  d.onclick = () => { achSel = i; renderAchInfo(); beep([880], 0.03); };
  $('achGrid').appendChild(d);
  return d;
});
const DIA = ['..o..', '.ooo.', 'ooooo', '.ooo.', '..o..'];   // 小故事分隔线中间的金菱形
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function renderAchInfo() {
  achCells.forEach((d, i) => { d.classList.toggle('sel', i === achSel); cellPlate(d, i); });
  const box = $('achInfo'), storyBox = $('achStory');
  storyBox.replaceChildren();   // 小故事只在选中的成就已达成时出现
  if (achSel < 0) {
    box.className = 'achInfo none';
    box.replaceChildren(); const e = document.createElement('div'); e.className = 'ptxt'; box.appendChild(e);
    return putText(e, TX.成就.没选中时, { ...BODY, fill: '#8a6a52' }, 1);
  }
  const a = ACH[achSel], on = !!achDone[a.id], hid = a.hint && !on;
  box.className = 'achInfo ' + (on ? 'on' : 'off');
  box.innerHTML = '<span class="big"><span class="plate"></span><span class="ic"></span></span><div class="atx"><div></div><div></div><div></div></div>';
  setPlate(box.querySelector('.plate'), 26, on ? 'gold' : 'gray', false);
  if (on && a.story) {
    // 饰点分隔：虚线 ─ 金菱形 ─ 虚线 当「锚」，下面整段居中（短故事不再悬空，长故事也一样）；宽度 = 详情行内容宽（256 - 2×6）
    const head = document.createElement('div'), dia = document.createElement('span'), e = document.createElement('div');
    head.className = 'storyHead'; dia.className = 'dia'; e.className = 'ptxt';
    PX.put(dia, PX.bitmap(DIA, { o: '#e8b43a' }), 2);
    head.append(document.createElement('i'), dia, document.createElement('i'));
    storyBox.append(head, e);
    putPara(e, [{ t: a.story, color: '#8a6a52' }], 244, 12, 'center');
  }
  achIcon(box.querySelector('.big .ic'), a, true);
  const [l1, l2, l3] = box.querySelectorAll('.atx > div');
  putText(l1, hid ? LOCK_NAME : a.name, { ...BODY, px: 13, bold: true, fill: on ? '#4a2e20' : '#8a6a52' }, 1);
  putText(l2, hid ? a.hint : a.desc, { ...BODY, fill: on ? '#6b4a36' : '#8a6a52' }, 1);
  putText(l3, on ? fmt(TX.成就.已达成, { date: ymd(achDone[a.id]) }) : TX.成就.未达成, { ...LBL, fill: on ? '#b07818' : '#a08670' }, 1);
}
function renderAch() {
  setPix('achCount', fmt(TX.成就.已达成数, { a: ACH.filter(a => achDone[a.id]).length, b: ACH.length }), { ...BODY, fill: '#b07818', bold: true }, 1);
  achCells.forEach((d, i) => {
    const a = ACH[i];
    d.className = achDone[a.id] ? 'on' : 'off';
    d.title = a.hint && !achDone[a.id] ? LOCK_NAME : a.name;
    achIcon(d.lastChild, a);
  });
  renderAchInfo();
}
fineList.set('ach', () => { for (const d of [...achCells, ...dexCells]) delete d.firstChild.dataset.k; renderAch(); renderDexInfo(); });
// 进来时默认选中「最近达成的那个」（同一时刻达成的取名单里靠后的），详情区不空着；一个都没有就选第一个
function openAch(back) {
  achBack = back; achSel = 0;
  let t = -1;
  ACH.forEach((a, i) => { const d = achDone[a.id]; if (d && d >= t) { t = d; achSel = i; } });
  renderAch(); show('ovAch'); achFxSync();
}
$('bAch').onclick = () => openAch('ovPause');
$('bAch1').onclick = () => openAch('ovStart');
$('bAch2').onclick = () => openAch('ovOver');
$('bAchBack').onclick = () => show(achBack);
$('bStart').onclick = () => start(false);
$('bRetry').onclick = () => start(M.dream);   // 再来一局：留在当前模式（美梦模式里是空容器重新开始）
$('bHome').onclick = () => toMenu();
$('bCredit1').onclick = () => openCredit('ovStart');
$('bCredit2').onclick = () => openCredit('ovOver');
$('bCredit3').onclick = () => openCredit('ovPause');
$('bPause').onclick = pause;
$('bShake').onclick = () => M.dream ? startShake() : startWater();
$('bResume').onclick = resume;
$('bDex').onclick = () => openDex('ovPause');
$('bDex1').onclick = () => openDex('ovStart');
$('bDexBack').onclick = () => show(dexBack);
$('bRestart').onclick = () => show('ovConfirm');
$('bCfmNo').onclick = () => show('ovPause');
$('bCfmYes').onclick = () => { keepBest(); toMenu(countMiss()); };   // 放弃本局：不进结束页，回开始页；破了最高分照样记，普通局照样算一局连败（够数当场解锁美梦）
// 暂停页进美梦的确认：这局的分数照样记最高分，然后带着当前场上的堆进美梦（回不到这局普通模式）
$('bDreamYes').onclick = () => { keepBest(); lastPile = snapPile(); start(true, lastPile); };
$('bDreamNo').onclick = () => show('ovPause');
$('bBack').onclick = () => show(creditBack);
// 清空本地存档：隐藏的开发者功能（2026-11-13）。署名页连点标题 8 次（两次之间不超过 1.5 秒）弹确认框，界面上没有入口和提示。
// 清掉游戏写过的全部 dfy_ 键（最高分、美梦、成就、图鉴、教程、音效开关、意见草稿、匿名号），然后重开：
// 网页刷新；微信版由平台层的 window.RESTART 重启小游戏（重启不了就弹窗请玩家自己重开）。
const SAVE_KEYS = ['dfy_best', 'dfy_dream', 'dfy_dream_best', 'dfy_ach', 'dfy_seen', 'dfy_tut', 'dfy_sound', 'dfy_note_draft', 'dfy_cid'];
let wipeTaps = 0, wipeLast = 0;
$('tCredit').onclick = () => {
  const now = performance.now();
  wipeTaps = now - wipeLast > 1500 ? 1 : wipeTaps + 1; wipeLast = now;
  if (wipeTaps >= 8) { wipeTaps = 0; show('ovWipe'); }
};
$('bWipeNo').onclick = () => show('ovCredit');
$('bWipeYes').onclick = () => {
  for (const k of SAVE_KEYS) localStorage.removeItem(k);
  if (typeof localStorage.key === 'function') for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('dfy_')) localStorage.removeItem(k); }
  if (window.RESTART) window.RESTART(TX.清空存档.微信重开); else location.reload();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

requestAnimationFrame(loop);

// 加载页（index.html 里的 #boot）：等所有精灵和背景载完再收，不然开始页的阶梯图标和棋盘会一块块蹦出来
if (window.Boot) {
  const need = [...sprites, ...gSprites, bg];
  let got = 0;
  const done = new Set();
  const one = (i) => { if (done.has(i)) return; done.add(i); got++; Boot.set(.5 + .5 * got / need.length); if (got >= need.length) Boot.done(); };
  for (const i of need) {
    if (i.complete && i.naturalWidth > 0) { one(i); continue; }
    i.addEventListener('load', () => one(i));          // 重试成功后也会走到这里
    i.addEventListener('giveup', () => one(i));        // 重试用完还失败才放弃
    if (i.dataset.giveup) one(i);
  }
}
})();
