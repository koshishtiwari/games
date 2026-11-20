# Bluff online: contract

Quick-match online Bluff with gem entry fees. This file is the single source of truth between the Worker (`online/src`), the Pipal database
(`supabase/migrations/20261121_online_escrow.sql` in the pipal repo) and the game client (`games/bluff-club/index.html`).
Rules of the game itself are the ones in `games/bluff-club/index.html` (`play`, `windowClose`, `callLiar`, `runReveal`, `win`).

## 1. Game rules (server authoritative)
- 5 seats (0..4). Humans + bots. 52-card deck, ids `0..51`, `r = id % 13` (0=A .. 12=K), `s = floor(id / 13)`. Everyone is dealt all cards (10 or 11 each). Random first seat.
- On your turn you pick 1 to 4 of your cards, face down, and claim a rank `rank` (0..12, any rank, truthful or not). Claim count = number of cards.
- After a play the phase is `window` for `WINDOW_MS`. Any OTHER seat may `call` (LIAR). First valid call wins the race.
  - No call before the deadline: if the player who played now has 0 cards, they win. Otherwise the turn passes to the next seat (seat+1 mod 5).
  - Call: the last play's cards are revealed. `honest = every revealed card has r == claimed rank`. Loser = honest ? caller : player. Loser takes the WHOLE pile.
    If honest and the player who played now has 0 cards, that player wins. Otherwise the next turn is `next(player who played)`.
- Phases: `lobby`, `turn`, `window`, `reveal`, `over`. `reveal` lasts `REVEAL_MS` (clients animate), then the next `turn` starts.
- Turn timer `TURN_MS`. On timeout the server auto-plays one random card claiming its true rank. 2 timeouts in a row (or a disconnect longer than `GRACE_MS`) and that seat is taken over by a bot ("forfeited").
- Constants: `WINDOW_MS=5000`, `TURN_MS=25000`, `REVEAL_MS=6500`, `GRACE_MS=25000`, `MIN_HUMANS=2`, `QUEUE_FILL_MS=8000`, `FREE_SOLO_MS=20000`.

## 2. Money (fee tiers: 0, 10, 50 gems; `0` = free practice, no escrow)
- At match start each human pays `fee` into escrow (all-or-nothing via RPC). `pot = fee * humans`. `rake = floor(pot * 0.10)` is burned (a sink).
- Human (non-forfeited) wins: payout `pot - rake` to the winner.
- Bot or forfeited seat wins: every human gets back `floor(fee * 0.9)` (the 10% rake is still burned). Nobody can lose more than the rake to a bot.
- Match abandoned before the first play (everyone left / server error): full refund.
- Every movement is idempotent on `match_id`. Only the Worker (secret key) may call the RPCs.

## 3. Worker endpoints (`pipal-bluff-online`)
- `GET /health` -> `ok`.
- `GET /ws/queue?token=<supabase access token>&fee=<0|10|50>` (WebSocket) -> Matchmaker DO (one DO per fee tier, `idFromName('q'+fee)`).
- `GET /ws/room/<matchId>?ticket=<ticket>` (WebSocket) -> Room DO (`idFromName(matchId)`). A ticket is `HMAC_SHA256(ROOM_SECRET, matchId + ':' + userId)` hex plus `.` + userId; one per human.
- Auth: Worker verifies the token with `GET {SUPABASE_URL}/auth/v1/user` (headers `apikey: SUPABASE_PUBLISHABLE_KEY`, `Authorization: Bearer <token>`). `id` is the user id.
  Display name: `user_metadata.full_name || user_metadata.name || email local part || 'Player'`, max 14 chars.
- Dev auth: when env `DEV_AUTH === '1'` the token `dev:<name>` is accepted (user id `dev-<name>`) and fee must be 0. Never set `DEV_AUTH` in production.
- Env/secrets: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (secret), `ROOM_SECRET` (secret), `DEV_AUTH` (dev only).

