// Collision and ledge queries against level.boxes. The character is a vertical
// capsule (radius R) whose origin is its feet. Everything is allocation-free:
// results are written into module-level scratch objects.

import { level } from './level.js';

export const R = 0.28;          // body radius
export const STEP = 0.46;       // tallest thing you walk straight up
export const HEIGHT = 1.75;     // body height for overhead tests
const boxes = level.boxes;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Highest walkable surface under (x,z) that is at most `up` above yRef. */
export function groundHeight(x, z, yRef, up = STEP) {
  let g = 0;
  const r = 0.12;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.y1 > yRef + up || b.y1 <= g) continue;
    if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) g = b.y1;
  }
  return g;
}

/** Lowest underside above the head within the footprint (Infinity if none). */
export function ceilingHeight(x, z, yHead) {
  let c = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.y0 < yHead - 0.02 || b.y0 >= c) continue;
    if (x > b.x0 - R * 0.6 && x < b.x1 + R * 0.6 && z > b.z0 - R * 0.6 && z < b.z1 + R * 0.6) c = b.y0;
  }
  return c;
}

export function blocked(x, y, z) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return true;
  }
  return false;
}

/** Push the capsule out of walls; cancels the velocity component into them. */
export function pushOut(pos, vel, radius = R, height = HEIGHT) {
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.y1 <= pos.y + STEP || b.y0 >= pos.y + height) continue;
      const cx = clamp(pos.x, b.x0, b.x1), cz = clamp(pos.z, b.z0, b.z1);
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      let nx, nz;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d;
        pos.x += nx * (radius - d); pos.z += nz * (radius - d);
      } else {                                         // centre inside the box: shortest way out
        const l = pos.x - b.x0, r = b.x1 - pos.x, f = pos.z - b.z0, k = b.z1 - pos.z;
        const m = Math.min(l, r, f, k);
        nx = 0; nz = 0;
        if (m === l) { nx = -1; pos.x = b.x0 - radius; }
        else if (m === r) { nx = 1; pos.x = b.x1 + radius; }
        else if (m === f) { nz = -1; pos.z = b.z0 - radius; }
        else { nz = 1; pos.z = b.z1 + radius; }
      }
      if (vel) { const vn = vel.x * nx + vel.z * nz; if (vn < 0) { vel.x -= nx * vn; vel.z -= nz * vn; } }
      any = true;
    }
    if (!any) break;
  }
}

// Horizontal clearance between two vertical capsules at their current heights.
export function capsuleOverlap(pos, radius, height, other, otherRadius, otherHeight) {
  const gap = Math.max(
    0,
    other.y + otherRadius - (pos.y + height - radius),
    pos.y + radius - (other.y + otherHeight - otherRadius),
  );
  const dx = pos.x - other.x, dz = pos.z - other.z;
  return (radius + otherRadius) ** 2 - gap * gap - dx * dx - dz * dz;
}

export function separateCapsule(pos, vel, radius, height, other, otherRadius, otherHeight, fallbackX = 1) {
  const overlap = capsuleOverlap(pos, radius, height, other, otherRadius, otherHeight);
  if (overlap <= 1e-8) return false;
  const dx = pos.x - other.x, dz = pos.z - other.z;
  const distanceSq = dx * dx + dz * dz;
  const distance = Math.sqrt(distanceSq);
  const nx = distance > 1e-6 ? dx / distance : fallbackX;
  const nz = distance > 1e-6 ? dz / distance : 0;
  const correction = Math.sqrt(distanceSq + overlap) - distance;
  pos.x += nx * correction;
  pos.z += nz * correction;
  const inward = vel.x * nx + vel.z * nz;
  if (inward < 0) {
    vel.x -= nx * inward;
    vel.z -= nz * inward;
  }
  return true;
}

