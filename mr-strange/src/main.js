// Mr. Strange: entry point. Wires the modules together and runs the loop.
//
//   world/     renderer, lights, ground, wind field + wind streaks
//   character/ rig (skeleton + IK), body (SDF skin), avatar (look), cape (cloth), motion
//   input.js   joystick / jump / keyboard        camera.js   chase camera
//   hud.js     fps + wind readout

import { CFG } from './config.js';
import { createWorld } from './world/world.js';
import { wind } from './world/wind.js';
import { createWindFx } from './world/windfx.js';
import { model } from './character/rig.js';
import { buildForest } from './world/forest.js';
import { createTemplars } from './world/templar.js';
import { createAvatar } from './character/avatar.js';
import { createCape } from './character/cape.js';
import { createBat } from './character/bat.js';
import { sp, char as hero, setYaw } from './character/state.js';
import { startPunch, startSlam, updatePunch, punch, fistWorld } from './character/punch.js';
import { createShockwave } from './world/shockwave.js';
import { setBatRoot } from './world/arrows.js';
import { shortAngle } from './math.js';
import * as THREE from 'three';
import { char, feet, stepSim, poseCharacter } from './character/motion.js';
import { input, readKeyboard, dismissHint } from './input.js';
import { camFwd, camRight, updateCameraBasis, snapCamera, updateCamera, kickCamera } from './camera.js';
import { updateHud } from './hud.js';

const { renderer, scene, camera, followLight, trackFrame } = createWorld(document.getElementById('gl'));

scene.add(model);
const forest = buildForest(scene);
const avatar = createAvatar(scene);
const cape = createCape(scene);
const bat = createBat(scene);
const templars = createTemplars(scene);
setBatRoot(bat.root);              // arrows that hit the bat are anchored to its body
const windFx = createWindFx(scene);
const shockwave = createShockwave(scene);
const batBtn = document.getElementById('bat');

// seed everything so frame 0 is already correct
updateCameraBasis(camera);
poseCharacter(0);
cape.reset();
snapCamera(camera);
followLight(char.pos);

// handy from the console while tuning: mrStrange.wind.setLevel(3)
window.mrStrange = { wind, cape, char, templars, punch, renderer, scene, camera, timeScale: 1, closeup: null };   // closeup: {yaw, dist, y, ty} orbit camera for model tuning   // timeScale: slow-mo for tuning

const fist = new THREE.Vector3(), prevFist = new THREE.Vector3();
const viewFrustum = new THREE.Frustum(), viewMatrix = new THREE.Matrix4();
let punchTarget = null, wasInWindow = false;
let last = performance.now(), acc = 0;
document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); acc = 0; } });

function frame(now) {
  requestAnimationFrame(frame);

  let dt = (now - last) / 1000;
  last = now;
  trackFrame(dt);
  if (!(dt > 0)) dt = 0;
  if (dt > 0.25) dt = 0.25;                 // tab was backgrounded / big hitch
  dt *= window.mrStrange.timeScale;

  readKeyboard();
  updateCameraBasis(camera);

  if (char.forceUnmorph) {                  // knocked out of bat form (hard wall hit, or three arrows)
    char.forceUnmorph = false;
    if (char.isBat) input.morphQueued = true;
  }
  if (input.morphQueued) {
    input.morphQueued = false;
    char.arrowHits = 0;
    char.isBat = !char.isBat;
    bat.spawnMorphBurst(char.pos);
    if (batBtn) batBtn.classList.toggle('active', char.isBat);
    if (char.isBat) {
      char.pos.y += 0.25;
      char.vy = Math.max(char.vy, 2.5);
    } else {
      char.morph = 0;
      char.grounded = false;
      char.jumpPhase = 'air';
      char.vy = Math.max(char.vy, 1.0);
      for (const f of feet) {
        f.world.copy(char.pos); f.plant.copy(char.pos); f.lift.copy(char.pos); f.land.copy(char.pos);
        f.height = 0; f.free = false; f.auto = false;
      }
      poseCharacter(0);
      cape.reset();
    }
  }

  if (input.punchQueued) {
    input.punchQueued = false;
    if (startPunch()) punchTarget = templars.nearestKnight(hero.pos, 3.4);
  }
  if (input.slamQueued) {
    input.slamQueued = false;
    if (startSlam()) punchTarget = templars.nearestKnight(hero.pos, 4.5);
  }
  updatePunch(dt);
  const stickMag = input.mag;
  if (punch.active) input.mag *= punch.moveScale;   // planted while swinging: a slow shuffle, not a run

  acc += dt;
  let steps = 0;
  while (acc >= CFG.fixedStep && steps < CFG.maxSubSteps) {
    stepSim(CFG.fixedStep, input, camRight, camFwd, templars.resolvePlayer);
    acc -= CFG.fixedStep;
    steps++;
  }
  input.mag = stickMag;
  if (punch.active) {                        // aim assist: turn the fist toward the nearest knight
    if (!punchTarget || punchTarget.down > 0) punchTarget = templars.nearestKnight(hero.pos, 3.4);
    if (punchTarget) {
      const want = Math.atan2(punchTarget.pos.x - hero.pos.x, punchTarget.pos.z - hero.pos.z);
      setYaw(hero.yaw + shortAngle(want - hero.yaw) * (1 - Math.exp(-16 * dt)));
    }
  }
  if (steps === CFG.maxSubSteps) acc = 0;   // give up on catching all the way up

  if (char.justUnmorphed) {
    char.justUnmorphed = false;
    bat.spawnMorphBurst(char.pos);
    if (batBtn) batBtn.classList.remove('active');
    poseCharacter(0);
    cape.reset();
  }

  wind.update(dt);
  const manVis = char.morph < 0.55;
  avatar.shell.visible = manVis;
  model.visible = manVis;
  cape.mesh.visible = manVis;
  if (manVis) {
    poseCharacter(dt);
    cape.update(dt);
    if (punch.inHitWindow) {                 // the fist's path this frame against the knights
      fistWorld(fist);
      if (!wasInWindow) prevFist.copy(fist);
      if (templars.hitByPlayer(prevFist, fist, punch.swing, hero) > 0) sp.squash.kick(-0.9);
      prevFist.copy(fist);
    }
    wasInWindow = punch.inHitWindow;
    if (punch.impact) {                      // the slam lands: shockwave out from the fist
      punch.impact = false;
      fistWorld(fist);
      const radius = 3.6;
      shockwave.spawn(fist.x, hero.pos.y, fist.z, radius);
      templars.blast(fist.x, hero.pos.y, fist.z, radius, hero);
      kickCamera(0.075);
      sp.squash.kick(-1.4);
    }
  }
  shockwave.update(dt);
  bat.update(dt, char, char.batBank, char.batPitch);
  camera.updateMatrixWorld();
  viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse.copy(camera.matrixWorld).invert());
  viewFrustum.setFromProjectionMatrix(viewMatrix);
  templars.update(dt, char, sp, viewFrustum);
  updateCamera(camera, dt);
  const cu = window.mrStrange.closeup;
  if (cu) {
    camera.position.set(char.pos.x + Math.sin(cu.yaw) * cu.dist, char.pos.y + cu.y, char.pos.z + Math.cos(cu.yaw) * cu.dist);
    camera.lookAt(char.pos.x, char.pos.y + cu.ty, char.pos.z);
  }
  followLight(char.pos);
  windFx.update(char.pos);
  forest.update(char.pos, now / 1000);

  renderer.render(scene, camera);
  updateHud(dt);
}
requestAnimationFrame(frame);

// Tidy up the hint on its own if nobody touches anything.
setTimeout(dismissHint, 9000);
