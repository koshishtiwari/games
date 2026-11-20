// Souls-like reactive ground fog.
//
// Four spectral layers of swirling graveyard mist hang just above the flagstones
// in WORLD space. It reacts dynamically to both the player AND every enemy:
//   * Live velocity wakes & rotational curl vortices around moving actors (hero
//     and templars), parting the mist and curling it around their legs.
//   * Persistent footstep / movement wake trails from both the hero and enemies
//     as they patrol, chase, lunge, or get knocked back.
//   * Explosive radial shockwave rings (`pulse`) when the hero lands a ground
//     slam or an enemy is blasted / crashes down onto the ground, complete with
//     a dense compressed fog crest at the expanding shockwave rim.

import * as THREE from 'three';

const TRAIL = 36;                 // trail points kept (hero + enemies + pulses)
const ACTORS = 8;                 // live actors (0 = hero, 1..7 = templars)
const LIFE = 4.2;                 // seconds a footstep keeps the fog parted

const vert = /* glsl */`
  varying vec2 vXZ;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */`
  precision highp float;
  varying vec2 vXZ;
  uniform float uTime;
  uniform vec3  uHero;
  uniform vec4  uActors[${ACTORS}];   // x, z, vx, vz (live positions & velocities of hero + enemies)
  uniform vec4  uTrail[${TRAIL}];     // x, z, signed strength (+normal wake, -shockwave ring), radius
  uniform vec3  uColor;
  uniform vec3  uHighlight;
  uniform float uAlpha;
  uniform float uScale;
  uniform vec2  uDrift;
  uniform float uSeed;
  uniform float uLayerH;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec2 p = vXZ;
    vec2 push = vec2(0.0);
    float clear = 0.0;
    float crest = 0.0;

    // 1. Footprints, enemy wakes, and shockwave pulses
    for (int i = 0; i < ${TRAIL}; i++) {
      vec4 t = uTrail[i];
      float str = abs(t.z);
      if (str <= 0.001) continue;
      vec2 d = p - t.xy;
      float r2 = dot(d, d);
      float rad2 = t.w * t.w;
      if (r2 > rad2 * 4.5) continue;
      float k = str * exp(-r2 / rad2);
      float dist = sqrt(r2) + 0.25;
      vec2 dir = d / dist;
      // Tangential swirl component so disturbed fog curls organically
      vec2 perp = vec2(-dir.y, dir.x) * ((mod(float(i), 2.0) * 2.0 - 1.0) * 0.38);
      push += (dir + perp) * (k * 1.15);
      clear = max(clear, k);

      // Negative t.z marks an explosive pulse (slam / knockdown): build a dense ring crest at its outer edge
      if (t.z < 0.0) {
        float ring = exp(-pow((dist - t.w * 0.85) / (t.w * 0.28), 2.0)) * str;
        crest = max(crest, ring * 0.85);
      }
    }

    // 2. Live actors (Hero + Enemies): immediate body clearing + velocity bow-wave & vortex curl
    for (int i = 0; i < ${ACTORS}; i++) {
      vec4 a = uActors[i];
      if (a.x > 9000.0) continue;
      vec2 d = p - a.xy;
      float r2 = dot(d, d);
      if (r2 > 18.0) continue;
      float baseR2 = (i == 0) ? 2.6 : 1.9;
      float k = exp(-r2 / baseR2);
      float dist = sqrt(r2) + 0.22;
      vec2 dir = d / dist;
      vec2 vel = a.zw;
      float spd = length(vel);

      // Part the fog around the character's legs/body
      clear = max(clear, k * ((i == 0) ? 0.90 : 0.82));

      // Shove fog radially outward + drag along movement vector + twin vortex swirl behind them
      vec2 vDir = spd > 0.05 ? vel / spd : vec2(0.0);
      float side = dot(dir, vec2(-vDir.y, vDir.x));
      vec2 swirl = vec2(-dir.y, dir.x) * side * min(spd * 0.45, 1.8);
      push += (dir * (0.75 + spd * 0.18) + vDir * min(spd * 0.22, 1.1) + swirl) * k;

      // Subtle bunched fog rim pushed up just ahead/around a fast-moving character
      float bow = exp(-pow((dist - 1.25) / 0.48, 2.0)) * min(spd * 0.22, 0.65);
      crest = max(crest, bow);
    }

    // Advect and domain-warp the dual-octave FBM noise field
    vec2 q = (p + push * 2.15) * uScale + uDrift * uTime + uSeed;
    vec2 warp = vec2(
      vnoise(q * 0.72 + uTime * 0.035),
      vnoise(q * 0.72 - 11.0 + uTime * 0.028)
    ) - 0.5;
    float n = fbm(q + warp * 1.75);

    // Billowing wisps with boosted density along shockwave/bow-wave crests
    float dens = smoothstep(0.20, 0.68, n + crest * 0.36);
    dens = clamp(dens * (1.0 - clear * 0.90) + crest * 0.52 * n, 0.0, 1.0);

    // Subtle moonlit highlight on thicker fog tops and swirling wake crests
    float highlightMix = smoothstep(0.42, 0.80, n) * 0.50 + crest * 0.65;
    vec3 col = mix(uColor, uHighlight, clamp(highlightMix, 0.0, 1.0));

    float distHero = length(p - uHero.xz);
    float fade = 1.0 - smoothstep(28.0, 52.0, distHero);
    float a = dens * uAlpha * fade;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export function createGroundFog(scene) {
  const trail = Array.from({ length: TRAIL }, () => ({ x: 0, z: 0, age: 99, r: 1, life: LIFE, grow: 1, sign: 1 }));
  const uTrail = Array.from({ length: TRAIL }, () => new THREE.Vector4(0, 0, 0, 1));
  const uActors = Array.from({ length: ACTORS }, () => new THREE.Vector4(9999, 9999, 0, 0));
  const uHero = new THREE.Vector3();
  const uTime = { value: 0 };

  // Four thick, dense layered sheets of Souls-like graveyard mist
  const layers = [
    { y: 0.08, alpha: 0.78, scale: 0.082, drift: [ 0.022,  0.011], seed:  0.0, color: 0x3b2c38, hi: 0x9c8296 },
    { y: 0.36, alpha: 0.62, scale: 0.064, drift: [-0.016,  0.019], seed: 37.0, color: 0x332532, hi: 0x8a7086 },
    { y: 0.72, alpha: 0.44, scale: 0.050, drift: [ 0.012, -0.014], seed: 79.0, color: 0x2b1f2b, hi: 0x765e73 },
    { y: 1.15, alpha: 0.28, scale: 0.040, drift: [-0.009, -0.011], seed: 123.0, color: 0x241925, hi: 0x644e62 },
  ];

  const geo = new THREE.PlaneGeometry(108, 108);
  geo.rotateX(-Math.PI / 2);
  const group = new THREE.Group();
  for (const L of layers) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime,
        uHero: { value: uHero },
        uActors: { value: uActors },
        uTrail: { value: uTrail },
        uColor: { value: new THREE.Color(L.color) },
        uHighlight: { value: new THREE.Color(L.hi) },
        uAlpha: { value: L.alpha },
        uScale: { value: L.scale },
        uDrift: { value: new THREE.Vector2(...L.drift) },
        uSeed: { value: L.seed },
        uLayerH: { value: L.y },
      },
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = L.y;
    m.frustumCulled = false;
    m.renderOrder = 5;
    group.add(m);
  }
  scene.add(group);

  let head = 0;
  let heroSince = 99, heroLastX = 1e9, heroLastZ = 1e9;
  const enemyTrack = new WeakMap();

  const add = (x, z, r, grow, life, sign = 1) => {
    const t = trail[head];
    head = (head + 1) % TRAIL;
    t.x = x; t.z = z; t.age = 0; t.r = r; t.grow = grow; t.life = life; t.sign = sign;
  };

  return {
    group,
    // Blast a ring of fog outward with a compressed outer mist crest (ground slam, heavy impact)
    pulse(x, z, radius = 4) {
      add(x, z, radius * 0.55, 2.5, 1.75, -1);
    },
    update(dt, hero, time, knights = null, heroVel = null) {
      uTime.value = time;
      const hx = hero.x, hy = hero.y || 0, hz = hero.z;
      uHero.set(hx, hy, hz);

      // Keep the layers centred under the hero, snapped to 4m so the quad edge never shimmers
      group.position.x = Math.round(hx / 4) * 4;
      group.position.z = Math.round(hz / 4) * 4;

      // Live actor 0: the hero (only parts ground fog when near the floor)
      const hvx = heroVel ? heroVel.x : (hx - heroLastX) / Math.max(dt, 0.001);
      const hvz = heroVel ? heroVel.z : (hz - heroLastZ) / Math.max(dt, 0.001);
      if (hy < 2.2) {
        uActors[0].set(hx, hz, Math.abs(hvx) < 30 ? hvx : 0, Math.abs(hvz) < 30 ? hvz : 0);
      } else {
        uActors[0].set(9999, 9999, 0, 0);
      }

      // Hero movement wake trail (one point every ~0.55m of travel near ground)
      heroSince += dt;
      const heroStepDist = Math.hypot(hx - heroLastX, hz - heroLastZ);
      if (hy < 1.8 && (heroStepDist > 0.55 || (heroSince > 1.1 && heroStepDist > 0.12))) {
        const spd = Math.min(6.0, heroStepDist / Math.max(heroSince, 0.016));
        add(hx, hz, 1.15 + spd * 0.08, 0.55 + spd * 0.06, LIFE, 1);
        heroLastX = hx; heroLastZ = hz; heroSince = 0;
      } else if (heroLastX > 1e8) {
        heroLastX = hx; heroLastZ = hz; heroSince = 0;
      }

      // Live actors 1..7 & enemy wakes: Templars (patrolling, chasing, lunging, or knocked down)
      let actorIdx = 1;
      if (knights) {
        for (let i = 0; i < knights.length; i++) {
          const k = knights[i];
          const kx = k.pos.x, ky = k.pos.y || 0, kz = k.pos.z;
          let st = enemyTrack.get(k);
          if (!st) {
            st = { x: kx, z: kz, since: Math.random() * 0.5, wasDown: false, wasAtk: false };
            enemyTrack.set(k, st);
          }

          const dStep = Math.hypot(kx - st.x, kz - st.z);
          st.since += dt;
          const kvx = k.vel ? k.vel.x : (kx - st.x) / Math.max(dt, 0.001);
          const kvz = k.vel ? k.vel.z : (kz - st.z) / Math.max(dt, 0.001);

          // Populate live actor slot if within fog range and near ground level
          if (actorIdx < ACTORS && ky < 2.2 && Math.hypot(kx - hx, kz - hz) < 46) {
            uActors[actorIdx++].set(kx, kz, kvx, kvz);
          }

          // When an enemy is knocked down or slams into the ground, trigger a radial fog burst!
          const isDown = k.down > 0;
          if (isDown && !st.wasDown && ky < 1.8) {
            add(kx, kz, 1.85, 2.1, 1.6, -1);
          }
          st.wasDown = isDown;

          // When an enemy initiates a sword lunge/slash, kick a sharp swirl of fog
          const isAtk = k.state === 'attack';
          if (isAtk && !st.wasAtk && ky < 1.8) {
            add(kx, kz, 1.45, 1.35, 2.2, -1);
          }
          st.wasAtk = isAtk;

          // Regular footstep/movement wake trail for each moving enemy
          if (ky < 1.8 && dStep > 0.55) {
            const kSpd = Math.min(6.0, dStep / Math.max(st.since, 0.016));
            add(kx, kz, 1.05 + kSpd * 0.07, 0.50 + kSpd * 0.05, LIFE * 0.85, 1);
            st.x = kx; st.z = kz; st.since = 0;
          }
        }
      }
      while (actorIdx < ACTORS) {
        uActors[actorIdx++].set(9999, 9999, 0, 0);
      }

      // Advance trail points
      for (let i = 0; i < TRAIL; i++) {
        const t = trail[i], u = uTrail[i];
        t.age += dt;
        const k = Math.max(0, 1 - t.age / t.life);
        u.set(t.x, t.z, (k * k) * t.sign, t.r + t.age * t.grow * 2.0);
      }
    },
  };
}
