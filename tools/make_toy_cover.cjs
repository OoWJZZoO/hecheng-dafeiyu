// B站 Toy 封面：打开 tools/toy_cover.html（照开始页样式重排的 4:3 横图），截成 1200×900 PNG。
// 用法：NODE_PATH=$(npm root -g) node tools/make_toy_cover.cjs [输出路径，默认 dist/toy-meta/cover.png] [网址参数，如 bgx=10&bgy=30]
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(path.join(process.env.APPDATA || '', 'npm/node_modules/playwright')); } })();
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist/toy-meta/cover.png'));
const QUERY = process.argv[3] ? '?' + process.argv[3] : '';
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  try { const b = fs.readFileSync(path.join(ROOT, u)); res.setHeader('Content-Type', (mime[path.extname(u)] || 'application/octet-stream') + '; charset=utf-8'); res.end(b); } catch (e) { res.writeHead(404); res.end('404'); }
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/toy_cover.html${QUERY}`);
  await page.waitForFunction(() => document.title === 'done' || document.title.startsWith('error'), null, { timeout: 20000 });
  const title = await page.title();
  if (title !== 'done') throw new Error(title);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.locator('#c').screenshot({ path: OUT });
  console.log('封面：' + path.relative(ROOT, OUT));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
