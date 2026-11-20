// 像素风 UI 小工具：把文字/图标画成真正的像素图（二值化 + 描边 + 投影），按整数倍放大显示。
// 字形来自字模图 sprites/font.png（tools/make_font.py 用思源黑体离线画好），不用系统字体：
// 系统字体每台设备不同，二值化后的点阵也不同；字模图保证所有设备一模一样。
(() => {
'use strict';
const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Source Han Sans SC",sans-serif';
const INK = '#4a2e20';

// ---------------------------------------------------------------- 字模
let ATLAS = null, GRAY = null, AW = 0;     // 字模元数据、灰度（0–255 覆盖率）、字模图宽
const ready = Promise.all([
  fetch('sprites/font.json?v=4c68919b').then(r => r.json()),
  new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = 'sprites/font.png?v=b656dc19'; }),
]).then(([meta, im]) => {
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  GRAY = new Uint8Array(c.width * c.height);
  for (let i = 0; i < GRAY.length; i++) GRAY[i] = d[i * 4];
  ATLAS = meta; AW = c.width;
}).catch((e) => console.warn('[PixUI] 字模图没载入，退回系统字体', e));
const missed = new Set();
const styleOf = (px, bold) => {
  const k = `${+px.toFixed(3)}_${bold ? 700 : 400}`;
  return ATLAS && ATLAS[k] ? ATLAS[k] : null;
};
// 量一串字的宽度；缺字/缺字号返回 null（调用方退回系统字体）
function measure(str, px, bold) {
  const st = styleOf(px, bold);
  let w = 0;
  for (const ch of str) {
    const g = st && st[ch];
    if (!g) { const k = `${px}_${bold ? 700 : 400}:${ch}`; if (!missed.has(k)) { missed.add(k); console.warn('[PixUI] 字模缺', k); } return null; }
    w += g[6];
  }
  return w;
}
// 把一串字的覆盖率画进 alpha 数组 a（宽 w），基线在 (x, base)；逐字取整到格子
function stamp(a, w, h, str, px, bold, x, base, onPix) {
  const st = styleOf(px, bold);
  let pen = x;
  for (const ch of str) {
    const [gx, gy, gw, gh, bx, by, adv] = st[ch];
    const ox = Math.round(pen) + bx, oy = base + by;
    for (let yy = 0; yy < gh; yy++) {
      const ty = oy + yy; if (ty < 0 || ty >= h) continue;
      for (let xx = 0; xx < gw; xx++) {
        const tx = ox + xx; if (tx < 0 || tx >= w) continue;
        const v = GRAY[(gy + yy) * AW + gx + xx];
        const i = ty * w + tx;
        if (v > a[i]) { a[i] = v; if (onPix) onPix(i); }
      }
    }
    pen += adv;
  }
}

// text: 文字；px: 像素字号（一格 = 一个像素）；fill/fill2: 上/下半截颜色；hi: 顶部高光行颜色
function text(str, { px = 12, bold = true, fill = '#fff6e0', fill2 = null, hi = null, outline = INK, shadow = true, thr = 110, ow = 1 } = {}) {
  const pad = 4 + ow * 2;
  const aw = measure(str, px, bold);
  const m = document.createElement('canvas').getContext('2d');
  const font = `${bold ? 'bold ' : ''}${px}px ${FONT}`;
  m.font = font;
  const w = Math.ceil(aw ?? m.measureText(str).width) + pad * 2, h = Math.ceil(px * 1.5) + pad * 2;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const alpha = new Uint8Array(w * h);
  if (aw !== null) stamp(alpha, w, h, str, px, bold, pad, pad + Math.round(px * 1.12));
  else {
    g.font = font; g.textBaseline = 'middle'; g.fillStyle = '#000';
    g.fillText(str, pad, h / 2);
    const src = g.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) alpha[i] = src[i * 4 + 3];
    g.clearRect(0, 0, w, h);
  }
  const ink = new Uint8Array(w * h);
  let top = h, bot = 0;
  for (let i = 0; i < w * h; i++) if (alpha[i] > thr) { ink[i] = 1; const y = (i / w) | 0; top = Math.min(top, y); bot = Math.max(bot, y); }
  // 0 空 1 字 2 描边 3 投影
  const cell = new Uint8Array(w * h);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : ink[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (ink[i]) { cell[i] = 1; continue; }
    if (!outline) continue;
    near: for (let dy = -ow; dy <= ow; dy++) for (let dx = -ow; dx <= ow; dx++) if (at(x + dx, y + dy)) { cell[i] = 2; break near; }
  }
  // 投影：往下再加 ow 行（从下往上扫，避免一行影子推出下一行）
  if (shadow && outline) for (let y = h - 1; y >= ow; y--) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!cell[i] && (cell[i - ow * w] === 1 || cell[i - ow * w] === 2)) cell[i] = 3;
  }
  const out = g.createImageData(w, h);
  const rgb = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const cF = rgb(fill), cF2 = rgb(fill2 || fill), cO = rgb(outline || INK), cH = hi ? rgb(hi) : null;
  const mid = top + (bot - top) * 0.55;
  // 写像素的同时量出真实边界，裁边就不用再 getImageData 回读一遍（手机上回读 GPU 很贵）
  let cx0 = w, cy0 = h, cx1 = -1, cy1 = -1;
  for (let i = 0; i < w * h; i++) {
    const k = cell[i]; if (!k) continue;
    const y = (i / w) | 0, x = i - y * w;
    if (x < cx0) cx0 = x; if (x > cx1) cx1 = x;
    if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
    let col = k === 1 ? (y > mid ? cF2 : cF) : cO;
    if (k === 1 && cH && y <= top + Math.max(1, Math.round(px / 12)) - 1 + (ink[i - w] ? 1 : 0) && !ink[i - w]) col = cH;
    out.data.set([...col, 255], i * 4);
  }
  return cropTo(out, cx0, cy0, cx1, cy1);
}

