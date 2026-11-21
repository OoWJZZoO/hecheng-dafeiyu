"""生成像素字的字模图 sprites/font.png + sprites/font.json。

为什么要字模：像素字是「字体画小字 → 二值化」。如果直接用系统字体，每台设备字体不同（电脑微软雅黑、
手机鸿蒙/小米字体……），二值化出来的点阵也不同，手机上会粘连缺损。所以改成离线用同一款开源字体
（思源黑体 Noto Sans SC，SIL OFL）把游戏里用到的字按用到的字号预先画好，所有设备读同一张图，画面一比一。

用法：python tools/make_font.py   （改了游戏里的文字、或新增字号后重跑；
       浏览器控制台出现「[PixUI] 字模缺」警告时，把缺的字号加进 STYLES、缺的字自然会被收集到）
"""
import json
import re
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = 'C:/Windows/Fonts/NotoSansSC-VF.ttf'

# (字号, 粗细[, 只要这些字])。字号按「点阵格」算：u=2 的大字就是原字号；小字画在 1.5 倍细网格上
# （见 game.js 的 FINE），字号 ×1.5
NUM = '+-0123456789'
# 页面标题（21 号字模只含这几个字）：text.json 里「署名页.标题」「图鉴.标题」「成就.标题」「意见.标题」「排行榜.标题」「设置.标题」，改标题文案后字会自动跟上
_tj = json.loads((ROOT / 'text.json').read_text(encoding='utf-8'))
TITLE_CHARS = ''.join(dict.fromkeys(_tj['署名页']['标题'] + _tj['图鉴']['标题'] + _tj['成就']['标题'] + _tj['意见']['标题'] + _tj['排行榜']['标题'] + _tj['设置']['标题'] + ''.join(v['标题'] for v in _tj['教程'].values() if isinstance(v, dict))))   # 教程每课的卡片标题也用 21 号标题字
STYLES = [
    (11, 400), (13, 700), (20, 700),                                           # 大字：按钮、名字、标题
    (12, 700, NUM), (14, 700, NUM),                                            # 大字：分数、+N 飘字
    (15, 400), (16.5, 400), (18, 400), (19.5, 400),                            # 小字（10/11/12/13 × 1.5）
    (16.5, 700), (18, 700), (19.5, 700), (27, 700, NUM),                       # 小字粗体（11/12/13/18 × 1.5）；11 号粗体给摇一摇教程用
    (21, 400, TITLE_CHARS),                                                    # 页面标题：21 格字、每格 4/3 逻辑像素，字重 350（见 WEIGHT）
]

