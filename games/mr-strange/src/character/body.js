// The body surface: ONE smooth skin, not a pile of parts.
//
// A signed distance field of tapered capsules joined with a polynomial
// smooth-minimum, polygonised with Surface Nets. Each capsule carries a scale,
// so cross-sections can be elliptical (a torso is wider than it is deep).
// Normals come from the field gradient, so there are no creases where parts
// meet. The same primitives are exported as PRIMS so the cape can collide
// against exactly the shape that is drawn. No DOM, no rendering.

import * as THREE from 'three';
import { bones, NB, P, PRIMARY_CHILD, segA, segB, graphDist } from './rig.js';

export const SHELL = {
  k_core:   0.036, // fillet between the pieces of the torso
  k_head:   0.030, // smooth, sleek masked head
  k_limb:   0.022, // crisp limb & cuff/hem transitions
  k_join:   0.044, // fillet where a limb meets the body
  k_crotch: 0.012, // crisp V-crotch without webbing down the inner thighs
  cell:     0.0105,// polygonisation grid size
};

/* ---- primitive descriptors ------------------------------------------------ */
// {group, bone, a, b, r0, r1, s:[sx,sy,sz]}; `bone` is the bone that carries it
// when something (the cape) needs a rigid stand-in for the skin.
export const PRIMS = [];
function cap(group, bone, a, b, r0, r1, sx = 1, sy = 1, sz = 1) {
  const p = { group, bone, a, b, r0, r1, s: [sx, sy, sz], noCloth: false };
  PRIMS.push(p);
  return p;
}
function ball(group, bone, c, r, sx = 1, sy = 1, sz = 1) { return cap(group, bone, c, c, r, r, sx, sy, sz); }
const V  = (x, y, z) => new THREE.Vector3(x, y, z);
const at = (p, x, y, z) => new THREE.Vector3(p.x + x, p.y + y, p.z + z);

// --- torso, belt, collar and neck (sleek continuous V-taper, concave crotch arch) ---
cap('core', 'pelvis', V(0, 0.985,  0.004), V(0, 1.015,  0.004), 0.080, 0.090, 1.12, 1, 0.78);  // pelvis (raised so thighs form a concave V)
cap('core', 'pelvis', V(0, 0.960,  0.004), V(0, 0.975,  0.004), 0.088, 0.088, 1.10, 1, 0.80);  // subtle waistband
cap('core', 'spineA', V(0, 0.990,  0.004), V(0, 1.190,  0.000), 0.092, 0.106, 1.08, 1, 0.76);  // slim continuous waist
cap('core', 'chest',  V(0, 1.190,  0.000), V(0, 1.395, -0.004), 0.106, 0.152, 1.32, 1, 0.82);  // dramatic V-taper chest
cap('core', 'chest',  V(-0.118, 1.428, -0.008), V(0.118, 1.428, -0.008), 0.068, 0.068, 1, 0.78, 0.86); // broad shoulders
cap('core', 'chest',  V(0, 1.482, -0.006), V(0, 1.508, -0.004), 0.062, 0.056, 1.02, 1, 0.94); // collar base
cap('core', 'neck',   V(0, 1.405, -0.014), V(0, 1.575, -0.005), 0.048, 0.042);                 // slender neck

// --- head: smooth, sleek masked noir head ---
cap ('head', 'head', V(0, 1.688,  0.002), V(0, 1.726,  0.002), 0.088, 0.086, 0.85, 1, 1.08);  // cranium
cap ('head', 'head', V(0, 1.684,  0.018), V(0, 1.616,  0.036), 0.078, 0.044, 0.84, 1, 1.04).noCloth = true; // smooth faceplate / mask

