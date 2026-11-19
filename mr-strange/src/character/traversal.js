// Traversal: everything that is not plain running and jumping.
//
//   hang     holding a ledge: shimmy along it, pull up, or let go
//   mantle   climb up onto a ledge (from a hang, or from the ground for low ones)
//            -- played backwards it is also the "lower yourself over the edge" move
//   vault    dive over a thin obstacle or through a window
//   rope     climb up and down a rope, top out onto the roof, or leap off
//
// There is no animation clip anywhere: each move places hand and foot targets in
// world space and moves the body along a short authored path; the rig's two-bone
// IK (motion.js poseCharacter) does the rest. A move is entered from motion.js:
//   groundCheck  every step while standing  (edge lowering, walking into a rope)
//   tryContext   when JUMP is pressed on the ground (vault / mantle / rope)
//   airCheck     every step in the air      (catch a ledge or a rope)
// and while a move is active motion.js calls step().

import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, lerp, smooth } from '../math.js';
import { char, facing, feet, setYaw, sp, STEP_HALF } from './state.js';
import { level } from '../world/level.js';
import { findLedge, groundHeight, blocked, pushOut } from '../world/collision.js';
import { planStumble, sampleStumble, JOINTS, NJ, HIPS } from './stumble.js';
import { SHOE } from './body.js';
import { driveMove, releaseDrive, clipJoint, CLIMB_FROM, CLIMB_FRAMES, CLIMB_FPS } from './punch.js';

const HANG_DROP = 1.85;     // feet to ledge top when hanging (arms just short of straight)
const HANG_OFF  = 0.24;     // body distance from the wall face while hanging
const SHOULDER_H = 1.45, ARM_REACH = 0.57;   // shoulder height above the feet; wrist-to-shoulder reach
const WRIST_Y = 0.045;      // wrist height above a surface it grips (palm flat on it, skin just clear)
const TOE = SHOE.toe;                        // measured off the real shoe: toe tip is this far ahead of the ankle
const LEDGE_REACH = [1.3, 2.55];   // ledge-top heights above the feet that a jump can catch
const LOW_REACH   = [0.55, 1.55];   // ... that can be vaulted / mantled from the ground
const HIGH_AUTO   = [1.6, 3.1];     // ledges worth an automatic jump-and-grab when running at them

const L = {};                                        // scratch ledge from findLedge
const _v = new THREE.Vector3();

// the ledge currently in use (a copy: `L` is reused by every query)
const LG = { box: null, px: 0, pz: 0, y: 0, nx: 0, nz: 1, tx: 1, tz: 0, t: 0, t0: 0, t1: 0, depth: 1 };
function takeLedge(src) {
  LG.box = src.box || null;
  LG.px = src.px; LG.pz = src.pz; LG.y = src.y; LG.nx = src.nx; LG.nz = src.nz;
  LG.tx = src.tx; LG.tz = src.tz; LG.t = src.t; LG.t0 = src.t0; LG.t1 = src.t1; LG.depth = src.depth;
}
// point on the ledge at parameter t (world x or z along its length)
function ledgeX(t) { return LG.tx ? t : LG.px; }
function ledgeZ(t) { return LG.tz ? t : LG.pz; }

const M = {                                          // active timed move
  t: 0, dur: 1, reverse: false, kind: 'mantle',
  p0: new THREE.Vector3(), p1: new THREE.Vector3(), lead: 0,
  handsOn: 0.05, handsOff: 0.85, pitch: 0.3,
};
const H = { t: 0, from: new THREE.Vector3() };       // hang
const RP = { rope: null, phase: 0 };                 // rope
let edgeTimer = 0;

/* ---- helpers ---------------------------------------------------------------- */
// (x, y, z) is the SOLE contact point; the pose code adds the ankle height. `free` switches
// off the walking shoe-roll compensation, which only makes sense on a flat floor.
// toeOut turns the shoe outward (rad); kOut / kUp say where the knee should point (out to the side,
// up): the pose code picks the nearest direction that keeps the leg out of the wall and the other leg.
function setFoot(f, x, y, z, toeUp, toeOut = 0.2, kOut = 0.3, kUp = 0.1) {
  f.world.set(x, y, z); f.plant.copy(f.world);
  f.height = 0; f.free = true; f.auto = true;
  f.toeUp = toeUp; f.stance = false;
  f.toeOut = toeOut; f.kneePref.out = kOut; f.kneePref.up = kUp;
}
function setHand(name, x, y, z) {
  const h = char.hand[name]; h.t = 1; h.x = x; h.y = y; h.z = z; h.aim = false;
}
// grip the ledge top: palm flat on it, wrist just above the surface, fingers over the lip
function gripHand(name, lateral) {
  const lt = facing.left.x * LG.tx + facing.left.z * LG.tz;            // does "left" run along the ledge's t axis?
  const tt = clamp(LG.t + lt * lateral, LG.t0 - 0.15, LG.t1 + 0.15);    // stay on the ledge
  setHand(name, ledgeX(tt) + LG.nx * 0.03, LG.y + WRIST_Y, ledgeZ(tt) + LG.nz * 0.03);
  const h = char.hand[name]; h.aim = true; h.ax = -LG.nx; h.az = -LG.nz;
}
function releaseHand(name) { char.hand[name].t = 0; }
function handsOff() { char.hand.L.t = 0; char.hand.R.t = 0; }

/** Every sim step, in every mode: fade hand IK in and out, relax head look / twist. */
export function tick(dt) {
  const k = 1 - Math.exp(-14 * dt);
  for (const h of [char.hand.L, char.hand.R]) {
    h.w += (h.t - h.w) * k;
    if (h.t === 0 && h.w < 0.002) { h.w = 0; h.aim = false; }
  }
  if (char.mode === 'free') {
    const r = Math.exp(-6 * dt);
    char.look *= r; char.climbTwist *= r;
  }
}
const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const bump = (u, a, b) => Math.sin(Math.PI * clamp((u - a) / (b - a), 0, 1));
// let the secondary-motion springs feel the scripted movement: head, chest and cape lag it
function driveVelocity(dt, px, py, pz) {
  char.vel.set(clamp((char.pos.x - px) / dt, -4, 4), 0, clamp((char.pos.z - pz) / dt, -4, 4));
  char.vy = clamp((char.pos.y - py) / dt, -4, 4);
}
function freezeLocomotion() {
  char.speed = 0; char.moveBlend = 0; char.runBlend = 0; char.airBlend = 0;
  char.vel.set(0, 0, 0); char.accel.set(0, 0, 0); char.prevVel.set(0, 0, 0);
  char.yawRate = 0; char.hipX = 0;
}

function leaveToFree(x, y, z) {
  char.pos.set(x, y, z);
  char.mode = 'free'; char.grounded = true; char.jumpPhase = 'ground';
  char.vy = 0; char.vel.set(0, 0, 0); char.pitch = 0; char.crouch = 0;
  char.catchCooldown = 0.25;
  handsOff();
  for (const f of feet) {                            // plant both feet where we stand
    f.world.set(x + facing.left.x * f.s * STEP_HALF, y, z + facing.left.z * f.s * STEP_HALF);
    f.plant.copy(f.world); f.lift.copy(f.world); f.land.copy(f.world);
    f.height = 0; f.toeUp = 0; f.stance = true;
  }
}

