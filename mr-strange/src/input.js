// Input: dynamic joystick (left of screen), jump button (right), keyboard
// fallback. Exposes one plain `input` object the simulation reads.

export const input = { x: 0, y: 0, mag: 0, jumpQueued: false, jumpHeld: false, diveHeld: false, morphQueued: false, punchQueued: false, slamQueued: false };

const canvas  = document.getElementById('gl');
const stickEl = document.getElementById('stick');
const baseEl  = document.getElementById('stickBase');
const knobEl  = document.getElementById('stickKnob');
const jumpEl  = document.getElementById('jump');
const batEl   = document.getElementById('bat');
const punchEl = document.getElementById('punch');
const slamEl  = document.getElementById('slam');
const hintEl  = document.getElementById('hint');

const STICK_RADIUS = 58, STICK_DEAD = 0.14;
let stickId = null, stickOX = 0, stickOY = 0;
let hintGone = false;
export function dismissHint() { if (!hintGone) { hintGone = true; hintEl.classList.add('gone'); } }

function placeStick(ox, oy, kx, ky) {
  baseEl.style.transform = 'translate(' + ox + 'px,' + oy + 'px) translate(-50%,-50%)';
  knobEl.style.transform = 'translate(' + kx + 'px,' + ky + 'px) translate(-50%,-50%)';
}
function beginStick(id, x, y) {
  stickId = id; stickOX = x; stickOY = y;
  placeStick(x, y, x, y);
  stickEl.classList.add('on');
  dismissHint();
}
function moveStick(x, y) {
  let dx = x - stickOX, dy = y - stickOY;
  const len = Math.hypot(dx, dy);
  if (len > STICK_RADIUS) { const k = STICK_RADIUS / len; dx *= k; dy *= k; }
  placeStick(stickOX, stickOY, stickOX + dx, stickOY + dy);
  const raw = Math.min(len, STICK_RADIUS) / STICK_RADIUS;
  if (raw <= STICK_DEAD || len < 1e-4) { input.x = 0; input.y = 0; input.mag = 0; return; }
  const inv = 1 / Math.hypot(dx, dy);
  input.x = dx * inv;                       // +1 = screen right
  input.y = -dy * inv;                      // +1 = screen up = away from camera
  input.mag = (raw - STICK_DEAD) / (1 - STICK_DEAD);
}
function endStick() {
  stickId = null;
  stickEl.classList.remove('on');
  input.x = 0; input.y = 0; input.mag = 0;
}

let jumpId = null;
function pressJump() { input.jumpQueued = true; input.jumpHeld = true; jumpEl.classList.add('press'); dismissHint(); }
function releaseJump() { input.jumpHeld = false; jumpEl.classList.remove('press'); }

function onDown(e) {
  e.preventDefault();
  const isLeft = e.clientX < window.innerWidth * 0.55;
  if (isLeft) { if (stickId === null) beginStick(e.pointerId, e.clientX, e.clientY); }
  else if (jumpId === null) { jumpId = e.pointerId; pressJump(); }
}
function onMove(e) { if (e.pointerId === stickId) { e.preventDefault(); moveStick(e.clientX, e.clientY); } }
function onUp(e) {
  if (e.pointerId === stickId) { e.preventDefault(); endStick(); }
  if (e.pointerId === jumpId)  { jumpId = null; releaseJump(); }
}

canvas.addEventListener('pointerdown', onDown, { passive: false });
window.addEventListener('pointermove', onMove, { passive: false });
window.addEventListener('pointerup', onUp, { passive: false });
window.addEventListener('pointercancel', onUp, { passive: false });

// The button owns its own pointer id so it still works while the stick is held.
jumpEl.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  if (jumpId === null) { jumpId = e.pointerId; pressJump(); }
}, { passive: false });

if (batEl) {
  batEl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    input.morphQueued = true;
    batEl.classList.add('press');
    setTimeout(() => batEl.classList.remove('press'), 140);
    dismissHint();
  }, { passive: false });
}

if (punchEl) {
  punchEl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    input.punchQueued = true;
    punchEl.classList.add('press');
    setTimeout(() => punchEl.classList.remove('press'), 140);
    dismissHint();
  }, { passive: false });
}

if (slamEl) {
  slamEl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    input.slamQueued = true;
    slamEl.classList.add('press');
    setTimeout(() => slamEl.classList.remove('press'), 140);
    dismissHint();
  }, { passive: false });
}

// Belt and braces against iOS pinch-zoom / double-tap-zoom / rubber banding.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu']) {
  window.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
window.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// --- keyboard fallback ---
const keys = Object.create(null);
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); pressJump(); }
  if (e.code === 'KeyB' || e.code === 'KeyE') { input.morphQueued = true; }
  if (e.code === 'KeyJ' || e.code === 'KeyK') { input.punchQueued = true; }
  if (e.code === 'KeyL' || e.code === 'KeyU') { input.slamQueued = true; }
  if (e.code === 'KeyC' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.diveHeld = true; }
  dismissHint();
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space') releaseJump();
  if (e.code === 'KeyC' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    input.diveHeld = !!(keys.KeyC || keys.ShiftLeft || keys.ShiftRight);
  }
});

export function readKeyboard() {
  if (stickId !== null) return;                        // an active thumb wins
  const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const ky = (keys.KeyW || keys.ArrowUp    ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  if (kx === 0 && ky === 0) { input.x = 0; input.y = 0; input.mag = 0; return; }
  const inv = 1 / Math.hypot(kx, ky);
  input.x = kx * inv; input.y = ky * inv;
  input.mag = (keys.ShiftLeft || keys.ShiftRight) ? 0.50 : 1;   // Shift = walk
}
