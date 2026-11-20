"""合成大肥鱼：成就头像。

用法（在仓库根目录）：
    python tools/make_ach_icons.py

每个成就做大小两档头像（含 1 像素外轮廓），游戏里一个头像像素 = 画面细网格的一格（1/FINE = 2/3 逻辑像素，和小字同一个网格，
整数个物理像素，不糊不丢像素）：
- 小档 SMALL（最长边 30 → 显示 20 逻辑像素）：成就格、顶部横条
- 大档 BIG（最长边 60 → 显示 40 逻辑像素）：详情大图
两档都从高清原图各自像素化，不是互相缩放。
沿革（2026-11-09 同一天）：22/44 像素按 1 逻辑像素显示 → 用户嫌顶着牌子边 → 我缩成 20/42 重新像素化，用户指出这是降清晰度、要的是
「等比无损缩小」→ 改成现在：像素更多（30/60），但每格更小（落在细网格上），显示尺寸比 22/44 时略小。

素材规矩（用户定的，2026-11-09）：可以复用素材，但同一素材最多用两次；镀金版和普通版算同一素材。脚本会数一遍，超了直接报错。

素材来源：
- ('tier', k)：第 k 级物品/角色的原图，按 make_sprites.py 同一条管线像素化
- ('gptf', 文件)：同 gptw，但绿幕从图边往里「漫」着抠（只抠和图边连着的绿），图里本身偏绿的东西（w1 的青绿色水）不会被当成绿幕抠掉、也不去溢色
- ('gptw', 文件)：art/ach/ 下单张的绿幕图（两条大肥鱼碰头：拿游戏里大肥鱼的原图给 GPT 当参考出的；第一版用物件表里 GPT 自己画的漫画鲸鱼，不是我们的大肥鱼，被否）
- ('gpt', 表号, 格号)：art/ach/ach_sheetN_gpt.png，ChatGPT 出的绿幕物件表（4×2，格号 0–7 先行后列），2026-11-09 为成就头像专门出的
  （第一版用动画项目物件库现成物件凑，用户说很多不合适，改成 GPT 新出）

镀金：gild.py 生成镀金层，游戏里和图鉴一样扫反光带、冒金星。gold='half'：左半普通、右半镀金（只有右半扫光）。

输出：sprites/ach.png（图集：小档普通 / 小档镀金 / 大档普通 / 大档镀金 四行）
     sprites/ach.js（window.ACH_ICONS = {id: {s: {w, h, n: [x, y], g: [x, y]}, b: {...}}}；n 普通层、g 镀金层，同尺寸叠着画）
     .scratch/ach_icons_preview.png（放大的总览，上大档下小档）
"""
import json
import math
import os
import sys
from collections import Counter

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_sprites as MS   # noqa: E402
from gild import gild       # noqa: E402

ROOT, GAME, ASSETS, ART, OUT = MS.ROOT, MS.GAME, MS.ASSETS, MS.ART, MS.OUT
SMALL, BIG = 30, 60   # 显示 20 / 40 逻辑像素：成就格的小牌子里面 22、详情的 48，四周留出空
SQUARE = 0.07        # 又宽又高（两边都差不多顶满）的头像再缩这么多（按边长比例），书、蒸笼这类方块看着才不挤
SIZES = {'s': SMALL, 'b': BIG}