/* ---- contact points ------------------------------------------------------------------------ */
// a box's wall exists from its underside up; below an overhang a foot just dangles
function wallAt(y) { return !LG.box || y >= LG.box.y0 - 0.02; }
// foot against the wall below the ledge: toe near the face, never through it
function wallFoot(s, y, out, gap) {
  const d = TOE + gap;
  return out.set(ledgeX(LG.t) + LG.nx * d + facing.left.x * s * 0.09, y, ledgeZ(LG.t) + LG.nz * d + facing.left.z * s * 0.09);
}
// foot flat on the ledge top: sole on the surface, ankle well inside so heel and toe both rest on it
function ledgeFoot(s, out) {
  const fi = Math.min(0.20, Math.max(0.12, LG.depth * 0.5));   // heel (~0.1 behind the ankle) stays on the surface
  return out.set(ledgeX(LG.t) - LG.nx * fi + facing.left.x * s * 0.065, LG.y, ledgeZ(LG.t) - LG.nz * fi + facing.left.z * s * 0.065);   // feet near the centreline, hands out wide
}
const _b = new THREE.Vector3(), _t = new THREE.Vector3(), _w = new THREE.Vector3();

// Move a foot from `b` to the ledge-side target `t` as e goes 0..1: up first, clear of the edge,
// then across, then down onto it. A straight line would cut through the corner of the ledge.
function hookPath(b, t, e, minTop, across0 = 0.52, across1 = 1, settle0 = 0.72) {
  const yTop = Math.max(Math.max(b.y, t.y) + 0.10, minTop);
  const ev = smooth(0, 0.5, e), eh = smooth(across0, across1, e), settle = smooth(settle0, 1, e);
  b.x = lerp(b.x, t.x, eh); b.z = lerp(b.z, t.z, eh);
  b.y = lerp(lerp(b.y, yTop, ev), t.y, settle);
  return b;
}
// has the arm run out of reach of its grip? (then the hand lets go, as a real one would)
function outOfReach(name) {
  const h = char.hand[name], sd = name === 'L' ? 1 : -1;
  const sx = char.pos.x + facing.left.x * sd * 0.18, sy = char.pos.y + SHOULDER_H, sz = char.pos.z + facing.left.z * sd * 0.18;
  return Math.hypot(h.x - sx, h.y - sy, h.z - sz) > ARM_REACH;
}

/* ---- hang ------------------------------------------------------------------------------------ */
function hangPos(t, out) {
  return out.set(ledgeX(t) + LG.nx * HANG_OFF, LG.y - HANG_DROP, ledgeZ(t) + LG.nz * HANG_OFF);
}
function enterHang() {
  char.mode = 'hang'; char.grounded = false; char.jumpPhase = 'air';
  H.t = 0; H.from.copy(char.pos);
  setYaw(Math.atan2(-LG.nx, -LG.nz));
  freezeLocomotion();
  sp.squash.kick(-0.6);                                  // the jolt of catching your weight
  char.look = -0.3;
}
function stepHang(dt, input, camRight, camFwd) {
  H.t += dt;
  freezeLocomotion();
  setYaw(Math.atan2(-LG.nx, -LG.nz));

  // wish direction, split into "along the ledge" and "into the wall"
  let into = 0, along = 0;
  if (input.mag > 0.2 && H.t > 0.25) {
    const dx = camRight.x * input.x + camFwd.x * input.y, dz = camRight.z * input.x + camFwd.z * input.y;
    into = (dx * -LG.nx + dz * -LG.nz);
    along = dx * LG.tx + dz * LG.tz;
  }
  if (input.jumpQueued && H.t > 0.15) { input.jumpQueued = false; startMantle(); return; }
  input.jumpQueued = false;
  if (into > 0.6 && input.mag > 0.4 && H.t > 0.25) { startMantle(); return; }
  if (into < -0.6 && H.t > 0.35) { dropFromHang(); return; }

  const px = char.pos.x, py = char.pos.y, pz = char.pos.z;
  if (Math.abs(along) > 0.25) LG.t = clamp(LG.t + along * 1.15 * dt, LG.t0, LG.t1);
  hangPos(LG.t, _w);
  const e = smooth(0, 0.16, H.t);                                    // settle into the hang
  char.pos.lerpVectors(H.from, _w, e);
  if (e >= 1) {
    char.pos.copy(_w);
    // the body is a pendulum: it keeps swinging a little after a catch, and breathes
    const sw = Math.exp(-H.t * 0.9);
    char.pos.x += LG.nx * 0.05 * sw * Math.sin(H.t * 3.1) + LG.tx * 0.012 * Math.sin(H.t * 1.3);
    char.pos.z += LG.nz * 0.05 * sw * Math.sin(H.t * 3.1) + LG.tz * 0.012 * Math.sin(H.t * 1.3);
  }

  gripHand('L', 0.26); gripHand('R', -0.26);
  const sway = Math.sin(H.t * 2.3) * 0.03;
  for (const f of feet) {
    const y = char.pos.y + 0.04 + (f.s > 0 ? sway : -sway) * 0.5;
    if (wallAt(y)) wallFoot(f.s, y, _t, 0.07 + sway); else _t.set(char.pos.x - facing.fwd.x * 0.1 + facing.left.x * f.s * 0.10, y, char.pos.z - facing.fwd.z * 0.1 + facing.left.z * f.s * 0.10);
    setFoot(f, _t.x, _t.y, _t.z, -0.45, 0.45, 0.55, 0.15);   // toes turned out, knees soft and a little out
  }
  char.pitch = 0; char.hipY = -0.02; char.climbTwist = 0;
  char.look += (-0.3 - char.look) * (1 - Math.exp(-6 * dt));         // eyes on the ledge
  driveVelocity(dt, px, py, pz);
}
function dropFromHang() {
  handsOff();
  char.mode = 'free'; char.grounded = false; char.jumpPhase = 'air';
  char.vy = 0; char.vel.set(LG.nx * 0.6, 0, LG.nz * 0.6);
  char.catchCooldown = 0.5; char.pitch = 0; char.airT = 0; char.airRun = 0;
}

/* ---- climb: the ground-start move for low obstacles --------------------------------------------
   run up (decelerating into the wall) -> first hand, then the other, plant on the edge ->
   sink into the arms (load) -> pull, the body rising with the feet walking up the wall ->
   one leg hooks onto the edge, weight shifting over it -> push up. A thick obstacle (mantle)
   ends standing on top; a thin one (vault) carries on over it and lands on the far side.
   Nothing is symmetric: the lead leg, which hand goes first, grip spacing and speed all vary. */
const CL = { t: 0, dur: 1.2, kind: 'mantle', p0: new THREE.Vector3(), pa: new THREE.Vector3(),
             p1: new THREE.Vector3(), gy: 0, lead: 0, first: 'R', jit: 0, handHit: false, footHit: false };
