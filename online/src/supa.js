// Fetch-based Supabase helpers. Money RPCs are skipped entirely under DEV_AUTH.
export const isDev = (env) => env.DEV_AUTH === '1';

const clip = (s) => Array.from(String(s || '')).slice(0, 14).join('').trim();

async function timedFetch(url, init, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// -> { id, name } or null
export async function verifyToken(token, env) {
  if (typeof token !== 'string' || !token || token.length > 4096) return null;
  if (isDev(env) && token.startsWith('dev:')) {
    const name = token.slice(4).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 14);
    if (!name) return null;
    return { id: `dev-${name}`, name };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  try {
    const res = await timedFetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } },
      6000,
    );
    if (!res.ok) return null;
    const u = await res.json();
    if (!u || !u.id) return null;
    const md = u.user_metadata || {};
    const local = typeof u.email === 'string' ? u.email.split('@')[0] : '';
    return { id: String(u.id), name: clip(md.full_name || md.name || local || 'Player') || 'Player' };
  } catch (e) {
    return null;
  }
}

// -> { ok, data, error }
async function rpc(env, fn, body, ms = 8000) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return { ok: false, error: 'not_configured' };
  try {
    const res = await timedFetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/${fn}`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      ms,
    );
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep null */ }
    if (!res.ok) return { ok: false, error: `http_${res.status}`, data };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String((e && e.name) || e) };
  }
}

// -> {ok:true,pot,rake} | {ok:false,reason,failed?}
export async function escrow(env, matchId, users, fee) {
  if (isDev(env) || fee === 0) return { ok: true, pot: 0, rake: 0, skipped: true };
  const r = await rpc(env, 'online_match_escrow', { p_match: matchId, p_users: users, p_fee: fee, p_game: 'bluff-club' });
  if (!r.ok || !r.data || typeof r.data.ok !== 'boolean') return { ok: false, reason: 'server' };
  return r.data;
}

// winnerUserId null = bot/forfeited seat won
export async function settle(env, matchId, winnerUserId, forfeited) {
  if (isDev(env)) return { ok: true, skipped: true };
  const r = await rpc(env, 'online_match_settle', { p_match: matchId, p_winner: winnerUserId || null, p_forfeited: forfeited || [] });
  return r.ok && r.data ? r.data : { ok: false, reason: r.error || 'server' };
}

export async function refund(env, matchId) {
  if (isDev(env)) return { ok: true, skipped: true };
  const r = await rpc(env, 'online_match_refund', { p_match: matchId });
  return r.ok && r.data ? r.data : { ok: false, reason: r.error || 'server' };
}

// Safety net: refund any match stuck in escrow (Worker/DO crashed mid-game). Called by the cron trigger.
export async function sweepStale(env, minutes = 90) {
  if (isDev(env)) return { ok: true, skipped: true };
  const r = await rpc(env, 'online_match_refund_stale', { p_older_than_minutes: minutes });
  return r.ok ? { ok: true, refunded: r.data } : { ok: false, reason: r.error || 'server' };
}
