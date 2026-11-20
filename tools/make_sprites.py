"""合成大肥鱼：把素材做成游戏精灵。

用法（在仓库根目录）：
    python tools/make_sprites.py

输入：assets/（动画项目的私有原始素材，公开仓库里没有）和 art/（为本游戏新生成的图）
输出：sprites/t01.png … t11.png、bg.png、tiers_preview.png

约定：游戏里 1 个精灵像素 = 2 个逻辑像素（game.js 的 TEX）；每级精灵最长边 ≈ r 像素。
物件和头像裸着进游戏（不装进圆球），像素化照动画项目 代码工程/spriteize.py 的 spriteize_flat
（角色色板量化 → 2×2 取众数 → 去一遍孤点 → 1 像素外轮廓 #2B2622）；
碰撞箱 = 不透明像素的凸包（≤20 点），写进 sprites/shapes.js 给 game.js 用。
改了 TIERS 记得同步 game.js 的 TIERS（名字、r）。
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gild import gild   # noqa: E402  镀金版精灵（局部深金覆膜）

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
GAME = ROOT
ASSETS = os.path.join(ROOT, 'assets')
ART = os.path.join(GAME, 'art')
OUT = os.path.join(GAME, 'sprites')

INK = (74, 46, 32)          # 深棕描边 #4a2e20

# 钢盆小鲸的嘴：原图里只是 8 像素宽的小点，缩成 55/85 像素的精灵一定被量化抹掉，所以像素化后手点一个像素。
# (原图 x, 原图 y, 颜色)：坐标是 art/whale_bowl_v1.png 整图上嘴点的中心；按精灵相对原图包围盒的位置换算，两个尺寸通用。
BOWL_MOUTH = (725.5, 763.8, (150, 60, 72))
# 右眼（画面右边那只）的大高光：原图里是个约 26×20 的白点（中心 846.6, 639.4），压在盆沿下面，像素化时被盆沿的深描边吃掉了，手点回 1 个白像素。
# 左眼的对应高光（中心 611.1, 638.1）像素化后还在，不用补。
BOWL_HILITES = [(846.6, 639.4, (252, 246, 246))]

# 与 game.js 的 TIERS 保持一致（r = 精灵最长边，像素）；pal = 用哪套色板像素化（见 palette()）
TIERS = [
    dict(name='小笼包',        r=14, color='#f3e6cf', src=('prop', '物件库/原图/小包子.png')),
    dict(name='饭团',          r=19, color='#e7efe2', src=('prop', '物件库/原图/饭团.png')),
    dict(name='面窝',          r=25, color='#f2c58a', src=('head', 'mianwo_gpt_v1.png', 1), pal='own'),   # 照物件库 烧饼 的画风配色重画
    dict(name='白米饭',        r=31, color='#dfe9f5', src=('prop', '物件库/原图/大饭盆.png')),
    dict(name='泡面',          r=38, color='#f4dcb4', src=('prop', '物件库/原图/泡面.png')),
    dict(name='小螃蟹',        r=46, color='#f6d2c4', src=('head', 'mascots_gpt_v1.png', 3), pal='own', dp=0),   # 眼睛只有两格宽，去孤点会抹掉
    dict(name='小鲸·惊喜',     r=55, color='#cfe0f5', src=('head', 'heads_gpt_v3.png', 2), pal='xj'),
    dict(name='Claude 大小姐',  r=64, color='#fbe0bf', src=('head', 'heads_gpt_v3.png', 1), pal='cl', contrast=1.25,   # 动画里大小姐也是对比 1.2
         override='手修/t08_Claude大小姐_点嘴.png'),   # 用户在画图里给自动生成的 t08 点了嘴（3 个像素），直接用这张，不再自动像素化
    dict(name='豆包',          r=74, color='#f7d9d2', src=('head', 'heads_gpt_v3.png', 0), pal='db', contrast=1.2),
    # 2026-11-09：第 10 级换成「钢盆小鲸」（art/whale_bowl_v1.png，用户定的：放第 10 级，不放第 7 级）。
    # 旧美术：小鲸·开心 = heads_gpt_v3.png 第 4 格（pal='xj'，无 mouth/hilites）；旧脸部遮罩在 face_masks/旧_开心头像/
    dict(name='小鲸·开心',     r=85, color='#d8e6fa', src=('whole', 'whale_bowl_v1.png'), pal='xjb', mouth=BOWL_MOUTH, hilites=BOWL_HILITES),
    dict(name='大肥鱼',        r=98, color='#b9d4f4', src=('head', 'mascots_gpt_v1.png', 1), pal='own'),
]
GRIDS = {'heads_gpt_v3.png': (3, 2), 'mascots_gpt_v1.png': (2, 2), 'mianwo_gpt_v1.png': (2, 1)}   # 绿幕表的格子：heads = 角色头 3×2；mascots = 鲸鱼、小螃蟹再创作 2×2（上排鲸鱼、下排螃蟹）


def remove_green(im):
    """绿幕抠图：G 明显高于 R、B 的像素变透明，边缘去绿溢色。"""
    a = np.asarray(im.convert('RGBA')).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = (g > 150) & (g - np.maximum(r, b) > 60)
    a[..., 3] = np.where(green, 0, a[..., 3])
    spill = (g > np.maximum(r, b)) & ~green
    a[..., 1] = np.where(spill, np.maximum(r, b), g)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')


def components(alpha, min_area):
    """返回各连通块的外接框（用 scipy 的 label）。"""
    from scipy import ndimage
    lab, n = ndimage.label(alpha > 0)
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        area = int((lab[sl] == i).sum())
        if area >= min_area:
            boxes.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, area))
    return boxes


def cut_heads(path, cols, rows):
    """把 cols×rows 的绿幕头像表切成单张（按格子分，再在格内取最大内容块的框）。"""
    im = remove_green(Image.open(path))
    W, H = im.size
    cw, ch = W / cols, H / rows
    out = []
    for j in range(rows):
        for i in range(cols):
            cell = im.crop((int(i * cw), int(j * ch), int((i + 1) * cw), int((j + 1) * ch)))
            al = np.asarray(cell)[..., 3]
            boxes = components(al, min_area=al.size // 200)
            if not boxes:
                out.append(None)
                continue
            x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
            x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
            out.append(cell.crop((x0, y0, x1, y1)))
    return out


def outline(im, color=INK):
    """给不透明区域外围加 1 像素描边。"""
    a = np.asarray(im).copy()
    al = a[..., 3] > 0
    grow = al.copy()
    grow[1:] |= al[:-1]; grow[:-1] |= al[1:]; grow[:, 1:] |= al[:, :-1]; grow[:, :-1] |= al[:, 1:]
    edge = grow & ~al
    a[edge] = (*color, 255)
    return Image.fromarray(a, 'RGBA')


# ---------------------------------------------------------------- 像素化（照动画项目 代码工程/spriteize.py + directions.py 的做法）
LIB = os.path.join(ASSETS, '帧库')
VIDEO_INK = (43, 38, 34)    # pix.OUT #2B2622：动画里精灵的外轮廓色


def own_palette(imgs, n):
    """从图里取 n 色（中值切分），给没有现成色板的角色/物件用。"""
    px = np.concatenate([np.asarray(i.convert('RGBA'))[np.asarray(i.convert('RGBA'))[..., 3] > 200][:, :3] for i in imgs])
    side = int(np.ceil(np.sqrt(len(px))))
    pad = np.zeros((side * side, 3), np.uint8); pad[:len(px)] = px; pad[len(px):] = px[0]
    q = Image.fromarray(pad.reshape(side, side, 3)).quantize(n, method=Image.Quantize.MEDIANCUT)
    return np.array(q.getpalette()[:n * 3]).reshape(n, 3)


def palette(kind, src):
    """色板后面补两档深色：小物件、小头像的眼睛只有一两格，取色时容易被周围大色块吞掉。"""
    return np.vstack([_palette(kind, src), [VIDEO_INK, (92, 52, 40)]])


def _palette(kind, src):
    if kind == 'xj':
        return np.load(os.path.join(LIB, '调色板_精简.npy'))        # 小鲸：动画用的精简色板
    if kind == 'xjb':                                                # 钢盆小鲸：小鲸色板 + 从盆上取 4 档灰（小鲸色板里没有灰，盆会被量化成蓝）
        a = np.asarray(src.convert('RGBA')).astype(float)
        mx, mn = a[..., :3].max(-1), a[..., :3].min(-1)
        lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255
        bowl = (a[..., 3] > 200) & ((mx - mn) / np.maximum(mx, 1) < 0.12) & (lum > 0.45) & (lum < 0.8)
        gray = own_palette([Image.fromarray(np.where(bowl[..., None], a, 0).astype(np.uint8), 'RGBA')], 6)
        gem = np.array([(232, 160, 44), (186, 112, 24)])             # 领结宝石的金橙边：不补的话会被量化成色板里的深红
        return np.vstack([np.load(os.path.join(LIB, '调色板_精简.npy')), gray, gem])
    if kind == 'cl':
        return np.load(os.path.join(LIB, '调色板_Claude娘全.npy'))  # 大小姐：动画用的「全」色板
    if kind == 'db':                                                 # 豆包：从定稿设定图取 20 色（动画里也是这样取的）
        ref = Image.open(os.path.join(ASSETS, '配图', '角色设定_豆包A长裙_去细花纹_chatgpt.png')).convert('RGBA')
        a = np.asarray(ref).copy(); a[(a[..., :3] > 235).all(-1), 3] = 0
        return own_palette([Image.fromarray(a), src], 20)
    return own_palette([src], 16)


def spriteize_flat(im, height, pal, contrast=1.1):
    """spriteize.spriteize_flat：2 倍尺寸量化到色板，再 2×2 取众数缩回（平票取暗色，保住五官）。"""
    from PIL import ImageEnhance
    H2 = height * 2
    w2 = max(2, round(im.width * H2 / im.height)); w2 += w2 % 2
    rgb = ImageEnhance.Contrast(im.convert('RGB')).enhance(contrast)
    im = Image.merge('RGBA', (*rgb.split(), im.split()[3]))
    small = np.asarray(im.resize((w2, H2), Image.LANCZOS)).astype(np.int32)
    idx = ((small[..., None, :3] - pal[None, None, :, :]) ** 2).sum(-1).argmin(-1)
    idx[small[..., 3] < 110] = -1
    h, w = H2 // 2, w2 // 2
    blk = idx.reshape(h, 2, w, 2).transpose(0, 2, 1, 3).reshape(h, w, 4)
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        for x in range(w):
            b = blk[y, x]
            if (b >= 0).sum() < 2:
                continue
            vals, cnt = np.unique(b[b >= 0], return_counts=True)
            c = min(vals[cnt == cnt.max()], key=lambda i: pal[i].sum())
            out[y, x, :3] = pal[c]; out[y, x, 3] = 255
    return Image.fromarray(out, 'RGBA')


def despeckle(spr, passes=2):
    """directions._despeckle：和四邻都不同色的孤点换成四邻里最多的颜色，色块成片。"""
    a = np.array(spr).astype(np.int64)
    key = (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
    key[a[..., 3] == 0] = -1
    H, W = key.shape
    for _ in range(passes):
        k2 = key.copy()
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                c = key[y, x]
                nb = [key[y - 1, x], key[y + 1, x], key[y, x - 1], key[y, x + 1]]
                if c < 0 or c in nb:
                    continue
                nb = [n for n in nb if n >= 0]
                if len(nb) < 3:
                    continue
                vals, cnt = np.unique(nb, return_counts=True)
                k2[y, x] = vals[cnt.argmax()]
        key = k2
    m = key >= 0
    a[..., 0][m] = (key[m] >> 16) & 255; a[..., 1][m] = (key[m] >> 8) & 255; a[..., 2][m] = key[m] & 255
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def video_pixel(im, n, pal, dp=1, contrast=1.1):
    """原图 → 最长边约 n 像素的动画风像素精灵：色板量化 + 去孤点 + 内轮廓 + 1 像素外轮廓。"""
    im = im.convert('RGBA'); im = im.crop(im.getbbox())
    h = round((n - 2) * min(1, im.height / im.width))
    spr = spriteize_flat(im, max(4, h), pal, contrast)
    if dp:
        spr = despeckle(spr, dp)   # 头像只去一遍孤点、不压内轮廓：五官在这个尺寸下才留得住
    pad = Image.new('RGBA', (spr.width + 2, spr.height + 2)); pad.alpha_composite(spr, (1, 1))
    return outline(pad, VIDEO_INK)


def stamp_pixel(spr, bbox, mx, my, color, name=''):
    """在像素化后的精灵上手点 1 个像素（嘴、丢失的高光）：原图坐标 (mx, my) 按 bbox（原图里头像的包围盒）换算成精灵像素。
    精灵 = 1 像素透明边 + 内容（最长边 n-2）+ 外轮廓，内容占 [1, 宽-1)。"""
    x0, y0, x1, y1 = bbox
    px = 1 + (mx - x0) / (x1 - x0) * (spr.width - 2)
    py = 1 + (my - y0) / (y1 - y0) * (spr.height - 2)
    x, y = int(px), int(py)
    a = np.asarray(spr).copy()
    if a[y, x, 3] == 0:
        print(f'  ⚠ {name}：位置 ({x},{y}) 是透明像素，没点上')
    else:
        a[y, x] = (*color, 255)
        print(f'  {name}：点在 ({x},{y})（换算坐标 {px:.2f},{py:.2f}）')
    return Image.fromarray(a, 'RGBA')


def make_prop(path, n, color, fill=None):
    im = Image.open(os.path.join(ASSETS, path)).convert('RGBA')
    return video_pixel(im, n, own_palette([im], 16))


def make_head(head, n, color, pal='own', dp=1, contrast=1.1):
    return video_pixel(head, n, palette(pal, head), dp, contrast)


def hull(im, max_pts=20):
    """不透明像素的凸包（精灵像素坐标），简化到不超过 max_pts 个点，做碰撞箱。"""
    from scipy.spatial import ConvexHull
    ys, xs = np.nonzero(np.asarray(im)[..., 3] > 0)
    pts = np.concatenate([np.stack([xs, ys], 1), np.stack([xs + 1, ys], 1), np.stack([xs, ys + 1], 1), np.stack([xs + 1, ys + 1], 1)]).astype(float)
    hp = pts[ConvexHull(pts).vertices]
    while len(hp) > max_pts:            # 每次删掉对面积影响最小的点
        areas = [abs(float((hp[i] - hp[i - 1])[0] * (hp[(i + 1) % len(hp)] - hp[i - 1])[1] - (hp[i] - hp[i - 1])[1] * (hp[(i + 1) % len(hp)] - hp[i - 1])[0])) for i in range(len(hp))]
        hp = np.delete(hp, int(np.argmin(areas)), 0)
    return [[round(float(x), 1), round(float(y), 1)] for x, y in hp]


def make_bg():
    """背景：GPT 出的竖版鲸鱼塔海景（art/bg_gpt_v1.png，1024×1536，海面一整张、倒影只一组），
    缩成 180×320（×2 = 360×640）。原图 2:3 比 9:16 宽：横向裁到刚好装下鲸尾和鲸脸，
    高度不够的几行在顶上用最上沿的天空色补齐（天空顶部是平涂渐变，补了看不出来）。"""
    src = Image.open(os.path.join(ART, 'bg_gpt_v1.png')).convert('RGB')
    x0, x1 = 0, 920
    crop = src.crop((x0, 0, x1, src.height))
    tw = 180
    th = round(crop.height * tw / crop.width)
    body = crop.resize((tw, th), Image.BOX)
    pad = 320 - th
    a = np.asarray(body)
    sky = a[:4].mean(axis=0, keepdims=True).astype(np.uint8)
    a = np.concatenate([np.repeat(sky, pad, axis=0), a], axis=0)
    img = Image.fromarray(a, 'RGB').quantize(colors=48, dither=Image.Dither.NONE).convert('RGB')
    img.save(os.path.join(OUT, 'bg.png'))


def preview(sprites):
    """拼一张总览图：11 级从小到大排一行（放大 2 倍），方便给作者看。"""
    pad = 8
    total_w = sum(s.width * 2 + pad for s in sprites) + pad
    h = max(s.height for s in sprites) * 2 + pad * 2
    sheet = Image.new('RGBA', (total_w, h), (255, 246, 224, 255))
    x = pad
    for s in sprites:
        big = s.resize((s.width * 2, s.height * 2), Image.NEAREST)
        sheet.alpha_composite(big, (x, h - pad - big.height))
        x += big.width + pad
    sheet.save(os.path.join(OUT, 'tiers_preview.png'))


def main():
    os.makedirs(OUT, exist_ok=True)
    heads = {}
    sprites = []
    shapes = {}
    for k, t in enumerate(TIERS):
        n, kind = t['r'], t['src'][0]
        if t.get('override'):               # 用户手修好的成品精灵（art/ 下），原样进游戏，碰撞箱和镀金版照常生成
            p = os.path.join(ART, t['override'])
            if not os.path.exists(p):
                sys.exit(f'缺 {p}（{t["name"]} 的手修精灵）')
            s = Image.open(p).convert('RGBA')
        elif kind == 'prop':
            s = make_prop(t['src'][1], n, t['color'])
        elif kind == 'whole':               # 一张图就是一个头像（不是格子表）
            p = os.path.join(ART, t['src'][1])
            if not os.path.exists(p):
                sys.exit(f'缺 {p}（{t["name"]} 的原图）')
            full = remove_green(Image.open(p))
            bb = full.getbbox()
            s = make_head(full.crop(bb), n, t['color'], t.get('pal', 'own'), t.get('dp', 1), t.get('contrast', 1.1))
            if t.get('mouth'):
                s = stamp_pixel(s, bb, *t['mouth'], f'{t["name"]} 嘴')
            for hx, hy, hc in t.get('hilites', []):
                s = stamp_pixel(s, bb, hx, hy, hc, f'{t["name"]} 高光')
        else:
            fn, idx = t['src'][1], t['src'][2]
            p = os.path.join(ART, fn)
            if not os.path.exists(p):
                sys.exit(f'缺 {p}（{t["name"]} 的原图）')
            if fn not in heads:
                heads[fn] = cut_heads(p, *GRIDS[fn])
            s = make_head(heads[fn][idx], n, t['color'], t.get('pal', 'own'), t.get('dp', 1), t.get('contrast', 1.1))
        s.save(os.path.join(OUT, f't{k + 1:02d}.png'))
        Image.fromarray(gild(np.asarray(s.convert('RGBA')), k)[0], 'RGBA').save(os.path.join(OUT, f'g{k + 1:02d}.png'))
        shapes[k] = dict(w=s.width, h=s.height, hull=hull(s))
        sprites.append(s)
        print(f't{k + 1:02d} {t["name"]} {s.size}')
    with open(os.path.join(OUT, 'shapes.js'), 'w', encoding='utf-8') as f:
        f.write('// 由 tools/make_sprites.py 生成：每级精灵尺寸和凸包碰撞箱（精灵像素坐标）\n'
                'window.SHAPES = ' + json.dumps({str(k): v for k, v in shapes.items()}) + ';\n')
    make_bg()
    preview(sprites)


if __name__ == '__main__':
    main()