function startClimb(kind, p1) {
  CL.kind = kind; CL.t = 0;
  const speed = 0.92 + Math.random() * 0.16;
  CL.dur = (kind === 'vault' ? 1.15 : 0.95) / speed;
  CL.jit = (Math.random() - 0.5) * 0.08;
  CL.p0.copy(char.pos); CL.gy = char.pos.y; CL.p1.copy(p1);
  CL.pa.set(ledgeX(LG.t) + LG.nx * 0.36, char.pos.y, ledgeZ(LG.t) + LG.nz * 0.36);   // stand at the face
  CL.lead = Math.sin(char.gait) >= 0 ? 0 : 1;
  CL.first = CL.lead === 0 ? 'R' : 'L';                  // the hand opposite the lead leg grabs first
  CL.handHit = CL.footHit = false;
  char.mode = 'climb'; char.grounded = false; char.jumpPhase = 'air';
  setYaw(Math.atan2(-LG.nx, -LG.nz));
  freezeLocomotion();
}
function stepClimb(dt, input) {
  input.jumpQueued = false;
  freezeLocomotion();
  CL.t += dt;
  const px = char.pos.x, py = char.pos.y, pz = char.pos.z;
  const u = clamp(CL.t / CL.dur, 0, 1);
  const vault = CL.kind === 'vault';
  setYaw(Math.atan2(-LG.nx, -LG.nz));
  const lx = facing.left.x, lz = facing.left.z;
  const side = CL.lead === 0 ? 1 : -1;                   // which side of the body the lead leg is on

  // --- body path ---
  const ap = easeOut(u / 0.18);                          // brake into the wall, no linear glide
  const rise = smooth(0.20, 0.50, u);
  const yPull = Math.max(CL.gy, LG.y - 0.96);            // chest about level with the edge: the arms stay within reach
  let y = lerp(CL.gy, yPull, Math.pow(rise, 0.9)) - 0.05 * bump(u, 0.12, 0.26);   // sink into the arms before the pull
  let over;
  if (vault) {
    y = lerp(y, LG.y - 0.55, smooth(0.70, 0.84, u));       // hips clear the top, torso bridging over it
    y = lerp(y, CL.p1.y, smooth(0.84, 1.0, u));
    over = smooth(0.64, 1.0, u);
  } else {
    y = lerp(y, CL.p1.y, smooth(0.62, 0.92, u)) + 0.03 * bump(u, 0.58, 0.84);       // a little overshoot as the weight lands
    over = smooth(0.56, 0.92, u);
  }
  const bx = lerp(CL.p0.x, CL.pa.x, ap), bz = lerp(CL.p0.z, CL.pa.z, ap);
  const shift = 0.06 * side * bump(u, 0.30, 0.90);       // weight over the lead leg
  char.pos.set(lerp(bx, CL.p1.x, over) + lx * shift, y, lerp(bz, CL.p1.z, over) + lz * shift);

  // --- hands: staggered, each one placed on the real ledge top ---
  for (const name of ['L', 'R']) {
    const on = u > (name === CL.first ? 0.06 : 0.13) && !(u > 0.5 && outOfReach(name));
    if (on) gripHand(name, (name === 'L' ? 0.25 : -0.25) + CL.jit); else releaseHand(name);
  }
  if (!CL.handHit && u > 0.06) { CL.handHit = true; sp.squash.kick(-0.35); }

  // --- feet ---
  for (let i = 0; i < 2; i++) {
    const f = feet[i], sd = f.s;
    // on the ground first, then up the wall as the body is hauled up
    const fy = lerp(CL.gy, char.pos.y + 0.04, rise);
    _b.set(bx + lx * sd * 0.09, fy, bz + lz * sd * 0.09);
    if (wallAt(fy + 0.1)) { wallFoot(sd, fy, _w, 0.03); _b.lerp(_w, rise); }
    let toe = lerp(0, -0.4, rise);
    let tOut = lerp(0.1, 0.45, rise), kOut = lerp(0.2, 0.95, rise), kUp = lerp(0.1, 0.5, rise);   // frog stance on the wall
    if (i === CL.lead) {                                 // the hooked leg: knee high, sole flat on the edge
      // the foot goes up only as far as the hips allow: gate the hook on body height as well as time
      const e = Math.min(smooth(0.26, 0.54, u), smooth(LG.y - 0.95, LG.y - 0.50, char.pos.y));
      ledgeFoot(sd, _t);
      hookPath(_b, _t, e, LG.y + 0.08);
      toe = lerp(toe, 0.0, e);
      tOut = lerp(tOut, 0.2, e); kOut = lerp(kOut, 0.8, e); kUp = lerp(kUp, 0.95, smooth(0.3, 0.9, e));   // knee drives up and out, not into the chest
      if (!CL.footHit && e > 0.97) { CL.footHit = true; sp.squash.kick(-0.5); }
      if (vault) {                                       // push off the edge and land
        const l = smooth(0.84, 1.0, u);
        const lh = smooth(0.0, 0.75, l), lv = smooth(0.4, 1.0, l);            // clear the far edge before dropping
        _b.x = lerp(_b.x, CL.p1.x + lx * sd * 0.08, lh); _b.z = lerp(_b.z, CL.p1.z + lz * sd * 0.08, lh);
        _b.y = lerp(_b.y, CL.p1.y, lv) + 0.12 * Math.sin(Math.PI * l);
        kOut = lerp(kOut, 0.3, l); kUp = lerp(kUp, 0.3, l); tOut = lerp(tOut, 0.1, l);
      } else {                                           // slide in under the body as it stands
        const l = smooth(0.80, 0.95, u);
        _b.x = lerp(_b.x, CL.p1.x + lx * sd * 0.058, l); _b.z = lerp(_b.z, CL.p1.z + lz * sd * 0.058, l);
        _b.y = lerp(_b.y, CL.p1.y, l);
        kOut = lerp(kOut, 0.3, l); kUp = lerp(kUp, 0.2, l); tOut = lerp(tOut, 0.1, l);
      }
    } else if (vault) {                                  // trailing leg swings over the edge
      const e = smooth(0.70, 1.0, u);
      _t.set(CL.p1.x + lx * sd * 0.08, CL.p1.y, CL.p1.z + lz * sd * 0.08);
      hookPath(_b, _t, e, LG.y + 0.14, 0.40, 0.78, 0.80);   // clear the whole obstacle before coming down
      toe = lerp(toe, 0.1, e);
      kOut = lerp(kOut, 0.8, e); kUp = lerp(kUp, 0.9, smooth(0.0, 0.6, e)); tOut = lerp(tOut, 0.2, e);
    } else {                                             // trailing leg steps up onto the top
      const e = smooth(0.58, 0.86, u);
      _t.set(CL.p1.x + lx * sd * 0.058, LG.y, CL.p1.z + lz * sd * 0.058);
      hookPath(_b, _t, e, LG.y + 0.10);
      toe = lerp(toe, 0.0, e);
      kOut = lerp(kOut, 0.5, e); kUp = lerp(kUp, 0.8, smooth(0.0, 0.7, e)); tOut = lerp(tOut, 0.15, e);
      const l = smooth(0.84, 0.96, u); kOut = lerp(kOut, 0.25, l); kUp = lerp(kUp, 0.1, l);
    }
    setFoot(f, _b.x, _b.y, _b.z, toe, tOut, kOut, kUp);
  }

  // --- torso, head ---
  char.pitch = 0.55 * smooth(0, 0.4, u) * (1 - smooth(0.62, 1, u));
  char.hipY = -0.04 - 0.08 * Math.sin(Math.PI * clamp((u - 0.15) / 0.45, 0, 1));
  char.climbTwist = side * 1.1 * bump(u, 0.2, 0.78);                       // shoulders counter-turn as the knee comes up
  const look = vault ? (u < 0.55 ? -0.3 : u > 0.8 ? 0.25 : 0) : (u < 0.55 ? -0.3 : 0);
  char.look += (look - char.look) * (1 - Math.exp(-8 * dt));
  driveVelocity(dt, px, py, pz);

  if (u >= 1) {
    leaveToFree(CL.p1.x, CL.p1.y, CL.p1.z);
    sp.squash.kick(vault ? -0.9 : -0.6);
    if (vault) char.vel.set(facing.fwd.x * 2.0, 0, facing.fwd.z * 2.0);   // keep going
  }
}

