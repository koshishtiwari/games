// Bakes Nepal terrain + district data for games/delivery.
// Usage: node scripts/delivery-data/bake.mjs <cacheDir>
// <cacheDir> must contain x/npl_admin2_em.geojson, x/npl_admin0_em.geojson (unzipped HDX COD-AB Nepal)
// and will receive tiles/ (AWS Terrarium z9 PNG cache).
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import zlib from 'zlib';

const CACHE = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(new URL('../../games/delivery/data', import.meta.url).pathname);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(CACHE, 'tiles'), { recursive: true });

// ---- grid definition (equirectangular, square ~500 m cells) ----
const LON0 = 79.2, LAT1 = 31.2;
const DLAT = 0.0045;
const KM_LAT = 110.78, KM_LON_EQ = 111.32, LAT_C = 28.3;
const COS = Math.cos(LAT_C * Math.PI / 180);
const DLON = DLAT * KM_LAT / (KM_LON_EQ * COS);
const W = 1920, H = 1248;
const SS = 2; // district raster supersample
const CELL_KM = DLAT * KM_LAT;
const lonOf = (x) => LON0 + x * DLON;          // x in cell units (0 = left edge)
const latOf = (y) => LAT1 - y * DLAT;
const xOf = (lon) => (lon - LON0) / DLON;
const yOf = (lat) => (LAT1 - lat) / DLAT;

// ---- helpers ----
function writePNG(file, w, h, data, channels, label) {
  const png = new PNG({ width: w, height: h, colorType: channels === 1 ? 0 : channels === 3 ? 2 : 6, inputColorType: channels === 1 ? 0 : channels === 3 ? 2 : 6, inputHasAlpha: channels === 4, deflateLevel: 9, filterType: -1 });
  // pngjs wants RGBA input buffer
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (channels === 1) { buf[i*4] = buf[i*4+1] = buf[i*4+2] = data[i]; buf[i*4+3] = 255; }
    else if (channels === 3) { buf[i*4] = data[i*3]; buf[i*4+1] = data[i*3+1]; buf[i*4+2] = data[i*3+2]; buf[i*4+3] = 255; }
    else { for (let k = 0; k < 4; k++) buf[i*4+k] = data[i*4+k]; }
  }
  png.data = buf;
  const out = PNG.sync.write(png, { colorType: channels === 1 ? 0 : channels === 3 ? 2 : 6, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9, filterType: 4 });
  fs.writeFileSync(file, out);
  console.log(`wrote ${path.basename(file)} ${w}x${h} ${(out.length/1024).toFixed(0)} KB ${label||''}`);
  return out.length;
}

// ---- 1. Terrarium tiles ----
const Z = 9;
const n = 2 ** Z;
const tx = (lon) => (lon + 180) / 360 * n;
const ty = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; };
const lonMax = lonOf(W), latMin = latOf(H);
const tx0 = Math.floor(tx(LON0)) - 0, tx1 = Math.floor(tx(lonMax));
const ty0 = Math.floor(ty(LAT1)), ty1 = Math.floor(ty(latMin));
console.log('tiles x', tx0, tx1, 'y', ty0, ty1);
const MW = (tx1 - tx0 + 1) * 256, MH = (ty1 - ty0 + 1) * 256;
const mosaic = new Float32Array(MW * MH);
async function getTile(x, y) {
  const f = path.join(CACHE, 'tiles', `${Z}_${x}_${y}.png`);
  if (!fs.existsSync(f)) {
    for (let t = 0; t < 5; t++) {
      try {
        const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
        if (!r.ok) throw new Error(r.status);
        fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); break;
      } catch (e) { if (t === 4) throw e; await new Promise(r => setTimeout(r, 500)); }
    }
  }
  return PNG.sync.read(fs.readFileSync(f));
}
{
  const jobs = [];
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) jobs.push([x, y]);
  let idx = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (idx < jobs.length) {
      const [x, y] = jobs[idx++];
      const p = await getTile(x, y);
      for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
        const o = (j * 256 + i) * 4;
        mosaic[((y - ty0) * 256 + j) * MW + (x - tx0) * 256 + i] = p.data[o] * 256 + p.data[o+1] + p.data[o+2] / 256 - 32768;
      }
    }
  }));
  console.log('tiles done', jobs.length);
}
function sampleMosaic(lon, lat) {
  const px = tx(lon) * 256 - tx0 * 256 - 0.5, py = ty(lat) * 256 - ty0 * 256 - 0.5;
  const x0 = Math.max(0, Math.min(MW - 2, Math.floor(px))), y0 = Math.max(0, Math.min(MH - 2, Math.floor(py)));
  const fx = Math.max(0, Math.min(1, px - x0)), fy = Math.max(0, Math.min(1, py - y0));
  const a = mosaic[y0 * MW + x0], b = mosaic[y0 * MW + x0 + 1], c = mosaic[(y0 + 1) * MW + x0], d = mosaic[(y0 + 1) * MW + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
// resample to our grid with 3x3 box supersampling
const hgt = new Float32Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  let s = 0;
  for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) s += sampleMosaic(lonOf(i + (a + 0.5) / 3), latOf(j + (b + 0.5) / 3));
  hgt[j * W + i] = s / 9;
}

