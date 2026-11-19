// The dark forest: procedural trees, built once, drawn as instances.
//
//   * Three hand-grown species (spruce, gnarled, dead). Each is ONE merged,
//     vertex-coloured geometry with flat shading: no textures, no images.
//   * A fourth "far" shape (trunk + two cones, ~40 tris) stands in at distance.
//   * The forest is cut into chunks. Every chunk owns one InstancedMesh per
//     species plus one for the far shape, so frustum culling works per chunk
//     (and the tiny shadow camera only ever draws the chunks around the hero).
//     Each frame only a handful of chunk visibility flags change.
//   * Sway lives in the vertex shader (a time uniform, no CPU per tree).
//   * Trunks near the clearing become thin collision boxes so you can't walk
//     through them (kept to a few dozen: collision scans are linear).

import * as THREE from 'three';
import { level, makeDitherMaterial } from './level.js';

export const forestFx = { uTime: { value: 0 } };

const AREA = 120;               // forest spans -AREA..AREA on x and z
const CHUNK = 28;
const CELL = 3.4;              // jittered-grid spacing: ~1 tree per cell
const NEAR = 34;               // chunks closer than this to the hero use detailed trees
const COLLIDE_R = 0;           // the forest stands far beyond the city: no trunk colliders
const CLEAR = { x: 0, z: 6, r: 94, fade: 14 };   // knights live here: no trees inside r, thinning out to r + fade

// ---- tiny deterministic RNG ---------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---- geometry builder: flat arrays, merged at the end ---------------------------
class Mesher {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, ca, cb, cc) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.col.push(...ca, ...(cb || ca), ...(cc || ca));
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();                   // non-indexed, so normals come out flat
    g.computeBoundingSphere();
    return g;
  }
}

const v3 = (x, y, z) => [x, y, z];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const BARK = [0.055, 0.050, 0.055];
const BARK_PALE = [0.11, 0.11, 0.12];
const NEEDLE = [0.015, 0.042, 0.045];
const NEEDLE_B = [0.025, 0.058, 0.062];

// An open tapered prism from p0 (radius r0) to p1 (radius r1).
function tube(m, p0, p1, r0, r1, sides, col0, col1) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const ax = dx / len, ay = dy / len, az = dz / len;
  // any vector not parallel to the axis, then an orthonormal frame
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(ay) > 0.9) { ux = 1; uy = 0; }
  let sx = ay * uz - az * uy, sy = az * ux - ax * uz, sz = ax * uy - ay * ux;
  const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const tx = ay * sz - az * sy, ty = az * sx - ax * sz, tz = ax * sy - ay * sx;
  const ring = (p, r) => {
    const out = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
      out.push(v3(p[0] + sx * c + tx * s, p[1] + sy * c + ty * s, p[2] + sz * c + tz * s));
    }
    return out;
  };
  const A = ring(p0, r0), B = ring(p1, r1);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    m.tri(A[i], A[j], B[j], col0, col0, col1);
    if (r1 > 0.004) m.tri(A[i], B[j], B[i], col0, col1, col1);
  }
}

// A ragged cone (needle tier): apex above a jittered base ring, base slightly drooped.
function tier(m, cx, cy, cz, radius, height, sides, rnd, dark, light) {
  const apex = v3(cx, cy + height, cz);
  const ring = [];
  const off = rnd() * 6.28;
  for (let i = 0; i < sides; i++) {
    const a = off + (i / sides) * Math.PI * 2;
    const r = radius * (0.72 + rnd() * 0.5);
    ring.push(v3(cx + Math.cos(a) * r, cy - radius * 0.12 * (0.5 + rnd()), cz + Math.sin(a) * r));
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    m.tri(ring[i], ring[j], apex, dark, dark, light);
    m.tri(ring[j], ring[i], v3(cx, cy - radius * 0.05, cz), shade(dark, 0.5));   // dark underside
  }
}