/* ---- mantle from a hang (and its reverse: lowering yourself over an edge) --------------------- */
// p0 = the hang position, p1 = standing on top. reverse plays the move backwards.
function startMantle(reverse = false) {
  if (!reverse) { startClimbClip(); return; }      // pulling up from a hang is the Mixamo clip
  M.p1.set(ledgeX(LG.t) - LG.nx * 0.45, LG.y, ledgeZ(LG.t) - LG.nz * 0.45);
  hangPos(LG.t, M.p0);
  M.kind = 'mantle'; M.t = 0; M.reverse = reverse;
  M.dur = (reverse ? 0.8 : 0.8) / (0.92 + Math.random() * 0.16);
  M.handsOn = 0; M.handsOff = 0.85; M.pitch = 0.25;
  M.lead = Math.sin(char.gait) >= 0 ? 0 : 1;
  M.footHit = false;
  char.mode = 'mantle'; char.grounded = false; char.jumpPhase = 'air';
  setYaw(Math.atan2(-LG.nx, -LG.nz));
  freezeLocomotion();
}
function stepMantle(dt, input) {
  input.jumpQueued = false;
  freezeLocomotion();
  M.t += dt;
  const px = char.pos.x, py = char.pos.y, pz = char.pos.z;
  const raw = clamp(M.t / M.dur, 0, 1);
  const u = M.reverse ? 1 - raw : raw;
  const side = M.lead === 0 ? 1 : -1;
  // up first, then over the lip, with a little load before the pull and weight shift over the lead leg
  // pull until the chest is level with the edge (arms stay in reach), then rock forward over it
  const yPull = LG.y - 0.96;
  const up = smooth(0.03, 0.42, u), up2 = smooth(0.42, 0.92, u), over = smooth(0.40, 0.92, u);
  const shift = 0.05 * side * bump(u, 0.25, 0.9);
  char.pos.set(lerp(M.p0.x, M.p1.x, over) + facing.left.x * shift,
               lerp(lerp(M.p0.y, yPull, up), M.p1.y, up2) - 0.04 * bump(u, 0.0, 0.16) + 0.03 * bump(u, 0.72, 0.92),
               lerp(M.p0.z, M.p1.z, over) + facing.left.z * shift);
  setYaw(Math.atan2(-LG.nx, -LG.nz));

  for (const name of ['L', 'R']) {
    if (M.reverse || !(u > 0.5 && outOfReach(name))) gripHand(name, name === 'L' ? 0.26 : -0.26); else releaseHand(name);
  }
  const lx = facing.left.x, lz = facing.left.z;
  const tuck = 1 - smooth(0.55, 1, u);
  for (let i = 0; i < 2; i++) {
    const f = feet[i], sd = f.s;
    // dangling against the wall, knees drawing up as the body rises
    const fy = char.pos.y + 0.30 * tuck + 0.02;
    if (wallAt(fy)) wallFoot(sd, fy, _b, 0.05 * tuck + 0.03); else _b.set(char.pos.x + lx * sd * 0.10, fy, char.pos.z + lz * sd * 0.10);
    let tOut = 0.45, kOut = 0.95, kUp = 0.5;             // dangling against the wall: knees out like a frog
    if (i === M.lead) {                                  // one leg hooks onto the edge, knee high
      const e = Math.min(smooth(0.20, 0.50, u), smooth(LG.y - 0.95, LG.y - 0.50, char.pos.y));
      tOut = lerp(tOut, 0.2, e); kOut = lerp(kOut, 0.8, e); kUp = lerp(kUp, 0.95, smooth(0.3, 0.9, e));
      ledgeFoot(sd, _t);
      hookPath(_b, _t, e, LG.y + 0.08);
      if (!M.footHit && e > 0.97) { M.footHit = true; if (!M.reverse) sp.squash.kick(-0.5); }
      const l = smooth(0.80, 0.95, u);                   // then slides in under the body
      _b.x = lerp(_b.x, M.p1.x + lx * sd * 0.058, l); _b.z = lerp(_b.z, M.p1.z + lz * sd * 0.058, l);
      _b.y = lerp(_b.y, M.p1.y, l);
      kOut = lerp(kOut, 0.3, l); kUp = lerp(kUp, 0.3, l); tOut = lerp(tOut, 0.1, l);
    } else {                                             // the other steps up last
      const e = smooth(0.56, 0.86, u);
      kOut = lerp(kOut, 0.5, e); kUp = lerp(kUp, 0.8, smooth(0.0, 0.7, e)); tOut = lerp(tOut, 0.15, e);
      const l = smooth(0.84, 0.96, u); kOut = lerp(kOut, 0.25, l); kUp = lerp(kUp, 0.1, l);
      _t.set(M.p1.x + lx * sd * 0.058, LG.y, M.p1.z + lz * sd * 0.058);
      hookPath(_b, _t, e, LG.y + 0.10);
    }
    setFoot(f, _b.x, _b.y, _b.z, i === M.lead ? lerp(-0.3, 0, smooth(0.3, 0.6, u)) : -0.3, tOut, kOut, kUp);
  }
  char.pitch = M.pitch * Math.sin(Math.PI * clamp(u, 0, 1));
  char.hipY = -0.05;
  char.climbTwist = side * 1.1 * bump(u, 0.25, 0.9);
  char.look += ((u < 0.5 ? -0.3 : 0) - char.look) * (1 - Math.exp(-8 * dt));
  driveVelocity(dt, px, py, pz);

  if (raw >= 1) {
    if (M.reverse) enterHang(); else { leaveToFree(M.p1.x, M.p1.y, M.p1.z); sp.squash.kick(-0.6); }
  }
}