// --- limbs (hands & dress shoes are sculpted meshes attached in avatar.js) ---
for (const n of ['L', 'R']) {
  const ua = P['upperArm' + n], fa = P['foreArm' + n];
  const hd = P['hand' + n];
  const g = 'arm' + n;
  ball(g, 'upperArm' + n, ua, 0.052, 1, 1, 0.95);                       // sleek deltoid
  cap (g, 'upperArm' + n, ua, fa, 0.044, 0.034);                        // slim upper sleeve
  ball(g, 'foreArm'  + n, fa, 0.036);                                   // elbow
  const sleeveEnd = hd.clone().lerp(fa, 0.20);
  cap (g, 'foreArm'  + n, fa, sleeveEnd, 0.038, 0.028);                 // slim jacket forearm sleeve

  const ul = P['upperLeg' + n], ll = P['lowerLeg' + n];
  const ft = P['foot' + n];
  const l = 'leg' + n;
  const hem = at(ft, 0, 0.026, 0.002);
  const hipIn = V(ul.x * 0.72, ul.y + 0.015, ul.z);
  cap (l, 'upperLeg' + n, hipIn, ll, 0.055, 0.042);                     // slender thigh, angled up into concave V-crotch
  ball(l, 'lowerLeg' + n, ll, 0.042);                                   // knee
  cap (l, 'lowerLeg' + n, ll, hem, 0.044, 0.038, 0.96, 1, 1.02);        // slender calf -> tailored trouser hem
  cap (l, 'foot'     + n, hem, at(ft, 0, -0.006, 0.000), 0.036, 0.030); // ankle plug inside shoe collar
}

// 11 floats per primitive: a/scale, b/scale, r0, r1, scale. Endpoints are
// pre-divided so the field evaluation is just a divide + capsule.
const STRIDE = 11;
function pack(group) {
  const list = PRIMS.filter(p => p.group === group);
  const f = new Float32Array(list.length * STRIDE);
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  list.forEach((p, i) => {
    const [sx, sy, sz] = p.s, o = i * STRIDE;
    f[o]     = p.a.x / sx; f[o + 1] = p.a.y / sy; f[o + 2] = p.a.z / sz;
    f[o + 3] = p.b.x / sx; f[o + 4] = p.b.y / sy; f[o + 5] = p.b.z / sz;
    f[o + 6] = p.r0; f[o + 7] = p.r1; f[o + 8] = sx; f[o + 9] = sy; f[o + 10] = sz;
    x0 = Math.min(x0, p.a.x - p.r0 * sx, p.b.x - p.r1 * sx);
    y0 = Math.min(y0, p.a.y - p.r0 * sy, p.b.y - p.r1 * sy);
    z0 = Math.min(z0, p.a.z - p.r0 * sz, p.b.z - p.r1 * sz);
    x1 = Math.max(x1, p.a.x + p.r0 * sx, p.b.x + p.r1 * sx);
    y1 = Math.max(y1, p.a.y + p.r0 * sy, p.b.y + p.r1 * sy);
    z1 = Math.max(z1, p.a.z + p.r0 * sz, p.b.z + p.r1 * sz);
  });
  f.box = [x0, y0, z0, x1, y1, z1];
  return f;
}
const F_CORE  = pack('core');
const F_HEAD  = pack('head');
const F_ARM_L = pack('armL'), F_ARM_R = pack('armR');
const F_LEG_L = pack('legL'), F_LEG_R = pack('legR');

function boxLB(x, y, z, b) {
  const dx = x < b[0] ? b[0] - x : x > b[3] ? x - b[3] : 0;
  const dy = y < b[1] ? b[1] - y : y > b[4] ? y - b[4] : 0;
  const dz = z < b[2] ? b[2] - z : z > b[5] ? z - b[5] : 0;
  return dx > dy ? (dx > dz ? dx : dz) : (dy > dz ? dy : dz);
}

