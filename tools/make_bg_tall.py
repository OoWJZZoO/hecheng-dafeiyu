"""高背景 sprites/bg_tall.png（2026-11-13，屏幕适配；网页版 main 和微信版 wxgame 用同一张，两边这个脚本只差输出路径）。

游戏构图 360×704 逻辑像素宽度撑满手机，构图上下（以及矮屏两侧）露出的地方由渲染层用这张图补齐。
1 个背景格 = 2 逻辑像素（和原 bg.png 一样）。构图原点在图里的位置 = (X0, Y0) 格，
要和 game.js 的 BG_X0 / BG_Y0 一致。

做法照网页版 tools/make_sprites.py 的 make_bg：高清原图按同一比例（920 源像素 → 180 格）缩下来，
顶上用最上沿的天空色补平（天空顶部是平涂渐变）。左右两边：
  - 有 art/bg_gpt_side_ext.png（GPT 把原图上部 1024×1024 往左右扩画的横图，1536×1024，原图在 x=256 起）就用它，
    先按中间那块和原图的差做一次逐通道颜色校正；上部 1024 行整块都用它（中间也是，不贴原 bg.png），
    再往下（海）中间接原图 + GPT 补的海、左右镜像，交界 60 行渐变；
  - 没有就左边镜像（尾巴那几行改用最左一列），右边先用原图 920 以右的真内容、不够再镜像。
往下的海面：
  - 有 art/bg_gpt_sea_ext.png（GPT 接着往下画的海，1024×1536，上半张对应原图下半张 768–1536 行）就接上它，
    接缝处 64 源像素渐变混合；
  - 没有就临时用原图底部那段海面上下镜像平铺（看得出重复，只作占位）。
最后整张量化到 48 色、不抖动。

用法（在仓库根目录 python tools/make_bg_tall.py）
"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WX = ROOT.name == 'wxgame'                          # 微信版目录里跑：读写 reference-web/sprites
ART = (ROOT.parent if WX else ROOT) / 'art'
SPRITES = ROOT / 'reference-web' / 'sprites' if WX else ROOT / 'sprites'
OUT = SPRITES / 'bg_tall.png'

X0, Y0 = 40, 40            # 构图原点（背景格）。左右各留 40 格（80 逻辑像素）：手机浏览器可视区偏矮时两侧会露出来
COMP_W, COMP_H = 180, 352  # 构图 360×704 逻辑像素 = 180×352 格
BOTTOM = 132               # 构图下面再留多少格海面（够 21:9 的长屏）
RIGHT = 40                 # 右边先用原图 920 以右的 20 格真内容，不够再镜像
F = 920 / 180              # 源像素 / 格（和 make_bg 一样）
SKY_PAD = 19               # 原 bg.png 顶上补的天空行数
TAIL_ROWS = (66, 110)      # 原 bg.png 里鲸鱼尾巴占的行（左边镜像时要避开）


def main():
    src = np.asarray(Image.open(ART / 'bg_gpt_v1.png').convert('RGB')).astype(np.float32)
    ext_path = ART / 'bg_gpt_sea_ext.png'
    if ext_path.exists():
        ext = np.asarray(Image.open(ext_path).convert('RGB').resize((1024, 1536), Image.LANCZOS)).astype(np.float32)
        blend = 64
        a = np.linspace(0, 1, blend)[:, None, None]
        seam = src[-blend:] * (1 - a) + ext[768 - blend:768] * a
        src = np.concatenate([src[:-blend], seam, ext[768:]], 0)
        print('海面延伸：GPT 图', ext_path.name)
    else:
        print('海面延伸：没有 art/bg_gpt_sea_ext.png，先用镜像平铺占位')
    h = src.shape[0]
    th = round(h * 180 / 920)
    side_path = ART / 'bg_gpt_side_ext.png'
    side = side_path.exists()
    if side:   # 左右各 PAD 源像素：上部 1024 行取 GPT 扩画（颜色校正到原图），下面取镜像
        PAD, BL = 256, 60
        gpt = np.asarray(Image.open(side_path).convert('RGB').resize((1024 + 2 * PAD, 1024), Image.LANCZOS)).astype(np.float32)
        mid, ref = gpt[:, PAD:PAD + 1024], src[:1024]
        gpt = (gpt - mid.mean((0, 1))) / (mid.std((0, 1)) + 1e-6) * ref.std((0, 1)) + ref.mean((0, 1))
        wide = np.zeros((h, 1024 + 2 * PAD, 3), np.float32)
        wide[:, PAD:PAD + 1024] = src
        wide[:, :PAD] = src[:, 1:PAD + 1][:, ::-1]
        wide[:, PAD + 1024:] = src[:, 1023 - PAD:1023][:, ::-1]
        k = np.ones((1024, 1, 1), np.float32); k[1024 - BL:] = np.linspace(1, 0, BL)[:, None, None]
        # 上部 1024 行整块（包括中间原图那块）都用 GPT 这一张：天空、太阳、鲸鱼塔是一整张画，不拼接（2026-11-13 用户定的，
        # 之前只取左右两边、中间贴原图，晚霞色带在交界处对不上）
        wide[:1024] = gpt * k + wide[:1024] * (1 - k)
        full = Image.fromarray(wide.clip(0, 255).astype(np.uint8))
        print('左右延伸：GPT 图', side_path.name)
    else:
        PAD = 0
        full = Image.fromarray(src.clip(0, 255).astype(np.uint8))
        print('左右延伸：没有 art/bg_gpt_side_ext.png，用镜像')
    # 和 make_bg 一样：0–920 源像素缩成 180 格（构图里这部分和原 bg.png 逐格对齐），右边剩下的 104 源像素另缩成 20 格
    main_ = full.crop((PAD, 0, PAD + 920, h)).resize((180, th), Image.BOX)
    right = full.crop((PAD + 920, 0, PAD + 1024, h)).resize((round(104 / F), th), Image.BOX)
    parts = [np.asarray(main_), np.asarray(right)]
    if side:
        parts.insert(0, np.asarray(full.resize((X0, th), Image.BOX, box=(PAD - X0 * F, 0, PAD, h))))
        extra = RIGHT - parts[-1].shape[1]
        parts.append(np.asarray(full.resize((extra, th), Image.BOX, box=(PAD + 1024, 0, PAD + 1024 + extra * F, h))))
    a = np.concatenate(parts, 1)
    rows_below = Y0 + SKY_PAD + a.shape[0]          # 已有内容到哪一行
    total_h = Y0 + COMP_H + BOTTOM
    if a.shape[0] + SKY_PAD + Y0 < total_h:           # 不够长：底部那段海面镜像平铺
        band = a[-60:]
        tiles, k = [], 0
        while sum(t.shape[0] for t in tiles) < total_h - rows_below:
            tiles.append(band[::-1] if k % 2 == 0 else band); k += 1
        a = np.concatenate([a] + tiles, 0)
    sky = a[:4].mean(axis=0, keepdims=True).astype(np.uint8)
    a = np.concatenate([np.repeat(sky, Y0 + SKY_PAD, 0), a], 0)[:total_h]
    total_w = X0 + COMP_W + RIGHT
    if not side:
        a = np.concatenate([a[:, X0:0:-1], a], 1)                  # 左边没有原图：镜像延伸（只有两侧露出来时才看得到）
        # 镜像会把鲸鱼尾巴也照出来一条：尾巴那几行（TAIL_ROWS，原 bg.png 的行号；这几行没有太阳，天空是横向平涂）
        # 改成原图最左一列横向铺开
        r0, r1 = Y0 + TAIL_ROWS[0], Y0 + TAIL_ROWS[1]
        a[r0:r1, :X0] = a[r0:r1, X0:X0 + 1]
        if a.shape[1] < total_w:                                    # 右边真内容不够：镜像
            a = np.concatenate([a, a[:, -2:-2 - (total_w - a.shape[1]):-1]], 1)
    a = a[:, :total_w]
    q = np.array(Image.fromarray(a, 'RGB').quantize(colors=48, dither=Image.Dither.NONE).convert('RGB'))
    if not side:   # 没有 GPT 横图时：原 bg.png 那块原样贴回（构图里和旧背景逐格一致）
        old = np.asarray(Image.open(SPRITES / 'bg.png').convert('RGB'))
        q[Y0:Y0 + old.shape[0], X0:X0 + old.shape[1]] = old
    img = Image.fromarray(q, 'RGB')
    img.save(OUT)
    print('写出', OUT.relative_to(ROOT), img.size, '构图原点', (X0, Y0))


if __name__ == '__main__':
    main()
