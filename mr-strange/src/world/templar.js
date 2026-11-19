// Templar model, cloth simulation, and enemy movement.

import * as THREE from 'three';
import { clamp, shortAngle } from '../math.js';
import { capsuleOverlap, groundHeight, HEIGHT, lineBlocked, pushOut, R, separateCapsule } from './collision.js';
import { createTemplarTactics } from './templar-ai.js';
import { wind } from './wind.js';
import { towerSpawns } from './city.js';
import { createArrows, makeArrowGeometry, arrowMaterial, BAT_CENTER_Y } from './arrows.js';
import { poseArcher, carryBow, bowMuzzle, drawFrame, holdFrame, releaseFrame, DRAW, HOLD, RELEASE } from './templar-archer.js';
import { MOVES, frameAt, rootOffset, poseMove, poseStrafe, restoreGear, STRAFE_METRES, poseFallFront, poseRiseFront, FALL_FRONT_DURATION, RISE_FRONT_DURATION } from './templar-moves.js';
export { poseTemplarAttack, TEMPLAR_ATTACK_DURATION } from './templar-moves.js';
import { poseGetUp, endPelvis, GETUP_FROM, GETUP_TO, GETUP_FPS, GETUP_DURATION, FALLEN_PELVIS, FALLEN_QUAT } from './templar-getup.js';

const KNIGHT_RADIUS = 0.28;
const KNIGHT_HEIGHT = 1.73;
const BLADE_BASE = 0.074;
const BLADE_TIP = 0.900;
const KNIGHT_HP = 3;
const STUN_TIME = 0.55;

function paintTexture(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  paint(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addWear(context, size, count, opacity) {
  let seed = 71;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pixels = context.getImageData(0, 0, size, size);
  const noise = new Float32Array(21 * 21).map(() => next() - 0.5);
  for (let y = 0; y < size; y++) {
    const py = y * 20 / size, iy = Math.floor(py), fy = py - iy;
    const sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < size; x++) {
      const px = x * 20 / size, ix = Math.floor(px), fx = px - ix;
      const sx = fx * fx * (3 - 2 * fx);
      const top = THREE.MathUtils.lerp(noise[iy * 21 + ix], noise[iy * 21 + ix + 1], sx);
      const bottom = THREE.MathUtils.lerp(noise[(iy + 1) * 21 + ix], noise[(iy + 1) * 21 + ix + 1], sx);
      const wear = opacity * (THREE.MathUtils.lerp(top, bottom, sy) * 270 + (next() - 0.5) * 95);
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] += wear;
    }
  }
  context.putImageData(pixels, 0, 0);
  for (let i = 0; i < count; i++) {
    const x = next() * size;
    const y = next() * size;
    const width = 0.5 + next() ** 6 * size / 50;
    const height = 0.5 + next() ** 5 * size / 100;
    const shade = i % 3 === 0 ? '235, 222, 196' : '39, 34, 28';
    context.fillStyle = `rgba(${shade}, ${opacity * next()})`;
    context.fillRect(x, y, width, height);
  }
}

