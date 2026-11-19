// Model Viewer: inspects Mr. Strange, Templar, and Bat in Lower T-Pose or
// Idle / Walk / Run / Attack animations with 3D orbit, screen-space pan & zoom.

import * as THREE from 'three';
import { model, bones, bindLocalPos, B, fkAll } from './character/rig.js';
import { createAvatar } from './character/avatar.js';
import { createCape } from './character/cape.js';
import { createBat } from './character/bat.js';
import { buildTemplarRig, poseTemplarAttack, setTemplarLowerTPose, TEMPLAR_ATTACK_DURATION } from './world/templar.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111622);
scene.fog = new THREE.Fog(0x111622, 8, 22);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 50);

scene.add(new THREE.HemisphereLight(0xaec4e8, 0x221b24, 0.75));
const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
key.position.set(2.8, 4.5, 3.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.normalBias = 0.012;
scene.add(key);
const rim = new THREE.DirectionalLight(0x88b4ff, 1.1);
rim.position.set(-3.0, 2.6, -2.5);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3.5, 48),
  new THREE.MeshStandardMaterial({ color: 0x19202e, roughness: 0.85, metalness: 0.05 })
);
floor.rotation.x = -Math.PI * 0.5;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(6, 12, 0x38465e, 0x222b3b);
grid.position.y = 0.002;
scene.add(grid);

// Build all 3 models
scene.add(model);
const avatar = createAvatar(scene);
const cape = createCape(scene);

const templar = buildTemplarRig();
scene.add(templar.root);
setTemplarLowerTPose(templar);

const bat = createBat(scene);
const batMockChar = {
  pos: new THREE.Vector3(0, 0.25, 0),
  yaw: 0, morph: 1, flapPhase: 0.35, flapPower: 0.65, batGlide: 0, batSquish: 0, batGrounded: false,
};

let activeModel = 'man';
let activeAnim = 'tpose';
let wireframe = false;

function setVisible() {
  const isMan = activeModel === 'man';
  const isTem = activeModel === 'templar';
  const isBat = activeModel === 'bat';
  model.visible = isMan;
  avatar.shell.visible = isMan;
  cape.mesh.visible = isMan;
  templar.root.visible = isTem;
  bat.root.visible = isBat;
}

function applyWireframe(on) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m && m !== floor.material) m.wireframe = on;
  });
}

// Smooth 3D orbit + screen-space pan + zoom camera
let yaw = 0.45, pitch = 0.16, dist = 2.65;
const target = new THREE.Vector3(0, 0.96, 0);
let dragMode = 0, lx = 0, ly = 0;
const keys = Object.create(null);

function resetCamera() {
  yaw = 0.45;
  pitch = activeModel === 'templar' ? 0.29 : 0.16;
  dist = activeModel === 'bat' ? 1.85 : (activeModel === 'templar' ? 2.96 : 2.65);
  target.set(0, activeModel === 'bat' ? 1.15 : 0.96, 0);
}

canvas.addEventListener('pointerdown', (e) => {
  dragMode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 2 : 1;
  lx = e.clientX; ly = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (!dragMode) return;
  const dx = e.clientX - lx, dy = e.clientY - ly;
  lx = e.clientX; ly = e.clientY;
  if (dragMode === 1) {
    yaw -= dx * 0.008;
    pitch = Math.max(-0.55, Math.min(1.25, pitch + dy * 0.006));
  } else {
    // Screen-space pan along camera right and camera up
    const panScale = dist * 0.0016;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3(
      -Math.sin(yaw) * Math.sin(pitch),
      Math.cos(pitch),
      -Math.cos(yaw) * Math.sin(pitch)
    );
    target.addScaledVector(right, -dx * panScale);
    target.addScaledVector(up, dy * panScale);
  }
});
window.addEventListener('pointerup', () => { dragMode = 0; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  dist = Math.max(0.55, Math.min(7.5, dist + e.deltaY * 0.0022));
}, { passive: false });

window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'KeyR') resetCamera(); });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function resetPoses() {
  for (let i = 0; i < bones.length; i++) {
    bones[i].position.copy(bindLocalPos[i]);
    bones[i].quaternion.identity();
    bones[i].scale.set(1, 1, 1);
  }
  fkAll();
  cape.reset();
  setTemplarLowerTPose(templar);
  }

