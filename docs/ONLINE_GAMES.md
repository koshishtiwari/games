# ONLINE_GAMES.md: playbook for adding online multiplayer to a Pipal game

Audience: a coding agent. Read this fully before touching `online/`. Bluff (`games/bluff-club`, `online/`) is the reference implementation.
Per-game wire format lives in a per-game PROTOCOL file (Bluff: `online/PROTOCOL.md`). This file is the reusable part: architecture, invariants, procedure, verification.

## 0. Decide first (do not skip)
| Question | Default | Why |
|---|---|---|
| Does the game need a server at all? | Only if state must be hidden or cheat-proof, or players interact live. Otherwise stay client-only. | Every server adds money-path risk. |
| Real gems at stake? | Start free tier (fee 0). Add paid tiers only after free works end to end. | Free tier skips escrow entirely. |
| Match shape | Quick match, fill with bots after a short wait. | Empty queues kill online modes. |
| Bots | Required. Server-side, same decision API as humans. | Fills seats, covers forfeits. |

If the user has not specified match shape, stakes and player count, ask once via AskUserQuestion, then proceed.

## 1. Architecture (what is reusable)
```
client (WebView, window.pipal) --ws--> Worker (index.js)
   |  pipal.user.token()                 |-- /ws/queue  -> Matchmaker DO (one per fee tier)
   |                                     |-- /ws/room/<id> -> Room DO (one per match)
   |                                     |-- cron -> sweepStale (refund stuck escrow)
   +--- no direct DB access              +--- supa.js -> Supabase RPCs (service key only)
```
Authority rule: the Room DO owns all game state. The client sends intents (`play`, `call`), never state. The client only renders what the server sends. Hidden info (other hands) must never be sent to a client that should not see it.

## 2. File map: copy, adapt, or rewrite
| File | Reuse | Notes |
|---|---|---|
| `src/index.js` | copy | Routing, CORS, error socket, cron. Change nothing but the route list. |
| `src/supa.js` | copy verbatim | `verifyToken`, `escrow`, `settle`, `refund`, `sweepStale`, timeouts, DEV_AUTH. |
| `src/ticket.js` | copy verbatim | HMAC room ticket `hex.userId`. |
| `src/matchmaker.js` | adapt | Generic queue/fill/escrow/ticket flow. Change seat count, roster, `startMatch` payload to your game. |
| `src/room.js` | adapt | Generic skeleton: attach/ticket, grace/reconnect, forfeit, timers (`later`), abandon, `finish` + `settleOnce`. Replace the game-specific handlers (`doPlay`, `doCall`, `windowClose`, ...). |
| `src/engine.js` | rewrite | Pure functions, no I/O, injectable `rng`. Keep it pure so it is unit-testable. |
| `src/bot.js` | rewrite | Pure `decide*(game, seat, rng)`. Delays live in the Room, not here. |
| `src/config.js` | adapt | Timing constants, `FEES`, `cfg(env)`. |
| `test/` | adapt | engine unit tests + random-play sim + e2e over real WebSockets. |
| `wrangler.toml` | adapt | New worker name per game, or add a second Room class to one worker. |

New game = new directory `online-<game>/` (or `online/<game>/`) copied from `online/`. Do not fork the money code; if you must change `supa.js` or the SQL, change it for all games and re-run every game's tests.

## 3. Invariants (violating any is a bug, treat as severity high)
1. **Server authoritative.** Validate every client message (`validatePlay` style) before mutating. Reject with `{t:'error', code}`, never trust ids/counts from the client.
2. **No hidden-info leaks.** Messages to a seat contain only what that seat may know. Review each `bcast`.
3. **Money is only moved by the 3 RPCs**, from the Worker with the secret key. The client never learns a secret key and never calls them. Grants: `service_role` only.
4. **Idempotent on `match_id`.** Escrow, settle, refund can be retried safely. `settleOnce` guards the Room side.
5. **Escrow before first move, settle exactly once at end, refund on abandon.** The cron `sweepStale` is the safety net, not the plan.
6. **Conservation.** Payout + rake must equal pot (or the refund rule). Write a test asserting it for every outcome path (human win, bot win, forfeit, abandon).
7. **Kill switch.** Paid matches must honor `game_economy_limits` key `online_enabled` (0 = off). Default stays 0 until the owner flips it. Settle/refund keep working when it is 0.
8. **DEV_AUTH never set in production.** It accepts `dev:<name>` tokens and disables money. Local only (`--var DEV_AUTH:1`).
9. **Timers are bounded.** Every wait (turn, window, reveal, grace) has a server timeout; a stuck human must never freeze a room. Timeout path = auto-move, then forfeit to a bot.
10. **Every server message carries monotonic `n`**; client drops stale/duplicate messages. Time fields use server `now` offset, not the client clock.