W1_GOLD = [(339, 150), (589, 270), (349, 340)]   # w1 两块元宝、一只包子上各取一点（裁边后坐标）
_C, _F, _D = (0xa0, 0x6a, 0x1a), (0xd4, 0x96, 0x1e), (0xff, 0xf4, 0xb0)   # 深金 / 中金 / 高光
W1_STAMP = [
    # 左上元宝：前沿一道弧线把中间的鼓包和船身分开，两头的翘边内侧压暗，鼓包补一点高光
    (18, 13, _F), (19, 14, _C), (20, 14, _C), (21, 14, _C), (22, 14, _C), (23, 14, _C), (24, 14, _C), (25, 14, _C), (26, 14, _C), (27, 13, _F),
    (17, 11, _F), (17, 12, _F), (28, 11, _F), (28, 12, _F), (21, 10, _D),
    # 右边元宝：同样一道前沿 + 翘边压暗
    (37, 21, _C), (38, 21, _C), (39, 21, _C), (40, 21, _C), (41, 21, _C), (42, 21, _C), (43, 21, _C),
    (36, 19, _F), (44, 19, _F),
    # 包子：顶上收口往下散开的几道褶
    (20, 22, _C), (19, 23, _C), (18, 24, _F),
    (24, 21, _C), (24, 22, _C), (24, 23, _F),
    (28, 22, _C), (29, 23, _C), (30, 24, _F),
    (22, 22, _F), (22, 23, _F), (26, 22, _F), (26, 23, _F),
    (19, 21, _D), (20, 21, _D),
]
# 成就 id → (素材, 镀金)。镀金：False / True / 'half' / ('mask', 格号)
ICONS = {
    # 第 1 行 单局表现
    's1': (('gpt', 1, 0), False),     # 开张大吉：噼里啪啦的鞭炮
    's2': (('gpt', 1, 1), False),     # 加个蛋：荷包蛋
    's3': (('tier', 4), False),       # 三菜一汤：泡面（老坛酸菜）
    's4': (('gpt', 1, 2), False),     # 满汉全席：自热火锅
    's5': (('gpt', 1, 7), False),     # 海量：一摞空碗（全吃完了）
    'm1': (('gpt', 1, 3), False),     # 连锁反应：倒下的多米诺
    'm3': (('gpt', 1, 4), False),     # 好险！：正在响的闹钟
    'f4': (('gpt', 1, 5), False),     # 局局有鱼：年年有余鲤鱼挂饰
    # 水漫金山（2026-11-14 顶替删掉的 g6「一蒸笼金包子」）：漫出青绿色水的小木盆，水面浮着两块金元宝、一只金包子（同一对话「生成成就图标物件表」里 GPT 出的）。
    # 只镀那三块金子（('hue', [种子点…])，坐标是抠图裁边后的原图坐标）
    'w1': (('gptf', 'ach_w1_gpt.png'), ('hue', W1_GOLD, None)),
    # 第 2 行 合成与大肥鱼
    'c6': (('tier', 5), False),
    'c7': (('tier', 6), False),
    'c8': (('tier', 7), False),
    'c9': (('tier', 8), False),
    'c10': (('tier', 9), False),
    'c11': (('tier', 10), False),
    # f1–f3 同一口锅（用户定的，这里素材用 3 次是特许的，见 ALLOW）：两条普通鱼 / 右边那条镀金 / 两条都镀金。
    # 镀哪条鱼由用户给的标注图定（art/ach/fishpot_gold_mask_user.png：GPT 照原锅 1:1 复刻、把要镀的鱼涂成纯紫，三格依次是 左鱼 / 右鱼 / 两条）
    # 之前试过 GPT 画的两条鲸鱼碰头，费力又和 f1「两条肥鱼」对不上，弃用（art/ach/ach_whales_gpt.png 留着）
    'f1': (('gpt', 1, 6), False),     # 两条肥鱼：一锅炖不下
    'f2': (('gpt', 1, 6), ('mask', 1)),   # 一金一蓝：右边那条镀金
    'f3': (('gpt', 1, 6), ('mask', 2)),   # 金鲸金鲸：两条都镀金
    # 第 3 行 镀金与终章
    'g1': (('tier', 0), True),
    'g2': (('tier', 1), True),
    'g3': (('gpt', 2, 1), False),     # 金上加金：一堆金元宝
    'g4': (('tier', 5), True),
    'g5': (('tier', 10), True),
    'g7': (('gpt', 2, 3), False),     # 欧皇：金皇冠
    'g8': (('gpt', 2, 4), False),     # 非酋：小乌云
    'm2': (('gpt', 2, 5), False),     # 故事的最后：封面有小皇冠的故事书
    # 既非又欧（压轴的隐藏成就）：一蒸笼灰扑扑的小笼包，正中间一只金的——只镀那一只（('hue', x, y)：从原图这一点的金色往外长出遮罩）。
    # 原来是半普通半镀金的小笼包（gold='half'），用户嫌不够有趣、没牌面，2026-11-09 换成这张（GPT 照游戏里的小笼包和 g6 的蒸笼出的）
    'g9': (('gptw', 'ach_g9_gpt.png'), ('hue', 506, 353)),
}

