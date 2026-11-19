// Character state and motion: locomotion, gait, foot planting, secondary-motion
// springs (stepSim, fixed timestep) and the pose written onto the rig each frame
// (poseCharacter). No DOM: input and camera basis are passed in.

import * as THREE from 'three';
import { CFG } from '../config.js';
import { TAU, clamp, lerp, smooth, shortAngle } from '../math.js';
import {
  model, bones, B, NB, boneIndex as I, bindLocalPos, aimAxis,
  fkAll, fkBone, aimBone, solveTwoBone, mp, mq, parentIdx,
} from './rig.js';
import { SHOE } from './body.js';
import { wind } from '../world/wind.js';
import { applyPunchTorso, applyPunchArms } from './punch.js';
import { char, facing, feet, sp, STEP_HALF } from './state.js';
import { groundHeight, ceilingHeight, pushOut, HEIGHT } from '../world/collision.js';
import * as traversal from './traversal.js';
import { level } from '../world/level.js';

const UP_Y = new THREE.Vector3(0, 1, 0);

const L_THIGH   = Math.abs(B.lowerLegL.position.y);
const L_SHIN    = Math.abs(B.footL.position.y);
const L_UARM    = B.foreArmL.position.length();
const L_FARM    = B.handL.position.length();
// Shoe metrics, read back off the shell so they can never drift out of sync.
const ANKLE_H    = SHOE.ankleH;            // ankle height with the sole flat on the floor
const SOLE_DROP  = SHOE.ankleH;            // ankle -> contact point, vertically
const TOE_LEVER  = SHOE.toe;               // ankle -> toe contact, horizontally
const HEEL_LEVER = SHOE.heel;              // ankle -> heel contact, horizontally

export { char, facing, feet };
const _fwd = facing.fwd, _left = facing.left;

const _dir = new THREE.Vector3(), _want = new THREE.Vector3(), _tmp = new THREE.Vector3(), _swingTarget = new THREE.Vector3();
const _wv = new THREE.Vector3();
const STEP_DOWN = 0.46;       // a drop smaller than this is a step, bigger is a fall

function speedFromStick(m) {
  if (m <= 0) return 0;
  return m < 0.55 ? lerp(0, CFG.walkSpeed, m / 0.55)
                  : lerp(CFG.walkSpeed, CFG.runSpeed, (m - 0.55) / 0.45);
}

// scratch for the gait, recomputed every substep
let gaitFreq = 0, gaitDuty = 0.6, gaitStep = 0.1, stanceDur = 1, swingDur = 1;

/* ==========================================================================
   Simulation: fixed timestep
   ========================================================================== */
function footGround(v) { return groundHeight(v.x, v.z, char.pos.y + 0.5, 0.5); }

function pickLead() { char.airLead = Math.sin(char.gait) >= 0 ? 'L' : 'R'; }

// leave the ground (walked off an edge): keep the momentum, start the air pose
function beginAir(vy) {
  char.grounded = false; char.jumpPhase = 'air'; char.vy = vy;
  char.airT = 0; char.airRun = char.runBlend; char.autoJump = false;
  pickLead();
}

function startJump() {
  beginAir(CFG.jumpVel * (1 + 0.04 * char.runBlend));
  char.coyote = 0;
  const s = Math.hypot(char.vel.x, char.vel.z);
  if (s > 1.5) {                                            // a running jump carries more speed
    const k = Math.min(CFG.maxJumpSpeed, s * CFG.runBoost) / s;
    char.vel.x *= k; char.vel.z *= k;
  }
  char.crouch = 0.5;                                        // a quick push-off compression
  sp.squash.kick(1.3);
}