// ---- 2. Districts ----
const adm2 = JSON.parse(fs.readFileSync(path.join(CACHE, 'x/npl_admin2_em.geojson')));
const adm0 = JSON.parse(fs.readFileSync(path.join(CACHE, 'x/npl_admin0_em.geojson')));
if (adm2.features.length !== 77) throw new Error('expected 77 districts, got ' + adm2.features.length);
const RW = W * SS, RH = H * SS;
function rasterize(rings, W2, H2, fn) {
  // even-odd scanline fill. rings: array of rings of [lon,lat]. fn(rowStart,x0,x1,y)
  const rows = new Map();
  for (const ring of rings) {
    for (let k = 0; k < ring.length - 1; k++) {
      let [ax, ay] = [xOf(ring[k][0]) * W2 / W, yOf(ring[k][1]) * H2 / H];
      let [bx, by] = [xOf(ring[k+1][0]) * W2 / W, yOf(ring[k+1][1]) * H2 / H];
      if (ay === by) continue;
      if (ay > by) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
      // pixel centers y+0.5 in [ay, by)
      const j0 = Math.max(0, Math.ceil(ay - 0.5)), j1 = Math.min(H2 - 1, Math.ceil(by - 0.5) - 1);
      for (let j = j0; j <= j1; j++) {
        const t = (j + 0.5 - ay) / (by - ay);
        const x = ax + t * (bx - ax);
        let r = rows.get(j); if (!r) rows.set(j, r = []); r.push(x);
      }
    }
  }
  for (const [j, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(W2 - 1, Math.ceil(xs[k+1] - 0.5) - 1);
      for (let i = i0; i <= i1; i++) fn(j * W2 + i);
    }
  }
}
const ids = new Uint8Array(RW * RH);
const feats = adm2.features.slice().sort((a, b) => a.properties.adm2_pcode.localeCompare(b.properties.adm2_pcode));
const districts = [];
feats.forEach((f, k) => {
  const id = k + 1;
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  rasterize(rings, RW, RH, (p) => { ids[p] = id; });
  districts.push({ id, pcode: f.properties.adm2_pcode, name: f.properties.adm2_name, province: f.properties.adm1_name, area: Math.round(f.properties.area_sqkm), cLat: +f.properties.center_lat.toFixed(4), cLon: +f.properties.center_lon.toFixed(4) });
});
// country mask check
const country = new Uint8Array(RW * RH);
for (const f of adm0.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const rings of polys) rasterize(rings, RW, RH, (p) => { country[p] = 1; });
}
let gap = 0, outside = 0, inN = 0;
for (let p = 0; p < ids.length; p++) { if (country[p]) { inN++; if (!ids[p]) gap++; } else if (ids[p]) outside++; }
console.log(`country px ${inN}, unassigned inside country ${gap}, district px outside country ${outside}`);
// fill gaps: nearest assigned neighbour (few sliver pixels) so every px inside Nepal maps to a district
if (gap) {
  for (let it = 0; it < 6; it++) {
    const src = ids.slice();
    for (let j = 1; j < RH - 1; j++) for (let i = 1; i < RW - 1; i++) {
      const p = j * RW + i;
      if (country[p] && !ids[p]) {
        const c = [src[p-1], src[p+1], src[p-RW], src[p+RW]].find(v => v);
        if (c) ids[p] = c;
      }
    }
  }
  let g2 = 0; for (let p = 0; p < ids.length; p++) if (country[p] && !ids[p]) g2++;
  console.log('gap after fill', g2);
  if (g2 > 0) throw new Error('unassigned pixels remain');
}
// stats per district
const stat = districts.map(() => ({ n: 0, minx: 1e9, miny: 1e9, maxx: -1, maxy: -1 }));
for (let j = 0; j < RH; j++) for (let i = 0; i < RW; i++) {
  const v = ids[j * RW + i]; if (!v) continue;
  const s = stat[v - 1]; s.n++; if (i < s.minx) s.minx = i; if (i > s.maxx) s.maxx = i; if (j < s.miny) s.miny = j; if (j > s.maxy) s.maxy = j;
}
// interior point (pole of inaccessibility via chamfer distance transform on ids)
const dist = new Float32Array(RW * RH);
{
  const INF = 1e9;
  for (let p = 0; p < dist.length; p++) {
    const v = ids[p]; if (!v) { dist[p] = 0; continue; }
    const i = p % RW, j = (p / RW) | 0;
    dist[p] = (i === 0 || j === 0 || i === RW - 1 || j === RH - 1 || ids[p-1] !== v || ids[p+1] !== v || ids[p-RW] !== v || ids[p+RW] !== v) ? 1 : INF;
  }
  const D1 = 1, D2 = 1.4142;
  for (let j = 1; j < RH - 1; j++) for (let i = 1; i < RW - 1; i++) { const p = j * RW + i; if (dist[p] === 0) continue; dist[p] = Math.min(dist[p], dist[p-1] + D1, dist[p-RW] + D1, dist[p-RW-1] + D2, dist[p-RW+1] + D2); }
  for (let j = RH - 2; j > 0; j--) for (let i = RW - 2; i > 0; i--) { const p = j * RW + i; if (dist[p] === 0) continue; dist[p] = Math.min(dist[p], dist[p+1] + D1, dist[p+RW] + D1, dist[p+RW+1] + D2, dist[p+RW-1] + D2); }
}
const best = districts.map(() => ({ d: -1, p: 0 }));
for (let p = 0; p < ids.length; p++) { const v = ids[p]; if (v && dist[p] > best[v-1].d) best[v-1] = { d: dist[p], p }; }
// HQs: district headquarters (author knowledge, see report)
const meta = districts.map((d, k) => ({ ...d }));
console.log('pcodes', districts.map(d => d.pcode).join(' '));
const out = { };

