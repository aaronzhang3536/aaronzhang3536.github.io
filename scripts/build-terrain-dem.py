# -*- coding: utf-8 -*-
"""通用地形烘焙：Copernicus GLO-30（首选）或 AWS 开放地形瓦片（terrarium z13, SRTM 30m）→ N² 高程 bin + meta

用法: python scripts/build-terrain-dem.py <name> <lon0> <lon1> <lat0> <lat1> [N] [cop30目录] [--force]
      给出 cop30 目录（含 cop_N36_00_E111.tif / cop_S01_00_W080.tif 等，按瓦片西南角命名）则用
      Copernicus GLO-30，否则回退 AWS terrarium (SRTM)。N 默认 1024。
      已提交的 lushan / luoyun 都是 Copernicus 数据：不给 cop30 目录时脚本拒绝用 SRTM 覆盖
      Copernicus 数据集（确需如此加 --force）。
      烘焙参数（命令行、日期）记录在 meta.json 的 "bake" 字段。
      复现已提交数据：
        python scripts/build-terrain-dem.py lushan 115.90 116.20 29.45 29.72 1024 <cop30目录>
        python scripts/build-terrain-dem.py luoyun 111.452 111.575 36.362 36.462 2048 <cop30目录>
        python scripts/enhance-loess-dem.py luoyun
"""
import datetime
import io
import json
import math
import os
import struct
import sys
import urllib.request

from PIL import Image

Z = 13

def lon2x(lon): return (lon + 180.0) / 360.0 * (2 ** Z)
def lat2y(lat):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * (2 ** Z)

COP = {}
def cop_tile_name(lat_i, lon_i):
    """瓦片按西南角整数经纬度命名：N36/S01、E111/W080"""
    return 'cop_%s%02d_00_%s%03d.tif' % ('N' if lat_i >= 0 else 'S', abs(lat_i),
                                          'E' if lon_i >= 0 else 'W', abs(lon_i))

def cop_elev(lon, lat, copdir):
    import tifffile
    key = (math.floor(lat), math.floor(lon))
    if key not in COP:
        f = os.path.join(copdir, cop_tile_name(*key))
        if not os.path.isfile(f):
            sys.exit('缺少 Copernicus 瓦片: %s（覆盖 lat %d..%d, lon %d..%d）' % (f, key[0], key[0] + 1, key[1], key[1] + 1))
        COP[key] = tifffile.imread(f)
    a = COP[key]
    # 行列分开取：高纬瓦片经向列数少于纬向行数（如 50°~60° 为 3600 行 × 2400 列）
    ny, nx = a.shape[0], a.shape[1]
    fx = (lon - key[1]) * nx - 0.5
    fy = (key[0] + 1 - lat) * ny - 0.5
    x0 = int(max(0, min(nx - 2, fx))); y0 = int(max(0, min(ny - 2, fy)))
    ax = min(max(fx - x0, 0), 1); ay = min(max(fy - y0, 0), 1)
    return float((a[y0, x0] * (1 - ax) + a[y0, x0 + 1] * ax) * (1 - ay) +
                 (a[y0 + 1, x0] * (1 - ax) + a[y0 + 1, x0 + 1] * ax) * ay)

