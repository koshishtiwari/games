// Archer pose: the Mixamo "Shooting Arrow" clip, played in three phases so the archer can aim for as long
// as it takes, and retargeted onto the knight rig with the upper body turned toward the target.
//
//   draw     pull an arrow from the quiver, nock it, raise the bow, draw          (clip frames 6 to 90)
//   hold     the drawn pose, creeping slowly while the archer tracks the target   (frames 90 to 118)
//   release  loose the arrow at frame 128, lower the bow                          (frames 118 to 150)

import * as THREE from 'three';
import clip from '../character/bow-clip.js';
import { createClipPoser } from './templar-clip.js';

const poser = createClipPoser(clip);
const { J, P } = poser;
const FPS = clip.fps;

export const DRAW = { from: 6, to: 90, rate: 3.0 };
export const HOLD = { from: 90, to: 118 };
export const RELEASE = { from: 118, to: 150, rate: 1.9, loose: 128 };
const NOCKED_AT = 62, STRING_DRAWN_AT = 74, ARROW_IN_HAND = 34;

export const drawSeconds = (DRAW.to - DRAW.from) / FPS / DRAW.rate;
export const releaseSeconds = (RELEASE.to - RELEASE.from) / FPS / RELEASE.rate;
export const looseSeconds = (RELEASE.loose - RELEASE.from) / FPS / RELEASE.rate;

export const drawFrame = (t) => DRAW.from + t * FPS * DRAW.rate;
export const holdFrame = (t, dur) => HOLD.from + Math.min(1, t / dur) * (HOLD.to - HOLD.from);
export const releaseFrame = (t) => RELEASE.from + t * FPS * RELEASE.rate;

// Where the clip aims at full draw (from the draw hand to the bow hand), as a yaw and a pitch in root space.
const _d = new THREE.Vector3();
poser.sample(100);
_d.subVectors(P[J.LeftHand], P[J.RightHand]);
export const CLIP_AIM = { yaw: Math.atan2(_d.x, _d.z), pitch: Math.atan2(_d.y, Math.hypot(_d.x, _d.z)) };

const _qYaw = new THREE.Quaternion(), _qPitch = new THREE.Quaternion(), _rot = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0);
const _lh = new THREE.Vector3(), _rh = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3();
const _m = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _inv = new THREE.Quaternion(), _loc = new THREE.Vector3();
const REST_NOCK = new THREE.Vector3(0, 0, -0.2);

/**
 * Pose the rig at clip `frame`, blended in by `w`, with the aim turned to `yaw` / `pitch` (radians, root
 * space), then put the bow in the hand and drag the string. `loosed` hides the arrow and relaxes the string.
 * Returns the bow-local nock position through bow.nock for the caller to read.
 */
export function poseArcher(rig, frame, w, yaw, pitch, loosed) {
  _qYaw.setFromAxisAngle(AXIS_Y, yaw - CLIP_AIM.yaw);
  _qPitch.setFromAxisAngle(AXIS_X, -(pitch - CLIP_AIM.pitch));       // aiming up is a negative turn about +X
  _rot.copy(_qYaw).multiply(_qPitch);
  poser.pose(rig, frame, w, null, _rot);

  // the bow: held in the left hand, limbs vertical, pointing along draw-hand to bow-hand
  const bow = rig.bow;
  _lh.copy(P[J.LeftHand]); _rh.copy(P[J.RightHand]);
  _fwd.subVectors(_lh, _rh).normalize();
  _up.set(0, 1, 0).addScaledVector(_fwd, -_fwd.y).normalize();        // upright, square to the draw line
  _right.crossVectors(_up, _fwd);
  _m.makeBasis(_right, _up, _fwd);
  _bq.setFromRotationMatrix(_m);
  // a bow that is not being aimed with (arm still low) just hangs forward
  const raise = THREE.MathUtils.smoothstep(frame, 66, 84);
  bow.group.position.copy(_lh);
  bow.group.quaternion.copy(_bq);

  _inv.copy(_bq).invert();
  _loc.subVectors(_rh, _lh).applyQuaternion(_inv);                   // draw hand, in bow space
  if (loosed || frame < ARROW_IN_HAND) {
    bow.setNock(REST_NOCK.x, REST_NOCK.y, REST_NOCK.z, false);
  } else if (frame < NOCKED_AT) {                                     // arrow held in the right hand, string at rest
    bow.setString(REST_NOCK.x, REST_NOCK.y, REST_NOCK.z);
    bow.setArrow(true, _loc.x, _loc.y, _loc.z, -_loc.x, -_loc.y, -_loc.z);
  } else {                                                            // nocked: the string follows the hand
    const k = THREE.MathUtils.smoothstep(frame, NOCKED_AT, STRING_DRAWN_AT);
    bow.setNock(REST_NOCK.x + (_loc.x - REST_NOCK.x) * k, REST_NOCK.y + (_loc.y - REST_NOCK.y) * k, REST_NOCK.z + (_loc.z - REST_NOCK.z) * k, true);
  }
  return bow;
}

/** Bow hanging in the left hand (not shooting): `handLocal` is the hand point in the knight's root space. */
export function carryBow(rig, handLocal) {
  const bow = rig.bow;
  bow.group.position.copy(handLocal);
  bow.group.quaternion.set(0, 0, 0, 1);
  bow.group.rotation.set(0.1, 0, 0.05);
  bow.setNock(REST_NOCK.x, REST_NOCK.y, REST_NOCK.z, false);
}

/** World-space point and direction where an arrow leaves the bow (tail at the nock, pointing forward). */
export function bowMuzzle(rig, outPos, outDir) {
  const g = rig.bow.group;
  g.updateWorldMatrix(true, false);
  outPos.copy(rig.bow.nock).applyMatrix4(g.matrixWorld);
  outDir.set(0, 0, 1).transformDirection(g.matrixWorld);
}