function makeChainmailTexture() {
  const texture = paintTexture(96, (g, size) => {
    g.fillStyle = '#343d42';
    g.fillRect(0, 0, size, size);
    for (let row = -1; row <= 12; row++) {
      for (let col = -1; col <= 8; col++) {
        const x = col * 12 + (row % 2) * 6;
        const y = row * 8;
        const tilt = row % 2 ? -0.22 : 0.22;
        g.beginPath();
        g.ellipse(x, y, 5.5, 3.7, tilt, 0, Math.PI * 2);
        g.strokeStyle = '#252d33';
        g.lineWidth = 2.8;
        g.stroke();
        g.beginPath();
        g.ellipse(x, y - 0.65, 5.1, 3.3, tilt, Math.PI * 0.95, Math.PI * 1.98);
        g.strokeStyle = '#929c9f';
        g.lineWidth = 1.25;
        g.stroke();
        g.beginPath();
        g.ellipse(x, y + 0.4, 5.1, 3.3, tilt, 0, Math.PI * 0.93);
        g.strokeStyle = '#626d73';
        g.stroke();
      }
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  return texture;
}

function makeLinenTexture(chest, dark = false) {
  return paintTexture(256, (g, size) => {
    g.fillStyle = dark ? '#18181c' : '#d7d2be';
    g.fillRect(0, 0, size, size);
    if (chest) {
      // Paint the cross on the cloth so it follows the folds.
      g.save();
      g.translate(128, 125);
      g.scale(1.18, 1.17);
      g.fillStyle = dark ? '#6d1620' : '#a9232e';
      g.beginPath();
      for (let arm = 0; arm < 4; arm++) {
        if (arm === 0) g.moveTo(-31, -45);
        else g.lineTo(-31, -45);
        g.quadraticCurveTo(0, -38, 31, -45);
        g.quadraticCurveTo(14, -26, 10, -10);
        g.quadraticCurveTo(26, -14, 45, -31);
        g.rotate(Math.PI / 2);
      }
      g.closePath();
      g.fill();
      g.restore();
    }
    g.fillStyle = dark ? 'rgba(190, 195, 215, 0.03)' : 'rgba(88, 78, 63, 0.039)';
    for (let i = 0; i < size; i += 3) {
      g.fillRect(i, 0, 1, size);
      g.fillRect(0, i, size, 1);
    }
    addWear(g, size, 2900, dark ? 0.06 : 0.14);
  });
}

// The archers wear black: the same materials, with a dark surcoat (and a dark red cross).
function createArcherMaterials(base) {
  return {
    ...base,
    surcoatFront: new THREE.MeshStandardMaterial({ map: makeLinenTexture(true, true), roughness: 0.88, side: THREE.DoubleSide }),
    linen:        new THREE.MeshStandardMaterial({ map: makeLinenTexture(false, true), roughness: 0.9, side: THREE.DoubleSide }),
  };
}

export function createTemplarMaterials() {
  const mailTex = makeChainmailTexture();
  const steelTex = paintTexture(256, (g, size) => {
    g.fillStyle = '#80898f';
    g.fillRect(0, 0, size, size);
    addWear(g, size, 4700, 0.12);
  });
  const shieldTex = paintTexture(512, (g, size) => {
    g.fillStyle = '#cfcec0';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#8f2333';
    g.fillRect(224, 0, 64, size);
    g.fillRect(0, 167, size, 38);
    addWear(g, size, 6300, 0.19);
  });
  return {
    trousers:     new THREE.MeshStandardMaterial({ color: 0x544e48, roughness: 0.94 }),
    mail:         new THREE.MeshStandardMaterial({ map: mailTex, roughness: 0.78, metalness: 0.15 }),
    surcoatFront: new THREE.MeshStandardMaterial({ map: makeLinenTexture(true), roughness: 0.91, side: THREE.DoubleSide }),
    linen:        new THREE.MeshStandardMaterial({ map: makeLinenTexture(false), roughness: 0.94, side: THREE.DoubleSide }),
    steel:        new THREE.MeshStandardMaterial({ color: 0x9ba5a8, roughness: 0.56, metalness: 0.36 }),
    blade:        new THREE.MeshStandardMaterial({ color: 0x88969e, roughness: 0.40, metalness: 0.35 }),
    leather:      new THREE.MeshStandardMaterial({ color: 0x4b3028, roughness: 0.82 }),
    helmSteel:    new THREE.MeshStandardMaterial({ map: steelTex, roughness: 0.59, metalness: 0.34 }),
    glove:        new THREE.MeshStandardMaterial({ color: 0x624237, roughness: 0.78 }),
    shieldFace:   new THREE.MeshStandardMaterial({ map: shieldTex, roughness: 0.84 }),
    shieldRim:    new THREE.MeshStandardMaterial({ color: 0x414e57, roughness: 0.62, metalness: 0.39 }),
    wood:         new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.72 }),
    bowString:    new THREE.MeshStandardMaterial({ color: 0xe6dcc0, roughness: 0.9 }),
    dark:         new THREE.MeshStandardMaterial({ color: 0x080a0d, roughness: 0.97 }),
  };
}

// Sample a surface in rows from top to bottom, starting at its front.
function makeSurface(columns, rows, sample) {
  const vertices = [], uvs = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns, v = row / rows;
      const [x, y, z, textureU = u, textureV = 1 - v] = sample(u, v);
      vertices.push(x, y, z);
      uvs.push(textureU, textureV);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column;
        const b = a + 1, c = a + columns + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addMesh(parent, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function batchRigidMeshes(root) {
  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  root.traverse((joint) => {
    const batches = new Map();
    for (const mesh of joint.children) {
      if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material)) continue;
      if (!mesh.geometry.hasAttribute('uv') || mesh.geometry.attributes.position.usage === THREE.DynamicDrawUsage) continue;
      const key = `${mesh.material.id}/${mesh.castShadow}/${mesh.receiveShadow}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(mesh);
    }

    for (const batch of batches.values()) {
      if (batch.length < 2) continue;
      const positions = [], normals = [], uvs = [], indices = [];
      for (const mesh of batch) {
        const { geometry } = mesh;
        const offset = positions.length / 3;
        const attributes = geometry.attributes;
        mesh.updateMatrix();
        normalMatrix.getNormalMatrix(mesh.matrix);
        for (let i = 0; i < attributes.position.count; i++) {
          position.fromBufferAttribute(attributes.position, i).applyMatrix4(mesh.matrix);
          normal.fromBufferAttribute(attributes.normal, i).applyNormalMatrix(normalMatrix);
          positions.push(position.x, position.y, position.z);
          normals.push(normal.x, normal.y, normal.z);
          uvs.push(attributes.uv.getX(i), attributes.uv.getY(i));
        }
        const count = geometry.index?.count ?? attributes.position.count;
        for (let i = 0; i < count; i++) indices.push(offset + (geometry.index ? geometry.index.getX(i) : i));
        geometry.dispose();
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, batch[0].material);
      mesh.castShadow = batch[0].castShadow;
      mesh.receiveShadow = batch[0].receiveShadow;
      joint.remove(...batch);
      joint.add(mesh);
    }
  });
}

function addRivets(parent, points, radius, material) {
  const rivets = new THREE.InstancedMesh(new THREE.OctahedronGeometry(radius), material, points.length);
  const transform = new THREE.Object3D();
  points.forEach(([x, y, z, depth = 0.57], i) => {
    transform.position.set(x, y, z);
    transform.scale.set(1, 1, depth);
    transform.updateMatrix();
    rivets.setMatrixAt(i, transform.matrix);
  });
  parent.add(rivets);
}

// Surcoat skirt: a Verlet cloth hung from the belt.
//  * Two panels (right/left) joined by a seam at the back, open slit at the front.
//  * The waist row is pinned to the pelvis; the next rows are held softly so the hips stay dressed.
//  * Structural, shear and bend links are relaxed Gauss-Seidel style.
//  * Both legs are collision capsules (thigh, shin, boot), tested per particle and at the midpoint
//    of every edge and cell, so a stride pushes the cloth aside instead of the faces cutting through.
//  * Wind (the same field the cape uses) acts through drag on the air velocity relative to the cloth.
//
// Performance: typed arrays only, no allocation per frame, no Math.hypot, wind sampled once per frame
// (half the particles each frame), capsule bounding-sphere early-outs, edge collision only on a few
// iterations, normals computed once per frame in world space and reused for wind and rendering, a
// minimal matrix refresh, at most two fixed substeps per frame (no catch-up spiral), and distance LOD.
const SKIRT_CFG = {
  gravity: -9.5, damping: 0.984, iterations: 10, lodIterations: 6, step: 1 / 60, maxSteps: 2,
  windScale: 0.40, cn: 0.45, ct: 0.10, maxAccel: 20, maxMove: 0.06, margin: 0.016,
};
const SKIRT_FOLLOW = [1, 0.55, 0.30, 0.14];
const _skirtWind = { x: 0, y: 0, z: 0 };

function createSurcoatSkirt(pelvis, material) {
  const C = SKIRT_CFG;
  const columns = 10, rows = 8;
  const stride = columns + 1, panel = (rows + 1) * stride;
  const rest = [], uvs = [], triangles = [];
  for (const side of [1, -1]) {
    const start = rest.length / 3;
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      const radius = 0.138 + 0.095 * t;
      for (let col = 0; col <= columns; col++) {
        const u = col / columns;
        const wrap = side > 0 ? u : 1 - u;
        const front = 0.09 + t * 0.39;
        const angle = side * (front + (3.07 - front) * wrap);
        const pleat = 0.012 * t * Math.sin(wrap * 19 + t);
        rest.push(Math.sin(angle) * (radius + pleat) * 1.17,
          0.038 - 0.73 * t + Math.sin(wrap * 12) * 0.012 * t ** 4,
          Math.cos(angle) * (radius + pleat) * 0.87);
        uvs.push(u, 1 - t);
        if (row === rows || col === columns) continue;
        const i = start + row * stride + col;
        const next = i + stride;
        triangles.push(i, next, i + 1, i + 1, next, next + 1);
      }
    }
  }
  const N = rest.length / 3;
  const restLocal = Float32Array.from(rest);
  const rowOf = new Uint8Array(N);
  const free = new Uint8Array(N);
  for (let i = 0; i < N; i++) { rowOf[i] = Math.floor((i % panel) / stride); free[i] = rowOf[i] === 0 ? 0 : 1; }
  const tri = Uint16Array.from(triangles);
  const NT = tri.length / 3;

  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(Float32Array.from(rest), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  const normalAttr = geometry.getAttribute('normal');
  normalAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.33, 0), 0.95);
  const mesh = addMesh(pelvis, geometry, material);
  mesh.frustumCulled = false;

  // Links: soft ones first so the structural ones win.
  const links = { bend: [], shear: [], struct: [] };
  const dist = (a, b) => Math.sqrt((restLocal[a * 3] - restLocal[b * 3]) ** 2
    + (restLocal[a * 3 + 1] - restLocal[b * 3 + 1]) ** 2 + (restLocal[a * 3 + 2] - restLocal[b * 3 + 2]) ** 2);
  const link = (kind, a, b) => links[kind].push(a, b, dist(a, b));
  for (let side = 0; side < 2; side++) {
    const o = side * panel;
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= columns; col++) {
        const i = o + row * stride + col;
        if (col < columns) link('struct', i, i + 1);
        if (row < rows) link('struct', i, i + stride);
        if (col < columns && row < rows) {
          link('shear', i, i + stride + 1);
          link('shear', i + 1, i + stride);
        }
        if (col + 2 <= columns) link('bend', i, i + 2);
        if (row + 2 <= rows) link('bend', i, i + 2 * stride);
      }
    }
  }
  // Back seam between the two panels.
  for (let row = 0; row <= rows; row++) link('struct', row * stride + columns, panel + row * stride);
  const STIFF = { bend: 0.30, shear: 0.50, struct: 1.0 };
  const lI = [], lJ = [], lL = [], lK = [];
  for (const kind of ['bend', 'shear', 'struct']) {
    const l = links[kind];
    for (let n = 0; n < l.length; n += 3) { lI.push(l[n] * 3); lJ.push(l[n + 1] * 3); lL.push(l[n + 2]); lK.push(STIFF[kind] * 0.5); }
  }
  const NC = lI.length;
  const cI = Uint16Array.from(lI), cJ = Uint16Array.from(lJ);   // already multiplied by 3
  const cL = Float32Array.from(lL), cK = Float32Array.from(lK);
  const nBend = links.bend.length / 3;   // links before this are bend links (no edge collision)
  const cFA = new Uint8Array(NC), cFB = new Uint8Array(NC);   // is each end free to move?
  for (let c = 0; c < NC; c++) { cFA[c] = free[cI[c] / 3]; cFB[c] = free[cJ[c] / 3]; }
  // How far each end moves per unit of the (stiffness-scaled) error: 1 each when both are free, 2 for the
  // free one when the other is pinned. Folded together with the stiffness so the hot loop has no branches.
  const cWA = new Float32Array(NC), cWB = new Float32Array(NC);
  for (let c = 0; c < NC; c++) {
    cWA[c] = cK[c] * (cFA[c] ? (cFB[c] ? 1 : 2) : 0);
    cWB[c] = cK[c] * (cFB[c] ? (cFA[c] ? 1 : 2) : 0);
  }

  const p = new Float32Array(N * 3), q = new Float32Array(N * 3), tgt = new Float32Array(N * 3);
  const tgtPrev = new Float32Array(N * 3);
  const wn = new Float32Array(N * 3);        // world-space normals
  const wv = new Float32Array(N * 3);        // cached wind (already scaled), refreshed once per frame
  const lastPelvis = new THREE.Vector3(Infinity, 0, 0);
  const inverse = new THREE.Matrix4();
  const hipW = [new THREE.Vector3(), new THREE.Vector3()];
  const kneeW = [new THREE.Vector3(), new THREE.Vector3()];
  const ankleW = [new THREE.Vector3(), new THREE.Vector3()];
  const heelW = [new THREE.Vector3(), new THREE.Vector3()];
  const toeW = [new THREE.Vector3(), new THREE.Vector3()];
  let last = performance.now(), accumulator = 0, frame = 0;

  // Capsules: thigh, shin, boot per leg. Bounding spheres are refreshed once per frame.
  const NCAP = 6;
  const capA = [hipW[0], kneeW[0], heelW[0], hipW[1], kneeW[1], heelW[1]];
  const capB = [kneeW[0], ankleW[0], toeW[0], kneeW[1], ankleW[1], toeW[1]];
  const capR0 = new Float32Array([0.074, 0.056, 0.052, 0.074, 0.056, 0.052]);
  const capR1 = new Float32Array([0.052, 0.040, 0.046, 0.052, 0.040, 0.046]);
  const capCx = new Float32Array(NCAP), capCy = new Float32Array(NCAP), capCz = new Float32Array(NCAP);
  const capB2 = new Float32Array(NCAP);
  let pushX = 0, pushY = 0, pushZ = 0;

  function refreshCapsules() {
    for (let c = 0; c < NCAP; c++) {
      const a = capA[c], b = capB[c];
      capCx[c] = (a.x + b.x) * 0.5; capCy[c] = (a.y + b.y) * 0.5; capCz[c] = (a.z + b.z) * 0.5;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const reach = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5 + Math.max(capR0[c], capR1[c]) + C.margin;
      capB2[c] = reach * reach;
    }
  }

  // Does the point penetrate capsule c? If so, leaves the push-out vector in pushX/Y/Z.
  function capsulePush(c, x, y, z, ox, oz) {
    let dx = x - capCx[c], dy = y - capCy[c], dz = z - capCz[c];
    if (dx * dx + dy * dy + dz * dz > capB2[c]) return false;   // outside the bounding sphere
    const a = capA[c], b = capB[c];
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz || 1;
    let t = ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    dx = x - (a.x + abx * t); dy = y - (a.y + aby * t); dz = z - (a.z + abz * t);
    const r = capR0[c] + (capR1[c] - capR0[c]) * t + C.margin;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return false;
    let d = Math.sqrt(d2);
    if (d < 1e-5) {   // exactly on the axis: push away from the pelvis
      dx = x - ox; dz = z - oz; dy = 0;
      d = Math.sqrt(dx * dx + dz * dz) || 1;
    }
    const k = (r - d) / d;
    pushX = dx * k; pushY = dy * k; pushZ = dz * k;
    return true;
  }

  function computeTargets() {
    const e = pelvis.matrixWorld.elements;
    const e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6], e8 = e[8], e9 = e[9], e10 = e[10];
    const e12 = e[12], e13 = e[13], e14 = e[14];
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const x = restLocal[o], y = restLocal[o + 1], z = restLocal[o + 2];
      tgt[o] = e0 * x + e4 * y + e8 * z + e12;
      tgt[o + 1] = e1 * x + e5 * y + e9 * z + e13;
      tgt[o + 2] = e2 * x + e6 * y + e10 * z + e14;
    }
  }

  // Area-weighted vertex normals from the world-space particles.
  function computeNormals() {
    wn.fill(0);
    for (let t = 0; t < NT; t++) {
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      wn[a] += nx; wn[a + 1] += ny; wn[a + 2] += nz;
      wn[b] += nx; wn[b + 1] += ny; wn[b + 2] += nz;
      wn[c] += nx; wn[c + 1] += ny; wn[c + 2] += nz;
    }
    for (let i = 0; i < N * 3; i += 3) {
      const l = Math.sqrt(wn[i] * wn[i] + wn[i + 1] * wn[i + 1] + wn[i + 2] * wn[i + 2]) || 1;
      wn[i] /= l; wn[i + 1] /= l; wn[i + 2] /= l;
    }
  }

  function reset() {
    p.set(tgt); q.set(tgt); tgtPrev.set(tgt);
    computeNormals();
    wv.fill(0);
  }

  function sampleWind() {
    if (C.windScale <= 0) return;
    // A third of the particles per frame: the wind field is smooth, so a couple of frames' lag is invisible.
    for (let i = frame % 3; i < N; i += 3) {
      if (!free[i]) continue;
      const o = i * 3;
      wind.sample(p[o], p[o + 1], p[o + 2], _skirtWind);
      wv[o] = _skirtWind.x * C.windScale; wv[o + 1] = _skirtWind.y * C.windScale; wv[o + 2] = _skirtWind.z * C.windScale;
    }
  }

  function pinRow0() {
    for (let i = 0; i < N; i++) {
      if (free[i]) continue;
      const o = i * 3;
      q[o] = tgtPrev[o]; q[o + 1] = tgtPrev[o + 1]; q[o + 2] = tgtPrev[o + 2];
      p[o] = tgt[o]; p[o + 1] = tgt[o + 1]; p[o + 2] = tgt[o + 2];
    }
  }

  function step(h, iterations) {
    const hh = h * h, invH = 1 / h;
    const maxMove2 = C.maxMove * C.maxMove, maxAccel2 = C.maxAccel * C.maxAccel;
    for (let i = 0; i < N; i++) {
      if (!free[i]) continue;
      const o = i * 3;
      const x = p[o], y = p[o + 1], z = p[o + 2];
      const vx = (x - q[o]) * C.damping, vy = (y - q[o + 1]) * C.damping, vz = (z - q[o + 2]) * C.damping;
      const nx = wn[o], ny = wn[o + 1], nz = wn[o + 2];
      const rx = wv[o] - vx * invH, ry = wv[o + 1] - vy * invH, rz = wv[o + 2] - vz * invH;
      const rn = rx * nx + ry * ny + rz * nz;
      const press = C.cn * rn * (rn < 0 ? -rn : rn);
      let ax = nx * press + (rx - nx * rn) * C.ct;
      let ay = ny * press + (ry - ny * rn) * C.ct;
      let az = nz * press + (rz - nz * rn) * C.ct;
      const a2 = ax * ax + ay * ay + az * az;
      if (a2 > maxAccel2) { const k = C.maxAccel / Math.sqrt(a2); ax *= k; ay *= k; az *= k; }
      ay += C.gravity;
      let mx = vx + ax * hh, my = vy + ay * hh, mz = vz + az * hh;
      const m2 = mx * mx + my * my + mz * mz;
      if (m2 > maxMove2) { const k = C.maxMove / Math.sqrt(m2); mx *= k; my *= k; mz *= k; }
      q[o] = x; q[o + 1] = y; q[o + 2] = z;
      p[o] = x + mx; p[o + 1] = y + my; p[o + 2] = z + mz;
    }
    pinRow0();

    for (let it = 0; it < iterations; it++) {
      // The soft bend links only need to run every other pass; shear and structural links run on all.
      for (let c = (it & 1) ? nBend : 0; c < NC; c++) {
        const a = cI[c], b = cJ[c];
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const e = (d - cL[c]) / d;
        const wa = e * cWA[c], wb = e * cWB[c];
        p[a] += dx * wa; p[a + 1] += dy * wa; p[a + 2] += dz * wa;
        p[b] -= dx * wb; p[b + 1] -= dy * wb; p[b + 2] -= dz * wb;
      }
      for (let i = 0; i < N; i++) {
        if (!free[i]) continue;
        const o = i * 3, row = rowOf[i];
        if (row < SKIRT_FOLLOW.length) {
          const w = SKIRT_FOLLOW[row] * 0.25;
          p[o] += (tgt[o] - p[o]) * w; p[o + 1] += (tgt[o + 1] - p[o + 1]) * w; p[o + 2] += (tgt[o + 2] - p[o + 2]) * w;
        }
        for (let c = 0; c < NCAP; c++) {
          if (capsulePush(c, p[o], p[o + 1], p[o + 2], tgt[o], tgt[o + 2])) {
            p[o] += pushX; p[o + 1] += pushY; p[o + 2] += pushZ;
          }
        }
      }
      // The faces between particles cut through the legs even when every particle is outside, so
      // also keep the midpoint of each edge and cell clear, moving both ends. Only a few passes
      // (and always the last) are needed: it is a correction on top of the particle collision.
      if (it % 3 === 0 || it === iterations - 1) {
        for (let c = nBend; c < NC; c++) {
          const a = cI[c], b = cJ[c];
          const fa = cFA[c], fb = cFB[c];
          if (!fa && !fb) continue;
          const mx = (p[a] + p[b]) * 0.5, my = (p[a + 1] + p[b + 1]) * 0.5, mz = (p[a + 2] + p[b + 2]) * 0.5;
          for (let k = 0; k < NCAP; k++) {
            if (!capsulePush(k, mx, my, mz, tgt[a], tgt[a + 2])) continue;
            const share = fa && fb ? 1 : 2;
            if (fa) { p[a] += pushX * share; p[a + 1] += pushY * share; p[a + 2] += pushZ * share; }
            if (fb) { p[b] += pushX * share; p[b + 1] += pushY * share; p[b + 2] += pushZ * share; }
          }
        }
      }
      pinRow0();
    }
    tgtPrev.set(tgt);
  }

  // Called every frame after the legs are posed. The cloth keeps its own fixed-step clock.
  // lod: 0 full quality, 1 reduced iterations and one substep (mid distance), 2 skipped (far away).
  function pose(left, right, lod = 0, dtOverride) {
    if (lod >= 2) return;
    const now = performance.now();
    const dt = dtOverride !== undefined ? dtOverride : (now - last) / 1000;
    last = now;
    if (!(dt > 0)) return;

    // Refresh only the transforms we read: the pelvis and the three joints of each leg.
    pelvis.updateWorldMatrix(true, false);
    const legs = [left, right];
    for (let leg = 0; leg < 2; leg++) {
      const L = legs[leg];
      L.hip.updateWorldMatrix(false, false);
      L.knee.updateWorldMatrix(false, false);
      L.ankle.updateWorldMatrix(false, false);
      const h = L.hip.matrixWorld.elements, k = L.knee.matrixWorld.elements, a = L.ankle.matrixWorld.elements;
      hipW[leg].set(h[12], h[13], h[14]);
      kneeW[leg].set(k[12], k[13], k[14]);
      ankleW[leg].set(a[12], a[13], a[14]);
      L.ankle.localToWorld(heelW[leg].set(0, -0.035, -0.03));
      L.ankle.localToWorld(toeW[leg].set(0, -0.05, 0.13));
    }
    computeTargets();
    const e = pelvis.matrixWorld.elements;
    const dxp = e[12] - lastPelvis.x, dyp = e[13] - lastPelvis.y, dzp = e[14] - lastPelvis.z;
    if (dt > 0.5 || dxp * dxp + dyp * dyp + dzp * dzp > 0.49) {   // first frame, long pause or teleport
      reset();
      accumulator = 0;
    }
    lastPelvis.set(e[12], e[13], e[14]);
    refreshCapsules();

    frame++;
    sampleWind();
    accumulator += Math.min(dt, 0.05);
    const maxSteps = lod === 0 ? C.maxSteps : 1;
    const iterations = lod === 0 ? C.iterations : C.lodIterations;
    let steps = 0;
    while (accumulator >= C.step && steps < maxSteps) {
      step(C.step, iterations);
      accumulator -= C.step;
      steps++;
    }
    if (accumulator > C.step) accumulator = 0;
    if (!steps) return;

    computeNormals();
    inverse.copy(pelvis.matrixWorld).invert();
    const m = inverse.elements, out = positions.array, nl = normalAttr.array;
    const r0 = e[0], r1 = e[1], r2 = e[2], r4 = e[4], r5 = e[5], r6 = e[6], r8 = e[8], r9 = e[9], r10 = e[10];
    for (let i = 0; i < N * 3; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      const nx = wn[i], ny = wn[i + 1], nz = wn[i + 2];     // back into pelvis space (rotation only)
      nl[i] = r0 * nx + r1 * ny + r2 * nz;
      nl[i + 1] = r4 * nx + r5 * ny + r6 * nz;
      nl[i + 2] = r8 * nx + r9 * ny + r10 * nz;
    }
    positions.needsUpdate = true;
    normalAttr.needsUpdate = true;
  }

  return { pose };
}

// Closed glove wrapped around the axis of a handle.
function makeGripGlove(mats, side) {
  const hand = new THREE.Group();
  const palm = addMesh(hand, new THREE.SphereGeometry(1, 8, 5), mats.glove);
  palm.scale.set(0.025, 0.035, 0.030);
  palm.position.set(side * 0.023, 0.002, -0.006);

  for (let finger = 0; finger < 4; finger++) {
    const y = 0.022 - finger * 0.016;
    const curl = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.028, y + 0.003, -0.015),
      new THREE.Vector3(side * 0.026, y, 0.019),
      new THREE.Vector3(side * 0.007, y - 0.002, 0.027),
      new THREE.Vector3(side * -0.016, y - 0.003, 0.018),
      new THREE.Vector3(side * -0.019, y, 0.005),
    ]);
    const radius = finger === 3 ? 0.008 : 0.009;
    addMesh(hand, new THREE.TubeGeometry(curl, 5, radius, 5, false), mats.glove);
    const tip = addMesh(hand, new THREE.SphereGeometry(radius, 5, 3), mats.glove);
    tip.position.copy(curl.getPoint(1));
  }

  const thumb = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.027, 0.013, -0.022),
    new THREE.Vector3(side * 0.014, 0.031, -0.024),
    new THREE.Vector3(side * -0.007, 0.027, -0.021),
    new THREE.Vector3(side * -0.016, 0.016, -0.012),
  ]);
  addMesh(hand, new THREE.TubeGeometry(thumb, 4, 0.010, 5, false), mats.glove);
  const thumbTip = addMesh(hand, new THREE.SphereGeometry(0.010, 5, 3), mats.glove);
  thumbTip.position.copy(thumb.getPoint(1));
  return hand;
}

// Sculpted medieval chainmail/leather boot (sloped instep, rounded toe, heel & spur)
function makeTemplarBoot(mats) {
  const grp = new THREE.Group();
  const shape = new THREE.Shape();
  const Z0 = -0.062, Z1 = 0.162, LEN = Z1 - Z0;
  const prof = (u) => {
    const z = Z0 + u * LEN;
    let w;
    if (u < 0.25) w = 0.020 + 0.016 * Math.sin((u / 0.25) * Math.PI * 0.5);
    else if (u < 0.72) w = 0.036 + 0.006 * Math.sin(((u - 0.25) / 0.47) * Math.PI);
    else w = 0.038 * Math.pow(Math.cos(((u - 0.72) / 0.28) * Math.PI * 0.5), 0.75);
    return { z, w };
  };
  for (let i = 0; i <= 8; i++) {
    const { z, w } = prof(i / 8);
    if (i === 0) shape.moveTo(w, z); else shape.lineTo(w, z);
  }
  for (let i = 7; i >= 0; i--) {
    const { z, w } = prof(i / 8);
    shape.lineTo(-w, z);
  }
  shape.closePath();

  const soleGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.014, bevelEnabled: false,
  });
  soleGeo.rotateX(Math.PI * 0.5);
  soleGeo.translate(0, -0.048, 0);
  const sole = new THREE.Mesh(soleGeo, mats.leather);
  sole.castShadow = true;
  grp.add(sole);

  // Shape the leather over the sole. Close the heel and taper to one toe vertex.
  const rings = 7, sides = 7;
  const vertices = [], uvs = [], indices = [];
  for (let i = 0; i < rings; i++) {
    const u = i / rings;
    const { z, w } = prof(u);
    const height = 0.078 - 0.078 * Math.max(0, (u - 0.33) / 0.67);
    for (let j = 0; j <= sides; j++) {
      const t = j / sides;
      const angle = t * Math.PI;
      const rise = Math.sin(angle);
      vertices.push(Math.cos(angle) * w * (1 - 0.16 * rise), -0.048 + height * rise, z);
      uvs.push(t, u);
      if (i < rings - 1 && j < sides) {
        const a = i * (sides + 1) + j, b = a + sides + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }

  const toe = vertices.length / 3;
  vertices.push(0, -0.048, Z1);
  uvs.push(0.5, 1);
  const heel = vertices.length / 3;
  vertices.push(0, -0.048, Z0);
  uvs.push(0.5, 0);
  const lastRing = (rings - 1) * (sides + 1);
  for (let j = 0; j < sides; j++) {
    indices.push(lastRing + j, lastRing + j + 1, toe, heel, j + 1, j);
  }

  const upper = new THREE.BufferGeometry();
  upper.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  upper.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  upper.setIndex(indices);
  upper.computeVertexNormals();
  const upperMesh = addMesh(grp, upper, mats.leather);
  upperMesh.receiveShadow = false;

  // The leather shaft rides the shin, not the ankle, so it stays wrapped around the leg when the
  // foot tilts. Its origin is the ankle joint; the caller parents it to the knee.
  const cuff = new THREE.Group();
  const shaft = addMesh(cuff, new THREE.CylinderGeometry(0.054, 0.047, 0.18, 9), mats.leather);
  shaft.receiveShadow = false;
  shaft.scale.z = 0.94;
  shaft.position.set(0, 0.045, 0.002);
  for (const y of [0.116, 0.040]) {
    const welt = addMesh(cuff, new THREE.CylinderGeometry(0.055, 0.055, 0.008, 9), mats.glove);
    welt.receiveShadow = false;
    welt.scale.z = 0.95;
    welt.position.set(0, y, 0.002);
  }
  return { foot: grp, cuff };
}

// A short bow. Local axes: +Y up the limbs, +Z toward the target; the grip is the origin and the limb tips
// curve back toward the archer. The string is two thin segments meeting at the nock point, which the
// archer drags back with the draw hand.
const BOW_HALF = 0.56, BOW_CURVE = 0.2;
function buildBow(mats) {
  const group = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const y = -BOW_HALF + (i / 10) * 2 * BOW_HALF, u = y / BOW_HALF;
    pts.push(new THREE.Vector3(0, y, -BOW_CURVE * u * u));
  }
  const limb = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.014, 6), mats.wood);
  limb.castShadow = true;
  group.add(limb);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.13, 8), mats.leather);
  group.add(grip);
  const tipTop = new THREE.Vector3(0, BOW_HALF, -BOW_CURVE), tipBottom = new THREE.Vector3(0, -BOW_HALF, -BOW_CURVE);
  const segGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 4);
  const segTop = new THREE.Mesh(segGeo, mats.bowString), segBottom = new THREE.Mesh(segGeo, mats.bowString);
  group.add(segTop, segBottom);
  const nockArrow = new THREE.Mesh(makeArrowGeometry(), arrowMaterial);
  nockArrow.visible = false;
  group.add(nockArrow);

  const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  const seg = (mesh, a, b) => {
    _d.subVectors(b, a);
    const len = _d.length() || 1e-4;
    mesh.position.copy(a).addScaledVector(_d, 0.5);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  };
  const nock = new THREE.Vector3(0, 0, -BOW_CURVE);
  /** Move the nock point (bow-local) and show or hide the nocked arrow. */
  const _zAxis = new THREE.Vector3(0, 0, 1), _dir = new THREE.Vector3();
  /** Move the string's middle (bow-local). */
  function setString(x, y, z) {
    nock.set(x, y, z);
    seg(segTop, tipTop, nock); seg(segBottom, nock, tipBottom);
  }
  /** Show / hide the arrow and place its tail at (x,y,z), pointing along (dx,dy,dz). */
  function setArrow(visible, x, y, z, dx = 0, dy = 0, dz = 1) {
    nockArrow.visible = visible;
    nockArrow.position.set(x, y, z);
    nockArrow.quaternion.setFromUnitVectors(_zAxis, _dir.set(dx, dy, dz).normalize());
  }
  /** String and arrow together, for an arrow nocked on the string. */
  function setNock(x, y, z, showArrow, dx = 0, dy = 0, dz = 1) {
    setString(x, y, z);
    setArrow(showArrow, x, y, z, dx, dy, dz);
  }
  setNock(0, 0, -BOW_CURVE, false);
  return { group, setNock, setString, setArrow, nock };
}

function makeQuiver(mats) {
  const q = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.46, 8, 1, true), mats.leather);
  tube.material = tube.material.clone(); tube.material.side = THREE.DoubleSide;
  q.add(tube);
  const arrowGeo = makeArrowGeometry();
  for (let i = 0; i < 5; i++) {                            // arrow tails sticking out of the top
    const a = new THREE.Mesh(arrowGeo, arrowMaterial);
    const ang = (i / 5) * Math.PI * 2;
    a.rotation.x = Math.PI / 2;                             // tip down into the quiver, fletching sticking out
    a.position.set(Math.cos(ang) * 0.022, 0.40 + 0.02 * (i % 2), Math.sin(ang) * 0.022);
    a.scale.setScalar(0.78);
    q.add(a);
  }
  q.position.set(0.05, 0.17, -0.16);
  q.rotation.set(-0.12, 0, 0.4);
  return q;
}

export function buildTemplarRig(mats = createTemplarMaterials(), opts = {}) {
  const archer = !!opts.archer;
  const root = new THREE.Group();

  const pelvis = new THREE.Group();
  pelvis.position.set(0, 0.94, 0);
  root.add(pelvis);

  const torso = new THREE.Group();
  pelvis.add(torso);

  addMesh(torso, makeSurface(16, 5, (u, v) => {
    const angle = (u - 0.5) * Math.PI * 2;
    const shoulder = Math.sin(Math.PI * v ** 0.7);
    const front = Math.cos(angle);
    return [
      Math.sin(angle) * (0.139 + 0.035 * shoulder),
      0.452 - 0.433 * v,
      front * (0.091 + 0.024 * shoulder),
      u * 1.8,
      1 - v,
    ];
  }), mats.linen);

  for (const front of [true, false]) {
    const cloth = makeSurface(16, 7, (u, v) => {
      const angle = (u - 0.5) * Math.PI + (front ? 0 : Math.PI);
      const neckline = 0.446 - (front ? 0.049 : 0.026) * Math.abs(Math.cos(angle)) ** 4;
      const y = THREE.MathUtils.lerp(neckline, 0.039, v);
      const fold = 0.006 * Math.sin(angle * 16 + v * 7) * Math.sin(Math.PI * v)
        + 0.009 * Math.sin(v * 16 + angle * 3) * Math.sin(Math.PI * v) ** 2;
      const fullness = 0.023 * Math.sin(Math.PI * v);
      const waist = THREE.MathUtils.smoothstep(y, 0.069, 0.132);
      const radius = THREE.MathUtils.lerp(0.134, 0.137 + 0.080 * y + fullness + fold * 0.68, waist);
      return [Math.sin(angle) * radius * 1.16, y, Math.cos(angle) * radius * 0.84];
    });
    addMesh(torso, cloth, front ? mats.surcoatFront : mats.linen);
  }

  // Mail gorget: a closed yoke from the neck collar down over the tabard's scooped neckline,
  // so nothing opens into the hollow torso shell.
  const gorget = makeSurface(24, 10, (u, v) => {
    const angle = (u - 0.5) * Math.PI * 2;
    const cosA = Math.cos(angle);
    const neckline = 0.446 - (cosA > 0 ? 0.049 : 0.026) * Math.abs(cosA) ** 4;
    // Quarter-ellipse from the hem (vertical, hugging the tabard) up to the neck (flat),
    // so it reads as a rounded shoulder cap and chest bib rather than a disc.
    const yTop = 0.486, yEdge = neckline - 0.040;
    const a = (1 - v) * Math.PI / 2;
    const y = yEdge + (yTop - yEdge) * Math.sin(a);
    // Squared-off profile (exponent 0.7) and a 24 mm margin keep the tabard's top edge tucked under
    // the mail all the way round the shoulders (checked: at least 10 mm clear at every angle).
    const edgeRadius = 0.137 + 0.080 * yEdge + 0.024;
    const radius = 0.076 + (edgeRadius - 0.076) * Math.cos(a) ** 0.7;
    return [Math.sin(angle) * radius * 1.16, y, cosA * radius * 0.84, u * 4, 1 - v];
  });
  addMesh(torso, gorget, mats.mail);

  const belt = addMesh(torso, new THREE.CylinderGeometry(0.145, 0.146, 0.043, 16), mats.leather);
  belt.scale.set(1.18, 1, 0.88);
  belt.position.y = 0.049;
  const buckle = addMesh(torso, new THREE.TorusGeometry(0.018, 0.004, 4, 10), mats.steel);
  buckle.position.set(0, 0.049, 0.132);
  const beltEnd = addMesh(torso, new THREE.BoxGeometry(0.028, 0.091, 0.006), mats.leather);
  beltEnd.position.set(0.039, 0.008, 0.136);
  beltEnd.rotation.z = -0.31;

  const seat = addMesh(pelvis, new THREE.SphereGeometry(1, 10, 6), mats.trousers);
  seat.scale.set(0.16, 0.103, 0.102);
  seat.position.y = -0.044;

  const scabbard = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.011, 0.72, 6), mats.leather);
  scabbard.position.set(0.175, -0.18, -0.08);
  scabbard.rotation.set(0.45, 0, -0.15);
  torso.add(scabbard);

  const head = new THREE.Group();
  head.position.set(0, 0.44, 0);
  torso.add(head);

  const collar = addMesh(head, new THREE.CylinderGeometry(0.062, 0.080, 0.096, 12), mats.trousers);
  collar.position.y = 0.017;

  const helm = new THREE.Group();
  helm.position.set(0, 0.163, 0.004);
  head.add(helm);

  // Shape each plate around the head. The upper and lower plates leave a dark gap at eye level.
  function helmetPoint(angle, y, inset = 0) {
    const height = (y + 0.139) / 0.308;
    const width = 0.105 + 0.017 * Math.sin(Math.PI * height) - 0.014 * height;
    const depth = 0.087 + 0.015 * Math.sin(Math.PI * height);
    const x = Math.sin(angle) * (width - inset);
    const round = Math.cos(angle) * (depth - inset);
    // Two flatter cheeks meet at the center of the face.
    const cheek = 0.132 - 0.024 * height - 0.30 * Math.abs(x) - inset;
    const turn = THREE.MathUtils.smoothstep(Math.abs(angle), 0.94, 1.66);
    const z = THREE.MathUtils.lerp(cheek, round, turn);
    const chin = (1 - clamp(height * 7, 0, 1)) * (1 - Math.max(0, Math.cos(angle))) * 0.045;
    return [x, y + chin, z];
  }

  const eyeLine = (angle) => 0.024 + 0.012 * Math.sin(Math.min(Math.abs(angle), 1.1)) ** 2;
  const slitLength = 0.98;
  const slitHeight = 0.014;
  const visorGap = (angle) => slitHeight * clamp((slitLength - Math.abs(angle)) * 11, 0, 1);
  for (const upper of [true, false]) {
    const plate = makeSurface(32, 4, (u, v) => {
      const angle = (u - 0.5) * Math.PI * 2;
      const seam = eyeLine(angle) + visorGap(angle) * (upper ? 0.5 : -0.5);
      const y = upper
        ? THREE.MathUtils.lerp(0.169, seam, v)
        : THREE.MathUtils.lerp(seam, -0.139, v);
      const overlap = upper ? 0 : 0.004 * Math.sin((1 - v) * Math.PI / 2);
      return [...helmetPoint(angle, y, -overlap), u, 1 - (0.169 - y) / 0.308];
    });
    addMesh(helm, plate, mats.helmSteel);
  }

  const visor = makeSurface(14, 1, (u, v) => {
    const angle = (u - 0.5) * (2 * slitLength + 0.12);
    return helmetPoint(angle, eyeLine(angle) + (0.8 - v * 1.6) * slitHeight, 0.013);
  });
  addMesh(helm, visor, mats.dark);

  const crown = new THREE.CircleGeometry(1, 32);
  const crownPos = crown.getAttribute('position');
  for (let i = 0; i < crownPos.count; i++) {
    const x = crownPos.getX(i), z = -crownPos.getY(i);
    const [edgeX, , edgeZ] = helmetPoint(Math.atan2(x, z), 0.169);
    const r = Math.hypot(x, z);
    crownPos.setXYZ(i, edgeX * r, 0.169 + 0.007 * (1 - r * r), edgeZ * r);
  }
  crown.computeVertexNormals();
  addMesh(helm, crown, mats.helmSteel);

  const crownRim = makeSurface(32, 1, (u, v) => {
    const angle = (u - 0.5) * Math.PI * 2;
    return helmetPoint(angle, 0.168 - 0.018 * v, -0.002);
  });
  addMesh(helm, crownRim, mats.helmSteel);

  const nose = makeSurface(2, 5, (u, v) => {
    const angle = (u - 0.5) * (0.09 + 0.13 * Math.sin(v * Math.PI / 2));
    const y = 0.107 - v * 0.240;
    return helmetPoint(angle, y, -0.006 * (0.6 + 0.4 * Math.sin(Math.PI * u)));
  });
  addMesh(helm, nose, mats.helmSteel);

  const rivets = [];
  for (let i = 0; i < 17; i++) {
    rivets.push(helmetPoint((i / 17 - 0.5) * Math.PI * 2, 0.159, -0.003));
  }
  for (const y of [0.084, 0.045, -0.032, -0.079, -0.112]) {
    rivets.push(helmetPoint(0, y, -0.007));
  }
  addRivets(helm, rivets, 0.004, mats.steel);

  function makeArm(s) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.178, 0.427, 0);
    torso.add(sh);

    addMesh(sh, makeSurface(12, 8, (u, v) => {
      const angle = u * Math.PI * 2;
      const cap = Math.sqrt(Math.max(0.0001, 1 - Math.max(0, 1 - v / 0.21) ** 2));
      const radius = cap * (0.063 + 0.009 * Math.sin(Math.PI * v) - 0.014 * v);
      const x = s * (0.012 * v - 0.015 * (1 - v) ** 3);
      return [x + Math.sin(angle) * radius, 0.061 - 0.331 * v, Math.cos(angle) * radius * 0.9, u * 1.1, 1 - v];
    }), mats.mail);

    const el = new THREE.Group();
    el.position.y = -0.27;
    sh.add(el);

    const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.050, 8, 5), mats.mail);
    el.add(elbowJoint);
    const fore = addMesh(el, new THREE.CylinderGeometry(0.049, 0.033, 0.174, 10), mats.mail);
    fore.position.y = -0.088;

    const bracer = addMesh(el, new THREE.LatheGeometry([
      new THREE.Vector2(0.034, -0.265),
      new THREE.Vector2(0.035, -0.244),
      new THREE.Vector2(0.038, -0.212),
      new THREE.Vector2(0.043, -0.186),
      new THREE.Vector2(0.046, -0.161),
      new THREE.Vector2(0.046, -0.150),
      new THREE.Vector2(0.042, -0.145),
    ], 10), mats.glove);
    bracer.receiveShadow = false;
    const wrist = addMesh(el, new THREE.SphereGeometry(1, 8, 5), mats.glove);
    wrist.position.set(0, -0.264, 0.005);
    wrist.scale.set(0.029, 0.027, 0.029);
    return { sh, el };
  }
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // The painted face and steel rim follow the same curved profile.
  const shield = new THREE.Group();
  if (!archer) {
    const outline = new THREE.Shape();
    outline.moveTo(0, 0.46);
    outline.bezierCurveTo(0.16, 0.46, 0.239, 0.31, 0.217, 0.13);
    outline.bezierCurveTo(0.20, -0.08, 0.094, -0.34, 0, -0.53);
    outline.bezierCurveTo(-0.094, -0.34, -0.20, -0.08, -0.217, 0.13);
    outline.bezierCurveTo(-0.239, 0.31, -0.16, 0.46, 0, 0.46);
    const bow = (x) => 0.057 * (1 - (x / 0.23) ** 2);

    const edge = outline.getSpacedPoints(32).slice(0, -1);
    const vertices = [], uvs = [], indices = [];
    const addVertex = (x, y, z) => {
      vertices.push(x, y, z + bow(x));
      uvs.push(0.5 + x / 0.43, (y + 0.53) / 0.99);
      return vertices.length / 3 - 1;
    };
    const addRing = (width, height, z) => edge.map(({ x, y }) => (
      addVertex(x * width, 0.075 + (y - 0.075) * height, z)
    ));
    const addBand = (outer, inner) => {
      for (let i = 0; i < edge.length; i++) {
        const next = (i + 1) % edge.length;
        indices.push(outer[i], inner[i], outer[next], outer[next], inner[i], inner[next]);
      }
    };

    const back = addRing(1, 1, 0);
    const rim = addRing(1, 1, 0.020);
    const border = addRing(0.92, 0.973, 0.025);
    const centerBack = addVertex(0, 0.075, 0);
    addBand(back, rim);
    addBand(rim, border);
    for (let i = 0; i < edge.length; i++) indices.push(back[i], back[(i + 1) % edge.length], centerBack);

    const rimCount = indices.length;
    const inner = addRing(0.47, 0.50, 0.025);
    const centerFront = addVertex(0, 0.075, 0.025);
    addBand(border, inner);
    for (let i = 0; i < edge.length; i++) indices.push(inner[i], centerFront, inner[(i + 1) % edge.length]);

    const plate = new THREE.BufferGeometry();
    plate.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    plate.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    plate.setIndex(indices);
    plate.addGroup(0, rimCount, 0);
    plate.addGroup(rimCount, indices.length - rimCount, 1);
    plate.computeVertexNormals();
    addMesh(shield, plate, [mats.shieldRim, mats.shieldFace]);

    const rivets = [];
    for (let i = 0; i < edge.length; i += 2) {
      const { x, y } = edge[i];
      rivets.push([x * 0.968, 0.075 + (y - 0.075) * 0.986, 0.022 + bow(x * 0.968)]);
    }
    addRivets(shield, rivets, 0.0048, mats.steel);
    shield.rotation.set(0.59, 0.93, -0.13);
    shield.position.set(0.121, 0.012, 0.117);
    armL.el.add(shield);

    // Fit the two shield straps between the board and the arm.
    for (const [boardY, forearmY] of [[-0.08, -0.071], [-0.27, -0.242]]) {
      const board = new THREE.Vector3(-0.024, boardY, 0.056)
        .applyQuaternion(shield.quaternion)
        .add(shield.position);
      const forearm = new THREE.Vector3(0.028, forearmY, 0.020);
      const strapGeometry = new THREE.BoxGeometry(0.044, board.distanceTo(forearm), 0.011);
      const strap = addMesh(armL.el, strapGeometry, mats.leather);
      strap.position.copy(board).lerp(forearm, 0.5);
      strap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), board.sub(forearm).normalize());
    }

    const shieldHand = makeGripGlove(mats, -1);
    shieldHand.position.set(0.021, -0.282, 0.026);
    shieldHand.rotation.set(1.39, 0.38, -0.17);
    addMesh(shieldHand, new THREE.CylinderGeometry(0.011, 0.011, 0.084, 6), mats.leather);
    armL.el.add(shieldHand);
  }

  const sword = new THREE.Group();
  sword.position.set(0.019, -0.288, 0.017);
  sword.rotation.set(1.58, 0.10, -0.44);
  const bladeRoll = -0.74;
  sword.rotateY(bladeRoll);
  armR.el.add(sword);

  const swordHand = makeGripGlove(mats, -1);
  swordHand.position.y = -0.015;
  swordHand.rotation.y = -bladeRoll;
  sword.add(swordHand);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 8), mats.leather);
  grip.position.y = -0.021;
  const pommel = new THREE.Mesh(new THREE.DodecahedronGeometry(0.023), mats.steel);
  pommel.scale.set(0.86, 1, 0.64);
  pommel.position.y = -0.097;

  const guardShape = new THREE.Shape();
  guardShape.moveTo(-0.077, 0.087);
  guardShape.quadraticCurveTo(0, 0.038, 0.077, 0.087);
  guardShape.lineTo(0.078, 0.073);
  guardShape.quadraticCurveTo(0, 0.019, -0.078, 0.073);
  guardShape.closePath();
  addMesh(sword, new THREE.ExtrudeGeometry(guardShape, {
    depth: 0.014, bevelSize: 0.0025, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 4,
  }).translate(0, 0, -0.007), mats.steel);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.020, BLADE_BASE);
  bladeShape.lineTo(0.020, BLADE_BASE);
  bladeShape.lineTo(0.014, 0.780);
  bladeShape.lineTo(0, BLADE_TIP);
  bladeShape.lineTo(-0.014, 0.780);
  bladeShape.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.003, bevelSize: 0.003, bevelThickness: 0.002, bevelSegments: 1,
  });
  addMesh(sword, bladeGeometry, mats.blade);
  sword.add(grip, pommel);

  // --- Articulated Legs & Lofted Medieval Boots ---
  function makeLeg(s) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.095, -0.02, 0);
    pelvis.add(hip);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.052, 0.449, 8, 1, true), mats.trousers);
    thigh.position.y = -0.215;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);

    const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(0.051, 8, 5), mats.trousers);
    knee.add(kneeJoint);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.029, 0.437, 8, 1, true), mats.trousers);
    shin.position.y = -0.205;
    shin.castShadow = true;
    knee.add(shin);

    const ankle = new THREE.Group();
    ankle.position.y = -0.42;
    knee.add(ankle);

    const boot = makeTemplarBoot(mats);
    ankle.add(boot.foot);
    boot.cuff.position.y = -0.42;
    knee.add(boot.cuff);

    return { hip, knee, ankle };
  }
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  const skirt = createSurcoatSkirt(pelvis, mats.linen);
  batchRigidMeshes(root);
  sword.userData.baseQuat = sword.quaternion.clone();

  // Archer: no shield, no blade (the right glove stays, to hold the string); a bow, and a quiver on the back.
  let bow = null;
  if (archer) {
    for (const c of sword.children) if (c !== swordHand) c.visible = false;
    const bowHand = makeGripGlove(mats, -1);
    bowHand.position.set(0.021, -0.282, 0.026);
    bowHand.rotation.set(1.39, 0.38, -0.17);
    armL.el.add(bowHand);
    torso.add(makeQuiver(mats));
    bow = buildBow(mats);
    root.add(bow.group);
  }
  // The shield stays square to the chest in the clips: remember how it sits against the torso in a plain guard.
  if (!archer) {
    const savedSh = armL.sh.rotation.clone(), savedEl = armL.el.rotation.clone();
    armL.sh.rotation.set(-0.24, 0, 0.30); armL.el.rotation.set(-0.78, 0, 0);
    root.updateMatrixWorld(true);
    const qT = torso.getWorldQuaternion(new THREE.Quaternion()), qS = shield.getWorldQuaternion(new THREE.Quaternion());
    shield.userData.chestRel = qT.invert().multiply(qS);
    shield.userData.baseQuat = shield.quaternion.clone();
    armL.sh.rotation.copy(savedSh); armL.el.rotation.copy(savedEl);
    root.updateMatrixWorld(true);
  }
  return { root, pelvis, torso, head, armL, armR, legL, legR, sword, shield, skirt, bow };
}

export function setTemplarLowerTPose(r) {
  r.pelvis.position.set(0, 0.94, 0);
  r.pelvis.rotation.set(0, 0, 0);
  r.torso.rotation.set(0, 0, 0);
  r.head.rotation.set(0, 0, 0);
  r.armL.sh.rotation.set(0, 0, 0.72);
  r.armL.el.rotation.set(0, 0, 0);
  r.armR.sh.rotation.set(0, 0, -0.72);
  r.armR.el.rotation.set(0, 0, 0);
  r.legL.hip.rotation.set(0, 0, 0.04);
  r.legL.knee.rotation.set(0, 0, 0);
  r.legL.ankle.rotation.set(0, 0, 0);
  r.legR.hip.rotation.set(0, 0, -0.04);
  r.legR.knee.rotation.set(0, 0, 0);
  r.legR.ankle.rotation.set(0, 0, 0);
  r.sword.quaternion.copy(r.sword.userData.baseQuat);
  restoreGear(r);
  r.skirt.pose(r.legL, r.legR);
}


// Test the blade segment against the axis of the player capsule.
function bladeHitsPlayer(start, end, pos, contact) {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const px = pos.x - start.x, pz = pos.z - start.z;
  const strideSq = dx * dx + dz * dz;
  const fromFloor = pos.y + R, toHead = pos.y + HEIGHT - R;
  const dotXZ = px * dx + pz * dz;
  let t = strideSq > 1e-10 ? clamp(dotXZ / strideSq, 0, 1) : 0;
  const bladeY = start.y + dy * t;
  const capY = clamp(bladeY, fromFloor, toHead);
  if (bladeY !== capY) {
    t = clamp((dotXZ + (capY - start.y) * dy) / (strideSq + dy * dy), 0, 1);
  }

  contact.copy(start).lerp(end, t);
  const deltaY = contact.y - clamp(contact.y, fromFloor, toHead);
  const deltaX = contact.x - pos.x, deltaZ = contact.z - pos.z;
  return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ <= (R + 0.047) ** 2;
}

function easeRotation(rotation, x, y, z, amount) {
  rotation.set(rotation.x + (x - rotation.x) * amount,
    rotation.y + (y - rotation.y) * amount, rotation.z + (z - rotation.z) * amount);
}

// Planted-foot gait. Each foot has a stance half (moves backward relative to the body at exactly the
// body's speed, so it stays put on the ground) and a swing half (eases forward with the knee lifted).
const LEG_LEN = 0.86;
const TAU = Math.PI * 2;
function footOffset(phase, stride) {
  const p = ((phase % TAU) + TAU) % TAU;
  if (p < Math.PI) return { c: stride * 0.5 * (1 - 2 * p / Math.PI), swing: 0 };
  const w = (p - Math.PI) / Math.PI;
  return { c: -stride * 0.5 + stride * (1 - Math.cos(Math.PI * w)) * 0.5, swing: w };
}

export function createTemplars(scene) {
  const mats = createTemplarMaterials();
  const archerMats = createArcherMaterials(mats);

  const SPAWNS = [
    { pts: [[-2.5, 3.2], [2.5, 3.2]], yaw: 0 },
    { pts: [[5.5, 8.5], [5.5, 14.5]], yaw: Math.PI },
    { pts: [[-10.5, 7.5], [-6.5, 10.5]], yaw: 0.5 },
    { pts: [[10.0, 8.6], [10.0, 10.2]], yaw: -1.2 },
    // archers hold their ground (one on the platform at the top of the stairs, one on open ground)
    { pts: [[10.2, 9.9]], yaw: Math.PI, archer: true },
    { pts: [[-9.5, 11.5]], yaw: Math.PI, archer: true },
    ...towerSpawns,
  ];

  const _bbox = new THREE.Box3(), _bsize = new THREE.Vector3();
  const knights = SPAWNS.map((sp) => {
    const rig = buildTemplarRig(sp.archer ? archerMats : mats, { archer: !!sp.archer });
    const x = sp.pts[0][0], z = sp.pts[0][1];
    const y = sp.y !== undefined ? groundHeight(x, z, sp.y + 1.0, 1.0) : groundHeight(x, z, 6.0, 0.5);
    rig.root.position.set(x, y, z);
    rig.root.rotation.order = 'YXZ';   // yaw first, then the fall backward when knocked down
    rig.root.rotation.y = sp.yaw;
    scene.add(rig.root);

    // Shadow casters: parts under ~13 cm (rivets, buckles, welts, fingers) cast shadows nobody can see,
    // so they never cast. The rest are listed so a distant knight can switch all of them off at once.
    const shadowMeshes = [];
    rig.root.updateMatrixWorld(true);
    rig.root.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      _bbox.setFromObject(o).getSize(_bsize);
      if (Math.max(_bsize.x, _bsize.y, _bsize.z) < 0.13) o.castShadow = false;
      else shadowMeshes.push(o);
    });

    return {
      rig, shadowMeshes, castingShadows: true,
      archer: !!sp.archer, towerArcher: !!sp.towerArcher, shoot: null, cool: 1.0, sightT: 0, t: Math.random() * 10, alertUntil: 0,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      yaw: sp.yaw,
      pts: sp.pts,
      wp: 1,
      gait: Math.random() * Math.PI * 2,
      state: 'patrol',
      atkT: 0,
      hitCooldown: 0,
      hitDone: false,
      moveBlend: 0,
      strideX: 0,
      stride: 0.5,
      speedEst: 0,
      aim: { yaw: 0, pitch: 0 },
      hp: KNIGHT_HP, stun: 0, down: 0, fall: 0, gettingUp: false, fallKind: 'back', riseDur: GETUP_DURATION, downTotal: 0, knockX: 0, knockZ: 0, knockSpeed: 0, hitSwing: -1,
      moveName: 'lunge', mv: null, mvAngle: 0, mvScale: 1, mvRoot: new THREE.Vector3(),
      strafeBlend: 0, strafePhase: 0,
      strideZ: 1,
      windup: new Float32Array(18),
      upperPose: [rig.torso, rig.head, rig.armR.sh, rig.armR.el, rig.armL.sh, rig.armL.el].map(bone => bone.rotation),
    };
  });

  const tactics = createTemplarTactics(knights, KNIGHT_RADIUS, KNIGHT_HEIGHT);
  const bladeStart = new THREE.Vector3(), bladeEnd = new THREE.Vector3(), contact = new THREE.Vector3();

  function resolvePlayer(char, previousX, previousZ) {
    for (let pass = 0; pass < 2; pass++) {
      let adjusted = false;
      for (const knight of knights) {
        if (knight.down > 0) continue;
        adjusted = separateCapsule(char.pos, char.vel, R, HEIGHT, knight.pos, KNIGHT_RADIUS, KNIGHT_HEIGHT) || adjusted;
      }
      if (!adjusted) return;
      pushOut(char.pos, char.vel);
    }
    for (const knight of knights) {
      if (knight.down > 0) continue;
      if (capsuleOverlap(char.pos, R, HEIGHT, knight.pos, KNIGHT_RADIUS, KNIGHT_HEIGHT) < 1e-5) continue;
      char.pos.x = previousX;
      char.pos.z = previousZ;
      pushOut(char.pos, char.vel);
      return;
    }
  }

  function moveKnight(knight, vx, vz, speed, dt, char) {
    const pos = knight.pos, vel = knight.vel;
    const startX = pos.x, startZ = pos.z;
    if (knight.state === 'attack') {
      vel.set(vx * speed, 0, vz * speed);
    } else {
      const response = 1 - Math.exp(-(speed > 0.05 ? 13 : 19) * dt);
      vel.x += (vx * speed - vel.x) * response;
      vel.z += (vz * speed - vel.z) * response;
      if (vel.x * vel.x + vel.z * vel.z < 0.01 ** 2) vel.set(0, 0, 0);
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(vel.x, vel.z) * dt / 0.12));
    const step = dt / steps;
    for (let i = 0; i < steps; i++) {
      const x = pos.x, z = pos.z;
      pos.x += vel.x * step;
      pos.z += vel.z * step;
      pushOut(pos, vel, KNIGHT_RADIUS, KNIGHT_HEIGHT);
      let separated = false;
      for (const other of knights) {
        if (other === knight) continue;
        separated = separateCapsule(pos, vel, KNIGHT_RADIUS, KNIGHT_HEIGHT, other.pos, KNIGHT_RADIUS, KNIGHT_HEIGHT) || separated;
      }
      if (!char.isBat) {
        separated = separateCapsule(pos, vel, KNIGHT_RADIUS, KNIGHT_HEIGHT, char.pos, R, HEIGHT, -1) || separated;
      }
      if (!separated) continue;
      pushOut(pos, vel, KNIGHT_RADIUS, KNIGHT_HEIGHT);

      // Retain the last free position if a wall and another capsule trap this step.
      let overlapsKnight = false;
      for (const other of knights) {
        if (other !== knight && capsuleOverlap(pos, KNIGHT_RADIUS, KNIGHT_HEIGHT, other.pos, KNIGHT_RADIUS, KNIGHT_HEIGHT) > 1e-5) {
          overlapsKnight = true;
          break;
        }
      }
      const overlapsPlayer = !char.isBat
        && capsuleOverlap(pos, KNIGHT_RADIUS, KNIGHT_HEIGHT, char.pos, R, HEIGHT) > 1e-5;
      if (overlapsKnight || overlapsPlayer) {
        pos.x = x;
        pos.z = z;
        vel.set(0, 0, 0);
        break;
      }
    }
    return Math.hypot(pos.x - startX, pos.z - startZ);
  }

  // Does the blade cross the player during the part of the move that can hurt? The blade is sampled along the
  // move (about every 11 ms) so a fast slash cannot skip him between frames.
  function checkStrike(knight, previousTime, char, sp) {
    const mv = knight.mv;
    if (knight.hitDone || char.isBat || knight.atkT < mv.strikeFrom || previousTime > mv.strikeTo
      || knight.pos.distanceToSquared(char.pos) > 16) return;

    const first = Math.max(previousTime, mv.strikeFrom);
    const last = Math.min(knight.atkT, mv.strikeTo);
    const samples = Math.max(1, Math.ceil((last - first) * 90));
    const rig = knight.rig;
    const sword = rig.sword;
    for (let i = 0; i <= samples; i++) {
      poseMove(rig, mv, frameAt(mv, THREE.MathUtils.lerp(first, last, i / samples)), 1);
      sword.updateWorldMatrix(true, false);
      bladeStart.set(0, BLADE_BASE, 0).applyMatrix4(sword.matrixWorld);
      bladeEnd.set(0, BLADE_TIP, 0).applyMatrix4(sword.matrixWorld);
      if (!bladeHitsPlayer(bladeStart, bladeEnd, char.pos, contact)) continue;
      const pos = knight.pos;
      if (lineBlocked(pos.x, pos.y + 1.25, pos.z, bladeStart.x, bladeStart.y, bladeStart.z)
        || lineBlocked(bladeStart.x, bladeStart.y, bladeStart.z, contact.x, contact.y, contact.z)
        || lineBlocked(contact.x, contact.y, contact.z, char.pos.x, clamp(contact.y, char.pos.y + R, char.pos.y + HEIGHT - R), char.pos.z)) continue;

      const dx = char.pos.x - pos.x, dz = char.pos.z - pos.z;
      const impulse = 6.5 / Math.max(0.1, Math.hypot(dx, dz));
      char.vel.x += dx * impulse;
      char.vel.z += dz * impulse;
      char.knockT = 0.5;                                // pushed back, but he keeps facing the way he was
      char.vy = Math.max(char.vy, 3.2);
      char.grounded = false;
      char.jumpPhase = 'air';
      sp?.squash?.kick(-1.1);
      knight.hitDone = true;
      break;
    }
  }

  // Being hit: a stagger with knockback; the third punch knocks the knight down for a few seconds,
  // after which he gets back up with full health.
  /* ---------------------------------- archers ---------------------------------- */
  const ARCHER_RANGE = 28, TOWER_ARCHER_RANGE = 62, ARROW_SPEED = 26, TOWER_ARROW_SPEED = 36, GRAV = 9.8;
  let ACC_LEAD = 0.25;                       // weight of the acceleration term (0.5 is the full physical value)
  const arrows = createArrows(scene);
  const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _Pn = new THREE.Vector3();
  const _muzzle = new THREE.Vector3(), _mdir = new THREE.Vector3(), _handP = new THREE.Vector3();

  // Where to point so that an arrow leaving `S` meets the player: lead on his velocity (a few iterations
  // of "how long will it fly"), and let gravity pull it down on the way.
  // Tower archers shoot higher-velocity arrows and use 6-iteration precision lead with higher acceleration weighting.
  function solveAim(S, char, tg, out, isTower = false) {
    const arSpeed = isTower ? TOWER_ARROW_SPEED : ARROW_SPEED;
    const accLead = isTower ? 0.44 : ACC_LEAD;
    const iters = isTower ? 6 : 4;
    _T.set(char.pos.x, char.pos.y + (char.isBat ? BAT_CENTER_Y : 1.1), char.pos.z);
    let t = S.distanceTo(_T) / arSpeed;
    // Lead on velocity AND acceleration (a bat turns hard), iterating because the flight time depends on
    // where the target will be.
    for (let i = 0; i < iters; i++) {
      const h = accLead * t * t;
      _Pn.set(_T.x + tg.vx * t + tg.ax * h, _T.y + tg.vy * t + tg.ay * h, _T.z + tg.vz * t + tg.az * h);
      t = Math.max(0.05, S.distanceTo(_Pn) / arSpeed);
    }
    out.vx = (_Pn.x - S.x) / t; out.vz = (_Pn.z - S.z) / t; out.vy = (_Pn.y - S.y) / t + 0.5 * GRAV * t;
    out.yaw = Math.atan2(out.vx, out.vz);
    out.pitch = Math.atan2(out.vy, Math.hypot(out.vx, out.vz));
  }

  // What the archer knows about the player's motion: velocity from the sim (exact), and an acceleration
  // estimated from how that velocity changes, smoothed over about 150 ms.
  function trackTarget(k, char, dt) {
    let t = k.tgt;
    const vy = char.vy || 0;
    if (!t) { k.tgt = { vx: char.vel.x, vy, vz: char.vel.z, ax: 0, ay: 0, az: 0 }; return; }
    if (dt <= 0) return;
    const kb = 1 - Math.exp(-(k.towerArcher ? 12 : 7) * dt);
    const ax = (char.vel.x - t.vx) / dt, ay = (vy - t.vy) / dt, az = (char.vel.z - t.vz) / dt;
    const am = Math.hypot(ax, ay, az), cap = 40;
    const s = am > cap ? cap / am : 1;                       // ignore collision / morph spikes
    t.ax += (ax * s - t.ax) * kb; t.ay += (ay * s - t.ay) * kb; t.az += (az * s - t.az) * kb;
    t.vx = char.vel.x; t.vy = vy; t.vz = char.vel.z;
  }

  function carryBowNow(k) {
    const r = k.rig;
    r.root.updateWorldMatrix(true, false);
    r.armL.el.updateWorldMatrix(true, false);
    _handP.set(0.021, -0.30, 0.03);
    r.armL.el.localToWorld(_handP);
    r.root.worldToLocal(_handP);
    carryBow(r, _handP);
  }

  // Movement intent and the shot sequence's timing; the pose itself is applied after the normal gait.
  function updateArcher(k, dt, char) {
    k.t += dt;
    trackTarget(k, char, dt);
    k.cool = Math.max(0, k.cool - dt);
    const dx = char.pos.x - k.pos.x, dz = char.pos.z - k.pos.z, dist = Math.hypot(dx, dz);
    k.sightT -= dt;
    if (k.sightT <= 0) {
      k.sightT = k.towerArcher ? 0.08 : 0.15;
      let sees;
      if (k.towerArcher) {
        // Tower sniper archers fire when the bat is spotted by the rooftop spotlights (or flies up near their tower)!
        const highBat = char.isBat && char.pos.y > 4.5 && dist < 38;
        sees = (!!char.spottedBySpotlight || highBat || k.t < k.alertUntil) && dist < TOWER_ARCHER_RANGE;
        if (sees && lineBlocked(k.pos.x, k.pos.y + 1.55, k.pos.z, char.pos.x, char.pos.y + (char.isBat ? BAT_CENTER_Y : 1.2), char.pos.z)) sees = false;
      } else {
        sees = dist < ARCHER_RANGE && Math.abs(char.pos.y - k.pos.y) < 9;
        // in front of him, unless he is already alerted (then all round)
        if (sees && k.t > k.alertUntil && Math.abs(shortAngle(Math.atan2(dx, dz) - k.yaw)) > 1.7) sees = false;
        if (sees && lineBlocked(k.pos.x, k.pos.y + 1.55, k.pos.z, char.pos.x, char.pos.y + (char.isBat ? BAT_CENTER_Y : 1.2), char.pos.z)) sees = false;
      }
      k.sees = sees;
      if (sees) { k.alertUntil = k.t + (k.towerArcher ? 8 : 6); k.knownX = char.pos.x; k.knownY = char.pos.y; k.knownZ = char.pos.z; }
    }
    const alert = k.t < k.alertUntil;
    if (!k.shoot && k.sees && k.cool <= 0 && dist > (k.towerArcher ? 2.0 : 3.2) && k.stun <= 0 && k.down <= 0) {
      const holdTime = k.towerArcher ? (0.22 + Math.random() * 0.16) : (0.45 + Math.random() * 0.35);
      k.shoot = { phase: 0, t: 0, hold: holdTime, loosed: false, aim: { yaw: k.yaw, pitch: 0.1, vx: 0, vy: 0, vz: 1 } };
    }
    k.speed = 0; k.routeX = k.pos.x; k.routeZ = k.pos.z; k.state = 'patrol'; k.role = 'patrol';
    if (k.shoot) {
      if (k.shoot.phase < 2 || ((char.isBat || k.towerArcher) && !k.shoot.loosed)) {
        k.yaw += shortAngle(Math.atan2(dx, dz) - k.yaw) * (1 - Math.exp(-(k.towerArcher ? 12 : 7) * dt));   // square up to the target
      }
    } else if (!k.towerArcher && alert && dist < 6.5) {                   // too close: back away, still facing him (ground archers only)
      k.state = 'chase'; k.role = 'retreat';
      const away = Math.atan2(-dx, -dz);
      k.routeX = k.pos.x + Math.sin(away) * 4; k.routeZ = k.pos.z + Math.cos(away) * 4;
      k.speed = 1.9; k.knownX = char.pos.x; k.knownZ = char.pos.z;
    } else if (!alert) {
      k.yaw += Math.sin(k.t * 0.45) * 0.25 * dt;                           // idle: slowly scanning
    }
  }

  function loose(k, s, char) {
    s.loosed = true;
    const r = k.rig, a = s.aim;
    const baseSpeed = k.towerArcher ? TOWER_ARROW_SPEED : ARROW_SPEED;
    const speed = Math.hypot(a.vx, a.vy, a.vz) || baseSpeed;
    // Tower sniper archers have near-pinpoint accuracy (0.0015 spread vs 0.008/0.03)
    const spread = k.towerArcher ? 0.0015 : (char.isBat ? 0.008 : 0.03);
    bowMuzzle(r, _muzzle, _mdir);
    // The aim so far assumed a rough shooting point; the arrow actually leaves from the nock, which can be half
    // a metre away. Solve once more from there, so the lead is right for where the arrow really starts.
    solveAim(_muzzle, char, k.tgt, a, k.towerArcher);
    const sp2 = Math.hypot(a.vx, a.vy, a.vz) || speed;
    arrows.spawn(_muzzle.x, _muzzle.y, _muzzle.z,
      a.vx + (Math.random() - 0.5) * 2 * spread * sp2,
      a.vy + (Math.random() - 0.5) * 2 * spread * sp2,
      a.vz + (Math.random() - 0.5) * 2 * spread * sp2);
  }

  function poseShot(k, dt, char) {
    const r = k.rig, s = k.shoot;
    if (!s) { carryBowNow(k); return; }
    s.t += dt;
    let frame;
    if (s.phase === 0) {
      frame = drawFrame(s.t);
      if (frame >= DRAW.to) { s.phase = 1; s.t = 0; frame = HOLD.from; }
    } else if (s.phase === 1) {
      frame = holdFrame(s.t, s.hold);
      if (s.t >= s.hold) { s.phase = 2; s.t = 0; frame = RELEASE.from; }       // aim is locked from here
    } else {
      frame = releaseFrame(s.t);
    }
    // Keep re-solving while aiming. A man's aim locks when the release starts (a late dodge works); a bat is
    // too fast for that (and tower archers track continuously), so the archer keeps tracking right up to release.
    if (s.phase < 2 || ((char.isBat || k.towerArcher) && !s.loosed)) {
      _S.set(k.pos.x, k.pos.y + 1.5, k.pos.z);
      solveAim(_S, char, k.tgt, s.aim, k.towerArcher);
    }
    const w = s.phase === 0 ? THREE.MathUtils.smoothstep(s.t, 0, 0.25)
      : s.phase === 1 ? 1 : 1 - THREE.MathUtils.smoothstep(frame, RELEASE.to - 8, RELEASE.to);
    poseArcher(r, Math.min(frame, RELEASE.to), w, THREE.MathUtils.clamp(shortAngle(s.aim.yaw - k.yaw), -1.2, 1.2), THREE.MathUtils.clamp(s.aim.pitch, -1.1, 1.1), s.loosed);
    if (s.phase === 2 && !s.loosed && frame >= RELEASE.loose) loose(k, s, char);
    if (s.phase === 2 && frame >= RELEASE.to) {
      k.shoot = null;
      k.cool = k.towerArcher ? (0.28 + Math.random() * 0.32) : (0.5 + Math.random() * 0.7);
      carryBowNow(k);
    }
  }

  // Get-up: the Mixamo stand-up clip, retargeted (templar-getup.js). The fall pivots the whole root about the
  // feet; the get-up instead places the pelvis explicitly, starting from exactly the fallen pose, and the
  // knight's origin is moved under the pelvis at the end.
  const _endP = new THREE.Vector3();
  function getUp(k, view) {
    const r = k.rig;
    if (k.fallKind === 'front') {                          // from lying face down: the death clip, backwards
      if (!k.gettingUp) {
        k.gettingUp = true;
        r.root.position.set(k.pos.x, k.pos.y, k.pos.z);
        r.root.rotation.set(0, k.yaw, 0);
      }
      const t = k.riseDur - k.down;
      poseRiseFront(r, t, 1);
      if (k.archer) carryBowNow(k);
      const seenF = !view || (_sphere.center.set(k.pos.x, k.pos.y + 0.5, k.pos.z), view.intersectsSphere(_sphere));
      r.skirt.pose(r.legL, r.legR, seenF ? 0 : 2);
      return;
    }
    if (!k.gettingUp) {
      k.gettingUp = true;
      r.root.position.set(k.pos.x, k.pos.y, k.pos.z);
      r.root.rotation.set(0, k.yaw, 0);
      r.pelvis.position.copy(FALLEN_PELVIS);
      r.pelvis.quaternion.copy(FALLEN_QUAT);
      k.fall = 1;
    }
    const t = k.riseDur - k.down;
    poseGetUp(r, Math.min(GETUP_TO, GETUP_FROM + t * GETUP_FPS), THREE.MathUtils.smoothstep(t, 0, 0.3));
    restoreGear(r);
    if (k.archer) carryBowNow(k);
    const seen = !view || (_sphere.center.set(k.pos.x, k.pos.y + 0.5, k.pos.z), view.intersectsSphere(_sphere));
    r.skirt.pose(r.legL, r.legR, seen ? 0 : 2);
  }
  function endGetUp(k) {
    if (k.fallKind === 'front') {                          // the clip ended standing where he fell: no shift needed
      k.rig.root.position.copy(k.pos);
      k.rig.root.rotation.set(0, k.yaw, 0);
      k.gettingUp = false; k.fall = 0; k.vel.set(0, 0, 0); k.knockSpeed = 0;
      return;
    }
    const r = k.rig, e = endPelvis(_endP), cs = Math.cos(k.yaw), sn = Math.sin(k.yaw);
    k.pos.x += e.x * cs + e.z * sn;
    k.pos.z += -e.x * sn + e.z * cs;
    k.pos.y = groundHeight(k.pos.x, k.pos.z, k.pos.y);
    r.pelvis.position.set(0, e.y, 0);
    r.root.position.copy(k.pos);
    r.root.rotation.set(0, k.yaw, 0);
    k.gettingUp = false; k.fall = 0; k.vel.set(0, 0, 0); k.knockSpeed = 0;
  }

  // Falling forward onto his face, then lying there (the death clip: reel, knees go, topple).
  function frontDown(k, dt, char, view) {
    const r = k.rig;
    const t = k.downTotal - k.down;
    k.knockSpeed *= Math.exp(-5.5 * dt);
    moveKnight(k, k.knockX, k.knockZ, k.knockSpeed, dt, char);
    k.pos.y += (groundHeight(k.pos.x, k.pos.z, k.pos.y) - k.pos.y) * (1 - Math.exp(-14 * dt));
    k.moveBlend += (0 - k.moveBlend) * (1 - Math.exp(-14 * dt));
    k.fall = 1;
    r.root.position.set(k.pos.x, k.pos.y, k.pos.z);
    r.root.rotation.set(0, k.yaw, 0);
    poseFallFront(r, t, THREE.MathUtils.smoothstep(t, 0, 0.15));
    if (k.archer) carryBowNow(k);
    const seen = !view || (_sphere.center.set(k.pos.x, k.pos.y + 0.5, k.pos.z), view.intersectsSphere(_sphere));
    r.skirt.pose(r.legL, r.legR, seen ? 0 : 2);
  }

  function reactKnight(k, dt, char, view) {
    const r = k.rig;
    const response = 1 - Math.exp(-14 * dt);
    if (k.stun > 0) k.stun = Math.max(0, k.stun - dt);
    let fallTarget = 0;
    if (k.down > 0) {
      k.down -= dt;
      fallTarget = 1;
      if (k.down <= 0) { k.down = 0; k.hp = KNIGHT_HP; if (k.gettingUp) endGetUp(k); }
      else if (k.down <= k.riseDur) { getUp(k, view); return; }       // the last stretch of the knock-down is the get-up clip
      else if (k.fallKind === 'front') { frontDown(k, dt, char, view); return; }
    }
    k.fall += (fallTarget - k.fall) * (1 - Math.exp(-9 * dt));
    k.knockSpeed *= Math.exp(-5.5 * dt);
    moveKnight(k, k.knockX, k.knockZ, k.knockSpeed, dt, char);
    const gy = groundHeight(k.pos.x, k.pos.z, k.pos.y);
    k.pos.y += (gy - k.pos.y) * (1 - Math.exp(-14 * dt));
    k.moveBlend += (0 - k.moveBlend) * response;

    r.root.position.set(k.pos.x, k.pos.y + k.fall * 0.13, k.pos.z);
    r.root.rotation.y = k.yaw;
    r.root.rotation.x = -k.fall * Math.PI * 0.5;

    const f = Math.min(1, k.stun / STUN_TIME);
    const flop = Math.max(f, k.fall);
    r.pelvis.position.y += (0.94 - 0.05 * f - r.pelvis.position.y) * response;
    easeRotation(r.pelvis.rotation, 0, 0, 0, response);
    easeRotation(r.torso.rotation, -0.55 * f, 0.18 * f, 0, response);
    easeRotation(r.head.rotation, 0.35 * f - 0.1 * k.fall, 0, 0, response);
    easeRotation(r.armR.sh.rotation, -0.5 * f, 0, -0.35 - 0.9 * flop, response);
    easeRotation(r.armR.el.rotation, -0.3 - 0.4 * f, 0, 0, response);
    easeRotation(r.armL.sh.rotation, -0.6 * f, 0, 0.35 + 0.9 * flop, response);
    easeRotation(r.armL.el.rotation, -0.5 - 0.3 * f, 0, 0, response);
    for (const [leg, side] of [[r.legL, 1], [r.legR, -1]]) {
      easeRotation(leg.hip.rotation, -0.18 * f * side, 0, side * (0.035 + 0.12 * k.fall), response);
      easeRotation(leg.knee.rotation, 0.12 + 0.3 * f, 0, 0, response);
      easeRotation(leg.ankle.rotation, 0, 0, 0, response);
    }
    restoreGear(r);
    if (k.archer) carryBowNow(k);
    const seen = !view || (_sphere.center.set(k.pos.x, k.pos.y + 0.5, k.pos.z), view.intersectsSphere(_sphere));
    r.skirt.pose(r.legL, r.legR, seen ? 0 : 2);
  }

  // Damage + knockback shared by punches and the AOE. Out of hit points the knight is knocked down.
  function knockKnight(k, damage, kx, kz, speed, stun, source = 'punch') {
    const kl = Math.hypot(kx, kz) || 1;
    k.knockX = kx / kl; k.knockZ = kz / kl;
    k.hp -= damage;
    if (k.archer) { k.shoot = null; k.cool = 1.6; k.alertUntil = k.t + 8; }
    if (k.state === 'attack') tactics.finish(k); else tactics.stagger(k, 1.0);
    k.state = 'chase';
    if (k.hp <= 0) {
      // How he goes down depends on what happened. Pushed the way he is facing (hit from behind) he falls on his
      // face; thrown back by a slam he falls on his back; a punch to the front is either (he crumples forward
      // about four times in ten). Each way has its own get-up (the zombie stand-up from the back, the death clip
      // played backwards from the front) and every knight lies for a different time, so they do not all get up at once.
      const dot = k.knockX * Math.sin(k.yaw) + k.knockZ * Math.cos(k.yaw);
      k.fallKind = source === 'blast' ? (dot > 0.35 ? 'front' : 'back') : (dot > 0.2 || Math.random() < 0.4 ? 'front' : 'back');
      const lie = 1.2 + Math.random() * 3.4;
      if (k.fallKind === 'front') {
        k.riseDur = RISE_FRONT_DURATION;
        k.downTotal = FALL_FRONT_DURATION + lie + RISE_FRONT_DURATION;
        k.knockSpeed = speed * 0.3;                         // he drops where he stands
      } else {
        k.riseDur = GETUP_DURATION;
        k.downTotal = 0.6 + lie + GETUP_DURATION;
        k.knockSpeed = speed * 1.5;
      }
      k.down = k.downTotal; k.stun = 0;
    } else { k.stun = stun; k.knockSpeed = speed; }
  }

  // Ground slam: everything within `radius` of the impact point is thrown outward, harder the closer it
  // is. Close knights take two hits' worth (a knockdown), the rest get a heavy stagger.
  function blast(cx, cy, cz, radius, char) {
    let hit = 0;
    for (const k of knights) {
      if (k.down > 0 || Math.abs(k.pos.y - cy) > 2.2) continue;
      let dx = k.pos.x - cx, dz = k.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      if (d < 0.25) { dx = k.pos.x - char.pos.x; dz = k.pos.z - char.pos.z; }
      const strength = 1 - d / radius;
      knockKnight(k, strength > 0.45 ? 2 : 1, dx, dz, 3.5 + 7 * strength, 0.9, 'blast');
      hit++;
    }
    return hit;
  }

  // The player's fist travelled from `a` to `b` this frame. Returns how many knights it hit.
  function hitByPlayer(a, b, swing, char) {
    let hits = 0;
    for (const k of knights) {
      if (k.down > 0 || k.hitSwing === swing) continue;
      for (let i = 0; i <= 3; i++) {
        const t = i / 3;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
        const dx = x - k.pos.x, dz = z - k.pos.z;
        if (dx * dx + dz * dz > (KNIGHT_RADIUS + 0.16) ** 2 || y < k.pos.y - 0.05 || y > k.pos.y + KNIGHT_HEIGHT + 0.1) continue;
        k.hitSwing = swing;
        knockKnight(k, 1, k.pos.x - char.pos.x, k.pos.z - char.pos.z, 3.6, STUN_TIME);
        hits++;
        break;
      }
    }
    return hits;
  }

  // Nearest standing knight within `range` of p, for the punch's aim assist.
  function nearestKnight(p, range) {
    let best = null, bestD = range * range;
    for (const k of knights) {
      if (k.down > 0) continue;
      const d = (k.pos.x - p.x) ** 2 + (k.pos.z - p.z) ** 2;
      if (d < bestD && Math.abs(k.pos.y - p.y) < 1.5) { bestD = d; best = k; }
    }
    return best;
  }

  const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.7);
  const _rootTmp = new THREE.Vector3(), _rootNow = new THREE.Vector3();
  function update(dt, char, sp, view) {
    if (!(dt > 0)) return;
    for (const k of knights) k.hitCooldown = Math.max(0, k.hitCooldown - dt);
    tactics.update(dt, char);
    if (char.arrowHitT > 0) char.arrowHitT -= dt;
    arrows.update(dt, char, (dx, dy, dz) => {            // an arrow reached the player: a shove, and the body squashes
      char.vel.x += dx * 3.4; char.vel.z += dz * 3.4;
      char.knockT = 0.4;
      char.vy = Math.max(char.vy, 0) + 1.4;
      if (char.isBat) {
        char.batSquishV = (char.batSquishV || 0) + 5;
        char.arrowHits = (char.arrowHitT > 0 ? char.arrowHits : 0) + 1;      // three arrows in a few seconds knock him out of bat form
        char.arrowHitT = 6;
        if (char.arrowHits >= 3) { char.forceUnmorph = true; char.arrowHits = 0; }
      }
      sp?.squash?.kick(-0.8);
    });
    for (const k of knights) {
      if (k.stun > 0 || k.down > 0 || k.fall > 0.015) { reactKnight(k, dt, char, view); continue; }
      if (k.archer) updateArcher(k, dt, char);
      const dx = char.pos.x - k.pos.x, dz = char.pos.z - k.pos.z;
      const distanceSq = dx * dx + dz * dz;
      const previousAttackTime = k.atkT;
      const attacking = k.state === 'attack';
      let tx = k.routeX, tz = k.routeZ, speed = k.speed;
      if (attacking) {
        k.atkT += dt;
        tx = k.attackX ?? char.pos.x;
        tz = k.attackZ ?? char.pos.z;
        speed = 0;                                 // the clip's root motion moves him (below)
      }

      const vx = tx - k.pos.x, vz = tz - k.pos.z;
      const d = Math.hypot(vx, vz);
      if (attacking && previousAttackTime === 0) {
        // Start of a move. The lunge travels along a diagonal in its own frame, so turn the knight until that
        // path points at the target; and scale the travel to the distance so he ends in sword range.
        k.mv = MOVES[k.moveName] || MOVES.lunge;
        const mid = (k.mv.strike[0] + k.mv.strike[1]) / 2;
        rootOffset(k.mv, mid, _rootTmp);
        k.mvAngle = Math.hypot(_rootTmp.x, _rootTmp.z) > 0.8 ? Math.atan2(_rootTmp.x, _rootTmp.z) : 0;
        k.mvScale = clamp(d / k.mv.reach, 0.75, 1.15);
        k.mvRoot.set(0, 0, 0);
      }
      // Keep the guard toward the threat while moving sideways.
      const guarding = k.role === 'flank' || k.role === 'retreat';
      const faceX = guarding ? k.knownX - k.pos.x : vx;
      const faceZ = guarding ? k.knownZ - k.pos.z : vz;
      const yawBefore = k.yaw;
      if (faceX * faceX + faceZ * faceZ > 0.05 ** 2 && (!attacking || k.atkT <= 0.2)) {
        const wantYaw = Math.atan2(faceX, faceZ) - (attacking ? k.mvAngle : 0);
        k.yaw += shortAngle(wantYaw - k.yaw) * (1 - Math.exp(-(attacking ? 16 : 7.5) * dt));
      }
      if (!attacking) speed = Math.min(speed, Math.max(0, d - 0.11) * 6);

      const oldX = k.pos.x, oldZ = k.pos.z;
      let travel;
      if (attacking) {
        // The clip's root travel since last frame, turned into the world and scaled: the knight really moves with
        // the animation, so nothing slides. He stops short rather than walk into the player.
        rootOffset(k.mv, frameAt(k.mv, Math.min(k.atkT, k.mv.duration)), _rootNow);
        const rdx = (_rootNow.x - k.mvRoot.x) * k.mvScale, rdz = (_rootNow.z - k.mvRoot.z) * k.mvScale;
        k.mvRoot.copy(_rootNow);
        const cy = Math.cos(k.yaw), sy = Math.sin(k.yaw);
        const wx = rdx * cy + rdz * sy, wz = -rdx * sy + rdz * cy, step = Math.hypot(wx, wz);
        const blockedByPlayer = distanceSq < 0.8 * 0.8 && wx * dx + wz * dz > 0;
        travel = moveKnight(k, step > 1e-6 ? wx / step : 0, step > 1e-6 ? wz / step : 0, blockedByPlayer ? 0 : step / dt, dt, char);
      } else {
        travel = moveKnight(k, d > 0.1 ? vx / d : 0, d > 0.1 ? vz / d : 0, speed, dt, char);
      }
      const turned = attacking ? 0 : Math.abs(shortAngle(k.yaw - yawBefore));
      const turnRate = turned / dt;
      const turnBlend = clamp((turnRate - 0.3) / 1.2, 0, 1);
      const response = 1 - Math.exp(-14 * dt);
      k.speedEst += (travel / dt - k.speedEst) * response;
      const strideTarget = clamp(0.36 + 0.22 * k.speedEst, 0.42, 1.0);
      k.stride += (strideTarget - k.stride) * response;
      // Turning on the spot steps the feet instead of letting them skate.
      k.gait += Math.max(travel, turned * 0.35) * Math.PI / k.stride;
      const gy = groundHeight(k.pos.x, k.pos.z, k.pos.y);
      k.pos.y += (gy - k.pos.y) * (1 - Math.exp(-14 * dt));

      const r = k.rig;
      r.root.position.copy(k.pos);
      r.root.rotation.y = k.yaw;
      r.root.rotation.x = 0;


      const targetBlend = attacking ? 0 : Math.max(Math.min(1, travel / (1.4 * dt)), turnBlend * 0.9);
      k.moveBlend += (targetBlend - k.moveBlend) * response;
      const gait = k.moveBlend;
      const chase = k.state === 'chase';
      const footL = footOffset(k.gait, k.stride), footR = footOffset(k.gait + Math.PI, k.stride);
      const armAmp = chase ? 0.62 : 0.40;
      const sw = -gait * footL.c / (k.stride * 0.5) * armAmp;
      const lagSw = -gait * footOffset(k.gait - 0.55, k.stride).c / (k.stride * 0.5) * (chase ? 0.55 : 0.35);
      // The pelvis sinks as the stance leg leans away from vertical, so the planted foot stays on the floor.
      const stanceC = Math.abs((footL.swing === 0 ? footL.c : footR.c)) * gait;
      const drop = LEG_LEN * (1 - Math.cos(Math.asin(Math.min(0.95, stanceC / LEG_LEN))));
      const bob = -drop + (1 - gait) * Math.sin(performance.now() * 0.0022 + k.slot) * 0.006;

      r.pelvis.position.y += (0.94 + bob - r.pelvis.position.y) * response;
      r.pelvis.rotation.y += (sw * 0.16 - r.pelvis.rotation.y) * response;
      r.pelvis.rotation.z += (-Math.cos(k.gait) * gait * 0.035 - r.pelvis.rotation.z) * response;
      r.pelvis.rotation.x += (0 - r.pelvis.rotation.x) * response;

      if (travel > 0.001) {
        const x = (k.pos.x - oldX) / travel, z = (k.pos.z - oldZ) / travel;
        const sine = Math.sin(k.yaw), cosine = Math.cos(k.yaw);
        k.strideX += (cosine * x - sine * z - k.strideX) * response;
        k.strideZ += (sine * x + cosine * z - k.strideZ) * response;
      } else if (turnBlend > 0) {
        k.strideX += (0 - k.strideX) * response;
        k.strideZ += (1 - k.strideZ) * response;
      }
      const dirLen = Math.hypot(k.strideX, k.strideZ) || 1;
      const dirX = k.strideX / dirLen, dirZ = k.strideZ / dirLen;
      const legPose = (leg, foot, side) => {
        const c = foot.c * gait;
        const hipX = -Math.asin(clamp(c * dirZ / LEG_LEN, -0.95, 0.95));
        const hipZ = side * 0.035 + Math.asin(clamp(c * dirX / LEG_LEN, -0.95, 0.95));
        const lift = Math.sin(Math.PI * foot.swing) * gait * (0.55 + 0.55 * Math.min(1, k.stride / 0.7));
        const knee = 0.05 + gait * 0.08 + lift;
        easeRotation(leg.hip.rotation, hipX, 0, hipZ, response);
        easeRotation(leg.knee.rotation, knee, 0, 0, response);
        easeRotation(leg.ankle.rotation, -(hipX + knee) * 0.85, 0, 0, response);
      };
      legPose(r.legL, footL, 1);
      legPose(r.legR, footR, -1);

      if (k.state === 'attack') {
        if (distanceSq <= 16 && k.atkT >= k.mv.strikeFrom && previousAttackTime <= k.mv.strikeTo
          && tactics.canSee(k, char, false)) checkStrike(k, previousAttackTime, char, sp);
        poseMove(r, k.mv, frameAt(k.mv, Math.min(k.atkT, k.mv.duration)), THREE.MathUtils.smoothstep(k.atkT, 0, 0.12));
        if (k.atkT >= k.mv.duration) tactics.finish(k);
      } else {
        restoreGear(r);
        const lean = gait * (chase ? 0.16 : 0.05);
        const chestYaw = -sw * 0.28;
        const scan = k.state === 'search' ? Math.sin(performance.now() * 0.005 + k.slot) * 0.33 : 0;
        easeRotation(r.torso.rotation, lean, chestYaw, 0, response);
        easeRotation(r.head.rotation, -lean * 0.65, scan - chestYaw * 0.55, 0, response);
        easeRotation(r.armL.sh.rotation, guarding ? -0.24 : -sw * 0.68, 0, guarding ? 0.30 : 0.18, response);
        easeRotation(r.armL.el.rotation, guarding ? -0.78 : -0.32 - Math.max(0, -lagSw) * 0.55, 0, 0, response);
        easeRotation(r.armR.sh.rotation, chase ? -0.78 + sw * 0.22 : -0.30 + sw * 0.40, 0, -0.20, response);
        easeRotation(r.armR.el.rotation, chase ? -0.78 : -0.52 - Math.max(0, lagSw) * 0.45, 0, 0, response);

        // Circling the target sideways (flank / retreat): play the guarded side-step, by distance travelled so
        // the planted foot does not slide. The clip only steps to the right; stepping left plays it backwards.
        if (!k.archer) {
          const sideways = guarding && gait > 0.3 && Math.abs(dirX) > 0.55 ? 1 : 0;
          k.strafeBlend += (sideways - k.strafeBlend) * (1 - Math.exp(-10 * dt));
          if (k.strafeBlend > 0.02) {
            k.strafePhase += travel / STRAFE_METRES;
            poseStrafe(r, k.strafePhase, dirX > 0, THREE.MathUtils.smoothstep(k.strafeBlend, 0, 1));
          }
        }
      }

      // The clips move the pelvis a little off centre; ease it back whenever no clip is driving it.
      if (k.state !== 'attack') {
        r.pelvis.position.x += (0 - r.pelvis.position.x) * response * 0.5;
        r.pelvis.position.z += (0 - r.pelvis.position.z) * response * 0.5;
      }

      // Distant knights stop casting shadows (hysteresis so it does not flicker at the boundary).
      const wantShadows = k.castingShadows ? distanceSq < 26 * 26 : distanceSq < 20 * 20;
      if (wantShadows !== k.castingShadows) {
        k.castingShadows = wantShadows;
        for (const m of k.shadowMeshes) m.castShadow = wantShadows;
      }
      // Cloth level of detail: skipped when off screen or far, cheaper at a distance, full when close.
      if (k.archer) poseShot(k, dt, char);
      const seen = !view || (_sphere.center.set(k.pos.x, k.pos.y + 1, k.pos.z), view.intersectsSphere(_sphere));
      r.skirt.pose(r.legL, r.legR, !seen || distanceSq > 38 * 38 ? 2 : distanceSq > 12 * 12 ? 1 : 0);
    }
  }

  return { knights, update, resolvePlayer, hitByPlayer, nearestKnight, blast, arrows, setAccLead: (v) => { ACC_LEAD = v; } };
}
