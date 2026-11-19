// The knights' get-up: a Mixamo "stand up" clip retargeted onto the rigid-group knight rig.
//
// The clip is stored as joint positions (scripts/bake-mixamo-clip.mjs). Each frame we rebuild the pelvis
// and chest orientation from the hip line and shoulder line, then aim every limb segment along its
// clip direction (upper arm, forearm, thigh, shin, foot), working down the hierarchy in quaternions.
// The knight rig is a tree of groups whose zero rotation hangs the limbs along -Y, so a limb's local
// rotation is simply "turn -Y onto the clip direction, relative to the parent".

import * as THREE from 'three';
import clip from '../character/getup-clip.js';
import { createClipPoser } from './templar-clip.js';

const J = {};
clip.joints.forEach((n, i) => { J[n] = i; });
const FRAMES = clip.frames.map(f => Float32Array.from(f));

// The clip lies still for a second before it moves, then sits up and stands around frame 84, and then idles
// as a hunched zombie. Only the get-up itself is used.
export const GETUP_FROM = 20, GETUP_TO = 92, GETUP_RATE = 1.35;
export const GETUP_FPS = clip.fps * GETUP_RATE;
export const GETUP_DURATION = (GETUP_TO - GETUP_FROM) / clip.fps / GETUP_RATE;

// Where a knocked-down knight's pelvis is (root space): the root pivots at the feet, so a fallen knight
// lies with the pelvis one hip-height behind them, lifted a little off the floor.
export const FALLEN_PELVIS = new THREE.Vector3(0, 0.13, -0.94);
export const FALLEN_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

const f0 = FRAMES[GETUP_FROM];
export const ORIGIN = new THREE.Vector3(f0[J.Hips * 3], f0[J.Hips * 3 + 1], f0[J.Hips * 3 + 2]).negate().add(FALLEN_PELVIS);

const poser = createClipPoser(clip);

/** Pose the knight rig from clip `frame`, blended over its current pose by `w` (0..1). */
export function poseGetUp(rig, frame, w) {
  poser.pose(rig, frame, w, ORIGIN);
}

/** Pelvis position (root space) at the end of the clip, to move the knight's origin under it. */
export function endPelvis(out) {
  const e = FRAMES[GETUP_TO];
  return out.set(e[J.Hips * 3] + ORIGIN.x, e[J.Hips * 3 + 1] + ORIGIN.y, e[J.Hips * 3 + 2] + ORIGIN.z);
}
