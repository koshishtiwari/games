// Wind you can SEE: a cloud of tapered streaks that ride the same wind field the
// cape feels, in ONE instanced draw call. All motion happens in the vertex
// shader. The CPU only updates three uniforms per frame (centre, air offset,
// wind vector), so it costs essentially nothing no matter how many streaks.

import * as THREE from 'three';
import { wind } from './wind.js';

const COUNT = 260;
const BOX = new THREE.Vector3(26, 6.5, 26);   // streaks live in this box around the hero

const VERT = /* glsl */`
  attribute vec2 aCorner;      // x: 0 tail .. 1 head, y: -1 .. 1 across
  attribute vec4 aSeed;        // per-streak random numbers
  uniform vec3  uCenter;
  uniform vec3  uBox;
  uniform vec3  uOffset;       // integrated air displacement
  uniform vec3  uWind;         // current wind vector at the hero
  uniform float uTime;
  varying float vAlpha;
  varying float vAcross;

  void main() {
    float sp = length(uWind);
    vec3 dir = sp > 0.01 ? uWind / sp : vec3(0.0, 0.0, 1.0);

    // each streak drifts with the air (a little faster or slower), wrapped to the box
    float k = 0.7 + aSeed.w * 0.6;
    vec3 base = aSeed.xyz * uBox;
    vec3 head = base + uOffset * k;
    head = mod(head - uCenter + uBox * 0.5, uBox) + uCenter - uBox * 0.5;
    head.y = 0.12 + aSeed.y * aSeed.y * (uBox.y);               // bunched toward the ground

    // gentle swirl so they are not ruler straight
    float ph = uTime * 1.3 + aSeed.x * 40.0;
    head += vec3(sin(ph) * 0.35, sin(ph * 1.7 + 1.0) * 0.18, cos(ph * 0.9) * 0.35) * (0.4 + aSeed.z);

    float len = (0.35 + aSeed.z * 1.1) * (0.35 + sp * 0.16);     // longer in a stronger wind
    vec3 p = head - dir * len * (1.0 - aCorner.x);

    // ribbon faces the camera: widen along (dir x view)
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(dir, toCam));
    float w = 0.012 + 0.010 * aSeed.z;
    p += side * aCorner.y * w * aCorner.x;                         // 0 width at the tail: a taper

    // fade at the box edge and with distance from the hero; vanish when calm
    vec3 rel = (p - uCenter) / (uBox * 0.5);
    float edge = 1.0 - smoothstep(0.55, 1.0, max(abs(rel.x), abs(rel.z)));
    float amt = smoothstep(1.5, 8.0, sp);
    vAlpha = edge * amt * (0.25 + 0.5 * aSeed.z) * aCorner.x;
    vAcross = aCorner.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const FRAG = /* glsl */`
  varying float vAlpha;
  varying float vAcross;
  void main() {
    float soft = 1.0 - abs(vAcross);
    gl_FragColor = vec4(0.72, 0.84, 1.0, vAlpha * soft);
  }
`;

export function createWindFx(scene) {
  const base = new THREE.InstancedBufferGeometry();
  // one quad: (tail,-1) (tail,+1) (head,-1) (head,+1)
  base.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  base.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
  base.setIndex([0, 1, 2, 2, 1, 3]);

  const seed = new Float32Array(COUNT * 4);
  let s = 12345;                                            // deterministic: same look every run
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < seed.length; i++) seed[i] = rnd();
  base.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  base.instanceCount = COUNT;

  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uBox:    { value: BOX.clone() },
    uOffset: { value: new THREE.Vector3() },
    uWind:   { value: new THREE.Vector3() },
    uTime:   { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(base, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);

  const _w = { x: 0, y: 0, z: 0 };
  return {
    mesh,
    update(center) {
      wind.sampleMean(center.x, center.z, _w);
      uniforms.uCenter.value.set(center.x, 0, center.z);
      uniforms.uOffset.value.set(wind.offset.x, 0, wind.offset.z);
      uniforms.uWind.value.set(_w.x, 0, _w.z);
      uniforms.uTime.value = wind.t;
    },
  };
}
