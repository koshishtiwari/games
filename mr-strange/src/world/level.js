// The traversal playground: a dark Souls-like ruined abbey courtyard built from
// axis-aligned boxes. The boxes ARE the collision world (see collision.js); meshes
// are generated from the same data, so what you see is what you collide with.
//
//   boxes   solid blocks {x0,y0,z0,x1,y1,z1}. Anything with a top you can reach
//           is automatically a ledge: no extra tagging needed.
//   ropes   vertical lines you can climb, with a top-out point onto a roof.
//
// Layout (start at the origin, facing +z):
//   low block (mantle) . thin fence (vault) . tall block (jump-catch ledge)
//   stairs up to a platform (edge descent) . gap jump to a lower roof
//   rope up a tall tower . ruined crypt / sanctuary with a window and a doorway
//
// Around it: a ring of gothic cathedrals & keeps in the moonlit gloom (city.js);
// the haunted deadwood forest (forest.js) stands beyond them.
//
// This file also owns the dithered material: surfaces fade to a dotted pattern
// when they sit at the camera lens or block the sightline to the hero.

import * as THREE from 'three';

export const level = { boxes: [], ropes: [] };
export const levelDither = {
  uCamPos:  { value: new THREE.Vector3(0, 2, -4) },
  uHeroPos: { value: new THREE.Vector3(0, 1, 0) },
};