export function stepSim(dt, input, camRight, camFwd, resolveBodies) {
  char.catchCooldown = Math.max(0, char.catchCooldown - dt);

  // A hit that landed since the last step. On the ground the man stumbles (a blended hit-reaction clip that carries
  // him); in any other situation it is a plain shove.
  if (char.hitReact) {
    const h = char.hitReact;
    char.hitReact = null;
    if (!char.isBat && char.mode === 'free' && char.grounded && char.jumpPhase === 'ground' && traversal.startStumble(h.dx, h.dz, h.power)) {
      // handled: the clip moves him
    } else if (char.mode === 'free') {
      char.vel.x += h.ix; char.vel.z += h.iz; char.vy = Math.max(char.vy, h.ivy);
    }
  }
  char.morph = clamp(char.morph + (char.isBat ? 1 : -1) * 5.5 * dt, 0, 1);

  if (char.isBat) {
    char.mode = 'free';
    char.grounded = false;
    char.jumpPhase = 'air';

    // Soft-body squish spring update
    const sqA = -280 * char.batSquish - 13 * char.batSquishV;
    char.batSquishV += sqA * dt;
    char.batSquish  += char.batSquishV * dt;
    char.batSplatT   = Math.max(0, char.batSplatT - dt);

    const turnIn  = -input.x * input.mag;               // + = turn left
    const pitchIn =  input.y * input.mag;               // + = climb, - = dive
    const boost   =  input.jumpHeld ? 1 : 0;
    const dive    =  input.diveHeld ? 1 : 0;
    const active  =  input.mag > 0.05 || boost > 0 || dive > 0;

    // Turning with yaw inertia & bank
    const wantYawRate = turnIn * 2.7;
    char.yawRate += (wantYawRate - char.yawRate) * (1 - Math.exp(-6.0 * dt));
    char.yaw += char.yawRate * dt;
    _fwd.set(Math.sin(char.yaw), 0, Math.cos(char.yaw));
    _left.set(Math.cos(char.yaw), 0, -Math.sin(char.yaw));

    // Pitch & bank
    const targetPitch = active
      ? clamp(-pitchIn * 0.55 + dive * 0.45 - boost * 0.25, -0.75, 0.75)
      : clamp(-char.vy * 0.04, -0.35, 0.35);
    char.batPitch += (targetPitch - char.batPitch) * (1 - Math.exp(-6.5 * dt));

    const targetBank = clamp(-char.yawRate * 0.36, -0.85, 0.85);
    char.batBank += (targetBank - char.batBank) * (1 - Math.exp(-6.5 * dt));

    // Gliding only when diving/pitching down at speed
    const gliding = (dive > 0.5 || (pitchIn < -0.35 && !boost && char.speed > 5.5)) && !char.batGrounded;
    char.batGlide += ((gliding ? 1 : 0) - char.batGlide) * (1 - Math.exp(-7.5 * dt));

    // Falling panic-flutter: when idle in midair, wings flutter faster as it falls toward the ground
    const falling = !active && !char.batGrounded && char.vy < -0.3;
    const fallUrgency = falling ? clamp(-char.vy / 6.5, 0, 1) : 0;
    const targetPower = char.batGrounded ? 0.05 : (gliding ? 0.12 : (0.55 + 0.45 * boost + 0.35 * fallUrgency));
    char.flapPower += (targetPower - char.flapPower) * (1 - Math.exp(-8.0 * dt));

    const flapFreq = char.batGrounded ? 1.5 : (5.8 + boost * 4.2 + fallUrgency * 8.5 + Math.max(0, pitchIn) * 1.8);
    char.flapPhase = (char.flapPhase + flapFreq * dt * (1 - 0.75 * char.batGlide)) % TAU;
    const stroke = Math.max(0, Math.sin(char.flapPhase));
    const downstroke = stroke * stroke * (1 - char.batGlide);

    // Horizontal motion: NO auto-move when idle! Only accelerates when stick/boost/dive is active.
    const fwdSpeed = char.vel.x * _fwd.x + char.vel.z * _fwd.z;
    const latSpeed = char.vel.x * _left.x + char.vel.z * _left.z;
    let newFwd;
    if (char.batSplatT > 0) {
      newFwd = fwdSpeed * Math.exp(-16.0 * dt);
    } else if (active) {
      const wantThrust = (input.mag * 11.0 + boost * 7.5 + dive * 6.0) + downstroke * 3.5;
      const pitchAccel = Math.sin(char.batPitch) * 12.0;
      newFwd = clamp(fwdSpeed + (wantThrust - fwdSpeed * 0.92 + pitchAccel) * dt, 0, 18.5);
    } else {
      newFwd = fwdSpeed * Math.exp(-2.8 * dt);          // flies in place / coasts to a stop
    }
    const newLat = latSpeed * Math.exp(-3.4 * dt);

    char.vel.x = _fwd.x * newFwd + _left.x * newLat;
    char.vel.z = _fwd.z * newFwd + _left.z * newLat;

    // Vertical physics:
    //  * Active (stick up/boost): climbs/sustains flight
    //  * Idle in air: flutters in place briefly, then gravity pulls it down until grounded
    const gravity = -10.5;
    const liftFromSpeed = Math.min(4.2, newFwd * 0.38) * (1 - 0.5 * dive);
    const activeLift = active ? (5.8 + downstroke * 6.5 + boost * 8.5 + pitchIn * 9.5 - dive * 9.0)
                              : (5.2 + downstroke * 2.2);   // < gravity: gently falls when idle!
    const ay = char.batSplatT > 0 ? -2.0 : (gravity + liftFromSpeed + activeLift - char.vy * 1.35);
    char.vy = clamp(char.vy + ay * dt, -14.0, 12.0);

    const preVx = char.vel.x, preVz = char.vel.z;
    char.pos.x += char.vel.x * dt;
    char.pos.z += char.vel.z * dt;
    pushOut(char.pos, char.vel);
    const hitDv = Math.hypot(char.vel.x - preVx, char.vel.z - preVz);
    if (hitDv > 2.2) {
      // Soft-body wall splat! Squish flat, stick briefly, then rebound softly
      const splat = clamp(hitDv * 0.11, 0.28, 0.95);
      char.batSquish  = Math.max(char.batSquish, splat);
      char.batSquishV = -splat * 4.0;
      char.batSplatT  = 0.13;
      char.vel.x *= 0.25; char.vel.z *= 0.25;
      char.vy    *= 0.35;
      if (hitDv > 3.5) char.forceUnmorph = true;      // a hard hit on a wall knocks the bat back into a man
    }
    char.speed = Math.hypot(char.vel.x, char.vel.z);

    char.pos.y += char.vy * dt;
    const gy = groundHeight(char.pos.x, char.pos.z, char.pos.y + 0.6, 0.6);
    if (char.pos.y <= gy + 0.14) {
      if (!boost && pitchIn <= 0.1) {
        // Touching down turns the bat back into the man in a crisp landing crouch
        char.isBat = false;
        char.batGrounded = false;
        char.justUnmorphed = true;
        char.morph = 0;
        char.batSquish = 0; char.batSquishV = 0; char.batSplatT = 0;
        char.pos.y = gy;
        char.vy = 0;
        char.grounded = true;
        char.jumpPhase = 'ground';
        char.airBlend = 0;
        char.crouch = 0.85;
        char.landDip = 0.16;
        char.vel.x *= 0.45; char.vel.z *= 0.45;
        sp.squash.kick(-1.35);
        for (const f of feet) {
          _tmp.copy(char.pos).addScaledVector(_left, f.s * STEP_HALF).addScaledVector(_fwd, f.s > 0 ? 0.04 : -0.04);
          _tmp.y = gy;
          f.world.copy(_tmp); f.plant.copy(_tmp); f.lift.copy(_tmp); f.land.copy(_tmp);
          f.height = 0; f.stance = true; f.free = false; f.auto = false;
        }
      } else {
        char.pos.y = gy + 0.14;
        if (char.vy < 0) char.vy = 0;
        char.batGrounded = false;
      }
    } else {
      char.batGrounded = false;
    }

    char.moveBlend = smooth(0.1, 2.0, char.speed);
    secondary(dt);
    return;
  }

  traversal.tick(dt);
  if (char.mode !== 'free') {
    traversal.step(dt, input, camRight, camFwd);
    secondary(dt);
    return;
  }

  feet[0].free = feet[1].free = false;
  feet[0].auto = feet[1].auto = false;

  /* ---- desired velocity ---- */
  _dir.set(0, 0, 0);
  if (input.mag > 0) {
    _dir.addScaledVector(camRight, input.x).addScaledVector(camFwd, input.y);
    if (_dir.lengthSq() > 1e-8) _dir.normalize(); else _dir.set(0, 0, 0);
  }
  const targetSpeed = speedFromStick(input.mag);
  _want.copy(_dir).multiplyScalar(targetSpeed);

  let rate = char.grounded ? (targetSpeed > 0.01 ? CFG.accel : CFG.decel)
                           : (targetSpeed > 0.01 ? CFG.accel * CFG.airControl : CFG.airDrag);
  _tmp.subVectors(_want, char.vel);
  const dv = rate * dt;
  if (_tmp.lengthSq() > dv * dv) _tmp.setLength(dv);
  char.vel.add(_tmp);
  const previousX = char.pos.x, previousZ = char.pos.z;
  char.pos.x += char.vel.x * dt;
  char.pos.z += char.vel.z * dt;
  pushOut(char.pos, char.vel);
  resolveBodies?.(char, previousX, previousZ);
  char.speed = Math.hypot(char.vel.x, char.vel.z);

  /* ---- facing, eased ---- */
  // While being knocked back the push must not turn him round: follow the stick only, not the shove.
  char.knockT = Math.max(0, char.knockT - dt);
  let heading = null;
  if (char.speed > 0.14 && char.knockT <= 0) heading = char.vel;
  else if (input.mag > 0.05) heading = _dir;
  if (heading) {
    const want = Math.atan2(heading.x, heading.z);
    const delta = shortAngle(want - char.yaw);
    const stepYaw = delta * (1 - Math.exp(-CFG.turnRate * dt));
    char.yaw += stepYaw;
    char.yawRate += (stepYaw / dt - char.yawRate) * 0.22;
  } else {
    char.yawRate += (0 - char.yawRate) * 0.15;
  }
  _fwd.set(Math.sin(char.yaw), 0, Math.cos(char.yaw));
  _left.set(Math.cos(char.yaw), 0, -Math.sin(char.yaw));

  /* ---- climbing moves that start on their own: auto-vault, auto-mantle, ropes ---- */
  if (char.grounded && char.jumpPhase === 'ground') traversal.groundCheck(dt, input, _dir);
  if (char.mode !== 'free') return;

  /* ---- jump: buffered, coyote-timed, variable height ---- */
  if (input.jumpQueued) { input.jumpQueued = false; char.jumpBuf = CFG.jumpBuffer; }
  char.jumpBuf = Math.max(0, char.jumpBuf - dt);
  char.coyote = char.grounded ? CFG.coyote : Math.max(0, char.coyote - dt);
  if (char.jumpBuf > 0 && (char.grounded || (char.coyote > 0 && char.vy <= 0.5))) {
    if (char.grounded && traversal.tryContext(input)) { char.jumpBuf = 0; }
    else { startJump(); char.jumpBuf = 0; }
  }
  if (char.mode !== 'free') return;
  char.crouch += (0 - char.crouch) * (1 - Math.exp(-14 * dt));

  if (char.grounded) {
    // follow the ground: glide up stairs, step down, or fall off an edge
    const gy = groundHeight(char.pos.x, char.pos.z, char.pos.y);
    const diff = gy - char.pos.y;
    if (diff < -STEP_DOWN) { beginAir(0); }
    else char.pos.y += Math.abs(diff) < 0.004 ? diff : diff * (1 - Math.exp(-30 * dt));
  }
  if (!char.grounded) {
    const prevY = char.pos.y;
    const held = input.jumpHeld || char.autoJump;
    const g = char.vy > 0 ? (held ? CFG.gravityUp : CFG.gravityUp * CFG.jumpCut) : CFG.gravityFall;
    char.vy = Math.max(char.vy + g * dt, -24);
    char.pos.y += char.vy * dt;
    char.airT += dt;
    if (char.vy > 0) {
      const ceil = ceilingHeight(char.pos.x, char.pos.z, prevY + HEIGHT);
      if (char.pos.y + HEIGHT > ceil) { char.pos.y = ceil - HEIGHT; char.vy = 0; }
    }
    const gy = groundHeight(char.pos.x, char.pos.z, prevY, 0.05);
    if (char.pos.y <= gy && char.vy < 0) {
      const impact = Math.min(-char.vy, 14);
      char.pos.y = gy; char.vy = 0;
      char.grounded = true; char.jumpPhase = 'ground'; char.autoJump = false;
      char.landDip = Math.min(0.20, impact * 0.026);
      char.crouch = Math.max(char.crouch, Math.min(0.6, impact * 0.05));
      sp.squash.kick(-impact * CFG.landImpulse * 0.8);
      if (impact > 8.5 && input.mag < 0.3) { char.vel.x *= 0.4; char.vel.z *= 0.4; }   // hard landing: no skating
      // Landing: each foot touches down where it is (the standing / walking code then brings it under the body).
      // It used to snap both feet underneath at once, which after a shove was a metre in one frame.
      for (const f of feet) {
        f.plant.copy(f.world); f.plant.y = gy; f.world.copy(f.plant); f.height = 0; f.stance = true; f.walkActive = false;
      }
    } else {
      traversal.airCheck(input);                            // catch a ledge or rope in flight
      if (char.mode !== 'free') return;
    }
  }
  char.airBlend += ((char.grounded ? 0 : 1) - char.airBlend) * (1 - Math.exp(-12 * dt));
  char.landDip *= Math.exp(-7.0 * dt);

  /* ---- gait clock ---- */
  char.moveBlend = smooth(0.10, 0.60, char.speed);
  char.runBlend  = smooth(CFG.walkSpeed * 0.90, CFG.runSpeed * 0.72, char.speed);
  const cycleLen = lerp(1.45, 2.40, char.runBlend);
  gaitFreq  = char.grounded ? clamp(char.speed / cycleLen, 0, 3.9) : 0;
  gaitDuty  = lerp(CFG.dutyWalk, CFG.dutyRun, char.runBlend);
  gaitStep  = lerp(CFG.stepHeightWalk, CFG.stepHeightRun, char.runBlend);
  stanceDur = gaitFreq > 1e-3 ? gaitDuty / gaitFreq : 1;
  swingDur  = gaitFreq > 1e-3 ? (1 - gaitDuty) / gaitFreq : 1;
  char.gait = (char.gait + gaitFreq * TAU * dt) % TAU;

  /* ---- feet: plant in world space so stance feet never slide ---- */
  const walking = char.grounded && char.moveBlend > 0.04 && gaitFreq > 0.05;
  for (const f of feet) {
    f.prevWorld.copy(f.world);
    if (!char.grounded) {
      f.walkActive = false;
      // Airborne leg pose. Rising: knees drive up (a stride pose after a running
      // take-off, a tuck after a standing one). Falling: legs reach for the floor.
      const up = clamp(char.vy / CFG.jumpVel, -1, 1);
      const s = smooth(0.35, -0.65, up);                     // 0 rising .. 1 falling hard
      const lead = f.name === char.airLead, run = char.autoJump ? 0 : char.airRun;
      f.auto = true;                                       // near a wall the knee search keeps the legs out of it
      if (char.autoJump) { f.toeOut = 0.3; f.kneePref.out = 0.9; f.kneePref.up = 0.5; }   // reaching for a ledge: knees out, off the wall
      else { f.toeOut = 0; f.kneePref.out = 0.2; f.kneePref.up = 0.1; }
      const tuckZ = lerp(0.12, 0.10, s), tuckY = lerp(0.34, 0.03, s);
      const strZ = lead ? lerp(0.36, 0.20, s) : lerp(-0.34, -0.12, s);
      const strY = lead ? lerp(0.46, 0.04, s) : lerp(0.34, 0.16, s);
      const z = lerp(tuckZ, strZ, run), y = lerp(tuckY, strY, run);
      _tmp.copy(char.pos)
        .addScaledVector(_left, f.s * STEP_HALF * (1.1 + 0.5 * s))
        .addScaledVector(_fwd, z);
      _tmp.y = Math.max(char.pos.y + y + 0.02, footGround(_tmp));
      f.world.lerp(_tmp, 1 - Math.exp(-16 * dt));
      f.plant.copy(f.world); f.height = 0;
      f.toeUp += (lerp(-0.40, 0.08, s) - f.toeUp) * (1 - Math.exp(-10 * dt));
      f.stance = false;
      continue;
    }
    if (!walking) {
      // The gait can stop with a foot in mid-swing (a shove fading out): carry on from where the foot is, and let
      // it settle, instead of snapping it back to its old planted spot.
      if (f.walkActive) { f.walkActive = false; f.plant.copy(f.world); }
      _tmp.copy(char.pos).addScaledVector(_left, f.s * STEP_HALF); _tmp.y = footGround(_tmp);
      f.plant.lerp(_tmp, 1 - Math.exp(-7 * dt));
      f.world.copy(f.plant); f.height *= Math.exp(-16 * dt); f.stance = true;
      f.toeUp += (0 - f.toeUp) * (1 - Math.exp(-8 * dt));
      continue;
    }
    const frac = (((char.gait + f.phaseOff) % TAU) + TAU) % TAU / TAU;
    const stance = frac < gaitDuty;
    if (!f.walkActive) {
      // Joining the gait part-way through its cycle (a shove, or setting off): a foot that the cycle says is
      // mid-swing must start that swing from where it is, not jump to the middle of the arc.
      f.walkActive = true;
      if (stance) { f.plant.copy(f.world); f.stance = true; }
      else { f.lift.copy(f.world); f.swingS0 = (frac - gaitDuty) / (1 - gaitDuty); f.stance = false; }
    }
    if (stance !== f.stance) {
      if (stance) {                                                  // touchdown
        // Only snap to the landing spot if the swing actually got there. The planted fraction of the cycle changes
        // with speed, so as a shove fades a foot that has barely left the floor can suddenly count as "landed":
        // it must plant where it is, not jump to a landing spot a metre away.
        if (f.swingS > 0.85 && f.world.distanceTo(f.land) < 0.25) { f.plant.copy(f.land); f.world.copy(f.land); }
        else f.plant.copy(f.world);
      }
      else        { f.lift.copy(f.world); f.swingS0 = 0; }          // lift-off
      f.stance = stance;
    }
    if (stance) {
      f.world.copy(f.plant); f.height *= Math.exp(-40 * dt);       // (eased, so an early touchdown does not drop the foot in one frame)
      const t = frac / gaitDuty;
      f.toeUp = 0.26 * (1 - smooth(0, 0.22, t)) - 0.46 * smooth(0.70, 1.0, t);
    } else {
      const sRaw = (frac - gaitDuty) / (1 - gaitDuty);
      const s = clamp((sRaw - f.swingS0) / (1 - f.swingS0 + 1e-6), 0, 1);   // 0 at the start of THIS swing
      f.swingS = s;
      // Land half a stance ahead of the body *along the way it is actually moving*. (This used to be along the
      // facing direction, which is the same when running but wrong when a shove sends him backwards or sideways:
      // the feet landed close together and the stride collapsed.)
      _tmp.copy(char.pos).addScaledVector(_left, f.s * STEP_HALF)
        .addScaledVector(char.vel, (1 - s) * swingDur + stanceDur * 0.5);
      _tmp.y = footGround(_tmp);
      f.land.copy(_tmp);
      const e = s * s * (3 - 2 * s);
      // The foot follows its swing path, but never faster than a real foot can move (24 m/s; a full run peaks near
      // 22). A foot that has fallen behind (joining the gait late, after a shove or a landing) catches up over a
      // few frames instead of jumping.
      _swingTarget.lerpVectors(f.lift, f.land, e);
      const behind = f.world.distanceTo(_swingTarget), maxMove = 24 * dt;
      if (behind > maxMove) f.world.lerp(_swingTarget, maxMove / behind); else f.world.copy(_swingTarget);
      f.height = Math.sin(Math.PI * s) * gaitStep;
      f.toeUp = lerp(-0.34, 0.28, smooth(0.10, 0.82, s));
    }
  }

  // Safety net: whatever the cases above did, a foot never moves faster than a real one can (24 m/s). If something
  // asks for more (a landing, a reversal at a run, joining the gait late), the foot catches up over a few frames.
  for (const f of feet) {
    const moved = f.world.distanceTo(f.prevWorld), cap = 24 * dt;
    if (moved > cap) f.world.lerpVectors(f.prevWorld, f.world, cap / moved);
  }

  // Turning on the spot drags both planted feet round to new spots, and on a half turn they would
  // pass straight through each other. Never let them closer than a shoe's width side to side.
  if (char.grounded && !walking) {
    const dl = (feet[0].plant.x - feet[1].plant.x) * _left.x + (feet[0].plant.z - feet[1].plant.z) * _left.z;
    if (dl < 0.12) {
      // Gradual (at most ~1.5 m/s each): after a sideways shove the feet can be far apart the wrong way round,
      // and correcting that in one step used to throw both of them half a metre.
      const push = Math.min((0.12 - dl) * 0.5, 0.0125);
      feet[0].plant.addScaledVector(_left, push); feet[1].plant.addScaledVector(_left, -push);
      feet[0].world.copy(feet[0].plant); feet[1].world.copy(feet[1].plant);
    }
  }

  /* ---- pelvis height: bob, crouch, landing dip ---- */
  const bobW = -Math.cos(2 * char.gait) * CFG.hipBobWalk * (1 - char.runBlend);
  const bobR =  Math.cos(2 * char.gait) * CFG.hipBobRun  * char.runBlend;
  char.hipY = (bobW + bobR) * char.moveBlend - CFG.crouchBase
            - char.crouch * 0.26 - char.landDip;
  char.hipX = Math.sin(char.gait) * 0.028 * char.moveBlend;

  secondary(dt);
}

