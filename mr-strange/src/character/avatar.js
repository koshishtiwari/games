// How the hero looks: shell material (clothing zones picked out in bind space),
// the skinned mesh itself, eyes and hat. Geometry lives in body.js.

import * as THREE from 'three';
import { B, P, skeleton } from './rig.js';
import { shellGeo, field } from './body.js';

export const shellUniforms = {
  uRimColor:   { value: new THREE.Color(0x9fc4e8) },
  uRimPower:   { value: 3.6 },
  uRimStrength:{ value: 0.16 },
  uSkin:    { value: new THREE.Color(0xc99b78) },
  uMask:    { value: new THREE.Color(0x16171d) },
  uCuff:    { value: new THREE.Color(0xe6e9ef) },
  uShirt:   { value: new THREE.Color(0x17181f) },
  uTrouser: { value: new THREE.Color(0x121319) },
  uShoe:    { value: new THREE.Color(0x111216) },
  uBelt:    { value: new THREE.Color(0x282a34) },
};

function makeShellMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.74, metalness: 0.0, envMapIntensity: 0.55,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shellUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeam;\nvarying float vSeam;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeam = aSeam;\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSeam;
        varying vec3  vBind;
        uniform vec3  uRimColor;
        uniform float uRimPower;
        uniform float uRimStrength;
        uniform vec3  uSkin, uMask, uCuff, uShirt, uTrouser, uShoe, uBelt;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          // Clothing is picked out from the BIND-space position, which does not
          // move when the body is posed, so the regions stay welded to the body.
          float by = vBind.y, bx = abs(vBind.x), bz = vBind.z;
          float arm = smoothstep(0.175, 0.205, bx);     // |x| separates arms from torso/legs
          vec3 cloth = uTrouser;
          cloth = mix(cloth, uShoe,  (1.0 - smoothstep(0.105, 0.118, by)) * (1.0 - arm));
          cloth = mix(cloth, uShirt, max(smoothstep(0.925, 0.960, by), arm));
          cloth = mix(cloth, uBelt,  (1.0 - smoothstep(0.011, 0.021, abs(by - 0.947))) * (1.0 - arm));
          cloth = mix(cloth, uSkin,  smoothstep(1.515, 1.548, by));                 // neck & face (bandit mask is 3D mesh on B.head)
          cloth = mix(cloth, uSkin,  arm * smoothstep(0.548, 0.556, bx));
          gl_FragColor.rgb *= cloth;
          float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);
          gl_FragColor.rgb += uRimColor * fres * uRimStrength;
        }`);
  };
  return mat;
}

// March out along +Z from inside the head to find the real surface.
function surfaceZ(x, y, startZ) {
  let z = startZ;
  for (let i = 0; i < 400 && field(x, y, z) < 0; i++) z += 0.0012;
  return z;
}

/* ---- realistic lofted Oxford / Derby dress shoe ---------------------------- */
function makeDressShoe(side, leatherMat, soleMat) {
  const s = side === 'L' ? 1 : -1; // +1 = left (+X is medial? No, +X is left/lateral for L!)
  // In character space: +X is Left, -X is Right. So for Left shoe (s=+1), medial (inner arch) is -X, lateral is +X.
  const grp = new THREE.Group();

  // Asymmetric shoe half-widths at normalized length u in [0, 1] (heel -0.068 -> toe +0.172)
  const Z_MIN = -0.068, Z_MAX = 0.172, LEN = Z_MAX - Z_MIN;
  const profile = (u) => {
    const z = Z_MIN + u * LEN;
    let wIn, wOut;
    if (u < 0.22) {                    // heel
      const t = u / 0.22;
      const r = Math.sin(t * Math.PI * 0.5);
      wIn = wOut = 0.014 + 0.019 * r;
    } else if (u < 0.46) {             // arch / waist (asymmetric medial curve)
      const t = (u - 0.22) / 0.24;
      const pinch = Math.sin(t * Math.PI);
      wIn  = 0.033 - 0.008 * pinch;
      wOut = 0.033 + 0.002 * pinch;
    } else if (u < 0.74) {             // ball / forefoot
      const t = (u - 0.46) / 0.28;
      const swell = Math.sin(t * Math.PI * 0.75);
      wIn  = 0.033 + 0.007 * swell;
      wOut = 0.035 + 0.008 * swell;
    } else {                           // almond toe taper
      const t = (u - 0.74) / 0.26;
      const taper = Math.cos(t * Math.PI * 0.5);
      wIn  = 0.038 * Math.pow(taper, 0.72);
      wOut = 0.040 * Math.pow(taper, 0.72);
    }
    return { z, wIn, wOut };
  };

  // 1. Outsole + welt (2D shape extruded vertically, with arch lift via vertex Y)
  const soleShape = new THREE.Shape();
  const NU = 24;
  for (let i = 0; i <= NU; i++) {
    const { z, wOut } = profile(i / NU);
    const x = s * (wOut + 0.0028);
    if (i === 0) soleShape.moveTo(x, z); else soleShape.lineTo(x, z);
  }
  for (let i = NU; i >= 0; i--) {
    const { z, wIn } = profile(i / NU);
    soleShape.lineTo(-s * (wIn + 0.0028), z);
  }
  soleShape.closePath();

  const soleGeo = new THREE.ExtrudeGeometry(soleShape, {
    depth: 0.009, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 16,
  });
  soleGeo.rotateX(Math.PI * 0.5); // extrude +Z -> -Y
  const sp = soleGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const z = sp.getZ(i);
    const u = THREE.MathUtils.clamp((z - Z_MIN) / LEN, 0, 1);
    // Arch lift between u=0.22 and u=0.48, slight toe spring at u>0.82
    const arch = u > 0.20 && u < 0.50 ? Math.sin(((u - 0.20) / 0.30) * Math.PI) * 0.006 : 0;
    const toeSpring = u > 0.80 ? Math.pow((u - 0.80) / 0.20, 2) * 0.005 : 0;
    sp.setY(i, sp.getY(i) - 0.0755 + arch + toeSpring);
  }
  soleGeo.computeVertexNormals();
  const soleMesh = new THREE.Mesh(soleGeo, soleMat);
  soleMesh.castShadow = true; soleMesh.receiveShadow = true;
  grp.add(soleMesh);

  // 2. Stacked heel block (z: -0.068 .. -0.018, y: -0.085 .. -0.074)
  const heelShape = new THREE.Shape();
  for (let i = 0; i <= 8; i++) {
    const { z, wOut } = profile((i / 8) * 0.22);
    const x = s * (wOut + 0.0022);
    if (i === 0) heelShape.moveTo(x, z); else heelShape.lineTo(x, z);
  }
  for (let i = 8; i >= 0; i--) {
    const { z, wIn } = profile((i / 8) * 0.22);
    heelShape.lineTo(-s * (wIn + 0.0022), z);
  }
  heelShape.closePath();
  const heelGeo = new THREE.ExtrudeGeometry(heelShape, {
    depth: 0.011, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1,
  });
  heelGeo.rotateX(Math.PI * 0.5);
  heelGeo.translate(0, -0.074, 0);
  const heelMesh = new THREE.Mesh(heelGeo, soleMat);
  heelMesh.castShadow = true; heelMesh.receiveShadow = true;
  grp.add(heelMesh);

  // 3. Sculpted leather upper (lofted along u with radial cross-section)
  const RINGS = 26, SEGS = 18;
  const verts = [], uvs = [], indices = [];
  for (let i = 0; i <= RINGS; i++) {
    const u = i / RINGS;
    const { z, wIn, wOut } = profile(u);
    const arch = u > 0.20 && u < 0.50 ? Math.sin(((u - 0.20) / 0.30) * Math.PI) * 0.006 : 0;
    const toeSpring = u > 0.80 ? Math.pow((u - 0.80) / 0.20, 2) * 0.005 : 0;
    const yBot = -0.076 + arch + toeSpring;

    // Height of shoe top along length: high heel counter -> ankle collar -> sloped vamp -> sleek toe box
    let hTop;
    if (u < 0.24) hTop = 0.082 - 0.008 * (u / 0.24);
    else if (u < 0.42) hTop = 0.074 - 0.006 * ((u - 0.24) / 0.18);
    else if (u < 0.78) hTop = 0.068 - 0.044 * Math.pow((u - 0.42) / 0.36, 1.15);
    else hTop = 0.024 * Math.cos(((u - 0.78) / 0.22) * Math.PI * 0.5);

    for (let j = 0; j <= SEGS; j++) {
      const th = (j / SEGS) * Math.PI * 2;
      const cx = Math.cos(th), sy = Math.sin(th);
      // Flat bottom at yBot, rounded/domed top above
      const w = (cx * s > 0 ? wOut : wIn);
      const x = cx * w * (sy > 0 ? 1 - 0.22 * Math.pow(sy, 1.6) : 1);
      const y = sy >= 0 ? yBot + hTop * Math.pow(sy, 0.82) : yBot + 0.002 * sy;
      verts.push(x, y, z);
      uvs.push(j / SEGS, u);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGS; j++) {
      const a = i * (SEGS + 1) + j, b = a + SEGS + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const upperGeo = new THREE.BufferGeometry();
  upperGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  upperGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  upperGeo.setIndex(indices);
  upperGeo.computeVertexNormals();
  const upperMesh = new THREE.Mesh(upperGeo, leatherMat);
  upperMesh.castShadow = true; upperMesh.receiveShadow = true;
  grp.add(upperMesh);

  // 4. Subtle Oxford lace bars across the instep
  const laceGeo = new THREE.CylinderGeometry(0.0018, 0.0018, 0.028, 8);
  laceGeo.rotateZ(Math.PI * 0.5);
  for (let k = 0; k < 3; k++) {
    const lace = new THREE.Mesh(laceGeo, soleMat);
    lace.position.set(0, -0.014 - k * 0.007, 0.036 + k * 0.015);
    lace.rotation.x = 0.42;
    grp.add(lace);
  }

  return grp;
}

/* ---- articulated procedural hand (smooth tapered palm, 3-joint fingers & thumb) ---- */
function makeHand(side, skinMat) {
  const s = side === 'L' ? 1 : -1;
  const hd = P['hand' + side], he = P['handEnd' + side];
  const along = he.clone().sub(hd).normalize();

  const root = new THREE.Group();
  // Orient canonical +Y along `along`, +Z stays +Z, +X is palm-side inward when s=+1
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
  root.quaternion.copy(q);

  const hand = new THREE.Group();
  hand.scale.x = s; // mirror X cleanly for L vs R so +X always faces inward (palm side)
  root.add(hand);

  // 1. Sculpted oval wrist & crisp dress-shirt cuff (wrist sits cleanly inside cuff)
  const cuffMat = new THREE.MeshStandardMaterial({ color: shellUniforms.uCuff.value, roughness: 0.62, metalness: 0.0 });
  const cuffMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.030, 0.034, 20), cuffMat);
  cuffMesh.scale.set(0.84, 1, 1.16);
  cuffMesh.position.set(0, -0.020, 0);
  cuffMesh.castShadow = true; cuffMesh.receiveShadow = true;
  hand.add(cuffMesh);

  const btn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0028, 0.0028, 0.003, 10),
    new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.35 })
  );
  btn.rotation.x = Math.PI * 0.5;
  btn.position.set(-0.017, -0.022, -0.032);
  hand.add(btn);

  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.018, 0.026, 16), skinMat);
  wrist.scale.set(0.68, 1, 1.10);
  wrist.position.set(0, 0.001, 0);
  wrist.castShadow = true; wrist.receiveShadow = true;
  hand.add(wrist);

  // 2. Sculpted rounded palm (wrist at y=0 -> knuckles at y=0.074)
  const palmShape = new THREE.Shape();
  palmShape.moveTo(-0.022, 0.000);
  palmShape.quadraticCurveTo(-0.032, 0.038, -0.033, 0.072);
  palmShape.quadraticCurveTo( 0.000, 0.078,  0.033, 0.072);
  palmShape.quadraticCurveTo( 0.033, 0.036,  0.023, 0.000);
  palmShape.closePath();
  const palmGeo = new THREE.ExtrudeGeometry(palmShape, {
    depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 3, curveSegments: 12,
  });
  palmGeo.rotateY(Math.PI * 0.5); // shape X->Z (width), shape Y->Y (length), depth Z->X (thickness)
  palmGeo.translate(-0.006, 0, 0);
  const palm = new THREE.Mesh(palmGeo, skinMat);
  palm.castShadow = true; palm.receiveShadow = true;
  hand.add(palm);

  // Thenar (thumb muscle) pad on palm side (+X, +Z)
  const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), skinMat);
  thenar.scale.set(0.65, 1.45, 0.85);
  thenar.position.set(0.006, 0.032, 0.018);
  thenar.castShadow = true;
  hand.add(thenar);

  // Helper to build a smooth tapered phalanx segment + joint sphere
  const addSegment = (parent, r0, r1, len, curlZ) => {
    const pivot = new THREE.Group();
    pivot.rotation.z = -curlZ; // +X is palm side, so -Z rotation curls toward +X (palm)
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 12), skinMat);
    seg.position.y = len * 0.5;
    seg.castShadow = true; seg.receiveShadow = true;
    const joint = new THREE.Mesh(new THREE.SphereGeometry(r0 * 1.02, 10, 8), skinMat);
    const tip = new THREE.Group();
    tip.position.y = len;
    pivot.add(joint, seg, tip);
    parent.add(pivot);
    return tip;
  };

  // 2. Four 3-phalanx fingers: composed, closer together, natural relaxed curl
  const FZ    = [0.0225, 0.0075, -0.0075, -0.0225];
  const SPLAY = [0.04,   0.01,   -0.01,   -0.04];
  const FL    = [0.080,  0.088,   0.082,   0.066];
  const RAD   = [0.0074, 0.0076,  0.0072,  0.0064];
  const C1    = [0.16,   0.20,    0.26,    0.34];
  const C2    = [0.24,   0.30,    0.36,    0.44];
  const C3    = [0.20,   0.24,    0.28,    0.34];

  for (let i = 0; i < 4; i++) {
    const base = new THREE.Group();
    base.position.set(0.001, 0.072, FZ[i]);
    base.rotation.x = -SPLAY[i]; // fan slightly in Z
    hand.add(base);

    const r = RAD[i], L = FL[i];
    const p1 = addSegment(base, r,        r * 0.88, L * 0.45, C1[i]);
    const p2 = addSegment(p1,   r * 0.88, r * 0.78, L * 0.31, C2[i]);
    const p3 = addSegment(p2,   r * 0.78, r * 0.64, L * 0.24, C3[i]);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.64, 10, 8), skinMat);
    p3.add(cap);
  }

  // 3. Opposable thumb (metacarpal + proximal + distal)
  {
    const tBase = new THREE.Group();
    tBase.position.set(0.006, 0.024, 0.026);
    tBase.rotation.x = -0.52;  // angled forward (+Z)
    tBase.rotation.z = -0.22;  // angled slightly inward toward palm (+X)
    hand.add(tBase);

    const t1 = addSegment(tBase, 0.0098, 0.0088, 0.032, 0.12);
    const t2 = addSegment(t1,    0.0088, 0.0074, 0.026, 0.28);
    const tCap = new THREE.Mesh(new THREE.SphereGeometry(0.0074, 10, 8), skinMat);
    t2.add(tCap);
  }

  return root;
}

/* ---- physical 3D bandit / domino mask wrapping the face -------------------- */
function makeBanditMask(maskMat, eyeMat) {
  const grp = new THREE.Group();
  // Winged domino mask 2D silhouette (x = width, y = height around eye line)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.020);
  shape.bezierCurveTo(0.024, 0.024, 0.052, 0.032, 0.076, 0.022); // upper brow wing R
  shape.quadraticCurveTo(0.084, 0.010, 0.078, -0.008);         // outer temple R
  shape.bezierCurveTo(0.060, -0.024, 0.032, -0.024, 0.014, -0.012); // lower cheek R
  shape.quadraticCurveTo(0, -0.022, -0.014, -0.012);            // nose bridge dip
  shape.bezierCurveTo(-0.032, -0.024, -0.060, -0.024, -0.078, -0.008); // lower cheek L
  shape.quadraticCurveTo(-0.084, 0.010, -0.076, 0.022);         // outer temple L
  shape.bezierCurveTo(-0.052, 0.032, -0.024, 0.024, 0, 0.020);  // upper brow wing L

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.007, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0025, bevelSegments: 3, curveSegments: 16,
  });
  // Bend the flat mask around the cylindrical curvature of the face
  const pos = geo.attributes.position;
  const R = 0.086;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const theta = x / R;
    const nx = Math.sin(theta) * (R + z);
    const nz = Math.cos(theta) * (R + z) - R;
    // Slight forward nose-bridge peak in the center
    const nosePeak = Math.exp(-(x * x) / 0.00035) * 0.007 * (1 - Math.max(0, y) * 18);
    pos.setXYZ(i, nx, y, nz + nosePeak);
  }
  geo.computeVertexNormals();
  const maskMesh = new THREE.Mesh(geo, maskMat);
  maskMesh.castShadow = true; maskMesh.receiveShadow = true;
  grp.add(maskMesh);

  // Subtle dark-glossy eye lenses set into the bandit mask
  const eyeGeo = new THREE.SphereGeometry(0.012, 12, 8);
  for (const sx of [1, -1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(1.25, 0.52, 0.35);
    eye.position.set(sx * 0.029, 0.002, -0.001 + Math.cos((sx * 0.029) / R) * 0.007);
    eye.rotation.y = sx * 0.28;
    eye.rotation.z = -sx * 0.12;
    grp.add(eye);
  }

  // Position on the front of the head at eye level
  const EYE_Y = 1.690;
  grp.position.set(0, EYE_Y - P.head.y, surfaceZ(0, EYE_Y, 0) - 0.003);
  return grp;
}

/* ---- lower-face bandit bandana / gaiter over nose, mouth, jaw & neck ------ */
function makeBandanaMask(bandanaMat) {
  const NU = 28, NV = 8;
  const verts = [], indices = [];
  const THETA_MAX = Math.PI * 0.88; // wraps around the cheeks & jaw toward the back of the neck

  for (let iv = 0; iv <= NV; iv++) {
    const v = iv / NV; // 0 = bottom V-drape, 1 = upper bridge over nose & cheeks
    for (let iu = 0; iu <= NU; iu++) {
      const u = (iu / NU) * 2 - 1; // -1 .. +1 (0 = center front)
      const th = u * THETA_MAX;
      const au = Math.abs(u);

      // Top edge peaks over the nose bridge (u=0) and sweeps gently down across cheeks toward ears
      const yTop = (1.678 - P.head.y) - 0.018 * Math.pow(au, 1.4);
      // Bottom edge forms a classic pointed bandit bandana V-drape at the front throat
      const yBot = (1.588 - P.head.y) - 0.042 * (1 - Math.pow(au, 0.85));
      const y = yBot + v * (yTop - yBot);

      // Radius hugs the jaw/cheeks at the top and drapes slightly looser at the front V-tip
      const rBase = 0.072 + 0.014 * Math.sin(v * Math.PI * 0.7);
      const noseTent = Math.exp(-u * u * 18.0) * (0.012 + 0.006 * v);
      const drape = (1 - v) * (1 - au) * 0.010;
      const r = rBase + noseTent + drape;

      const x = Math.sin(th) * r * 0.90;
      const z = Math.cos(th) * r * 1.04 + 0.008;
      verts.push(x, y, z);
    }
  }
  for (let iv = 0; iv < NV; iv++) {
    for (let iu = 0; iu < NU; iu++) {
      const a = iv * (NU + 1) + iu, b = a + NU + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, bandanaMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/* ---- dramatic two-winged Dracula / vampire collar connected to the cape ----- */
function makeVampireCollar(outerMat, innerMat) {
  const grp = new THREE.Group();
  // Matches cape.js row v=0 in B.chest space: wrap = 1.72 rad, R = 0.125, y = 0.210
  const NU = 32, NV = 7;
  const WRAP = 1.72, R0 = 0.125, Y0 = 0.210;
  const verts = [], indices = [];

  for (let iv = 0; iv <= NV; iv++) {
    const v = iv / NV; // 0 = cape's pinned neck ring, 1 = high winged rim
    for (let iu = 0; iu <= NU; iu++) {
      const u = (iu / NU) * 2 - 1;
      const th = u * WRAP;
      const au = Math.abs(u);

      // Smaller, sleeker standing collar connected to the cape's neck ring
      const arch = Math.pow(Math.cos(au * Math.PI * 0.5), 0.75);
      const y = Y0 + v * 0.130 * arch;
      const r = R0 + v * 0.038 * arch;

      const x = Math.sin(th) * r;
      const z = -Math.cos(th) * r;
      verts.push(x, y, z);
    }
  }
  for (let iv = 0; iv < NV; iv++) {
    for (let iu = 0; iu < NU; iu++) {
      const a = iv * (NU + 1) + iu, b = a + NU + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const outerGeo = new THREE.BufferGeometry();
  outerGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  outerGeo.setIndex(indices);
  outerGeo.computeVertexNormals();

  // Inner lining offset slightly inward so both faces render cleanly with cape's wine lining
  const innerGeo = outerGeo.clone();
  const ip = innerGeo.attributes.position, norm = outerGeo.attributes.normal;
  for (let i = 0; i < ip.count; i++) {
    ip.setXYZ(i,
      ip.getX(i) - norm.getX(i) * 0.003,
      ip.getY(i) - norm.getY(i) * 0.003,
      ip.getZ(i) - norm.getZ(i) * 0.003
    );
  }
  const ii = innerGeo.getIndex().array;
  for (let i = 0; i < ii.length; i += 3) { const t = ii[i + 1]; ii[i + 1] = ii[i + 2]; ii[i + 2] = t; }
  innerGeo.computeVertexNormals();

  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  outerMesh.castShadow = true; outerMesh.receiveShadow = true;
  innerMesh.castShadow = true; innerMesh.receiveShadow = true;
  grp.add(outerMesh, innerMesh);
  return grp;
}

export function createAvatar(scene) {
  const shell = new THREE.SkinnedMesh(shellGeo, makeShellMaterial());
  shell.castShadow = true;
  shell.receiveShadow = true;
  shell.frustumCulled = false;
  // NOTE: deliberately a child of the scene, not of `model`. The bones move with
  // `model`; keeping the mesh's world matrix at identity (= the bind matrix)
  // means the character transform is applied exactly once, via the bones.
  scene.add(shell);
  shell.bind(skeleton, new THREE.Matrix4());

  const maskMat    = new THREE.MeshStandardMaterial({ color: 0x222530, roughness: 0.36, metalness: 0.12 });
  const bandanaMat = new THREE.MeshStandardMaterial({ color: 0x191b22, roughness: 0.84, metalness: 0.02, side: THREE.DoubleSide });
  const eyeLensMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.12, metalness: 0.35 });
  const collarOut  = new THREE.MeshStandardMaterial({ color: 0x1d0b14, roughness: 0.78, metalness: 0.0, side: THREE.DoubleSide });
  const collarIn   = new THREE.MeshStandardMaterial({ color: 0x8e1f2b, roughness: 0.78, metalness: 0.0, side: THREE.DoubleSide });
  const feltMat    = new THREE.MeshStandardMaterial({ color: 0x23201d, roughness: 0.92, metalness: 0.0 });
  const bandMat    = new THREE.MeshStandardMaterial({ color: 0x0d0b09, roughness: 0.68, metalness: 0.0 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x161519, roughness: 0.26, metalness: 0.08 });
  const soleMat    = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.62, metalness: 0.04 });
  const skinMat    = new THREE.MeshStandardMaterial({ color: shellUniforms.uSkin.value, roughness: 0.68, metalness: 0.0 });

  // Physical 3D bandit eye mask + lower-face bandana on the head, large upturned vampire collar on the chest
  B.head.add(makeBanditMask(maskMat, eyeLensMat));
  B.head.add(makeBandanaMask(bandanaMat));
  B.chest.add(makeVampireCollar(collarOut, collarIn));

  // Sculpted hands & realistic Oxford dress shoes attached to their bones
  for (const side of ['L', 'R']) {
    B['hand' + side].add(makeHand(side, skinMat));
    B['foot' + side].add(makeDressShoe(side, leatherMat, soleMat));
  }

  // the hat: brim, crown, band, parented to the head bone
  const hat = new THREE.Group();
  const brim  = new THREE.Mesh(new THREE.CylinderGeometry(0.182, 0.188, 0.014, 32), feltMat);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.106, 0.120, 0.132, 28), feltMat);
  const band  = new THREE.Mesh(new THREE.CylinderGeometry(0.1225, 0.1225, 0.032, 28), bandMat);
  band.position.y = 0.024;
  crown.position.y = 0.074;
  for (const m of [brim, crown, band]) { m.castShadow = true; m.receiveShadow = true; }
  hat.add(brim, band, crown);
  hat.position.set(0, 1.706 - P.head.y, 0.002);   // down on the head, not perched on the crown
  hat.rotation.set(-0.055, 0, 0.022);
  B.head.add(hat);

  return { shell, hat };
}
