// Level data shared with collision and traversal. The boxes ARE the collision
// world (see collision.js); the forest (forest.js) fills them with trunk
// colliders. `ropes` is kept for the traversal code and is empty for now.
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