/* ---- secondary motion: springs for lag, lean, bank, head, limbs ---- */
function secondary(dt) {
  _tmp.subVectors(char.vel, char.prevVel).multiplyScalar(1 / dt);
  char.accel.lerp(_tmp, 0.20);
  char.prevVel.copy(char.vel);
  const ax = clamp(char.accel.dot(_left), -22, 22);   // + = accelerating to its left
  const az = clamp(char.accel.dot(_fwd),  -22, 22);   // + = accelerating forward
  const g  = CFG.jiggleGain;

  sp.bodyX.step(-ax * CFG.jiggleShift, CFG.bodyK, CFG.bodyD, dt);   // metres
  sp.bodyZ.step(-az * CFG.jiggleShift, CFG.bodyK, CFG.bodyD, dt);
  sp.chestPitch.step(-az * g,        CFG.bodyK * 0.80, CFG.bodyD * 0.90, dt);  // radians
  sp.chestRoll.step(  ax * g,        CFG.bodyK * 0.80, CFG.bodyD * 0.90, dt);
  sp.headPitch.step( -az * g * 1.30, CFG.headK, CFG.headD, dt);
  sp.headRoll.step(   ax * g * 1.30, CFG.headK, CFG.headD, dt);
  sp.headYaw.step(clamp(char.yawRate * 0.11, -0.5, 0.5) * CFG.headLook, CFG.headK * 1.3, CFG.headD * 1.2, dt);
  sp.armL.step(-az * g * 1.70, CFG.limbK, CFG.limbD, dt);
  sp.armR.step(-az * g * 1.70, CFG.limbK, CFG.limbD, dt);
  sp.legL.step( az * g * 0.60, CFG.limbK, CFG.limbD, dt);
  sp.legR.step( az * g * 0.60, CFG.limbK, CFG.limbD, dt);

  const stretchTarget = char.grounded ? 0 : clamp(char.vy * 0.026, -0.10, 0.14);
  sp.squash.step(stretchTarget, CFG.sqK, CFG.sqD, dt);
  sp.squash.x = clamp(sp.squash.x, -0.16, 0.14);

  // The wind shoves the whole body: lean into a headwind, brace against a
  // crosswind. Mean wind only (no turbulence), so the lean breathes with the gusts.
  wind.sampleMean(char.pos.x, char.pos.z, _wv);
  const windFwd  = _wv.dot(_fwd), windLeft = _wv.dot(_left);
  const windLean = clamp(-windFwd * CFG.windLean, -0.12, 0.26) * (char.grounded ? 1 : 0.4);
  const windBank = clamp( windLeft * CFG.windBank, -0.20, 0.20) * (char.grounded ? 1 : 0.4);

  sp.lean.step(CFG.leanRun * (char.speed / CFG.runSpeed) + char.crouch * 0.22 + windLean, 95, 15, dt);
  sp.bank.step(clamp(-char.yawRate * CFG.leanTurn * smooth(0.3, 2.2, char.speed), -0.42, 0.42) + windBank, 95, 15, dt);
}

