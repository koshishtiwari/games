// Pure, deterministic Bluff engine. No timers, no I/O. Card id 0..51, rank = id % 13.
export const SEATS = 5;
export const rankOf = (id) => id % 13;

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame({ seats = SEATS, rng = Math.random } = {}) {
  const deck = shuffle(Array.from({ length: 52 }, (_, i) => i), rng);
  const hands = Array.from({ length: seats }, () => []);
  deck.forEach((id, i) => hands[i % seats].push(id));
  hands.forEach((h) => h.sort((a, b) => a - b));
  const first = Math.floor(rng() * seats) % seats;
  return { seats, hands, pile: [], phase: 'turn', cur: first, first, last: null, winner: null, plays: 0 };
}

export const nextSeat = (g, s) => (s + 1) % g.seats;

export function validatePlay(g, seat, ids, rank) {
  if (g.phase !== 'turn') return 'not_your_turn';
  if (seat !== g.cur) return 'not_your_turn';
  if (!Number.isInteger(rank) || rank < 0 || rank > 12) return 'bad_move';
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4) return 'bad_move';
  const seen = new Set();
  const hand = new Set(g.hands[seat]);
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || id > 51 || seen.has(id) || !hand.has(id)) return 'bad_move';
    seen.add(id);
  }
  return null;
}

export function applyPlay(g, seat, ids, rank) {
  const err = validatePlay(g, seat, ids, rank);
  if (err) return { ok: false, error: err };
  const drop = new Set(ids);
  g.hands[seat] = g.hands[seat].filter((c) => !drop.has(c));
  g.pile.push(...ids);
  g.last = { seat, ids: ids.slice(), rank };
  g.phase = 'window';
  g.plays++;
  return { ok: true };
}

export function validateCall(g, seat) {
  if (g.phase !== 'window' || !g.last) return 'bad_move';
  if (!Number.isInteger(seat) || seat < 0 || seat >= g.seats || seat === g.last.seat) return 'bad_move';
  return null;
}

// First valid call wins the race. Returns the reveal result.
export function applyCall(g, caller) {
  const err = validateCall(g, caller);
  if (err) return { ok: false, error: err };
  const { seat: by, ids, rank } = g.last;
  const honest = ids.every((id) => rankOf(id) === rank);
  const loser = honest ? caller : by;
  const took = g.pile.length;
  g.hands[loser] = g.hands[loser].concat(g.pile).sort((a, b) => a - b);
  g.pile = [];
  let winner = null;
  if (honest && g.hands[by].length === 0) {
    winner = by;
    g.winner = by;
    g.phase = 'over';
  } else {
    g.cur = nextSeat(g, by);
    g.phase = 'reveal';
  }
  return { ok: true, by, caller, cards: ids.slice(), honest, loser, took, winner };
}

// No call before the deadline.
export function resolveWindowClose(g) {
  if (g.phase !== 'window' || !g.last) return { ok: false, error: 'bad_move' };
  const by = g.last.seat;
  if (g.hands[by].length === 0) {
    g.winner = by;
    g.phase = 'over';
    return { ok: true, winner: by, next: null };
  }
  g.cur = nextSeat(g, by);
  g.phase = 'turn';
  return { ok: true, winner: null, next: g.cur };
}

// After the reveal pause the next turn starts.
export function endReveal(g) {
  if (g.phase !== 'reveal') return false;
  g.phase = 'turn';
  return true;
}

// Timeout auto-play: one random card claiming its true rank.
export function autoPlay(g, seat, rng = Math.random) {
  const h = g.hands[seat];
  const id = h[Math.floor(rng() * h.length)];
  return { ids: [id], rank: rankOf(id) };
}

export const publicCounts = (g) => g.hands.map((h) => h.length);
export function publicSnapshot(g) {
  return {
    phase: g.phase,
    cur: g.cur,
    counts: publicCounts(g),
    pile: g.pile.length,
    last: g.last ? { seat: g.last.seat, count: g.last.ids.length, rank: g.last.rank } : null,
    winner: g.winner,
  };
}

export function totalCards(g) {
  return g.hands.reduce((a, h) => a + h.length, 0) + g.pile.length;
}
export function conserved(g) {
  const all = g.hands.flat().concat(g.pile);
  return all.length === 52 && new Set(all).size === 52 && all.every((c) => c >= 0 && c < 52);
}