// 用已经算好的边界把 ImageData 裁成一张画布（不读回像素）
function cropTo(src, x0, y0, x1, y1) {
  if (x1 < 0 || x1 < x0) { const c0 = document.createElement('canvas'); c0.width = 1; c0.height = 1; return c0; }
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').putImageData(src, -x0, -y0);
  return o;
}

function crop(c) {
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return c;
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, -x0, -y0);
  return o;
}

// 字符画 → 像素图。key 里 '.' 透明，其余字符查 pal
function bitmap(rows, pal) {
  const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
  return c;
}

const ICONS = {
  info: [
    '.##.',
    '.##.',
    '....',
    '###.',
    '.##.',
    '.##.',
    '.##.',
    '####',
  ],
  next: [   // 不留空列，放进按钮才正好居中
    '##...',
    '###..',
    '.###.',
    '..###',
    '..###',
    '.###.',
    '###..',
    '##...',
  ],
  prev: [
    '...##',
    '..###',
    '.###.',
    '###..',
    '###..',
    '.###.',
    '..###',
    '...##',
  ],
  cup: [   // 成就：金奖杯（环形双耳、两档明暗、底座）
    '..#######..',
    '###hoooo###',
    '#.#hoood#.#',
    '#.#hoood#.#',
    '.##hoood##.',
    '...#ood#...',
    '....#o#....',
    '....#o#....',
    '...#####...',
    '..#######..',
  ],
  book: [   // 图鉴：翻开的书
    '.###...###.',
    '#ppp###ppp#',
    '#p##p#p##p#',
    '#pppp#pppp#',
    '#p##p#p##p#',
    '#pppp#pppp#',
    '#p##p#p##p#',
    '#pppp#pppp#',
    '###########',
  ],
  pause: [
    '##.##',
    '##.##',
    '##.##',
    '##.##',
    '##.##',
    '##.##',
    '##.##',
    '##.##',
  ],
  shake: [   // 美梦模式摇一摇（2026-11-14 用户选的 C，再按用户手点的图把两侧抖动线改成锯齿波浪线）：
               // 小木箱里装着球，一颗金豆被颠出箱口，两侧锯齿线是晃动。11×7，装进 26×26 方键（原来 13×11 贴着键边、显得挤）
    '....hoo....',
    '....odd....',
    '...........',
    '.#.#...#..#',
    '#..#bb.#.#.',
    '.#.#bbo#..#',
    '#..#####.#.',
  ],
  water: [   // 普通模式灌水（2026-11-14）：和摇一摇同一个小木箱，一滴水正往里落，箱里的水面上浮着一颗金豆。11×7，装进 26×26 方键
    '.....w.....',
    '....vww....',
    '.#.......#.',
    '.#...ho..#.',
    '.#vvvodvv#.',
    '.#wwwwwww#.',
    '.#########.',
  ],
  moon: [   // 美梦：金色弯月（左上亮、右下暗）
    '...###.....',
    '..#hh#.....',
    '.#ho#......',
    '.#ho#......',
    '#hoo#......',
    '#hoo#......',
    '#hooo#.....',
    '#hoooo##...',
    '.#ooooo####',
    '.#ddoooood#',
    '..##dddd##.',
    '....####...',
  ],
  home: [   // 返回开始页：小房子（红屋顶、纸色墙、木门）
    '.....#.....',
    '....#x#....',
    '...#xxx#...',
    '..#xxxxx#..',
    '.#xxxxxxx#.',
    '###########',
    '.#ppppppp#.',
    '.#pp###pp#.',
    '.#pp#m#pp#.',
    '.#pp#m#pp#.',
    '.#########.',
  ],
  note: [   // 意见便签：黄便签纸（两道横线、右下角折起），顶上一颗红图钉；放进和 i 同款的 26px 方键里
    '...##...',
    '..#kx#..',
    '###zz###',
    '#yqqqqy#',
    '#yyyyyy#',
    '#yqqqqy#',
    '#yyyy###',
    '#yqqy#Y#',
    '#yyyy##.',
    '######..',
  ],
  sound: [
    '...#.....',
    '..##..#..',
    '####...#.',
    '####.#.#.',
    '####.#.#.',
    '####...#.',
    '..##..#..',
    '...#.....',
  ],
  mute: [
    '...#.....',
    '..##.....',
    '####x...x',
    '####.x.x.',
    '####..x..',
    '####.x.x.',
    '..##x...x',
    '...#.....',
  ],
};
// '#' 描边  x 红  o/h/d 金色（本色/高光/暗部）  p 纸色  m/n 木框（本色/高光）  b/l 蓝球（本色/高光）  r 小笼包白
// 便签：y 便签黄  q 横线  Y 折角  k/z 图钉（高光/暗部）
const ICON_PAL = { '#': INK, 'x': '#c8402f', 'o': '#f0b828', 'h': '#fff1a8', 'd': '#c88a1e', 'p': '#fff6e0',
  'm': '#8a5a36', 'n': '#b07a4c', 'b': '#5aa6e8', 'l': '#cfe8ff', 'r': '#f3e6cf',
  'y': '#ffe98a', 'q': '#d9a640', 'Y': '#f2c45a', 'k': '#ff9a7a', 'z': '#8a2a20',
  'w': '#2f6f6c', 'v': '#8fc4b4' };   // w/v：灌水图标的水（取背景海面的青绿，2026-11-14）
