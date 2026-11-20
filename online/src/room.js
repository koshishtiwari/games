import { cfg, SEATS } from './config.js';
import { createGame, applyPlay, applyCall, resolveWindowClose, endReveal, autoPlay, validateCall, publicCounts, nextSeat } from './engine.js';
import { decidePlay, decideCall, botDelay, BOT_PLAY_DELAY, BOT_CALL_DELAY } from './bot.js';
import { verifyTicket } from './ticket.js';
import { settle, refund, isDev } from './supa.js';

const EMOJI = new Set(['😭', '🤣', '😠', '🤢', '❤️', '🤥', '🤡', '😥', '😎', '😬']);
const MAX_MSG = 512;

export class Room {
  constructor(state, env) {
    this.env = env;
    this.c = cfg(env);
    this.inited = false;
    this.state = 'none'; // none | lobby | running | over
    this.n = 0;
    this.sockets = new Map(); // seat -> ws
    this.timers = new Set(); // phase timers, cleared on every phase change
    this.grace = new Map(); // seat -> timer
    this.settled = false;
  }

  now() { return Date.now(); }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/init') return this.handleInit(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const matchId = url.pathname.split('/').pop();
    this.attach(server, matchId, url.searchParams.get('ticket') || '');
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleInit(request) {
    if (request.method !== 'POST') return new Response('no', { status: 405 });
    if (!this.env.ROOM_SECRET || request.headers.get('x-room-secret') !== this.env.ROOM_SECRET) return new Response('forbidden', { status: 403 });
    if (this.inited) return new Response('exists', { status: 409 });
    let b;
    try { b = await request.json(); } catch (e) { return new Response('bad', { status: 400 }); }
    if (!b || typeof b.matchId !== 'string' || !Array.isArray(b.players) || b.players.length !== SEATS) return new Response('bad', { status: 400 });
    this.matchId = b.matchId;
    this.fee = Number(b.fee) || 0;
    this.pot = Number(b.pot) || 0;
    this.rake = Math.floor(this.pot * 0.1);
    this.seatInfo = b.players.map((p) => ({
      seat: p.seat, userId: p.userId || null, name: String(p.name || 'Player').slice(0, 14),
      human: !!p.human, bot: p.bot || null, forfeited: false, strikes: 0, hello: false, welcomed: false, lastReact: 0,
    }));
    this.g = createGame({ seats: SEATS });
    this.inited = true;
    this.state = 'lobby';
    this.dealing = true;
    this.startTimer = setTimeout(() => this.beginGame(), this.c.START_WAIT_MS);
    return new Response('ok');
  }