ALLOW = {('gpt', 1, 6): 3}   # 素材复用上限的特许：f1–f3 那口鱼锅（用户 2026-11-09 定的）
INK = tuple(int(v) for v in MS.VIDEO_INK)

# 个别头像的特殊处理（用户 2026-11-09 逐个提的）：
# ncol：自取色板颜色数——小螃蟹默认色板时身上一堆相近的橙，缩小后显得糊；官方 Clawd 是一整块平涂，压到几色就锐了
# pad：普通版也先做小 2 格再垫一圈透明边，和同素材的镀金版一样大
# main：只留原图里最大的一块（去掉小装饰，主体才放得大）
# gild：镀金按哪一级的规则镀（gild.py 的等级号）
# stamp：{档: [(x, y, 颜色)]} 像素化（和镀金）之后手点像素，坐标是最终头像上的；'ink' = 动画描边色
OPTS = {
    'c6': {'ncol': 4},
    'g4': {'ncol': 4},
    'f1': {'pad': True},
    # w1 大档：像素化后元宝的「中间鼓包 + 前沿」、包子的褶子都被抹平了，手点几笔纹理（2026-11-14 用户要求；颜色取头像自己的金色几档）
    'w1': {'stamp': {'b': W1_STAMP}},
    # 手点像素：20 像素那版豆包小档看不见眼睛、镀金大肥鱼小档丢了眼白，点过；30 像素这版两处都自然留住了，不用点
}


# ---------------------------------------------------------------- 原图
_heads, _sheets = {}, {}


def tier_source(k):
    """第 k 级的原图（没像素化的大图）、色板类型和 TIERS 条目，照 make_sprites.main 的分支"""
    t = MS.TIERS[k]
    kind = t['src'][0]
    if kind == 'prop':
        return Image.open(os.path.join(ASSETS, t['src'][1])).convert('RGBA'), 'own', t
    if kind == 'whole':
        full = MS.remove_green(Image.open(os.path.join(ART, t['src'][1])))
        return full.crop(full.getbbox()), t.get('pal', 'own'), t
    fn, idx = t['src'][1], t['src'][2]
    if fn not in _heads:
        _heads[fn] = MS.cut_heads(os.path.join(ART, fn), *MS.GRIDS[fn])
    return _heads[fn][idx], t.get('pal', 'own'), t


def gpt_source(sheet, idx):
    if sheet not in _sheets:
        p = os.path.join(ART, 'ach', f'ach_sheet{sheet}_gpt.png')
        if not os.path.exists(p):
            sys.exit(f'缺 {p}')
        _sheets[sheet] = MS.cut_heads(p, 4, 2)
    return _sheets[sheet][idx]


def flood_green(im):
    """绿幕抠图（漫水法）：只把和图边连着的「很绿」的像素抠掉；紧挨着抠掉区域、明显偏绿的边缘像素去溢色。
    图里本身是青绿色的东西（水）和绿幕之间隔着深色描边，漫不过去，颜色也不动。"""
    from scipy.ndimage import binary_dilation, label
    a = np.asarray(im.convert('RGBA')).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = (g > 150) & (g - np.maximum(r, b) > 70)
    lab, _ = label(green)
    edge_ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge_ids))
    a[..., 3] = np.where(bg, 0, a[..., 3])
    ring = binary_dilation(bg, iterations=2) & ~bg & (g > np.maximum(r, b) + 40)
    a[..., 1] = np.where(ring, np.maximum(r, b), g)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')


