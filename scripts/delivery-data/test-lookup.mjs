// Asserts the baked district raster resolves every district at its interior point and reports
// how many official centroids (COD-AB center_lat/lon) land inside their own district.
// Usage: node scripts/delivery-data/test-lookup.mjs
import fs from 'fs';
import { PNG } from 'pngjs';
const dir = new URL('../../games/delivery/data/', import.meta.url).pathname;
const J = JSON.parse(fs.readFileSync(dir + 'districts.json'));
const png = PNG.sync.read(fs.readFileSync(dir + 'districts.png'));
const { W, H, SS, lon0, lat1, dlon, dlat } = J.grid;
const RW = W * SS;
if (png.width !== RW) throw new Error('raster width mismatch');
const idAt = (x, y) => { const i = Math.floor(x * SS), j = Math.floor(y * SS); if (i < 0 || j < 0 || i >= RW || j >= H * SS) return 0; return png.data[(j * RW + i) * 4]; };
if (J.districts.length !== 77) throw new Error('not 77');
let ok = 0, centroidIn = 0; const bad = [];
for (const d of J.districts) {
  if (idAt(d.ix, d.iy) === d.id) ok++; else bad.push(d.name);
  const cx = (d.cLon - lon0) / dlon, cy = (lat1 - d.cLat) / dlat;
  if (idAt(cx, cy) === d.id) centroidIn++;
}
const seen = new Set(); for (let p = 0; p < RW * H * SS; p++) seen.add(png.data[p * 4]);
console.log(`interior-point lookup: ${ok}/77 ok`, bad.length ? 'FAIL ' + bad.join(',') : '');
console.log(`official centroid inside own district: ${centroidIn}/77 (concave shapes expected to miss)`);
console.log('distinct ids in raster (incl. 0):', seen.size);
if (ok !== 77 || seen.size !== 78) process.exit(1);