// ---- 3. airports (flatten terrain) ----
// Runway centre, axis and length from Overture/OSM aeroway=runway (release 2026-10-21.0); hdg = takeoff heading used by the game.
// All runways are OSM/Overture linestrings (Dhangadhi included). Lukla and Jomsom slopes are NOT in the data: published gradients, approximate.
const AIRPORTS = [
  { name: 'Tribhuvan Airport', city: 'Kathmandu', lat: 27.6955, lon: 85.3587, hdg: 202.1, lenM: 2751 },
  { name: 'Pokhara Airport', city: 'Pokhara', lat: 28.2006, lon: 83.9812, hdg: 39.9, lenM: 1342 },
  { name: 'Lukla Airport', city: 'Lukla', lat: 27.6868, lon: 86.7295, hdg: 239.8, lenM: 508, slope: 0.11 },
  { name: 'Biratnagar Airport', city: 'Biratnagar', lat: 26.4822, lon: 87.2637, hdg: 92.2, lenM: 1488 },
  { name: 'Gautam Buddha Airport', city: 'Bhairahawa', lat: 27.5048, lon: 83.4108, hdg: 98.7, lenM: 2993 },
  { name: 'Nepalgunj Airport', city: 'Nepalgunj', lat: 28.1035, lon: 81.666, hdg: 81.0, lenM: 1701 },
  { name: 'Dhangadhi Airport', city: 'Dhangadhi', lat: 28.7553, lon: 80.5833, hdg: 88.9, lenM: 1800 },
  { name: 'Janakpur Airport', city: 'Janakpur', lat: 26.7088, lon: 85.9218, hdg: 270.6, lenM: 1305 },
  { name: 'Simara Airport', city: 'Simara', lat: 27.1599, lon: 84.98, hdg: 12.1, lenM: 1188 },
  { name: 'Surkhet Airport', city: 'Birendranagar', lat: 28.5857, lon: 81.6358, hdg: 196.1, lenM: 1248 },
  { name: 'Jomsom Airport', city: 'Jomsom', lat: 28.7803, lon: 83.7229, hdg: 235.2, lenM: 762, slope: 0.05 },
  { name: 'Tumlingtar Airport', city: 'Tumlingtar', lat: 27.315, lon: 87.1943, hdg: 154.8, lenM: 1271 },
];
const RUNWAY_LEN_K = 4; // runway LENGTH is exaggerated by 4x (aircraft and widths by HUMAN_SCALE_K=40): at 40x a 2.7 km runway would be 110 km
for (const a of AIRPORTS) a.len = Math.max(36, Math.min(112, Math.round(a.lenM / 100 * RUNWAY_LEN_K)));
for (const a of AIRPORTS) {
  const x = xOf(a.lon), y = yOf(a.lat);
  // elevation: median of 5x5 around, then flatten a capsule along runway
  let s = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { s += hgt[(Math.round(y) + dj) * W + Math.round(x) + di]; c++; }
  a.elev = Math.round(s / c);
  const hr = a.hdg * Math.PI / 180; const dx = Math.sin(hr), dy = -Math.cos(hr); // grid: +x east, +y south
  const half = (a.len * 0.05 + 0.25) / CELL_KM; // half runway length (km) in cells
  const R0 = 0.75 / CELL_KM, R1 = 3.2 / CELL_KM;
  const lo = 1 + Math.ceil(half + R1);
  for (let j = Math.floor(y - lo); j <= Math.ceil(y + lo); j++) for (let i = Math.floor(x - lo); i <= Math.ceil(x + lo); i++) {
    if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const px = i + 0.5 - x, py = j + 0.5 - y;
    const t = Math.max(-half, Math.min(half, px * dx + py * dy));
    const d = Math.hypot(px - t * dx, py - t * dy);
    let w = d <= R0 ? 1 : d >= R1 ? 0 : 1 - (d - R0) / (R1 - R0);
    w = w * w * (3 - 2 * w);
    if (w > 0) { const p = j * W + i; hgt[p] = hgt[p] * (1 - w) + a.elev * w; }
  }
  a.x = +x.toFixed(2); a.y = +y.toFixed(2);
}