# 个别字在小字号下笔画挤成一团（二值化后粘连）：
# WEIGHT 换个更细的字重来画；HAND 是手点的点阵（'#' 有墨），连字重都救不回来的字用它。
# 键是 '字号_粗细'（同 font.json），改了先在游戏里看一眼再提交。
WEIGHT = {
    ('15_400', '署'): 300, ('16.5_400', '署'): 300, ('18_400', '署'): 300, ('19.5_400', '署'): 300,
    ('20_700', '肥'): 500,
    **{('21_400', c): 350 for c in TITLE_CHARS},   # 页面标题整行统一细一档（400 偏粗）
}
HAND = {
    # 署名页标题「关于与署名」（11 号、每格 2 像素）：原字只有 10 行，罒/土/日 挤成一块
    # 12 行比别的字多 1 行：这一档字本来就有伸到基线下 1 格的（于、与），往下放 1 格顶边才和名齐
    ('11_400', '署'): ([
        '.#########.',
        '.#..#.#..#.',
        '.#########.',
        '.....#..#..',
        '...#####...',
        '###########',
        '....##.....',
        '..#######..',
        '..#.....#..',
        '..#######..',
        '..#.....#..',
        '..#######..',
    ], None, 1),
    # 名字（10 号小字 × 1.5）：月 和 巴 原来并成一块
    ('16.5_400', '肥'): [
        '.######.#########',
        '.##..##.##..#..##',
        '.##..##.##..#..##',
        '.##..##.##..#..##',
        '.######.##..#..##',
        '.##..##.##..#..##',
        '.##..##.#########',
        '.##..##.##.......',
        '.######.##.......',
        '.##..##.##.......',
        '.##..##.##.....##',
        '.##..##.##.....##',
        '##...##.##.....##',
        '#..####..#######.',
    ],
    # 金色标题（13 号粗体）：大肥鱼 / 双金大肥鱼 / 镀金…
    # 方块字比带尖头的字矮一格才显得齐；宽 12 放在 13 的步进里，左右各留 1 格，不和鱼粘
    ('13_700', '肥'): [
        '#####.######',
        '##.##.##.#.#',
        '#####.##.#.#',
        '##.##.##.#.#',
        '#####.######',
        '##.##.##....',
        '##.##.##....',
        '##.##.##..##',
        '##.##.##..##',
        '#..##.##..##',
        '#.###..#####',
    ],
    ('13_700', '鱼'): [
        '....##......',
        '...#######..',
        '..##....##..',
        '.##########.',
        '.##..##..##.',
        '.##########.',
        '.##..##..##.',
        '.##########.',
        '............',
        '############',
        '############',
    ],
    ('13_700', '金'): ([
        '......#......',
        '.....###.....',
        '...###.###...',
        '.###.....###.',
        '...#######...',
        '......#......',
        '.###########.',
        '......#......',
        '..##..#..##..',
        '...#..#..#...',
        '#############',
        '#############',
    ], -1),
    # 镀（2026-11-16 微信备案驳回「镀字不清晰」）：原字 钅 和 度 并成一团、度里的 廿/又 糊死
    # 钅 4 列 + 空 1 列 + 度 7 列；高 12 行和金一样（顶上有点，算带尖头的字）
    # bx = -1：居中时右下角和金只隔 0 列，描边粘在一起（用户指出），往左挪 1 格
    ('13_700', '镀'): ([
        '.#.......#..',
        '.###.#######',
        '#....#.#..#.',
        '.###.#.#####',
        '..#..#.#..#.',
        '####.#.####.',
        '..#..#......',
        '..#..#.#####',
        '..#..#..#.#.',
        '..#..#...#..',
        '..#..#..#.#.',
        '..##.#.#...#',
    ], -1),
}


def hand_glyph(rows, f, ch, bx=None, bottom=0):
    """手点字：最下一行落在基线上（bottom=1 则在基线下 1 格），水平居中在步进里（bx 可手动指定）。
    HAND 的值可以是点阵，也可以是 (点阵, bx) 或 (点阵, bx, bottom)，bx 写 None 表示居中。"""
    if isinstance(rows, tuple):
        rows, bx, bottom = (rows + (0,))[:3] if len(rows) == 2 else rows
    w, h = len(rows[0]), len(rows)
    im = Image.new('L', (w, h), 0)
    for y, r in enumerate(rows):
        assert len(r) == w, (ch, y)
        for x, c in enumerate(r):
            if c == '#':
                im.putpixel((x, y), 255)
    if bx is None:
        bx = round((f.getlength(ch) - w) / 2)
    return im, bx, bottom + 1 - h


def js_strings(src):
    """game.js 里所有字符串字面量的内容（跳过注释）。"""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('//', i):
            i = src.find('\n', i)
            i = n if i < 0 else i
        elif src.startswith('/*', i):
            i = src.find('*/', i) + 2
        elif c in '\'"`':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            out.append(src[i + 1:j])
            i = j + 1
        else:
            i += 1
    return out


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip, self.parts = 0, []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        for k, v in attrs:
            if k in ('title', 'alt', 'aria-label') and v:
                self.parts.append(v)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1

    def handle_data(self, d):
        if not self.skip:
            self.parts.append(d)