/* ==========================================================================
   Pose: write the rig for this frame
   ========================================================================== */
const _eul = new THREE.Euler(0, 0, 0, 'YXZ');
const _target = new THREE.Vector3(), _aimTmp = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _fw = new THREE.Vector3();
const _armQ = new THREE.Quaternion(), _armE = new THREE.Euler(0, 0, 0, 'XYZ');

// Resolve every per-limb lookup once. The pose loop then runs without building
// a single string or hashing a single key per frame.
for (const f of feet) {
  const n = f.name;
  f.bShoulder = B['shoulder' + n];
  f.bHip      = B['hip' + n];
  f.iShoulder = I['shoulder' + n];
  f.iUpperArm = I['upperArm' + n];
  f.iForeArm  = I['foreArm'  + n];
  f.iHand     = I['hand'     + n];
  f.iHip      = I['hip'      + n];
  f.iUpperLeg = I['upperLeg' + n];
  f.iLowerLeg = I['lowerLeg' + n];
  f.iFoot     = I['foot'     + n];
  f.aUpperArm = aimAxis['upperArm' + n];
  f.aForeArm  = aimAxis['foreArm'  + n];
  f.aHand     = aimAxis['hand'     + n];
  f.aFoot     = aimAxis['foot'     + n];
  f.armSpring = n === 'L' ? sp.armL : sp.armR;
  f.legSpring = n === 'L' ? sp.legL : sp.legR;
  f.pole      = new THREE.Vector3();
  f.tgt       = new THREE.Vector3();
  f.kneePref  = { out: 0.2, up: 0.1 };
  f.kOut = 0.2; f.kUp = 0.06; f.kInit = false; f.toeOut = 0; f.auto = false; f.sw = null; f.pitchNow = 0;
  f.armQ      = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
}

