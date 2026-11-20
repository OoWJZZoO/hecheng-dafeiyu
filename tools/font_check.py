"""字模排查小工具（配合 make_font.py；经验见 docs/像素字经验.md）。

  python tools/font_check.py glyph 13_700 110 金肥鱼      看字模里这些字二值化后的点阵和位置（上/下 = 相对基线的行）
  python tools/font_check.py try 署 11 70 200,300,400    同一个字换几种字重画，看哪种不粘
  python tools/font_check.py preview 13_700 110 镀金大肥鱼 out.png [gold|plain]
                                                          照 pixui.js 的做法（二值化 + 1 格描边 + 投影）拼一行，放大存图
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = 'C:/Windows/Fonts/NotoSansSC-VF.ttf'


def load():
    meta = json.loads((ROOT / 'sprites/font.json').read_text(encoding='utf-8'))
    return meta, np.array(Image.open(ROOT / 'sprites/font.png'))


def glyph(key, thr, chars):
    meta, A = load()
    for ch in chars:
        x, y, w, h, bx, by, adv = meta[key][ch]
        print(f'{ch} {key}  宽 {w} 左 {bx} 上 {by} 下 {by + h - 1} 步进 {adv}')
        for r in A[y:y + h, x:x + w]:
            print(''.join('#' if v > thr else '+' if v > 40 else '.' for v in r))


def try_weights(ch, px, thr, weights):
    for wt in weights:
        f = ImageFont.truetype(FONT, px)
        f.set_variation_by_axes([wt])
        im = Image.new('L', (int(px * 3), int(px * 3)), 0)
        ImageDraw.Draw(im).text((px // 2, px * 2), ch, font=f, fill=255, anchor='ls')
        im = im.crop(im.getbbox())
        print(f'--- {ch} {px:g}px 字重 {wt}')
        for r in np.array(im):
            print(''.join('#' if v > thr else '.' for v in r))


def preview(key, thr, text, out, theme='gold'):
    from scipy.ndimage import binary_dilation
    meta, A = load()
    st, px = meta[key], float(key.split('_')[0])
    pad = 6
    W, H = int(sum(st[c][6] for c in text)) + pad * 2, int(px * 1.5) + pad * 2
    a = np.zeros((H, W), np.uint8)
    pen, base = pad, pad + round(px * 1.12)
    for c in text:
        x, y, w, h, bx, by, adv = st[c]
        if w:
            ox, oy = round(pen) + bx, base + by
            a[oy:oy + h, ox:ox + w] = np.maximum(a[oy:oy + h, ox:ox + w], A[y:y + h, x:x + w])
        pen += adv
    ink = a > thr
    img = np.full((H, W, 3), 250, np.uint8)
    if theme == 'gold':
        o = binary_dilation(ink, np.ones((3, 3)))
        sh = np.zeros_like(o)
        sh[1:] = o[:-1]
        img[o | sh] = (74, 46, 20)
        ys = np.where(ink.any(1))[0]
        mid = ys[0] + (ys[-1] - ys[0]) * .55
        for yy in range(H):
            img[yy][ink[yy]] = (255, 233, 138) if yy <= mid else (240, 164, 40)
    else:
        img[ink] = (74, 46, 32)
    k = max(4, 600 // W)
    Image.fromarray(img).resize((W * k, H * k), Image.NEAREST).save(out)
    print('存好了', out)


if __name__ == '__main__':
    cmd, *a = sys.argv[1:]
    if cmd == 'glyph':
        glyph(a[0], int(a[1]), a[2])
    elif cmd == 'try':
        try_weights(a[0], float(a[1]), int(a[2]), [int(w) for w in a[3].split(',')])
    elif cmd == 'preview':
        preview(a[0], int(a[1]), a[2], a[3], *(a[4:5] or ['gold']))
    else:
        print(__doc__)
