// Small math helpers shared by everything. No dependencies, no allocation.

export const TAU = Math.PI * 2;

export const clamp  = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp   = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const shortAngle = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

// 1-D spring-damper. Underdamped on purpose: d < 2*sqrt(k) gives the overshoot
// that reads as "squishy".
export class Spring {
  constructor(x = 0) { this.x = x; this.v = 0; }
  step(target, k, d, dt) {
    this.v += ((target - this.x) * k - this.v * d) * dt;
    this.x += this.v * dt;
  }
  kick(dv) { this.v += dv; }
}
