# -*- coding: utf-8 -*-
"""通用地形烘焙：AWS 开放地形瓦片（terrarium z13, SRTM 30m）→ 1024² 高程 bin + meta

用法: python scripts/build-terrain-dem.py <name> <lon0> <lon1> <lat0> <lat1>
输出: public/data/<name>/height.bin + meta.json（格式与庐山一致）
例:   python scripts/build-terrain-dem.py luoyun 111.39 111.59 36.33 36.49
"""
import io
import json
import math
import os
import struct
import sys
import urllib.request

from PIL import Image

Z = 13
N = 1024

def lon2x(lon): return (lon + 180.0) / 360.0 * (2 ** Z)
def lat2y(lat):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * (2 ** Z)

def main(name, LON0, LON1, LAT0, LAT1):
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
    midlat = (LAT0 + LAT1) / 2
    mx = (LON1 - LON0) * 111320 * math.cos(math.radians(midlat))
    my = (LAT1 - LAT0) * (111132.9 - 559.82 * math.cos(2 * math.radians(midlat)))
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', name)
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, 'height.bin'), 'wb') as f:
        f.write(out)
    meta = {'n': N, 'lon0': LON0, 'lon1': LON1, 'lat0': LAT0, 'lat1': LAT1,
            'mx': round(mx, 1), 'my': round(my, 1), 'scale': 0.1, 'offset': -100,
            'hmin': round(hmin, 1), 'hmax': round(hmax, 1),
            'source': 'AWS Terrain Tiles (SRTM), terrarium z13'}
    with open(os.path.join(outdir, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print('[%s] 完成: %.1f×%.1f km, 高程 %.0f..%.0f m' % (name, mx / 1000, my / 1000, hmin, hmax))

if __name__ == '__main__':
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]))
