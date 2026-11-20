// Room ticket = HMAC_SHA256(ROOM_SECRET, matchId + ':' + userId) hex + '.' + userId
const enc = new TextEncoder();
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function signTicket(secret, matchId, userId) {
  return `${await hmacHex(secret, `${matchId}:${userId}`)}.${userId}`;
}
// returns userId or null
export async function verifyTicket(secret, matchId, ticket) {
  if (!secret || typeof ticket !== 'string' || ticket.length > 200) return null;
  const i = ticket.indexOf('.');
  if (i < 1) return null;
  const mac = ticket.slice(0, i);
  const userId = ticket.slice(i + 1);
  if (!userId) return null;
  const want = await hmacHex(secret, `${matchId}:${userId}`);
  if (mac.length !== want.length) return null;
  let d = 0;
  for (let k = 0; k < mac.length; k++) d |= mac.charCodeAt(k) ^ want.charCodeAt(k);
  return d === 0 ? userId : null;
}
