// Simple card-counting bot. Pure decisions; the Room chooses the delays.
import { rankOf } from './engine.js';

export const BOT_PLAY_DELAY = [1000, 2200];
export const BOT_CALL_DELAY = [600, 3500];
export const botDelay = ([lo, hi], rng = Math.random, scale = 1) => (lo + rng() * (hi - lo)) * scale;

function groupsOf(hand) {
  const m = new Map();
  for (const id of hand) {
    const r = rankOf(id);
    if (!m.has(r)) m.set(r, []);
    m.get(r).push(id);
  }
  return [...m.entries()].map(([rank, ids]) => ({ rank, ids }));
}

export function decidePlay(g, seat, rng = Math.random) {
  const hand = g.hands[seat];
  const groups = groupsOf(hand);
  const pile = g.pile.length;
  // can go out honestly
  if (hand.length <= 4 && groups.length === 1) return { ids: groups[0].ids.slice(), rank: groups[0].rank };

  let pBluff = 0.22 + (pile === 0 ? 0.1 : 0) + (pile > 10 ? 0.08 : 0) + (hand.length <= 2 ? 0.2 : 0);
  if (rng() >= pBluff) {
    // honest: weight groups by size
    const total = groups.reduce((a, x) => a + x.ids.length, 0);
    let pick = rng() * total;
    let grp = groups[0];
    for (const x of groups) {
      pick -= x.ids.length;
      if (pick <= 0) { grp = x; break; }
    }
    const n = rng() < 0.6 ? grp.ids.length : 1 + Math.floor(rng() * grp.ids.length);
    return { ids: grp.ids.slice(0, n), rank: grp.rank };
  }
  // bluff: 1 card mostly, sometimes 2, rarely 3; all cards when nearly out
  let n = rng() < 0.65 ? 1 : rng() < 0.8 ? 2 : 3;
  if (hand.length <= 2) n = hand.length;
  n = Math.min(n, hand.length);
  // prefer throwing singletons (cards of ranks we hold few of)
  const bySize = hand.slice().sort((a, b) => {
    const ga = groups.find((x) => x.rank === rankOf(a)).ids.length;
    const gb = groups.find((x) => x.rank === rankOf(b)).ids.length;
    return ga - gb || rng() - 0.5;
  });
  const ids = bySize.slice(0, n);
  const used = new Set(ids.map(rankOf));
  const cands = [];
  for (let r = 0; r < 13; r++) if (!used.has(r)) cands.push(r);
  const rank = cands[Math.floor(rng() * cands.length)];
  return { ids, rank };
}

function comb(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
// P(X >= k): m successes among U cards, draw N
function hyperAtLeast(U, m, N, k) {
  const den = comb(U, N);
  if (den === 0) return 0;
  let p = 0;
  for (let x = k; x <= Math.min(m, N); x++) p += (comb(m, x) * comb(U - m, N - x)) / den;
  return p;
}

// Should this bot call LIAR on the last claim?
export function decideCall(g, seat, rng = Math.random) {
  const last = g.last;
  if (!last || last.seat === seat) return false;
  const k = last.ids.length;
  const mine = g.hands[seat].filter((id) => rankOf(id) === last.rank).length;
  const m = 4 - mine;
  if (k > m) return true; // cannot be honest
  const claimerLeft = g.hands[last.seat].length;
  const U = 52 - g.hands[seat].length;
  const N = Math.min(U, claimerLeft + k);
  const pHave = hyperAtLeast(U, m, N, k);
  const pHonest = pHave * 0.55;
  const pLie = 1 - pHonest;
  let prob = Math.max(0, Math.min(1, (pLie - 0.45) * 1.8));
  if (g.pile.length >= 15 && pLie < 0.8) prob *= 0.6;
  if (claimerLeft === 0) prob = Math.max(prob, 0.85); // last chance to stop them winning
  else if (claimerLeft <= 1) prob = Math.min(1, prob + 0.15);
  prob *= 0.92 + rng() * 0.16;
  return rng() < prob;
}