// ---- 4. rivers by flow accumulation (priority flood) ----
console.log('flow accumulation...');
const N = W * H;
const filled = new Float32Array(hgt);
const recv = new Int32Array(N).fill(-1);
const order = new Int32Array(N); let ocount = 0;
const closed = new Uint8Array(N);
// binary heap keyed by elevation
const heapK = new Float64Array(N + 16), heapV = new Int32Array(N + 16); let hn = 0;
function push(k, v) { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (heapK[p] <= k) break; heapK[i] = heapK[p]; heapV[i] = heapV[p]; i = p; } heapK[i] = k; heapV[i] = v; }
function pop() { const v = heapV[0], lastK = heapK[--hn], lastV = heapV[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && heapK[c+1] < heapK[c]) c++; if (heapK[c] >= lastK) break; heapK[i] = heapK[c]; heapV[i] = heapV[c]; i = c; } heapK[i] = lastK; heapV[i] = lastV; return v; }
for (let i = 0; i < W; i++) for (const j of [0, H - 1]) { const p = j * W + i; if (!closed[p]) { closed[p] = 1; push(filled[p], p); } }
for (let j = 0; j < H; j++) for (const i of [0, W - 1]) { const p = j * W + i; if (!closed[p]) { closed[p] = 1; push(filled[p], p); } }
const EPS = 0.002;
while (hn > 0) {
  const p = pop(); order[ocount++] = p;
  const i = p % W, j = (p / W) | 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
    const q = jj * W + ii; if (closed[q]) continue; closed[q] = 1;
    if (filled[q] <= filled[p]) filled[q] = filled[p] + EPS;
    recv[q] = p; push(filled[q], q);
  }
}
const acc = new Float32Array(N).fill(1);
for (let k = ocount - 1; k >= 0; k--) { const p = order[k], r = recv[p]; if (r >= 0) acc[r] += acc[p]; }
let maxAcc = 0; for (let p = 0; p < N; p++) if (acc[p] > maxAcc) maxAcc = acc[p];
console.log('max accumulation (cells)', maxAcc, '~km2', (maxAcc * CELL_KM * CELL_KM).toFixed(0));