/* ---- hang -> crouch on top, from the Mixamo clip ------------------------------------------------
   The clip owns the body: the pelvis follows the clip's hips (root motion), the feet go where the clip's
   feet go (with the clip's knee directions), and the torso is retargeted by punch.js. The clip is anchored
   to the ledge with ONE fixed transform (no drifting), so the feet end on the ledge top.
   Hands: they stay gripped on the ledge (hand IK) while the clip's hands are still below the top. As soon
   as the clip's hands reach the ledge top, the clip's arms take over, but with their wrists placed in
   WORLD space by the same anchor as the body (not relative to our shoulders), so they stay on the ledge
   exactly where the animator put them until the clip lifts them off to push him up.
   A short stand-up from the crouch follows. */
const CC = { active: false, t: 0, phase: 0, s: 0, hx: 0, hz: 0, ox: 0, oz: 0, off: 0,
  hipY0: 0, fx: [0, 0], fy: [0, 0], fz: [0, 0], toe: [0, 0], rel: [false, false], armW: [0, 0],
  from: new THREE.Vector3(), footFrom: [new THREE.Vector3(), new THREE.Vector3()] };
const CLIP_ANKLE = 0.085;                    // ankle height the clip was baked with
const STAND_TIME = 0.30;
const BLEND_IN = 0.12;                       // hang pose -> clip pose
const ARM_BLEND = 0.15;
const GRIP_INSIDE = 0.04;                    // the wrist sits just inside the lip, fingers over the top
const _cj = new THREE.Vector3(), _cj2 = new THREE.Vector3(), _cj3 = new THREE.Vector3();

// clip space -> world; the clip faces +Z and the hero faces into the wall
function clipX(px, pz) { const dx = px - CC.hx, dz = pz - CC.hz; return CC.ox + dx * Math.cos(char.yaw) + dz * Math.sin(char.yaw); }
function clipZ(px, pz) { const dx = px - CC.hx, dz = pz - CC.hz; return CC.oz - dx * Math.sin(char.yaw) + dz * Math.cos(char.yaw); }
function clipY(y) { return y + CC.off; }
// wrist target for the clip's arms: the clip's hand, mapped into the world, then into the hero's model space
const _ct = new THREE.Vector3();
function climbArmTarget(side, out) {
  const j = clipJoint(side === 'L' ? 'LeftHand' : 'RightHand', _ct);
  const dx = clipX(j.x, j.z) - char.pos.x, dz = clipZ(j.x, j.z) - char.pos.z;
  const cy = Math.cos(char.yaw), sy = Math.sin(char.yaw);
  return out.set(dx * cy - dz * sy, clipY(j.y) - char.pos.y, dx * sy + dz * cy);
}

function startClimbClip() {
  setYaw(Math.atan2(-LG.nx, -LG.nz));
  driveMove('climb', CLIMB_FROM, 1);
  const hl = clipJoint('LeftHand', _cj), hr = clipJoint('RightHand', _cj2);
  CC.hx = (hl.x + hr.x) * 0.5; CC.hz = (hl.z + hr.z) * 0.5;
  // anchor: the clip's wrists on the lip (a hair inside it)
  CC.ox = ledgeX(LG.t) - LG.nx * GRIP_INSIDE; CC.oz = ledgeZ(LG.t) - LG.nz * GRIP_INSIDE;
  driveMove('climb', CLIMB_FROM + CLIMB_FRAMES, 1);
  const fl = clipJoint('LeftFoot', _cj), fr = clipJoint('RightFoot', _cj2);
  CC.off = LG.y - ((fl.y + fr.y) * 0.5 - CLIP_ANKLE);        // the feet finish on the ledge top
  CC.t = 0; CC.phase = 0; CC.s = 0; CC.active = true;
  CC.rel[0] = CC.rel[1] = false; CC.armW[0] = CC.armW[1] = 0;
  CC.from.copy(char.pos);                            // blend in from the hang pose
  feet.forEach((f, i) => CC.footFrom[i].copy(f.world));
  driveMove('climb', CLIMB_FROM, 1, CC.armW, climbArmTarget);
  char.mode = 'mantle'; char.grounded = false; char.jumpPhase = 'air';
  freezeLocomotion();
}

// feet + knee directions from the clip at the current driven frame
function clipFeet(hold) {
  for (let i = 0; i < 2; i++) {
    const f = feet[i], pre = i === 0 ? 'Left' : 'Right';
    if (!hold) {
      const foot = clipJoint(pre + 'Foot', _cj), toe = clipJoint(pre + 'ToeBase', _cj2);
      const h = Math.hypot(toe.x - foot.x, toe.z - foot.z);
      CC.toe[i] = Math.atan2(toe.y - foot.y, h) + 0.39;                  // flat foot is about -0.39 rad
      CC.fx[i] = clipX(foot.x, foot.z); CC.fz[i] = clipZ(foot.x, foot.z);
      CC.fy[i] = clipY(foot.y) - CLIP_ANKLE;
      const knee = clipJoint(pre + 'Leg', _cj2), hip = clipJoint(pre + 'UpLeg', _cj3);
      _cj.set(foot.x, foot.y, foot.z);
      if (!f.clipPole) f.clipPole = new THREE.Vector3();
      f.clipPole.copy(knee).addScaledVector(hip, -0.5).addScaledVector(_cj, -0.5).normalize();
    }
    const toeUp = clamp(CC.toe[i], -1, 1);
    if (!hold && CC.t < BLEND_IN) {                  // hang pose -> clip pose
      const b = smooth(0, BLEND_IN, CC.t), o = CC.footFrom[i];
      setFoot(f, lerp(o.x, CC.fx[i], b), lerp(o.y, CC.fy[i], b), lerp(o.z, CC.fz[i], b), toeUp, 0.2, 0.3, 0.1);
    } else setFoot(f, CC.fx[i], CC.fy[i], CC.fz[i], toeUp, 0.2, 0.3, 0.1);
  }
}

function endClimbClip() {
  CC.active = false;
  releaseDrive();
  for (const f of feet) f.clipPole = null;
}

