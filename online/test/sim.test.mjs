import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyPlay, applyCall, resolveWindowClose, endReveal, conserved } from '../src/engine.js';
import { decidePlay, decideCall } from '../src/bot.js';

function simulate() {
  const g = createGame();
  let turns = 0;
  const CAP = 20000;
  while (g.phase !== 'over') {
    assert.ok(++turns < CAP, 'move cap exceeded');
    const seat = g.cur;
    const mv = decidePlay(g, seat);
    assert.ok(applyPlay(g, seat, mv.ids, mv.rank).ok, 'bot made an illegal play');
    assert.ok(conserved(g));
    const order = [1, 2, 3, 4].map((o) => (seat + o) % 5).sort(() => Math.random() - 0.5);
    const caller = order.find((s) => decideCall(g, s));
    if (caller !== undefined) {
      const r = applyCall(g, caller);
      assert.ok(r.ok);
      endReveal(g);
    } else resolveWindowClose(g);
    assert.ok(conserved(g));
  }
  const winners = g.hands.map((h, i) => (h.length === 0 ? i : -1)).filter((i) => i >= 0);
  return { g, turns, winners };
}

test('300 bot games terminate with one winner and conserved cards', () => {
  let total = 0, max = 0;
  for (let i = 0; i < 300; i++) {
    const { g, turns, winners } = simulate();
    assert.equal(winners.length, 1);
    assert.equal(winners[0], g.winner);
    assert.equal(g.pile.length === 0 || g.pile.length > 0, true);
    assert.equal(g.hands.flat().length + g.pile.length, 52);
    total += turns; max = Math.max(max, turns);
  }
  console.log(`avg turns ${(total / 300).toFixed(1)}, max ${max}`);
});