function setEuler(bone, x, y, z) { _eul.set(x, y, z); bone.quaternion.setFromEuler(_eul); }

export function poseCharacter(dt) {
  /* ---- character transform, including volume-preserving squash ---- */
  const sy  = clamp(1 + sp.squash.x, 0.84, 1.14);
  const sxz = 1 / Math.sqrt(sy);
  model.position.copy(char.pos);
  model.quaternion.setFromAxisAngle(UP_Y, char.yaw);
  model.scale.set(sxz, sy, sxz);

  /* ---- reset to bind, then layer the pose on top ---- */
  for (let i = 0; i < NB; i++) {
    bones[i].position.copy(bindLocalPos[i]);
    bones[i].quaternion.identity();
    bones[i].scale.setScalar(1);
  }

  // breathing: inflate the torso, counter-scale so head and arms stay put
  sp.breathe = (sp.breathe + dt * CFG.breatheRate * TAU) % TAU;
  const br = Math.sin(sp.breathe) * CFG.breatheAmp * (0.35 + 0.65 * (1 - char.moveBlend));
  const bs = 1 + br * 0.5, inv = 1 / (bs * bs);
  B.spineA.scale.setScalar(bs); B.spineB.scale.setScalar(bs);
  B.neck.scale.setScalar(inv); B.shoulderL.scale.setScalar(inv); B.shoulderR.scale.setScalar(inv);

  const move = char.moveBlend, run = char.runBlend;
  const twist = Math.sin(char.gait) * move * (0.45 + 0.55 * run) + char.climbTwist;
  const lean = sp.lean.x, bank = sp.bank.x;

  // pelvis
  B.pelvis.position.set(
    bindLocalPos[0].x + char.hipX + sp.bodyX.x,
    bindLocalPos[0].y + char.hipY + br * 0.02,
    bindLocalPos[0].z + sp.bodyZ.x
  );
  const pitch0 = char.pitch;
  setEuler(B.pelvis, lean * 0.30 + pitch0 * 0.50, twist * CFG.pelvisTwist, bank * 0.45 - char.hipX * 0.9);

  // spine + chest with counter-rotating shoulders
  setEuler(B.spineA, lean * 0.26 + pitch0 * 0.25, -twist * CFG.pelvisTwist * 0.45, bank * 0.22);
  setEuler(B.spineB, lean * 0.24 + pitch0 * 0.15, -twist * CFG.chestTwist * 0.45, bank * 0.22 + sp.chestRoll.x * 0.5);
  setEuler(B.chest,  lean * 0.20 + pitch0 * 0.10 + sp.chestPitch.x, -twist * CFG.chestTwist * 0.55, bank * 0.18 + sp.chestRoll.x);

  // neck + head: keep the head roughly level and let it lead the turn
  const spineLean = lean * 1.00 + pitch0 * 1.00 + sp.chestPitch.x;
  setEuler(B.neck, -spineLean * 0.35, sp.headYaw.x * 0.35, -bank * 0.25);
  setEuler(B.head, -spineLean * 0.55 + sp.headPitch.x - run * 0.06 + char.look,
                    sp.headYaw.x * 0.75 + twist * 0.08,
                   -bank * 0.45 + sp.headRoll.x);

  applyPunchTorso();   // blends the retargeted punch over the torso while one is playing
  fkAll();   // torso is final: resolve model-space transforms before the limbs

  const cy = Math.cos(char.yaw), sny = Math.sin(char.yaw);

  /* ---- arms ---- */
  const swingAmp = CFG.armSwing * move * (0.42 + 0.58 * run);
  const splayAmt = -0.620 + 0.085 * run;   // cancels the spread bind pose
  for (const f of feet) {
    const hd = char.hand[f.name];
    const lag = f.armSpring.x;
    let forward = -Math.cos(char.gait + f.phaseOff) * swingAmp + lag;
    let airSplay = 0;
    if (char.airBlend > 0.01) {                      // in the air: arms drive up, then spread for balance
      const up = clamp(char.vy / CFG.jumpVel, -1, 1), sF = smooth(0.35, -0.65, up);
      const lead = f.name === char.airLead;
      const runF = lerp(lead ? -0.55 : 1.15, lead ? -0.15 : 0.55, sF);   // opposite arm to the lead leg goes forward
      const air = lerp(lerp(1.0, 0.45, sF), runF, char.airRun);
      forward = lerp(forward, air, char.airBlend);
      airSplay = char.airBlend * sF * 0.30;
    }
    const elbow = 0.22 + CFG.elbowBend * run + 0.38 * Math.abs(forward) + char.crouch * 0.5;
    const splay = f.s * (splayAmt - Math.abs(forward) * 0.10 + airSplay) + f.s * bank * 0.30;

    setEuler(f.bShoulder, forward * 0.12, 0, f.s * (0.05 * run + 0.10 * Math.max(0, forward)));
    fkBone(f.iShoulder);

    _armE.set(-forward, 0, splay);
    _armQ.setFromEuler(_armE);
    aimBone(f.iUpperArm, _aimTmp.copy(f.aUpperArm).applyQuaternion(_armQ));

    _armE.set(-(forward + elbow), 0, splay * 0.95);
    _armQ.setFromEuler(_armE);
    aimBone(f.iForeArm, _aimTmp.copy(f.aForeArm).applyQuaternion(_armQ));

    _armE.set(-(forward + elbow) + lag * 0.8, 0, splay * 0.90);
    _armQ.setFromEuler(_armE);
    aimBone(f.iHand, _aimTmp.copy(f.aHand).applyQuaternion(_armQ));

    if (hd.w > 0.002) {                              // climbing: the hand travels from where it is to the grip
      const free = f.armQ;                           // keep the free pose to blend the joint angles from
      free[0].copy(bones[f.iUpperArm].quaternion); free[1].copy(bones[f.iForeArm].quaternion); free[2].copy(bones[f.iHand].quaternion);
      _fw.copy(mp[f.iHand]);                         // where the free-pose wrist is (model space)
      setEuler(f.bShoulder, 0, 0, f.s * 0.10 * hd.w);
      fkBone(f.iShoulder);
      fkBone(f.iUpperArm);                           // refresh the IK root after the shoulder moved
      const wx = hd.x - char.pos.x, wy = hd.y - char.pos.y, wz = hd.z - char.pos.z;
      _target.set((wx * cy - wz * sny) / sxz, wy / sy, (wx * sny + wz * cy) / sxz);
      _target.lerpVectors(_fw, _target, hd.w);       // a straight, wall-free path, not a pose cross-fade through the wall
      f.pole.set(hd.px, hd.py, hd.pz).normalize();
      solveTwoBone(f.iUpperArm, f.iForeArm, _target, f.pole, L_UARM, L_FARM);
      if (hd.aim) {                                  // lay the hand flat along the surface, fingers pointing on
        _aimTmp.set((hd.ax * cy - hd.az * sny), -0.22, (hd.ax * sny + hd.az * cy)).normalize();
        aimBone(f.iHand, _aimTmp);
      }
      const sb = smooth(0, 0.3, hd.w);               // joint angles settle onto the IK pose early
      if (sb < 0.999) {
        for (let k = 0; k < 3; k++) {
          const bn = bones[k === 0 ? f.iUpperArm : k === 1 ? f.iForeArm : f.iHand];
          _q1.copy(bn.quaternion);
          bn.quaternion.copy(free[k]).slerp(_q1, sb);
        }
      }
    }
  }

  applyPunchArms();   // punch arms over the locomotion arms (no-op unless punching)

  /* ---- legs: foot IK against the world-space contact points ---- */
  // Pass A: hip joint + the ankle target for each foot (model space).
  for (const f of feet) {
    setEuler(f.bHip, 0, 0, -f.s * 0.035);
    fkBone(f.iHip);
    fkBone(f.iUpperLeg);

    // world contact point -> model space (undo translation, yaw, then scale)
    const wx = f.world.x - char.pos.x;
    const wy = f.world.y + f.height - char.pos.y;
    const wz = f.world.z - char.pos.z;
    // Foot roll. The ankle is what IK can aim at, but a real foot pivots about
    // the toe during push-off and the heel at strike. Offset the ankle by
    // exactly the amount that holds the contact point still, so the shoe
    // neither sinks into the floor nor skates across it.
    const pitch = f.toeUp + f.legSpring.x * 0.30;        // + = toes up
    const contact = f.free ? 0 : 1 - smooth(0, 0.05, f.height);
    const a  = -pitch;                                   // pitch applied to the bone
    const lz = pitch < 0 ? TOE_LEVER : -HEEL_LEVER;      // which end is pivoting
    const sa = Math.sin(a), ca = Math.cos(a);
    const rollY = contact * (lz * sa - SOLE_DROP * (1 - ca));
    const rollZ = contact * (lz * (1 - ca) + SOLE_DROP * sa);
    f.tgt.set((wx * cy - wz * sny) / sxz,
               wy / sy + ANKLE_H + rollY,
              (wx * sny + wz * cy) / sxz + rollZ);
    f.pitchNow = pitch;
  }

  // Pass B: solve the legs. In free locomotion the knee just points forward. During a
  // climb it is chosen: of a small set of knee directions (out to the side, up, forward),
  // pick the one that keeps both legs out of the wall and out of each other, and nearest
  // to the pose the move asked for. A climber's knees go out and up, never into the wall.
  const climbing = feet[0].auto || feet[1].auto;
  if (climbing) gatherNearBoxes();
  for (let pass = 0; pass < (climbing ? 2 : 1); pass++) {
    for (const f of feet) {
      if (f.clipPole) {                              // a clip drives this leg: use its knee direction as is
        if (pass === 0) { f.pole.copy(f.clipPole); solveTwoBone(f.iUpperLeg, f.iLowerLeg, f.tgt, f.pole, L_THIGH, L_SHIN); }
        continue;
      }
      if (!f.auto) { if (pass === 0) solveLegDefault(f, sxz, sy, cy, sny); continue; }
      solveLegChosen(f, feet[f === feet[0] ? 1 : 0], pass === 1, sxz, sy, cy, sny);
    }
  }
}

