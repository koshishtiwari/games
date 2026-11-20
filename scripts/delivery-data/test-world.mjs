// Sanity checks for the baked world data (built-up density raster and roads).
// usage: node test-world.mjs   (exit code 1 on failure)
import fs from 'fs'; import { PNG } from 'pngjs';
const dir = new URL('../../games/delivery/data/', import.meta.url).pathname;
const J = JSON.parse(fs.readFileSync(dir + 'districts.json')); const { W, H, SS, lon0, lat1, dlon, dlat } = J.grid;
const w = PNG.sync.read(fs.readFileSync(dir + 'world.png')), ids = PNG.sync.read(fs.readFileSync(dir + 'districts.png')), RW = W * SS;
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const idAt = (i, j) => ids.data[((j * SS) * RW + i * SS) * 4];
const cells = []; let nepalBuilt = 0, nepalRoadPx = {};
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const p = (j * W + i) * 4, d = idAt(i, j); if (!d) continue;
  const n = Math.expm1(w.data[p] / 255 * Math.log(4001)); if (n > 20) nepalBuilt++; cells.push([n, i, j, d]);
  const c = w.data[p + 2]; if (c) nepalRoadPx[c] = (nepalRoadPx[c] || 0) + 1;
}
cells.sort((a, b) => b[0] - a[0]);
const top = cells.slice(0, 12).map(c => `${J.districts[c[3] - 1].name} ${Math.round(c[0])}`);
console.log('densest Nepal cells:', top.join(', '));
const ktm = new Set(['Kathmandu', 'Lalitpur', 'Bhaktapur']);
ok(ktm.has(J.districts[cells[0][3] - 1].name), 'densest cell inside Nepal is in the Kathmandu valley (' + J.districts[cells[0][3] - 1].name + ')');
ok(cells.slice(0, 12).filter(c => ktm.has(J.districts[c[3] - 1].name)).length >= 4, 'at least 4 of the 12 densest Nepal cells are Kathmandu, Lalitpur or Bhaktapur (the rest are Terai cities)');
const kd = {}; cells.forEach(c => { const n = J.districts[c[3] - 1].name; (kd[n] = kd[n] || []).push(c[0]); });
const avg = n => kd[n].reduce((a, b) => a + b, 0) / kd[n].length;
ok(avg('Kathmandu') > avg('Dolpa') * 20, `mean cell density Kathmandu ${avg('Kathmandu').toFixed(0)} vs Dolpa ${avg('Dolpa').toFixed(1)}`);
ok(nepalBuilt > 20000, 'built-up cells (>20 buildings) inside Nepal: ' + nepalBuilt);
const rb = fs.readFileSync(dir + 'roads.bin'); const n = rb.readUInt32LE(4);
ok(rb.toString('latin1', 0, 4) === 'RD01' && n > 100000, 'roads.bin ways: ' + n);
ok((nepalRoadPx[4] || 0) > 1500 && (nepalRoadPx[3] || 0) > 1500, 'road raster inside Nepal by class: ' + JSON.stringify(nepalRoadPx));
// Mahendra Highway sanity: a trunk/primary pixel exists along the Terai near Butwal and Birgunj
const near = (lon, lat) => { const i = Math.round((lon - lon0) / dlon), j = Math.round((lat1 - lat) / dlat); let m = 0; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) m = Math.max(m, w.data[((j + dj) * W + i + di) * 4 + 2]); return m; };
ok(near(83.45, 27.70) >= 3, 'major road class near Butwal: ' + near(83.45, 27.70)); ok(near(84.88, 27.01) >= 3, 'major road near Birgunj: ' + near(84.88, 27.01)); ok(near(85.32, 27.71) >= 3, 'major road near Kathmandu: ' + near(85.32, 27.71));
process.exit(fail ? 1 : 0);