/** Standard material + camera/hero dither (+ optional wind sway on instanced geometry). */
export function makeDitherMaterial(params = {}) {
  const { sway, ...rest } = params;
  const m = new THREE.MeshStandardMaterial(rest);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCamPos  = levelDither.uCamPos;
    shader.uniforms.uHeroPos = levelDither.uHeroPos;
    if (sway) shader.uniforms.uTime = sway;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;' + (sway ? '\nuniform float uTime;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + (sway ? `
        {
          #ifdef USE_INSTANCING
            vec2 ph = instanceMatrix[3].xz;
          #else
            vec2 ph = vec2(0.0);
          #endif
          float w = transformed.y * transformed.y * 0.0011;
          float t = uTime * 0.7 + ph.x * 0.31 + ph.y * 0.23;
          transformed.x += sin(t) * w;
          transformed.z += cos(t * 0.83) * w * 0.7;
        }` : ''))
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWorldPos = (modelMatrix * wp).xyz;
        }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWorldPos;
          uniform vec3 uCamPos;
          uniform vec3 uHeroPos;
          float bayer4(vec2 p) {
            int x = int(mod(p.x, 4.0));
            int y = int(mod(p.y, 4.0));
            int i = y * 4 + x;
            if (i == 0) return 0.0625;  if (i == 1) return 0.5625;  if (i == 2) return 0.1875;  if (i == 3) return 0.6875;
            if (i == 4) return 0.8125;  if (i == 5) return 0.3125;  if (i == 6) return 0.9375;  if (i == 7) return 0.4375;
            if (i == 8) return 0.2500;  if (i == 9) return 0.7500;  if (i == 10) return 0.1250; if (i == 11) return 0.6250;
            if (i == 12) return 1.0000; if (i == 13) return 0.5000; if (i == 14) return 0.8750; return 0.3750;
          }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          {
            vec3 seg = uHeroPos - uCamPos;
            float segLen2 = max(dot(seg, seg), 1e-4);
            float t = clamp(dot(vWorldPos - uCamPos, seg) / segLen2, 0.0, 1.0);
            vec3 closest = uCamPos + seg * t;
            float dRay = length(vWorldPos - closest);
            float dCam = length(vWorldPos - uCamPos);
            // Dotted transparency when near the camera lens or blocking the sightline to the hero
            float nearCam = smoothstep(0.35, 1.05, dCam);
            float onSight = (t > 0.02 && t < 0.92) ? smoothstep(0.28, 0.85, dRay) : 1.0;
            float alpha = min(nearCam, onSight);
            if (alpha < 0.99 && alpha < bayer4(gl_FragCoord.xy)) discard;
          }`);
  };
  return m;
}


// ---- the course ------------------------------------------------------------
const COL = { block: 0x323746, hut: 0x262936, cap: 0x626b80, stair: 0x3b4152 };

function box(x0, y0, z0, x1, y1, z1, o = {}) {
  const b = { x0, y0, z0, x1, y1, z1, color: o.color ?? COL.block, cap: o.cap !== false };
  level.boxes.push(b);
  return b;
}

box(-1.5, 0, 5, 1.5, 1.1, 6.6);                       // low block: mantle
box(3.5, 0, 5, 6.5, 1.0, 5.25);                       // thin fence: vault
box(-3, 0, 9, 3, 2.4, 13);                            // tall block: jump-catch, then mantle

for (let i = 0; i < 12; i++)                          // stairs: 12 x 0.2 m
  box(8, 0, 2 + 0.35 * i, 10, 0.2 * (i + 1), 2 + 0.35 * (i + 1), { color: COL.stair, cap: false });
box(8, 0, 6.2, 12, 2.4, 11);                          // platform at the top of the stairs
box(14.2, 0, 6.2, 19, 1.8, 11);                       // lower roof across a 2.2 m gap

box(-8, 0, 2, -4, 5, 6);                              // tall tower for the rope
level.ropes.push({ x: -6, z: 1.75, bottom: 0, top: 5.0, nx: 0, nz: -1, topOut: new THREE.Vector3(-6, 5, 2.7) });

// ruined gothic crypt / mausoleum with a window (front) and a doorway (right side)
const H = { color: COL.hut, cap: false };
box(-16, 0, 2, -14.2, 3, 2.2, H);                     // front wall, left of window
box(-12.8, 0, 2, -11, 3, 2.2, H);                     // front wall, right of window
box(-14.2, 0, 2, -12.8, 0.9, 2.2, H);                 // sill
box(-14.2, 2.1, 2, -12.8, 3, 2.2, H);                 // lintel
box(-16, 0, 5.8, -11, 3, 6, H);                       // back wall
box(-16, 0, 2.2, -15.8, 3, 5.8, H);                   // left wall
box(-11.2, 0, 2.2, -11, 3, 3.2, H);                   // right wall, either side of the door
box(-11.2, 2.0, 3.2, -11, 3, 4.2, H);                 // door lintel
box(-11.2, 0, 4.2, -11, 3, 5.8, H);
box(-16, 3, 2, -11, 3.2, 6, { color: COL.block });    // roof

// Procedural weathered ashlar stone texture for the courtyard ruins
function makeRuinsStoneTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d4d8e2';
  g.fillRect(0, 0, 128, 128);
  let s = 313;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < 128; y += 32) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, y, 128, 2);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, y + 2, 128, 1.5);
    const off = ((y / 32) & 1) ? 32 : 0;
    for (let x = off; x < 128; x += 64) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x, y, 2, 32);
    }
  }
  for (let i = 0; i < 180; i++) {
    g.fillStyle = r() < 0.55 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
    g.fillRect(r() * 128, r() * 128, 2 + r() * 8, 1 + r() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---- meshes ----------------------------------------------------------------
export function buildLevel(scene) {
  const stoneTex = makeRuinsStoneTexture();
  const mats = new Map();
  const mat = (c) => {
    if (!mats.has(c)) mats.set(c, makeDitherMaterial({ color: c, map: stoneTex, roughness: 0.88, metalness: 0.05 }));
    return mats.get(c);
  };
  for (const b of level.boxes) {
    if (b.mesh === false) continue;                   // collision-only boxes
    const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(b.color));
    m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    if (b.cap && h > 0.5) {                           // gothic stone coping: makes ledges read at a glance
      const c = new THREE.Mesh(new THREE.BoxGeometry(w + 0.10, 0.08, d + 0.10), mat(COL.cap));
      c.position.set(m.position.x, b.y1 + 0.025, m.position.z);
      c.castShadow = c.receiveShadow = true;
      scene.add(c);
    }
  }
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a7450, roughness: 0.92 });
  for (const r of level.ropes) {
    const len = r.top - r.bottom + 0.3;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), ropeMat);
    m.position.set(r.x, r.bottom + len / 2, r.z);
    m.castShadow = true;
    scene.add(m);
  }
}
