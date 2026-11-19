// 3D noir Bat model with solid-volume scalloped wings, rigid-length wing
// kinematics (zero rubbery stretching), soft-body squish, and morph puffs.

import * as THREE from 'three';

export function createBat(scene) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  const furMat = new THREE.MeshStandardMaterial({
    color: 0x13141a, roughness: 0.84, metalness: 0.03,
  });
  const earInMat = new THREE.MeshStandardMaterial({
    color: 0x6b1426, roughness: 0.72, metalness: 0.02,
  });
  const topMemMat = new THREE.MeshStandardMaterial({
    color: 0x1d1724, roughness: 0.68, metalness: 0.06,
  });
  const botMemMat = new THREE.MeshStandardMaterial({
    color: 0x8e1f2b, roughness: 0.72, metalness: 0.04,
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff2e4c, emissive: 0xaa112e, emissiveIntensity: 1.5, roughness: 0.15,
  });

  // --- Sculpted 3D Bat Body & Head (facing +Z) ---
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.092, 16, 12), furMat);
  torso.scale.set(0.86, 0.78, 1.65);
  torso.castShadow = true;
  bodyGroup.add(torso);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 12), furMat);
  chest.scale.set(1.06, 0.92, 1.05);
  chest.position.set(0, 0.015, 0.065);
  chest.castShadow = true;
  bodyGroup.add(chest);

  const head = new THREE.Group();
  head.position.set(0, 0.036, 0.155);
  bodyGroup.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.060, 14, 12), furMat);
  skull.scale.set(0.96, 0.88, 1.12);
  skull.castShadow = true;
  head.add(skull);

  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.056, 10), furMat);
  snout.rotation.x = Math.PI * 0.5;
  snout.position.set(0, -0.010, 0.058);
  head.add(snout);

  // Wide pointed 3D bat ears with wine-red inner shells
  const earOutGeo = new THREE.ConeGeometry(0.034, 0.150, 6);
  const earInGeo  = new THREE.ConeGeometry(0.021, 0.115, 6);
  const ears = [];
  for (const sx of [1, -1]) {
    const earPivot = new THREE.Group();
    earPivot.position.set(sx * 0.036, 0.038, -0.004);
    earPivot.rotation.z = -sx * 0.40;
    earPivot.rotation.x = 0.12;
    earPivot.rotation.y = sx * 0.22;

    const earOut = new THREE.Mesh(earOutGeo, furMat);
    earOut.position.y = 0.054;
    earOut.scale.set(1.0, 1.0, 0.45);
    earOut.castShadow = true;

    const earIn = new THREE.Mesh(earInGeo, earInMat);
    earIn.position.set(0, 0.046, 0.009);
    earIn.scale.set(0.9, 1.0, 0.35);

    earPivot.add(earOut, earIn);
    head.add(earPivot);
    ears.push({ pivot: earPivot, s: sx });

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.010, 10, 8), eyeMat);
    eye.scale.set(1.3, 0.65, 0.55);
    eye.position.set(sx * 0.026, 0.010, 0.050);
    head.add(eye);
  }

  // Hind legs & solid 3D V-tail
  for (const sx of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.007, 0.13, 8), furMat);
    leg.rotation.x = Math.PI * 0.5;
    leg.rotation.z = -sx * 0.20;
    leg.position.set(sx * 0.040, -0.008, -0.175);
    bodyGroup.add(leg);
  }
  const tailMesh = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.16, 4), topMemMat);
  tailMesh.rotation.x = -Math.PI * 0.5;
  tailMesh.scale.set(1.1, 1.0, 0.18);
  tailMesh.position.set(0, -0.010, -0.19);
  bodyGroup.add(tailMesh);

  // --- Solid 3D Scalloped Bat Wings with Rigid-Length Kinematics ---
  function buildWing(side) {
    const s = side === 'L' ? 1 : -1;

    // 12 perimeter/skeleton points:
    // 0:shoulder, 1:elbow, 2:wrist, 3:tip1, 4:notch1, 5:tip2, 6:notch2, 7:tip3, 8:notch3, 9:tip4, 10:notch4, 11:ankle
    const N = 12;
    const baseTris = [
      0, 11, 1,  1, 11, 10,  1, 10, 2,  2, 10, 9,
      2, 9, 8,   2, 8, 7,    2, 7, 6,   2, 6, 5,
      2, 5, 4,   2, 4, 3,
    ];
    const topIdx = baseTris.slice();
    const botIdx = baseTris.slice();
    if (s < 0) {
      for (let i = 0; i < topIdx.length; i += 3) { const t = topIdx[i + 1]; topIdx[i + 1] = topIdx[i + 2]; topIdx[i + 2] = t; }
    } else {
      for (let i = 0; i < botIdx.length; i += 3) { const t = botIdx[i + 1]; botIdx[i + 1] = botIdx[i + 2]; botIdx[i + 2] = t; }
    }

    // Separate top (dark purplish) and bottom (wine-red) solid offset surfaces so it's a real 3D volume
    const topPos = new Float32Array(N * 3);
    const botPos = new Float32Array(N * 3);
    const topGeo = new THREE.BufferGeometry();
    const botGeo = new THREE.BufferGeometry();
    const topAttr = new THREE.BufferAttribute(topPos, 3);
    const botAttr = new THREE.BufferAttribute(botPos, 3);
    topGeo.setAttribute('position', topAttr);
    botGeo.setAttribute('position', botAttr);
    topGeo.setIndex(topIdx);
    botGeo.setIndex(botIdx);

    const topMesh = new THREE.Mesh(topGeo, topMemMat);
    const botMesh = new THREE.Mesh(botGeo, botMemMat);
    topMesh.castShadow = true; topMesh.receiveShadow = true; topMesh.frustumCulled = false;
    botMesh.castShadow = true; botMesh.receiveShadow = true; botMesh.frustumCulled = false;
    bodyGroup.add(topMesh, botMesh);

    // 7 solid 3D wing-skeleton bones + 3 joint spheres (shoulder, elbow, wrist)
    const bones = Array.from({ length: 7 }, () => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.010, 1, 8), furMat);
      m.castShadow = true;
      bodyGroup.add(m);
      return m;
    });
    const joints = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 0.018 : 0.013, 8, 6), furMat);
      bodyGroup.add(m);
      return m;
    });

    const pts = Array.from({ length: N }, () => new THREE.Vector3());
    const _d = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);

    // Rigid segment lengths (never stretch!)
    const L_UPPER = 0.16;
    const L_FORE  = 0.21;
    const L_F1    = 0.42;
    const L_F2    = 0.38;
    const L_F3    = 0.33;
    const L_F4    = 0.28;

    function placeSeg(out, origin, len, elevAngle, sweepAngle) {
      // Polar placement: length is strictly preserved!
      const ca = Math.cos(elevAngle), sa = Math.sin(elevAngle);
      const cs = Math.cos(sweepAngle), ss = Math.sin(sweepAngle);
      out.set(
        origin.x + s * len * ca * cs,
        origin.y + len * sa,
        origin.z + len * ca * ss
      );
    }

    function setBone(bi, i0, i1, rScale) {
      _d.subVectors(pts[i1], pts[i0]);
      const len = _d.length();
      const m = bones[bi];
      m.position.copy(pts[i0]).addScaledVector(_d, 0.5);
      m.scale.set(rScale, Math.max(0.001, len), rScale);
      if (len > 1e-5) m.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
    }

    function updateWing(a1, a2, a3, fold) {
      // 0: shoulder, 11: ankle (anchored to body)
      pts[0].set(s * 0.064, 0.018, 0.068);
      pts[11].set(s * 0.046, -0.014, -0.185);

      // 1: elbow (upper arm sweeps slightly back)
      placeSeg(pts[1], pts[0], L_UPPER, a1, -0.28 - fold * 0.35);
      // 2: wrist (forearm sweeps forward/outward)
      placeSeg(pts[2], pts[1], L_FORE, a2, 0.42 - fold * 0.25);

      // 4 radiating finger rays from wrist (rigid lengths!)
      placeSeg(pts[3], pts[2], L_F1, a3, -0.18 - fold * 0.30);          // wingtip
      placeSeg(pts[5], pts[2], L_F2, a3 - 0.06, -0.68 - fold * 0.25);   // finger 2
      placeSeg(pts[7], pts[2], L_F3, a3 - 0.10, -1.14 - fold * 0.18);   // finger 3
      placeSeg(pts[9], pts[2], L_F4, a3 - 0.12, -1.52 - fold * 0.10);   // finger 4

      // Concave scallop notches between finger tips
      pts[4].lerpVectors(pts[3], pts[5], 0.5).lerp(pts[2], 0.24);
      pts[6].lerpVectors(pts[5], pts[7], 0.5).lerp(pts[2], 0.26);
      pts[8].lerpVectors(pts[7], pts[9], 0.5).lerp(pts[2], 0.26);
      pts[10].lerpVectors(pts[9], pts[11], 0.5).lerp(pts[1], 0.22);

      // Offset top (+0.0045) and bottom (-0.0045) for solid 3D wing volume
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        const thick = (i <= 2) ? 0.006 : (i === 3 || i === 5 || i === 7 || i === 9 ? 0.0035 : 0.0025);
        topPos[i * 3] = p.x; topPos[i * 3 + 1] = p.y + thick; topPos[i * 3 + 2] = p.z;
        botPos[i * 3] = p.x; botPos[i * 3 + 1] = p.y - thick; botPos[i * 3 + 2] = p.z;
      }
      topAttr.needsUpdate = true; botAttr.needsUpdate = true;
      topGeo.computeVertexNormals(); botGeo.computeVertexNormals();

      for (let j = 0; j < 3; j++) joints[j].position.copy(pts[j]);
      setBone(0, 0, 1, 1.45); // upper arm
      setBone(1, 1, 2, 1.25); // forearm
      // thumb hook at wrist
      _d.set(s * 0.012, 0.026, 0.032);
      const tLen = _d.length();
      bones[2].position.copy(pts[2]).addScaledVector(_d, 0.5);
      bones[2].scale.set(0.9, tLen, 0.9);
      bones[2].quaternion.setFromUnitVectors(UP, _d.divideScalar(tLen));

      setBone(3, 2, 3, 0.95);
      setBone(4, 2, 5, 0.80);
      setBone(5, 2, 7, 0.72);
      setBone(6, 2, 9, 0.65);
    }

    return { updateWing };
  }

  const wingL = buildWing('L');
  const wingR = buildWing('R');

  // --- Morph smoke/shadow puff pool ---
  const PUFF_COUNT = 22;
  const puffs = [];
  const puffGeo = new THREE.SphereGeometry(0.14, 8, 6);
  for (let i = 0; i < PUFF_COUNT; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: i % 3 === 0 ? 0x5c0e24 : 0x15161c,
      roughness: 0.9,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const m = new THREE.Mesh(puffGeo, mat);
    m.visible = false;
    scene.add(m);
    puffs.push({ mesh: m, mat, vel: new THREE.Vector3(), life: 0, maxLife: 0.45 });
  }

  function spawnMorphBurst(pos) {
    for (let i = 0; i < PUFF_COUNT; i++) {
      const p = puffs[i];
      const ang = (i / PUFF_COUNT) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 1.2 + Math.random() * 2.4;
      p.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.35,
        pos.y + 0.5 + Math.random() * 0.85,
        pos.z + (Math.random() - 0.5) * 0.35
      );
      p.vel.set(Math.cos(ang) * spd, (Math.random() - 0.2) * 1.8, Math.sin(ang) * spd);
      p.life = p.maxLife = 0.32 + Math.random() * 0.22;
      p.mesh.scale.setScalar(0.5 + Math.random() * 0.7);
      p.mesh.visible = true;
      p.mat.opacity = 0.85;
    }
  }

  function update(dt, char, bank, pitch) {
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-4.5 * dt));
      const t = p.life / p.maxLife;
      p.mat.opacity = 0.82 * t;
      p.mesh.scale.setScalar(0.45 + (1 - t) * 1.15);
    }

    const vis = char.morph > 0.04;
    root.visible = vis;
    if (!vis) return;

    const phase = char.flapPhase;
    const glide = char.batGlide;
    const power = char.flapPower;

    const stroke = Math.sin(phase);
    const bodyBob = -stroke * 0.045 * power * (1 - glide);
    const beatPitch = stroke * 0.09 * power * (1 - glide);

    root.position.set(char.pos.x, char.pos.y + 0.92 + bodyBob, char.pos.z);
    root.rotation.order = 'YXZ';
    root.rotation.y = char.yaw;
    root.rotation.x = pitch + beatPitch;
    root.rotation.z = bank;

    const baseSc = 0.35 + 0.65 * THREE.MathUtils.smoothstep(char.morph, 0.04, 0.85);
    const sq = char.batSquish;
    root.scale.set(
      baseSc * (1 + sq * 0.55),
      baseSc * (1 + sq * 0.42),
      baseSc * Math.max(0.28, 1 - sq * 0.62)
    );

    const amp = (0.48 + 0.28 * power) * (1 - glide);
    const a1 = Math.sin(phase) * amp + 0.05;
    const a2 = Math.sin(phase - 0.55) * amp * 1.15;
    const a3 = Math.sin(phase - 1.05) * amp * 1.25 - 0.06;
    const fold = Math.max(0, -stroke) * 0.25 * (1 - glide) + glide * 0.40;

    wingL.updateWing(a1, a2, a3, fold);
    wingR.updateWing(a1, a2, a3, fold);

    head.rotation.y = -bank * 0.35;
    head.rotation.x = -pitch * 0.30;
    const twitch = Math.sin(performance.now() * 0.008) * 0.06;
    for (const e of ears) e.pivot.rotation.z = -e.s * (0.40 + twitch);
  }

  return { root, update, spawnMorphBurst };
}
