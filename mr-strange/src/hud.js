// On-screen readouts: fps / speed / state, and the wind pill (tap to cycle).

import { wind, WIND_LEVELS } from './world/wind.js';
import { camFwd } from './camera.js';
import { char } from './character/motion.js';
import { keyHandlers } from './input.js';

const hudEl   = document.getElementById('hud');
const windEl  = document.getElementById('wind');
const arrowEl = document.getElementById('windArrow');
const labelEl = document.getElementById('windLabel');

function cycleWind() { wind.cycle(); }
windEl.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); cycleWind(); }, { passive: false });
keyHandlers.onWindKey = cycleWind;

let fpsTime = 0, fpsFrames = 0, lastSpeedText = '';

export function updateHud(dt) {
  fpsFrames++; fpsTime += dt;
  if (fpsTime < 0.25) return;
  const fps = Math.round(fpsFrames / fpsTime);
  fpsFrames = 0; fpsTime = 0;

  const state = char.mode !== 'free' ? char.mode : char.grounded ? (char.moveBlend < 0.05 ? 'idle' : (char.runBlend > 0.5 ? 'run' : 'walk')) : 'air';
  hudEl.textContent = fps + ' fps · ' + char.speed.toFixed(1) + ' m/s · ' + state;

  // arrow points the way the wind blows, relative to where the camera looks
  // (up = away from the camera)
  const ang = Math.atan2(wind.dx * -camFwd.z + wind.dz * camFwd.x, wind.dx * camFwd.x + wind.dz * camFwd.z);
  arrowEl.style.transform = 'rotate(' + ang.toFixed(3) + 'rad)';
  const text = WIND_LEVELS[wind.level].name + ' · ' + Math.round(wind.speed) + ' m/s';
  if (text !== lastSpeedText) { labelEl.textContent = text; lastSpeedText = text; }
}
