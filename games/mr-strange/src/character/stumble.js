// Hit reactions for the man: four Mixamo "Standing React Large" clips (pushed back, forward, to the left and to
// the right), blended by the direction of the push.
//
// The push direction, in the hero's own frame, picks the two nearest clips around the compass (a hit from front
// and slightly left gets Front blended into Left) and they are blended joint by joint, so any direction gets a
// stumble that travels that way. Clips are played on a shared normalised time `u` (0..1), so a longer clip and a
// shorter one stay in step. The blended hips give the root motion, which really moves the hero (traversal.js).

import front from './react-front-clip.js';
import back from './react-back-clip.js';
import left from './react-left-clip.js';
import right from './react-right-clip.js';

const FPS = 30, RATE = 1.2;
// `to`: last frame used (the clips' final frame wraps back to the start pose)
const DEFS = {
  front: { frames: front.frames.map(f => Float32Array.from(f)), to: 39 },
  back:  { frames: back.frames.map(f => Float32Array.from(f)),  to: 28 },
  left:  { frames: left.frames.map(f => Float32Array.from(f)),  to: 28 },
  right: { frames: right.frames.map(f => Float32Array.from(f)), to: 28 },
};
for (const d of Object.values(DEFS)) d.seconds = d.to / FPS / RATE;

export const JOINTS = front.joints;
export const NJ = JOINTS.length;
export const HIPS = JOINTS.indexOf('Hips');

/**
 * Which clips, and how much of each, for a push of (lx, lz) in the hero's frame (+x his left, +z forward).
 * Pushed forward is the "From Back" clip, pushed to his left is "From Right", and so on around the circle.
 */
export function planStumble(lx, lz) {
  const phi = Math.atan2(lx, lz);                         // 0 = pushed forward, +pi/2 = pushed left, pi = pushed back
  const H = Math.PI / 2;
  let a, b, w;
  if (phi >= 0 && phi < H) { a = 'back'; b = 'right'; w = phi / H; }
  else if (phi >= H) { a = 'right'; b = 'front'; w = (phi - H) / H; }
  else if (phi >= -H) { a = 'left'; b = 'back'; w = (phi + H) / H; }
  else { a = 'front'; b = 'left'; w = (phi + Math.PI) / H; }
  const A = DEFS[a], B = DEFS[b];
  return { a: A, b: B, w, nameA: a, nameB: b, seconds: A.seconds + (B.seconds - A.seconds) * w };
}

function sampleOne(def, u, out, k0, k1) {
  const f = Math.min(def.to, Math.max(0, u * def.to));
  const i0 = Math.floor(f), i1 = Math.min(def.to, i0 + 1), t = f - i0;
  const fa = def.frames[i0], fb = def.frames[i1];
  for (let j = 0; j < NJ * 3; j++) out[j] += (fa[j] + (fb[j] - fa[j]) * t) * k0;
}

/** Blended joint positions (clip space, NJ x 3) at normalised time u, written into `out`. */
export function sampleStumble(plan, u, out) {
  out.fill(0);
  sampleOne(plan.a, u, out, 1 - plan.w);
  sampleOne(plan.b, u, out, plan.w);
  return out;
}