function icon(name) { return bitmap(ICONS[name], ICON_PAL); }

// 把像素图放进元素里（u = 一个像素占几个逻辑像素）
// 屏幕放大倍数不是整数时，先最近邻放大 PixUI.zoom = k 倍（不超过实际倍数的整数），余下不到 2 倍交给浏览器最近邻，和画布同一套做法；
// 实际倍数不到 1 时 html.smooth 让浏览器平滑缩小（见 game.js 的 resize）
function put(el, canvas, u, alt = '') {
  const im = new Image();
  // 一个美术像素占的物理像素够多（>= 2.5）时直接最近邻放大：边缘锐利，偶尔某列宽一个物理像素也看不出来；
  // 细网格小字（一格才 1~2 个物理像素）先最近邻放大 k 倍，余下交给浏览器最近邻（个别行/列宽一个物理像素，但不糊）
  const crisp = u * (window.PixUI.dev || 1) >= 2.5;
  const k = crisp ? 1 : window.PixUI.zoom || 1;
  let src = canvas;
  if (k > 1) {
    src = document.createElement('canvas'); src.width = canvas.width * k; src.height = canvas.height * k;
    const g = src.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(canvas, 0, 0, src.width, src.height);
  }
  im.src = src.toDataURL();
  im.alt = alt;
  im.draggable = false;
  im.className = crisp ? 'pix crisp' : 'pix';
  im.style.width = canvas.width * u + 'px';
  im.style.height = canvas.height * u + 'px';
  el.replaceChildren(im);
  if (alt) el.setAttribute('aria-label', alt);
}

