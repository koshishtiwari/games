// Curated named peaks: real coordinates and elevations from Overture/OSM natural=peak (peaks.json), snapped to the local maximum of the baked heightmap.
// usage: node bake-peaks.mjs <peaks.json>   -> data/peaks.json
import fs from 'fs'; import path from 'path'; import { PNG } from 'pngjs';
const OUT = path.resolve(new URL('../../games/delivery/data', import.meta.url).pathname);
const J = JSON.parse(fs.readFileSync(path.join(OUT, 'districts.json'))); const { W, H, lon0, lat1, dlon, dlat, hoff, hscale } = J.grid;
const hp = PNG.sync.read(fs.readFileSync(path.join(OUT, 'height.png')));
const hAt = (i, j) => ((hp.data[(j * W + i) * 4] << 8 | hp.data[(j * W + i) * 4 + 1]) / hscale - hoff);
const peaks = JSON.parse(fs.readFileSync(process.argv[2])).map(([name, cls, ele, lon, lat]) => ({ name, cls, ele, lon, lat })).filter(p => p.cls === 'peak');
const CUR = [['Sagarmatha (Mount Everest)', 86.925, 27.988, 8849], ['Kanchenjunga', 88.147, 27.703, 8586], ['Lhotse', 86.933, 27.962, 8516], ['Makalu', 87.088, 27.889, 8485], ['Cho Oyu', 86.661, 28.094, 8188], ['Dhaulagiri I', 83.4875, 28.6967, 8167], ['Manaslu', 84.5597, 28.5497, 8163], ['Annapurna I', 83.8203, 28.5961, 8091], ['Shishapangma', 85.78, 28.353, 8027], ['Gyachung Kang', 86.745, 28.098, 7952], ['Nuptse', 86.8856, 27.9667, 7861], ['Himalchuli', 84.6358, 28.4367, 7893], ['Annapurna II', 84.1225, 28.535, 7937], ['Ganesh I', 85.1531, 28.3739, 7422], ['Langtang Lirung', 85.5203, 28.2578, 7227], ['Pumori', 86.8269, 28.0142, 7161], ['Gaurishankar', 86.3313, 27.9608, 7134], ['Api', 80.9335, 30.0003, 7132], ['Machapuchare', 83.9486, 28.4947, 6993], ['Ama Dablam', 86.861, 27.861, 6812], ['Kailash', 81.3118, 31.0675, 6638], ['Tilicho Peak', 83.8467, 28.6833, 7134], ['Kangtega', 86.7889, 27.8, 6782], ['Thamserku', 86.7981, 27.7914, 6608]];
const out = [], rep = [];
for (const [name, lon, lat, exp] of CUR) {
  let best = null; for (const p of peaks) { const d = Math.hypot(p.lon - lon, p.lat - lat); if (d > .05 || Math.abs(p.ele - exp) > 330) continue; if (!best || d < best.d) best = Object.assign({}, p, { d }); }
  if (!best) { rep.push(name + ': no matching dataset peak (using curated elevation and coordinates)'); snap(name, { ele: exp, lon, lat }, 'curated'); continue; }
  snap(name, best, 'overture');
}
const used = out.map(o => [o.lon, o.lat]);
for (const p of peaks.filter(p => p.ele > 6100 && /^[A-Za-z0-9 .'()-]+$/.test(p.name || '')).sort((a, b) => b.ele - a.ele)) {
  if (used.some(u => Math.abs(u[0] - p.lon) < .06 && Math.abs(u[1] - p.lat) < .06)) continue;
  if (/ (South|North|East|West|Middle|Central|Main)\b/i.test(p.name)) continue;
  if (p.lon < lon0 + .1 || p.lon > lon0 + W * dlon - .1 || p.lat > lat1 - .1 || p.lat < lat1 - H * dlat + .1) continue;
  snap(p.name, p, 'overture'); used.push([p.lon, p.lat]); if (out.length > 60) break;
}
function snap(name, p, src) {
  const ci = Math.round((p.lon - lon0) / dlon - .5), cj = Math.round((lat1 - p.lat) / dlat - .5);
  let bi = ci, bj = cj, bh = -1e9; for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const h = hAt(ci + di, cj + dj); if (h > bh) { bh = h; bi = ci + di; bj = cj + dj; } }
  out.push({ name, src: src || 'overture', ele: Math.round(p.ele), hm: Math.round(bh), lon: +(lon0 + (bi + .5) * dlon).toFixed(4), lat: +(lat1 - (bj + .5) * dlat).toFixed(4), gx: bi, gy: bj });
  rep.push(`${name}: dataset ${Math.round(p.ele)} m, heightmap ${Math.round(bh)} m, diff ${Math.round(bh - p.ele)} m, snapped ${Math.hypot((bi + .5) * dlon * 88 - (p.lon - lon0) * 88, (bj + .5) * dlat * 111 - (lat1 - p.lat) * 111).toFixed(1)} km`);
}
out.sort((a, b) => b.ele - a.ele);
fs.writeFileSync(path.join(OUT, 'peaks.json'), JSON.stringify(out));
console.log(out.length, 'peaks written'); console.log(rep.join('\n'));
const diffs = out.map(o => o.hm - o.ele); console.log('mean heightmap-minus-dataset', (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(0), 'm; range', Math.min(...diffs), Math.max(...diffs));