// ---- species -----------------------------------------------------------------
function spruce(seed) {
  const rnd = rng(seed), m = new Mesher();
  const H = 9 + rnd() * 3.5, trunkR = 0.20 + rnd() * 0.06;
  tube(m, v3(0, 0, 0), v3(0.05, H, 0.03), trunkR, 0.02, 6, BARK, BARK_PALE);
  const tiers = 7 + (rnd() * 2 | 0);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = H * (0.20 + t * 0.70);
    const r = (1.0 - t * 0.82) * (2.1 + rnd() * 0.4);
    tier(m, 0.04 * t, y, 0.02 * t, r, r * 1.25 + 0.5, 7, rnd, shade(NEEDLE, 0.8 + t * 0.4), shade(NEEDLE_B, 0.9 + t * 0.5));
  }
  // bare lower trunk: a few dead stubs
  for (let i = 0; i < 4; i++) {
    const a = rnd() * 6.28, y = 0.8 + rnd() * 1.6;
    tube(m, v3(0, y, 0), v3(Math.cos(a) * 0.8, y + 0.25, Math.sin(a) * 0.8), 0.045, 0.01, 4, BARK, BARK);
  }
  return { geo: m.build(), height: H + 0.5, trunkR };
}

function branch(m, rnd, p, dir, len, r, depth, tips, col) {
  const end = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len];
  tube(m, p, end, r, r * 0.62, depth >= 2 ? 5 : 3, col, shade(col, 1.25));
  if (depth === 0) { tips.push(end); return; }
  const kids = 2;
  for (let i = 0; i < kids; i++) {
    // fan the child away from the parent, bias downward then upward (a crooked, drooping look)
    const a = rnd() * 6.28, spread = 0.5 + rnd() * 0.7;
    let d = [dir[0] + Math.cos(a) * spread, dir[1] + (rnd() - 0.35) * 0.6, dir[2] + Math.sin(a) * spread];
    const l = Math.hypot(d[0], d[1], d[2]); d = [d[0] / l, d[1] / l, d[2] / l];
    branch(m, rnd, lerp3(p, end, 0.55 + rnd() * 0.45), d, len * (0.62 + rnd() * 0.15), r * 0.55, depth - 1, tips, col);
  }
  tips.push(end);
}

function gnarled(seed, dead) {
  const rnd = rng(seed), m = new Mesher();
  const H = 6.5 + rnd() * 3, trunkR = 0.26 + rnd() * 0.1;
  // trunk: three kinked segments, thick at the root with a little flare
  let p = v3(0, 0, 0);
  const pts = [p];
  for (let i = 1; i <= 3; i++) {
    p = v3(p[0] + (rnd() - 0.5) * 0.7, (H * 0.55) * (i / 3) * 1.0, p[2] + (rnd() - 0.5) * 0.7);
    pts.push(p);
  }
  for (let i = 0; i < 3; i++) {
    const r0 = trunkR * (1 - i * 0.28), r1 = trunkR * (1 - (i + 1) * 0.28);
    tube(m, pts[i], pts[i + 1], r0 * (i === 0 ? 1.0 : 1), r1, 6, BARK, BARK_PALE);
  }
  // root flare
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + rnd();
    tube(m, v3(Math.cos(a) * trunkR * 1.9, -0.05, Math.sin(a) * trunkR * 1.9), v3(0, 0.6, 0), 0.07, trunkR * 0.8, 4, BARK, BARK);
  }
  const tips = [], top = pts[3];
  const nb = 3 + (rnd() * 2 | 0);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * 6.28 + rnd() * 0.8, up = 0.35 + rnd() * 0.9;
    let d = [Math.cos(a), up, Math.sin(a)]; const l = Math.hypot(...d); d = d.map(x => x / l);
    const from = lerp3(pts[1 + (i % 3)], top, rnd());
    branch(m, rnd, from, d, 1.7 + rnd() * 1.5, 0.09 + rnd() * 0.05, 2, tips, BARK);
  }
  if (!dead) {                                  // sparse, dark, ragged needle clumps at the tips
    for (let i = 0; i < tips.length; i += 2) {
      const t = tips[i], r = 0.55 + rnd() * 0.5;
      tier(m, t[0], t[1] - 0.15, t[2], r, r * 0.9, 5, rnd, shade(NEEDLE, 0.9), shade(NEEDLE_B, 1.1));
    }
  }
  return { geo: m.build(), height: H + 2.4, trunkR };
}

// The distant stand-in: a trunk and two cones. ~40 triangles.
function farTree(seed) {
  const rnd = rng(seed), m = new Mesher(), H = 10;
  tube(m, v3(0, 0, 0), v3(0, H * 0.8, 0), 0.22, 0.05, 4, BARK, BARK);
  tier(m, 0, H * 0.2, 0, 2.0, 5.6, 5, rnd, shade(NEEDLE, 0.9), NEEDLE_B);
  tier(m, 0, H * 0.52, 0, 1.3, 4.2, 5, rnd, shade(NEEDLE, 1.0), NEEDLE_B);
  return { geo: m.build(), height: H + 1, trunkR: 0.22 };
}

