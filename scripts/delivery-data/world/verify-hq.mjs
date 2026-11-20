// Cross-checks the district headquarters names in districts.json against Overture/OSM place names (places.json dumped from the Overture divisions theme).
// usage: node verify-hq.mjs <places.json>
import fs from 'fs'; import { PNG } from 'pngjs';
const dir = new URL('../../../games/delivery/data/', import.meta.url).pathname;
const J = JSON.parse(fs.readFileSync(dir + 'districts.json')); const png = PNG.sync.read(fs.readFileSync(dir + 'districts.png'));
const { W, H, SS, lon0, lat1, dlon, dlat } = J.grid, RW = W * SS;
const idAt = (lon, lat) => { const i = Math.floor((lon - lon0) / dlon * SS), j = Math.floor((lat1 - lat) / dlat * SS); if (i < 0 || j < 0 || i >= RW || j >= H * SS) return 0; return png.data[(j * RW + i) * 4]; };
const places = JSON.parse(fs.readFileSync(process.argv[2]));
const norm = s => s.toLowerCase().replace(/[-\s]*\d+$/, '').replace(/ (municipality|metropolitan city|sub-metropolitan city|rural municipality)$/, '').replace(/[^a-z]/g, '');
const alias = { Patan: ['lalitpur'], 'Dhading Besi': ['dhadingbesi', 'dhading'], Kusma: ['kushma'], Birendranagar: ['birendranagar', 'surkhet'], Mahendranagar: ['bhimdatta', 'mahendranagar'], Bhairahawa: ['siddharthanagar', 'bhairahawa', 'bhairahwa'], Chandragadhi: ['chandragadhi', 'chandragadi'], Putalibazar: ['putalibazar', 'putalibazaar'], Gaighat: ['gaighat', 'triyuga'], Salleri: ['salleri', 'solududhkunda'], Khalanga: ['khalanga'], Ghorahi: ['ghorahi'], Pokhara: ['pokhara'] };
let ok = 0, near = 0, miss = []; const res = [];
for (const d of J.districts) {
  const names = (alias[d.hq] || [norm(d.hq)]).map(norm), inside = [], other = [];
  for (const [n, sub, lon, lat] of places) { if (!n) continue; const k = norm(n); if (!names.some(x => k === x || k.startsWith(x))) continue; (idAt(lon, lat) === d.id ? inside : other).push(n); }
  if (inside.length) { ok++; res.push([d.name, d.hq, 'verified', inside[0]]); } else if (other.length) { near++; res.push([d.name, d.hq, 'name exists elsewhere', other[0]]); } else { miss.push(d.name + ': ' + d.hq); res.push([d.name, d.hq, 'not found']); }
}
console.log(`HQ names verified inside own district: ${ok}/77, name found in another district: ${near}, not found: ${miss.length}`);
console.log('not found:', miss.join('; '));
console.log(res.filter(r => r[2] !== 'verified').map(r => r.join(' | ')).join('\n'));
