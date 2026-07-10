# -*- coding: utf-8 -*-
"""黄土塬 DEM 增强：SRTM 30m 抹平了沟壑细节，本脚本在实测地形上做
   1) 塬面保平（低坡度区轻度平滑，强化「塬」的平顶特征）
   2) 坡度选择性分形细节（ridged FBM，只加在沟坡上 → 切沟质感）
   3) 热侵蚀模拟（数十轮塌方迭代，锐化塬缘、堆软沟底坡脚）
   读入 build-terrain-dem.py 的输出，原位覆写 height.bin / meta.json。
   用法: python scripts/enhance-loess-dem.py luoyun
"""
import json
import os
import struct
import sys

import numpy as np


def value_noise(n, cell, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((n // cell + 2, n // cell + 2)).astype(np.float32)
    ys = np.linspace(0, n / cell, n, endpoint=False)
    xs = ys
    y0 = ys.astype(int); x0 = xs.astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    sy = fy * fy * (3 - 2 * fy); sx = fx * fx * (3 - 2 * fx)
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x0 + 1)]
    c = g[np.ix_(y0 + 1, x0)]; d = g[np.ix_(y0 + 1, x0 + 1)]
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


def ridged_fbm(n, seed):
    out = np.zeros((n, n), np.float32)
    amp, cell = 1.0, 96
    for o in range(5):
        v = value_noise(n, max(cell, 2), seed + o * 17)
        out += amp * (1.0 - np.abs(v * 2 - 1))     # ridged：褶皱状
        amp *= 0.52
        cell //= 2
    return (out - out.min()) / (out.max() - out.min())


def slope_of(h, cellm):
    gy, gx = np.gradient(h, cellm)
    return np.hypot(gx, gy)


def thermal_erosion(h, cellm, iters, talus=0.55, k=0.28):
    for _ in range(iters):
        diffs = []
        total = np.zeros_like(h)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb = np.roll(h, (dy, dx), (0, 1))
            d = h - nb
            d[d < talus * cellm] = 0
            diffs.append(d)
            total += d
        total[total == 0] = 1
        move = np.zeros_like(h)
        for (dy, dx), d in zip(((1, 0), (-1, 0), (0, 1), (0, -1)), diffs):
            f = k * d * (d / total)
            move -= f
            move += np.roll(f, (-dy, -dx), (0, 1))
        h = h + move
        # 边界固定
        h[0, :] = h[1, :]; h[-1, :] = h[-2, :]; h[:, 0] = h[:, 1]; h[:, -1] = h[:, -2]
    return h


def main(name):
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', name)
    meta = json.load(open(os.path.join(base, 'meta.json'), encoding='utf-8'))
    n = meta['n']
    raw = np.frombuffer(open(os.path.join(base, 'height.bin'), 'rb').read(), dtype='<u2').astype(np.float32)
    h = (raw * meta['scale'] + meta['offset']).reshape(n, n)
    cellm = meta['mx'] / n
    print('输入: %d² 网格 %.1fm/格, 高程 %.0f..%.0f' % (n, cellm, h.min(), h.max()))

    slope = slope_of(h, cellm)
    flat = np.clip(1.0 - slope / 0.12, 0, 1)           # 塬面掩码
    steep = np.clip((slope - 0.10) / 0.30, 0, 1)       # 沟坡掩码

    # 1) 塬面保平：低坡区向 5×5 均值靠拢
    k5 = np.ones((5, 5), np.float32) / 25
    pad = np.pad(h, 2, mode='edge')
    sm = np.zeros_like(h)
    for dy in range(5):
        for dx in range(5):
            sm += pad[dy:dy + n, dx:dx + n] * k5[dy, dx]
    h = h * (1 - 0.65 * flat) + sm * (0.65 * flat)

    # 2) 坡度选择性 ridged 细节：沟坡雕切沟（幅度随坡度，最高 ~22m）
    det = ridged_fbm(n, seed=7)
    det2 = ridged_fbm(n, seed=91)
    h = h + (det - 0.5) * 30.0 * steep + (det2 - 0.5) * 9.0 * np.clip(steep * 1.4, 0, 1)

    # 3) 热侵蚀：塌出黄土崖的坡脚与锐利塬缘
    h = thermal_erosion(h, cellm, iters=48)

    out = np.clip((h + 100) * 10, 0, 65535).astype('<u2')
    open(os.path.join(base, 'height.bin'), 'wb').write(out.tobytes())
    meta['hmin'] = round(float(h.min()), 1)
    meta['hmax'] = round(float(h.max()), 1)
    meta['source'] += ' + loess enhancement (slope-selective ridged detail + thermal erosion)'
    json.dump(meta, open(os.path.join(base, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('增强完成: 高程 %.0f..%.0f, 平均|Δ| %.1fm' % (h.min(), h.max(), np.abs(h - (raw.reshape(n, n) * meta['scale'] + meta['offset'])).mean()))


if __name__ == '__main__':
    main(sys.argv[1])