// ---- placement ---------------------------------------------------------------
function placeTrees() {
  const rnd = rng(9001), out = [];
  for (let gx = -AREA; gx < AREA; gx += CELL) {
    for (let gz = -AREA; gz < AREA; gz += CELL) {
      const x = gx + rnd() * CELL, z = gz + rnd() * CELL;
      const dc = Math.hypot(x - CLEAR.x, (z - CLEAR.z) * 0.9);
      const keep = dc < CLEAR.r ? 0 : dc < CLEAR.r + CLEAR.fade ? (dc - CLEAR.r) / CLEAR.fade : 1;
      // low-frequency thinning makes glades and thickets instead of an even grid
      const clump = 0.5 + 0.5 * Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.7);
      const roll = rnd();
      if (roll > keep * (0.50 + clump * 0.45)) continue;
      const kind = rnd();
      out.push({
        x, z,
        species: kind < 0.35 ? 0 : kind < 0.72 ? 1 : 2,          // spruce, gnarled, dead
        yaw: rnd() * 6.28,
        s: 0.8 + rnd() * 0.55,
        lean: (rnd() - 0.5) * 0.07,
      });
    }
  }
  return out;
}

// ---- build -------------------------------------------------------------------
export function buildForest(scene) {
  const species = [spruce(11), gnarled(23, false), gnarled(37, true)];
  const far = farTree(5);
  const mat = makeDitherMaterial({ vertexColors: true, color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.18, sway: forestFx.uTime });

  const trees = placeTrees();
  const nChunks = Math.ceil((AREA * 2) / CHUNK);
  const buckets = new Map();
  for (const t of trees) {
    const cx = Math.min(nChunks - 1, Math.floor((t.x + AREA) / CHUNK));
    const cz = Math.min(nChunks - 1, Math.floor((t.z + AREA) / CHUNK));
    const k = cz * nChunks + cx;
    if (!buckets.has(k)) buckets.set(k, { cx, cz, list: [] });
    buckets.get(k).list.push(t);
  }

  const dummy = new THREE.Object3D();
  const chunks = [];
  for (const { cx, cz, list } of buckets.values()) {
    const chunk = { x: -AREA + (cx + 0.5) * CHUNK, z: -AREA + (cz + 0.5) * CHUNK, hi: [], lo: null };
    for (let sp = 0; sp < species.length; sp++) {
      const mine = list.filter(t => t.species === sp);
      if (!mine.length) continue;
      chunk.hi.push(instanced(species[sp].geo, mat, mine, dummy, true));
    }
    chunk.lo = instanced(far.geo, mat, list, dummy, false);
    chunk.lo.visible = false;
    for (const mesh of chunk.hi) scene.add(mesh);
    scene.add(chunk.lo);
    chunks.push(chunk);
  }

  // trunk colliders: only near the clearing, tall enough that nothing climbs them
  let colliders = 0;
  for (const t of trees) {
    if (Math.hypot(t.x - CLEAR.x, t.z - CLEAR.z) > COLLIDE_R) continue;
    const r = species[t.species].trunkR * t.s * 0.8 + 0.06;
    level.boxes.push({ x0: t.x - r, x1: t.x + r, z0: t.z - r, z1: t.z + r, y0: 0, y1: 9, color: 0, cap: false, mesh: false });
    colliders++;
  }

  const update = (hero, time) => {
    forestFx.uTime.value = time;
    for (const c of chunks) {
      const near = Math.hypot(c.x - hero.x, c.z - hero.z) < NEAR + CHUNK * 0.5;
      if (c.near === near) continue;
      c.near = near;
      for (const m of c.hi) m.visible = near;
      c.lo.visible = !near;
    }
  };
  update({ x: 0, z: 0 }, 0);
  return { update, treeCount: trees.length, colliders, chunks: chunks.length };
}

function instanced(geo, mat, list, dummy, castShadow) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    dummy.position.set(t.x, 0, t.z);
    dummy.rotation.set(t.lean, t.yaw, -t.lean * 0.6);
    dummy.scale.set(t.s, t.s * (0.9 + (t.yaw % 1) * 0.25), t.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = castShadow;
  mesh.receiveShadow = castShadow;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
