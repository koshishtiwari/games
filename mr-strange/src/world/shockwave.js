// Ground shockwave for the slam: two expanding rings, a flash disc and a few dust puffs.
// Pooled meshes, no allocation per spawn.

import * as THREE from 'three';

const DURATION = 0.7;
const RINGS = 3;

export function createShockwave(scene) {
  const ringGeo = new THREE.RingGeometry(0.92, 1.0, 64);
  ringGeo.rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(1, 40);
  discGeo.rotateX(-Math.PI / 2);

  const mk = (geo, color) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    m.visible = false;
    m.frustumCulled = false;
    m.renderOrder = 5;
    scene.add(m);
    return m;
  };

  const waves = [];
  for (let i = 0; i < RINGS; i++) {
    waves.push({ ring: mk(ringGeo, 0xd6e2ff), disc: mk(discGeo, 0xaab8e8), t: Infinity, radius: 3, delay: 0 });
  }
  let next = 0;

  function spawn(x, y, z, radius) {
    const w = waves[next++ % RINGS];
    w.t = 0; w.radius = radius;
    w.ring.position.set(x, y + 0.04, z);
    w.disc.position.set(x, y + 0.03, z);
    w.ring.visible = w.disc.visible = true;
  }

  function update(dt) {
    for (const w of waves) {
      if (w.t === Infinity) continue;
      w.t += dt;
      const u = w.t / DURATION;
      if (u >= 1) { w.t = Infinity; w.ring.visible = w.disc.visible = false; continue; }
      const out = 1 - (1 - u) * (1 - u) * (1 - u);          // fast out, slow settle
      const r = 0.25 + out * w.radius;
      w.ring.scale.set(r, 1, r);
      w.ring.material.opacity = 0.85 * (1 - u) * (1 - u);
      const flash = Math.max(0, 1 - u * 3.5);                // the disc is only the initial flash
      w.disc.scale.set(r * 0.55, 1, r * 0.55);
      w.disc.material.opacity = 0.55 * flash;
    }
  }

  return { spawn, update };
}
