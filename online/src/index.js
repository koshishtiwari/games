import { FEES } from './config.js';
import { sweepStale } from './supa.js';
export { Matchmaker } from './matchmaker.js';
export { Room } from './room.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function errorSocket(code) {
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  server.send(JSON.stringify({ t: 'error', code }));
  server.close(1008, code);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export default {
  // cron trigger (wrangler.toml): refund matches stuck in escrow for 90+ minutes
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweepStale(env, 90).then((r) => { if (!r.ok) console.log('sweepStale failed', JSON.stringify(r)); else if (r.refunded) console.log('sweepStale refunded', r.refunded); }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/health') return new Response('ok', { headers: { 'Content-Type': 'text/plain', ...CORS } });

    const isWs = url.pathname === '/ws/queue' || url.pathname.startsWith('/ws/room/');
    if (!isWs) return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });

    if (url.pathname === '/ws/queue') {
      const fee = Number(url.searchParams.get('fee'));
      if (!FEES.includes(fee)) return errorSocket('bad_fee');
      const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('q' + fee));
      return stub.fetch(request);
    }
    const id = url.pathname.slice('/ws/room/'.length);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return new Response('bad room', { status: 400 });
    return env.ROOM.get(env.ROOM.idFromName(id)).fetch(request);
  },
};
