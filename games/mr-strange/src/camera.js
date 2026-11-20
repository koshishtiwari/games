// Lazy third-person chase camera. Also owns the camera-relative basis the
// movement code uses to turn stick input into a world direction.

import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, shortAngle } from './math.js';
import { char, facing } from './character/motion.js';
import { levelDither } from './world/level.js';

export const camFwd = new THREE.Vector3(0, 0, 1);
export const camRight = new THREE.Vector3(-1, 0, 0);

const camPos  = new THREE.Vector3();
const camLook = new THREE.Vector3();
const _t = new THREE.Vector3();
let camYaw = 0;
let camPitchOff = 0.22;
let smoothHeroY = 0;
let manualOrbitT = 0;

// Optional right-click / two-finger / wheel orbit & zoom
let orbitDrag = false, lastMX = 0, lastMY = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('a, button, .act')) return;
    if (e.button === 2 || (e.pointerType === 'mouse' && e.clientX >= window.innerWidth * 0.55)) {
      orbitDrag = true; lastMX = e.clientX; lastMY = e.clientY;
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!orbitDrag) return;
    const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
    lastMX = e.clientX; lastMY = e.clientY;
    camYaw -= dx * 0.0055;
    camPitchOff = clamp(camPitchOff + dy * 0.004, -0.25, 0.75);
    manualOrbitT = 1.6;
  });
  window.addEventListener('pointerup', () => { orbitDrag = false; });
}

export function updateCameraBasis(camera) {
  camera.getWorldDirection(camFwd);
  camFwd.y = 0;
  if (camFwd.lengthSq() < 1e-8) camFwd.set(0, 0, 1);
  camFwd.normalize();
  camRight.set(-camFwd.z, 0, camFwd.x);
}

// place the camera for frame 0 so nothing swoops in on load
export function snapCamera(camera) {
  camYaw = char.yaw;
  smoothHeroY = char.pos.y;
  camPos.set(char.pos.x - Math.sin(camYaw) * CFG.camDist, CFG.camHeight + 0.42, char.pos.z - Math.cos(camYaw) * CFG.camDist);
  camLook.set(char.pos.x, 1.12, char.pos.z);
  camera.position.copy(camPos);
  if (shakeAmp > 0.002) {
    const t = performance.now() * 0.05;
    camera.position.x += Math.sin(t * 1.7) * shakeAmp;
    camera.position.y += Math.sin(t * 2.3 + 1) * shakeAmp * 0.8;
    camera.position.z += Math.sin(t * 1.9 + 2) * shakeAmp;
    shakeAmp *= Math.exp(-7 * dt);
  } else shakeAmp = 0;
  camera.lookAt(camLook);
  levelDither.uCamPos.value.copy(camPos);
  levelDither.uHeroPos.value.copy(camLook);
}

let shakeAmp = 0;
/** Kick the camera (metres of jitter, decays by itself). */
export function kickCamera(amp) { shakeAmp = Math.max(shakeAmp, amp); }

export function updateCamera(camera, dt) {
  manualOrbitT = Math.max(0, manualOrbitT - dt);

  // Smooth auto-chase yaw (faster in Bat mode, paused briefly during manual mouse orbit)
  const chaseWeight = manualOrbitT > 0 ? 0.15 : 1.0;
  const yawRate = (char.isBat ? 6.2 : 3.2 * char.moveBlend) * chaseWeight;
  camYaw += shortAngle(char.yaw - camYaw) * (1 - Math.exp(-yawRate * dt));

  // Smooth vertical tracking: filters tiny hop jitter on foot, tracks roofs & bat altitude cleanly
  const yRate = char.isBat ? 10.0 : (char.grounded ? 9.0 : 3.5);
  smoothHeroY += (char.pos.y - smoothHeroY) * (1 - Math.exp(-yRate * dt));

  const altZoom = char.isBat ? Math.min(2.6, Math.max(0, char.pos.y - 1.5) * 0.16) : 0;
  const dist = char.isBat
    ? 2.75 * (1 + 0.42 * Math.min(1.5, char.speed / 12)) + altZoom
    : CFG.camDist * (1 + 0.25 * (char.speed / CFG.runSpeed));
  const pitch = char.isBat ? camPitchOff * 0.65 + char.batPitch * 0.35 : camPitchOff;
  const horizDist = dist * Math.cos(pitch);
  const vertOff = dist * Math.sin(pitch);

  const anchorY = smoothHeroY + (char.isBat ? 0.95 : 1.25);
  _t.set(
    char.pos.x - Math.sin(camYaw) * horizDist,
    anchorY + vertOff + 0.25,
    char.pos.z - Math.cos(camYaw) * horizDist
  );

  // Smooth camera lag (walls between camera and hero dissolve into dotted dither!)
  const lag = char.isBat ? 9.5 : CFG.camLag;
  camPos.lerp(_t, 1 - Math.exp(-lag * dt));
  if (camPos.y < CFG.camMinY) camPos.y = CFG.camMinY;
  camera.position.copy(camPos);

  // Dynamic FOV for sense of speed
  const speedRatio = char.isBat ? Math.min(1, char.speed / 15) : Math.min(1, char.speed / CFG.runSpeed) * 0.45;
  const targetFov = CFG.camFov + speedRatio * 14.0;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6.0 * dt));
    camera.updateProjectionMatrix();
  }

  // Look slightly ahead of the hero/bat
  const lookAhead = char.isBat ? 0.65 : 0.38 * char.moveBlend;
  _t.set(char.pos.x, anchorY - 0.08, char.pos.z)
    .addScaledVector(facing.fwd, lookAhead);
  camLook.lerp(_t, 1 - Math.exp(-(char.isBat ? 12.0 : CFG.camLookLag) * dt));
  camera.lookAt(camLook);

  // Update dither shader uniforms so any occluding wall turns dotted-transparent
  levelDither.uCamPos.value.copy(camPos);
  levelDither.uHeroPos.value.set(char.pos.x, char.pos.y + (char.isBat ? 0.92 : 1.15), char.pos.z);
}
