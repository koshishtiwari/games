// The cape: a Verlet cloth driven by the wind field.
//
//  * Particles on a 16 x 22 grid, structural + shear + (soft) bend links solved
//    with Gauss-Seidel, plus a rope-style length cap down each column so the
//    sheet cannot stretch under a gale.
//  * Wind acts through AERODYNAMIC DRAG on the air velocity RELATIVE to each
//    particle (wind - particle velocity). Pressure drag across the face is
//    quadratic, drag along the face is small, so a sheet square-on to the wind
//    billows and one edge-on streams. Because the relative velocity is used,
//    running into the wind, standing in a gust and a falling jump all come out
//    of the same equation, with no special cases and natural damping.
//  * The collar rows follow the skinned shoulders (stiffest at the throat,
//    looser down the back), so the cape always sits ON the shoulders instead of
//    being blown off or poked through them.
//  * Collision uses the SAME primitives the body surface is built from (see
//    body.js PRIMS), each riding its own bone, so what is collided is what is
//    drawn. The rest shape is also pushed out of the body field at load, which
//    is what removes the collar and shoulder clipping.
//
// Everything is typed arrays and scratch objects: zero allocation per frame.

import * as THREE from 'three';
import { model, B, boneIndex, skeleton } from './rig.js';
import { PRIMS, field } from './body.js';
import { wind } from '../world/wind.js';

export const CAPE_CFG = {
  gravity:    -11.0,
  damping:    0.996,   // velocity kept per step; most damping is aerodynamic
  iterations: 5,       // relaxation passes per substep
  stretch:    1.03,    // max stretch of a column link, from the top down
  cn:         0.75,    // pressure drag across the face (accel per (m/s)^2)
  ct:         0.16,    // skin drag along the face (accel per m/s)
  maxAccel:   58.0,    // m/s^2 (~6 g): streams the cape out near-horizontal, stays solvable
  maxStep:    0.090,   // m a particle may travel in one substep (no tunnelling)
  margin:     0.024,   // cloth thickness kept clear of the skin
  thinExtra:  0.016,   // extra for limbs thinner than the particle spacing (cloth sags between particles)
  windScale:  1.0,     // global multiplier, handy for tuning
  step:       1 / 60,
  maxSteps:   3,
};

const NU = 16, NV = 22;               // across, down
const N = NU * NV;
const idx = (u, v) => v * NU + u;
// How firmly each row is held to the skinned shoulders (row 0 is fastened).
const FOLLOW = [1, 0.55, 0.34, 0.20, 0.11, 0.06, 0.03];

