// The skeleton: a real Bone hierarchy at human proportions (1.81 m tall, 7.7
// heads), plus the forward kinematics and two-bone IK used to pose it.
// Bind pose is a relaxed A-pose facing +Z. No DOM, no rendering.

import * as THREE from 'three';
import { clamp } from '../math.js';

const PELVIS_Y = 0.980;

const BONE_DEFS = [
  ['pelvis',   null,      0, PELVIS_Y, 0],
  ['spineA',   'pelvis',  0, 0.115, 0],
  ['spineB',   'spineA',  0, 0.115, 0],
  ['chest',    'spineB',  0, 0.125, 0],
  ['neck',     'chest',   0, 0.155, 0],
  ['head',     'neck',    0, 0.085, 0],
  ['headTop',  'head',    0, 0.247, 0],
];
// arms & legs, mirrored. s = +1 is the character's left (+X).
for (const [side, s] of [['L', 1], ['R', -1]]) {
  BONE_DEFS.push(
    ['shoulder' + side, 'chest',            s * 0.065,  0.135,  0],   // clavicle
    ['upperArm' + side, 'shoulder' + side,  s * 0.115, -0.015,  0],   // acromion
    ['foreArm'  + side, 'upperArm' + side,  s * 0.205, -0.240,  0],   // elbow
    ['hand'     + side, 'foreArm'  + side,  s * 0.172, -0.203,  0],   // wrist
    ['handEnd'  + side, 'hand'     + side,  s * 0.061, -0.073,  0],
    ['hip'      + side, 'pelvis',           s * 0.100, -0.035,  0],
    ['upperLeg' + side, 'hip'      + side,  0,         -0.010,  0],
    ['lowerLeg' + side, 'upperLeg' + side,  0,         -0.425,  0],   // knee
    ['foot'     + side, 'lowerLeg' + side,  0,         -0.425,  0],   // ankle
    ['toe'      + side, 'foot'     + side,  0,         -0.055,  0.135],
  );
}

export const bones = [];          // flat array, parents always precede children
export const B = {};              // name -> Bone
export const boneIndex = {};      // name -> index in `bones`
export const parentIdx = [];      // index of parent bone, or -1

for (const [name, parent, x, y, z] of BONE_DEFS) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  if (parent) B[parent].add(b);
  B[name] = b;
  boneIndex[name] = bones.length;
  parentIdx.push(parent ? boneIndex[parent] : -1);
  bones.push(b);
}
export const NB = bones.length;

// The character transform. The bone root lives under it; the SkinnedMesh does
// NOT, so that the bind matrix stays identity and nothing is applied twice.
export const model = new THREE.Group();
model.add(B.pelvis);
model.updateMatrixWorld(true);

// Bind-pose world positions: the body shell is authored in this space.
export const bindPos = bones.map(b => b.getWorldPosition(new THREE.Vector3()));
export const P = {};              // name -> bind world position
bones.forEach((b, i) => { P[b.name] = bindPos[i]; });
export const bindLocalPos = bones.map(b => b.position.clone());

// Primary child of each bone, used to derive its local "aim" axis.
export const PRIMARY_CHILD = {
  pelvis: 'spineA', spineA: 'spineB', spineB: 'chest', chest: 'neck',
  neck: 'head', head: 'headTop',
};
for (const side of ['L', 'R']) {
  Object.assign(PRIMARY_CHILD, {
    ['shoulder' + side]: 'upperArm' + side,
    ['upperArm' + side]: 'foreArm'  + side,
    ['foreArm'  + side]: 'hand'     + side,
    ['hand'     + side]: 'handEnd'  + side,
    ['hip'      + side]: 'upperLeg' + side,
    ['upperLeg' + side]: 'lowerLeg' + side,
    ['lowerLeg' + side]: 'foot'     + side,
    ['foot'     + side]: 'toe'      + side,
  });
}
// aimAxis[name] = unit vector, in the bone's local space, pointing at its child.
export const aimAxis = {};
for (const b of bones) {
  const childName = PRIMARY_CHILD[b.name];
  aimAxis[b.name] = childName
    ? B[childName].position.clone().normalize()
    : new THREE.Vector3(0, 1, 0);
}

