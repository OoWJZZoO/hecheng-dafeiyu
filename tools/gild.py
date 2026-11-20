"""镀金精灵：金色覆膜按亮度映射到金色色板，但部分区域保留原色（不覆盖）：
饭团的海苔、白米饭的碗、泡面的杯子、人形角色的脸。外面包一圈暗金描边，外轮廓描边换亮金。

用法：from gild import gild；gild(rgba_array, tier_index, deep=True) -> 比原图四周各大 1 像素的 RGBA 数组
单独跑：python gild.py 出对比图到 .scratch/gild_compare.png
"""
import os

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, binary_erosion, binary_closing, binary_fill_holes, label

GOLD = ['#3a2410', '#6b4316', '#a06a1a', '#d4961e', '#f0b828', '#ffd84a', '#fff4b0']
PAL = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in GOLD], float)
FACE_TIERS = {6, 7, 8, 9}        # 小鲸·惊喜、Claude 大小姐、豆包、小鲸·开心（0 起算）
# 脸的范围（精灵像素坐标：椭圆中心 x, 中心 y, 半宽, 半高, 眼睛横条起止行），对着 sprites/t07–t10.png 手标；换了精灵要重标
FACE_ELLIPSE = {6: (27.5, 32, 11, 10, 27, 34), 7: (31.5, 39, 14.5, 12, 34, 44),
                8: (38, 38, 18, 17, 34, 47),
                9: (44, 44.5, 15, 7, 38, 45)}   # 9 = 钢盆小鲸（2026-11-09 换的），脸只有盆下一小条；这是第一版估的，实际由 face_masks/10_* 手修遮罩接管
# 每个物件的金膜深浅：(最低档, 档数)。档越高越浅；档数越少明暗反差越小。没写的用 (2, 4)
TONE = {2: (1, 5)}                                    # 面窝：加大明暗，酥皮纹理和芝麻才看得出
# 深膜和原色再混一点（面窝整块棕色，纯金膜会糊成一片平的黄）
BLEND = {2: 0.35}
# 「薄金」：和 ec68ce3 提交的金边版一样——保留原色，只整体略暖、最亮处偏金白；人形角色的脸连暖色都不加。
# 小螃蟹、4 个角色、大肥鱼用薄金（用户指定）；前 5 个食物用局部深膜
LIGHT_TIERS = {5, 6, 7, 8, 9, 10}


def _lum(im):
    return (0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2]) / 255


def _sat(im):
    mx, mn = im[..., :3].max(-1), im[..., :3].min(-1)
    return (mx - mn) / np.maximum(mx, 1)


def _outside(a):
    """连到图像边上的透明区域（物件外面）；面窝中间的洞不算"""
    # 先在四周垫一圈透明再标连通块：精灵的不透明像素贴着图边时（小螃蟹的顶边），
    # 不垫的话图边之外「没有外面」，最外一行认不出是外轮廓，黑边就留下来了
    pad = np.pad(a, 1, constant_values=False)
    lab, n = label(~pad)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(border))[1:-1, 1:-1]


def _edge(a):
    """外轮廓：挨着物件外面的不透明像素（洞的内沿不算，保持原样才像个洞）"""
    # 图边之外也是「外面」：先把外面垫一圈 True 再膨胀，贴着图边的不透明像素才认得出是轮廓
    return a & binary_dilation(np.pad(_outside(a), 1, constant_values=True))[1:-1, 1:-1]


HAIR_MIN = 4   # 脸外出现至少这么多次的颜色算头发色


def soft_skin(r, g, b, a):
    return a & (r > 215) & (g > 170) & (b > 140) & (r >= g) & (r - b > 8)


# ---- 手修脸部遮罩：导出成大图在「画图」里涂，再读回来 ----
# 图分左右两半：左边是原图（只看不改），右边脸的像素涂成纯紫 #FF00FF。
# 在右边：漏掉的像素涂紫（用取色器吸现有的紫色）；多算的像素涂成别的任意颜色。读回时只看每格中心点。
MASK_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'face_masks')
MASK_NAMES = {6: '07_小鲸惊喜', 7: '08_Claude大小姐', 8: '09_豆包', 9: '10_小鲸开心'}
MASK_S, MASK_GAP = 12, 24
PURPLE = (255, 0, 255)