// 自动换行的像素段落。runs: [{t, bold, color, href}]；px/maxW/lh 都按目标像素网格给。
// 返回 { canvas, links: [{href, rects:[{x,y,w,h}]}] }，链接区域给外面放可点击的 <a>。
const NO_START = '，。、；：！？）」》』”’,.;:!?)';
function para(runs, { px = 12, maxW = 240, lh = 1.6, thr = 70, align = 'left' } = {}) {
  const m = document.createElement('canvas').getContext('2d');
  const fontOf = (r) => `${r.bold ? 'bold ' : ''}${px}px ${FONT}`;
  const lineH = Math.round(px * lh);
  const toks = [];
  // 文本里的 \n 是强制换行（text.json 里的字符串直接写 \n 就行）
  for (const r of runs) r.t.split('\n').forEach((part, i) => {
    if (i > 0) toks.push({ t: '\n', r, nl: true });
    if (r.nobr) { if (part) toks.push({ t: part, r }); return; }   // nobr：整段不拆行（教程里的 **粗体** 短语用，别把「分开记」拆成「分开」「记」）
    for (const t of part.match(/[A-Za-z0-9@._\/\-]+|\s+|[（《「『“‘(]*(?:[A-Za-z0-9@._\/\-]+|[^\s])/g) || []) toks.push({ t: /^\s+$/.test(t) ? ' ' : t, r });
  });
  // 开括号不放行尾：正则里已把开括号和后一个字连成一块
  let x = 0, line = 0;
  const placed = [];
  // 强制换行 token（nl）不画也不量，不参与字模检查：字模里没有 \n，不跳过的话带 \n 的段落会整段退回系统字体并报「字模缺」
  const useAtlas = toks.every(k => k.nl || measure(k.t, px, !!k.r.bold) !== null);
  for (const k of toks) {
    if (k.nl) { x = 0; line++; continue; }   // 强制换行
    m.font = fontOf(k.r);
    const w = useAtlas ? measure(k.t, px, !!k.r.bold) : m.measureText(k.t).width;
    if (x > 0 && x + w > maxW && !NO_START.includes(k.t)) {
      if (k.t === ' ') continue;
      x = 0; line++;
    }
    if (x === 0 && k.t === ' ') continue;
    placed.push({ ...k, x, line, w });
    x += w;
  }
  // align: 'left' 靠左 | 'right' 每行靠右 | 'center' 每行单独居中 | 'auto' 一行放得下就居中，放不下（换行了）就全部靠左
  if (align === 'center' || align === 'right' || (align === 'auto' && line === 0)) {   // right：每行靠右（教程里相框在右边时，字贴着相框）
    const right = [];
    for (const p of placed) right[p.line] = Math.max(right[p.line] || 0, p.x + p.w);
    for (const p of placed) p.x += Math.round((maxW - right[p.line]) / (align === 'right' ? 1 : 2));
  }
  const W = Math.ceil(maxW) + 4, H = (line + 1) * lineH + 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (useAtlas) {
    const a = new Uint8Array(W * H), im = g.createImageData(W, H), d = im.data;
    const rgb = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    for (const p of placed) {
      const col = rgb(p.r.color || INK);
      stamp(a, W, H, p.t, px, !!p.r.bold, p.x, p.line * lineH + Math.round(lineH / 2 + px * 0.38), (i) => d.set(col, i * 4));
    }
    for (let i = 0; i < a.length; i++) d[i * 4 + 3] = a[i] > thr ? 255 : 0;
    g.putImageData(im, 0, 0);
  } else {
    g.textBaseline = 'middle';
    for (const p of placed) { g.font = fontOf(p.r); g.fillStyle = p.r.color || INK; g.fillText(p.t, p.x, p.line * lineH + lineH / 2); }
    const im = g.getImageData(0, 0, W, H), d = im.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > thr ? 255 : 0;
    g.putImageData(im, 0, 0);
  }
  const links = [];
  for (const p of placed) {
    if (!p.r.href) continue;
    let L = links.find(l => l.href === p.r.href);
    if (!L) links.push(L = { href: p.r.href, rects: [] });
    const last = L.rects[L.rects.length - 1];
    if (last && last.line === p.line) last.w = p.x + p.w - last.x;
    else L.rects.push({ line: p.line, x: p.x, y: p.line * lineH, w: p.w, h: lineH });
  }
  return { canvas: c, links };
}

window.PixUI = { text, icon, put, bitmap, para, INK, ready, missed, zoom: 1, ICONS, ICON_PAL };
})();