// Bone segments in bind space: used for both the seam and the skin weights.
export const segA = bindPos;
export const segB = bones.map((b, i) => {
  const c = PRIMARY_CHILD[b.name];
  return c ? bindPos[boneIndex[c]] : bindPos[i];
});

// Graph distance between bones (BFS on the tree): stops skin weights from
// bleeding across the body, e.g. left thigh onto right thigh.
export const graphDist = [];
{
  const adj = Array.from({ length: NB }, () => []);
  for (let i = 0; i < NB; i++) if (parentIdx[i] >= 0) { adj[i].push(parentIdx[i]); adj[parentIdx[i]].push(i); }
  for (let s = 0; s < NB; s++) {
    const d = new Int16Array(NB).fill(-1);
    d[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const v of adj[u]) if (d[v] < 0) { d[v] = d[u] + 1; q.push(v); }
    }
    graphDist.push(d);
  }
}

export const skeleton = new THREE.Skeleton(bones);

/* ==========================================================================
   Forward kinematics in model space.
   Hand-rolled so that the character's squash-and-stretch (a non-uniform scale
   on `model`) can never corrupt the quaternions the IK solves with.
   ========================================================================== */
export const mq = bones.map(() => new THREE.Quaternion());  // model-space rotation
export const mp = bones.map(() => new THREE.Vector3());     // model-space position
const cs = new Float32Array(NB).fill(1);             // cumulative uniform scale

export function fkBone(i) {
  const b = bones[i], p = parentIdx[i];
  if (p < 0) { mq[i].copy(b.quaternion); mp[i].copy(b.position); cs[i] = b.scale.x; }
  else {
    mq[i].copy(mq[p]).multiply(b.quaternion);
    mp[i].copy(b.position).multiplyScalar(cs[p]).applyQuaternion(mq[p]).add(mp[p]);
    cs[i] = cs[p] * b.scale.x;
  }
}
export function fkAll() { for (let i = 0; i < NB; i++) fkBone(i); }

const _aq = new THREE.Quaternion(), _ad = new THREE.Vector3();
// Rotate bone `i` so its bind-pose child axis points along `dirModel`.
export function aimBone(i, dirModel) {
  const p = parentIdx[i];
  _aq.copy(mq[p]).invert();
  _ad.copy(dirModel).normalize().applyQuaternion(_aq).normalize();
  bones[i].quaternion.setFromUnitVectors(aimAxis[bones[i].name], _ad);
  fkBone(i);
}

// Analytic two-bone IK. Everything in model space; `pole` is the direction the
// joint should bend toward.
const _ikAxis = new THREE.Vector3(), _ikBend = new THREE.Vector3(),
      _ikN = new THREE.Vector3(), _ikKnee = new THREE.Vector3(), _ikTmp = new THREE.Vector3();
export function solveTwoBone(iRoot, iMid, target, pole, l1, l2) {
  const root = mp[iRoot];
  _ikAxis.subVectors(target, root);
  let dist = _ikAxis.length();
  if (dist < 1e-5) { _ikAxis.set(0, -1, 0); dist = 1e-5; }
  _ikAxis.divideScalar(dist);
  dist = clamp(dist, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9985);

  _ikN.crossVectors(_ikAxis, pole);
  if (_ikN.lengthSq() < 1e-7) _ikN.crossVectors(_ikAxis, _ikTmp.set(0, 0, 1));
  if (_ikN.lengthSq() < 1e-7) _ikN.set(1, 0, 0);
  _ikN.normalize();
  _ikBend.crossVectors(_ikN, _ikAxis).normalize();   // perpendicular to the limb
  if (_ikBend.dot(pole) < 0) _ikBend.negate();       // ...on the pole's side

  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _ikKnee.copy(root).addScaledVector(_ikAxis, a).addScaledVector(_ikBend, h);

  aimBone(iRoot, _ikTmp.subVectors(_ikKnee, root));
  fkBone(iMid);                                       // root moved: refresh the knee
  aimBone(iMid,  _ikTmp.subVectors(target, mp[iMid]));
}