// UI wiring
document.querySelectorAll('[data-model]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-model]').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    activeModel = btn.dataset.model;
    resetCamera();
    setVisible();
  });
});

document.querySelectorAll('[data-anim]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-anim]').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    activeAnim = btn.dataset.anim;
    if (activeAnim === 'tpose') resetPoses();
  });
});

document.getElementById('wireBtn').addEventListener('click', (e) => {
  wireframe = !wireframe;
  e.currentTarget.classList.toggle('on', wireframe);
  applyWireframe(wireframe);
});
document.getElementById('resetBtn').addEventListener('click', resetCamera);

resetPoses();
setVisible();

function poseMan(t, anim) {
  for (let i = 0; i < bones.length; i++) {
    bones[i].position.copy(bindLocalPos[i]);
    bones[i].quaternion.identity();
  }
  if (anim === 'idle') {
    const b = Math.sin(t * 2.0);
    B.pelvis.position.y += b * 0.012;
    B.chest.rotation.x = b * 0.02;
    B.upperArmL.rotation.z = -0.04; B.upperArmR.rotation.z = 0.04;
    B.foreArmL.rotation.x = -0.18; B.foreArmR.rotation.x = -0.18;
  } else if (anim === 'walk' || anim === 'run') {
    const run = anim === 'run';
    const f = run ? 8.5 : 4.8;
    const sw = Math.sin(t * f) * (run ? 0.72 : 0.42);
    const lag = Math.sin(t * f - 0.55) * (run ? 0.65 : 0.35);
    B.pelvis.position.y += Math.abs(Math.cos(t * f)) * (run ? 0.055 : 0.025) - 0.03;
    B.pelvis.rotation.y = sw * 0.18;
    B.chest.rotation.set(run ? 0.18 : 0.05, -sw * 0.25, 0);
    B.head.rotation.set(run ? -0.14 : -0.03, sw * 0.1, 0);
    B.upperLegL.rotation.x = -sw; B.upperLegR.rotation.x = sw;
    B.lowerLegL.rotation.x = Math.max(0.06, lag * 0.9 + (run ? 0.35 : 0.1));
    B.lowerLegR.rotation.x = Math.max(0.06, -lag * 0.9 + (run ? 0.35 : 0.1));
    B.upperArmL.rotation.x = sw * 0.85; B.upperArmR.rotation.x = -sw * 0.85;
    B.foreArmL.rotation.x = run ? -1.1 : -0.35 - Math.max(0, sw) * 0.4;
    B.foreArmR.rotation.x = run ? -1.1 : -0.35 - Math.max(0, -sw) * 0.4;
  } else if (anim === 'attack') {
    const u = (t * 1.15) % 1;
    const slash = u < 0.35 ? -u / 0.35 : (u < 0.58 ? -1 + ((u - 0.35) / 0.23) * 2.1 : 1.1 * (1 - (u - 0.58) / 0.42));
    B.chest.rotation.set(0.12 * slash, slash * 0.45, 0);
    B.upperArmR.rotation.set(-1.1 + slash * 1.4, 0, 0.35);
    B.foreArmR.rotation.x = -0.6 + slash * 0.3;
    B.upperArmL.rotation.set(-0.3, 0, -0.45);
    B.upperLegL.rotation.x = -0.25; B.upperLegR.rotation.x = 0.25;
  }
  fkAll();
}