export function createCape(scene) {
  const C = CAPE_CFG;

  /* ---- rest shape, authored in chest-bone space ---- */
  const lx = new Float32Array(N), ly = new Float32Array(N), lz = new Float32Array(N);
  for (let v = 0; v < NV; v++) {
    const t = v / (NV - 1);
    const wrap = 1.72 * (1 - 0.46 * t);            // radians of wrap, each side
    const R = 0.125 + 0.330 * Math.pow(t, 0.55);   // neck ring -> over the shoulder -> hanging
    const drop = Math.pow(t, 1.45);                // rows bunch at the top to cover the shoulder
    for (let u = 0; u < NU; u++) {
      const c = (u / (NU - 1)) * 2 - 1;
      const th = c * wrap;
      const i = idx(u, v);
      lx[i] = Math.sin(th) * R;
      ly[i] = 0.210 - 1.215 * drop;
      lz[i] = -Math.cos(th) * R - 0.025 * t;
    }
  }

  /* ---- particle state ---- */
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  const qx = new Float32Array(N), qy = new Float32Array(N), qz = new Float32Array(N);   // previous
  const nx = new Float32Array(N), ny = new Float32Array(N), nz = new Float32Array(N);   // normals
  const wsx = new Float32Array(N), wsy = new Float32Array(N), wsz = new Float32Array(N); // wind per particle
  const pinned = new Uint8Array(N);
  const fw = new Float32Array(N);
  for (let v = 0; v < NV; v++) for (let u = 0; u < NU; u++) fw[idx(u, v)] = v < FOLLOW.length ? FOLLOW[v] : 0;
  for (let u = 0; u < NU; u++) pinned[idx(u, 0)] = 1;

  /* ---- sanitise the rest shape against the body, then measure it ---- */
  model.updateMatrixWorld(true);                 // bind pose: world == bind space
  const restX = new Float32Array(N), restY = new Float32Array(N), restZ = new Float32Array(N);
  {
    const v3 = new THREE.Vector3();
    const m = C.margin + 0.004, h = 0.004;
    for (let i = 0; i < N; i++) {
      v3.set(lx[i], ly[i], lz[i]).applyMatrix4(B.chest.matrixWorld);
      let x = v3.x, y = v3.y, z = v3.z;
      for (let k = 0; k < 8; k++) {
        const d = field(x, y, z);
        if (d >= m) break;
        let gx = field(x + h, y, z) - field(x - h, y, z);
        let gy = field(x, y + h, z) - field(x, y - h, z);
        let gz = field(x, y, z + h) - field(x, y, z - h);
        const L = Math.hypot(gx, gy, gz) || 1;
        const push = (m - d) * 1.05;
        x += gx / L * push; y += gy / L * push; z += gz / L * push;
      }
      restX[i] = x; restY[i] = y; restZ[i] = z;
    }
  }

  /* ---- constraints: soft ones first, structural last so they win ---- */
  const lists = { bend: [], shear: [], struct: [] };
  const link = (kind, a, b) => lists[kind].push(a, b,
    Math.hypot(restX[a] - restX[b], restY[a] - restY[b], restZ[a] - restZ[b]));
  for (let v = 0; v < NV; v++) {
    for (let u = 0; u < NU; u++) {
      const i = idx(u, v);
      if (u + 1 < NU) link('struct', i, idx(u + 1, v));
      if (v + 1 < NV) link('struct', i, idx(u, v + 1));
      if (u + 1 < NU && v + 1 < NV) {
        link('shear', i, idx(u + 1, v + 1));
        link('shear', idx(u + 1, v), idx(u, v + 1));
      }
      if (u + 2 < NU) link('bend', i, idx(u + 2, v));        // soft: lets it fold
      if (v + 2 < NV) link('bend', i, idx(u, v + 2));
    }
  }
  const STIFF = { bend: 0.40, shear: 0.55, struct: 1.0 };
  const cI = [], cJ = [], cL = [], cK = [];
  for (const kind of ['bend', 'shear', 'struct']) {
    const l = lists[kind];
    for (let n = 0; n < l.length; n += 3) { cI.push(l[n]); cJ.push(l[n + 1]); cL.push(l[n + 2]); cK.push(STIFF[kind]); }
  }
  const NC = cI.length;
  const ccI = new Uint16Array(cI), ccJ = new Uint16Array(cJ);
  const ccL = new Float32Array(cL), ccK = new Float32Array(cK);
  const nSoft = (lists.bend.length + lists.shear.length) / 3;   // structural links start here
  // length of the link to the particle above, for the top-down stretch cap
  const upRest = new Float32Array(N);
  for (let v = 1; v < NV; v++) for (let u = 0; u < NU; u++) {
    const a = idx(u, v), b = idx(u, v - 1);
    upRest[a] = Math.hypot(restX[a] - restX[b], restY[a] - restY[b], restZ[a] - restZ[b]);
  }

  /* ---- anchors: collar rows skinned across chest + both shoulders ---- */
  const ANCH = [B.chest, B.shoulderL, B.shoulderR];
  const anchW = new Float32Array(N * 3);
  const anchO = new Float32Array(N * 9);
  const tPrevX = new Float32Array(N), tPrevY = new Float32Array(N), tPrevZ = new Float32Array(N);
  const tCurX  = new Float32Array(N), tCurY  = new Float32Array(N), tCurZ  = new Float32Array(N);
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _inv = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    if (fw[i] === 0) continue;
    const c = ((i % NU) / (NU - 1)) * 2 - 1;
    const th = Math.abs(c) * 1.72;                  // how far round the throat
    let wS = (th - 0.55) / 0.85;
    wS = wS < 0 ? 0 : wS > 1 ? 1 : wS;
    wS = wS * wS * (3 - 2 * wS);
    anchW[i * 3]     = 1 - wS;
    anchW[i * 3 + 1] = c > 0 ? wS : 0;
    anchW[i * 3 + 2] = c < 0 ? wS : 0;
    _v.set(restX[i], restY[i], restZ[i]);
    for (let b = 0; b < 3; b++) {
      if (anchW[i * 3 + b] === 0) continue;
      _inv.copy(ANCH[b].matrixWorld).invert();
      _w.copy(_v).applyMatrix4(_inv);
      anchO[i * 9 + b * 3] = _w.x; anchO[i * 9 + b * 3 + 1] = _w.y; anchO[i * 9 + b * 3 + 2] = _w.z;
    }
  }
  function computeTargets(ox, oy, oz) {
    for (let i = 0; i < N; i++) {
      if (fw[i] === 0) continue;
      let x = 0, y = 0, z = 0;
      for (let b = 0; b < 3; b++) {
        const w = anchW[i * 3 + b];
        if (w === 0) continue;
        const e = ANCH[b].matrixWorld.elements;
        const a = anchO[i * 9 + b * 3], bb = anchO[i * 9 + b * 3 + 1], cc = anchO[i * 9 + b * 3 + 2];
        x += (e[0] * a + e[4] * bb + e[8]  * cc + e[12]) * w;
        y += (e[1] * a + e[5] * bb + e[9]  * cc + e[13]) * w;
        z += (e[2] * a + e[6] * bb + e[10] * cc + e[14]) * w;
      }
      ox[i] = x; oy[i] = y; oz[i] = z;
    }
  }

  /* ---- colliders: the body's own primitives, each riding its bone ---- */
  const CP = PRIMS.filter(p => !p.noCloth);
  const NCOL = CP.length;
  const cBone = new Int16Array(NCOL);
  const cA = new Float32Array(NCOL * 3), cAB = new Float32Array(NCOL * 3);   // scaled-space a, b-a
  const cR0 = new Float32Array(NCOL), cR1 = new Float32Array(NCOL);
  const cS = new Float32Array(NCOL * 3), cIS = new Float32Array(NCOL * 3);
  const cMid = new Float32Array(NCOL * 3), cBound = new Float32Array(NCOL);  // bind-space bounding sphere
  CP.forEach((p, c) => {
    const [sx, sy, sz] = p.s;
    cBone[c] = boneIndex[p.bone];
    cA[c * 3] = p.a.x / sx; cA[c * 3 + 1] = p.a.y / sy; cA[c * 3 + 2] = p.a.z / sz;
    cAB[c * 3] = (p.b.x - p.a.x) / sx; cAB[c * 3 + 1] = (p.b.y - p.a.y) / sy; cAB[c * 3 + 2] = (p.b.z - p.a.z) / sz;
    const mg = (C.margin + (Math.max(p.r0, p.r1) < 0.065 ? C.thinExtra : 0)) / Math.min(sx, sy, sz);
    cR0[c] = p.r0 + mg; cR1[c] = p.r1 + mg;
    cS[c * 3] = sx; cS[c * 3 + 1] = sy; cS[c * 3 + 2] = sz;
    cIS[c * 3] = 1 / sx; cIS[c * 3 + 1] = 1 / sy; cIS[c * 3 + 2] = 1 / sz;
    cMid[c * 3] = (p.a.x + p.b.x) * 0.5; cMid[c * 3 + 1] = (p.a.y + p.b.y) * 0.5; cMid[c * 3 + 2] = (p.a.z + p.b.z) * 0.5;
    cBound[c] = (p.a.distanceTo(p.b) * 0.5 + Math.max(p.r0, p.r1) + C.margin) * 1.25 + 0.02;
  });
  const cM = new Float32Array(NCOL * 16), cMi = new Float32Array(NCOL * 16);   // bind -> world, and back
  const cCx = new Float32Array(NCOL), cCy = new Float32Array(NCOL), cCz = new Float32Array(NCOL);
  const cR2 = new Float32Array(NCOL);
  const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();
  function refreshColliders() {
    for (let c = 0; c < NCOL; c++) {
      const bi = cBone[c];
      _m.multiplyMatrices(skeleton.bones[bi].matrixWorld, skeleton.boneInverses[bi]);
      _mi.copy(_m).invert();
      for (let k = 0; k < 16; k++) { cM[c * 16 + k] = _m.elements[k]; cMi[c * 16 + k] = _mi.elements[k]; }
      const e = _m.elements, mx = cMid[c * 3], my = cMid[c * 3 + 1], mz = cMid[c * 3 + 2];
      cCx[c] = e[0] * mx + e[4] * my + e[8]  * mz + e[12];
      cCy[c] = e[1] * mx + e[5] * my + e[9]  * mz + e[13];
      cCz[c] = e[2] * mx + e[6] * my + e[10] * mz + e[14];
      // squash on `model` can scale the bound; 1.15 covers the clamp in motion.js
      const r = cBound[c] * 1.15;
      cR2[c] = r * r;
    }
  }

  /* ---- geometry ---- */
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  const nrmAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  nrmAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', nrmAttr);
  {
    const tri = [];
    for (let v = 0; v + 1 < NV; v++) {
      for (let u = 0; u + 1 < NU; u++) {
        const a = idx(u, v), b = idx(u + 1, v), c = idx(u, v + 1), d = idx(u + 1, v + 1);
        tri.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(tri);
  }
  const capeMat = new THREE.MeshStandardMaterial({
    color: 0x8e1f2b, roughness: 0.78, metalness: 0.0,
    side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
  });
  capeMat.onBeforeCompile = (sh) => {               // dark purplish-charcoal on the upside, wine-red underneath
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.115, 0.045, 0.075);');
  };
  const mesh = new THREE.Mesh(geo, capeMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  if (scene) scene.add(mesh);

  /* ---- init ---- */
  function reset() {
    model.updateMatrixWorld(true);
    computeTargets(tCurX, tCurY, tCurZ);
    // the rest shape is authored in bind space: carry it to wherever the collar is now
    for (let v = 0; v < NV; v++) for (let u = 0; u < NU; u++) {
      const i = idx(u, v), a = idx(u, 0);
      px[i] = qx[i] = restX[i] + (tCurX[a] - restX[a]);
      py[i] = qy[i] = restY[i] + (tCurY[a] - restY[a]);
      pz[i] = qz[i] = restZ[i] + (tCurZ[a] - restZ[a]);
    }
    tPrevX.set(tCurX); tPrevY.set(tCurY); tPrevZ.set(tCurZ);
    refreshColliders();
    uploadMesh();
  }

  /* ---- simulation ---- */
  function computeNormals() {
    for (let v = 0; v < NV; v++) {
      const vu = v > 0 ? v - 1 : v, vd = v + 1 < NV ? v + 1 : v;
      for (let u = 0; u < NU; u++) {
        const i = idx(u, v);
        const l = idx(u > 0 ? u - 1 : u, v), r = idx(u + 1 < NU ? u + 1 : u, v);
        const d = idx(u, vu), e = idx(u, vd);
        const ux = px[r] - px[l], uy = py[r] - py[l], uz = pz[r] - pz[l];
        const vx = px[e] - px[d], vy = py[e] - py[d], vz = pz[e] - pz[d];
        const a = uy * vz - uz * vy, b = uz * vx - ux * vz, c = ux * vy - uy * vx;
        const L = Math.sqrt(a * a + b * b + c * c) || 1;
        nx[i] = a / L; ny[i] = b / L; nz[i] = c / L;
      }
    }
  }

  function collide() {
    for (let i = 0; i < N; i++) {
      if (pinned[i]) continue;
      for (let pass = 0; pass < 2; pass++) {
        let hit = false;
        for (let c = 0; c < NCOL; c++) {
          let x = px[i], y = py[i], z = pz[i];
          let dx = x - cCx[c], dy = y - cCy[c], dz = z - cCz[c];
          if (dx * dx + dy * dy + dz * dz > cR2[c]) continue;
          const o = c * 16, c3 = c * 3;
          // world -> bind -> primitive's scaled space
          const m = cMi;
          const bx = m[o] * x + m[o + 4] * y + m[o + 8]  * z + m[o + 12];
          const by = m[o + 1] * x + m[o + 5] * y + m[o + 9]  * z + m[o + 13];
          const bz = m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14];
          let sx = bx * cIS[c3], sy = by * cIS[c3 + 1], sz = bz * cIS[c3 + 2];
          const ax = cA[c3], ay = cA[c3 + 1], az = cA[c3 + 2];
          const ex = cAB[c3], ey = cAB[c3 + 1], ez = cAB[c3 + 2];
          const wx = sx - ax, wy = sy - ay, wz = sz - az;
          const ee = ex * ex + ey * ey + ez * ez;
          let t = ee > 1e-12 ? (wx * ex + wy * ey + wz * ez) / ee : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          let ox = wx - ex * t, oy = wy - ey * t, oz = wz - ez * t;
          const r = cR0[c] + (cR1[c] - cR0[c]) * t;
          const d2 = ox * ox + oy * oy + oz * oz;
          if (d2 >= r * r) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-6) { ox = 0; oy = 0; oz = -1; d = 1; }          // degenerate: push to the back
          const k = (r - d) / d;
          sx += ox * k; sy += oy * k; sz += oz * k;
          // back to world
          const ux = sx * cS[c3], uy = sy * cS[c3 + 1], uz = sz * cS[c3 + 2];
          const M = cM;
          const nxw = M[o] * ux + M[o + 4] * uy + M[o + 8]  * uz + M[o + 12];
          const nyw = M[o + 1] * ux + M[o + 5] * uy + M[o + 9]  * uz + M[o + 13];
          const nzw = M[o + 2] * ux + M[o + 6] * uy + M[o + 10] * uz + M[o + 14];
          // inelastic: carry the previous position along so the push is not a bounce
          qx[i] += (nxw - x) * 0.85; qy[i] += (nyw - y) * 0.85; qz[i] += (nzw - z) * 0.85;
          px[i] = nxw; py[i] = nyw; pz[i] = nzw;
          hit = true;
        }
        if (!hit) break;
      }
      if (py[i] < 0.012) {                                           // floor, with friction
        py[i] = 0.012;
        qx[i] += (px[i] - qx[i]) * 0.25; qz[i] += (pz[i] - qz[i]) * 0.25;
        qy[i] = py[i];
      }
    }
  }

  function solveLinks(from, to) {
    for (let c = from; c < to; c++) {
      const a = ccI[c], b = ccJ[c];
      const pa = pinned[a], pb = pinned[b];
      if (pa && pb) continue;
      let dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-7) continue;
      const diff = (len - ccL[c]) / len * 0.5 * ccK[c];
      dx *= diff; dy *= diff; dz *= diff;
      if (!pa && !pb) {
        px[a] += dx; py[a] += dy; pz[a] += dz;
        px[b] -= dx; py[b] -= dy; pz[b] -= dz;
      } else if (!pa) {
        px[a] += dx * 2; py[a] += dy * 2; pz[a] += dz * 2;
      } else {
        px[b] -= dx * 2; py[b] -= dy * 2; pz[b] -= dz * 2;
      }
    }
  }

  function substep(dt, f) {
    const dt2 = dt * dt, invDt = 1 / dt;
    const cn = C.cn, ct = C.ct, g = C.gravity, damp = C.damping;
    const maxA2 = C.maxAccel * C.maxAccel, maxS2 = C.maxStep * C.maxStep;

    computeNormals();

    // the fastened row follows the shoulders exactly, eased across the frame
    for (let u = 0; u < NU; u++) {
      const i = idx(u, 0);
      qx[i] = px[i]; qy[i] = py[i]; qz[i] = pz[i];
      px[i] = tPrevX[i] + (tCurX[i] - tPrevX[i]) * f;
      py[i] = tPrevY[i] + (tCurY[i] - tPrevY[i]) * f;
      pz[i] = tPrevZ[i] + (tCurZ[i] - tPrevZ[i]) * f;
    }

    for (let i = 0; i < N; i++) {
      if (pinned[i]) continue;
      const dxp = px[i] - qx[i], dyp = py[i] - qy[i], dzp = pz[i] - qz[i];
      // wind relative to the cloth
      const rx = wsx[i] - dxp * invDt, ry = wsy[i] - dyp * invDt, rz = wsz[i] - dzp * invDt;
      const nxi = nx[i], nyi = ny[i], nzi = nz[i];
      const vn = rx * nxi + ry * nyi + rz * nzi;
      const fn = cn * Math.abs(vn) * vn;
      let ax = nxi * fn + (rx - nxi * vn) * ct;
      let ay = nyi * fn + (ry - nyi * vn) * ct + g;
      let az = nzi * fn + (rz - nzi * vn) * ct;
      const a2 = ax * ax + ay * ay + az * az;
      if (a2 > maxA2) { const s = C.maxAccel / Math.sqrt(a2); ax *= s; ay *= s; az *= s; }
      let sx = dxp * damp + ax * dt2, sy = dyp * damp + ay * dt2, sz = dzp * damp + az * dt2;
      const s2 = sx * sx + sy * sy + sz * sz;
      if (s2 > maxS2) { const s = C.maxStep / Math.sqrt(s2); sx *= s; sy *= s; sz *= s; }
      qx[i] = px[i]; qy[i] = py[i]; qz[i] = pz[i];
      px[i] += sx; py[i] += sy; pz[i] += sz;
    }

    // soft hold on the collar rows
    for (let i = 0; i < N; i++) {
      const k = fw[i];
      if (k === 0 || pinned[i]) continue;
      px[i] += (tPrevX[i] + (tCurX[i] - tPrevX[i]) * f - px[i]) * k;
      py[i] += (tPrevY[i] + (tCurY[i] - tPrevY[i]) * f - py[i]) * k;
      pz[i] += (tPrevZ[i] + (tCurZ[i] - tPrevZ[i]) * f - pz[i]) * k;
    }

    // relaxation
    for (let it = 0; it < C.iterations; it++) {
      solveLinks(0, NC);
      if (it === 1) collide();           // keep constraints from dragging cloth back into the body
    }
    solveLinks(nSoft, NC);               // one more structural-only pass: cloth does not stretch

    // rope-style cap: no column link may exceed `stretch` x its rest length
    for (let v = 1; v < NV; v++) {
      for (let u = 0; u < NU; u++) {
        const i = idx(u, v), j = i - NU;
        let dx = px[i] - px[j], dy = py[i] - py[j], dz = pz[i] - pz[j];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz), max = upRest[i] * C.stretch;
        if (len > max) {
          const s = (max / len) - 1;
          px[i] += dx * s; py[i] += dy * s; pz[i] += dz * s;
        }
      }
    }
    collide();
    solveLinks(nSoft, NC);               // swinging arms shove edge particles: re-knit, then re-clear
    collide();
  }

  let acc = 0;
  function update(dt) {
    acc += dt;
    let n = Math.floor((acc + 1e-7) / C.step);
    if (n > C.maxSteps) { n = C.maxSteps; acc = 0; } else acc = Math.max(0, acc - n * C.step);
    if (n === 0) return;
    model.updateMatrixWorld(true);        // colliders and anchors need the live pose
    refreshColliders();
    computeTargets(tCurX, tCurY, tCurZ);     // tPrev* still holds where the collar was last applied

    // wind at every particle, once per frame
    const ws = C.windScale, _o = _wind;
    for (let i = 0; i < N; i++) {
      wind.sample(px[i], py[i], pz[i], _o);
      wsx[i] = _o.x * ws; wsy[i] = _o.y * ws; wsz[i] = _o.z * ws;
    }

    for (let s = 0; s < n; s++) substep(C.step, (s + 1) / n);
    if (n > 0) { tPrevX.set(tCurX); tPrevY.set(tCurY); tPrevZ.set(tCurZ); }

    uploadMesh();
  }

  function uploadMesh() {
    computeNormals();
    const pa = posAttr.array, na = nrmAttr.array;
    for (let i = 0; i < N; i++) {
      pa[i * 3] = px[i]; pa[i * 3 + 1] = py[i]; pa[i * 3 + 2] = pz[i];
      na[i * 3] = nx[i]; na[i * 3 + 1] = ny[i]; na[i * 3 + 2] = nz[i];
    }
    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
  }
  const _wind = { x: 0, y: 0, z: 0 };

  reset();
  return {
    mesh, update, reset, N, NC, NCOL, NU, NV,
    particles: { px, py, pz, nx, ny, nz }, pinned,
    links: { i: ccI, j: ccJ, rest: ccL },
  };
}