// ---- 5. masks: river, dryness, urban ----
const river = new Float32Array(N);
const T = 900; // cells (~225 km2)
for (let p = 0; p < N; p++) if (acc[p] >= T) river[p] = 0.38 + 0.62 * Math.min(1, Math.log(acc[p] / T) / Math.log(250000 / T));
// widen big rivers slightly with a max-dilate where strength is high
const river2 = new Float32Array(river);
for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
  const p = j * W + i; const v = river[p]; if (v < 0.8) continue;
  for (const q of [p-1, p+1, p-W, p+W]) river2[q] = Math.max(river2[q], v * 0.8);
}
function blur3(src) { const o = new Float32Array(N); for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const p = j * W + i; o[p] = (src[p-W-1] + 2*src[p-W] + src[p-W+1] + 2*src[p-1] + 4*src[p] + 2*src[p+1] + src[p+W-1] + 2*src[p+W] + src[p+W+1]) / 16; } return o; }
const riverB = blur3(river2);
// lakes (hand placed, flattened) -> channel value 1.0 handled in shader as river>=0.98
const LAKES = [ ['Phewa', 28.2155, 83.9456, 1.9, 0.9, 20], ['Begnas', 28.1670, 84.0900, 1.4, 0.7, 20], ['Rara', 29.5250, 82.0850, 1.9, 1.2, 0], ['Phoksundo', 29.1990, 82.9500, 1.5, 0.7, 60], ['Tilicho', 28.6900, 83.8500, 1.5, 0.6, 90], ['Gosaikunda', 28.0840, 85.4150, 0.5, 0.3, 0] ];
const lake = new Float32Array(N);
for (const [nm, la, lo, rx, ry, rot] of LAKES) {
  const cx = xOf(lo), cy = yOf(la), r = rot * Math.PI / 180;
  const cx0 = Math.max(0, Math.floor(cx - 8)), cx1 = Math.min(W - 1, Math.ceil(cx + 8)), cy0 = Math.max(0, Math.floor(cy - 8)), cy1 = Math.min(H - 1, Math.ceil(cy + 8));
  let minH = 1e9; for (let j = cy0; j <= cy1; j++) for (let i = cx0; i <= cx1; i++) {
    const px = (i + 0.5 - cx) * CELL_KM, py = (j + 0.5 - cy) * CELL_KM; const u = (px * Math.cos(r) + py * Math.sin(r)) / rx, v = (-px * Math.sin(r) + py * Math.cos(r)) / ry;
    const e = Math.hypot(u, v); if (e < 1.0) { lake[j*W+i] = Math.max(lake[j*W+i], 1 - e * e); minH = Math.min(minH, hgt[j*W+i]); }
  }
  for (let j = cy0; j <= cy1; j++) for (let i = cx0; i <= cx1; i++) if (lake[j*W+i] > 0) hgt[j*W+i] = Math.min(hgt[j*W+i], minH + 0.5) - 0.5 * lake[j*W+i];
  console.log('lake', nm, 'surface ~', Math.round(minH), 'm');
}
const lakeB = blur3(lake);