def mask_path(tier):
    return os.path.join(MASK_DIR, MASK_NAMES[tier] + '_脸部遮罩.png')


def load_face_mask(tier):
    p = mask_path(tier) if tier in MASK_NAMES else None
    if not p or not os.path.exists(p):
        return None
    big = np.asarray(Image.open(p).convert('RGB')).astype(int)
    W = (big.shape[1] - MASK_GAP) // (2 * MASK_S)
    H = big.shape[0] // MASK_S
    off = W * MASK_S + MASK_GAP
    ys = np.arange(H) * MASK_S + MASK_S // 2
    xs = off + np.arange(W) * MASK_S + MASK_S // 2
    c = big[ys][:, xs]
    return (c[..., 0] > 200) & (c[..., 1] < 90) & (c[..., 2] > 200)


def export_face_mask(tier, im, keep):
    """im: 原精灵 RGBA；keep: 当前脸部遮罩。已存在的文件不覆盖（那是用户涂过的）"""
    os.makedirs(MASK_DIR, exist_ok=True)
    p = mask_path(tier)
    if os.path.exists(p):
        return p, False
    H, W = keep.shape
    S, G = MASK_S, MASK_GAP
    bg = np.array([200, 205, 205])
    def panel(rgba):
        out = np.tile(bg, (H, W, 1)).astype(float)
        al = rgba[..., 3:4] / 255
        out = out * (1 - al) + rgba[..., :3] * al
        return out
    left = panel(im.astype(float))
    right = left.copy()
    right[keep] = PURPLE
    big = np.tile(np.array([90, 90, 90]), (H * S, W * S * 2 + G, 1)).astype(np.uint8)
    for off, pan in ((0, left), (W * S + G, right)):
        cells = np.kron(pan, np.ones((S, S, 1))).astype(np.uint8)
        cells[::S, :, :] = (cells[::S, :, :] * 0.75).astype(np.uint8)       # 格子线：只压暗格边，中心点不动
        cells[:, ::S, :] = (cells[:, ::S, :] * 0.75).astype(np.uint8)
        big[:, off:off + W * S] = cells
    Image.fromarray(big, 'RGB').save(p)
    return p, True


def _outline_colored(im):
    """饭团的轮廓色：很暗而且偏红棕（#140503、#25110b：R 比 G 大一截）；海苔最暗是 #18160c，R≈G，不偏红。
    精灵是色板量化的，两类颜色能分开"""
    r, g = im[..., 0].astype(int), im[..., 1].astype(int)
    return (im[..., 3] > 0) & (_lum(im) < 0.12) & (r - g > 8)


