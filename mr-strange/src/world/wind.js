// The wind: one analytic field that everything samples (cape, body lean, streak
// particles, HUD). Nothing here allocates and nothing is simulated on a grid, so
// asking for the wind at a point costs a handful of sines.
//
//   speed(x, z, t)  = base * gustFactor(t - along/GUST_FRONT)   gusts SWEEP across
//                                                               the world downwind
//   vector(p, t)    = dir * speed + turbulence(p, t)            two octaves, the fine
//                                                               one is what makes cloth ripple
//
// All times are seconds, all speeds m/s.

export const WIND_LEVELS = [
  { name: 'Calm',   speed: 1.8,  gust: 0.35, turb: 0.20 },
  { name: 'Breeze', speed: 5.5,  gust: 0.50, turb: 0.20 },
  { name: 'Gale',   speed: 11.0, gust: 0.65, turb: 0.22 },
  { name: 'Storm',  speed: 17.0, gust: 0.75, turb: 0.26 },
];

const GUST_FRONT = 7.0;    // m/s: how fast a gust front travels downwind

export const wind = {
  level: 2,                // index into WIND_LEVELS (Gale by default: strong)
  t: 0,
  // smoothed so switching level eases in over about a second
  base: WIND_LEVELS[2].speed, gust: WIND_LEVELS[2].gust, turb: WIND_LEVELS[2].turb,
  angle: 0.9,              // radians, direction the wind blows TOWARD (atan2(x, z))
  dx: 0, dz: 1,            // unit direction, refreshed by update()
  speed: 0,                // current mean speed at the origin, for HUD / fx
  gustLevel: 0,            // 0..1, how gusty it is right now at the origin
  offset: { x: 0, z: 0 },  // integrated air displacement, drives the streak fx

  setLevel(i) { this.level = ((i % WIND_LEVELS.length) + WIND_LEVELS.length) % WIND_LEVELS.length; },
  cycle() { this.setLevel(this.level + 1); },
  get levelName() { return WIND_LEVELS[this.level].name; },

  update(dt) {
    this.t += dt;
    const L = WIND_LEVELS[this.level];
    const k = 1 - Math.exp(-1.2 * dt);
    this.base += (L.speed - this.base) * k;
    this.gust += (L.gust  - this.gust) * k;
    this.turb += (L.turb  - this.turb) * k;

    // direction wanders slowly, like a real prevailing wind
    const t = this.t;
    this.angle = 0.9 + 0.38 * Math.sin(t * 0.071) + 0.21 * Math.sin(t * 0.19 + 1.0);
    this.dx = Math.sin(this.angle); this.dz = Math.cos(this.angle);

    this.speed = this._mean(0, 0);
    this.gustLevel = this.base > 0.01 ? Math.min(1, Math.max(0, (this.speed / this.base - 0.5) / 1.1)) : 0;
    this.offset.x += this.dx * this.speed * dt;
    this.offset.z += this.dz * this.speed * dt;
  },

  // gust factor in roughly [0.45 .. 1.9]: long lulls, short hard gusts
  _gust(tau) {
    const s = 0.40 * Math.sin(tau * 0.83 + 0.3) * Math.sin(tau * 0.37)
            + 0.34 * Math.sin(tau * 1.91 + 1.0)
            + 0.26 * Math.sin(tau * 3.40 + 2.2) * Math.sin(tau * 0.61 + 0.7);   // -1..1
    const peak = s > 0 ? s : s * 0.35;                                         // sharpen the gusts
    return 1 + this.gust * (peak * 1.35 + (peak > 0.5 ? (peak - 0.5) * 1.2 : 0));
  },

  _mean(x, z) {
    const along = x * this.dx + z * this.dz;
    return this.base * this._gust(this.t - along / GUST_FRONT);
  },

  /** Mean wind only (no turbulence): cheap, smooth, for body lean / HUD. */
  sampleMean(x, z, out) {
    const m = this._mean(x, z);
    out.x = this.dx * m; out.y = 0; out.z = this.dz * m;
    return out;
  },

  /** Full wind with turbulence at a point. `out` is any {x,y,z}. */
  sample(x, y, z, out) {
    const t = this.t;
    const m = this._mean(x, z);
    const T = this.turb * m;
    // coarse eddies (~2 m) and fine flutter (~0.7 m)
    const ax = Math.sin(x * 2.9 + y * 1.7 + t * 4.6) * Math.cos(z * 2.3 - t * 3.1);
    const az = Math.sin(z * 3.3 - y * 1.3 + t * 4.0) * Math.cos(x * 2.1 + t * 3.7);
    const ay = Math.sin(y * 3.1 + x * 1.9 - t * 5.2) * 0.55;
    const fx = Math.sin(x * 8.7 + y * 6.1 + t * 12.3) * Math.sin(z * 7.9 - t * 9.1);
    const fz = Math.sin(z * 9.3 - y * 5.7 + t * 11.1) * Math.sin(x * 8.1 + t * 10.4);
    const fy = Math.sin(y * 8.3 + z * 6.7 - t * 13.7) * 0.6;
    out.x = this.dx * m + (ax + fx * 0.65) * T;
    out.y =                (ay + fy * 0.65) * T;
    out.z = this.dz * m + (az + fz * 0.65) * T;
    return out;
  },
};