def largest(im):
    from scipy.ndimage import label
    a = np.asarray(im).copy()
    lab, n = label(a[..., 3] > 0)
    if n > 1:
        a[..., 3] = np.where(lab == np.argmax(np.bincount(lab.ravel())[1:]) + 1, a[..., 3], 0)
    out = Image.fromarray(a)
    return out.crop(out.getbbox())


def source(src, main=False):
    """→ (原图, 色板, 去孤点次数, 对比度, gild 用的等级号)"""
    if src[0] == 'tier':
        im, pal, t = tier_source(src[1])
        return im, MS.palette(pal, im), t.get('dp', 1), t.get('contrast', 1.1), src[1]
    if src[0] == 'gptf':   # 单张绿幕图，只抠和图边连着的绿（见 flood_green）
        full = flood_green(Image.open(os.path.join(ART, 'ach', src[1])))
        im = full.crop(full.getbbox())
        return (largest(im) if main else im), MS.own_palette([im], 16), 1, 1.1, -1
    if src[0] == 'gptw':   # 单张绿幕图（art/ach/ 下），整张就是一个头像
        full = MS.remove_green(Image.open(os.path.join(ART, 'ach', src[1])))
        im = full.crop(full.getbbox())
    else:
        im = gpt_source(src[1], src[2])
    if main:
        im = largest(im)
    return im, MS.own_palette([im], 16), 1, 1.1, -1


def pixelize(src, limit, ncol=None, main=False):
    """像素化到最长边不超过 limit（video_pixel 的 n 只管高度比例，横向的图宽度会多出一两格，所以从大往小试）。
    方块形（两边都 ≥ limit-1）的再缩 SQUARE 格。ncol：自取色板的颜色数（默认 16）"""
    im, pal, dp, con, tier = source(src, main)
    if ncol:
        pal = np.vstack([MS.own_palette([im], ncol), [MS.VIDEO_INK]])
    def fit(lim):
        for n in range(lim, 6, -1):
            spr = MS.video_pixel(im, n, pal, dp, con)
            if max(spr.size) <= lim:
                return spr
        raise ValueError(src)
    spr = fit(limit)
    if min(spr.size) >= limit - 1:
        spr = fit(limit - round(limit * SQUARE))
    return spr, tier


def pad1(im):
    p = Image.new('RGBA', (im.width + 2, im.height + 2)); p.alpha_composite(im, (1, 1)); return p


def stamp(layers, pts):
    """手点像素：点在那个位置不透明的那一层上"""
    out = [None if l is None else np.asarray(l).copy() for l in layers]
    for x, y, c in pts:
        hit = False
        for a in out:
            if a is not None and a[y, x, 3] > 0:
                a[y, x, :3] = c
                hit = True
        if not hit:
            print(f'  ⚠ 手点 ({x},{y}) 落在透明处')
    return [None if a is None else Image.fromarray(a) for a in out]


_masks = {}


def gold_mask(panel, size):
    """用户给的标注图（art/ach/fishpot_gold_mask_user.png，ChatGPT 按原锅 1:1 复刻、把要镀金的鱼涂成纯紫色，三格并排）里
    第 panel 格的紫色区域，按内容外框对齐到原图，再缩到 size（精灵内容区的宽高）。返回 bool 数组"""
    key = (panel, size)
    if key not in _masks:
        user = Image.open(os.path.join(ART, 'ach', 'fishpot_gold_mask_user.png')).convert('RGB')
        W = user.width // 3
        a = np.asarray(user.crop((panel * W, 0, (panel + 1) * W, user.height))).astype(int)
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        green = (g > 150) & (g - np.maximum(r, b) > 60)
        purple = (r > 120) & (b > 150) & (g < 90)
        ys, xs = np.nonzero(~green)
        m = Image.fromarray((purple * 255).astype(np.uint8)).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        _masks[key] = np.asarray(m.resize(size, Image.BOX)) >= 128
    return _masks[key]