## 4. Procedure (do in this order)
1. **Write the per-game PROTOCOL file first.** Sections: rules, money, endpoints, queue messages, room messages (every field), reconnect. Then implement against it. Update it in the same commit as any message change. If code and protocol disagree, the bug is whichever is wrong; fix both.
2. **Engine + bot** (pure). Unit tests for every rule edge. Sim test: N random full games, assert termination and conservation (`conserved(g)` style), no exceptions.
3. **Room + Matchmaker** adapted from the reference. Run `npm test`.
4. **e2e test** (`npm run e2e`): spawns `wrangler dev --local` with DEV_AUTH, connects real sockets, plays a full free match, checks reconnect and forfeit. Must pass before any deploy.
5. **Client**: add an `ONL` module to the game. Guard every single-player code path (bot turns, local timers, win handling) so online games skip them. Queue incoming server messages while animations run, then apply in order. Hide the online button unless `pipal.user.token` exists.
6. **Local play**: `npm run dev`, open the game with `?dev=<name>&ws=ws://localhost:8787` in two tabs. (Follow the user's rule on browser testing for games: if they say no browser checks, use node-level tests only and say what is unverified.)
7. **Database**: if the game needs a new fee shape or rule, add a NEW migration in the pipal repo; reuse the existing RPCs where possible (`online_match_escrow(p_match,p_users,p_fee,p_game)`, `online_match_settle`, `online_match_refund`, `online_match_refund_stale`). Test SQL on a scratch local Postgres first. Never edit an applied migration.
8. **Go live** (each step touches production: get the owner's explicit go for the batch, then do all):
   1. Apply migration (kill switch stays 0).
   2. `npx wrangler secret put` for `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ROOM_SECRET` (random). Read values from the pipal `.env` without printing them.
   3. `npx wrangler deploy`; `curl <url>/health` returns `ok`.
   4. Smoke-probe prod: garbage token -> `auth`; bad fee -> `bad_fee`; bad ticket -> `bad_ticket`; publishable key calling an escrow RPC -> permission denied.
   5. Set `ONLINE_URL` in the client, `scripts/deploy.sh <game>`, bump `games.bundle_url` `?v=`.
   6. App build is required only if the bridge changed (`pipal.user.token` already exists). Never start EAS/gradle builds without an explicit go.
   7. Test free tier on device with two accounts. Only then, with the owner's go: `UPDATE game_economy_limits SET value = 1 WHERE key='online_enabled'`.

## 5. Commands
```bash
cd online && npm test          # engine + sim
cd online && npm run e2e       # real sockets, local wrangler, free tier
cd online && npm run dev       # local worker with DEV_AUTH
cd online && npx wrangler deploy
curl -s https://<worker>.workers.dev/health
```

## 6. Pitfalls already hit
- macOS has no `timeout`; do not wrap e2e in it.
- Postgres unix socket paths over ~100 chars fail; run scratch DBs under `/tmp`.
- Live ledger had a CHECK constraint on `game_gem_ledger.kind`; new kinds need the constraint widened in the migration.
- Regenerating game manifests overwrites hand-curated ones; `games-manifest.js` keeps existing unless `--force`.
- Durable Object room state is in memory: a DO restart ends that match (cron refunds later). If a new game needs restart survival, persist to DO storage.
- Online reactions are emoji from an allowlist; free-form content (GIFs, text) is not relayed. Add moderation before relaying user text.

## 7. Known gaps in the reference (do not assume solved)
- Paid path never exercised against live Supabase with real gems.
- Escrow RPC concurrency/deadlock test not run.
- `settle` retries 4x then only logs; the cron is the backstop.
- The money code has not had a human review. Get one before enabling `online_enabled`.
- Kill switch key `online_enabled` is global across games, and the refund-on-bot-win rule (`floor(fee*0.9)`) is Bluff policy encoded in the settle SQL. Verify both before reusing for a game with different rules; add per-game keys or parameters in a new migration if needed.

## 8. Definition of done for an online game
- [ ] Per-game PROTOCOL file matches the code.
- [ ] `npm test` and `npm run e2e` pass.
- [ ] Conservation test covers every payout path.
- [ ] Prod smoke probes (section 4.8.4) pass.
- [ ] Free tier played on device with two accounts.
- [ ] Owner told: kill switch state, unverified items, what needs their go.
