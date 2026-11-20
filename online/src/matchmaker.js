import { cfg, MIN_HUMANS, SEATS } from './config.js';
import { ROSTER } from './roster.js';
import { shuffle } from './engine.js';
import { verifyToken, escrow, refund, isDev } from './supa.js';
import { signTicket } from './ticket.js';

// One instance per fee tier. State is in memory only: a restart empties the queue.
export class Matchmaker {
  constructor(state, env) {
    this.env = env;
    this.c = cfg(env);
    this.queue = []; // {ws, userId, name, noMatch}
    this.mode = null; // {kind, timer, fireAt}
    this.starting = false;
    this.fee = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const url = new URL(request.url);
    const fee = Number(url.searchParams.get('fee'));
    const token = url.searchParams.get('token') || '';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    this.fee = fee;
    this.join(server, token, fee);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* closed */ }
  }
  fail(ws, code) {
    this.send(ws, { t: 'error', code });
    try { ws.close(1000, code); } catch (e) { /* */ }
  }

  async join(ws, token, fee) {
    let entry = null;
    const cleanup = () => { if (entry) this.remove(entry); };
    ws.addEventListener('close', cleanup);
    ws.addEventListener('error', cleanup);
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 256) return;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.t === 'leave') { cleanup(); try { ws.close(1000, 'left'); } catch (e) { /* */ } }
    });
    let user;
    try { user = await verifyToken(token, this.env); } catch (e) { user = null; }
    if (!user) return this.fail(ws, 'auth');
    if (isDev(this.env) && fee !== 0) return this.fail(ws, 'bad_fee');
    if (ws.readyState !== 1) return; // closed while verifying
    // same user queued twice: the newest socket wins
    const dup = this.queue.find((e) => e.userId === user.id);
    if (dup) { this.remove(dup); this.fail(dup.ws, 'server'); }
    entry = { ws, userId: user.id, name: user.name, noMatch: null };
    this.armNoMatch(entry);
    this.queue.push(entry);
    this.evaluate();
  }

  armNoMatch(entry) {
    if (this.fee === 0) return;
    entry.noMatch = setTimeout(() => {
      if (this.queue.includes(entry) && this.queue.length < MIN_HUMANS && !this.starting) {
        this.remove(entry);
        this.fail(entry.ws, 'no_match');
      }
    }, this.c.NO_MATCH_MS);
  }

  remove(entry) {
    const i = this.queue.indexOf(entry);
    if (entry.noMatch) clearTimeout(entry.noMatch);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.evaluate();
    }
  }

  clearMode() {
    if (this.mode) clearTimeout(this.mode.timer);
    this.mode = null;
  }

  evaluate() {
    if (this.starting) return;
    const n = this.queue.length;
    let kind = null, ms = 0;
    if (n >= SEATS) { kind = 'now'; ms = 0; }
    else if (n >= MIN_HUMANS) { kind = 'fill'; ms = this.c.QUEUE_FILL_MS; }
    else if (n === 1 && this.fee === 0) { kind = 'solo'; ms = this.c.FREE_SOLO_MS; }
    if (!kind) { this.clearMode(); this.broadcastQueue(); return; }
    if (!this.mode || this.mode.kind !== kind) {
      this.clearMode();
      this.mode = { kind, fireAt: Date.now() + ms, timer: setTimeout(() => this.fire(), ms) };
    }
    this.broadcastQueue();
  }

  broadcastQueue() {
    const startsIn = this.mode ? Math.max(0, Math.ceil((this.mode.fireAt - Date.now()) / 1000)) : null;
    for (const e of this.queue) this.send(e.ws, { t: 'queue', fee: this.fee, waiting: this.queue.length, startsIn });
  }

  async fire() {
    this.mode = null;
    if (this.starting || this.queue.length === 0) return;
    if (this.queue.length < MIN_HUMANS && this.fee !== 0) return;
    this.starting = true;
    try {
      await this.startMatch();
    } catch (e) {
      console.log('startMatch failed', e && e.message);
    } finally {
      this.starting = false;
      this.evaluate();
    }
  }

  async startMatch() {
    const fee = this.fee;
    let humans = this.queue.splice(0, SEATS).filter((e) => e.ws.readyState === 1);
    for (const h of humans) if (h.noMatch) clearTimeout(h.noMatch);
    if (humans.length === 0) return;
    if (fee > 0 && humans.length < MIN_HUMANS) { this.requeue(humans); return; }
    const matchId = crypto.randomUUID();
    let pot = 0;

    if (fee > 0) {
      const r = await escrow(this.env, matchId, humans.map((h) => h.userId), fee);
      if (!r.ok) {
        if (r.reason === 'insufficient_gems' && Array.isArray(r.failed) && r.failed.length) {
          const failed = new Set(r.failed);
          for (const h of humans) if (failed.has(h.userId)) this.fail(h.ws, 'insufficient_gems');
          this.requeue(humans.filter((h) => !failed.has(h.userId)));
        } else {
          const code = r.reason === 'disabled' ? 'disabled' : r.reason === 'bad_fee' ? 'bad_fee' : 'server';
          for (const h of humans) this.fail(h.ws, code);
        }
        return;
      }
      pot = r.pot != null ? r.pot : fee * humans.length;
    }

    // seats: humans in random seats, bots fill the rest with distinct names
    const seatOrder = shuffle([0, 1, 2, 3, 4]);
    const names = shuffle(ROSTER);
    const players = new Array(SEATS);
    humans.forEach((h, i) => {
      players[seatOrder[i]] = { seat: seatOrder[i], userId: h.userId, name: h.name, human: true, bot: null };
    });
    let b = 0;
    for (let i = humans.length; i < SEATS; i++) {
      const nm = names[b++];
      players[seatOrder[i]] = { seat: seatOrder[i], userId: null, name: nm, human: false, bot: nm };
    }

    let ok = false;
    try {
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(matchId));
      const res = await stub.fetch('https://room/init', {
        method: 'POST',
        headers: { 'x-room-secret': this.env.ROOM_SECRET || '', 'content-type': 'application/json' },
        body: JSON.stringify({ matchId, fee, pot, players }),
      });
      ok = res.ok;
    } catch (e) { ok = false; }
    if (!ok) {
      if (fee > 0) await refund(this.env, matchId);
      for (const h of humans) this.fail(h.ws, 'server');
      return;
    }
    for (const p of players) {
      if (!p.human) continue;
      const h = humans.find((x) => x.userId === p.userId);
      const ticket = await signTicket(this.env.ROOM_SECRET || '', matchId, p.userId);
      this.send(h.ws, { t: 'matched', matchId, ticket, seat: p.seat, fee, humans: humans.length, pot });
      try { h.ws.close(1000, 'matched'); } catch (e) { /* */ }
    }
  }

  requeue(entries) {
    for (const e of entries) {
      if (e.ws.readyState !== 1) continue;
      this.armNoMatch(e);
      this.queue.unshift(e);
    }
  }
}