function stepClimbClip(dt, input) {
  input.jumpQueued = false;
  freezeLocomotion();
  const px = char.pos.x, py = char.pos.y, pz = char.pos.z;
  setYaw(Math.atan2(-LG.nx, -LG.nz));

  if (CC.phase === 0) {
    CC.t += dt;
    const k = Math.min(CLIMB_FRAMES, CC.t * CLIMB_FPS), frame = CLIMB_FROM + k, p01 = k / CLIMB_FRAMES;
    driveMove('climb', frame, 1, CC.armW, climbArmTarget);
    const hips = clipJoint('Hips', _cj);
    char.pos.set(clipX(hips.x, hips.z), clipY(hips.y) - 0.98, clipZ(hips.x, hips.z));
    if (CC.t < BLEND_IN) char.pos.lerpVectors(CC.from, char.pos, smooth(0, BLEND_IN, CC.t));
    char.hipY = 0; char.pitch = 0; char.climbTwist = 0; char.look = 0;
    clipFeet(false);

    // Hands: gripped on the ledge until the clip lifts them off the top, or the arm runs out of reach.
    for (let i = 0; i < 2; i++) {
      const name = i === 0 ? 'L' : 'R';
      if (!CC.rel[i]) {
        const wr = clipJoint(i === 0 ? 'LeftHand' : 'RightHand', _cj2);
        if (clipY(wr.y) > LG.y - 0.08 || p01 > 0.5) CC.rel[i] = true;   // the clip's hand is on the ledge top
      }
      if (CC.rel[i]) CC.armW[i] = Math.min(1, CC.armW[i] + dt / ARM_BLEND);   // the clip's arm takes over...
      if (!CC.rel[i] || CC.armW[i] < 1) gripHand(name, i === 0 ? 0.26 : -0.26);  // ...while the grip still holds
      else releaseHand(name);
    }
    if (k >= CLIMB_FRAMES) {
      CC.phase = 1; CC.s = 0;
      handsOff();
      CC.hipY0 = char.pos.y - LG.y;                  // how far the pelvis sits below standing height
      sp.squash.kick(-0.35);
    }
  } else {
    // stand up out of the crouch on the ledge, feet where the clip left them
    CC.s += dt;
    handsOff();
    const u = clamp(CC.s / STAND_TIME, 0, 1), e = smooth(0, 1, u);
    driveMove('climb', CLIMB_FROM + CLIMB_FRAMES, 1 - e, null, climbArmTarget);
    const mx = (CC.fx[0] + CC.fx[1]) * 0.5, mz = (CC.fz[0] + CC.fz[1]) * 0.5;
    char.pos.x += (mx - char.pos.x) * 0.2;
    char.pos.z += (mz - char.pos.z) * 0.2;
    char.pos.y = LG.y;
    char.hipY = lerp(CC.hipY0, -CFG.crouchBase, e);
    char.pitch = 0;
    clipFeet(true);
    if (u >= 1) {
      endClimbClip();
      leaveToFree(char.pos.x, LG.y, char.pos.z);
      sp.squash.kick(-0.5);
      return;
    }
  }
  driveVelocity(dt, px, py, pz);
}

/* ---- stumble: being hit -------------------------------------------------------------------------------------
   Four hit-reaction clips (stumble.js) blended by the direction of the push. The blend drives everything: the hips'
   travel moves the hero for real (walls stop him), the feet follow the clip's feet with its knee directions (so
   nothing slides), and the torso, arms and head come from the same blend through the retarget in punch.js.
   He keeps facing the way he was; control comes back when the reaction ends, with his feet planted where they are. */
const JX = {};
JOINTS.forEach((n, i) => { JX[n] = i; });
const ST = {
  active: false, t: 0, dur: 1, uMax: 1, ox: 0, oz: 0, h0x: 0, h0z: 0, plan: null, hipYFrom: 0,
  ext: new Float32Array(NJ * 3), fx: [0, 0], fz: [0, 0], toe: [0, 0],
  footFrom: [new THREE.Vector3(), new THREE.Vector3()],
};
const _zeroVel = new THREE.Vector3(), _defaultPole = new THREE.Vector3();
const ST_BLEND_IN = 0.10;

/** Start a reaction. (wx, wz) is the world direction he is pushed; power 1 is a heavy hit, less is lighter. */
export function startStumble(wx, wz, power = 1) {
  if (char.mode !== 'free' || ST.active) return false;
  const l = Math.hypot(wx, wz) || 1;
  wx /= l; wz /= l;
  const lx = wx * facing.left.x + wz * facing.left.z, lz = wx * facing.fwd.x + wz * facing.fwd.z;
  ST.plan = planStumble(lx, lz);
  sampleStumble(ST.plan, 0, ST.ext);
  ST.h0x = ST.ext[HIPS * 3]; ST.h0z = ST.ext[HIPS * 3 + 2];
  ST.ox = char.pos.x; ST.oz = char.pos.z;
  ST.t = 0;
  ST.dur = ST.plan.seconds * (power < 0.8 ? 0.75 : 1);       // a lighter hit plays the first part of the clip only
  ST.uMax = power < 0.8 ? 0.7 : 1;
  ST.hipYFrom = char.hipY;
  feet.forEach((f, i) => ST.footFrom[i].copy(f.world));
  ST.active = true;
  char.mode = 'stumble'; char.grounded = true; char.jumpPhase = 'ground';
  freezeLocomotion();
  handsOff();
  sp.squash.kick(-0.9);
  return true;
}

function endStumble(fell) {
  ST.active = false;
  releaseDrive();
  for (let i = 0; i < 2; i++) {                              // plant the feet where the stance ended up
    const f = feet[i];
    f.clipPole = null;
    f.world.set(char.pos.x + facing.left.x * f.s * STEP_HALF, char.pos.y, char.pos.z + facing.left.z * f.s * STEP_HALF);   // where the tail walked them to
    f.plant.copy(f.world); f.lift.copy(f.world); f.land.copy(f.world);
    f.height = 0; f.toeUp = 0; f.stance = true; f.free = false; f.auto = false;
  }
  char.mode = 'free';
  char.vel.set(0, 0, 0); char.vy = 0; char.pitch = 0; char.crouch = 0;
  char.grounded = !fell; char.jumpPhase = fell ? 'air' : 'ground';
  char.catchCooldown = 0.2;
}

