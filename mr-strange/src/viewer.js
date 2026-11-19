// Model Viewer: inspects Mr. Strange, Templar, and Bat in Lower T-Pose or
// Idle / Walk / Run / Attack animations with 3D orbit, screen-space pan & zoom.

import * as THREE from 'three';
import { model, bones, bindLocalPos, B, fkAll } from './character/rig.js';
import { createAvatar } from './character/avatar.js';
import { createCape } from './character/cape.js';
import { createBat } from './character/bat.js';
import { buildTemplarRig, poseTemplarAttack, setTemplarLowerTPose, TEMPLAR_ATTACK_DURATION } from './world/templar.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 50);

scene.add(new THREE.HemisphereLight(0xc4d4f0, 0x2a2430, 1.0));
const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
key.position.set(2.8, 4.5, 3.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.normalBias = 0.012;
scene.add(key);
const rim = new THREE.DirectionalLight(0x88b4ff, 1.1);
rim.position.set(-3.0, 2.6, -2.5);
scene.add(rim);

// stage: a shadow catcher (so the model sits on something) and a soft glow pool under it
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.42 }));
floor.rotation.x = -Math.PI * 0.5;
floor.receiveShadow = true;
floor.userData.noWire = true;
scene.add(floor);
{
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(120,150,210,0.38)'); gr.addColorStop(0.55, 'rgba(70,90,140,0.14)'); gr.addColorStop(1, 'rgba(40,50,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  pool.rotation.x = -Math.PI * 0.5; pool.position.y = 0.002; pool.userData.noWire = true;
  scene.add(pool);
}

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
    if (o.userData.noWire) return;
    for (const m of ms) if (m) m.wireframe = on;
  });
}

// Camera controls: one finger / left mouse = orbit, two fingers / right mouse /
// Shift = pan, pinch / wheel = zoom, double tap = reset. Everything eases out.
let yaw = 0.45, pitch = 0.16, dist = 2.65;
const target = new THREE.Vector3(0, 0.96, 0);
const keys = Object.create(null);
const vel = { yaw: 0, pitch: 0 };
const goal = { dist: 2.65 };
const ptrs = new Map();
let gesture = null, lastTap = 0;
let tool = 'orbit', spin = false, goalTarget = null;
const MODEL_NAMES = { man: 'Mr Vampire', templar: 'Templar', bat: 'Bat' };
const FRAMES = {                       // [target y, distance] for Full / Torso / Head / Feet
  man:     { full: [0.96, 2.65], torso: [1.30, 1.55], head: [1.60, 0.95], feet: [0.15, 1.45] },
  templar: { full: [0.96, 2.96], torso: [1.35, 1.70], head: [1.72, 1.00], feet: [0.15, 1.60] },
  bat:     { full: [1.15, 1.85], torso: [1.15, 1.25], head: [1.15, 0.95], feet: [1.05, 1.25] },
};
const tipEl = document.getElementById('tip');
const hideTip = () => tipEl && tipEl.classList.add('gone');

function resetCamera() {
  yaw = 0.45;
  pitch = activeModel === 'templar' ? 0.29 : 0.16;
  goal.dist = dist = activeModel === 'bat' ? 1.85 : (activeModel === 'templar' ? 2.96 : 2.65);
  target.set(0, activeModel === 'bat' ? 1.15 : 0.96, 0);
  goalTarget = null;
  vel.yaw = vel.pitch = 0;
}

const camRight = new THREE.Vector3(), camUp = new THREE.Vector3();
function panBy(dx, dy) {                     // screen pixels -> world, scaled to what is on screen
  camera.updateMatrixWorld();
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  camUp.setFromMatrixColumn(camera.matrixWorld, 1);
  const k = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / window.innerHeight;
  goalTarget = null;
  target.addScaledVector(camRight, -dx * k).addScaledVector(camUp, dy * k);
  target.x = THREE.MathUtils.clamp(target.x, -2, 2);
  target.z = THREE.MathUtils.clamp(target.z, -2, 2);
  target.y = THREE.MathUtils.clamp(target.y, 0, 2.4);
}
function frameOn(name) {              // glide to Full / Torso / Head / Feet
  const f = FRAMES[activeModel][name];
  goalTarget = new THREE.Vector3(0, f[0], 0);
  goal.dist = f[1];
}
function orbitBy(dx, dy) {
  goalTarget = null;
  yaw -= dx * 0.0075;
  pitch = THREE.MathUtils.clamp(pitch + dy * 0.0055, -0.5, 1.3);
}
const zoomBy = (f) => { goal.dist = THREE.MathUtils.clamp(goal.dist * f, 0.55, 7.5); };

