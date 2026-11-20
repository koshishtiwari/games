// Bakes a coarse country-id raster (2 km cells) for the neighbouring countries from Natural Earth 1:50m admin-0 (public domain).
// ids: 1 India, 2 China, 3 Bhutan, 4 Bangladesh, 5 Nepal(NE outline), 0 other. usage: node bake-countries.mjs <countries50.geojson>
import fs from 'fs'; import path from 'path'; import { PNG } from 'pngjs';
const OUT = path.resolve(new URL('../../games/delivery/data', import.meta.url).pathname);
const J = JSON.parse(fs.readFileSync(path.join(OUT, 'districts.json'))); const { W, H, lon0, lat1, dlon, dlat } = J.grid;
const NW = W / 4, NH = H / 4;
const ids = { India: 1, China: 2, Bhutan: 3, Bangladesh: 4, Nepal: 5 };
const gj = JSON.parse(fs.readFileSync(process.argv[2]));
const out = new Uint8Array(NW * NH);
function fill(rings, id) {
  const rows = new Map();
  for (const ring of rings) for (let k = 0; k + 1 < ring.length; k++) {
    let ax = (ring[k][0] - lon0) / dlon / 4, ay = (lat1 - ring[k][1]) / dlat / 4, bx = (ring[k+1][0] - lon0) / dlon / 4, by = (lat1 - ring[k+1][1]) / dlat / 4;
    if (ay === by) continue; if (ay > by) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
    for (let j = Math.max(0, Math.ceil(ay - .5)); j <= Math.min(NH - 1, Math.ceil(by - .5) - 1); j++) { const x = ax + (j + .5 - ay) / (by - ay) * (bx - ax); (rows.get(j) || rows.set(j, []).get(j)).push(x); }
  }
  for (const [j, xs] of rows) { xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil(xs[k] - .5)); i <= Math.min(NW - 1, Math.ceil(xs[k+1] - .5) - 1); i++) out[j * NW + i] = id; }
}
for (const f of gj.features) { const n = f.properties.ADMIN; if (!ids[n]) continue; const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const p of polys) fill(p, ids[n]); }
const buf = Buffer.alloc(NW * NH * 4); for (let p = 0; p < NW * NH; p++) { buf[p*4] = buf[p*4+1] = buf[p*4+2] = out[p]; buf[p*4+3] = 255; }
const png = new PNG({ width: NW, height: NH }); png.data = buf;
const o = PNG.sync.write(png, { colorType: 0, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9 });
fs.writeFileSync(path.join(OUT, 'countries.png'), o);
const cnt = {}; out.forEach(v => cnt[v] = (cnt[v] || 0) + 1); console.log('wrote countries.png', NW + 'x' + NH, (o.length / 1024).toFixed(1) + ' KB', cnt);
