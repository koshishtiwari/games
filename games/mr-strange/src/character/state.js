// Shared mutable character state. Lives in its own module so that motion.js
// (locomotion + pose) and traversal.js (climbing) can both use it without
// importing each other.

import * as THREE from 'three';
import { CFG } from '../config.js';
import { Spring } from '../math.js';

export const STEP_HALF = 0.058;   // feet track much closer together than the hips

export const char = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  prevVel: new THREE.Vector3(),
  accel: new THREE.Vector3(),       // world-space, low-passed
  yaw: 0, yawRate: 0,
  speed: 0,
  vy: 0, grounded: true,
  jumpPhase: 'ground',              // ground | crouch | air
  jumpTimer: 0,
  gait: 0,
  moveBlend: 0, runBlend: 0,
  landDip: 0, crouch: 0,
  hipY: -CFG.crouchBase, hipX: 0,
  // traversal
  mode: 'free',                     // free | hang | mantle | vault | rope | lower
  pitch: 0,                         // extra forward pitch of the torso (vaults)
  look: 0,                          // extra head pitch (+ = down), e.g. looking up at a ledge
  climbTwist: 0,                    // extra pelvis/shoulder counter-twist while climbing
  catchCooldown: 0,                 // s before a ledge / rope may be grabbed again
  // jump
  jumpBuf: 0, coyote: 0, airT: 0, autoJump: false,
  airBlend: 0,                      // 0 on the ground .. 1 in the air: fades the air pose in
  airLead: 'L', airRun: 0,          // which leg leads, and how much of a run the jump started as
  // bat morph & flight
  isBat: false,
  hitReact: null,                   // a hit waiting to be handled by stepSim: { dx, dz, power, ix, iz, ivy }
  knockT: 0,                        // s left of being knocked back: the facing ignores the push (he does not spin round)
  arrowHits: 0, arrowHitT: 0,       // arrows that hit the bat lately (three knock him back into a man)
  forceUnmorph: false,              // set by a hard wall hit or three arrows; main.js turns the bat back into the man
  morph: 0,                         // 0 = man, 1 = bat
  batPitch: 0, batBank: 0,
  flapPhase: 0, flapPower: 0, batGlide: 0,
  batSquish: 0, batSquishV: 0,      // soft-body wall/ground splat spring
  batSplatT: 0,                     // brief wall-stick timer on hard impact
  batGrounded: false,
  // hand IK targets in WORLD space, used while climbing. pole = elbow direction (model space)
  hand: {
    L: { t: 0, w: 0, x: 0, y: 0, z: 0, px: 0.6, py: -0.5, pz: -0.2, aim: false, ax: 0, az: 0 },
    R: { t: 0, w: 0, x: 0, y: 0, z: 0, px: -0.6, py: -0.5, pz: -0.2, aim: false, ax: 0, az: 0 },
  },
};

// unit vectors for the way the character faces / its left, refreshed every step
export const facing = { fwd: new THREE.Vector3(0, 0, 1), left: new THREE.Vector3(1, 0, 0) };
export function setYaw(yaw) {
  char.yaw = yaw;
  facing.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  facing.left.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

export const feet = [
  { s:  1, name: 'L', phaseOff: 0 },
  { s: -1, name: 'R', phaseOff: Math.PI },
].map(f => Object.assign(f, {
  world: new THREE.Vector3(f.s * STEP_HALF, 0, 0),
  plant: new THREE.Vector3(f.s * STEP_HALF, 0, 0),
  lift:  new THREE.Vector3(f.s * STEP_HALF, 0, 0),
  land:  new THREE.Vector3(f.s * STEP_HALF, 0, 0),
  stance: true, swingS: 0, height: 0, toeUp: 0,
  prevWorld: new THREE.Vector3(),   // where the foot was at the start of this step (for the speed limit)
  walkActive: false,                // is this foot following the walking gait right now (so it can join / leave it smoothly)?
  swingS0: 0,                       // swing progress at which this swing began (0 unless it joined mid-swing)
}));

// secondary-motion springs
export const sp = {
  squash:     new Spring(0),                                    // +stretch / -squash
  headPitch:  new Spring(0), headRoll: new Spring(0), headYaw: new Spring(0),
  bodyX:      new Spring(0), bodyZ:    new Spring(0),            // torso lag
  chestPitch: new Spring(0), chestRoll: new Spring(0),
  armL:       new Spring(0), armR:     new Spring(0),            // limb overshoot
  legL:       new Spring(0), legR:     new Spring(0),
  lean:       new Spring(0), bank:     new Spring(0),
  breathe: 0,
};
