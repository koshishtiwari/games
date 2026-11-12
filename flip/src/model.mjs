// Free-disc physics and deterministic propagation. No rendering or browser state.
export const CAPACITY = 192;
export const RADIUS = 0.91;

export const DENOMS = [1, 5, 25, 100, 500];
export const TYPES = ['1', '5', '25', '100', '500'];
export const NEGATIVE = 5;
export const FREEZE = 6;
export const DOUBLE = 12;
export const EXTRA_MOVE = 13;
export const STAGES = [
  { name: 'OPENING TABLE', target: 2000, moves: 12, hazards: .07 },
  { name: 'HIGH LIMIT', target: 3000, moves: 14, hazards: .10 },
  { name: 'THE MAIN EVENT', target: 4000, moves: 16, hazards: .13 }
];
export const chainMultiplier = count => count >= 10 ? 5 : count >= 6 ? 3 : count >= 3 ? 2 : 1;
export const TOUCH_DISTANCE = RADIUS * 2.16;

// Immediate first flip, followed by uneven bursts. The seed keeps retries fair.
export function flipOffsets(count, seed = 42) {
  const times = []; let next = 0;
  for (let i = 0; i < count; i++) {
    times.push(next);
    const n = Math.sin((seed + i * 79.7) * 12.9898) * 43758.5453;
    const jitter = n - Math.floor(n);
    next += i % 4 === 2 ? .095 + jitter * .045 : .014 + jitter * .048;
  }
  return times;
}

const HASH_SIZE = 4096;
const CELL = RADIUS * 2.1;

