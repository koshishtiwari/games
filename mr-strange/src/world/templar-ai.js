import { lineBlocked, walkingObstacle } from './collision.js';
import { shortAngle } from '../math.js';

const SIGHT_RADIUS = 11.5;
const HEARING_RADIUS = 16;
const MEMORY_TIME = 4;
const ATTACK_RANGE = 2.70;       // the lunge covers about 2.4 m, so an attack starts from further out
const SLASH_RANGE = 1.75;        // closer than this he slashes in place instead of lunging
const SIGHT_INTERVAL = 0.16;

export function createTemplarTactics(knights, radius, height) {
  let clock = 0;
  let striker = null;
  let leader = null;
  let formation = null;
  let reportAt = -Infinity;
  let reportX = 0, reportY = 0, reportZ = 0;
  let sourceX = 0, sourceZ = 0;

  for (const [slot, knight] of knights.entries()) {
    Object.assign(knight, {
      slot, nextSight: slot * 0.034, seenAt: -Infinity, heardAt: -Infinity,
      sees: false, knownX: 0, knownY: 0, knownZ: 0, role: 'patrol',
      goalX: knight.pos.x, goalZ: knight.pos.z,
      routeX: knight.pos.x, routeZ: knight.pos.z, routeUntil: -Infinity,
      speed: 0, recoverUntil: -Infinity,
    });
  }

  function canSee(knight, char, angle) {
    const dx = char.pos.x - knight.pos.x, dz = char.pos.z - knight.pos.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq > SIGHT_RADIUS ** 2 || Math.abs(char.pos.y - knight.pos.y) > 2.8) return false;
    if (angle && distanceSq > 2.4 ** 2
      && Math.abs(shortAngle(Math.atan2(dx, dz) - knight.yaw)) > (knight.sees ? 1.78 : 1.52)) return false;
    return !lineBlocked(knight.pos.x, knight.pos.y + 1.48, knight.pos.z,
      char.pos.x, char.pos.y + (char.isBat ? 0.25 : 1.12), char.pos.z);
  }

  function findRoute(knight) {
    const { pos, goalX, goalZ } = knight;
    const obstacle = walkingObstacle(pos.x, pos.z, goalX, goalZ, pos.y, radius, height);
    if (!obstacle) {
      knight.routeX = goalX;
      knight.routeZ = goalZ;
      return;
    }

    let best = Infinity;
    const pad = radius + 0.23;
    for (let i = 0; i < 4; i++) {
      const x = i % 2 === 0 ? obstacle.x0 - pad : obstacle.x1 + pad;
      const z = i < 2 ? obstacle.z0 - pad : obstacle.z1 + pad;
      const distance = Math.hypot(x - pos.x, z - pos.z);
      if (distance < 0.22 || walkingObstacle(pos.x, pos.z, x, z, pos.y, radius, height)) continue;
      const blockedAhead = walkingObstacle(x, z, goalX, goalZ, pos.y, radius, height);
      const keepRoute = Math.hypot(knight.routeX - x, knight.routeZ - z) < 0.01 ? 0.7 : 0;
      const score = distance + Math.hypot(x - goalX, z - goalZ) + (blockedAhead ? 1.8 : 0) - keepRoute;
      if (score >= best) continue;
      best = score;
      knight.routeX = x;
      knight.routeZ = z;
    }
    if (best === Infinity) {
      knight.routeX = pos.x;
      knight.routeZ = pos.z;
    }
  }

  function update(dt, char) {
    clock += dt;
    for (const knight of knights) {
      if (knight.archer) continue;
      if (clock >= knight.nextSight) {
        knight.nextSight = clock + SIGHT_INTERVAL;
        const visible = canSee(knight, char, true);
        knight.sees = visible || clock - knight.seenAt < 0.24;
        if (visible) {
          knight.seenAt = clock;
          knight.knownX = reportX = char.pos.x;
          knight.knownY = reportY = char.pos.y;
          knight.knownZ = reportZ = char.pos.z;
          reportAt = clock;
          sourceX = knight.pos.x;
          sourceZ = knight.pos.z;
        }
      }
    }

    let lead = null, nearest = Infinity;
    for (const knight of knights) {
      if (knight.archer) continue;
      const radioDistance = (knight.pos.x - sourceX) ** 2 + (knight.pos.z - sourceZ) ** 2;
      if (reportAt > Math.max(knight.heardAt, knight.seenAt) && radioDistance < HEARING_RADIUS ** 2) {
        knight.heardAt = reportAt;
        knight.knownX = reportX;
        knight.knownY = reportY;
        knight.knownZ = reportZ;
      }
      if (!knight.sees || clock < knight.recoverUntil || knight.stun > 0 || knight.down > 0) continue;
      const dx = knight.knownX - knight.pos.x, dz = knight.knownZ - knight.pos.z;
      const score = dx * dx + dz * dz + (knight.hitCooldown > 0 ? 3 : 0)
        + Math.abs(knight.knownY - knight.pos.y) * 1.5 - (knight === leader ? 2.25 : 0);
      if (score >= nearest) continue;
      nearest = score;
      lead = knight;
    }
    leader = lead;
    const anchor = striker || lead;
    if (anchor) {
      const direction = Math.atan2(anchor.pos.x - anchor.knownX, anchor.pos.z - anchor.knownZ);
      formation = formation === null ? direction
        : formation + shortAngle(direction - formation) * (1 - Math.exp(-5 * dt));
    } else {
      formation = null;
    }
    const approach = formation ?? 0;

    for (const knight of knights) {
      if (knight.archer || knight.state === 'attack' || knight.stun > 0 || knight.down > 0) continue;
      const recent = clock - Math.max(knight.seenAt, knight.heardAt) < MEMORY_TIME;
      const { pos, knownX, knownY, knownZ } = knight;
      const dx = knownX - pos.x, dz = knownZ - pos.z;
      const distance = Math.hypot(dx, dz);
      const previousRole = knight.role;
      if (!recent) {
        knight.state = knight.role = 'patrol';
        const point = knight.pts[knight.wp];
        if (Math.hypot(point[0] - pos.x, point[1] - pos.z) < 0.40) knight.wp = (knight.wp + 1) % knight.pts.length;
        [knight.goalX, knight.goalZ] = knight.pts[knight.wp];
        knight.speed = 1.4;
      } else if (!knight.sees) {
        knight.state = 'search';
        knight.role = 'investigate';
        const age = clock - Math.max(knight.seenAt, knight.heardAt);
        const angle = knight.slot * 1.6 + Math.floor(age / 0.95) * 1.45;
        const spread = distance < 1.35 || age > 1.6 ? 0.75 : 0;
        knight.goalX = knownX + Math.sin(angle) * spread;
        knight.goalZ = knownZ + Math.cos(angle) * spread;
        knight.speed = 1.9;
      } else if (clock < knight.recoverUntil) {
        knight.state = 'chase';
        knight.role = 'retreat';
        const angle = Math.atan2(-dx, -dz) + 0.55 * (knight.slot % 2 ? 1 : -1);
        knight.goalX = knownX + Math.sin(angle) * 2.1;
        knight.goalZ = knownZ + Math.cos(angle) * 2.1;
        knight.speed = 1.55;
      } else if (knight === lead && (!striker || striker === knight)) {
        knight.state = 'chase';
        knight.role = 'lead';
        knight.goalX = knownX;
        knight.goalZ = knownZ;
        knight.speed = Math.min(2.85, Math.max(0, distance - 0.90) * 7);
        const facing = Math.abs(shortAngle(Math.atan2(dx, dz) - knight.yaw));
        if (!char.isBat && distance < ATTACK_RANGE && facing < 0.62
          && Math.abs(knownY - pos.y) < 0.90 && knight.hitCooldown === 0 && canSee(knight, char, false)) {
          striker = knight;
          knight.state = knight.role = 'attack';
          knight.moveName = distance > SLASH_RANGE ? 'lunge' : 'slash';
          knight.atkT = 0;
          knight.hitDone = false;
          knight.attackX = knownX;
          knight.attackZ = knownZ;
        }
      } else {
        knight.state = 'chase';
        knight.role = 'flank';
        const flank = ((knight.slot - (anchor?.slot ?? 0) + knights.length) % knights.length);
        const offset = flank % 2 ? 1.16 : -1.16;
        const angle = approach + offset * (flank === 3 ? 1.75 : 1);
        const range = flank === 3 ? 2.9 : 2.25;
        knight.goalX = knownX + Math.sin(angle) * range;
        knight.goalZ = knownZ + Math.cos(angle) * range;
        knight.speed = 2.2;
      }

      if (knight.role !== previousRole || clock >= knight.routeUntil) {
        findRoute(knight);
        knight.routeUntil = clock + 0.24;
      }
    }
  }

  function finish(knight) {
    if (striker === knight) striker = null;
    knight.state = 'chase';
    knight.atkT = 0;
    knight.hitCooldown = 0.9;
    knight.recoverUntil = clock + 1.0;
  }

  // A knight that has been hit loses the initiative for a moment.
  function stagger(knight, seconds) {
    if (striker === knight) striker = null;
    knight.atkT = 0;
    knight.hitCooldown = 0.65;
    knight.recoverUntil = clock + seconds;
  }

  return { update, finish, canSee, stagger };
}