function solveLegDefault(f, sxz, sy, cy, sny) {
  f.pole.set(f.s * 0.20, 0.06, 1).normalize();
  solveTwoBone(f.iUpperLeg, f.iLowerLeg, f.tgt, f.pole, L_THIGH, L_SHIN);
  aimFoot(f, 0);
}

// ankle pitch: exactly the angle the roll compensation above assumed. While climbing the
// shoe is also turned out and its sole kept facing down, so it never twists with the shin.
function aimFoot(f, toeOut) {
  _footE.set(-f.pitchNow, f.s * toeOut, 0);
  _armQ.setFromEuler(_footE);
  _aimTmp.copy(f.aFoot).applyQuaternion(_armQ);
  aimBone(f.iFoot, _aimTmp);
  if (!f.auto) return;
  _fd.copy(_aimTmp).normalize();                                   // toe direction we asked for
  _fu.set(0, 1, 0).applyQuaternion(mq[f.iFoot]);                   // where the shoe's top currently faces
  _fu.addScaledVector(_fd, -_fu.dot(_fd));
  _fw.set(0, 1, 0).addScaledVector(_fd, -_fd.y);                   // where it should face: up
  if (_fu.lengthSq() < 1e-6 || _fw.lengthSq() < 0.04) return;
  _fu.normalize(); _fw.normalize();
  let ang = Math.acos(clamp(_fu.dot(_fw), -1, 1));
  _fn.crossVectors(_fu, _fw);
  if (_fn.dot(_fd) < 0) ang = -ang;
  _q1.setFromAxisAngle(_fd, ang * 0.85);                           // model-space roll about the toe axis
  _q2.copy(mq[parentIdx[f.iFoot]]).invert();
  bones[f.iFoot].quaternion.copy(_q2).multiply(_q1).multiply(mq[f.iFoot]);
  fkBone(f.iFoot);
}