def hue_mask(src, x, y, size):
    """原图上 (x, y) 那一块金色（g9 中间那只金包子）：先取那一点所在的鲜亮金黄连通块当种子，再沿着不灰、不暗的像素往外长
    （带上包子底下偏橙的暗面），补洞，缩到 size。灰包子饱和度低、和包子之间隔着深棕描边，长不过去"""
    from scipy.ndimage import binary_closing, binary_dilation, binary_fill_holes, label
    key = ('hue', src, str(x), y, size)
    if key not in _masks:
        im = source(src)[0]
        al = np.asarray(im)[..., 3] > 0
        hsv = np.asarray(im.convert('RGB').convert('HSV')).astype(int)
        H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
        lab, _ = label(al & (S > 120) & (V > 170) & (H > 22) & (H < 45))
        pts = x if isinstance(x, list) else [(x, y)]   # 种子点可以给一串（w1 三块金子）
        seed = np.isin(lab, [lab[py, px] for px, py in pts if lab[py, px]])
        grow = al & (S > 80) & (V > 110)
        if isinstance(x, list):
            grow &= H < 60   # 只往暖色（金、橙）里长，别长进旁边的青绿色水
        m = seed.copy()
        for _ in range(40):
            m = binary_dilation(m) & grow
        m = binary_fill_holes(binary_closing(m, iterations=3))
        _masks[key] = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(size, Image.BOX)) >= 128
    return _masks[key]


def masked_gold(spr, tier, mask_of):
    """只镀遮罩里的部分（鱼锅的鱼、g9 的金包子）：整张镀一遍，镀金层只取遮罩（外扩一点，带上描边和外圈金边），其余留在普通层。
    mask_of(size) → 内容区大小的 bool 遮罩"""
    from scipy.ndimage import binary_dilation
    g = np.asarray(gild(np.asarray(spr.convert('RGBA')), tier)[0]).copy()
    n = np.asarray(pad1(spr)).copy()
    m = np.zeros(g.shape[:2], bool)
    m[2:-2, 2:-2] = mask_of((spr.width - 2, spr.height - 2))   # 精灵 = 1 透明边 + 内容；镀金版再大 1 圈
    near = binary_dilation(m, iterations=2)
    # 外扩 2 格只要：外面的金圈（普通层透明处）、描边（深色）、标注没盖全的鱼身（偏蓝灰，锅是棕的 R > B），别吃掉锅
    rgb = n[..., :3].astype(int)
    edge = (n[..., 3] == 0) | ((rgb @ np.array([0.299, 0.587, 0.114])) < 70) | (rgb[..., 2] > rgb[..., 0] + 8)
    m |= near & edge
    g[~m, 3] = 0
    n[m, 3] = 0
    return Image.fromarray(n), Image.fromarray(g)


def make(aid, size):
    """→ (普通层, 镀金层)，两层同尺寸，没有的是 None"""
    src, gold = ICONS[aid]
    o = OPTS.get(aid, {})
    small = gold or o.get('pad')   # 镀金版四周还要包一圈，先做小 2 格（pad：普通版也这样，和同素材的镀金版一样大）
    spr, tier = pixelize(src, size - 2 if small else size, o.get('ncol'), o.get('main', False))
    tier = o.get('gild', tier)
    if not gold:
        n, g = (pad1(spr) if small else spr), None
    elif isinstance(gold, tuple) and gold[0] == 'mask':             # ('mask', 格号)：只镀用户标出来的那几条鱼
        n, g = masked_gold(spr, tier, lambda s: gold_mask(gold[1], s))
    elif isinstance(gold, tuple) and gold[0] == 'hue':              # ('hue', x, y)：只镀原图上那一块金色
        n, g = masked_gold(spr, tier, lambda s: hue_mask(src, gold[1], gold[2], s))
    else:
        n, g = None, Image.fromarray(gild(np.asarray(spr.convert('RGBA')), tier)[0], 'RGBA')
        if gold == 'half':                  # 左半普通、右半镀金（从中间切开）
            n = pad1(spr)
            mid = n.width // 2
            na, ga = np.asarray(n).copy(), np.asarray(g).copy()
            na[:, mid:, 3] = 0
            ga[:, :mid, 3] = 0
            n, g = Image.fromarray(na), Image.fromarray(ga)
    pts = o.get('stamp', {}).get('s' if size == SMALL else 'b')
    if pts:
        n, g = stamp([n, g], [(x, y, INK if c == 'ink' else c) for x, y, c in pts])
    return n, g