## 4. Queue socket
Server -> client:
- `{t:'queue', fee, waiting, startsIn}` (`startsIn` seconds until fill-with-bots, or null while waiting for a 2nd player)
- `{t:'matched', matchId, ticket, seat, fee, humans, pot}` then the server closes the queue socket.
- `{t:'error', code}`: `auth`, `bad_fee`, `insufficient_gems`, `disabled` (kill switch), `no_match` (paid tier, nobody came in 60s, fee refunded/never taken), `server`.
Client -> server: `{t:'leave'}`.
Matchmaking: join -> `waiting`. With >=2 humans start a `QUEUE_FILL_MS` countdown; at 5 humans start now. When it fires, fill remaining seats with bots up to 5, escrow fees (drop humans who cannot pay with an `insufficient_gems` error and re-evaluate), create the match.
Free tier only: a lone human gets a bot match after `FREE_SOLO_MS`. Paid tiers never start with 1 human.

## 5. Room socket
Client -> server:
- `{t:'hello'}` (after connect; server replies with `welcome`, or `state` on reconnect)
- `{t:'play', ids:[..1-4 card ids you hold], rank:0..12}`
- `{t:'call'}`
- `{t:'react', e:'<emoji>'}` (emoji allowlist: `😭 🤣 😠 🤢 ❤️ 🤥 🤡 😥 😎 😬`), relayed to all.
Server -> client (every message has a monotonically increasing `n`):
- `{t:'welcome', matchId, you:<seat>, fee, pot, players:[{seat,name,human,bot:<rosterName|null>,count}], hand:[ids], first:<seat>}`: game start; deal animation runs from this.
- `{t:'turn', seat, deadline}` (`deadline` is epoch ms; use `Date.now()` offset from `now` field `{..., now}` to avoid clock skew)
- `{t:'played', seat, count, rank, deadline}` (window opens; `hand` is NOT included, clients drop `count` cards from that seat; your own hand changes via `hand` below)
- `{t:'hand', hand:[ids]}` (your full hand, sent whenever it changes)
- `{t:'called', seat}` then `{t:'reveal', by:<seat who played>, caller:<seat>, cards:[ids], honest, loser:<seat>, took:<pile size>}`
- `{t:'counts', counts:[5 ints], pile:<int>}` (sent after every change)
- `{t:'react', seat, e}`
- `{t:'forfeit', seat}` (seat is now a bot)
- `{t:'over', winner:<seat>, human:<bool>, payout:<gems this player receives>, rake, refund:<bool>}` then the server closes the socket after 10s.
- `{t:'error', code}`: `bad_move`, `not_your_turn`, `bad_ticket`.
`now` (epoch ms) is included in `turn`, `played`, `welcome`.
Reconnect: same ticket within `GRACE_MS` -> server sends `state` = `welcome` fields + `phase`, `cur`, `deadline`, `last:{seat,count,rank}`, `counts`, `pile`.

## 6. Database RPCs (service role only; grants revoked from anon/authenticated)
- `online_match_escrow(p_match uuid, p_users uuid[], p_fee int, p_game text) returns jsonb`
  `{ok:true, pot, rake}` or `{ok:false, reason:'insufficient_gems'|'disabled'|'bad_fee'|'duplicate', failed:[uuid,..]}`. Deducts atomically from each wallet (all or none), writes `game_gem_ledger` rows (reason `online_escrow`) and the match rows. Honors a kill switch key `online_enabled` in `game_economy_limits` (0 = off, default 0 so nothing is live until enabled).
- `online_match_settle(p_match uuid, p_winner uuid, p_forfeited uuid[]) returns jsonb`
  `p_winner` null = a bot/forfeited seat won. Pays winner `pot - rake` or refunds everyone `floor(fee*0.9)`. Idempotent: a second call returns the stored result. `{ok:true, payout, rake, refunded}`.
- `online_match_refund(p_match uuid) returns jsonb`: full refund if still `escrowed`; idempotent.
Rake is burned: recorded in `game_faucet_daily` as burned for game `bluff-club`.
