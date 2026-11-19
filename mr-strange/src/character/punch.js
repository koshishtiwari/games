// Attack moves: Mixamo clips retargeted onto the hero's skeleton.
//
// A clip is stored as joint POSITIONS (see scripts/bake-mixamo-clip.mjs), not rotations, so it does not
// matter that Mixamo's skeleton has different bone axes and proportions. Per frame we rebuild:
//   * pelvis / chest orientation from the hip line and the shoulder line (twist is the point of a swing)
//   * spine twist spread evenly between them
//   * neck and head by aiming them at the next joint
//   * each arm with the rig's own two-bone IK: the wrist goes where the clip's wrist is (scaled for arm
//     length), with the clip's elbow direction as the pole, and the hand aims at the middle finger.
// The result is blended over the locomotion pose by an envelope, so the legs keep standing on the
// planted-foot solver while the upper body performs the move.
//
// To add a move: bake the FBX, import the clip, and add one entry to MOVES below.

import * as THREE from 'three';
import { smooth } from '../math.js';
import { B, bones, boneIndex as I, fkAll, fkBone, aimBone, solveTwoBone, mp } from './rig.js';
import { char } from './state.js';
import punchClip from './punch-clip.js';
import slamClip from './slam-clip.js';
import climbClip from './climb-clip.js';

//   from / to   clip frames to play (skip the stance entry and the idle tail)
//   rate        playback speed multiplier
//   blendIn/Out seconds to fade the move over the locomotion pose
//   hit         [fromFrame, toFrame] while the fist can connect, or null
//   impact      frame of a one-shot event (the AOE slam), or null
//   hips        how much of the clip's pelvis travel to use per axis (the feet are planted, so big
//               lunges are scaled down and the leg IK turns them into a deep crouch / lunge)
//   twist       how much of the pelvis twist the hips take (feet planted: 0.45; the climb moves the feet too: 1)
//   moveScale   how much of the stick input still moves the hero during the move
const MOVES = {
  punch: { clip: punchClip, from: 3, to: 24, rate: 1.15, blendIn: 0.09, blendOut: 0.20, hit: [6.5, 11], impact: null, hips: [1, 1, 1], twist: 0.45, moveScale: 0.35 },
  slam:  { clip: slamClip,  from: 14, to: 62, rate: 1.7,  blendIn: 0.12, blendOut: 0.25, hit: null,      impact: 41,   hips: [0.40, 1, 0.45], twist: 0.45, moveScale: 0.08 },
  // The ledge pull-up is driven by traversal.js (it owns the timing and the root motion), see driveMove().
  climb: { clip: climbClip, from: 3, to: 33, rate: 1.15,  blendIn: 0,    blendOut: 0,    hit: null,      impact: null, hips: [0, 0, 0], twist: 1.0, moveScale: 0 },
};

// Per-move data, prepared once.
function prepare(def) {
  const J = {};
  def.clip.joints.forEach((n, i) => { J[n] = i; });
  const frames = def.clip.frames.map(f => Float32Array.from(f));
  const f0 = frames[def.from];
  const hipsStart = new THREE.Vector3(f0[0], f0[1], f0[2]);
  const sides = [['L', 'Left'], ['R', 'Right']].map(([n, pre]) => {
    const sh = I['shoulder' + n], ua = I['upperArm' + n], fa = I['foreArm' + n], hd = I['hand' + n], he = I['handEnd' + n];
    const l1 = bones[fa].position.length(), l2 = bones[hd].position.length();
    const g = (name) => new THREE.Vector3(f0[J[pre + name] * 3], f0[J[pre + name] * 3 + 1], f0[J[pre + name] * 3 + 2]);
    const a = g('Arm'), e = g('ForeArm'), h = g('Hand');
    return {
      n, pre, sh, ua, fa, hd, he, l1, l2,
      ratio: (l1 + l2) / (a.distanceTo(e) + e.distanceTo(h)),   // their arm length to ours
      loco: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()],
      pole: new THREE.Vector3(),
    };
  });
  const duration = (def.to - def.from) / def.clip.fps / def.rate;
  return { ...def, J, frames, hipsStart, sides, duration, fps: def.clip.fps };
}
const PREPARED = {};
for (const k of Object.keys(MOVES)) PREPARED[k] = prepare(MOVES[k]);
let cur = PREPARED.punch;

export const PUNCH_DURATION = PREPARED.punch.duration;
export const SLAM_DURATION = PREPARED.slam.duration;