function sdCapsule(px, py, pz, A, i) {
  const sx = A[i + 8], sy = A[i + 9], sz = A[i + 10];
  const qx = px / sx, qy = py / sy, qz = pz / sz;
  const ex = A[i + 3] - A[i], ey = A[i + 4] - A[i + 1], ez = A[i + 5] - A[i + 2];
  const wx = qx - A[i], wy = qy - A[i + 1], wz = qz - A[i + 2];
  const ee = ex * ex + ey * ey + ez * ez;
  let t = ee > 1e-12 ? (wx * ex + wy * ey + wz * ez) / ee : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - ex * t, dy = wy - ey * t, dz = wz - ez * t;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (A[i + 6] + (A[i + 7] - A[i + 6]) * t);
  return d * Math.min(sx, Math.min(sy, sz));   // back to (approximate) world units
}
// Polynomial smooth minimum: what turns a pile of capsules into one skin.
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}
function sdGroup(px, py, pz, A, k) {
  let d = sdCapsule(px, py, pz, A, 0);
  for (let i = STRIDE; i < A.length; i += STRIDE) d = smin(d, sdCapsule(px, py, pz, A, i), k);
  return d;
}
// Each limb is blended with the core and the results combined with a plain min,
// so armpits and hips get a soft fillet while left and right legs never fuse.
export function field(x, y, z) {
  const kl = SHELL.k_limb, kj = SHELL.k_join;
  let core = sdGroup(x, y, z, F_CORE, SHELL.k_core);
  if (boxLB(x, y, z, F_HEAD.box) < core + SHELL.k_head + 0.02) {
    core = smin(core, sdGroup(x, y, z, F_HEAD, SHELL.k_head), SHELL.k_head);
  }
  let d = core;
  if (boxLB(x, y, z, F_ARM_L.box) < d + kj + 0.04) {
    const e = smin(core, sdGroup(x, y, z, F_ARM_L, kl), kj);
    if (e < d) d = e;
  }
  if (boxLB(x, y, z, F_ARM_R.box) < d + kj + 0.04) {
    const e = smin(core, sdGroup(x, y, z, F_ARM_R, kl), kj);
    if (e < d) d = e;
  }
  const legL = boxLB(x, y, z, F_LEG_L.box) < d + kj + 0.04 ? sdGroup(x, y, z, F_LEG_L, kl) : 1e9;
  const legR = boxLB(x, y, z, F_LEG_R.box) < d + kj + 0.04 ? sdGroup(x, y, z, F_LEG_R, kl) : 1e9;
  if (legL < 1e8) { const e = smin(core, legL, 0.014); if (e < d) d = e; }
  if (legR < 1e8) { const e = smin(core, legR, 0.014); if (e < d) d = e; }
  // Legs are otherwise kept apart so they never fuse, but they genuinely do
  // meet at the very top; a tiny blend there closes the crevice cleanly.
  if (legL < 1e8 && legR < 1e8) {
    const e = smin(legL, legR, SHELL.k_crotch);
    if (e < d) d = e;
  }
  return d;
}

/* ---- Surface Nets -------------------------------------------------------- */
// 12 cell edges as pairs of corner ids; corner c = (c&1, (c>>1)&1, (c>>2)&1).
const SN_EDGES = [0,1, 2,3, 4,5, 6,7,  0,2, 1,3, 4,6, 5,7,  0,4, 1,5, 2,6, 3,7];