def main():
    uses = Counter(src for src, _ in ICONS.values())
    over = {k: v for k, v in uses.items() if v > ALLOW.get(k, 2)}
    if over:
        sys.exit(f'素材复用超过两次：{over}')
    ids = list(ICONS)
    made = {(aid, sz): make(aid, SIZES[sz]) for aid in ids for sz in SIZES}
    # 图集：每格 (边长+2) 见方；四行：小普通、小镀金、大普通、大镀金
    rows = {('s', 'n'): 0, ('s', 'g'): 1, ('b', 'n'): 2, ('b', 'g'): 3}
    cell = {'s': SMALL + 2, 'b': BIG + 2}
    y0 = {('s', 'n'): 0, ('s', 'g'): cell['s'], ('b', 'n'): cell['s'] * 2, ('b', 'g'): cell['s'] * 2 + cell['b']}
    atlas = Image.new('RGBA', (cell['b'] * len(ids), cell['s'] * 2 + cell['b'] * 2))
    meta = {}
    for i, aid in enumerate(ids):
        meta[aid] = {}
        for sz in SIZES:
            n, g = made[(aid, sz)]
            ref = g or n
            m = {'w': ref.width, 'h': ref.height}
            for key, layer in (('n', n), ('g', g)):
                if layer is not None:
                    xy = (i * cell[sz], y0[(sz, key)])
                    atlas.alpha_composite(layer, xy)
                    m[key] = list(xy)
            meta[aid][sz] = m
    atlas.save(os.path.join(OUT, 'ach.png'))
    with open(os.path.join(OUT, 'ach.js'), 'w', encoding='utf-8') as f:
        f.write('// 由 tools/make_ach_icons.py 生成：成就头像在 sprites/ach.png 里的位置。s 小档（成就格、横条）、b 大档（详情）；'
                'n 普通层、g 镀金层，同尺寸叠着画\n'
                'window.ACH_ICONS = ' + json.dumps(meta) + ';\n')
    preview(ids, made)
    print(f'{len(ids)} 个头像，用了两次的素材：', [k for k, v in uses.items() if v == 2])


def preview(ids, made):
    S, cols = 3, 9
    cw = (BIG + 2) * S + 12
    chh = cw + (SMALL + 2) * S + 8
    sheet = Image.new('RGBA', (cw * cols, chh * math.ceil(len(ids) / cols)), (255, 240, 191, 255))
    for i, aid in enumerate(ids):
        x, y = (i % cols) * cw, (i // cols) * chh
        for sz, oy, box in (('b', 0, cw), ('s', cw, (SMALL + 2) * S)):
            n, g = made[(aid, sz)]
            ref = g or n
            tile = Image.new('RGBA', ref.size)
            for layer in (n, g):
                if layer is not None:
                    tile.alpha_composite(layer)
            big = tile.resize((tile.width * S, tile.height * S), Image.NEAREST)
            sheet.alpha_composite(big, (x + (cw - big.width) // 2, y + oy + (box - big.height) // 2))
    p = os.path.join(ROOT, '.scratch', 'ach_icons_preview.png')
    sheet.save(p)
    print(p)


if __name__ == '__main__':
    main()
