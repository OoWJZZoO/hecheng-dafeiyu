"""打 B站 Toy 版的上传包（2026-11-21）。先跑过 python tools/build.py（文案、字模、版本号是它管的），再跑：

    python tools/build_toy.py           → dist/toy/       上传 Toy 用（注入真 SDK）
    python tools/build_toy.py --fake    → dist/toy-fake/  本地测试用（注入 tools/toy_fake_sdk.js 假 SDK）

GitHub Pages 版不受影响：它不带 toy.js，游戏里跟 Toy 有关的东西（排行榜、云存档）都不出现。
Toy 版和网页版的区别全在这里做，源文件不分叉：
1. 只拷运行要的文件（同 .github/workflows/pages.yml），外加 toy.js。
2. index.html 的 <head> 里注入 B站 Toy SDK 和 toy.js（带内容哈希版本号）。
3. 删掉意见便签的输入框和发送代码（toy-strip 标记之间）：Toy 不许有未经授权的自由输入。
4. text.js 里署名页的站外链接（CC 许可）只留文字：Toy 不许跳站外。B站 空间链接留着，游戏里走 toy.navigate。
5. 正式包（不带 --fake）关掉全部调试网址参数（?debug ?dream ?gold ?showcase ……）：game.js 里读 location.search
   的地方全换成空串。不关的话，玩家在 Toy 地址后面加 ?debug 就能随便丢大肥鱼刷分，点开排行榜时本地最高分会被交上去。
   --fake 测试包保留（冒烟测试 tools/smoke_web.cjs 要用 ?debug 的钩子）。
6. 检查：入口 index.html ≤ 1MB、没有 textarea / fetch、没有站外链接残留、正式包里没有 location.search。
上传前再用官方预检 toy_doctor.py 过一遍（见 README「B站 Toy 版」）。
"""
import argparse
import hashlib
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SDK = '//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js'
FILES = ['index.html', 'game.js', 'pixui.js', 'text.js', 'toy.js', 'vendor', 'sprites']
ENTRY_MAX = 1024 * 1024
BILI = re.compile(r'^https?://([\w-]+\.)*bilibili\.com/')


def die(msg):
    sys.exit(f'build_toy: {msg}')


def strip_block(text, start, end, name):
    pat = re.compile(re.escape(start) + r'.*?' + re.escape(end) + r'[^\n]*\n?', re.S)
    out, n = pat.subn('', text)
    if n == 0:
        die(f'{name} 里没找到 {start} … {end} 标记')
    return out, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fake', action='store_true', help='注入假 SDK，打本地测试包')
    args = ap.parse_args()
    out = ROOT / 'dist' / ('toy-fake' if args.fake else 'toy')
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for f in FILES:
        src = ROOT / f
        (shutil.copytree if src.is_dir() else shutil.copy2)(src, out / f)

    # toy.js / 假 SDK
    toy_v = hashlib.md5((ROOT / 'toy.js').read_bytes()).hexdigest()[:8]
    if args.fake:
        shutil.copy2(ROOT / 'tools' / 'toy_fake_sdk.js', out / 'toy_fake_sdk.js')
        sdk_tag = '<script src="toy_fake_sdk.js"></script>'
    else:
        sdk_tag = f'<script src="{SDK}"></script>'
    inject = f'{sdk_tag}\n<script src="toy.js?v={toy_v}"></script>\n'

    # index.html：注入脚本、删输入框
    p = out / 'index.html'
    html = p.read_text(encoding='utf-8')
    html, _ = strip_block(html, '<!-- toy-strip -->', '<!-- /toy-strip -->', 'index.html')
    if '</title>' not in html:
        die('index.html 没有 </title>，不知道往哪注入')
    html = html.replace('</title>\n', '</title>\n' + inject, 1)
    p.write_text(html, encoding='utf-8')

    # game.js：删意见便签的代码
    p = out / 'game.js'
    js, n = strip_block(p.read_text(encoding='utf-8'), '// <toy-strip>', '// </toy-strip>', 'game.js')
    if n != 1:
        die(f'game.js 里 toy-strip 标记应该正好 1 对，现在 {n} 对')
    # 正式包：调试网址参数全部失效（见文件头第 5 条）
    if not args.fake:
        n = js.count('location.search')
        if n < 5:
            die(f'game.js 里只找到 {n} 处 location.search，和预期不符，先看看调试开关是不是改了写法')
        js = js.replace('location.search', "''")
    p.write_text(js, encoding='utf-8')

    # text.js：站外链接只留文字
    p = out / 'text.js'
    txt = p.read_text(encoding='utf-8')
    dropped = []

    def unlink(m):
        if BILI.match(m.group(2)):
            return m.group(0)
        dropped.append(m.group(2))
        return m.group(1)
    txt = re.sub(r'\[([^\[\]]+)\]\((https?://[^)\s]+)\)', unlink, txt)
    p.write_text(txt, encoding='utf-8')

    # 检查
    errs = []
    entry = (out / 'index.html').stat().st_size
    if entry > ENTRY_MAX:
        errs.append(f'入口 index.html {entry} 字节，超过 1MB')
    for name in ('index.html', 'game.js'):
        s = (out / name).read_text(encoding='utf-8')
        if not args.fake and 'location.search' in s:
            errs.append(f'{name} 里还有 location.search（正式包不该留调试开关）')
        if re.search(r'<textarea|createElement\([\'"]textarea', s):
            errs.append(f'{name} 里还有 textarea')
        if 'fetch(' in s:
            errs.append(f'{name} 里还有 fetch(')
    for name in ('index.html', 'game.js', 'pixui.js', 'text.js', 'toy.js'):
        for url in re.findall(r'https?://[^\s"\'<>)\]]+', (out / name).read_text(encoding='utf-8')):
            if not BILI.match(url) and 'hdslb.com' not in url:
                errs.append(f'{name} 里有站外链接：{url}')
    if errs:
        die('检查没过：\n  ' + '\n  '.join(errs))

    total = sum(f.stat().st_size for f in out.rglob('*') if f.is_file())
    print(f'Toy 包：{out.relative_to(ROOT)}（{"假 SDK" if args.fake else "真 SDK"}）')
    print(f'  入口 index.html {entry / 1024:.1f} KB，整包 {total / 1024 / 1024:.2f} MB，{sum(1 for f in out.rglob("*") if f.is_file())} 个文件')
    if dropped:
        print('  去掉的站外链接（只留文字）：' + '、'.join(dropped))


if __name__ == '__main__':
    main()
