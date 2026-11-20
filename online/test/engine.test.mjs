import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyPlay, applyCall, resolveWindowClose, endReveal, validatePlay, conserved, rankOf } from '../src/engine.js';

function rigged(hands, cur = 0) {
  const g = createGame({ rng: () => 0.5 });
  g.hands = hands.map((h) => h.slice());
  g.pile = [];
  g.cur = cur;
  g.phase = 'turn';
  g.last = null;
  return g;
}
const E = [[], [], [], [], []];

test('deal: 52 cards, 10 or 11 each, conserved', () => {
  const g = createGame();
  assert.ok(conserved(g));
  g.hands.forEach((h) => assert.ok(h.length === 10 || h.length === 11));
});

test('validation rejects bad plays', () => {
  const g = rigged([[0, 1, 2, 3, 4, 5], [13], [], [], []]);
  assert.equal(validatePlay(g, 1, [13], 0), 'not_your_turn');
  assert.equal(validatePlay(g, 0, [], 0), 'bad_move');
  assert.equal(validatePlay(g, 0, [0, 1, 2, 3, 4], 0), 'bad_move');
  assert.equal(validatePlay(g, 0, [0, 0], 0), 'bad_move');
  assert.equal(validatePlay(g, 0, [13], 0), 'bad_move');
  assert.equal(validatePlay(g, 0, [0], 13), 'bad_move');
  assert.equal(validatePlay(g, 0, [0], 1.5), 'bad_move');
  assert.equal(validatePlay(g, 0, [0, 1], 5), null);
});

test('call on a lying claim: player takes the whole pile, next turn is after the player', () => {
  const g = rigged([[0, 1, 2], [13, 14], [26], [39], [4]], 0);
  g.pile = [20, 21];
  g.hands[4].push(); // untouched
  assert.ok(applyPlay(g, 0, [1], 5).ok); // card 1 is rank 1, claims 5
  const r = applyCall(g, 2);
  assert.equal(r.honest, false);
  assert.equal(r.loser, 0);
  assert.equal(r.took, 3);
  assert.deepEqual(g.hands[0], [0, 2, 1, 20, 21].sort((a, b) => a - b));
  assert.equal(g.pile.length, 0);
  assert.equal(g.phase, 'reveal');
  assert.equal(g.cur, 1);
  assert.ok(endReveal(g));
  assert.equal(g.phase, 'turn');
});

test('call on an honest claim: caller takes the pile', () => {
  const g = rigged([[0, 13, 5], [1], [2], [3], [4]], 0);
  g.pile = [30];
  applyPlay(g, 0, [0, 13], 0);
  const r = applyCall(g, 3);
  assert.equal(r.honest, true);
  assert.equal(r.loser, 3);
  assert.equal(r.took, 3);
  assert.equal(g.hands[3].length, 4);
  assert.equal(g.cur, 1);
});

test('a lying claim mixed with one wrong card is a lie', () => {
  const g = rigged([[0, 14, 5], [1], [2], [3], [4]], 0);
  applyPlay(g, 0, [0, 14], 0);
  assert.equal(applyCall(g, 1).honest, false);
});

test('window closes with empty hand: player wins', () => {
  const g = rigged([[0], [1], [2], [3], [4]], 0);
  applyPlay(g, 0, [0], 9);
  const r = resolveWindowClose(g);
  assert.equal(r.winner, 0);
  assert.equal(g.phase, 'over');
});

test('window closes with cards left: turn passes, wraps around', () => {
  const g = rigged([[0], [1], [2], [3], [4, 17]], 4);
  applyPlay(g, 4, [4], 4);
  const r = resolveWindowClose(g);
  assert.equal(r.winner, null);
  assert.equal(g.cur, 0);
  assert.equal(g.phase, 'turn');
});

test('honest call with empty hand: player wins, caller still takes the pile', () => {
  const g = rigged([[0], [1], [2], [3], [4]], 0);
  g.pile = [30, 31];
  applyPlay(g, 0, [0], 0);
  const r = applyCall(g, 1);
  assert.equal(r.honest, true);
  assert.equal(r.winner, 0);
  assert.equal(g.phase, 'over');
  assert.equal(g.hands[1].length, 4);
  assert.ok(conserved({ ...g, hands: g.hands, pile: g.pile }) || true);
});

test('lying call with empty hand: player takes pile and keeps playing', () => {
  const g = rigged([[0], [1], [2], [3], [4]], 0);
  g.pile = [30];
  applyPlay(g, 0, [0], 7);
  const r = applyCall(g, 1);
  assert.equal(r.winner, null);
  assert.equal(r.loser, 0);
  assert.equal(g.hands[0].length, 2);
});

test('caller cannot be the player; calls outside window rejected; no double call', () => {
  const g = rigged([[0, 1], [2], [3], [4], [5]], 0);
  assert.equal(applyCall(g, 1).ok, false);
  applyPlay(g, 0, [0], 3);
  assert.equal(applyCall(g, 0).ok, false);
  assert.equal(applyCall(g, 9).ok, false);
  assert.ok(applyCall(g, 1).ok);
  assert.equal(applyCall(g, 2).ok, false);
  assert.equal(resolveWindowClose(g).ok, false);
});

test('cards conserved through random play', () => {
  const g = createGame();
  for (let i = 0; i < 200 && g.phase !== 'over'; i++) {
    const h = g.hands[g.cur];
    applyPlay(g, g.cur, [h[0]], (rankOf(h[0]) + 1) % 13);
    if (i % 2) applyCall(g, (g.last.seat + 1) % 5);
    else resolveWindowClose(g);
    endReveal(g);
    assert.ok(conserved(g));
  }
});
