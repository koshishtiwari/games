// Bakes district/province border "nearest boundary point" vector fields (500 m cells).
// Each texel stores the vector from its centre to the nearest point on a boundary (within 1.5 cells),
// so the terrain shader can draw sub-texel, constant-screen-width lines. Usage: node bake-borders.mjs <cacheDir>
import fs from 'fs'; import path from 'path'; import { PNG } from 'pngjs';
const CACHE = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(new URL('../../games/delivery/data', import.meta.url).pathname);
const J = JSON.parse(fs.readFileSync(path.join(OUT, 'districts.json')));
const { W, H, SS, lon0, lat1, dlon, dlat } = J.grid; const RW = W * SS;
const idp = PNG.sync.read(fs.readFileSync(path.join(OUT, 'districts.png')));
const idAt = (x, y) => { const i = Math.floor(x * SS), j = Math.floor(y * SS); if (i < 0 || j < 0 || i >= RW || j >= H * SS) return 0; return idp.data[(j * RW + i) * 4]; };
const prov = [0, ...J.districts.map(d => d.province)];
const adm2 = JSON.parse(fs.readFileSync(path.join(CACHE, 'x/npl_admin2_em.geojson')));
const segs = { d: [], p: [] };
for (const f of adm2.features) {
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  for (const ring of rings) for (let k = 0; k + 1 < ring.length; k++) {
    const ax = (ring[k][0] - lon0) / dlon, ay = (lat1 - ring[k][1]) / dlat, bx = (ring[k+1][0] - lon0) / dlon, by = (lat1 - ring[k+1][1]) / dlat;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const s = 0.7; // cells
    const i1 = idAt(mx + nx * s, my + ny * s), i2 = idAt(mx - nx * s, my - ny * s);
    const isProv = i1 === 0 || i2 === 0 || prov[i1] !== prov[i2];
    (isProv ? segs.p : segs.d).push(ax, ay, bx, by);
  }
}
console.log('segments district', segs.d.length / 4, 'province/country', segs.p.length / 4);
const R = 1.5, B = 4;
// distance (cells) from each texel centre to the nearest segment in arr, capped at R
function dist(arr) {
  const bw = Math.ceil(W / B), bh = Math.ceil(H / B), buckets = new Array(bw * bh), n = arr.length / 4;
  for (let s = 0; s < n; s++) {
    const x0 = Math.min(arr[s*4], arr[s*4+2]) - R, x1 = Math.max(arr[s*4], arr[s*4+2]) + R, y0 = Math.min(arr[s*4+1], arr[s*4+3]) - R, y1 = Math.max(arr[s*4+1], arr[s*4+3]) + R;
    for (let by = Math.max(0, Math.floor(y0 / B)); by <= Math.min(bh - 1, Math.floor(y1 / B)); by++) for (let bx = Math.max(0, Math.floor(x0 / B)); bx <= Math.min(bw - 1, Math.floor(x1 / B)); bx++) (buckets[by * bw + bx] ||= []).push(s);
  }
  const out = new Float32Array(W * H).fill(R);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const b = buckets[Math.floor(j / B) * bw + Math.floor(i / B)]; if (!b) continue;
    const cx = i + .5, cy = j + .5; let best = R * R;
    for (const s of b) {
      const ax = arr[s*4], ay = arr[s*4+1], dx = arr[s*4+2] - ax, dy = arr[s*4+3] - ay, l2 = dx * dx + dy * dy;
      let t = l2 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - cx, qy = ay + dy * t - cy, d2 = qx * qx + qy * qy; if (d2 < best) best = d2;
    }
    out[j * W + i] = Math.sqrt(best);
  }
  return out;
}
const dAll = dist([...segs.d, ...segs.p]), dProv = dist(segs.p);
const buf = Buffer.alloc(W * H * 4);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const p = j * W + i;
  buf[p*4] = 1 + Math.round(dAll[p] / R * 254); buf[p*4+1] = idAt(i + .5, j + .5); buf[p*4+2] = 1 + Math.round(dProv[p] / R * 254); buf[p*4+3] = 255;
}
const png = new PNG({ width: W, height: H }); png.data = buf;
const o = PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9, filterType: 4 });
fs.writeFileSync(path.join(OUT, 'edge.png'), o); console.log('wrote edge.png', (o.length / 1024).toFixed(0) + ' KB (R=district edge distance, G=district id, B=province edge distance; cells, 1.5 cap)');