def keep_mask(im, tier):
    """返回不覆盖金膜（保留原色）的像素"""
    a = im[..., 3] > 0
    L, S = _lum(im), _sat(im)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    edge = _edge(a)
    keep = np.zeros_like(a)
    if tier == 1:                                   # 饭团：海苔
        keep = a & ~edge & (L < 0.35)
        keep = binary_closing(keep) & a & ~edge
        # 饭团的轮廓有两层（最外一格深棕 + 紧挨着的一格近黑），后一层亮度和海苔一样低，
        # 会被当成海苔留黑。紧贴外轮廓的这一格不算海苔，交给 gild() 的「内线」换成深金
        keep &= ~binary_dilation(edge)
        # 斜边上轮廓会厚到第三格，零零星星的深色像素是轮廓残留；海苔是一整大块，只留大块
        kl, kn = label(keep, structure=np.ones((3, 3)))
        if kn:
            ks = np.bincount(kl.ravel())
            keep &= ks[kl] >= 12
        # 剩下夹在海苔里的轮廓色像素（轮廓是 #140503 近黑棕，海苔最暗是偏绿的 #18160c，颜色不同）也剔掉
        keep &= ~_outline_colored(im)
    elif tier == 3:                                 # 白米饭：碗 = 蓝带 + 蓝带以下的白
        blue = a & (b > r + 30) & (b > 120)
        if blue.any():
            top = np.where(blue.any(1))[0].min()
            rows = np.arange(a.shape[0])[:, None] >= top - 1
            keep = a & (blue | (rows & (L > 0.6) & (S < 0.25)))
    elif tier == 4:                                 # 泡面：杯子 = 白/米色（低饱和）+ 红；面条是饱和的橙棕
        red = a & (r > 150) & (g < 120) & (b < 120) & (r - g > 60)
        pale = a & (L > 0.6) & (S < 0.4)
        keep = red | pale
        rl, rn = label(red)
        if rn:                                      # 最大一块红色 = 杯身红条，它以下全是杯身（汤里零星的红点不算）
            band = rl == (np.argmax(np.bincount(rl.ravel())[1:]) + 1)
            top = np.where(band.any(1))[0].min()
            keep |= a & (np.arange(a.shape[0])[:, None] >= top) & (L >= 0.2)
        lab, n = label(keep)                        # 去掉面条里零星的浅色高光
        if n:
            sizes = np.bincount(lab.ravel())
            keep &= sizes[lab] >= 4
    elif tier in FACE_TIERS and load_face_mask(tier) is not None:   # 用户在画图里修过的脸部遮罩
        keep = load_face_mask(tier) & a
    elif tier in FACE_TIERS:                        # 人形：脸 = 手标椭圆 ∪ 最大一块肤色
        # 只靠肤色会漏：肤色被眼睛、刘海切成几块（惊喜小鲸的眼睛、大小姐的左眼），
        # 而豆包的包子发夹颜色又像肤色。角色就 4 个，脸的位置直接手标（精灵像素坐标，见 FACE_ELLIPSE）
        # 椭圆里只留肤色（额头从刘海缝里露出来的也算）和眼睛那一横条；椭圆里的刘海照常镀金，
        # 不然小鲸眼睛上方会留一块没染色的蓝刘海，看着像个圆斑
        cx, cy, rx, ry, e0, e1 = FACE_ELLIPSE[tier]
        yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        ell = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1
        soft = a & (r > 195) & (g > 150) & (b > 120) & (r >= g) & (r - b > 8)
        face = ell & (soft | ((yy >= e0) & (yy <= e1)))
        # 刘海：脸外头发的常见颜色（精灵是色板量化的，颜色能精确对上）在脸里出现的，算刘海照常镀金。
        # 深色（睫毛、眼线）不参与
        outside = a & ~binary_dilation(ell, iterations=3) & (L >= 0.3)
        key = (im[..., 0].astype(int) << 16) | (im[..., 1].astype(int) << 8) | im[..., 2].astype(int)
        cols, cnt = np.unique(key[outside], return_counts=True)
        hair = np.isin(key, cols[cnt >= HAIR_MIN]) & (L >= 0.3) & ~soft_skin(r, g, b, a)
        face &= ~hair
        skin = a & (r > 215) & (g > 170) & (b > 140) & (r >= g) & (g >= b - 5) & (r - b > 12) & (r - b < 95)
        lab, n = label(skin)
        if n:
            big_i = np.argmax(np.bincount(lab.ravel())[1:]) + 1
            face |= binary_fill_holes(binary_closing(lab == big_i, iterations=2))
        keep = face & a & ~edge
    return keep & ~edge


INNER = np.array([107, 67, 22.])   # 金边最里一条（深金 #6b4316）；外圈古铜 PAL[2]、中间亮金 PAL[4]。用户在 4 版里选了这个


