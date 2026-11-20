"""Builds games/delivery/data/world.png + roads.bin from the cached Overture extracts.
usage: python bake_world.py <cacheDir> <outDir>
world.png (1920x1248, 500 m cells, RGB): R = log built-up density (buildings per cell, log1p/log1p(4000)), G = 0 (building orientation dropped when 3D houses were removed), B = road class (0 none .. 5 motorway).
roads.bin: 'RD01', u32 n, then per way: u8 class, u16 npts, npts*(u16 x, u16 y) in 1/16 cell units (Douglas-Peucker simplified, 0.05 cell)."""
import duckdb, struct, zlib, math, sys, re, json
cache, out = sys.argv[1], sys.argv[2]
W, H = 1920, 1248
lon0, dlon, lat1, dlat = 79.2, 0.0050879, 31.2, 0.0045
con = duckdb.connect()
R = bytearray(W * H); G = bytearray(W * H); B = bytearray(W * H)
rows = con.execute(f"select gx,gy,n,szsum,c4,s4 from read_parquet('{cache}/buildings_agg.parquet') where gx>=0 and gx<{W} and gy>=0 and gy<{H}").fetchall()
tot = 0; mx = 0; stats = []
L = math.log1p(4000)
for gx, gy, n, sz, c4, s4 in rows:
    p = gy * W + gx; tot += n; mx = max(mx, n)
    R[p] = min(255, round(255 * math.log1p(n) / L))
    th = math.degrees(math.atan2(s4, c4) / 4) % 90
    o = min(15, int(th / 90 * 16)); c = max(0, min(15, round((sz / n - 4) / 3)))
    stats.append((n, gx, gy))
print('building cells', len(rows), 'buildings', tot, 'max per cell', mx)
CLS = {'tertiary': 1, 'secondary': 2, 'primary': 3, 'trunk': 4, 'motorway': 5}
def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dy * dy; best = -1; bi = 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        if l2 == 0: d = math.hypot(p[0] - a[0], p[1] - a[1])
        else:
            t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); d = math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
        if d > best: best, bi = d, i
    if best <= eps: return [a, b]
    return dp(pts[:bi + 1], eps)[:-1] + dp(pts[bi:], eps)
ways = []; nv = 0
rows = con.execute(f"select class, wkt from read_parquet('{cache}/roads.parquet')").fetchall()
num = re.compile(r'(-?\d+\.?\d*(?:e-?\d+)?) (-?\d+\.?\d*(?:e-?\d+)?)')
for cls, wkt in rows:
    for part in wkt.split('((')[-1].split('), (') if 'MULTI' in wkt else [wkt[wkt.index('(') + 1:]]:
        pts = [((float(a) - lon0) / dlon, (lat1 - float(b)) / dlat) for a, b in num.findall(part)]
        if len(pts) < 2: continue
        pts = dp(pts, .05)
        if any(p[0] < 0 or p[0] >= W or p[1] < 0 or p[1] >= H for p in pts): pts = [p for p in pts if 0 <= p[0] < W and 0 <= p[1] < H]
        if len(pts) < 2: continue
        ways.append((CLS[cls], pts)); nv += len(pts)
        c = CLS[cls]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            steps = max(1, int(max(abs(x1 - x0), abs(y1 - y0)) * 2))
            for s in range(steps + 1):
                x = int(x0 + (x1 - x0) * s / steps); y = int(y0 + (y1 - y0) * s / steps)
                if 0 <= x < W and 0 <= y < H and B[y * W + x] < c: B[y * W + x] = c
print('road ways', len(ways), 'vertices', nv, 'by class', {k: sum(1 for w in ways if w[0] == v) for k, v in CLS.items()})
buf = bytearray(b'RD01' + struct.pack('<I', len(ways)))
for c, pts in ways:
    buf += struct.pack('<BH', c, len(pts))
    for x, y in pts: buf += struct.pack('<HH', min(65535, round(x * 16)), min(65535, round(y * 16)))
open(out + '/roads.bin', 'wb').write(bytes(buf)); print('roads.bin', len(buf) // 1024, 'KB')
raw = bytearray()
for y in range(H):
    raw.append(1); row = bytearray(W * 3)
    for x in range(W): p = y * W + x; row[x * 3] = R[p]; row[x * 3 + 1] = G[p]; row[x * 3 + 2] = B[p]
    prev = bytearray(3)
    for i in range(W * 3): raw.append((row[i] - (row[i - 3] if i >= 3 else 0)) & 255)
def chunk(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
open(out + '/world.png', 'wb').write(png); print('world.png', len(png) // 1024, 'KB')
# sanity: densest cells
stats.sort(reverse=True)
lonlat = lambda gx, gy: (round(lon0 + (gx + .5) * dlon, 3), round(lat1 - (gy + .5) * dlat, 3))
print('densest cells', [(n, lonlat(gx, gy)) for n, gx, gy in stats[:5]])
json.dump({'buildings': tot, 'ways': len(ways), 'vertices': nv}, open(cache + '/world_stats.json', 'w'))