  // ---------- sockets ----------
  async attach(ws, matchId, ticket) {
    let userId = null;
    try { userId = this.inited && matchId === this.matchId ? await verifyTicket(this.env.ROOM_SECRET, matchId, ticket) : null; } catch (e) { /* */ }
    const info = userId && this.seatInfo.find((s) => s.human && s.userId === userId);
    if (!info) {
      try { ws.send(JSON.stringify({ t: 'error', code: 'bad_ticket', n: ++this.n, now: this.now() })); ws.close(4001, 'bad_ticket'); } catch (e) { /* */ }
      return;
    }
    const seat = info.seat;
    const old = this.sockets.get(seat);
    this.sockets.set(seat, ws);
    if (old && old !== ws) { try { old.close(4002, 'replaced'); } catch (e) { /* */ } }
    this.clearGrace(seat);
    const meta = { seat, bucket: 30, refill: this.now() };
    ws.addEventListener('message', (ev) => this.onMessage(ws, meta, ev));
    const gone = () => {
      if (this.sockets.get(seat) !== ws) return;
      this.sockets.delete(seat);
      if (this.state === 'running' && !this.seatInfo[seat].forfeited) this.startGrace(seat);
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }

  onMessage(ws, meta, ev) {
    if (typeof ev.data !== 'string' || ev.data.length > MAX_MSG) return;
    const t = this.now();
    meta.bucket = Math.min(30, meta.bucket + ((t - meta.refill) / 1000) * 6);
    meta.refill = t;
    if (meta.bucket < 1) return;
    meta.bucket -= 1;
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const seat = meta.seat;
    if (this.sockets.get(seat) !== ws) return;
    const info = this.seatInfo[seat];
    switch (m.t) {
      case 'hello': return this.hello(seat);
      case 'play': {
        if (this.state !== 'running' || info.forfeited) return this.err(seat, 'bad_move');
        if (!Array.isArray(m.ids) || m.ids.length > 4) return this.err(seat, 'bad_move');
        const r = this.doPlay(seat, m.ids, m.rank, true);
        if (r) this.err(seat, r);
        return;
      }
      case 'call': {
        if (this.state !== 'running' || info.forfeited) return this.err(seat, 'bad_move');
        const r = this.doCall(seat);
        if (r) this.err(seat, r);
        return;
      }
      case 'react': {
        if (typeof m.e !== 'string' || !EMOJI.has(m.e)) return;
        if (t - info.lastReact < 400) return;
        info.lastReact = t;
        this.bcast({ t: 'react', seat, e: m.e });
        return;
      }
      default: return;
    }
  }

  // ---------- messaging ----------
  pack(obj) { return JSON.stringify({ ...obj, n: ++this.n, now: this.now() }); }
  sendWs(ws, obj) { try { ws.send(this.pack(obj)); } catch (e) { /* */ } }
  sendSeat(seat, obj) { const ws = this.sockets.get(seat); if (ws) this.sendWs(ws, obj); }
  bcast(obj) {
    const s = this.pack(obj);
    for (const ws of this.sockets.values()) { try { ws.send(s); } catch (e) { /* */ } }
  }
  err(seat, code) { this.sendSeat(seat, { t: 'error', code }); }
  sendHand(seat) {
    if (this.seatInfo[seat].human) this.sendSeat(seat, { t: 'hand', hand: this.g.hands[seat] });
  }
  sendCounts() { this.bcast({ t: 'counts', counts: publicCounts(this.g), pile: this.g.pile.length }); }

  playersView() {
    return this.seatInfo.map((s) => ({
      seat: s.seat, name: s.name, human: s.human && !s.forfeited, bot: s.bot, count: this.g.hands[s.seat].length,
    }));
  }
  welcomeFields(seat) {
    return { matchId: this.matchId, you: seat, fee: this.fee, pot: this.pot, players: this.playersView(), hand: this.g.hands[seat], first: this.g.first };
  }

  hello(seat) {
    const info = this.seatInfo[seat];
    info.hello = true;
    const ws = this.sockets.get(seat);
    if (!ws) return;
    if (this.state === 'lobby' || this.dealing || !info.welcomed) {
      info.welcomed = true;
      this.sendWs(ws, { t: 'welcome', ...this.welcomeFields(seat) });
      if (this.state === 'running' && !this.dealing) this.sendState(seat, ws);
    } else {
      this.sendState(seat, ws);
    }
    if (this.state === 'lobby' && this.seatInfo.every((s) => !s.human || s.hello)) this.beginGame();
  }
  sendState(seat, ws) {
    const g = this.g;
    const phase = this.state === 'over' ? 'over' : this.dealing ? 'lobby' : g.phase;
    this.sendWs(ws, {
      t: 'state', ...this.welcomeFields(seat), phase, cur: g.cur, deadline: this.deadline || 0,
      last: g.last ? { seat: g.last.seat, count: g.last.ids.length, rank: g.last.rank } : null,
      counts: publicCounts(g), pile: g.pile.length,
    });
  }

  // ---------- timers ----------
  later(ms, fn) {
    const id = setTimeout(() => { this.timers.delete(id); try { fn(); } catch (e) { console.log('timer error', e && e.stack); } }, ms);
    this.timers.add(id);
    return id;
  }
  clearTimers() { for (const id of this.timers) clearTimeout(id); this.timers.clear(); }
  startGrace(seat) {
    this.clearGrace(seat);
    this.grace.set(seat, setTimeout(() => {
      this.grace.delete(seat);
      if (this.state === 'running' && !this.sockets.has(seat)) { this.forfeit(seat); }
    }, this.c.GRACE_MS));
  }
  clearGrace(seat) {
    const t = this.grace.get(seat);
    if (t) { clearTimeout(t); this.grace.delete(seat); }
  }
  isBotSeat(seat) { const s = this.seatInfo[seat]; return !s.human || s.forfeited; }

  // ---------- game flow ----------
  beginGame() {
    if (this.state !== 'lobby') return;
    clearTimeout(this.startTimer);
    this.state = 'running';
    for (const s of this.seatInfo) if (s.human && !this.sockets.has(s.seat)) this.startGrace(s.seat);
    this.later(this.c.DEAL_MS, () => { this.dealing = false; this.startTurn(); });
  }

  startTurn() {
    if (this.state !== 'running') return;
    this.clearTimers();
    const g = this.g, seat = g.cur;
    this.deadline = this.now() + this.c.TURN_MS;
    this.bcast({ t: 'turn', seat, deadline: this.deadline });
    if (this.isBotSeat(seat)) this.scheduleBotPlay(seat);
    else this.later(this.c.TURN_MS, () => this.turnTimeout(seat));
  }

  scheduleBotPlay(seat) {
    this.later(botDelay(BOT_PLAY_DELAY, Math.random, this.c.BOT_SCALE), () => {
      if (this.g.phase !== 'turn' || this.g.cur !== seat) return;
      const mv = decidePlay(this.g, seat);
      const r = this.doPlay(seat, mv.ids, mv.rank, false);
      if (r) { const a = autoPlay(this.g, seat); this.doPlay(seat, a.ids, a.rank, false); }
    });
  }

  turnTimeout(seat) {
    const g = this.g;
    if (this.state !== 'running' || g.phase !== 'turn' || g.cur !== seat) return;
    const info = this.seatInfo[seat];
    info.strikes++;
    const a = autoPlay(g, seat);
    this.doPlay(seat, a.ids, a.rank, false);
    if (info.strikes >= 2 && !info.forfeited) this.forfeit(seat);
  }

  // returns error code or null
  doPlay(seat, ids, rank, manual) {
    const g = this.g;
    const r = applyPlay(g, seat, ids, rank);
    if (!r.ok) return r.error;
    if (manual) this.seatInfo[seat].strikes = 0;
    this.clearTimers();
    this.deadline = this.now() + this.c.WINDOW_MS;
    this.bcast({ t: 'played', seat, count: ids.length, rank, deadline: this.deadline });
    this.sendHand(seat);
    this.sendCounts();
    this.later(this.c.WINDOW_MS, () => this.windowClose());
    for (let s = 0; s < SEATS; s++) {
      if (s === seat || !this.isBotSeat(s)) continue;
      this.scheduleBotCall(s);
    }
    return null;
  }

  scheduleBotCall(s) {
    if (!decideCall(this.g, s)) return;
    this.later(botDelay(BOT_CALL_DELAY, Math.random, this.c.BOT_SCALE), () => this.doCall(s));
  }

  windowClose() {
    if (this.state !== 'running') return;
    const r = resolveWindowClose(this.g);
    if (!r.ok) return;
    if (r.winner !== null) return this.finish(r.winner);
    this.startTurn();
  }

  doCall(seat) {
    const g = this.g;
    const err = validateCall(g, seat);
    if (err) return err;
    const r = applyCall(g, seat);
    if (!r.ok) return r.error;
    this.clearTimers();
    this.bcast({ t: 'called', seat });
    this.bcast({ t: 'reveal', by: r.by, caller: r.caller, cards: r.cards, honest: r.honest, loser: r.loser, took: r.took });
    this.sendHand(r.loser);
    this.sendCounts();
    if (r.winner !== null) this.later(this.c.REVEAL_MS, () => this.finish(r.winner));
    else this.later(this.c.REVEAL_MS, () => { endReveal(g); this.startTurn(); });
    return null;
  }

  forfeit(seat) {
    const info = this.seatInfo[seat];
    if (info.forfeited || !info.human || this.state !== 'running') return;
    info.forfeited = true;
    this.clearGrace(seat);
    this.bcast({ t: 'forfeit', seat });
    if (this.checkAbandon()) return;
    const g = this.g;
    if (g.phase === 'turn' && g.cur === seat) {
      this.clearTimers();
      this.scheduleBotPlay(seat);
    }
  }

  // every human forfeited: end the match without waiting for bots
  checkAbandon() {
    if (this.seatInfo.some((s) => s.human && !s.forfeited)) return false;
    this.clearTimers();
    if (this.g.plays === 0) {
      this.state = 'over';
      this.clearAllGrace();
      this.settleOnce(() => refund(this.env, this.matchId));
    } else {
      this.finish(null);
    }
    return true;
  }
  clearAllGrace() { for (const t of this.grace.values()) clearTimeout(t); this.grace.clear(); }

  // winnerSeat null = abandoned with nobody human left
  finish(winnerSeat) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.clearTimers();
    this.clearAllGrace();
    const w = winnerSeat === null ? null : this.seatInfo[winnerSeat];
    const humanWin = !!(w && w.human && !w.forfeited);
    const refundCase = !humanWin && this.fee > 0;
    for (const s of this.seatInfo) {
      if (!s.human) continue;
      let payout = 0;
      if (this.fee > 0 && !isDev(this.env)) payout = humanWin ? (s.seat === winnerSeat ? this.pot - this.rake : 0) : Math.floor(this.fee * 0.9);
      this.sendSeat(s.seat, { t: 'over', winner: winnerSeat === null ? -1 : winnerSeat, human: humanWin, payout, rake: this.rake, refund: refundCase });
    }
    const forfeited = this.seatInfo.filter((s) => s.human && s.forfeited).map((s) => s.userId);
    this.settleOnce(() => settle(this.env, this.matchId, humanWin ? w.userId : null, forfeited));
    setTimeout(() => {
      for (const ws of this.sockets.values()) { try { ws.close(1000, 'over'); } catch (e) { /* */ } }
      this.sockets.clear();
    }, this.c.OVER_CLOSE_MS);
  }

  // money movement is idempotent server-side too; retry a few times on failure
  settleOnce(fn) {
    if (this.settled || this.fee === 0 || isDev(this.env)) { this.settled = true; return; }
    this.settled = true;
    (async () => {
      for (let i = 0; i < 4; i++) {
        const r = await fn();
        if (r && r.ok) return;
        console.log('settle failed', this.matchId, JSON.stringify(r));
        await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
      }
    })();
  }
}