function polygonise() {
  // bounds straight off the primitives, padded for the blend swell
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const A of [F_CORE, F_HEAD, F_ARM_L, F_ARM_R, F_LEG_L, F_LEG_R]) {
    for (let i = 0; i < A.length; i += STRIDE) {
      for (let c = 0; c < 3; c++) {
        const sc = A[i + 8 + c];                       // endpoints are pre-divided
        lo[c] = Math.min(lo[c], (A[i + c] - A[i + 6]) * sc, (A[i + 3 + c] - A[i + 7]) * sc);
        hi[c] = Math.max(hi[c], (A[i + c] + A[i + 6]) * sc, (A[i + 3 + c] + A[i + 7]) * sc);
      }
    }
  }
  const cell = SHELL.cell, pad = SHELL.k_join + cell * 2;
  for (let c = 0; c < 3; c++) { lo[c] -= pad; hi[c] += pad; }

  const nx = Math.ceil((hi[0] - lo[0]) / cell), ny = Math.ceil((hi[1] - lo[1]) / cell),
        nz = Math.ceil((hi[2] - lo[2]) / cell);
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1;

  const vals = new Float32Array(NX * NY * NZ);
  for (let i = 0, o = 0; i < NX; i++) {
    const x = lo[0] + i * cell;
    for (let j = 0; j < NY; j++) {
      const y = lo[1] + j * cell;
      for (let k = 0; k < NZ; k++, o++) vals[o] = field(x, y, lo[2] + k * cell);
    }
  }
  const vAt = (i, j, k) => vals[(i * NY + j) * NZ + k];

  // pass 1: one vertex per cell that the surface crosses
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const px = [], py = [], pz = [];
  const cv = new Float64Array(8);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vAt(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const c0 = SN_EDGES[e * 2], c1 = SN_EDGES[e * 2 + 1];
          const v0 = cv[c0], v1 = cv[c1];
          if ((v0 < 0) === (v1 < 0)) continue;
          const t = v0 / (v0 - v1);
          sx += (c0 & 1) + t * ((c1 & 1) - (c0 & 1));
          sy += ((c0 >> 1) & 1) + t * (((c1 >> 1) & 1) - ((c0 >> 1) & 1));
          sz += ((c0 >> 2) & 1) + t * (((c1 >> 2) & 1) - ((c0 >> 2) & 1));
          n++;
        }
        cellVert[(i * ny + j) * nz + k] = px.length;
        px.push(lo[0] + (i + sx / n) * cell);
        py.push(lo[1] + (j + sy / n) * cell);
        pz.push(lo[2] + (k + sz / n) * cell);
      }
    }
  }

  // pass 2: quad per sign-changing grid edge, joining the 4 cells around it
  const index = [];
  const cAt = (i, j, k) => cellVert[(i * ny + j) * nz + k];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      for (let k = 0; k < NZ; k++) {
        const v0 = vAt(i, j, k), in0 = v0 < 0;
        if (i < nx && j > 0 && k > 0 && j < NY - 1 && k < NZ - 1 && in0 !== (vAt(i + 1, j, k) < 0))
          quad(cAt(i, j - 1, k - 1), cAt(i, j, k - 1), cAt(i, j, k), cAt(i, j - 1, k), in0);
        if (j < ny && i > 0 && k > 0 && i < NX - 1 && k < NZ - 1 && in0 !== (vAt(i, j + 1, k) < 0))
          quad(cAt(i - 1, j, k - 1), cAt(i, j, k - 1), cAt(i, j, k), cAt(i - 1, j, k), !in0);
        if (k < nz && i > 0 && j > 0 && i < NX - 1 && j < NY - 1 && in0 !== (vAt(i, j, k + 1) < 0))
          quad(cAt(i - 1, j - 1, k), cAt(i, j - 1, k), cAt(i, j, k), cAt(i - 1, j, k), in0);
      }
    }
  }

  // --- relax ---
  // Surface Nets places one vertex per cell, which facets badly where
  // curvature is high relative to the grid (fingertips, toe caps). Averaging
  // each vertex toward its neighbours and then projecting it back onto the
  // isosurface evens the triangles out without rounding the shape off.
  {
    const n = px.length;
    const sumX = new Float32Array(n), sumY = new Float32Array(n), sumZ = new Float32Array(n);
    const cnt = new Uint16Array(n);
    const h2 = cell * 0.5;
    for (let pass = 0; pass < 2; pass++) {
      sumX.fill(0); sumY.fill(0); sumZ.fill(0); cnt.fill(0);
      for (let t = 0; t < index.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = index[t + e], b = index[t + (e + 1) % 3];
          sumX[a] += px[b]; sumY[a] += py[b]; sumZ[a] += pz[b]; cnt[a]++;
          sumX[b] += px[a]; sumY[b] += py[a]; sumZ[b] += pz[a]; cnt[b]++;
        }
      }
      for (let v = 0; v < n; v++) {
        if (!cnt[v]) continue;
        let x = px[v] + (sumX[v] / cnt[v] - px[v]) * 0.5;
        let y = py[v] + (sumY[v] / cnt[v] - py[v]) * 0.5;
        let z = pz[v] + (sumZ[v] / cnt[v] - pz[v]) * 0.5;
        for (let k = 0; k < 2; k++) {              // Newton steps back to d = 0
          const d = field(x, y, z);
          const gx = field(x + h2, y, z) - field(x - h2, y, z);
          const gy = field(x, y + h2, z) - field(x, y - h2, z);
          const gz = field(x, y, z + h2) - field(x, y, z - h2);
          const L = Math.hypot(gx, gy, gz);
          if (L < 1e-9) break;
          const step = d / (L / cell);             // gradient is over a cell width
          x -= gx / L * step; y -= gy / L * step; z -= gz / L * step;
        }
        px[v] = x; py[v] = y; pz[v] = z;
      }
    }
  }

  // normals from the field gradient: smooth by construction
  const count = px.length;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const h = cell * 0.5;
  for (let v = 0; v < count; v++) {
    const x = px[v], y = py[v], z = pz[v];
    position[v * 3] = x; position[v * 3 + 1] = y; position[v * 3 + 2] = z;
    const gx = field(x + h, y, z) - field(x - h, y, z);
    const gy = field(x, y + h, z) - field(x, y - h, z);
    const gz = field(x, y, z + h) - field(x, y, z - h);
    const L = Math.hypot(gx, gy, gz) || 1;
    normal[v * 3] = gx / L; normal[v * 3 + 1] = gy / L; normal[v * 3 + 2] = gz / L;
  }

  // The winding above depends on the edge bookkeeping being right; rather than
  // trust it, measure it: compare a sample of face normals against the field
  // gradient and flip the whole buffer if they disagree.
  let agree = 0, tested = 0;
  for (let t = 0; t < index.length && tested < 400; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = position[b] - position[a], uy = position[b + 1] - position[a + 1], uz = position[b + 2] - position[a + 2];
    const wx = position[c] - position[a], wy = position[c + 1] - position[a + 1], wz = position[c + 2] - position[a + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const d = fx * normal[a] + fy * normal[a + 1] + fz * normal[a + 2];
    if (d !== 0) { tested++; if (d > 0) agree++; }
  }
  if (tested > 0 && agree < tested * 0.5) {
    for (let t = 0; t < index.length; t += 3) { const s = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = s; }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setIndex(new THREE.BufferAttribute(
    count > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
  return g;
}

export const shellGeo = polygonise();

/* ---- moulding seam, computed per vertex in the nearest limb's own frame --- */
{
  const pos = shellGeo.getAttribute('position');
  const seam = new Float32Array(pos.count);
  const limbs = [];
  for (let i = 0; i < NB; i++) if (PRIMARY_CHILD[bones[i].name]) limbs.push(i);
  const axis = new THREE.Vector3(), rad = new THREE.Vector3(), ref = new THREE.Vector3(),
        perp = new THREE.Vector3(), v = new THREE.Vector3(), cp = new THREE.Vector3(),
        rel = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let best = limbs[0], bestD = Infinity, bestT = 0;
    for (const b of limbs) {
      axis.subVectors(segB[b], segA[b]);
      const len2 = axis.lengthSq();
      rel.subVectors(v, segA[b]);
      let t = len2 > 1e-9 ? rel.dot(axis) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = cp.copy(segA[b]).addScaledVector(axis, t).distanceTo(v);
      if (d < bestD) { bestD = d; best = b; bestT = t; }
    }
    axis.subVectors(segB[best], segA[best]);
    const segLen = axis.length();
    if (segLen < 1e-6) { seam[i] = Math.PI * 0.5; continue; }
    axis.divideScalar(segLen);
    cp.copy(segA[best]).addScaledVector(axis, bestT * segLen);
    rad.subVectors(v, cp);
    rad.addScaledVector(axis, -rad.dot(axis));          // radial component only
    ref.copy(X).addScaledVector(axis, -X.dot(axis));    // seam meridian reference
    if (ref.lengthSq() < 0.04) ref.copy(Z).addScaledVector(axis, -Z.dot(axis));
    ref.normalize();
    perp.crossVectors(axis, ref);
    const theta = Math.abs(Math.atan2(rad.dot(perp), rad.dot(ref)));
    seam[i] = Math.min(theta, Math.PI - theta);
  }
  shellGeo.setAttribute('aSeam', new THREE.BufferAttribute(seam, 1));
}

/* ==========================================================================
   Skinning: distance-to-bone-segment weights, limited to a local neighbourhood
   of the skeleton so limbs never bleed into each other.
   ========================================================================== */
{
  const distToSeg = (px, py, pz, a, b) => {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = px - a.x, apy = py - a.y, apz = pz - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 1e-9 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // How thick is the body around each bone? Sampling the field at the middle of
  // each bone segment gives its local half-thickness for free.
  //
  // This matters: in an A-pose the thin upper arm passes right alongside the fat
  // ribcage, so a chest-wall vertex is nearer the ARM's axis than the spine's.
  // Binding by axis distance hands the whole chest wall to the arm. Measuring to
  // each bone's surface instead puts it back on the chest where it belongs.
  const boneR = new Float32Array(NB);
  {
    const m = new THREE.Vector3();
    for (let i = 0; i < NB; i++) {
      m.addVectors(segA[i], segB[i]).multiplyScalar(0.5);
      boneR[i] = Math.max(0, -field(m.x, m.y, m.z));
    }
  }

  const pos = shellGeo.getAttribute('position');
  const vCount = pos.count;
  const skinIndex  = new Uint16Array(vCount * 4);
  const skinWeight = new Float32Array(vCount * 4);
  const d = new Float32Array(NB);
  const MAX_HOPS = 2;      // skeleton-graph radius a vertex may be influenced from
  const FALLOFF  = 4.0;    // higher = tighter, more rigid binding
  const EPS      = 0.015;  // m, softens the singularity on the bone axis
  const REL_CUT  = 1.60;   // ignore bones this much further away than the nearest
  const SURF_BIAS = 0.92;  // 1 = pure surface distance, 0 = pure axis distance

  const bi = [0, 0, 0, 0], bw = [0, 0, 0, 0];
  for (let v = 0; v < vCount; v++) {
    const vx = pos.getX(v), vy = pos.getY(v), vz = pos.getZ(v);
    let near = 0, nearD = Infinity;
    for (let i = 0; i < NB; i++) {
      d[i] = Math.max(0, distToSeg(vx, vy, vz, segA[i], segB[i]) - boneR[i] * SURF_BIAS);
      if (d[i] < nearD) { nearD = d[i]; near = i; }
    }
    const hops = graphDist[near];
    bi[0] = bi[1] = bi[2] = bi[3] = 0;
    bw[0] = bw[1] = bw[2] = bw[3] = 0;
    const cutoff = nearD * REL_CUT + 0.050;   // keeps the far hip off the midline
    for (let i = 0; i < NB; i++) {
      if (hops[i] < 0 || hops[i] > MAX_HOPS || d[i] > cutoff) continue;
      const w = Math.pow(1 / (d[i] + EPS), FALLOFF);
      for (let s = 0; s < 4; s++) {                 // insertion sort into the top-4
        if (w > bw[s]) {
          for (let t = 3; t > s; t--) { bw[t] = bw[t - 1]; bi[t] = bi[t - 1]; }
          bw[s] = w; bi[s] = i;
          break;
        }
      }
    }
    const sum = bw[0] + bw[1] + bw[2] + bw[3];
    const inv = sum > 0 ? 1 / sum : 0;
    for (let s = 0; s < 4; s++) {
      skinIndex[v * 4 + s]  = bi[s];
      skinWeight[v * 4 + s] = sum > 0 ? bw[s] * inv : (s === 0 ? 1 : 0);
    }
  }
  shellGeo.setAttribute('skinIndex',  new THREE.BufferAttribute(skinIndex, 4));
  shellGeo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  shellGeo.computeBoundingSphere();
}

/* ---- dress shoe metrics (matched to the sculpted shoe mesh in avatar.js) ---
   The foot roll in motion.js needs to know exactly where the sole, toe and heel
   are relative to the ankle (footL). ---------------------------------------- */
export const SHOE = { ankleH: 0.085, toe: 0.172, heel: 0.068 };
