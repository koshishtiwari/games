// Sword-and-shield moves for the knights: Mixamo clips retargeted onto the rigid-group rig (templar-clip.js).
//
//   lunge   a charging thrust-slash that travels about 2.5 m (clip root motion, used for real: the knight moves)
//   slash   an in-place overhead slash with a small step
//   strafe  a guarded side-step loop, played by distance travelled so the feet plant
//
// A move gives the pose for a clip frame, the root offset (how far the clip's hips have travelled since it
// began, in the knight's root space) and the strike window. The blade is placed along the clip's forearm and
// hand direction; the shield is held square to the chest.

import * as THREE from 'three';
import lungeClip from '../character/sword-attack-clip.js';
import slashClip from '../character/sword-slash-clip.js';
import strafeClip from '../character/sword-strafe-clip.js';
import deathClip from '../character/sword-death-clip.js';
import { createClipPoser } from './templar-clip.js';

const FPS = 30;

//   from / to  clip frames played        rate  playback speed
//   strike     [first, last] frames in which the blade can hurt
//   reach      how far from the knight's start the blade tip gets at the strike (for choosing and scaling)
const DEFS = {
  lunge: { clip: lungeClip, from: 0, to: 34, rate: 1.25, strike: [12, 22], reach: 2.4 },
  slash: { clip: slashClip, from: 0, to: 42, rate: 1.25, strike: [14, 23], reach: 1.2 },
};

export const MOVES = {};
for (const [name, d] of Object.entries(DEFS)) {
  const poser = createClipPoser(d.clip);
  const f0 = poser.frames[d.from], hi = poser.J.Hips * 3;
  MOVES[name] = {
    ...d, poser, name,
    hips0: new THREE.Vector3(f0[hi], f0[hi + 1], f0[hi + 2]),
    duration: (d.to - d.from) / FPS / d.rate,
    strikeFrom: (d.strike[0] - d.from) / FPS / d.rate,      // seconds into the move
    strikeTo: (d.strike[1] - d.from) / FPS / d.rate,
  };
}
export const frameAt = (move, t) => move.from + t * FPS * move.rate;

const _o = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const _qE = new THREE.Quaternion(), _qR = new THREE.Quaternion(), _qS = new THREE.Quaternion(), _qT = new THREE.Quaternion();
const _D = new THREE.Vector3(), _t = new THREE.Vector3();

/** Clip-space root travel (xz) of the hips since the move began, at `frame`. */
export function rootOffset(move, frame, out) {
  const { P, J } = move.poser;
  move.poser.sample(frame);
  return out.set(P[J.Hips].x - move.hips0.x, 0, P[J.Hips].z - move.hips0.z);
}

/** Blade along the forearm and hand (right arm). Call after the arm has been posed. */
function aimSword(rig, poser) {
  const { P, J } = poser;
  _D.subVectors(P[J.RightHand], P[J.RightForeArm]).normalize();
  _D.add(_t.subVectors(P[J.RightHandMiddle1], P[J.RightHand]).normalize()).normalize();
  rig.armR.el.getWorldQuaternion(_qE);
  rig.root.getWorldQuaternion(_qR);
  _D.applyQuaternion(_qR);                                  // root space to world
  _qS.setFromUnitVectors(Y, _D);
  rig.sword.quaternion.copy(_qE.invert()).multiply(_qS);
}

/** Shield held square to the chest, wherever the forearm points. */
export function aimShield(rig) {
  const sh = rig.shield;
  if (!sh || !sh.userData.chestRel) return;
  rig.torso.getWorldQuaternion(_qT);
  rig.armL.el.getWorldQuaternion(_qE);
  sh.quaternion.copy(_qE.invert()).multiply(_qT.multiply(sh.userData.chestRel));
}

/** Put the weapon and shield back to how they sit in a plain pose. */
export function restoreGear(rig) {
  rig.sword.quaternion.copy(rig.sword.userData.baseQuat);
  if (rig.shield && rig.shield.userData.baseQuat) rig.shield.quaternion.copy(rig.shield.userData.baseQuat);
}

/** Pose the rig from `frame` of `move`, blended in by `w`. The root offset is left out of the pelvis: the
 *  caller moves the knight by it (see rootOffset), so the body stays centred. */
export function poseMove(rig, move, frame, w) {
  rootOffset(move, frame, _o);
  _o.negate();
  move.poser.pose(rig, frame, w, _o, null);
  aimSword(rig, move.poser);
  aimShield(rig);
}

/* ---- strafe: a loop played by distance, so the planted foot does not slide ---- */
const STRAFE = (() => {
  const poser = createClipPoser(strafeClip);
  const last = 33;                                          // frame 34 repeats frame 0
  const hi = poser.J.Hips * 3, a = poser.frames[0], b = poser.frames[last];
  return { poser, last, hips0: new THREE.Vector3(a[hi], a[hi + 1], a[hi + 2]), metres: Math.hypot(b[hi] - a[hi], b[hi + 2] - a[hi + 2]) * (last + 1) / last };
})();
export const STRAFE_METRES = STRAFE.metres;                  // distance covered by one loop of the clip (to the right)

/**
 * Pose a side-step. `phase` is metres travelled / STRAFE_METRES; `left` plays the loop backwards, which
 * is a step to the other side (the clip itself only goes to the right, and mirroring would swap the sword hand).
 */
export function poseStrafe(rig, phase, left, w) {
  let f = (((phase % 1) + 1) % 1) * (STRAFE.last + 1);
  if (left) f = STRAFE.last + 1 - f;
  f = Math.min(f, STRAFE.last);
  const { P, J } = STRAFE.poser;
  STRAFE.poser.sample(f);
  _o.set(-(P[J.Hips].x - STRAFE.hips0.x), 0, -(P[J.Hips].z - STRAFE.hips0.z));
  STRAFE.poser.pose(rig, f, w, _o, null);
  aimSword(rig, STRAFE.poser);
  aimShield(rig);
}

// For the model viewer: the lunge, played in place.
export const TEMPLAR_ATTACK_DURATION = MOVES.lunge.duration;
export function poseTemplarAttack(rig, time) {
  poseMove(rig, MOVES.lunge, frameAt(MOVES.lunge, Math.min(time, MOVES.lunge.duration)), 1);
}

/* ---- knocked down face first, and getting back up from it ----
   The death clip: the knight reels, his knees go, and he falls forward onto his face. The way up is the same
   clip played backwards (pushing up onto the knees, then standing), a touch faster. */
const DEATH = { poser: createClipPoser(deathClip), from: 10, to: 106, fallRate: 1.5, riseRate: 1.9 };
export const FALL_FRONT_DURATION = (DEATH.to - DEATH.from) / FPS / DEATH.fallRate;
export const RISE_FRONT_DURATION = (DEATH.to - DEATH.from) / FPS / DEATH.riseRate;

function poseDeathFrame(rig, frame, w) {
  DEATH.poser.pose(rig, frame, w, null, null);
  aimSword(rig, DEATH.poser);
  aimShield(rig);
}
/** `t` seconds into the fall (clamped at the lying pose). */
export function poseFallFront(rig, t, w) {
  poseDeathFrame(rig, Math.min(DEATH.to, DEATH.from + t * FPS * DEATH.fallRate), w);
}
/** `t` seconds into the get-up from lying face down. */
export function poseRiseFront(rig, t, w) {
  poseDeathFrame(rig, Math.max(DEATH.from, DEATH.to - t * FPS * DEATH.riseRate), w);
}
