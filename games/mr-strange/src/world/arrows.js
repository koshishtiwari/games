// Arrows: one merged arrow mesh (used for the nocked arrow and, instanced, for every arrow in flight).
// Flight is a simple ballistic path; an arrow ends in the player, a wall or the floor, where it sticks for
// a while and then fades out. One InstancedMesh, so the whole pool is a single draw call.

import * as THREE from 'three';
import { lineBlocked, groundHeight } from './collision.js';
import { model, mp, mq, bones, PRIMARY_CHILD, boneIndex } from '../character/rig.js';

// The bat's body (set from main.js), so an arrow in the bat is anchored to it.
let batRoot = null;
export function setBatRoot(root) { batRoot = root; }

export const ARROW_LEN = 0.74;
const POOL = 28;
const GRAVITY = -9.8;
const STICK_TIME = 7;
const EMBED_TIME = 9;
// Hit volumes, sized to the visible bodies. Embedded arrows are then pushed to just inside the body, so they
// never hang in the air at the edge of the volume.
const TORSO_HIT = 0.24, LEG_HIT = 0.15, BAT_HIT = 0.40;
const BODY_R_TORSO = 0.10, BODY_R_LEG = 0.07, BODY_R_BAT = 0.03;   // a bat is tiny: arrows end up right in its middle
// Height of the visible bat's body above char.pos (bat.js puts its root at char.pos.y + 0.92).
export const BAT_CENTER_Y = 0.92;                // an arrow in the player stays a little longer

// Wind trail: each flying arrow leaves a ribbon of recent tail positions that thins, fades and wobbles in the
// wind. Two crossed quads per segment so it reads from any angle; one dynamic mesh for the whole pool.
const TRAIL_POINTS = 18, TRAIL_LIFE = 0.17, TRAIL_WIDTH = 0.06;

const SHAFT = [0.78, 0.62, 0.42], HEAD = [0.55, 0.6, 0.64], FLETCH = [0.66, 0.14, 0.18];

/** Arrow along +Z, tail at the origin, with per-vertex colours (shaft, steel head, red fletching). */
export function makeArrowGeometry() {
  const parts = [];
  const add = (geo, color) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  const shaft = new THREE.CylinderGeometry(0.0055, 0.0055, ARROW_LEN - 0.06, 5);
  shaft.rotateX(Math.PI / 2); shaft.translate(0, 0, (ARROW_LEN - 0.06) / 2);
  add(shaft, SHAFT);
  const head = new THREE.ConeGeometry(0.013, 0.07, 5);
  head.rotateX(Math.PI / 2); head.translate(0, 0, ARROW_LEN - 0.035);
  add(head, HEAD);
  for (let i = 0; i < 3; i++) {                       // three vanes
    const vane = new THREE.BoxGeometry(0.002, 0.03, 0.11);
    vane.translate(0, 0.016, 0.07);
    vane.rotateZ((i / 3) * Math.PI * 2);
    add(vane, FLETCH);
  }
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

export const arrowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });

