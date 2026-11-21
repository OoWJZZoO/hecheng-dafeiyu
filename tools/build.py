"""构建：改完 text.json（文案数据文件）后跑一遍，网页就能看到新文案。

    python tools/build.py          （在仓库根目录或任意目录都行）

做五件事：
0. 从 docs/署名与授权.md 同步署名文案：重写 text.json 的「署名页」；
   署名文案只改源文件，不要直接改生成物。
1. 检查 text.json：游戏代码用到的每一条都在；成就 id 都对得上；{n} {a} {b} {date} {page} {total} {mode} 以外的占位符报错；空文案报错。
2. 生成 text.js（window.TEXT = {...}），index.html 里在 game.js 之前加载。
3. 重跑 make_font.py：新文案里出现的新字补进字模图（没新字时输出和原来一模一样）。
4. 更新缓存版本号：text.js / game.js / pixui.js / shapes.js / bgm.js 以及字模图，把引用处的 ?v=xxx 换成文件内容的哈希，
   文件没变版本号就不变，改了浏览器一定拉新的。
不检查文案「放得下放不下」，字变长了自己在游戏里看一眼。
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO / "tools"))
import attribution  # noqa: E402
ALLOWED = {'n', 'a', 'b', 'date', 'page', 'total', 'mode'}


def load():
    return json.loads((ROOT / 'text.json').read_text(encoding='utf-8'))


def strings(o, path=''):
    """遍历所有文案：yield (路径, 字符串)；以 _ 开头的键（说明）跳过"""
    if isinstance(o, str):
        yield path, o
    elif isinstance(o, dict):
        for k, v in o.items():
            if not str(k).startswith('_'):
                yield from strings(v, f'{path}.{k}' if path else k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from strings(v, f'{path}[{i}]')


def check(data):
    errs = []
    for path, s in strings(data):
        if not s.strip():
            errs.append(f'{path}：文案是空的')
        for ph in re.findall(r'\{(\w*)\}', s):
            if ph not in ALLOWED:
                errs.append(f'{path}：占位符 {{{ph}}} 不认识（可用：{{n}} {{a}} {{b}} {{date}} {{page}} {{total}} {{mode}}）')
    game = (ROOT / 'game.js').read_text(encoding='utf-8')
    # 游戏里用到的 TX.组.键，必须都在
    for grp, key in sorted(set(re.findall(r'TX\.([^\s.\[\],;(){}]+)\.([^\s.\[\],;(){}]+)', game))):
        if grp not in data or (isinstance(data[grp], dict) and key not in data[grp]):
            errs.append(f'game.js 用到了 TX.{grp}.{key}，text.json 里没有')
    # 成就：ACH 里的 id 都要有文案，反过来有文案没 id 也提醒
    m = re.search(r'const ACH = \[(.*?)\n\];', game, re.S)
    ids = re.findall(r"\{ id: '(\w+)'", m.group(1)) if m else []
    names = data.get('成就名单', {})
    for i in ids:
        if i not in names:
            errs.append(f'成就 {i} 在 text.json 的「成就名单」里没有文案')
        elif not {'名', '说明', '故事'} <= set(names[i]):
            errs.append(f'成就 {i} 缺「名」「说明」或「故事」')
    for i in names:
        if i not in ids:
            errs.append(f'「成就名单」里的 {i} 在 game.js 的 ACH 里没有对应成就（多余，不影响运行）')
    for i, para in enumerate(data.get('署名页', {}).get('段落', [])):
        if para.count('**') % 2:
            errs.append(f'署名页.段落[{i}]：** 不成对（粗体要两边都加）')
        if para.count('[') != para.count(']') or para.count('](') != para.count('['):
            errs.append(f'署名页.段落[{i}]：链接要写成 [文字](网址)')
    for i, it in enumerate(data.get('物品', [])):
        for key in ('全名', '简称', '故事', '镀金故事'):
            if not it.get(key):
                errs.append(f'物品[{i}] 缺「{key}」')
    for i, t in names.items():
        if '{n}' in t.get('说明', '') and not isinstance(t.get('分数'), int):
            errs.append(f'成就 {i} 的说明里有 {{n}}，要给整数「分数」（既是得分门槛，也填进说明）')
    if len(data.get('物品', [])) != 11:
        errs.append('「物品」必须正好 11 项（对应 11 级）')
    if len(data.get('开始页', {}).get('玩法', [])) != 3:
        errs.append('「开始页.玩法」必须正好 3 行')
    return errs


def write_text_js(data):
    pub = {k: v for k, v in data.items() if not k.startswith('_')}
    out = '// 由 tools/build.py 从 text.json 生成，别手改，要改文案去改 text.json\nwindow.TEXT = ' + json.dumps(pub, ensure_ascii=False, indent=1) + ';\n'
    p = ROOT / 'text.js'
    old = p.read_text(encoding='utf-8') if p.exists() else None
    p.write_text(out, encoding='utf-8', newline='\n')
    return old != out


def digest(*paths):
    h = hashlib.sha1()
    for p in paths:
        h.update((ROOT / p).read_bytes())
    return h.hexdigest()[:8]


def set_version(file, pattern, ver):
    p = ROOT / file
    s = p.read_text(encoding='utf-8')
    new, n = re.subn(pattern + r'\?v=\w+', lambda m: f'{m.group(1)}?v={ver}', s)
    if n and new != s:
        p.write_text(new, encoding='utf-8', newline='')
        return True
    return False


def main():
    attribution.sync()
    data = load()
    errs = check(data)
    fatal = [e for e in errs if '多余' not in e]
    for e in errs:
        print(('错误：' if e in fatal else '提醒：') + e)
    if fatal:
        sys.exit('text.json 有错误，没有构建')
    changed = write_text_js(data)
    print('text.js', '已更新' if changed else '没变')

    import make_font
    make_font.main()

    set_version('pixui.js', r'(sprites/font\.json)', digest('sprites/font.json'))
    set_version('pixui.js', r'(sprites/font\.png)', digest('sprites/font.png'))
    set_version('game.js', r'(sprites/ach\.png)', digest('sprites/ach.png'))   # 成就头像图集（tools/make_ach_icons.py 生成）；先改 game.js 再算 game.js 的哈希
    for f, pat in (('text.js', r'(text\.js)'), ('game.js', r'(game\.js)'), ('pixui.js', r'(pixui\.js)'), ('sprites/shapes.js', r'(sprites/shapes\.js)'),
                   ('sprites/ach.js', r'(sprites/ach\.js)'), ('bgm.js', r'(bgm\.js)')):
        if set_version('index.html', pat, digest(f)):
            print('index.html 里', f, '的版本号换新了')
    print('构建完成')


if __name__ == '__main__':
    main()