function poseTemplar(t, anim) {
  const r = templar;
  if (anim === 'tpose') { setTemplarLowerTPose(r); return; }
  if (anim === 'idle') {
    const b = Math.sin(t * 2.1);
    r.pelvis.position.y = 0.927 + b * 0.005;
    r.pelvis.rotation.set(0, -0.09, 0);
    r.torso.rotation.set(0.035 + b * 0.012, 0.09, 0);
    r.head.rotation.set(-0.025, Math.sin(t * 0.8) * 0.055, 0);
    r.armL.sh.rotation.set(-0.10, -0.06, 0.22);
    r.armL.el.rotation.set(-0.86, 0, 0);
    r.armR.sh.rotation.set(0.14, 0.24, -0.41);
    r.armR.el.rotation.set(-1.15, 0, 0);
    r.legL.hip.rotation.set(-0.185, 0.08, 0.112);
    r.legL.knee.rotation.x = 0.12;
    r.legL.ankle.rotation.x = 0.065;
    r.legR.hip.rotation.set(0.04, -0.14, -0.115);
    r.legR.knee.rotation.x = 0.12;
    r.legR.ankle.rotation.x = -0.16;
  } else if (anim === 'walk' || anim === 'run') {
    const run = anim === 'run';
    const f = run ? 8.0 : 4.5;
    const sw = Math.sin(t * f) * (run ? 0.65 : 0.40);
    const lag = Math.sin(t * f - 0.55) * (run ? 0.58 : 0.35);
    r.pelvis.position.y = 0.94 + Math.abs(Math.cos(t * f)) * (run ? 0.048 : 0.026);
    r.pelvis.rotation.set(0, sw * 0.16, -Math.cos(t * f) * 0.035);
    r.torso.rotation.set(run ? 0.18 : 0.05, -sw * 0.28, 0);
    r.head.rotation.set(run ? -0.12 : -0.03, sw * 0.15, 0);
    r.legL.hip.rotation.set(sw, 0, 0.02); r.legR.hip.rotation.set(-sw, 0, -0.02);
    r.legL.knee.rotation.x = Math.max(0.05, -lag * 0.95 + (run ? 0.25 : 0.1));
    r.legR.knee.rotation.x = Math.max(0.05,  lag * 0.95 + (run ? 0.25 : 0.1));
    r.legL.ankle.rotation.x = -sw * 0.35; r.legR.ankle.rotation.x = sw * 0.35;
    r.armL.sh.rotation.set(-sw * 0.72, 0, 0.18);
    r.armL.el.rotation.x = run ? -1.0 : -0.32 - Math.max(0, -lag) * 0.55;
    r.armR.sh.rotation.set(run ? -0.78 + sw * 0.25 : -0.30 + sw * 0.40, 0, -0.20);
    r.armR.el.rotation.x = run ? -0.82 : -0.52 - Math.max(0, lag) * 0.45;
  } else if (anim === 'attack') {
    r.pelvis.position.y = 0.92;
    r.pelvis.rotation.set(0, 0, 0);
    poseTemplarAttack(r, t % TEMPLAR_ATTACK_DURATION);
    r.legL.hip.rotation.set(-0.28, 0, 0.04); r.legL.knee.rotation.x = 0.35;
    r.legR.hip.rotation.set(0.32, 0, -0.04); r.legR.knee.rotation.x = 0.15;
  }
}

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now * 0.001;

  // WASD / Arrow keyboard pan
  const panSpd = dist * 0.9 * dt;
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  if (keys.KeyA || keys.ArrowLeft)  target.addScaledVector(right, -panSpd);
  if (keys.KeyD || keys.ArrowRight) target.addScaledVector(right,  panSpd);
  if (keys.KeyW || keys.ArrowUp)    target.addScaledVector(fwd,    panSpd);
  if (keys.KeyS || keys.ArrowDown)  target.addScaledVector(fwd,   -panSpd);
  if (keys.KeyE || keys.Space)      target.y += panSpd;
  if (keys.KeyQ || keys.KeyC)       target.y -= panSpd;

  if (activeModel === 'man' && activeAnim !== 'tpose') {
    poseMan(t, activeAnim);
    cape.update(dt);
  } else if (activeModel === 'templar') {
    poseTemplar(t, activeAnim);
    if (activeAnim !== 'tpose') templar.skirt.pose(templar.legL, templar.legR);
  } else if (activeModel === 'bat') {
    batMockChar.batGlide = activeAnim === 'run' ? 0.85 : 0;
    batMockChar.flapPower = activeAnim === 'attack' ? 1.0 : (activeAnim === 'walk' ? 0.75 : 0.55);
    if (activeAnim === 'tpose') {
      batMockChar.flapPhase = 0.25;
      bat.update(dt, batMockChar, 0, 0);
    } else {
      const freq = activeAnim === 'attack' ? 11.5 : (activeAnim === 'idle' ? 5.5 : 8.0);
      batMockChar.flapPhase += dt * freq;
      bat.update(dt, batMockChar, activeAnim === 'run' ? 0.25 : 0, activeAnim === 'attack' ? -0.35 : 0);
    }
  }

  const horiz = dist * Math.cos(pitch);
  camera.position.set(
    target.x + Math.sin(yaw) * horiz,
    target.y + dist * Math.sin(pitch),
    target.z + Math.cos(yaw) * horiz
  );
  camera.lookAt(target);
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
