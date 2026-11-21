// B站 Toy 适配层（2026-11-21）。只在 Toy 包里加载：tools/build_toy.py 把 B站 SDK 和本文件注入 <head>，
// GitHub Pages 版不带它们，window.TOY 不存在，游戏里跟 Toy 有关的东西（排行榜入口等）都不出现。
//
// 做三件事：
// 1. 云存档：游戏照旧只读写 localStorage；这里把几项存档（最高分、成就、图鉴、美梦进度、教程、设置）镜像到 Toy 云存储。
//    开局前先读一次云端、和本地合并后写回本地（index.html 等 window.TOY_BOOT 再加载 game.js）；之后本地一改就记下，
//    攒几秒批量写一次、切后台 / 关页面时立刻写。写的时候总是「本地 ∪ 云端」合并后的值，换设备、云端读得慢都不会把进度冲掉。
// 2. 排行榜：board 1 = 普通模式最高分，board 2 = 美梦模式最高分。第一次提交要平台弹用户数据确认，所以第一次只在
//    玩家点开排行榜时（用户手势里）提交；提交成功过以后，破纪录时在后台直接提交。
// 3. 跳转：署名页里的 B站 空间链接走 toy.navigate（Toy 里不能用普通链接跳走）。
//
// 频率限制（官方「频率限制与最佳实践」）：存档只在有改动时、攒一批再写；榜单读一次本地缓存一会儿，不轮询；
// 遇到 307044（请求过于频繁）按指数退避重试，不立即重试。
(() => {
  const sdk = window.toy;
  if (!sdk) return;

  const SYNC = ['dfy_best', 'dfy_dream', 'dfy_dream_best', 'dfy_ach', 'dfy_seen', 'dfy_tut', 'dfy_sound', 'dfy_set'];
  const SYNC_SET = new Set(SYNC);
  const BOOT_WAIT = 2500;     // 开局前最多等云端这么久，等不到就先用本地的（读到以后的写入照样合并，不丢）
  const SAVE_DELAY = 4000;    // 本地改动后攒这么久再写云端
  const LIST_TTL = 60000;     // 榜单本地缓存时长
  const MAX_VALUE = 1024;     // 云存储单个 value 上限（字节）
  const SCORE_MAX = 16777215; // 排行榜分数上限

  const ls = window.localStorage;
  const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const lsSet = (k, v) => rawSet.call(ls, k, v);
  const lsGet = (k) => ls.getItem(k);
  const bytes = (s) => new TextEncoder().encode(s).length;
  const isLimit = (e) => e && e.type === 'http_error' && Number(e.code) === 307044;
  const parse = (s, d) => { try { const v = JSON.parse(s); return v == null ? d : v; } catch { return d; } };

  // ---------------------------------------------------------------- 合并规则（本地 a、云端 b，都是字符串或 null）
  const objMin = (a, b) => {   // {id: 首次时间}：并集，同一项取更早的时间
    const o = { ...parse(b, {}) };
    for (const [k, v] of Object.entries(parse(a, {}))) o[k] = k in o ? Math.min(+o[k] || v, +v || o[k]) : v;
    return o;
  };
  const MERGE = {
    dfy_best: (a, b) => String(Math.max(+a || 0, +b || 0)),
    dfy_dream_best: (a, b) => String(Math.max(+a || 0, +b || 0)),
    dfy_ach: (a, b) => JSON.stringify(objMin(a, b)),
    dfy_tut: (a, b) => JSON.stringify(objMin(a, b)),
    dfy_seen: (a, b) => JSON.stringify([...new Set([...parse(b, []), ...parse(a, [])])]),
    dfy_dream: (a, b) => {
      const x = parse(a, {}), y = parse(b, {});
      return JSON.stringify({ miss: Math.max(+x.miss || 0, +y.miss || 0), unlocked: !!(x.unlocked || y.unlocked), entered: !!(x.entered || y.entered) });
    },
    dfy_sound: (a, b) => (a != null ? a : b),   // 旧的声音开关（2026-11-21 前）：这台设备自己的选择优先
    dfy_set: (a, b) => (a != null ? a : b),     // 设置页（音量、静音、粒子档位）：同上
  };
  const merge = (k, a, b) => (a == null ? b : b == null ? a : MERGE[k](a, b));

  // ---------------------------------------------------------------- 云存档
  let cloud = null;            // 最近一次读到 / 写成功的云端值 {key: string}；null = 还没读到（读到之前不写，免得冲掉云端）
  let cloudOff = false;        // 没登录 / 不支持：整局不再碰云存储
  const dirty = new Set();
  let removeAll = false, timer = 0, backoff = 0, saving = null;

  async function readCloud() {
    if (!(await sdk.isSupport('getCloudStorage'))) throw Object.assign(new Error('unsupported'), { type: 'unsupported' });
    return sdk.getCloudStorage(SYNC);
  }
  // 云端读到后：和本地合并写回本地；云端缺的 / 比本地旧的记成待写
  function absorb(remote) {
    cloud = { ...remote };
    for (const k of SYNC) {
      const a = lsGet(k), b = remote[k] ?? null, m = merge(k, a, b);
      if (m == null) continue;
      if (m !== a) lsSet(k, m);
      if (m !== b) dirty.add(k);
    }
    if (dirty.size) schedule();
  }
  function schedule(delay = SAVE_DELAY) {
    if (cloudOff) return;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }
  async function flush() {
    clearTimeout(timer);
    if (cloudOff || !cloud || saving) return saving;
    if (!removeAll && !dirty.size) return;
    saving = (async () => {
      try {
        if (removeAll) {
          await sdk.removeCloudStorage(SYNC);
          removeAll = false; cloud = {}; dirty.clear();
          return;
        }
        const items = {}, keys = [...dirty];
        for (const k of keys) {
          const v = merge(k, lsGet(k), cloud[k] ?? null);
          if (v == null) continue;
          if (bytes(v) > MAX_VALUE) { console.warn('[toy] 存档项太大，不上传：', k, bytes(v)); continue; }
          items[k] = v;
        }
        keys.forEach((k) => dirty.delete(k));
        if (Object.keys(items).length) {
          await sdk.setCloudStorage(items);
          Object.assign(cloud, items);
        }
        backoff = 0;
      } catch (e) {
        if (isLimit(e)) {   // 限流：退避后再试（4 秒起，翻倍，封顶 1 分钟）
          backoff = Math.min(60000, backoff ? backoff * 2 : 4000);
          for (const k of SYNC) if (lsGet(k) != null) dirty.add(k);
          schedule(backoff);
        } else {
          console.warn('[toy] 云存档写入失败，本局不再同步', e);
          cloudOff = true;
        }
      } finally { saving = null; }
    })();
    return saving;
  }
  // 游戏写 / 删存档时记下来（游戏本身不知道有云存档）
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === ls && SYNC_SET.has(k)) { dirty.add(k); schedule(); }
  };
  Storage.prototype.removeItem = function (k) {
    rawRemove.call(this, k);
    if (this === ls && SYNC_SET.has(k)) removeAll = true;   // 游戏里删存档只有「清空存档」一处，删就是全删
  };
  // 清空存档后的重开（game.js：有 window.RESTART 就交给它）：先把云端也清掉再刷新，不然一刷新云端又合并回来
  window.RESTART = async () => {
    removeAll = true;
    try { await Promise.race([flush(), new Promise((r) => setTimeout(r, 3000))]); } catch {}
    location.reload();
  };
  const flushNow = () => { if (dirty.size || removeAll) flush(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });
  addEventListener('pagehide', flushNow);
  sdk.isSupport('onPageClose').then((ok) => ok && sdk.onPageClose(flushNow)).catch(() => {});

  // 开局前先读云端（index.html：game.js 等 TOY_BOOT）
  const read = readCloud();
  read.then(absorb, (e) => { cloudOff = true; if (e && e.type !== 'not_logged_in' && e.type !== 'unsupported') console.warn('[toy] 云存档读取失败', e); });
  window.TOY_BOOT = Promise.race([read.catch(() => {}), new Promise((r) => setTimeout(r, BOOT_WAIT))]);

  // ---------------------------------------------------------------- 排行榜
  const BOARDS = { 1: 'dfy_best', 2: 'dfy_dream_best' };
  const sent = () => parse(lsGet('dfy_rank_sent'), {});   // {board: 已提交过的最高分}，只记在本机
  const lists = {};   // board → {at, list, mine}
  let submitting = null;

  async function submitAll() {
    if (submitting) return submitting;
    // 两个榜各交一次（不同榜没法合成一次调用），分数没涨就不交；第一个失败就不交第二个
    const one = async (b) => {
      const done = sent(), score = Math.min(SCORE_MAX, Math.floor(+lsGet(BOARDS[b]) || 0));
      if (score <= 0 || score <= (+done[b] || 0)) return;
      await sdk.submitScore({ board: b, score });
      done[b] = score; lsSet('dfy_rank_sent', JSON.stringify(done)); lsSet('dfy_rank_ok', '1');
      delete lists[b];   // 自己的分变了，榜单重拉
    };
    submitting = one(1).then(() => one(2));
    try { return await submitting; } finally { submitting = null; }
  }

  window.TOY = {
    // 打开排行榜（用户点了入口，在手势里）：先补交没提交的分，再拉这一榜的前 50 名和我的名次
    // 返回 {list, mine, err}；err：'login' 没登录 / 'busy' 限流 / 'fail' 其他失败
    async rank(board, { fresh = false } = {}) {
      let err = null;
      try { await submitAll(); } catch (e) { err = e; }
      const c = lists[board];
      if (!fresh && c && Date.now() - c.at < LIST_TTL) return { list: c.list, mine: c.mine, err: null };
      try {
        const [list, mine] = await Promise.all([
          sdk.getRankList({ board, period: 'all', limit: 50 }),
          sdk.getMyRank({ board, period: 'all' }).catch((e) => (e && e.type === 'not_logged_in' ? null : Promise.reject(e))),
        ]);
        lists[board] = { at: Date.now(), list: list || [], mine };
        return { list: list || [], mine, err: err ? kind(err) : (mine ? null : 'login') };
      } catch (e) {
        return { list: c ? c.list : null, mine: c ? c.mine : null, err: kind(e) };
      }
    },
    // 破纪录以后（game.js keepBest）：提交成功过一次（已经过了平台的确认弹窗）才在后台直接提交，否则等玩家点开排行榜
    best() {
      if (lsGet('dfy_rank_ok') !== '1') return;
      submitAll().catch((e) => { if (!isLimit(e)) console.warn('[toy] 提交分数失败', e); });
    },
    // 署名页 B站 空间链接
    space(mid) { sdk.navigate({ type: 'space', id: String(mid) }).catch((e) => console.warn('[toy] 跳转失败', e)); },
  };
  function kind(e) {
    if (!e) return null;
    if (e.type === 'not_logged_in' || Number(e.code) === -101) return 'login';
    if (isLimit(e)) return 'busy';
    return 'fail';
  }
})();
