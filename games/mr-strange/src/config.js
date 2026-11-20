// Gameplay / animation tunables for the hero. Cape and wind have their own
// config next to the code that uses them (character/cape.js, world/wind.js).

export const CFG = {
  // --- locomotion ---
  walkSpeed:      1.45,   // m/s reached at ~55% joystick deflection
  runSpeed:       4.60,   // m/s at full deflection
  accel:          14.0,   // m/s^2 ground acceleration
  decel:          18.0,   // m/s^2 ground braking
  airControl:     0.55,   // fraction of accel usable in the air
  turnRate:       10.0,   // 1/s, exponential easing of facing toward heading
  // --- gait ---
  stepHeightWalk: 0.090,  // m foot clearance
  stepHeightRun:  0.260,
  dutyWalk:       0.62,   // fraction of cycle a foot is planted (>0.5 = overlap)
  dutyRun:        0.38,   // <0.5 = flight phase
  hipBobWalk:     0.026,  // m vertical travel of the pelvis per step
  hipBobRun:      0.078,
  // --- jump ---
  jumpVel:        6.60,   // m/s launch (about 1.2 m when held, from standing)
  gravityUp:     -18.0,   // m/s^2 while rising with the button held
  gravityFall:   -34.0,   // m/s^2 on the way down: snappy, not floaty
  jumpCut:        2.6,    // gravity multiplier if the button is released while rising (short hop)
  coyote:         0.12,   // s after leaving an edge that a jump still works
  jumpBuffer:     0.14,   // s a press is remembered before landing
  runBoost:       1.22,   // horizontal speed multiplier at take-off when running
  maxJumpSpeed:   5.90,   // m/s cap on that
  airDrag:        1.2,    // m/s^2 horizontal braking in the air with no input
  // --- body style ---
  leanRun:        0.16,   // rad forward lean at full run
  leanTurn:       0.42,   // rad bank into a turn (per rad/s of yaw rate)
  pelvisTwist:    0.15,   // rad hip counter-rotation amplitude
  chestTwist:     0.24,   // rad shoulder counter-rotation amplitude
  armSwing:       0.88,   // rad shoulder swing amplitude at run
  elbowBend:      0.72,   // rad extra elbow flex at run
  headLook:       0.55,   // how much the head leads the movement direction
  // --- secondary motion (spring stiffness k, damping d) ---
  sqK: 190, sqD: 23.0,        // body squash & stretch
  headK: 150, headD: 17.0,    // head bobble
  bodyK: 200, bodyD: 21.0,    // torso lag vs. acceleration
  limbK: 270, limbD: 25.0,    // arm / leg overshoot
  jiggleGain:  0.0062,        // rad of secondary rotation per m/s^2 of acceleration
  jiggleShift: 0.0011,        // m of torso lag per m/s^2 of acceleration
  landImpulse: 0.230,         // squash kick per m/s of impact speed
  crouchBase:  0.040,         // m the pelvis sits below full leg extension at rest
  // --- idle ---
  breatheRate: 0.30, breatheAmp: 0.016,
  // --- wind acting on the body ---
  windLean:    0.0100,        // rad of lean per m/s of head/tail wind
  windBank:    0.0055,        // rad of bank per m/s of cross wind
  // --- camera ---
  camDist: 3.70, camHeight: 1.38, camLag: 6.0, camLookLag: 9.0, camFov: 52,
  camMinY: 0.45,
  // --- perf ---
  pixelRatioCap: 2, shadowMapSize: 1024, fixedStep: 1 / 120, maxSubSteps: 6,
};