export function createArrows(scene) {
  const geo = makeArrowGeometry();
  const mesh = new THREE.InstancedMesh(geo, arrowMaterial, POOL);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  scene.add(mesh);

  const px = new Float32Array(POOL), py = new Float32Array(POOL), pz = new Float32Array(POOL);   // tail
  const vx = new Float32Array(POOL), vy = new Float32Array(POOL), vz = new Float32Array(POOL);
  const state = new Uint8Array(POOL);          // 0 free, 1 flying, 2 stuck in the world, 3 stuck in the player
  // An embedded arrow is anchored to the body it is in: to the bone nearest the wound for a man (so it moves with
  // the torso, the lean, the crouch, the limbs), or to the body of the bat. It is stored in that bone's (or the bat's)
  // own local space, position and direction, and rebuilt from it every frame. `form` remembers which body it is in, so
  // a man's arrows do not float around the bat after morphing.
  const eBone = new Int16Array(POOL).fill(-1);
  const eLp = new Float32Array(POOL * 3), eLd = new Float32Array(POOL * 3);
  const form = new Uint8Array(POOL);
  const age = new Float32Array(POOL);
  let next = 0;

  // ---- trail buffers ----
  const SEGS = TRAIL_POINTS - 1, QUADS = POOL * SEGS * 2;
  const tx = new Float32Array(POOL * TRAIL_POINTS), ty = new Float32Array(POOL * TRAIL_POINTS), tz = new Float32Array(POOL * TRAIL_POINTS);
  const tt = new Float32Array(POOL * TRAIL_POINTS);          // birth time of each point
  const tHead = new Int16Array(POOL).fill(-1), tCount = new Uint8Array(POOL);
  const trailPos = new Float32Array(QUADS * 4 * 3), trailCol = new Float32Array(QUADS * 4 * 4);
  const trailIdx = new Uint32Array(QUADS * 6);
  for (let q = 0; q < QUADS; q++) { const v = q * 4, i = q * 6; trailIdx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i); }
  const trailGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(trailCol, 4).setUsage(THREE.DynamicDrawUsage);
  trailGeo.setAttribute('position', posAttr);
  trailGeo.setAttribute('color', colAttr);
  trailGeo.setIndex(new THREE.BufferAttribute(trailIdx, 1));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  trail.frustumCulled = false;
  trail.renderOrder = 4;
  scene.add(trail);
  let clock = 0;

  function pushTrail(i) {
    let h = tHead[i];
    h = h < 0 ? 0 : (h + 1) % TRAIL_POINTS;
    tHead[i] = h;
    const o = i * TRAIL_POINTS + h;
    tx[o] = px[i]; ty[o] = py[i]; tz[o] = pz[i]; tt[o] = clock;
    if (tCount[i] < TRAIL_POINTS) tCount[i]++;
  }

  // Rebuild the ribbon geometry for every slot that still has live points.
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3(), _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
  function buildTrail() {
    let quad = 0;
    for (let i = 0; i < POOL; i++) {
      const n = tCount[i];
      if (n < 2) continue;
      const base = i * TRAIL_POINTS, head = tHead[i];
      for (let j = 0; j < n - 1; j++) {                  // j = 0 is the newest point
        const o0 = base + ((head - j + TRAIL_POINTS) % TRAIL_POINTS), o1 = base + ((head - j - 1 + TRAIL_POINTS) % TRAIL_POINTS);
        const age0 = clock - tt[o0], age1 = clock - tt[o1];
        if (age1 >= TRAIL_LIFE) break;                   // the rest are older still
        const f0 = Math.max(0, 1 - age0 / TRAIL_LIFE), f1 = Math.max(0, 1 - age1 / TRAIL_LIFE);
        // wind: the older the point, the more it has been blown about
        const w0 = (1 - f0) * 0.06, w1 = (1 - f1) * 0.06;
        _a.set(tx[o0] + Math.sin(clock * 31 + o0 * 1.7) * w0, ty[o0] + Math.sin(clock * 27 + o0 * 2.3) * w0, tz[o0] + Math.cos(clock * 29 + o0 * 1.3) * w0);
        _b.set(tx[o1] + Math.sin(clock * 31 + o1 * 1.7) * w1, ty[o1] + Math.sin(clock * 27 + o1 * 2.3) * w1, tz[o1] + Math.cos(clock * 29 + o1 * 1.3) * w1);
        _dir.subVectors(_a, _b);
        if (_dir.lengthSq() < 1e-10) continue;
        _dir.normalize();
        _s1.set(0, 1, 0).cross(_dir);
        if (_s1.lengthSq() < 1e-4) _s1.set(1, 0, 0).cross(_dir);
        _s1.normalize();
        _s2.crossVectors(_dir, _s1);
        const hw0 = TRAIL_WIDTH * (0.25 + 0.75 * f0) * 0.5, hw1 = TRAIL_WIDTH * (0.25 + 0.75 * f1) * 0.5;
        const al0 = 0.5 * f0 * f0, al1 = 0.5 * f1 * f1;
        for (let c = 0; c < 2; c++) {
          const s = c === 0 ? _s1 : _s2;
          const v = quad * 4;
          const p = [
            [_a.x - s.x * hw0, _a.y - s.y * hw0, _a.z - s.z * hw0, al0], [_a.x + s.x * hw0, _a.y + s.y * hw0, _a.z + s.z * hw0, al0],
            [_b.x - s.x * hw1, _b.y - s.y * hw1, _b.z - s.z * hw1, al1], [_b.x + s.x * hw1, _b.y + s.y * hw1, _b.z + s.z * hw1, al1],
          ];
          for (let k = 0; k < 4; k++) {
            trailPos[(v + k) * 3] = p[k][0]; trailPos[(v + k) * 3 + 1] = p[k][1]; trailPos[(v + k) * 3 + 2] = p[k][2];
            trailCol[(v + k) * 4] = 0.78; trailCol[(v + k) * 4 + 1] = 0.88; trailCol[(v + k) * 4 + 2] = 1.0; trailCol[(v + k) * 4 + 3] = p[k][3];
          }
          quad++;
        }
      }
      // forget a slot whose whole trail has faded
      if (clock - tt[base + head] >= TRAIL_LIFE && state[i] !== 1) { tCount[i] = 0; tHead[i] = -1; }
    }
    trailGeo.setDrawRange(0, quad * 6);
    posAttr.needsUpdate = true; colAttr.needsUpdate = true;
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const _z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3();
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, hide);

  function setMatrix(i, scale = 1) {
    _d.set(vx[i], vy[i], vz[i]);
    if (_d.lengthSq() < 1e-8) _d.set(0, 0, 1);
    _q.setFromUnitVectors(_z, _d.normalize());
    _p.set(px[i], py[i], pz[i]);
    _s.setScalar(scale);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
  }

  function spawn(x, y, z, dx, dy, dz) {
    const i = next; next = (next + 1) % POOL;
    px[i] = x; py[i] = y; pz[i] = z; vx[i] = dx; vy[i] = dy; vz[i] = dz;
    state[i] = 1; age[i] = 0;
    tCount[i] = 0; tHead[i] = -1; pushTrail(i);
    setMatrix(i);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- anchoring ----
  const _pm = new THREE.Vector3(), _dm = new THREE.Vector3(), _qa = new THREE.Quaternion(), _inv = new THREE.Matrix4();
  const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sab = new THREE.Vector3(), _w = new THREE.Vector3(), _dw = new THREE.Vector3();
  const segments = [];                                     // bone segments of the hero, for finding the nearest one
  for (const bn of bones) {
    const child = PRIMARY_CHILD[bn.name];
    if (child) segments.push({ i: boneIndex[bn.name], c: boneIndex[child] });
  }

  // Remember where in the body the arrow's head (tip) is, and which way the arrow points, in the body's own space.
  function anchorArrow(i, tx, ty, tz, dx, dy, dz, char) {
    if (char.isBat && batRoot) {
      batRoot.updateMatrixWorld(true);
      _w.set(tx, ty, tz); batRoot.worldToLocal(_w);
      batRoot.getWorldQuaternion(_qa).invert();
      _dw.set(dx, dy, dz).applyQuaternion(_qa);
      eBone[i] = -1;
      eLp[i * 3] = _w.x; eLp[i * 3 + 1] = _w.y; eLp[i * 3 + 2] = _w.z;
      eLd[i * 3] = _dw.x; eLd[i * 3 + 1] = _dw.y; eLd[i * 3 + 2] = _dw.z;
      return;
    }
    model.updateMatrix();
    _inv.copy(model.matrix).invert();
    _pm.set(tx, ty, tz).applyMatrix4(_inv);                // the head, in model space
    _qa.copy(model.quaternion).invert();
    _dm.set(dx, dy, dz).applyQuaternion(_qa);
    // nearest bone segment
    let best = -1, bestD = Infinity;
    for (const sg of segments) {
      _sa.copy(mp[sg.i]); _sb.copy(mp[sg.c]); _sab.subVectors(_sb, _sa);
      const l2 = _sab.lengthSq() || 1e-6;
      const t = Math.max(0, Math.min(1, _w.subVectors(_pm, _sa).dot(_sab) / l2));
      _w.copy(_sa).addScaledVector(_sab, t);
      const d = _w.distanceToSquared(_pm);
      if (d < bestD) { bestD = d; best = sg.i; }
    }
    eBone[i] = best;
    _qa.copy(mq[best]).invert();
    _w.subVectors(_pm, mp[best]).applyQuaternion(_qa);
    _dm.applyQuaternion(_qa);
    eLp[i * 3] = _w.x; eLp[i * 3 + 1] = _w.y; eLp[i * 3 + 2] = _w.z;
    eLd[i * 3] = _dm.x; eLd[i * 3 + 1] = _dm.y; eLd[i * 3 + 2] = _dm.z;
  }

  // Rebuild the arrow's world position and direction from its anchor (the body has moved and posed since).
  function resolveAnchor(i, char) {
    let tx, ty, tz, dx, dy, dz;
    if (eBone[i] < 0) {
      if (!batRoot) return;
      batRoot.updateMatrixWorld(true);
      _w.set(eLp[i * 3], eLp[i * 3 + 1], eLp[i * 3 + 2]); batRoot.localToWorld(_w);
      batRoot.getWorldQuaternion(_qa);
      _dw.set(eLd[i * 3], eLd[i * 3 + 1], eLd[i * 3 + 2]).applyQuaternion(_qa);
      tx = _w.x; ty = _w.y; tz = _w.z; dx = _dw.x; dy = _dw.y; dz = _dw.z;
    } else {
      const b = eBone[i];
      model.updateMatrix();
      _w.set(eLp[i * 3], eLp[i * 3 + 1], eLp[i * 3 + 2]).applyQuaternion(mq[b]).add(mp[b]).applyMatrix4(model.matrix);
      _dw.set(eLd[i * 3], eLd[i * 3 + 1], eLd[i * 3 + 2]).applyQuaternion(mq[b]).applyQuaternion(model.quaternion);
      tx = _w.x; ty = _w.y; tz = _w.z; dx = _dw.x; dy = _dw.y; dz = _dw.z;
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    vx[i] = dx / l; vy[i] = dy / l; vz[i] = dz / l;
    px[i] = tx - vx[i] * ARROW_LEN; py[i] = ty - vy[i] * ARROW_LEN; pz[i] = tz - vz[i] * ARROW_LEN;
  }

  // Where the head of an arrow that hit at (hx,hy,hz) ends up: a few centimetres inside the body, on the side it
  // came from. A man is a vertical axis (a thinner one below the hips), a bat a small body about its centre.
  const _tip = new THREE.Vector3();
  function embedPoint(char, hx, hy, hz, dxn, dzn, out) {
    if (char.isBat) {
      const cx = char.pos.x, cy = char.pos.y + BAT_CENTER_Y, cz = char.pos.z;
      let vx = hx - cx, vy = hy - cy, vz = hz - cz, l = Math.hypot(vx, vy, vz);
      if (l < 1e-4) { vx = -dxn; vy = 0; vz = -dzn; l = Math.hypot(vx, vz) || 1; }
      return out.set(cx + vx / l * BODY_R_BAT, cy + vy / l * BODY_R_BAT, cz + vz / l * BODY_R_BAT);
    }
    const y = Math.min(char.pos.y + 1.5, Math.max(char.pos.y + 0.3, hy));
    let vx = hx - char.pos.x, vz = hz - char.pos.z, l = Math.hypot(vx, vz);
    if (l < 1e-4) { vx = -dxn; vz = -dzn; l = Math.hypot(vx, vz) || 1; }
    const r = y < char.pos.y + 0.85 ? BODY_R_LEG : BODY_R_TORSO;
    return out.set(char.pos.x + vx / l * r, y, char.pos.z + vz / l * r);
  }

  // Closest approach of the point (x,y,z) to the player's body. A man is a capsule, a bat a fat sphere.
  function hitsPlayer(x, y, z, char) {   // (kept as a predicate; the caller keeps the sample point)
    if (char.isBat) {
      const dx = x - char.pos.x, dy = y - (char.pos.y + BAT_CENTER_Y), dz = z - char.pos.z;
      return dx * dx + dy * dy + dz * dz < BAT_HIT * BAT_HIT;
    }
    const dx = x - char.pos.x, dz = z - char.pos.z;
    const r = y < char.pos.y + 0.85 ? LEG_HIT : TORSO_HIT;      // legs are thinner than the torso
    return dx * dx + dz * dz < r * r && y > char.pos.y + 0.05 && y < char.pos.y + 1.72;
  }

  /** Advance every arrow. `onHit(dirX, dirY, dirZ)` is called when one reaches the player. */
  function update(dt, char, onHit) {
    let dirty = false;
    clock += dt;
    for (let i = 0; i < POOL; i++) {
      if (state[i] === 0) continue;
      age[i] += dt;
      if (state[i] === 3) {                                // in the player: follow him
        if (age[i] > EMBED_TIME + 0.8) { state[i] = 0; mesh.setMatrixAt(i, hide); dirty = true; continue; }
        if (form[i] !== (char.isBat ? 1 : 0)) { mesh.setMatrixAt(i, hide); dirty = true; continue; }   // in the other body
        resolveAnchor(i, char);
        setMatrix(i, age[i] > EMBED_TIME ? 1 - (age[i] - EMBED_TIME) / 0.8 : 1);
        dirty = true;
        continue;
      }
      if (state[i] === 2) {
        if (age[i] > STICK_TIME) {                       // fade out by shrinking
          const k = 1 - Math.min(1, (age[i] - STICK_TIME) / 0.8);
          if (k <= 0) { state[i] = 0; mesh.setMatrixAt(i, hide); } else setMatrix(i, k);
          dirty = true;
        }
        continue;
      }
      // fly: gravity, then move the tip along its path and look for something to hit
      const l = Math.hypot(vx[i], vy[i], vz[i]) || 1;
      const ox = px[i] + vx[i] / l * ARROW_LEN, oy = py[i] + vy[i] / l * ARROW_LEN, oz = pz[i] + vz[i] / l * ARROW_LEN;   // old tip
      vy[i] += GRAVITY * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      const l2 = Math.hypot(vx[i], vy[i], vz[i]) || 1;
      const nx = px[i] + vx[i] / l2 * ARROW_LEN, ny = py[i] + vy[i] / l2 * ARROW_LEN, nz = pz[i] + vz[i] / l2 * ARROW_LEN;   // new tip

      let hit = false, hx = 0, hy = 0, hz = 0;
      for (let s = 1; s <= 3 && !hit; s++) {             // a few samples along the tip's path, so it cannot skip the player
        const t = s / 3;
        hx = ox + (nx - ox) * t; hy = oy + (ny - oy) * t; hz = oz + (nz - oz) * t;
        if (hitsPlayer(hx, hy, hz, char)) hit = true;
      }
      if (hit) {
        const dxn = vx[i] / l2, dyn = vy[i] / l2, dzn = vz[i] / l2;
        onHit(dxn, dyn, dzn);
        // embed: the head goes into the visible body (not just to the edge of the hit volume), and the arrow is
        // kept in the player's frame from now on
        embedPoint(char, hx, hy, hz, dxn, dzn, _tip);
        anchorArrow(i, _tip.x, _tip.y, _tip.z, dxn, dyn, dzn, char);
        form[i] = char.isBat ? 1 : 0;
        state[i] = 3; age[i] = 0;
        continue;
      }

      let stuck = false;
      if (lineBlocked(ox, oy, oz, nx, ny, nz)) {          // wall: back up to just outside it
        let lo = 0, hi = 1;
        for (let b = 0; b < 6; b++) { const mid = (lo + hi) / 2; if (lineBlocked(ox, oy, oz, ox + (nx - ox) * mid, oy + (ny - oy) * mid, oz + (nz - oz) * mid)) hi = mid; else lo = mid; }
        const dxn = vx[i] / l2, dyn = vy[i] / l2, dzn = vz[i] / l2;
        const tx = ox + (nx - ox) * lo, ty = oy + (ny - oy) * lo, tz = oz + (nz - oz) * lo;   // where the tip met the wall
        px[i] = tx - dxn * (ARROW_LEN - 0.1); py[i] = ty - dyn * (ARROW_LEN - 0.1); pz[i] = tz - dzn * (ARROW_LEN - 0.1);   // head buried 10 cm
        vx[i] = dxn; vy[i] = dyn; vz[i] = dzn;
        stuck = true;
      } else if (ny < groundHeight(nx, nz, ny + 0.1, 0.2) + 0.02) {
        py[i] += (groundHeight(nx, nz, ny + 0.1, 0.2) + 0.02 - ny); stuck = true;
      }
      if (stuck) { state[i] = 2; age[i] = 0; }
      else if (age[i] > 6) { state[i] = 0; mesh.setMatrixAt(i, hide); dirty = true; continue; }
      else pushTrail(i);
      setMatrix(i);
      dirty = true;
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
    buildTrail();
  }

  const embedded = () => { let n = 0; for (let i = 0; i < POOL; i++) if (state[i] === 3) n++; return n; };
  const anchoredBones = () => { const out = []; for (let i = 0; i < POOL; i++) if (state[i] === 3) out.push(eBone[i] < 0 ? 'bat' : bones[eBone[i]].name); return out; };
  return { spawn, update, mesh, trail, embedded, anchoredBones };
}