export const punch = {
  active: false,
  move: 'punch',
  t: 0,
  w: 0,              // blend weight over the locomotion pose
  frame: 0,
  swing: 0,          // increments every move; one swing hits each target once
  inHitWindow: false,
  impact: false,     // true for one frame when the move's impact event fires
  impactDone: false,
  moveScale: 1,
  driven: false,     // playback is controlled from outside (the ledge climb), not by the timer below
  armW: null,        // optional per-arm blend [left, right] overriding `w` for the arms
  armTarget: null,   // optional (side, outVec) -> model-space wrist target, instead of the clip's own reach
};

export function startMove(name) {
  if (punch.active || char.isBat || char.mode !== 'free' || !char.grounded || char.jumpPhase !== 'ground') return false;
  cur = PREPARED[name];
  punch.move = name;
  punch.active = true;
  punch.t = 0;
  punch.frame = cur.from;
  punch.swing++;
  punch.impact = false; punch.impactDone = false;
  punch.moveScale = cur.moveScale;
  return true;
}
export const startPunch = () => startMove('punch');
export const startSlam = () => startMove('slam');

export function updatePunch(dt) {
  if (punch.driven) return;
  if (!punch.active) { punch.w = 0; punch.inHitWindow = false; punch.moveScale = 1; return; }
  punch.t += dt;
  punch.frame = cur.from + punch.t * cur.fps * cur.rate;
  if (punch.frame >= cur.to || char.isBat || char.mode !== 'free') {
    punch.active = false; punch.w = 0; punch.inHitWindow = false; punch.moveScale = 1;
    return;
  }
  punch.w = Math.min(smooth(0, cur.blendIn, punch.t), 1 - smooth(cur.duration - cur.blendOut, cur.duration, punch.t));
  punch.inHitWindow = !!cur.hit && punch.frame >= cur.hit[0] && punch.frame <= cur.hit[1];
  if (cur.impact !== null && !punch.impactDone && punch.frame >= cur.impact) { punch.impact = true; punch.impactDone = true; }
}

/* ---------- clip sampling ---------- */
const NJ = 25;
const _p = Array.from({ length: NJ }, () => new THREE.Vector3());
let sampledKey = '';
function sample(frame) {
  const key = punch.move + frame;
  if (key === sampledKey) return;
  sampledKey = key;
  const f0 = Math.min(cur.to, Math.max(0, Math.floor(frame)));
  const f1 = Math.min(cur.frames.length - 1, f0 + 1);
  const k = frame - f0;
  const a = cur.frames[f0], b = cur.frames[f1];
  for (let j = 0; j < NJ; j++) {
    _p[j].set(a[j * 3] + (b[j * 3] - a[j * 3]) * k,
      a[j * 3 + 1] + (b[j * 3 + 1] - a[j * 3 + 1]) * k,
      a[j * 3 + 2] + (b[j * 3 + 2] - a[j * 3 + 2]) * k);
  }
}

/* ---------- scratch ---------- */
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qPelvis = new THREE.Quaternion(), _qChest = new THREE.Quaternion(), _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion();
const _qId = new THREE.Quaternion(), _qInv = new THREE.Quaternion(), _qTmp = new THREE.Quaternion();
const _dir = new THREE.Vector3(), _target = new THREE.Vector3(), _pole = new THREE.Vector3(), _mid = new THREE.Vector3();