function stepStumble(dt, input) {
  input.jumpQueued = false;
  freezeLocomotion();
  ST.t += dt;
  const raw = clamp(ST.t / ST.dur, 0, 1), u = raw * ST.uMax;
  sampleStumble(ST.plan, u, ST.ext);
  const e = ST.ext, cy = Math.cos(char.yaw), sy = Math.sin(char.yaw);

  // root motion: the hips' travel since the start, turned into the world; walls push back (and move the origin
  // with him, so the feet stay attached to the body)
  const dx = e[HIPS * 3] - ST.h0x, dz = e[HIPS * 3 + 2] - ST.h0z;
  const wantX = ST.ox + dx * cy + dz * sy, wantZ = ST.oz - dx * sy + dz * cy;
  char.pos.x = wantX; char.pos.z = wantZ;
  _zeroVel.set(0, 0, 0);
  pushOut(char.pos, _zeroVel);
  ST.ox += char.pos.x - wantX; ST.oz += char.pos.z - wantZ;
  const gy = groundHeight(char.pos.x, char.pos.z, char.pos.y + 0.3);
  if (gy < char.pos.y - 0.4) { endStumble(true); return; }  // stumbled off an edge
  char.pos.y = gy;

  // pelvis height from the clip, eased in from where it was
  // The last part of the reaction walks him back into his normal stance (feet together under him, normal height),
  // so there is nothing to snap when control returns.
  const tail = smooth(raw, 0.68, 1);
  const hipY = lerp(e[HIPS * 3 + 1] - 0.98, -CFG.crouchBase, tail);
  char.hipY = lerp(ST.hipYFrom, hipY, smooth(0, ST_BLEND_IN, ST.t));
  char.pitch = 0; char.climbTwist = 0;

  // feet: the clip's feet in the world, with its knee directions
  for (let i = 0; i < 2; i++) {
    const f = feet[i], pre = i === 0 ? 'Left' : 'Right';
    const fi = JX[pre + 'Foot'] * 3, ti = JX[pre + 'ToeBase'] * 3, ki = JX[pre + 'Leg'] * 3, hi = JX[pre + 'UpLeg'] * 3;
    const fdx = e[fi] - ST.h0x, fdz = e[fi + 2] - ST.h0z;
    ST.fx[i] = ST.ox + fdx * cy + fdz * sy; ST.fz[i] = ST.oz - fdx * sy + fdz * cy;
    ST.toe[i] = Math.atan2(e[ti + 1] - e[fi + 1], Math.hypot(e[ti] - e[fi], e[ti + 2] - e[fi + 2])) + 0.39;
    const fy = char.pos.y + Math.max(0, e[fi + 1] - 0.085);
    if (!f.clipPole) f.clipPole = new THREE.Vector3();
    f.clipPole.set(e[ki] - (e[hi] + e[fi]) * 0.5, e[ki + 1] - (e[hi + 1] + e[fi + 1]) * 0.5, e[ki + 2] - (e[hi + 2] + e[fi + 2]) * 0.5).normalize();
    // the standing stance: both feet side by side under the hips
    const homeX = char.pos.x + facing.left.x * f.s * STEP_HALF, homeZ = char.pos.z + facing.left.z * f.s * STEP_HALF;
    let tx = lerp(ST.fx[i], homeX, tail), tz = lerp(ST.fz[i], homeZ, tail), ty = lerp(fy, char.pos.y, tail);
    let tUp = lerp(clamp(ST.toe[i], -1, 1), 0, tail);
    if (ST.t < ST_BLEND_IN) {                                // from where the foot was to the clip's foot
      const b = smooth(0, ST_BLEND_IN, ST.t), o = ST.footFrom[i];
      tx = lerp(o.x, tx, b); ty = lerp(o.y, ty, b); tz = lerp(o.z, tz, b);
    }
    setFoot(f, tx, ty, tz, tUp, 0.2, 0.3, 0.1);
    f.height = 0.06 * Math.sin(Math.PI * tail) * (tail > 0 && tail < 1 ? 1 : 0);   // a small step, not a slide
    f.clipPole.lerp(_defaultPole.set(f.s * 0.20, 0.06, 1), tail).normalize();       // and the normal knee direction
  }

  // torso, arms and head from the same blend; fades out over the end so control comes back smoothly
  driveMove('react', 0, smooth(0, 0.06, ST.t) * (1 - smooth(raw, 0.66, 1)), null, null, ST.ext);
  if (raw >= 1) endStumble(false);
}

/* ---- rope --------------------------------------------------------------------------- */
function attachRope(r) {
  let dx = char.pos.x - r.x, dz = char.pos.z - r.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) { dx = r.nx; dz = r.nz; } else { dx /= d; dz /= d; }
  RP.rope = r; RP.phase = 0;
  char.mode = 'rope'; char.grounded = false; char.jumpPhase = 'air';
  char.pos.x = r.x + dx * 0.32; char.pos.z = r.z + dz * 0.32;
  char.pos.y = Math.max(char.pos.y, groundHeight(char.pos.x, char.pos.z, char.pos.y + 0.1, 0.1));
  setYaw(Math.atan2(-dx, -dz));
  freezeLocomotion();
}
function stepRope(dt, input) {
  const r = RP.rope;
  freezeLocomotion();
  const bodyDx = char.pos.x - r.x, bodyDz = char.pos.z - r.z;
  const bl = Math.hypot(bodyDx, bodyDz) || 1;
  setYaw(Math.atan2(-bodyDx / bl, -bodyDz / bl));

  if (input.jumpQueued) {                              // leap away from the rope
    input.jumpQueued = false;
    handsOff();
    char.mode = 'free'; char.grounded = false; char.jumpPhase = 'air';
    char.vel.set(bodyDx / bl * 3.2, 0, bodyDz / bl * 3.2); char.vy = 3.8;
    char.catchCooldown = 0.5; char.pitch = 0;
    return;
  }
  let climb = 0;
  if (input.mag > 0.2) climb = input.y > 0.3 ? 1.5 : input.y < -0.3 ? -2.1 : 0;
  char.pos.y += climb * dt;
  RP.phase += climb * dt * 5.2;

  const ground = groundHeight(char.pos.x, char.pos.z, char.pos.y + 0.05, 0.05);
  if (char.pos.y <= ground && climb < 0) { leaveToFree(char.pos.x, ground, char.pos.z); return; }
  if (char.pos.y + 1.9 >= r.top - 0.02 && climb > 0) {  // reached the top: pull onto the roof
    LG.px = r.x; LG.pz = r.z - r.nz * 0.25; LG.y = r.top; LG.nx = r.nx; LG.nz = r.nz;
    LG.tx = 1; LG.tz = 0; LG.t = r.x; LG.t0 = r.x - 1; LG.t1 = r.x + 1; LG.depth = 4;
    M.p0.copy(char.pos); M.p1.copy(r.topOut);
    M.kind = 'mantle'; M.t = 0; M.reverse = false; M.dur = 0.9; M.handsOn = 0; M.handsOff = 0.85; M.pitch = 0.25;
    char.mode = 'mantle'; handsOff();
    return;
  }

  const lx = facing.left.x, lz = facing.left.z, fx = facing.fwd.x, fz = facing.fwd.z;
  const a = Math.sin(RP.phase), b = Math.sin(RP.phase + Math.PI);
  setHand('L', r.x + lx * 0.06, char.pos.y + 1.80 + 0.24 * a, r.z + lz * 0.06);
  setHand('R', r.x - lx * 0.06, char.pos.y + 1.80 + 0.24 * b, r.z - lz * 0.06);
  const sa = Math.sin(RP.phase + 1.6), sb = Math.sin(RP.phase + 1.6 + Math.PI);
  setFoot(feet[0], r.x + lx * 0.10 - fx * 0.0, char.pos.y + 0.26 + 0.14 * sa, r.z + lz * 0.10, -0.2, 0.5, 0.85, 0.5 + 0.4 * Math.max(0, sa));
  setFoot(feet[1], r.x - lx * 0.10 - fx * 0.0, char.pos.y + 0.26 + 0.14 * sb, r.z - lz * 0.10, -0.2, 0.5, 0.85, 0.5 + 0.4 * Math.max(0, sb));
  char.pitch = -0.05; char.hipY = -0.03;
}

/* ---- queries that start a move ---------------------------------------------------------- */
function nearestRope(maxDist) {
  let best = null, bd = maxDist;
  for (const r of level.ropes) {
    const d = Math.hypot(r.x - char.pos.x, r.z - char.pos.z);
    if (d < bd && char.pos.y + 1.6 > r.bottom && char.pos.y + 1.3 < r.top) { bd = d; best = r; }
  }
  return best;
}
function facingRope(r, minDot) {
  const dx = r.x - char.pos.x, dz = r.z - char.pos.z, d = Math.hypot(dx, dz) || 1;
  return (dx * facing.fwd.x + dz * facing.fwd.z) / d > minDot;
}