/* ---- knee direction search --------------------------------------------------- */
const KNEE_CANDS = [];
KNEE_CANDS.push([0.2, 0.1]);                                  // the ordinary running knee comes first
for (const out of [0, 0.45, 0.9, 1.35]) for (const up of [-0.3, 0.2, 0.7, 1.2]) KNEE_CANDS.push([out, up]);
const _fd = new THREE.Vector3(), _fu = new THREE.Vector3(), _fn = new THREE.Vector3(), _q2 = new THREE.Quaternion();
const _footE = new THREE.Euler(0, 0, 0, 'YXZ');
const nearBoxes = [];
const _wp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];   // this leg: hip, knee, ankle (world)
const _sp = new THREE.Vector3();
const R_THIGH0 = 0.090, R_THIGH1 = 0.064, R_SHIN0 = 0.066, R_SHIN1 = 0.044, CLEAR = 0.028;

function gatherNearBoxes() {
  nearBoxes.length = 0;
  const px = char.pos.x, py = char.pos.y, pz = char.pos.z;
  for (const b of level.boxes) {
    if (px < b.x0 - 2 || px > b.x1 + 2 || pz < b.z0 - 2 || pz > b.z1 + 2 || py > b.y1 + 2 || py + 2.2 < b.y0) continue;
    nearBoxes.push(b);
  }
}
function toWorld(m, out, sxz, sy, cy, sny) {
  const x = m.x, z = m.z;
  return out.set(char.pos.x + sxz * (x * cy + z * sny), char.pos.y + sy * m.y, char.pos.z + sxz * (-x * sny + z * cy));
}
function boxDist(p, b) {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1), dy = Math.max(b.y0 - p.y, 0, p.y - b.y1), dz = Math.max(b.z0 - p.z, 0, p.z - b.z1);
  const o = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (o > 0) return o;
  return -Math.min(p.x - b.x0, b.x1 - p.x, p.y - b.y0, b.y1 - p.y, p.z - b.z0, b.z1 - p.z);
}
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _rr = new THREE.Vector3();
function segDist(p1, q1, p2, q2) {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _rr.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_rr), c = _d1.dot(_rr), b = _d1.dot(_d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
  let t = e > 1e-9 ? (b * s + f) / e : 0;
  if (t < 0) { t = 0; s = a > 1e-9 ? clamp(-c / a, 0, 1) : 0; }
  else if (t > 1) { t = 1; s = a > 1e-9 ? clamp((b - c) / a, 0, 1) : 0; }
  const dx = _rr.x + _d1.x * s - _d2.x * t, dy = _rr.y + _d1.y * s - _d2.y * t, dz = _rr.z + _d1.z * s - _d2.z * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// how far the current leg pose sinks into walls and into the other leg (metres, summed)
function legPenetration(f, other, sxz, sy, cy, sny) {
  toWorld(mp[f.iUpperLeg], _wp[0], sxz, sy, cy, sny);
  toWorld(mp[f.iLowerLeg], _wp[1], sxz, sy, cy, sny);
  toWorld(mp[f.iFoot],     _wp[2], sxz, sy, cy, sny);
  let pen = 0;
  for (const b of nearBoxes) {
    for (let i = 1; i <= 5; i++) {                                  // thigh, hip excluded: it moves with the body
      const t = i / 5;
      _sp.lerpVectors(_wp[0], _wp[1], t);
      pen += Math.max(0, lerp(R_THIGH0, R_THIGH1, t) + CLEAR - boxDist(_sp, b));
    }
    for (let i = 0; i <= 5; i++) {                                  // shin
      const t = i / 5;
      _sp.lerpVectors(_wp[1], _wp[2], t);
      pen += Math.max(0, lerp(R_SHIN0, R_SHIN1, t) + CLEAR - boxDist(_sp, b));
    }
  }
  if (other.sw) {                                                   // the other leg, solved already
    const w = other.sw;
    pen += 3 * Math.max(0, 2 * 0.070 + CLEAR - segDist(_wp[0], _wp[1], w[0], w[1]));
    pen += 3 * Math.max(0, 2 * 0.050 + CLEAR - segDist(_wp[1], _wp[2], w[1], w[2]));
    pen += 3 * Math.max(0, 0.070 + 0.050 + CLEAR - segDist(_wp[0], _wp[1], w[1], w[2]));
    pen += 3 * Math.max(0, 0.070 + 0.050 + CLEAR - segDist(_wp[1], _wp[2], w[0], w[1]));
  }
  return pen;
}

function solveLegChosen(f, other, refine, sxz, sy, cy, sny) {
  const pref = f.kneePref;
  let best = -1, bestCost = Infinity;
  for (let k = 0; k < KNEE_CANDS.length; k++) {
    const [out, up] = KNEE_CANDS[k];
    const co = Math.cos(up);
    f.pole.set(f.s * Math.sin(out) * co, Math.sin(up), Math.cos(out) * co);
    solveTwoBone(f.iUpperLeg, f.iLowerLeg, f.tgt, f.pole, L_THIGH, L_SHIN);
    fkBone(f.iFoot);
    const cost = legPenetration(f, other, sxz, sy, cy, sny) * 14 + Math.abs(out - pref.out) * 0.55 + Math.abs(up - pref.up) * 0.45
               + (refine && f.chosen === k ? 0 : refine ? 0.05 : 0);   // a little hysteresis between passes
    if (cost < bestCost) { bestCost = cost; best = k; }
  }
  // steer toward the winner smoothly across frames so the knee never snaps between candidates
  const [out, up] = KNEE_CANDS[best];
  const kk = refine ? 1 : 1 - Math.exp(-18 * (1 / 60));
  f.kOut += (out - f.kOut) * (f.kInit ? kk : 1);
  f.kUp  += (up  - f.kUp)  * (f.kInit ? kk : 1);
  f.kInit = true; f.chosen = best;
  const co = Math.cos(f.kUp);
  f.pole.set(f.s * Math.sin(f.kOut) * co, Math.sin(f.kUp), Math.cos(f.kOut) * co);
  solveTwoBone(f.iUpperLeg, f.iLowerLeg, f.tgt, f.pole, L_THIGH, L_SHIN);
  aimFoot(f, f.toeOut);
  if (!f.sw) f.sw = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  toWorld(mp[f.iUpperLeg], f.sw[0], sxz, sy, cy, sny);
  toWorld(mp[f.iLowerLeg], f.sw[1], sxz, sy, cy, sny);
  toWorld(mp[f.iFoot],     f.sw[2], sxz, sy, cy, sny);
}
