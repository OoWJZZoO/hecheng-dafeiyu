// 本地测试用的假 B站 Toy SDK（2026-11-21）：python tools/build_toy.py --fake 打出 dist/toy-fake/，用它代替真 SDK。
// 只实现 toy.js 用到的几个方法，数据存在本机 localStorage（键名不以 dfy_ 开头，游戏的「清空存档」不会碰它）。
// 网址参数：?guest 当成没登录；?limit 所有云存储 / 排行榜请求都报 307044 限流；?slow 云存档读 5 秒才回来；?fail 榜单读取失败。
(() => {
  const q = location.search;
  const has = (k) => new RegExp(`[?&]${k}\\b`).test(q);
  const KEY = 'fake_toy_cloud', RANK = 'fake_toy_rank';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const err = (type, code, message) => Object.assign(new Error(`[ToySDK] ${message}`), { type, code });
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const log = (...a) => console.log('%c[fake toy]', 'color:#c88a1e', ...a);
  const guard = async (ms = 250) => {
    await wait(ms);
    if (has('limit')) throw err('http_error', 307044, '请求过于频繁，请稍后再试');
    if (has('guest')) throw err('not_logged_in', -101, '未登录');
  };
  const NPC = ['小笼包爱好者', '饭盆小鲸本鲸', '大肥鱼今天也很肥', '豆包不是包', '路过的螃蟹', '镀金大师', '一只很长很长很长很长的昵称测试用户', 'Oo肥鱼O', '摸鱼选手', '面窝'];
  const npcs = (board) => NPC.map((nickname, i) => ({ nickname, avatar: '', score: Math.round((board === 1 ? 9000 : 30000) / (i + 1.3)) }));
  const table = (board) => {
    const me = load(RANK, {})[board];
    const all = npcs(board).concat(me != null ? [{ nickname: '我（假 SDK）', avatar: '', score: me, me: true }] : []);
    all.sort((a, b) => b.score - a.score);
    return all.map((x, i) => ({ ...x, rank: i + 1 }));
  };
  let confirmed = false;
  window.toy = {
    async isSupport(name) { return !['saveImageToAlbum', 'share', 'sharePicture', 'closeBrowser'].includes(name); },
    async getCloudStorage(keys) {
      await guard(has('slow') ? 5000 : 300);
      const all = load(KEY, {}), out = {};
      for (const k of keys && keys.length ? keys : Object.keys(all)) if (k in all) out[k] = all[k];
      log('getCloudStorage', out); return out;
    },
    async setCloudStorage(items) {
      await guard();
      for (const [k, v] of Object.entries(items)) if (typeof v !== 'string' || new TextEncoder().encode(v).length > 1024) throw err('invalid_param', 0, `value 不合法：${k}`);
      save(KEY, { ...load(KEY, {}), ...items }); log('setCloudStorage', items);
    },
    async removeCloudStorage(keys) {
      await guard(); const all = load(KEY, {}); for (const k of keys) delete all[k]; save(KEY, all); log('removeCloudStorage', keys);
    },
    async submitScore({ board = 1, score }) {
      await guard();
      if (!confirmed) { confirmed = true; log('（真 SDK 这里会弹一次用户数据确认）'); }
      const r = load(RANK, {}); r[board] = Math.max(r[board] ?? -Infinity, score); save(RANK, r);
      log('submitScore', board, score); return { score: r[board] };
    },
    async getRankList({ board = 1, limit = 50 } = {}) {
      await wait(400);
      if (has('limit')) throw err('http_error', 307044, '请求过于频繁，请稍后再试');
      if (has('fail')) throw err('http_error', 500, '服务器开小差');
      log('getRankList', board); return table(board).slice(0, limit).map(({ me, ...x }) => x);
    },
    async getMyRank({ board = 1 } = {}) {
      await guard(200);
      const mine = table(board).find((x) => x.me);
      return mine ? { ranked: true, rank: mine.rank, score: mine.score } : { ranked: false, rank: 0, score: 0 };
    },
    async navigate(req) { log('navigate', req); window.__fakeNav = req; },
    onPageClose(fn) { log('onPageClose 已注册'); return () => {}; },
  };
  log('假 SDK 已加载', q || '（无参数）');
})();