def main(name, LON0, LON1, LAT0, LAT1, N=1024, copdir=None):
    if copdir:
        print('[%s] 数据源: Copernicus GLO-30, 网格 %d²' % (name, N))
        out = bytearray(N * N * 2)
        hmin, hmax = 1e9, -1e9
        for i in range(N):
            lat = LAT1 - (LAT1 - LAT0) * i / (N - 1)
            for j in range(N):
                lon = LON0 + (LON1 - LON0) * j / (N - 1)
                h = max(-50, min(3000, cop_elev(lon, lat, copdir)))
                hmin = min(hmin, h); hmax = max(hmax, h)
                struct.pack_into('<H', out, (i * N + j) * 2, max(0, min(65535, int(round((h + 100) * 10)))))
        finish(name, out, N, LON0, LON1, LAT0, LAT1, hmin, hmax, 'Copernicus GLO-30 (1 arcsec)')
        return
    x0t, x1t = int(lon2x(LON0)), int(lon2x(LON1))
    y0t, y1t = int(lat2y(LAT1)), int(lat2y(LAT0))
    tw, th = x1t - x0t + 1, y1t - y0t + 1
    print('[%s] 瓦片 z%d: x %d..%d, y %d..%d（%d 片）' % (name, Z, x0t, x1t, y0t, y1t, tw * th))
    big = Image.new('RGB', (tw * 256, th * 256))
    for ty in range(y0t, y1t + 1):
        for tx in range(x0t, x1t + 1):
            url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png' % (Z, tx, ty)
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(url, timeout=30) as r:
                        im = Image.open(io.BytesIO(r.read())).convert('RGB')
                    big.paste(im, ((tx - x0t) * 256, (ty - y0t) * 256))
                    break
                except Exception as e:
                    if attempt == 2:
                        print('FAIL', url, e); sys.exit(1)
    px = big.load()
    def elev_at(fx, fy):
        x0 = int(fx); y0 = int(fy)
        x1 = min(x0 + 1, big.width - 1); y1 = min(y0 + 1, big.height - 1)
        ax = fx - x0; ay = fy - y0
        def e(x, y):
            r, g, b = px[x, y]
            return r * 256 + g + b / 256 - 32768
        return (e(x0, y0) * (1 - ax) + e(x1, y0) * ax) * (1 - ay) + (e(x0, y1) * (1 - ax) + e(x1, y1) * ax) * ay
    out = bytearray(N * N * 2)
    hmin, hmax = 1e9, -1e9
    for i in range(N):
        lat = LAT1 - (LAT1 - LAT0) * i / (N - 1)
        gy = lat2y(lat) * 256 - y0t * 256
        for j in range(N):
            lon = LON0 + (LON1 - LON0) * j / (N - 1)
            gx = lon2x(lon) * 256 - x0t * 256
            h = elev_at(min(max(gx, 0), big.width - 1.001), min(max(gy, 0), big.height - 1.001))
            h = max(-50, min(3000, h))
            hmin = min(hmin, h); hmax = max(hmax, h)
            struct.pack_into('<H', out, (i * N + j) * 2, max(0, min(65535, int(round((h + 100) * 10)))))
    finish(name, out, N, LON0, LON1, LAT0, LAT1, hmin, hmax, 'AWS Terrain Tiles (SRTM), terrarium z13')

def outdir_of(name):
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', name)

def guard_downgrade(name, copdir):
    """不给 cop30 目录 = 回退 SRTM；目标若已是 Copernicus 数据，默认拒绝覆盖（防止把已提交数据降级）"""
    if copdir or FORCE:
        return
    mp = os.path.join(outdir_of(name), 'meta.json')
    if os.path.isfile(mp):
        with open(mp, encoding='utf-8') as f:
            old = json.load(f)
        if 'Copernicus' in old.get('source', ''):
            sys.exit('[%s] 现有数据来自 %s，回退 SRTM 会降低精度。请给出 cop30 目录；确需覆盖请加 --force。'
                     % (name, old['source']))

def finish(name, out, N, LON0, LON1, LAT0, LAT1, hmin, hmax, src):
    midlat = (LAT0 + LAT1) / 2
    mx = (LON1 - LON0) * 111320 * math.cos(math.radians(midlat))
    my = (LAT1 - LAT0) * (111132.9 - 559.82 * math.cos(2 * math.radians(midlat)))
    outdir = outdir_of(name)
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, 'height.bin'), 'wb') as f:
        f.write(out)
    meta = {'n': N, 'lon0': LON0, 'lon1': LON1, 'lat0': LAT0, 'lat1': LAT1,
            'mx': round(mx, 1), 'my': round(my, 1), 'scale': 0.1, 'offset': -100,
            'hmin': round(hmin, 1), 'hmax': round(hmax, 1),
            'source': src,
            'bake': {'cmd': BAKE_CMD, 'date': datetime.date.today().isoformat(), 'clamp_m': [-50, 3000]}}
    with open(os.path.join(outdir, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print('[%s] 完成: %.1f×%.1f km, 高程 %.0f..%.0f m' % (name, mx / 1000, my / 1000, hmin, hmax))

FORCE = False
BAKE_CMD = ''

if __name__ == '__main__':
    FORCE = '--force' in sys.argv
    argv = [a for a in sys.argv[1:] if a != '--force']
    if len(argv) < 5:
        sys.exit(__doc__)
    n = int(argv[5]) if len(argv) > 5 else 1024
    cop = argv[6] if len(argv) > 6 else None
    # 记录到 meta.json 的命令行：cop30 目录只留目录名，不把本机绝对路径写进公开数据
    shown = argv[:6] + ([os.path.basename(os.path.normpath(cop))] if cop else []) + (['--force'] if FORCE else [])
    BAKE_CMD = 'python scripts/build-terrain-dem.py ' + ' '.join(shown)
    guard_downgrade(argv[0], cop)
    main(argv[0], float(argv[1]), float(argv[2]), float(argv[3]), float(argv[4]), n, cop)