const mask = new Uint8Array(N * 3);
// rain shadow: orographic ridge memory travelling north
const shadow = new Float32Array(N);
for (let i = 0; i < W; i++) { let ridge = 0; for (let j = H - 1; j >= 0; j--) { const h = Math.max(0, hgt[j * W + i]); ridge = Math.max(ridge - 22, h); shadow[j * W + i] = Math.max(0, Math.min(1, (ridge - h - 1200) / 3300)); } }
let sh = shadow; for (let k = 0; k < 3; k++) sh = blur3(sh);
// urban blobs
const CITIES = [ [27.705, 85.320, 7.5, 1.0, 5.5, 20], [27.667, 85.325, 4, 1.0, 3, 0], [27.672, 85.428, 3.5, 0.9, 2.5, 0], [28.210, 83.985, 5, 0.9, 3.5, 0], [26.455, 87.280, 5, 0.9, 5, 0], [27.010, 84.877, 4, 0.9, 4, 0], [27.700, 83.450, 4, 0.8, 4, 0], [27.680, 84.430, 4, 0.8, 4, 0], [28.050, 81.617, 3.5, 0.8, 3.5, 0], [28.690, 80.600, 3.5, 0.8, 3.5, 0], [26.720, 85.925, 3, 0.7, 3, 0], [26.660, 87.280, 3.5, 0.8, 3.5, 0], [26.810, 87.280, 3, 0.7, 3, 0], [27.430, 85.030, 3, 0.7, 3, 0], [28.595, 81.636, 2.5, 0.6, 2.5, 0], [26.660, 87.700, 3, 0.7, 3, 0], [26.800, 87.920, 3, 0.6, 3, 0], [27.510, 83.430, 3, 0.7, 3, 0], [28.160, 82.900, 2.5, 0.5, 2.5, 0], [28.680, 80.40, 2.5, 0.5, 2.5, 0] ];
const urban = new Float32Array(N);
for (const [la, lo, rx, k, ry, rot] of CITIES) {
  const cx = xOf(lo), cy = yOf(la), r = rot * Math.PI / 180, ext = Math.ceil(Math.max(rx, ry) * 2.5 / CELL_KM);
  for (let j = Math.max(0, Math.floor(cy - ext)); j <= Math.min(H - 1, Math.ceil(cy + ext)); j++) for (let i = Math.max(0, Math.floor(cx - ext)); i <= Math.min(W - 1, Math.ceil(cx + ext)); i++) {
    const px = (i + 0.5 - cx) * CELL_KM, py = (j + 0.5 - cy) * CELL_KM; const u = (px * Math.cos(r) + py * Math.sin(r)) / rx, v = (-px * Math.sin(r) + py * Math.cos(r)) / ry;
    const g = k * Math.exp(-(u * u + v * v) * 1.2); urban[j * W + i] = Math.min(1, urban[j * W + i] + g);
  }
}
for (let p = 0; p < N; p++) {
  const lon = lonOf(p % W);
  const dryLon = Math.max(0, Math.min(1, (88.6 - lon) / 9)) * 0.45;
  const dry = Math.max(0, Math.min(1, sh[p] * 0.95 + dryLon * (1 - sh[p] * 0.5)));
  const rv = Math.max(riverB[p] * 1.0, 0); const lk = lakeB[p];
  mask[p*3] = Math.round(Math.min(1, Math.max(rv, lk > 0.05 ? 0.97 + 0.03 * Math.min(1, lk * 2) : 0)) * 255);
  mask[p*3+1] = Math.round(dry * 255);
  mask[p*3+2] = Math.round(Math.min(1, urban[p]) * 255);
}
// the lake channel: >=0.97 => lake. river max strength must stay below
for (let p = 0; p < N; p++) if (lakeB[p] <= 0.05 && mask[p*3] > 245) mask[p*3] = 245;

