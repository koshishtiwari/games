// On-screen readout: fps / speed / state.

import { char } from './character/motion.js';

const hudEl = document.getElementById('hud');
let fpsTime = 0, fpsFrames = 0;

export function updateHud(dt) {
  fpsFrames++; fpsTime += dt;
  if (fpsTime < 0.25) return;
  const fps = Math.round(fpsFrames / fpsTime);
  fpsFrames = 0; fpsTime = 0;
  const state = char.mode !== 'free' ? char.mode : char.grounded ? (char.moveBlend < 0.05 ? 'idle' : (char.runBlend > 0.5 ? 'run' : 'walk')) : 'air';
  hudEl.textContent = fps + ' fps  ' + char.speed.toFixed(1) + ' m/s  ' + state;
}