function startGesture() {
  const p = [...ptrs.values()];
  if (p.length >= 2) {
    gesture = { type: 'two', cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1 };
  } else if (p.length === 1) {
    gesture = { type: p[0].pan ? 'pan' : 'orbit' };
  } else gesture = null;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey || tool === 'pan', t: performance.now(), x0: e.clientX, y0: e.clientY });
  vel.yaw = vel.pitch = 0;
  startGesture();
  hideTip();
});
canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (!gesture) return;
  if (gesture.type === 'orbit') { orbitBy(dx, dy); vel.yaw = -dx * 0.0075; vel.pitch = dy * 0.0055; }
  else if (gesture.type === 'pan') panBy(dx, dy);
  else if (gesture.type === 'two' && ptrs.size >= 2) {
    const q = [...ptrs.values()];
    const cx = (q[0].x + q[1].x) / 2, cy = (q[0].y + q[1].y) / 2, d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y) || 1;
    panBy(cx - gesture.cx, cy - gesture.cy);
    const f = gesture.d / d;
    dist = goal.dist = THREE.MathUtils.clamp(dist * f, 0.55, 7.5);
    gesture.cx = cx; gesture.cy = cy; gesture.d = d;
  }
});
function endPointer(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const now = performance.now();
  if (e.type === 'pointerup' && ptrs.size === 1 && Math.hypot(p.x - p.x0, p.y - p.y0) < 8 && now - p.t < 300) {
    if (now - lastTap < 320) { resetCamera(); lastTap = 0; } else lastTap = now;     // double tap: reset
  }
  ptrs.delete(e.pointerId);
  startGesture();
  if (gesture && gesture.type === 'orbit') { vel.yaw = vel.pitch = 0; }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.shiftKey) panBy(-e.deltaX - e.deltaY, 0);                       // shift + wheel: pan sideways
  else if (e.ctrlKey) zoomBy(Math.exp(e.deltaY * 0.01));                // trackpad pinch
  else zoomBy(Math.exp(e.deltaY * 0.0012));
  hideTip();
}, { passive: false });

window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'KeyR') resetCamera(); });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// keep the model centred in the part of the screen the controls do not cover
const panelEl = document.getElementById('panel');
function layoutView() {
  const W = window.innerWidth, H = window.innerHeight;
  camera.aspect = W / H;
  const pr = panelEl.getBoundingClientRect();
  let cx = W / 2, cy = H / 2;
  if (W >= H) { const left = pr.right + 8, right = W - 72; if (right > left) cx = (left + right) / 2; }
  else { const bottom = pr.top - 8; if (bottom > 80) cy = (72 + bottom) / 2; }
  camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  layoutView();
});
if (window.ResizeObserver) new ResizeObserver(layoutView).observe(panelEl);

function stepControls(dt) {
  if (goalTarget) { target.lerp(goalTarget, Math.min(1, dt * 7)); if (target.distanceToSquared(goalTarget) < 1e-5) goalTarget = null; }
  if (spin && !ptrs.size) yaw += dt * 0.55;
  if (!ptrs.size && (Math.abs(vel.yaw) > 1e-4 || Math.abs(vel.pitch) > 1e-4)) {       // coast after a flick
    yaw += vel.yaw * dt * 60; pitch = THREE.MathUtils.clamp(pitch + vel.pitch * dt * 60, -0.5, 1.3);
    const decay = Math.exp(-dt * 5); vel.yaw *= decay; vel.pitch *= decay;
  }
  dist += (goal.dist - dist) * Math.min(1, dt * 12);
}

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
    setTitle();
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
document.querySelectorAll('[data-tool]').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('on'));
  btn.classList.add('on'); tool = btn.dataset.tool;
}));
document.querySelectorAll('[data-frame]').forEach((btn) => btn.addEventListener('click', () => frameOn(btn.dataset.frame)));
document.getElementById('spinBtn').addEventListener('click', (e) => { spin = !spin; e.currentTarget.classList.toggle('on', spin); });
document.getElementById('sheetBtn').addEventListener('click', () => document.getElementById('panel').classList.toggle('closed'));
const titleEl = document.getElementById('title');
const setTitle = () => { titleEl.textContent = MODEL_NAMES[activeModel]; };

resetPoses();
setVisible();
setTitle();
layoutView();

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

  stepControls(dt);
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