// Return the fraction at which a segment enters a box.
function boxEntry(x, y, z, dx, dy, dz, box, padding = 0, horizontal = false) {
  const minX = box.x0 - padding, maxX = box.x1 + padding;
  const minZ = box.z0 - padding, maxZ = box.z1 + padding;
  if (Math.max(x, x + dx) <= minX || Math.min(x, x + dx) >= maxX
    || Math.max(z, z + dz) <= minZ || Math.min(z, z + dz) >= maxZ
    || (!horizontal && (Math.max(y, y + dy) <= box.y0 || Math.min(y, y + dy) >= box.y1))) return Infinity;

  let enter = 0, exit = 1;
  if (dx !== 0) {
    const a = (minX - x) / dx, b = (maxX - x) / dx;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  if (dy !== 0) {
    const a = (box.y0 - y) / dy, b = (box.y1 - y) / dy;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  if (dz !== 0) {
    const a = (minZ - z) / dz, b = (maxZ - z) / dz;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return enter < exit ? enter : Infinity;
}

export function lineBlocked(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  for (const box of boxes) {
    if (boxEntry(x0, y0, z0, dx, dy, dz, box) < Infinity) return true;
  }
  return false;
}

export function walkingObstacle(x, z, targetX, targetZ, y, radius, height) {
  let first = null, nearest = Infinity;
  for (const box of boxes) {
    if (box.y1 <= y + STEP || box.y0 >= y + height) continue;
    const distance = boxEntry(x, y, z, targetX - x, 0, targetZ - z, box, radius, true);
    if (distance < nearest) {
      nearest = distance;
      first = box;
    }
  }
  return first;
}

/* ---- ledges -------------------------------------------------------------- */
// The four vertical faces of a box: outward normal and the axis it runs along.
const FACES = [
  { nx: 0, nz: -1 }, { nx: 0, nz: 1 }, { nx: -1, nz: 0 }, { nx: 1, nz: 0 },
];

/**
 * Find a ledge in front of the character. Writes into `out` and returns it, or
 * returns null. `fwd` is the (unit, horizontal) facing. The ledge top must lie
 * within [yMin, yMax] in world height, and the top surface must be deep enough
 * to stand on and free above (so you can actually climb onto it).
 *   out: { box, nx, nz (outward normal), tx, tz (tangent), px, pz (point on the
 *          face), y (top), t, t0, t1 (position along the ledge and its extent),
 *          depth (how far the top extends inward) }
 */
export function findLedge(x, z, fwdx, fwdz, yMin, yMax, maxDist, out) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.y1 < yMin || b.y1 > yMax) continue;
    for (let f = 0; f < 4; f++) {
      const F = FACES[f];
      if (fwdx * F.nx + fwdz * F.nz > -0.55) continue;           // must be facing this face
      const plane = F.nx < 0 ? b.x0 : F.nx > 0 ? b.x1 : F.nz < 0 ? b.z0 : b.z1;
      const dn = F.nx !== 0 ? (x - plane) * F.nx : (z - plane) * F.nz;   // distance in front of the face
      if (dn < -0.1 || dn > maxDist || dn >= bestD) continue;
      const alongX = F.nz !== 0;                                  // face runs along x if its normal is z
      const t = alongX ? x : z;
      const lo = alongX ? b.x0 : b.z0, hi = alongX ? b.x1 : b.z1;
      if (t < lo - 0.05 || t > hi + 0.05) continue;
      const depth = F.nx !== 0 ? b.x1 - b.x0 : b.z1 - b.z0;
      bestD = dn; best = { b, F, plane, alongX, lo, hi, depth, t };
    }
  }
  if (!best) return null;
  const { b, F, plane, alongX, lo, hi, depth, t } = best;
  const mx = -F.nx, mz = -F.nz;                                   // inward
  const ex = (alongX ? clamp(t, lo + 0.2, hi - 0.2) : plane), ez = (alongX ? plane : clamp(t, lo + 0.2, hi - 0.2));
  // clearance on the top: room to stand a body there
  if (blocked(ex + mx * 0.35, b.y1 + 0.2, ez + mz * 0.35) || blocked(ex + mx * 0.35, b.y1 + 1.6, ez + mz * 0.35)) return null;
  out.box = b; out.nx = F.nx; out.nz = F.nz;
  out.tx = alongX ? 1 : 0; out.tz = alongX ? 0 : 1;
  out.px = ex; out.pz = ez; out.y = b.y1;
  out.t = alongX ? ex : ez; out.t0 = lo + 0.2; out.t1 = hi - 0.2;
  out.depth = depth; out.dist = bestD;
  return out;
}