const SUN = [0.78, 0.44, 0.44]; // legacy field kept in json; lighting is live in the game
// ---- 6. write outputs ----
// height: 16-bit in RG (units of 0.25 m, offset 200 m)
const HS = 4, HOFF = 200;
let hmin = 1e9, hmax = -1e9; const h16 = new Uint8Array(N * 3);
for (let p = 0; p < N; p++) {
  const v = Math.max(0, Math.min(65535, Math.round((hgt[p] + HOFF) * HS)));
  h16[p*3] = v >> 8; h16[p*3+1] = v & 255; h16[p*3+2] = 0;
  hmin = Math.min(hmin, hgt[p]); hmax = Math.max(hmax, hgt[p]);
}
let total = 0;
total += writePNG(path.join(OUT, 'height.png'), W, H, h16, 3, `elev ${hmin.toFixed(0)}..${hmax.toFixed(0)} m`);
total += writePNG(path.join(OUT, 'mask.png'), W, H, mask, 3, 'river/dry/urban');
total += writePNG(path.join(OUT, 'districts.png'), RW, RH, ids, 1, 'district ids');

const outDistricts = districts.map((d, k) => {
  const s = stat[k], b = best[k];
  const ip = { x: (b.p % RW + 0.5) / SS, y: (((b.p / RW) | 0) + 0.5) / SS };
  return { ...d, bbox: [s.minx / SS, s.miny / SS, (s.maxx + 1) / SS, (s.maxy + 1) / SS], px: s.n, ix: +ip.x.toFixed(2), iy: +ip.y.toFixed(2), inr: +(b.d / SS * CELL_KM).toFixed(1) };
});
const json = { version: 1, source: 'Survey Department of Nepal / UN OCHA COD-AB NPL v02 (2024-03-14), CC BY 3.0 IGO; elevation: AWS Terrain Tiles (Terrarium, z9)', grid: { sun: SUN, W, H, SS, lon0: LON0, lat1: LAT1, dlon: DLON, dlat: DLAT, cellKm: CELL_KM, hoff: HOFF, hscale: HS, latC: LAT_C }, airports: AIRPORTS, districts: outDistricts };
fs.writeFileSync(path.join(OUT, 'districts.json'), JSON.stringify(json));
total += fs.statSync(path.join(OUT, 'districts.json')).size;
console.log('data total KB', (total / 1024).toFixed(0));

// ---- 7. sanity report ----
console.log('\n=== SANITY REPORT ===');
console.log('districts', outDistricts.length);
const byArea = outDistricts.slice().sort((a, b) => b.area - a.area);
console.log('largest', byArea.slice(0, 3).map(d => `${d.name} ${d.area}`).join(', '), '| smallest', byArea.slice(-3).map(d => `${d.name} ${d.area}`).join(', '));
console.log('raster-area vs reported area (km2):');
const px2km = CELL_KM * CELL_KM / (SS * SS);
let worst = 0; for (const d of outDistricts) { const r = d.px * px2km; const e = Math.abs(r - d.area) / d.area; worst = Math.max(worst, e); }
console.log('worst relative deviation', (worst * 100).toFixed(1) + '%');
for (const d of outDistricts) console.log(`${String(d.id).padStart(2)} ${d.pcode} ${d.name.padEnd(18)} ${d.province.padEnd(14)} ${String(d.area).padStart(5)} km2`);
for (const a of AIRPORTS) { const v = ids[Math.floor(a.y * SS) * RW + Math.floor(a.x * SS)]; console.log('airport', a.name, a.elev + ' m', '->', v ? outDistricts[v - 1].name : 'OUTSIDE'); }