export class Field {
  constructor(seed = 42, stage = 0, rebuys = 0) {
    this.rebuys = rebuys; this.peakScore = 0; this.bonusMovesAwarded = 0; this.streak = 0;
    this.stage = stage; this.turn = 0; this.score = 0; this.moves = STAGES[stage].moves; this.state = 'playing';
    this.seed = seed >>> 0;
    this.serial = 0;
    this.chips = Array.from({ length: CAPACITY }, (_, id) => ({
      id, active: false, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0,
      angle: 0, spin: 0, state: 0, start: -1, revealed: false, birth: -10,
      outcome: -1, triggerCost: 0
    }));
    this.head = new Int32Array(HASH_SIZE);
    this.next = new Int32Array(CAPACITY);
    this.cellX = new Int16Array(CAPACITY);
    this.cellY = new Int16Array(CAPACITY);
    this.gx = 0; this.gy = 1;
    this.cx = 0; this.cy = 0; this.halfW = 10; this.halfH = 16;
    this.bottomLimitY = null;
    this.time = 0; this.refill = 0;
    this.impacts = [];
  }
  random() {
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0; return this.seed / 4294967296;
  }
  spawn(chip, x, y) {
    const roll = this.random();
    const hazard = STAGES[this.stage].hazards;
    const normal = this.random() * 100;
    const type = roll < hazard / 2 ? NEGATIVE : roll < hazard ? FREEZE
      : roll < hazard + .022 ? DOUBLE : roll < hazard + .034 ? EXTRA_MOVE
      : normal < 30 ? 0 : normal < 57 ? 1 : normal < 79 ? 2 : normal < 95 ? 3 : 4;

    Object.assign(chip, {
      active: true, serial: ++this.serial, x, y, prevX: x, prevY: y,
      vx: (this.random() - 0.5) * 1.5, vy: 4 + this.random() * 6,
      type, angle: (this.random() - .5) * .3, spin: 0,
      outcome: -1, triggerCost: 0, frozen: false, freezeDepth: 1 + Math.floor(this.random() * 3),
      state: 0, start: -1, revealed: false, depth: 0, birth: this.time, hasLanded: false
    });
    return chip;
  }
  configure(cx, cy, halfW, halfH, initial = false, bottomLimitY = null) {
    this.cx = cx; this.cy = cy; this.halfW = Math.min(halfW, 22); this.halfH = Math.min(halfH, 25);
    if (bottomLimitY != null) this.bottomLimitY = bottomLimitY;
    if (initial) {
      let id = 0, row = 0;
      const maxSpawnY = (this.bottomLimitY != null ? this.bottomLimitY : this.cy + this.halfH) - 1.2;
      for (let y = -this.halfH + 1; y < maxSpawnY; y += 1.74, row++) {
        for (let x = -this.halfW + 1 + (row % 2) * .97; x < this.halfW - 1 && id < CAPACITY; x += 1.97) {
          const ch = this.spawn(this.chips[id++], cx + x + (this.random() - .5) * .26, cy + y + (this.random() - .5) * .26);
          ch.vx = (this.random() - .5) * 4; ch.vy = (this.random() - .5) * 4;
        }
      }
      for (let i = 0; i < 100; i++) this.step(1 / 120, false);
      for (const ch of this.chips) {
        ch.birth = -10;
        ch.hasLanded = true;
      }
      this.impacts.length = 0;
    }
  }
  hash(x, y) { return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) & (HASH_SIZE - 1); }
  rebuild() {
    this.head.fill(-1);
    for (const ch of this.chips) {
      if (!ch.active) continue;
      const cx = Math.floor(ch.x / CELL), cy = Math.floor(ch.y / CELL);
      this.cellX[ch.id] = cx; this.cellY[ch.id] = cy;
      const bucket = this.hash(cx, cy);
      this.next[ch.id] = this.head[bucket]; this.head[bucket] = ch.id;
    }
  }
  free(x, y, gap = RADIUS * 2.02) {
    for (const ch of this.chips) if (ch.active && (ch.x - x) ** 2 + (ch.y - y) ** 2 < gap * gap) return false;
    return true;
  }
  replenish(viewW, viewH) {
    let spawned = 0;
    const wanted = Math.min(CAPACITY, Math.floor((this.halfW * 2 - 1) * (this.halfH * 2 - 1) / 3.75));
    let active = this.chips.reduce((n, c) => n + c.active, 0);

    // Strict top-only spawning: chips ONLY fall from above the top edge!
    for (const ch of this.chips) {
      if (ch.active || active >= wanted || spawned >= 3) continue;
      for (let attempt = 0; attempt < 20; attempt++) {
        // Random x spread across the screen
        const x = this.cx + (this.random() * 2 - 1) * (this.halfW - RADIUS * 1.5);
        // Strictly above the top of the visible playfield
        const y = this.cy - this.halfH + RADIUS + this.random() * .15;
        if (!this.free(x, y)) continue;
        this.spawn(ch, x, y);
        ch.vx = (this.random() - 0.5) * 1.2;
        ch.vy = 8.0 + this.random() * 6.0; // Falling down with gravity!
        ch.isFalling = true;
        spawned++; active++; break;
      }
    }
    return spawned;
  }
  step(dt, recycle = true) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.time += dt;
    this.impacts.length = 0;
    const subSteps = 3;
    const subDt = dt / subSteps;
    const damping = Math.exp(-subDt * 0.45);
    const slop = 0.002;

    for (let stepIdx = 0; stepIdx < subSteps; stepIdx++) {
      // 1. Store previous positions and integrate forces
      for (const ch of this.chips) {
        if (!ch.active) continue;
        const limitY = this.bottomLimitY != null ? this.bottomLimitY + 2.5 : this.cy + this.halfH + 2.5;
        if (recycle && (Math.abs(ch.x - this.cx) > this.halfW + 2.5 || ch.y < this.cy - this.halfH - 2.5 || ch.y > limitY)) {
          ch.active = false;
          continue;
        }
        ch.prevX = ch.x;
        ch.prevY = ch.y;

        // Heavy, satisfying gravity
        ch.vx = (ch.vx + this.gx * 34 * subDt) * damping;
        ch.vy = (ch.vy + this.gy * 34 * subDt) * damping;

        // Cap velocity to prevent tunneling
        const v2 = ch.vx * ch.vx + ch.vy * ch.vy;
        if (v2 > 900) {
          const s = 30 / Math.sqrt(v2);
          ch.vx *= s; ch.vy *= s;
        }

        ch.x += ch.vx * subDt;
        ch.y += ch.vy * subDt;
        ch.angle += (ch.spin + ch.vx * .17) * subDt;
        ch.spin *= Math.exp(-subDt * 3.5);
      }

      // 2. Position relaxation passes (PBD)
      for (let pass = 0; pass < 4; pass++) {
        this.rebuild();
        for (const a of this.chips) {
          if (!a.active) continue;
          const isFlippingA = a.state === 1 && a.start >= 0 && this.time >= a.start;
          const radA = isFlippingA ? Math.max(0.15, RADIUS * (1 - Math.min(1, (this.time - a.start) * 2.8))) : RADIUS;

          const cx = this.cellX[a.id], cy = this.cellY[a.id];
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const bx = cx + dx, by = cy + dy;
              for (let j = this.head[this.hash(bx, by)]; j !== -1; j = this.next[j]) {
                if (j <= a.id || this.cellX[j] !== bx || this.cellY[j] !== by) continue;
                const b = this.chips[j];
                if (!b.active) continue;

                const isFlippingB = b.state === 1 && b.start >= 0 && this.time >= b.start;
                const radB = isFlippingB ? Math.max(0.15, RADIUS * (1 - Math.min(1, (this.time - b.start) * 2.8))) : RADIUS;

                const minDist = radA + radB;
                const x = b.x - a.x, y = b.y - a.y;
                const d2 = x * x + y * y;
                if (d2 >= minDist * minDist || d2 < 0.00001) continue;

                const d = Math.sqrt(d2);
                const nx = x / d, ny = y / d;
                const overlap = minDist - d;

                if (overlap > slop) {
                  // Strictly trigger drop sound only when a falling chip drops onto another chip below it (NO sound when sliding!)
                  if (pass === 0) {
                    if (a.isFalling && b.y >= a.y - 0.25) {
                      a.isFalling = false;
                      this.impacts.push({ speed: Math.max(4, a.vy), x: a.x, y: a.y });
                    } else if (b.isFalling && a.y >= b.y - 0.25) {
                      b.isFalling = false;
                      this.impacts.push({ speed: Math.max(4, b.vy), x: b.x, y: b.y });
                    }
                  }
                  const push = (overlap - slop) * 0.5;
                  a.x -= nx * push; a.y -= ny * push;
                  b.x += nx * push; b.y += ny * push;
                }
              }
            }
          }
        }

        // Boundary constraints
        for (const ch of this.chips) {
          if (!ch.active) continue;
          const minX = this.cx - this.halfW + RADIUS, maxX = this.cx + this.halfW - RADIUS;
          const minY = this.cy - this.halfH + RADIUS;
          const maxY = (this.bottomLimitY != null ? this.bottomLimitY : this.cy + this.halfH) - RADIUS;
          if (ch.x < minX) ch.x = minX;
          if (ch.x > maxX) ch.x = maxX;
          if (ch.y < minY) ch.y = minY;
          if (ch.y > maxY) {
            if (pass === 0 && ch.isFalling) {
              ch.isFalling = false;
              this.impacts.push({ speed: Math.max(4, ch.vy), x: ch.x, y: maxY });
            }
            ch.y = maxY;
          }
        }
      }

      // 3. Derive velocities from position change (PBD)
      for (const ch of this.chips) {
        if (!ch.active) continue;
        ch.vx = (ch.x - ch.prevX) / subDt;
        ch.vy = (ch.y - ch.prevY) / subDt;
      }
    }
  }
  hit(x, y) {
    let nearest = null, distance = RADIUS * RADIUS * 1.35;
    for (const ch of this.chips) { if (!ch.active || ch.state) continue; const d = (x - ch.x) ** 2 + (y - ch.y) ** 2; if (d < distance) { distance = d; nearest = ch; } }
    return nearest;
  }
  isFrozen(chip) { return !!chip.frozen; }
  contacts() {
    const graph = new Map();
    const active = this.chips.filter(c => c.active && !c.state);
    active.forEach(c => graph.set(c.id, []));
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= TOUCH_DISTANCE ** 2) {
        graph.get(a.id).push(b.id); graph.get(b.id).push(a.id);
      }
    }
    return graph;
  }
  // Preview is pure. It does not change the random seed, ice, or chip state.
  plan(id) {
    const root = this.chips[id];
    if (this.state !== 'playing' || !root?.active || root.state) return null;
    if (this.isFrozen(root)) return { root: id, thaw: true, events: [], ids: [], frozen: [], blocked: [id], hazards: [], points: 0, value: 0, mult: 1, negative: false, double: false, bonusMoves: 0 };
    if (root.type === DOUBLE || root.type === EXTRA_MOVE) return null;
    const graph = this.contacts(), flipped = new Set(), frozen = new Set(), blocked = new Set(), hazards = [], events = [], blockedContacts = [];
    const queued = new Set([id]);
    let wave = [{ id, parent: null }], depth = 0, negative = false, value = 0;
    // All hazards in a wave fire before the next wave. Freeze can therefore
    // stop a queued branch before it flips. A stopped branch cannot bridge ice.
    while (wave.length) {
      const next = [];
      const priority = id => this.chips[id].type === FREEZE ? 3 : this.chips[id].type === NEGATIVE ? 2 : this.chips[id].type >= DOUBLE ? 1 : 0;
      wave.sort((a,b) => priority(b.id) - priority(a.id) || a.id-b.id);
      for (const item of wave) {
        const chip = this.chips[item.id];
        if (flipped.has(chip.id)) continue;
        if (frozen.has(chip.id) || this.isFrozen(chip)) { blocked.add(chip.id); blockedContacts.push(item.parent); continue; }
        flipped.add(chip.id);
        events.push({ id: chip.id, parent: item.parent, depth });
        if (chip.type === NEGATIVE) { negative = true; hazards.push(chip.id); }
        else if (chip.type === FREEZE) {
          hazards.push(chip.id);
          // Spread ice through physical contacts, of every chip type.
          const iceIds = [];
          const seen = new Set([chip.id]); let frontier = [chip.id];
          for (let hop = 0; hop < chip.freezeDepth; hop++) {
            const ring = [];
            for (const at of frontier) for (const neighbor of graph.get(at) || []) {
              if (seen.has(neighbor)) continue;
              seen.add(neighbor); ring.push(neighbor);
              if (!flipped.has(neighbor)) { frozen.add(neighbor); iceIds.push(neighbor); }
            }
            frontier = ring;
          }
          events[events.length - 1].iceIds = iceIds;
        } else if (chip.type < NEGATIVE) value += DENOMS[chip.type];
        // Hazards end their branch. Only the selected denomination spreads.
        if (chip.type >= NEGATIVE) continue;
        for (const neighbor of graph.get(chip.id) || []) {
          const other = this.chips[neighbor];
          if (queued.has(neighbor) || other.type !== root.type && other.type < NEGATIVE) continue;
          queued.add(neighbor); next.push({ id: neighbor, parent: chip.id });
        }
      }
      wave = next; depth++;
    }
    const count = events.filter(e => this.chips[e.id].type < NEGATIVE).length;
    const double = events.some(e=>this.chips[e.id].type === DOUBLE);
    const bonusMoves = !negative && this.bonusMovesAwarded < 3 && events.some(e=>this.chips[e.id].type === EXTRA_MOVE) ? 1 : 0;
    const mult = chainMultiplier(count) * (double ? 2 : 1);
    const amount = value * mult;
    return { root: id, events, ids: events.map(e=>e.id), frozen: [...frozen], blocked: [...blocked], blockedContacts, hazards,
      value, mult, negative, double, bonusMoves, points: negative ? -Math.max(DENOMS[0], amount) : amount, thaw: false };
  }
  begin(id) {
    if (this.inFlight) return null;
    const plan = this.plan(id);
    if (!plan) return null;
    this.inFlight = true;
    const offsets = flipOffsets(plan.events.length, this.seed);
    for (let i = 0; i < plan.events.length; i++) {
      const e = plan.events[i];
      e.offset = offsets[i];
      const chip = this.chips[e.id];
      chip.state = 1; chip.start = this.time + e.offset;
      chip.revealed = false; chip.outcome = chip.type >= DOUBLE ? chip.type : chip.type === FREEZE ? FREEZE : chip.type === NEGATIVE ? 7 : plan.mult >= 10 ? 15 : plan.mult >= 6 ? 14 : plan.mult >= 5 ? 11 : plan.mult === 4 ? 16 : plan.mult >= 3 ? 10 : plan.mult >= 2 ? 9 : 8;
      chip.flipSpeed = .88 + ((chip.serial * 17) % 11) * .032;
      chip.toss = ((chip.serial * 31) % 13 - 6) * .035;
    }
    plan.thawAt = plan.thaw ? 0 : plan.blocked.length ? Math.min(...plan.blockedContacts.map(parent => (plan.events.find(e => e.id === parent)?.offset || 0) + .1)) : Infinity;
    this.moves += (plan.bonusMoves || 0) - 1; this.bonusMovesAwarded += plan.bonusMoves || 0; this.turn++; this.score += plan.points;
    this.streak = plan.points > 0 ? this.streak + 1 : 0;
    this.peakScore = Math.max(this.peakScore, this.score);
    if (this.score >= STAGES[this.stage].target) this.state = 'won';
    else if (this.moves === 0) this.state = 'lost';
    return plan;
  }
  moveOffer() {
    // Price uses the high-water balance, so a loss cannot buy a discount.
    const rate = (40 + this.rebuys * 20) / 100;
    const cost = Math.max(1, Math.ceil(Math.max(this.peakScore, this.score) * rate),
      Math.ceil(STAGES[this.stage].target * (8 + this.rebuys * 4) / 100));
    const available = this.state === 'lost' && this.moves === 0 && !this.inFlight && this.rebuys < 3;
    return { cost, moves: 2, rate, number: this.rebuys + 1, remaining: this.score - cost,
      available, affordable: available && this.score > cost, limit: 3 };
  }
  buyMoves() {
    const offer = this.moveOffer();
    if (!offer.affordable) return null;
    this.score -= offer.cost;
    this.moves = offer.moves;
    this.rebuys++;
    this.state = 'playing';
    return offer;
  }
  thawAll() {
    const thawed = this.chips.filter(c => c.active && c.frozen);
    thawed.forEach(c => { c.frozen = false; c.vx += Math.sin(c.serial * 3) * 2; c.vy -= 1.5; c.spin += Math.cos(c.serial) * 2; });
    return thawed;
  }
  impulse(x, y, strength = 1) {
    for (const c of this.chips) {
      if (!c.active) continue;
      const dx = c.x - x, dy = c.y - y, d = Math.hypot(dx, dy);
      if (d > 5) continue;
      const force = strength * Math.exp(-d * .5);
      c.vx += (dx / Math.max(.5, d)) * force * 4;
      c.vy -= force * (2 + Math.abs(dy) * .3);
      c.spin += Math.sin(c.serial * 2.3) * force * 5;
    }
  }
  finish(plan) {
    if (plan.blocked.length) this.thawAll();
    this.inFlight = false;
  }
  legalMoves() {
    if (this.state !== 'playing') return [];
    const covered = new Set(), plans = [];
    for (const chip of this.chips) {
      if (!chip.active || chip.state || covered.has(chip.id)) continue;
      const plan = this.plan(chip.id);
      if (!plan) continue;
      plans.push(plan);
      // Every start point can change the order in which ice is reached, so
      // only skip equivalent groups with no freeze hazard.
      if (!plan.hazards.some(id => this.chips[id].type === FREEZE)) plan.ids.forEach(id=>{ if(this.chips[id].type<NEGATIVE)covered.add(id); });
    }
    return plans;
  }
  removeChip(chip) {
    chip.active = false;
    chip.state = 0;
    for (const c of this.chips) {
      if (c.active && Math.abs(c.x - chip.x) < RADIUS * 1.2 && c.y < chip.y && c.y > chip.y - RADIUS * 2.8) {
        c.isFalling = true;
      }
    }
  }
}