def charset():
    chars = set(chr(c) for c in range(32, 127))
    for s in js_strings((ROOT / 'game.js').read_text(encoding='utf-8')):
        chars.update(s)
    def walk(o):
        if isinstance(o, str):
            chars.update(o)
        elif isinstance(o, dict):
            for k, v in o.items():
                if not str(k).startswith('_'):
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(json.loads((ROOT / 'text.json').read_text(encoding='utf-8')))   # 文案数据文件里的字
    p = Text()
    p.feed((ROOT / 'index.html').read_text(encoding='utf-8'))
    for s in p.parts:
        chars.update(s)
    chars.update('×·…—“”‘’：；，。！？、（）《》「」')
    return sorted(ch for ch in chars if ch.isprintable())


# 手切的空白：(字号键, 字) -> [(起点 x, 行 y, 终点 x)]，坐标在字形裁到包围盒之后的小图上，闭区间
# 20 号粗体「停」：亭的「亠」横和「口」顶笔粘成 4 行厚，第 4 行（x 7–17）切掉，让横和口分开
# 13 号粗体「响」（镀金双响 / 大肥鱼双响）：向的左竖和里面小口的左竖并成 3 格粗，第 6 列 5–9 行切掉；
# 小口下面（第 10 行 6–7 列）还连着两格，也切掉（都是用户指的位置）
CUTS = {('20_700', '停'): [(7, 4, 17)],
        ('13_700', '响'): [(6, y, 6) for y in range(5, 10)] + [(6, 10, 7)]}


def main():
    chars = charset()
    glyphs = []  # (style_key, ch, img, bx, by, adv)
    for px, wt, *only in STYLES:
        f = ImageFont.truetype(FONT, px)
        f.set_variation_by_axes([wt])
        key = f'{px:g}_{wt}'
        for ch in (only[0] if only else chars):
            adv = f.getlength(ch)
            if (key, ch) in HAND:
                im, bx, by = hand_glyph(HAND[key, ch], f, ch)
                glyphs.append((key, ch, im, bx, by, adv))
                continue
            if (key, ch) in WEIGHT:
                f.set_variation_by_axes([WEIGHT[key, ch]])
            x0, y0, x1, y1 = f.getbbox(ch, anchor='ls')
            if x1 <= x0 or y1 <= y0:
                glyphs.append((key, ch, None, 0, 0, adv))
                continue
            im = Image.new('L', (x1 - x0, y1 - y0), 0)
            ImageDraw.Draw(im).text((-x0, -y0), ch, font=f, fill=255, anchor='ls')
            if (key, ch) in WEIGHT:
                f.set_variation_by_axes([wt])
            bb = im.getbbox()
            if not bb:
                glyphs.append((key, ch, None, 0, 0, adv))
                continue
            im = im.crop(bb)
            for px_, py_, px2 in CUTS.get((key, ch), ()):    # 手切：把粘连的一行/一段笔画切成空白
                ImageDraw.Draw(im).line([(px_, py_), (px2, py_)], fill=0)
            glyphs.append((key, ch, im, x0 + bb[0], y0 + bb[1], adv))
    # 货架式装箱
    AW = 2048
    x = y = row = 0
    meta = {}
    places = []
    for key, ch, im, bx, by, adv in sorted(glyphs, key=lambda g: -(g[2].height if g[2] else 0)):
        st = meta.setdefault(key, {})
        if im is None:
            st[ch] = [0, 0, 0, 0, 0, 0, round(adv, 3)]
            continue
        if x + im.width > AW:
            x, y, row = 0, y + row + 1, 0
        places.append((im, x, y))
        st[ch] = [x, y, im.width, im.height, bx, by, round(adv, 3)]
        x += im.width + 1
        row = max(row, im.height)
    atlas = Image.new('L', (AW, y + row + 1), 0)
    for im, px_, py_ in places:
        atlas.paste(im, (px_, py_))
    atlas.save(ROOT / 'sprites/font.png', optimize=True)
    (ROOT / 'sprites/font.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(chars)} 个字 × {len(STYLES)} 种字号，字模图 {atlas.size}，'
          f'{(ROOT / "sprites/font.png").stat().st_size // 1024} KB + json {(ROOT / "sprites/font.json").stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
