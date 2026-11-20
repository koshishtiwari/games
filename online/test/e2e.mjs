// End-to-end: wrangler dev --local, 2 dev-auth humans + 3 bots, one full game.
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rankOf = (id) => id % 13;

const port = await freePort();
const inspector = await freePort();
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'bluff-e2e-'));
const vars = { DEV_AUTH: '1', ROOM_SECRET: 'e2e-secret', WINDOW_MS: '700', TURN_MS: '8000', REVEAL_MS: '300', QUEUE_FILL_MS: '1500', START_WAIT_MS: '4000', DEAL_MS: '300', OVER_CLOSE_MS: '1500' };
const args = ['wrangler', 'dev', '--local', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', persist];
for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
const proc = spawn('npx', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));

let finished = false;
function cleanup(code) {
  if (finished) return;
  finished = true;
  try { proc.kill('SIGTERM'); } catch (e) { /* */ }
  setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) { /* */ } fs.rmSync(persist, { recursive: true, force: true }); process.exit(code); }, 500);
}
const fail = (msg) => { console.error('E2E FAIL:', msg); console.error(log.split('\n').slice(-25).join('\n')); cleanup(1); };
setTimeout(() => fail('timeout (170s)'), 170000);

// wait for the server
for (let i = 0; ; i++) {
  if (i > 120) fail('wrangler did not start');
  try { const r = await fetch(`http://127.0.0.1:${port}/health`); if ((await r.text()) === 'ok') break; } catch (e) { /* */ }
  await sleep(500);
}
console.log('worker up on', port);

function connect(url) {
  return new Promise((res, rej) => { const ws = new WebSocket(url); ws.once('open', () => res(ws)); ws.once('error', rej); });
}

// sanity: ws routes require upgrade, bad fee / bad auth handled
{
  const r = await fetch(`http://127.0.0.1:${port}/ws/queue?token=dev:x&fee=0`);
  if (r.status !== 426) fail('expected 426 without upgrade, got ' + r.status);
  const ws = await connect(`ws://127.0.0.1:${port}/ws/queue?token=dev:x&fee=7`);
  const m = await new Promise((r2) => ws.once('message', (d) => r2(JSON.parse(d))));
  if (m.code !== 'bad_fee') fail('bad_fee not reported');
  const ws2 = await connect(`ws://127.0.0.1:${port}/ws/queue?token=garbage&fee=0`);
  const m2 = await new Promise((r2) => ws2.once('message', (d) => r2(JSON.parse(d))));
  if (m2.code !== 'auth') fail('auth error not reported: ' + JSON.stringify(m2));
}

function client(name) {
  const c = { name, over: null, hand: [], plays: 0, calls: 0, lastN: 0, ordered: true, seat: null, events: [], counts: null };
  c.done = new Promise((resolve) => { c.resolve = resolve; });
  c.matched = new Promise((resolve) => { c.onMatched = resolve; });
  return c;
}
function runQueue(c) {
  const q = new WebSocket(`ws://127.0.0.1:${port}/ws/queue?token=dev:${c.name}&fee=0`);
  q.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'matched') { c.m = m; c.onMatched(m); joinRoom(c, m); }
    if (m.t === 'error') fail(`queue error ${m.code} for ${c.name}`);
  });
  q.on('error', (e) => fail('queue socket error ' + e.message));
}
function joinRoom(c, m) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room/${m.matchId}?ticket=${encodeURIComponent(m.ticket)}`);
  c.ws = ws;
  const send = (o) => ws.send(JSON.stringify(o));
  ws.on('open', () => send({ t: 'hello' }));
  ws.on('message', (d) => {
    const x = JSON.parse(d);
    if (!(x.n > c.lastN)) c.ordered = false;
    c.lastN = x.n;
    c.events.push(x.t);
    if (x.t === 'welcome') { c.seat = x.you; c.hand = x.hand; if (x.you !== m.seat) fail('seat mismatch'); }
    if (x.t === 'hand') c.hand = x.hand;
    if (x.t === 'turn' && x.seat === c.seat && c.hand.length) {
      setTimeout(() => {
        const honest = Math.random() < 0.6;
        const id = c.hand[Math.floor(Math.random() * c.hand.length)];
        send({ t: 'play', ids: [id], rank: honest ? rankOf(id) : (rankOf(id) + 1 + Math.floor(Math.random() * 12)) % 13 });
        c.plays++;
      }, 30);
    }
    if (x.t === 'played' && x.seat !== c.seat && Math.random() < 0.25) {
      setTimeout(() => { send({ t: 'call' }); c.calls++; }, 50 + Math.random() * 300);
    }
    if (x.t === 'error' && !['bad_move', 'not_your_turn'].includes(x.code)) fail('room error ' + x.code);
    if (x.t === 'over') { c.over = x; c.resolve(x); }
  });
  ws.on('error', (e) => fail('room socket error ' + e.message));
}

const a = client('a'), b = client('b');
runQueue(a);
runQueue(b);
const [ma, mb] = await Promise.all([a.matched, b.matched]);
if (ma.matchId !== mb.matchId) fail('different matches');
if (ma.humans !== 2) fail('expected 2 humans');
console.log('matched', ma.matchId, 'seats', ma.seat, mb.seat);
const t0 = Date.now();
await Promise.all([a.done, b.done]);
console.log(`game over in ${((Date.now() - t0) / 1000).toFixed(0)}s: winner seat ${a.over.winner}, human=${a.over.human}`);
if (a.over.winner !== b.over.winner) fail('clients disagree on winner');
if (a.over.winner < 0 || a.over.winner > 4) fail('bad winner');
if (!a.ordered || !b.ordered) fail('n not monotonic');
if (!a.events.includes('reveal') && !a.events.includes('played')) fail('no play events');
// a bad ticket must be rejected
const bad = await connect(`ws://127.0.0.1:${port}/ws/room/${ma.matchId}?ticket=deadbeef.dev-a`);
const bm = await new Promise((r) => bad.once('message', (d) => r(JSON.parse(d))));
if (bm.code !== 'bad_ticket') fail('bad ticket accepted');
console.log(`plays a=${a.plays} b=${b.plays}, calls a=${a.calls} b=${b.calls}`);
console.log('E2E PASS');
cleanup(0);