/** Called from the air every step: catch a ledge or a rope. */
export function airCheck() {
  if (char.catchCooldown > 0) return;
  const r = nearestRope(0.7);
  if (r && facingRope(r, 0.3) && char.vy < 5) { attachRope(r); return; }
  if (char.vy > 3.2) return;                          // still launching: too early to grab
  const led = findLedge(char.pos.x, char.pos.z, facing.fwd.x, facing.fwd.z,
                        char.pos.y + LEDGE_REACH[0], char.pos.y + LEDGE_REACH[1], 0.7, L);
  if (!led || led.depth < 0.5) return;
  takeLedge(led);
  hangPos(LG.t, _v);
  if (groundHeight(_v.x, _v.z, LG.y, 0.0) > _v.y + 0.05) return;   // feet would be inside the ground
  enterHang();
}

/** JUMP pressed on the ground: vault / mantle / rope instead of a plain jump. */
export function tryContext() {
  const r = nearestRope(0.9);
  if (r && facingRope(r, 0.5)) { attachRope(r); return true; }

  const led = findLedge(char.pos.x, char.pos.z, facing.fwd.x, facing.fwd.z,
                        char.pos.y + LOW_REACH[0], char.pos.y + LOW_REACH[1], 1.0, L);
  return led ? startLowMove(led) : false;
}

// vault a thin obstacle, mantle a thick one. Returns false if there is no room.
function startLowMove(led) {
  takeLedge(led);
  if (led.depth <= 1.1) {
    const d = led.depth + 0.75;
    const lx = ledgeX(LG.t) - LG.nx * d, lz = ledgeZ(LG.t) - LG.nz * d;
    const ly = groundHeight(lx, lz, LG.y, 0.02);
    if (blocked(lx, ly + 0.4, lz) || blocked(lx, ly + 1.4, lz)) return false;
    _v.set(lx, ly, lz);
    startClimb('vault', _v);
    return true;
  }
  _v.set(ledgeX(LG.t) - LG.nx * 0.45, LG.y, ledgeZ(LG.t) - LG.nz * 0.45);
  startClimb('mantle', _v);
  return true;
}

// take off for a ledge too high to climb from the ground; airCheck grabs it on the way up
function autoJump(dir) {
  const s = Math.max(char.speed, 2.6);
  char.grounded = false; char.jumpPhase = 'air'; char.vy = CFG.jumpVel * 1.03;
  char.autoJump = true; char.airT = 0; char.airRun = char.runBlend;
  char.airLead = Math.sin(char.gait) >= 0 ? 'L' : 'R';
  char.vel.set(dir.x * s, 0, dir.z * s);
  char.crouch = 0.5; sp.squash.kick(1.3);
}

// Running (or pushing) toward something climbable starts the right move by itself.
// How far ahead we look grows with speed; a slow approach has to hold for a moment.
let autoT = 0;
function autoMoves(dt, input, dir) {
  if (char.catchCooldown > 0 || input.mag < 0.4 || dir.lengthSq() < 0.5) { autoT = 0; return false; }
  const speed = char.speed, running = speed > 2.4;
  const reach = 0.45 + Math.min(speed, 5) * 0.16;
  let led = findLedge(char.pos.x, char.pos.z, dir.x, dir.z, char.pos.y + LOW_REACH[0], char.pos.y + LOW_REACH[1], reach, L);
  let high = false;
  if (!led) {
    led = findLedge(char.pos.x, char.pos.z, dir.x, dir.z, char.pos.y + HIGH_AUTO[0], char.pos.y + HIGH_AUTO[1], reach, L);
    if (led && led.depth < 0.5) led = null;
    high = !!led;
  }
  if (!led) { autoT = 0; return false; }
  autoT += dt;
  if (!running && autoT < 0.3) return false;
  autoT = 0;
  if (high) { takeLedge(led); autoJump(dir); return true; }
  return startLowMove(led);
}

/** Every step while standing: lower yourself over an edge, or walk into a rope. */
export function groundCheck(dt, input, dir) {
  // walking into a rope grabs it
  if (char.catchCooldown <= 0 && input.mag > 0.3) {
    const r = nearestRope(0.55);
    if (r && facingRope(r, 0.6)) { attachRope(r); return; }
  }
  if (autoMoves(dt, input, dir)) return;
  // creep toward a high edge to climb down over it (running off still just falls)
  if (input.mag > 0.12 && input.mag < 0.55 && char.catchCooldown <= 0) {
    const e = findEdgeBelow(dir.x, dir.z);
    if (e) {
      edgeTimer += dt;
      if (edgeTimer > 0.35) { edgeTimer = 0; takeLedge(e); startMantle(true); }
      return;
    }
  }
  edgeTimer = 0;
}

// the box we are standing on and the edge face we are creeping toward
const E = { px: 0, pz: 0, y: 0, nx: 0, nz: 0, tx: 0, tz: 0, t: 0, t0: 0, t1: 0, depth: 2 };
function findEdgeBelow(dx, dz) {
  const x = char.pos.x, z = char.pos.z, y = char.pos.y;
  for (const b of level.boxes) {
    if (Math.abs(b.y1 - y) > 0.06 || b.y1 < 2.0) continue;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    const faces = [[0, -1, b.z0, true], [0, 1, b.z1, true], [-1, 0, b.x0, false], [1, 0, b.x1, false]];
    for (const [nx, nz, plane, alongX] of faces) {
      if (dx * nx + dz * nz < 0.7) continue;
      const dist = nx !== 0 ? (plane - x) * nx : (plane - z) * nz;      // distance to the edge, standing on top
      if (dist < 0 || dist > 0.5) continue;
      const t = alongX ? x : z, lo = (alongX ? b.x0 : b.z0) + 0.2, hi = (alongX ? b.x1 : b.z1) - 0.2;
      if (t < lo || t > hi) continue;
      const hx = alongX ? t : plane + nx * HANG_OFF, hz = alongX ? plane + nz * HANG_OFF : t;
      if (blocked(hx, y - 1.0, hz)) continue;                           // something in the way below
      if (groundHeight(hx, hz, y, 0.0) > y - HANG_DROP + 0.05) continue; // not enough room to hang
      E.px = alongX ? t : plane; E.pz = alongX ? plane : t; E.y = b.y1;
      E.nx = nx; E.nz = nz; E.tx = alongX ? 1 : 0; E.tz = alongX ? 0 : 1;
      E.t = t; E.t0 = lo; E.t1 = hi; E.depth = 2;
      return E;
    }
  }
  return null;
}

/* ---- dispatch ---------------------------------------------------------------------------- */
export function step(dt, input, camRight, camFwd) {
  switch (char.mode) {
    case 'hang':   stepHang(dt, input, camRight, camFwd); break;
    case 'stumble': stepStumble(dt, input); break;
    case 'mantle': if (CC.active) stepClimbClip(dt, input); else stepMantle(dt, input); break;
    case 'climb':  stepClimb(dt, input); break;
    case 'rope':   stepRope(dt, input); break;
    default: break;
  }
}