def gild(im, tier, deep=True, base=None, span=None, inner_col=None):
    im = im.astype(float)
    a = im[..., 3] > 0
    L = _lum(im)
    edge = _edge(a)
    keep = keep_mask(im, tier)
    out = im.copy()
    body = a & (L >= 0.2)
    if tier in LIGHT_TIERS:
        rgb = out[..., :3]
        tint = a & ~keep                            # 脸（keep）保持原色
        if tier == 10:                              # 大肥鱼：薄金只盖白色部位（白肚皮、眼睛、浅蓝阴影），蓝色身体保持原来的饱和亮蓝（用户选的 C 版）
            tint &= L > 0.7
        hl = tint & (L > 0.85)
        rgb[hl] = rgb[hl] * 0.4 + PAL[6] * 0.6
        rgb[tint] = rgb[tint] * 0.85 + np.array([255, 210, 90]) * 0.15
        deep = False
    if deep:
        lo, hi = np.percentile(L[body], 4), np.percentile(L[body], 99)
        Ln = np.clip((L - lo) / max(hi - lo, 1e-3), 0, 1)
        # 覆膜从第 2 档起（最深两档只留给描边），否则深色物件（大肥鱼、豆包头发）会发黑像青铜
        b0, sp = TONE.get(tier, (2, 4))
        b0 = b0 if base is None else base
        sp = sp if span is None else span
        idx = np.where(L < 0.2, 0, np.where(Ln > 0.97, 6, np.minimum(5, b0 + np.floor(Ln ** 0.9 * (sp + 0.999))))).astype(int)
        cover = a & ~keep
        k = BLEND.get(tier, 0)
        out[..., :3][cover] = PAL[idx][cover] * (1 - k) + im[..., :3][cover] * k
    # 描边换金：原图描边在平直处常有 2 像素厚、颜色是深棕不是纯黑，只换最外一格会剩一条黑线。
    # 最外一格（偏暗的）→ 亮金；紧挨着它的内层深色描边 → 深金
    outer = edge & (L < 0.45)
    inner = a & ~edge & (L < 0.3) & binary_dilation(outer) & ~keep
    if tier == 1:                                   # 饭团：轮廓色的零星残留（挨不着外圈的）一并换成内线色
        inner |= _outline_colored(im) & ~edge & ~keep
    out[..., :3][inner] = INNER if inner_col is None else inner_col
    out[..., :3][outer] = PAL[4]
    H, W = a.shape
    big = np.zeros((H + 2, W + 2, 4))
    big[1:-1, 1:-1] = out
    A = np.zeros((H + 2, W + 2), bool)
    A[1:-1, 1:-1] = a
    ring = binary_dilation(A) & _outside(A)               # 外圈只包在外面，不往洞里加（否则面窝的洞被挤成一条缝）
    big[ring, :3] = PAL[2]                          # 外圈古铜（太暗会显成黑边）
    big[ring, 3] = 255
    return big.clip(0, 255).astype(np.uint8), keep


if __name__ == '__main__':
    import sys as _sys
    if '--export-masks' in _sys.argv:
        here = os.path.dirname(os.path.abspath(__file__))
        for k in sorted(MASK_NAMES):
            im = np.array(Image.open(os.path.join(here, '..', 'sprites', f't{k + 1:02d}.png')).convert('RGBA'))
            p, new = export_face_mask(k, im, keep_mask(im.astype(float), k))
            print(('写出 ' if new else '已存在，没覆盖 ') + p)
        _sys.exit()
    import os
    from PIL import Image
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.normpath(os.path.join(here, '..', '..', '..'))
    rows = []
    for k in range(11):
        im = np.array(Image.open(os.path.join(here, '..', 'sprites', f't{k + 1:02d}.png')).convert('RGBA'))
        g, keep = gild(im, k)
        mask = im.copy()
        mask[keep] = [255, 0, 255, 255]
        pad = np.zeros((im.shape[0] + 2, im.shape[1] + 2, 4), np.uint8)
        pad[1:-1, 1:-1] = im
        pm = pad.copy()
        pm[1:-1, 1:-1] = mask
        rows.append([pad, pm, g])
    cw = max(r[0].shape[1] for r in rows) + 6
    ch = max(r[0].shape[0] for r in rows) + 6
    sheet = Image.new('RGBA', (cw * 6, ch * 2 * 3), (120, 140, 140, 255))
    for i, r in enumerate(rows):
        cx, cy = (i % 6) * cw, (i // 6) * ch * 3
        for j, im in enumerate(r):
            sheet.alpha_composite(Image.fromarray(im, 'RGBA'), (cx + 3, cy + j * ch + 3))
    sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
    out = os.path.join(root, '.scratch', 'gild_compare.png')
    sheet.save(out)
    print(out, sheet.size)
