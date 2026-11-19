// Retargets a baked Mixamo clip (joint positions, see scripts/bake-mixamo-clip.mjs) onto the rigid-group
// knight rig. Each frame the pelvis and chest orientation are rebuilt from the hip line and the shoulder
// line, then every limb segment is aimed along its clip direction, working down the hierarchy in
// quaternions. The knight rig is a tree of groups whose zero rotation hangs the limbs along -Y, so a
// limb's local rotation is "turn -Y onto the clip direction, relative to the parent".
//
// `upperRot` lets the caller turn the whole upper body about the hips first (the archer uses it to aim
// at a target); the rotated joint positions stay in `P` for placing props such as the bow.

import * as THREE from 'three';

const UPPER = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle1',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1'];

const Y = new THREE.Vector3(0, 1, 0), NEG_Y = new THREE.Vector3(0, -1, 0), Z = new THREE.Vector3(0, 0, 1);

export function createClipPoser(clip) {
  const J = {};
  clip.joints.forEach((n, i) => { J[n] = i; });
  const frames = clip.frames.map(f => Float32Array.from(f));
  const NJ = clip.joints.length;
  const P = Array.from({ length: NJ }, () => new THREE.Vector3());
  const upperIdx = UPPER.map(n => J[n]);

  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _qP = new THREE.Quaternion(), _qC = new THREE.Quaternion(), _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion();
  const _qInv = new THREE.Quaternion(), _qL = new THREE.Quaternion(), _pos = new THREE.Vector3();

  function sample(frame, upperRot = null) {
    const last = frames.length - 1;
    const a0 = Math.min(last, Math.max(0, Math.floor(frame))), a1 = Math.min(last, a0 + 1);
    const k = frame - a0, a = frames[a0], b = frames[a1];
    for (let j = 0; j < NJ; j++) {
      P[j].set(a[j * 3] + (b[j * 3] - a[j * 3]) * k, a[j * 3 + 1] + (b[j * 3 + 1] - a[j * 3 + 1]) * k, a[j * 3 + 2] + (b[j * 3 + 2] - a[j * 3 + 2]) * k);
    }
    if (upperRot) {                                  // turn everything above the hips about the hips
      const h = P[J.Hips];
      for (const j of upperIdx) P[j].sub(h).applyQuaternion(upperRot).add(h);
    }
    return P;
  }

  function basisQuat(up, left, out) {
    _y.copy(up).normalize();
    _x.copy(left).addScaledVector(_y, -left.dot(_y)).normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_m);
  }
  const dirOf = (a, b, out) => out.subVectors(P[J[b]], P[J[a]]).normalize();

  /** Pose the rig from `frame`, blended over its current pose by `w`. `origin` is added to the pelvis. */
  function pose(rig, frame, w, origin = null, upperRot = null) {
    sample(frame, upperRot);
    basisQuat(_d.subVectors(P[J.Spine], P[J.Hips]), _e.subVectors(P[J.LeftUpLeg], P[J.RightUpLeg]), _qP);
    basisQuat(_d.subVectors(P[J.Neck], P[J.Spine1]), _e.subVectors(P[J.LeftArm], P[J.RightArm]), _qC);

    _pos.copy(P[J.Hips]); if (origin) _pos.add(origin);
    rig.pelvis.position.lerp(_pos, w);
    rig.pelvis.quaternion.slerp(_qP, w);
    rig.torso.quaternion.slerp(_qInv.copy(_qP).invert().multiply(_qC), w);

    _qA.setFromUnitVectors(Y, dirOf('Head', 'HeadTop_End', _d));
    rig.head.quaternion.slerp(_qL.copy(_qC).invert().multiply(_qA), w);

    for (const [arm, pre] of [[rig.armL, 'Left'], [rig.armR, 'Right']]) {
      _qA.setFromUnitVectors(NEG_Y, dirOf(pre + 'Arm', pre + 'ForeArm', _d));
      _qB.setFromUnitVectors(NEG_Y, dirOf(pre + 'ForeArm', pre + 'Hand', _d));
      arm.sh.quaternion.slerp(_qL.copy(_qC).invert().multiply(_qA), w);
      arm.el.quaternion.slerp(_qL.copy(_qA).invert().multiply(_qB), w);
    }
    for (const [leg, pre] of [[rig.legL, 'Left'], [rig.legR, 'Right']]) {
      _qA.setFromUnitVectors(NEG_Y, dirOf(pre + 'UpLeg', pre + 'Leg', _d));
      _qB.setFromUnitVectors(NEG_Y, dirOf(pre + 'Leg', pre + 'Foot', _d));
      leg.hip.quaternion.slerp(_qL.copy(_qP).invert().multiply(_qA), w);
      leg.knee.quaternion.slerp(_qL.copy(_qA).invert().multiply(_qB), w);
      _qL.setFromUnitVectors(Z, dirOf(pre + 'Foot', pre + 'ToeBase', _d));          // boot forward, in the model frame
      leg.ankle.quaternion.slerp(_qInv.copy(_qB).invert().multiply(_qL), w);
    }
  }

  return { J, P, frames, sample, pose };
}
