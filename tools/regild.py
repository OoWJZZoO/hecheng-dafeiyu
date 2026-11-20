"""只重生成镀金精灵 g01–g11：读现成的 sprites/t*.png，跑 gild，写回 sprites/g*.png。
（make_sprites.py 要从动画项目私有素材拉的原图重新切，只改 gild.py 时用这个就够了。）
用法：python tools/regild.py [--check]   --check 不写文件，只报告每级精灵「外轮廓向内 3 格」里还剩多少暗色像素
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation

from gild import gild, _outside

HERE = os.path.dirname(os.path.abspath(__file__))
SP = os.path.join(HERE, '..', 'sprites')


def leftover(g):
    """镀金图里，贴着外面 3 格以内、亮度低于 0.2（比深金内线 #6b4316 还暗，即黑/深棕残留） 的像素数（应当是金色，不该是黑/深棕）"""
    a = g[..., 3] > 0
    out = _outside(a)
    # 图边之外也算「外面」（精灵贴着图边时，最外一行的外面就是图外）
    near = a & binary_dilation(np.pad(out, 1, constant_values=True), iterations=3)[1:-1, 1:-1]
    L = (0.299 * g[..., 0] + 0.587 * g[..., 1] + 0.114 * g[..., 2]) / 255
    bad = near & (L < 0.2)
    return int(bad.sum()), bad


if __name__ == '__main__':
    check = '--check' in sys.argv
    for k in range(11):
        im = np.array(Image.open(os.path.join(SP, f't{k + 1:02d}.png')).convert('RGBA'))
        g = gild(im, k)[0]
        n, bad = leftover(g)
        ys, xs = np.where(bad)
        print(f'g{k + 1:02d} 外缘暗像素 {n}', list(zip(xs.tolist(), ys.tolist()))[:8])
        if not check:
            Image.fromarray(g, 'RGBA').save(os.path.join(SP, f'g{k + 1:02d}.png'))