// Orientation (relative to the bind pose, where +X is the character's left and +Z is forward) of a
// segment with the given up axis and left axis.
function basisQuat(up, left, out) {
  _y.copy(up).normalize();
  _x.copy(left).addScaledVector(_y, -left.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/* Torso: pelvis shift, pelvis / spine / chest twist, neck, head. Call after the locomotion torso is set
   and BEFORE the arms are posed. */
const _neckLoco = new THREE.Quaternion(), _headLoco = new THREE.Quaternion();
export function applyPunchTorso() {
  const w = punch.w;
  if (w <= 0.001) return;
  sample(punch.frame);
  const J = cur.J;

  // pelvis travel (the clip sinks and rocks the hips; the feet stay planted and the leg IK follows)
  B.pelvis.position.x += (_p[J.Hips].x - cur.hipsStart.x) * cur.hips[0] * w;
  B.pelvis.position.y += (_p[J.Hips].y - cur.hipsStart.y) * cur.hips[1] * w;
  B.pelvis.position.z += (_p[J.Hips].z - cur.hipsStart.z) * cur.hips[2] * w;

  basisQuat(_dir.subVectors(_p[J.Spine], _p[J.Hips]), _mid.subVectors(_p[J.LeftUpLeg], _p[J.RightUpLeg]), _qPelvis);
  basisQuat(_dir.subVectors(_p[J.Neck], _p[J.Spine1]), _mid.subVectors(_p[J.LeftArm], _p[J.RightArm]), _qChest);
  // The feet are planted facing forward, so the hips take only part of the twist; the spine takes the rest.
  _qTmp.copy(_qPelvis);
  _qPelvis.copy(_qId.identity()).slerp(_qTmp, cur.twist);
  _qA.copy(_qPelvis).slerp(_qChest, 0.34);
  _qB.copy(_qPelvis).slerp(_qChest, 0.67);

  B.pelvis.quaternion.slerp(_qPelvis, w);
  B.spineA.quaternion.slerp(_qInv.copy(_qPelvis).invert().multiply(_qA), w);
  B.spineB.quaternion.slerp(_qInv.copy(_qA).invert().multiply(_qB), w);
  B.chest.quaternion.slerp(_qInv.copy(_qB).invert().multiply(_qChest), w);
  fkAll();

  // neck and head: aim at the next joint, blended
  const neck = bones[I.neck], head = bones[I.head];
  _neckLoco.copy(neck.quaternion); _headLoco.copy(head.quaternion);
  aimBone(I.neck, _dir.subVectors(_p[J.Head], _p[J.Neck]));
  neck.quaternion.copy(_neckLoco).slerp(_qTmp.copy(neck.quaternion), w);
  fkBone(I.neck); fkBone(I.head);
  aimBone(I.head, _dir.subVectors(_p[J.HeadTop_End], _p[J.Head]));
  head.quaternion.copy(_headLoco).slerp(_qTmp.copy(head.quaternion), w * 0.8);
  fkBone(I.head);
}

/* Arms: call after the locomotion arms are posed. */
export function applyPunchArms() {
  if (punch.w <= 0.001 && !punch.armW) return;
  sample(punch.frame);
  const J = cur.J;
  for (let si = 0; si < cur.sides.length; si++) {
    const s = cur.sides[si];
    const w = punch.armW ? punch.armW[si] : punch.w;
    if (w <= 0.001) continue;
    const ids = [s.sh, s.ua, s.fa, s.hd];
    for (let k = 0; k < 4; k++) s.loco[k].copy(bones[ids[k]].quaternion);

    const shoulder = _p[J[s.pre + 'Shoulder']], arm = _p[J[s.pre + 'Arm']], elbow = _p[J[s.pre + 'ForeArm']],
      hand = _p[J[s.pre + 'Hand']], finger = _p[J[s.pre + 'HandMiddle1']];
    aimBone(s.sh, _dir.subVectors(arm, shoulder));
    fkBone(s.ua);
    if (punch.armTarget) punch.armTarget(s.n, _target);     // anchored to the world (ledge climb)
    else _target.subVectors(hand, arm).multiplyScalar(s.ratio).add(mp[s.ua]);
    // elbow direction: how far the clip's elbow sits off the shoulder-wrist line
    _mid.addVectors(arm, hand).multiplyScalar(0.5);
    s.pole.subVectors(elbow, _mid);
    if (s.pole.lengthSq() < 1e-6) s.pole.set(s.n === 'L' ? 0.3 : -0.3, -0.6, -0.2);
    solveTwoBone(s.ua, s.fa, _target, s.pole.normalize(), s.l1, s.l2);
    fkBone(s.hd);
    aimBone(s.hd, _dir.subVectors(finger, hand));

    for (let k = 0; k < 4; k++) bones[ids[k]].quaternion.slerp(s.loco[k], 1 - w);   // clip -> blended
    for (let k = 0; k < 4; k++) fkBone(ids[k]);
    fkBone(s.he);
  }
}

/* A hand, in world space (use after the character has been posed this frame). */
export function fistWorld(out, sideName = 'L') {
  const s = cur.sides.find(x => x.n === sideName);
  const cy = Math.cos(char.yaw), sy = Math.sin(char.yaw);
  const m = mp[s.he];
  return out.set(char.pos.x + m.x * cy + m.z * sy, char.pos.y + m.y, char.pos.z - m.x * sy + m.z * cy);
}

/* ---------- externally driven playback (ledge climb) ---------- */
export const CLIMB_FROM = PREPARED.climb.from;
export const CLIMB_FRAMES = PREPARED.climb.to - PREPARED.climb.from;
export const CLIMB_FPS = PREPARED.climb.fps * PREPARED.climb.rate;

/** Pose the upper body from `frame` of move `name` at blend `w`. The caller owns the timing. */
export function driveMove(name, frame, w, armW = null, armTarget = null) {
  cur = PREPARED[name];
  punch.move = name; punch.driven = true; punch.active = false;
  punch.frame = frame; punch.w = w; punch.armW = armW; punch.armTarget = armTarget;
}
export function releaseDrive() { punch.driven = false; punch.w = 0; punch.armW = null; punch.armTarget = null; }

/** A clip joint (model space, hips not removed) at the current driven frame. */
export function clipJoint(name, out) {
  sample(punch.frame);
  return out.copy(_p[cur.J[name]]);
}
